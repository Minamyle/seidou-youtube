-- Moves ASOS, Temu and SHEIN products out of catalogue_videos into their own
-- table, catalogue_products, for the app's product page.
--
-- Why: catalogue_videos is mirrored into Seidou Social's `videos` table by the
-- main app's trigger (seidou: social/db/migrations/0005_catalogue_sync.sql),
-- so imported products were showing up in Seidou Social as broken videos.
-- Products are not videos and must not appear there.
--
-- What this does, in one transaction:
--   1. creates catalogue_products (publicly readable, written only by the
--      import service)
--   2. copies the existing ASOS/Temu/SHEIN rows into it, fixing the 120px
--      ASOS pictures and stripping prices from titles on the way
--   3. removes those rows from Seidou Social (`videos`) and from
--      catalogue_videos, plus the placeholder channels created only for them
--   4. returns catalogue_videos to YouTube and X only
--   5. replaces import_video_batch so video rows go to catalogue_videos and
--      product rows go to catalogue_products
--
-- Run in the Supabase SQL editor after
-- 20261119120000_add_retail_product_support.sql. Safe to run again: once the
-- products have been moved, a second run copies nothing and changes nothing.
-- Sanity is not touched.

begin;

-- ---------------------------------------------------------------- 1. table

create table if not exists public.catalogue_products (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    constraint catalogue_products_platform_check check (platform in ('asos', 'temu', 'shein')),
  product_id text not null,          -- ASOS /prd/<id>, Temu goods_id, SHEIN -p-<id>
  product_url text not null,         -- product page on the shop's site
  title text not null,
  image_url text not null,           -- product picture, linked from the shop's CDN
  category text not null,
  channel_name text not null,        -- label from the import file, e.g. "ASOS"
  brand text,                        -- brand found on the page, when there is one
  import_batch_id uuid references public.video_import_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalogue_products_platform_product_id_key
  on public.catalogue_products (platform, product_id);

-- Not unique: ASOS sets list several products on one group page
-- (see 20261123140000_allow_shared_product_links.sql).
create index if not exists catalogue_products_product_url_idx
  on public.catalogue_products (product_url);

create index if not exists catalogue_products_category_idx on public.catalogue_products (category);

create index if not exists catalogue_products_platform_created_at_idx
  on public.catalogue_products (platform, created_at desc);

create index if not exists catalogue_products_created_at_idx on public.catalogue_products (created_at desc);

alter table public.catalogue_products enable row level security;

drop policy if exists "Catalogue products are publicly readable" on public.catalogue_products;

create policy "Catalogue products are publicly readable"
  on public.catalogue_products
  for select
  using (true);

drop policy if exists "Service role can manage catalogue products" on public.catalogue_products;

create policy "Service role can manage catalogue products"
  on public.catalogue_products
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists set_catalogue_products_updated_at on public.catalogue_products;

create trigger set_catalogue_products_updated_at
  before update on public.catalogue_products
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------- 2. copy

-- Step 4 drops catalogue_videos.product_id and image_url, so on a second run
-- there is nothing left to copy. The copy only runs while those columns exist,
-- which makes this file safe to run more than once.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalogue_videos' and column_name = 'product_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalogue_videos' and column_name = 'image_url'
  ) then
    execute $copy$
      insert into public.catalogue_products (
        platform, product_id, product_url, title, image_url, category,
        channel_name, brand, import_batch_id, created_at
      )
      select
        c.platform,
        c.product_id,
        c.video_url,
        -- "Name $76.00 MORE COLOURS" -> "Name" (kept as-is if nothing would remain)
        coalesce(nullif(trim(regexp_replace(c.video_title, '\s*[$£€₦]\s?\d.*$', '')), ''), c.video_title),
        -- Early ASOS imports stored the 120px thumbnail; use the 952px picture.
        case when c.platform = 'asos'
          then replace(c.image_url, '$n_240w$&wid=120', '$n_960w$&wid=952')
          else c.image_url
        end,
        c.category,
        c.channel_name,
        c.actual_channel_name,
        c.import_batch_id,
        c.created_at
      from public.catalogue_videos c
      where c.platform in ('asos', 'temu', 'shein')
        and c.product_id is not null
        and c.image_url is not null
      on conflict do nothing
    $copy$;
  else
    raise notice 'catalogue_videos has no product columns any more; products were already moved, nothing to copy';
  end if;
end;
$$;

-- ---------------------------------------------------------------- 3. remove from Seidou Social

-- The Seidou Social tables (videos, users, social_profiles) belong to the main
-- app. They are only touched when they exist, so this file also runs on a
-- database without Seidou Social.
do $$
declare
  r record;
  channel_users uuid[];
begin
  if to_regclass('public.videos') is not null then
    -- Remember which placeholder channels the product rows used.
    select coalesce(array_agg(distinct v.user_id), '{}') into channel_users
    from public.videos v
    join public.catalogue_videos c on v.external_id = 'catalogue:' || c.id::text
    where c.platform in ('asos', 'temu', 'shein');

    -- Delete the mirrored rows directly. The main app's trigger would also do
    -- this when the catalogue rows are deleted below, but it downgrades errors
    -- to warnings, so this makes sure. Likes, views, comments and playlist
    -- entries on these rows go with them (ON DELETE CASCADE).
    delete from public.videos v
    using public.catalogue_videos c
    where v.external_id = 'catalogue:' || c.id::text
      and c.platform in ('asos', 'temu', 'shein');

    -- Remove placeholder channel users that now have no videos. Only users the
    -- sync created (no email, no other videos) are touched; anything that
    -- fails is reported and left in place rather than blocking the migration.
    if to_regclass('public.users') is not null and to_regclass('public.social_profiles') is not null then
      for r in
        select u.id, u.display_name
        from public.users u
        where u.id = any (channel_users)
          and u.email is null
          and not exists (select 1 from public.videos v where v.user_id = u.id)
      loop
        begin
          delete from public.social_profiles where user_id = r.id;
          delete from public.users where id = r.id;
          raise notice 'Removed empty placeholder channel "%"', r.display_name;
        exception when others then
          raise notice 'Kept placeholder channel "%": %', r.display_name, sqlerrm;
        end;
      end loop;
    end if;
  end if;

  delete from public.catalogue_videos
  where platform in ('asos', 'temu', 'shein');
end;
$$;

-- ---------------------------------------------------------------- 4. catalogue_videos: videos only

alter table public.catalogue_videos drop constraint if exists catalogue_videos_retail_image_check;

alter table public.catalogue_videos drop constraint if exists catalogue_videos_platform_check;

alter table public.catalogue_videos
  add constraint catalogue_videos_platform_check
  check (platform in ('youtube', 'x'));

drop index if exists public.catalogue_videos_platform_product_id_key;

alter table public.catalogue_videos
  drop column if exists product_id,
  drop column if exists image_url;

-- ---------------------------------------------------------------- 5. import function

create or replace function public.import_video_batch(
  p_batch_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_total integer;
begin
  if exists (
    select 1
    from jsonb_array_elements(p_records) as record
    where coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube')
      not in ('youtube', 'x', 'asos', 'temu', 'shein')
  ) then
    raise exception 'Unsupported platform in batch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record
    where lower(record ->> 'platform') in ('asos', 'temu', 'shein')
      and (nullif(record ->> 'external_id', '') is null or nullif(record ->> 'image_url', '') is null)
  ) then
    raise exception 'Product records need a product ID and an image URL';
  end if;

  select count(*) into v_total from jsonb_array_elements(p_records);

  with raw as (
    select
      (record ->> 'video_url') as video_url,
      coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube') as platform,
      nullif(record ->> 'external_id', '') as external_id,
      (record ->> 'video_title') as video_title,
      (record ->> 'category') as category,
      (record ->> 'channel_name') as channel_name,
      nullif(record ->> 'actual_channel_name', '') as actual_channel_name,
      coalesce((record ->> 'is_unrelated_channel')::boolean, false) as is_unrelated_channel,
      nullif(record ->> 'image_url', '') as image_url,
      row_number() over (
        partition by
          coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube'),
          coalesce(nullif(record ->> 'external_id', ''), record ->> 'video_url')
        order by record ->> 'video_url'
      ) as rn
    from jsonb_array_elements(p_records) as record
  ),
  incoming as (
    select
      r.*,
      case when r.platform = 'youtube' then r.external_id end as youtube_id,
      case when r.platform = 'x' then r.external_id end as x_post_id
    from raw r
    where r.rn = 1
  ),
  new_videos as (
    select i.*
    from incoming i
    where i.platform in ('youtube', 'x')
      and not exists (
        select 1 from public.catalogue_videos v
        where v.video_url = i.video_url
           or (i.youtube_id is not null and v.youtube_id = i.youtube_id)
           or (i.x_post_id is not null and v.x_post_id = i.x_post_id)
      )
  ),
  new_products as (
    select i.*
    from incoming i
    where i.platform in ('asos', 'temu', 'shein')
      and not exists (
        select 1 from public.catalogue_products p
        where (p.platform = i.platform and p.product_id = i.external_id)
           or p.product_url = i.video_url
      )
  ),
  inserted_videos as (
    insert into public.catalogue_videos (
      video_url, platform, youtube_id, x_post_id, video_title, category,
      channel_name, actual_channel_name, is_unrelated_channel, import_batch_id
    )
    select
      video_url, platform, youtube_id, x_post_id, video_title, category,
      channel_name, actual_channel_name, is_unrelated_channel, p_batch_id
    from new_videos
    on conflict do nothing
    returning id
  ),
  inserted_products as (
    insert into public.catalogue_products (
      platform, product_id, product_url, title, image_url, category,
      channel_name, brand, import_batch_id
    )
    select
      platform, external_id, video_url, video_title, image_url, category,
      channel_name, actual_channel_name, p_batch_id
    from new_products
    on conflict do nothing
    returning id
  )
  select (select count(*) from inserted_videos) + (select count(*) from inserted_products)
    into v_inserted;

  update public.video_import_batches
  set
    status = 'completed',
    records_processed = v_total,
    records_inserted = v_inserted,
    records_skipped_existing = v_total - v_inserted,
    records_failed = 0
  where id = p_batch_id;

  return jsonb_build_object(
    'processed', v_total,
    'inserted', v_inserted,
    'skipped_existing', v_total - v_inserted
  );
end;
$$;

-- CREATE OR REPLACE keeps the existing grants on the function (service_role
-- only, from the original migration).

commit;
