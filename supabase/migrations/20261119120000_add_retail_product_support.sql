-- Adds ASOS, Temu and SHEIN product picture posts to the import catalogue.
--
-- Superseded by 20261123120000_move_retail_products_to_own_table.sql, which
-- moves products into their own catalogue_products table. Run both, in order.
--
-- Run this once in the Supabase SQL editor (or apply it with the Supabase CLI)
-- after 20261029120000_add_x_video_support.sql.
--
-- Retail records are product pictures, identified by their product page:
--   video_url  -> the product page URL (stable; the post links to it)
--   product_id -> the retailer's product ID (ASOS /prd/<id>, Temu goods_id,
--                 SHEIN -p-<id>), used for de-duplication
--   image_url  -> the product picture shown in the feed. Required for retail
--                 rows, null for YouTube and X rows.
--
-- Existing YouTube and X rows are unchanged.

alter table public.catalogue_videos
  add column if not exists product_id text,
  add column if not exists image_url text;

alter table public.catalogue_videos
  drop constraint if exists catalogue_videos_platform_check;

alter table public.catalogue_videos
  add constraint catalogue_videos_platform_check
  check (platform in ('youtube', 'x', 'asos', 'temu', 'shein'));

alter table public.catalogue_videos
  drop constraint if exists catalogue_videos_retail_image_check;

alter table public.catalogue_videos
  add constraint catalogue_videos_retail_image_check
  check (platform not in ('asos', 'temu', 'shein') or image_url is not null);

create unique index if not exists catalogue_videos_platform_product_id_key
  on public.catalogue_videos (platform, product_id)
  where product_id is not null;

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
    raise exception 'Unsupported video platform in batch';
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
      case when r.platform = 'x' then r.external_id end as x_post_id,
      case when r.platform in ('asos', 'temu', 'shein') then r.external_id end as product_id
    from raw r
    where r.rn = 1
  ),
  filtered as (
    select i.*
    from incoming i
    where not exists (
      select 1 from public.catalogue_videos v
      where v.video_url = i.video_url
         or (i.youtube_id is not null and v.youtube_id = i.youtube_id)
         or (i.x_post_id is not null and v.x_post_id = i.x_post_id)
         or (i.product_id is not null and v.platform = i.platform and v.product_id = i.product_id)
    )
  ),
  inserted as (
    insert into public.catalogue_videos (
      video_url,
      platform,
      youtube_id,
      x_post_id,
      product_id,
      image_url,
      video_title,
      category,
      channel_name,
      actual_channel_name,
      is_unrelated_channel,
      import_batch_id
    )
    select
      video_url,
      platform,
      youtube_id,
      x_post_id,
      product_id,
      image_url,
      video_title,
      category,
      channel_name,
      actual_channel_name,
      is_unrelated_channel,
      p_batch_id
    from filtered
    on conflict do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

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
