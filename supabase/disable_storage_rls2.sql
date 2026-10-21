DO 
BEGIN
  BEGIN
    ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN others THEN
      NULL;
  END;
END ;
