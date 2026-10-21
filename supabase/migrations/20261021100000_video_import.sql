create table if not exists public.video_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text,
  category text,
  channel_names text[] not null default '{}',
  image_path text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  records_processed integer not null default 0,
  records_inserted integer not null default 0,
  records_skipped_existing integer not null default 0,
  records_failed integer not null default 0,
  error_message text,
  imported_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalogue_videos (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  youtube_id text,
  video_title text not null,
  category text not null,
  channel_name text not null,
  actual_channel_name text,
  is_unrelated_channel boolean not null default false,
  import_batch_id uuid references public.video_import_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalogue_videos_video_url_key
  on public.catalogue_videos (video_url);

create unique index if not exists catalogue_videos_youtube_id_key
  on public.catalogue_videos (youtube_id) where youtube_id is not null;

create index if not exists catalogue_videos_category_idx on public.catalogue_videos (category);

create index if not exists catalogue_videos_channel_name_idx on public.catalogue_videos (channel_name);

create index if not exists catalogue_videos_import_batch_idx on public.catalogue_videos (import_batch_id);

create index if not exists catalogue_videos_created_at_idx on public.catalogue_videos (created_at desc);

alter table public.catalogue_videos enable row level security;

alter table public.video_import_batches enable row level security;

drop policy if exists "Catalogue videos are publicly readable" on public.catalogue_videos;

create policy "Catalogue videos are publicly readable"
  on public.catalogue_videos
  for select
  using (true);

drop policy if exists "Service role can manage catalogue videos" on public.catalogue_videos;

create policy "Service role can manage catalogue videos"
  on public.catalogue_videos
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Service role can manage video import batches" on public.video_import_batches;

create policy "Service role can manage video import batches"
  on public.video_import_batches
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_catalogue_videos_updated_at on public.catalogue_videos;

create trigger set_catalogue_videos_updated_at
  before update on public.catalogue_videos
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_batches_updated_at on public.video_import_batches;

create trigger set_batches_updated_at
  before update on public.video_import_batches
  for each row
  execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('video-import-images', 'video-import-images', false)
on conflict (id) do nothing;

create or replace function public.import_video_batch(
  p_batch_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_inserted integer;
  v_total integer;
begin
  select count(*) into v_total from jsonb_array_elements(p_records);

  with raw as (
    select
      (record ->> 'video_url') as video_url,
      nullif(record ->> 'youtube_id', '') as youtube_id,
      (record ->> 'video_title') as video_title,
      (record ->> 'category') as category,
      (record ->> 'channel_name') as channel_name,
      nullif(record ->> 'actual_channel_name', '') as actual_channel_name,
      coalesce((record ->> 'is_unrelated_channel')::boolean, false) as is_unrelated_channel,
      row_number() over (
        partition by coalesce(nullif(record ->> 'youtube_id', ''), record ->> 'video_url')
        order by record ->> 'video_url'
      ) as rn
    from jsonb_array_elements(p_records) as record
  ),
  incoming as (
    select * from raw where rn = 1
  ),
  filtered as (
    select i.*
    from incoming i
    where not exists (
      select 1 from public.catalogue_videos v
      where v.video_url = i.video_url
         or (i.youtube_id is not null and v.youtube_id = i.youtube_id)
    )
  ),
  inserted as (
    insert into public.catalogue_videos (
      video_url,
      youtube_id,
      video_title,
      category,
      channel_name,
      actual_channel_name,
      is_unrelated_channel,
      import_batch_id
    )
    select
      video_url,
      youtube_id,
      video_title,
      category,
      channel_name,
      actual_channel_name,
      is_unrelated_channel,
      p_batch_id
    from filtered
    on conflict (video_url) do nothing
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

revoke execute on function public.import_video_batch(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.import_video_batch(uuid, jsonb) to service_role;
