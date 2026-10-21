drop policy if exists "Catalogue videos are publicly readable" on public.catalogue_videos;
create policy "Catalogue videos are publicly readable" on public.catalogue_videos for select using (true);
drop policy if exists "Service role can manage catalogue videos" on public.catalogue_videos;
create policy "Service role can manage catalogue videos" on public.catalogue_videos for all using (auth.role()='service_role') with check (auth.role()='service_role');
drop policy if exists "Service role can manage video import batches" on public.video_import_batches;
create policy "Service role can manage video import batches" on public.video_import_batches for all using (auth.role()='service_role') with check (auth.role()='service_role');
