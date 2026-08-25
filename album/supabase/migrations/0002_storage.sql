-- Fotos de cartas del usuario. Ruta: <user_id>/<card_id>-<condition>.webp
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do nothing;

drop policy if exists "fotos: leer" on storage.objects;
create policy "fotos: leer" on storage.objects for select
  using (bucket_id = 'card-photos');

drop policy if exists "fotos: subir las propias" on storage.objects;
create policy "fotos: subir las propias" on storage.objects for insert
  with check (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: actualizar las propias" on storage.objects;
create policy "fotos: actualizar las propias" on storage.objects for update
  using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: borrar las propias" on storage.objects;
create policy "fotos: borrar las propias" on storage.objects for delete
  using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);
