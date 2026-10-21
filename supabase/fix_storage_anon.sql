-- Allow anon access for this internal import tool (bucket is private but we need to upload)
drop policy if exists "Allow anon upload to video-import-images" on storage.objects;
create policy "Allow anon upload to video-import-images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'video-import-images');

drop policy if exists "Allow anon select from video-import-images" on storage.objects;
create policy "Allow anon select from video-import-images"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'video-import-images');

drop policy if exists "Allow anon update to video-import-images" on storage.objects;
create policy "Allow anon update to video-import-images"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'video-import-images')
  with check (bucket_id = 'video-import-images');

drop policy if exists "Allow anon delete from video-import-images" on storage.objects;
create policy "Allow anon delete from video-import-images"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'video-import-images');
