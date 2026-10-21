-- Try to alter storage.objects - some projects need different approach
DO 
BEGIN
  BEGIN
    ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END ;
