-- =========================================================
-- Zartizan — ajout des rôles (admin / artisan)
-- À exécuter UNE FOIS dans Supabase > SQL Editor > New query > Run
--
-- Admin   : voit et modifie tout, gère l'équipe, répartit les demandes
-- Artisan : ne voit que les demandes qui lui sont attribuées
--           (+ celles qu'il a créées et pas encore attribuées)
-- =========================================================

-- 1) Colonne rôle
alter table public.artisans add column if not exists role text not null default 'artisan';

-- 2) Le premier membre créé (toi) devient admin
update public.artisans set role = 'admin'
where id = (select id from public.artisans order by created_at asc limit 1);

-- 3) Fonctions d'identification
create or replace function public.my_artisan_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.artisans
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.artisans
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'admin'
  );
$$;

-- 4) Équipe : tout membre voit la liste (pour pouvoir recommander un collègue),
--    seul l'admin ajoute / modifie / retire
drop policy if exists "membres artisans" on public.artisans;
drop policy if exists "artisans lecture" on public.artisans;
drop policy if exists "artisans ecriture admin" on public.artisans;
create policy "artisans lecture" on public.artisans
  for select to authenticated using (public.is_member());
create policy "artisans ecriture admin" on public.artisans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) Demandes
drop policy if exists "membres demandes" on public.demandes;
drop policy if exists "demandes lecture" on public.demandes;
drop policy if exists "demandes creation" on public.demandes;
drop policy if exists "demandes modification" on public.demandes;
drop policy if exists "demandes suppression" on public.demandes;

-- Lecture : admin = tout ; artisan = ses demandes (+ celles qu'il a créées sans les attribuer)
create policy "demandes lecture" on public.demandes
  for select to authenticated using (
    public.is_admin()
    or artisan_id = public.my_artisan_id()
    or (artisan_id is null and cree_par = public.my_artisan_id())
  );

-- Création : tout membre (ex. recommander un client à un collègue)
create policy "demandes creation" on public.demandes
  for insert to authenticated with check (public.is_member());

-- Modification : admin = tout ; artisan = ses demandes (il peut les confier à un collègue)
create policy "demandes modification" on public.demandes
  for update to authenticated
  using (public.is_admin() or artisan_id = public.my_artisan_id())
  with check (public.is_member());

-- Suppression : admin uniquement
create policy "demandes suppression" on public.demandes
  for delete to authenticated using (public.is_admin());
