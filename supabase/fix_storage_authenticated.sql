-- Also try making it permissive for authenticated and service_role
drop policy if exists "Allow authenticated upload to video-import-images" on storage.objects;
create policy "Allow authenticated upload to video-import-images"
  on storage.objects
  for insert
  to authenticated, service_role
  with check (bucket_id = 'video-import-images');

drop policy if exists "Allow authenticated select from video-import-images" on storage.objects;
create policy "Allow authenticated select from video-import-images"
  on storage.objects
  for select
  to authenticated, service_role
  using (bucket_id = 'video-import-images');

drop policy if exists "Allow authenticated update to video-import-images" on storage.objects;
create policy "Allow authenticated update to video-import-images"
  on storage.objects
  for update
  to authenticated, service_role
  using (bucket_id = 'video-import-images')
  with check (bucket_id = 'video-import-images');

drop policy if exists "Allow authenticated delete from video-import-images" on storage.objects;
create policy "Allow authenticated delete from video-import-images"
  on storage.objects
  for delete
  to authenticated, service_role
  using (bucket_id = 'video-import-images');
