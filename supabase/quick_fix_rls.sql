create policy if not exists "Catalogue videos are publicly readable" on public.catalogue_videos for select using (true);
create policy if not exists "Service role can manage catalogue videos" on public.catalogue_videos for all using (auth.role()='service_role') with check (auth.role()='service_role');
create policy if not exists "Service role can manage video import batches" on public.video_import_batches for all using (auth.role()='service_role') with check (auth.role()='service_role');
