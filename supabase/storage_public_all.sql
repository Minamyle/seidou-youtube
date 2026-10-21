DROP POLICY IF EXISTS "Allow anon upload to video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon select from video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon update to video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon delete from video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload to video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated select from video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update to video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete from video-import-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow service_role to manage bucket objects" ON storage.objects;
DROP POLICY IF EXISTS "Service role full access to video-import-images" ON storage.objects;

CREATE POLICY "Public upload to video-import-images"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'video-import-images');

CREATE POLICY "Public select from video-import-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'video-import-images');

CREATE POLICY "Public update to video-import-images"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'video-import-images')
WITH CHECK (bucket_id = 'video-import-images');

CREATE POLICY "Public delete from video-import-images"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'video-import-images');
