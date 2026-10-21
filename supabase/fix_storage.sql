alter table public.video_import_batches disable row level security;
alter table public.catalogue_videos disable row level security;

alter table storage.objects enable row level security;

drop policy if exists "Service role full access to video-import-images" on storage.objects;
create policy "Service role full access to video-import-images"
  on storage.objects
  for all
  using (bucket_id = 'video-import-images')
  with check (bucket_id = 'video-import-images');
