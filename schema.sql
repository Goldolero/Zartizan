-- =========================================================
-- Zartizan — schéma de base de données (Supabase / Postgres)
-- À coller dans Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) Membres du collectif (seuls les emails listés ici ont accès aux données)
create table if not exists public.artisans (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  metier      text,
  tel         text,
  zone        text,
  couleur     text,
  email       text not null unique,
  role        text not null default 'artisan',   -- 'admin' ou 'artisan'
  created_at  timestamptz not null default now()
);

-- 2) Demandes clients
create table if not exists public.demandes (
  id           uuid primary key default gen_random_uuid(),
  client       text not null,
  tel          text,
  commune      text,
  adresse      text,
  metier       text,
  urgence      text default 'normale',
  description  text,
  source       text,
  artisan_id   uuid references public.artisans(id) on delete set null,
  statut       text not null default 'nouvelle',
  rdv          text default '',          -- format AAAA-MM-JJTHH:MM (heure de La Réunion)
  montant      numeric,
  rappel_date  text default '',          -- format AAAA-MM-JJ
  rappel_fait  boolean default false,
  origine_id   uuid,
  cree_par     uuid,
  historique   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists demandes_statut_idx  on public.demandes (statut);
create index if not exists demandes_artisan_idx on public.demandes (artisan_id);

-- 3) Qui est membre ? (l'email de connexion doit être dans la table artisans)
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.artisans
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 4) Sécurité : rien n'est visible ni modifiable sans être membre
alter table public.artisans enable row level security;
alter table public.demandes enable row level security;

drop policy if exists "membres artisans" on public.artisans;
create policy "membres artisans" on public.artisans
  for all to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists "membres demandes" on public.demandes;
create policy "membres demandes" on public.demandes
  for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- 5) Mises à jour en temps réel entre les téléphones
do $$ begin
  begin alter publication supabase_realtime add table public.artisans; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.demandes; exception when duplicate_object then null; end;
end $$;

-- 6) PREMIER MEMBRE : remplace par TON nom et TON email, puis exécute.
--    Ensuite tu ajouteras les autres artisans depuis l'onglet « Équipe » de l'appli.
insert into public.artisans (nom, metier, email, couleur, role)
values ('Maxime', 'Entretien chauffe-eau', 'TON-EMAIL@exemple.com', '#0f766e', 'admin')
on conflict (email) do nothing;

-- 7) Rôles et droits (admin voit tout, artisan voit ses demandes) : exécuter aussi migration-roles.sql
