-- Adds X (Twitter) support to the video import catalogue.
--
-- Run this once in the Supabase SQL editor (or apply it with the Supabase CLI)
-- after the original 20261021100000_video_import.sql migration.
--
-- Existing YouTube rows get platform = 'youtube'. The old youtube_id column is
-- kept and still holds the YouTube video ID; X posts store their status ID in
-- x_post_id instead.

alter table public.catalogue_videos
  add column if not exists platform text;

update public.catalogue_videos
set platform = 'youtube'
where platform is null;

alter table public.catalogue_videos
  alter column platform set default 'youtube',
  alter column platform set not null;

alter table public.catalogue_videos
  add column if not exists x_post_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalogue_videos_platform_check'
      and conrelid = 'public.catalogue_videos'::regclass
  ) then
    alter table public.catalogue_videos
      add constraint catalogue_videos_platform_check
      check (platform in ('youtube', 'x'));
  end if;
end;
$$;

create unique index if not exists catalogue_videos_x_post_id_key
  on public.catalogue_videos (x_post_id)
  where x_post_id is not null;

alter table public.video_import_batches
  add column if not exists platforms text[] not null default '{}';

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
    where coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube') not in ('youtube', 'x')
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
  filtered as (
    select i.*
    from incoming i
    where not exists (
      select 1 from public.catalogue_videos v
      where v.video_url = i.video_url
         or (i.youtube_id is not null and v.youtube_id = i.youtube_id)
         or (i.x_post_id is not null and v.x_post_id = i.x_post_id)
    )
  ),
  inserted as (
    insert into public.catalogue_videos (
      video_url,
      platform,
      youtube_id,
      x_post_id,
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

-- CREATE OR REPLACE keeps the existing grants on the function. On a fresh
-- project the original migration already granted execute to service_role only.
