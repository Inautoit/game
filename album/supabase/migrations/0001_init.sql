-- Album digital de trading cards - esquema inicial
-- Catalogo (collections, series, teams, cards): lectura publica.
-- Datos de usuario (profiles, user_cards, community_sales): RLS estricto.

create extension if not exists "pgcrypto";

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  season text not null,
  publisher text,
  total_cards int not null default 0,
  released_at date,
  is_active boolean default true
);

create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references collections(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null,
  card_count int,
  scarcity int default 1,
  sort_order int default 0,
  requestable boolean default true,
  unique (collection_id, code)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references collections(id) on delete cascade,
  name text not null,
  slug text not null,
  primary_color text,
  secondary_color text,
  sort_order int default 0,
  unique (collection_id, slug)
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references collections(id) on delete cascade,
  series_id uuid references series(id),
  team_id uuid references teams(id),
  number text not null,
  player_name text,
  position text,
  variant text,
  print_run int,
  sort_order int not null,
  unique (collection_id, series_id, number)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  city text,
  postal_prefix text,
  created_at timestamptz default now()
);

create table if not exists user_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  card_id uuid references cards(id) on delete cascade,
  quantity int not null default 1,
  condition text default 'nm',
  photo_path text,
  for_trade boolean default false,
  acquired_price numeric(10,2),
  notes text,
  updated_at timestamptz default now(),
  unique (user_id, card_id, condition)
);

create table if not exists price_snapshots (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references cards(id) on delete cascade,
  source text not null,
  currency text default 'EUR',
  price_min numeric(10,2),
  price_median numeric(10,2),
  price_max numeric(10,2),
  sample_size int,
  listing_type text,
  source_url text,
  captured_at timestamptz default now()
);

create table if not exists community_sales (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references cards(id) on delete cascade,
  user_id uuid references profiles(id),
  price numeric(10,2) not null,
  platform text,
  condition text,
  sold_at date not null,
  verified boolean default false,
  created_at timestamptz default now()
);

create index if not exists user_cards_user_card_idx on user_cards (user_id, card_id);
create index if not exists cards_collection_sort_idx on cards (collection_id, sort_order);
create index if not exists price_snapshots_card_source_idx on price_snapshots (card_id, source, captured_at desc);
create index if not exists community_sales_card_sold_idx on community_sales (card_id, sold_at desc);

-- Progreso por serie
create or replace view v_user_progress as
select uc.user_id, c.collection_id, c.series_id,
       count(distinct c.id) filter (where uc.quantity > 0) as owned,
       count(distinct uc.id) filter (where uc.quantity > 1) as dupes
from cards c
left join user_cards uc on uc.card_id = c.id
group by uc.user_id, c.collection_id, c.series_id;

-- ---------------------------------------------------------------- RLS

alter table collections enable row level security;
alter table series      enable row level security;
alter table teams       enable row level security;
alter table cards       enable row level security;
alter table profiles    enable row level security;
alter table user_cards  enable row level security;
alter table price_snapshots enable row level security;
alter table community_sales enable row level security;

-- Catalogo: lectura publica, escritura solo con service role (que salta RLS)
drop policy if exists "catalogo legible" on collections;
create policy "catalogo legible" on collections for select using (true);
drop policy if exists "catalogo legible" on series;
create policy "catalogo legible" on series for select using (true);
drop policy if exists "catalogo legible" on teams;
create policy "catalogo legible" on teams for select using (true);
drop policy if exists "catalogo legible" on cards;
create policy "catalogo legible" on cards for select using (true);
drop policy if exists "precios legibles" on price_snapshots;
create policy "precios legibles" on price_snapshots for select using (true);

-- Perfiles: cada uno el suyo. El prefijo postal se comparte en fase de intercambios
-- mediante una vista/funcion dedicada, no abriendo esta tabla.
drop policy if exists "perfil propio: leer" on profiles;
create policy "perfil propio: leer" on profiles for select using (auth.uid() = id);
drop policy if exists "perfil propio: crear" on profiles;
create policy "perfil propio: crear" on profiles for insert with check (auth.uid() = id);
drop policy if exists "perfil propio: editar" on profiles;
create policy "perfil propio: editar" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Coleccion del usuario: solo suya
drop policy if exists "cartas propias" on user_cards;
create policy "cartas propias" on user_cards for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Ventas de la comunidad: todos leen, cada uno escribe las suyas
drop policy if exists "ventas legibles" on community_sales;
create policy "ventas legibles" on community_sales for select using (true);
drop policy if exists "ventas propias: crear" on community_sales;
create policy "ventas propias: crear" on community_sales for insert with check (auth.uid() = user_id);
drop policy if exists "ventas propias: editar" on community_sales;
create policy "ventas propias: editar" on community_sales for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ventas propias: borrar" on community_sales;
create policy "ventas propias: borrar" on community_sales for delete using (auth.uid() = user_id);

-- Alta automatica de perfil al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
