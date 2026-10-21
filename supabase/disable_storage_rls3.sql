DO 
BEGIN
  ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not disable RLS on storage.objects: %', SQLERRM;
END ;
