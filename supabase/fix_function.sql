ALTER FUNCTION public.import_video_batch(uuid, jsonb) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.import_video_batch(uuid, jsonb) TO service_role;
