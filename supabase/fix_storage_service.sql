-- Fix storage RLS - allow service role full access to the bucket
drop policy if exists "Service role full access to video-import-images" on storage.objects;
drop policy if exists "Allow service_role to manage bucket objects" on storage.objects;

create policy "Allow service_role to manage video-import-images"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'video-import-images')
  with check (bucket_id = 'video-import-images');
