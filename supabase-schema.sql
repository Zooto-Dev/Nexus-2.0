-- ============================================================================
-- Nexus 2.0 — Supabase setup (run once in Supabase -> SQL Editor)
-- SECURITY MODEL
--   * Sirf logged-in (Supabase Auth) users hi data padh/likh sakte hain.
--     anon/publishable key akele se KUCH BHI nahi milta (RLS deny-by-default).
--   * 'audit' log INSERT-only hai — koi update/delete nahi, admin bhi nahi.
--   * Sensitive collections (users, roles, settings, processes) sirf admin/manager
--     profile wale user hi likh sakte hain (nx_profiles table se check hota hai).
--   * service_role key KABHI browser/app/repo mein mat daalo. Sirf publishable
--     (anon) key config.js mein jaati hai — wo public hone ke liye hi bani hai.
--   * Dashboard -> Authentication -> Sign In / Up mein "Allow new users to sign up"
--     BAND kar do. Users sirf admin banayega (Invite user).
-- ============================================================================

-- App data: one row per record of one collection.
create table if not exists public.nx_docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists nx_docs_updated_idx on public.nx_docs (updated_at desc);

-- Who is admin/manager (server-side truth for sensitive writes).
-- Admin khud SQL editor / Table editor se yahan row daalta hai:
--   insert into nx_profiles (user_id, email, role)
--   values ('<auth user ka UUID>', 'boss@company.com', 'admin');
create table if not exists public.nx_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email   text not null,
  role    text not null default 'user' check (role in ('admin', 'manager', 'user'))
);

create or replace function public.nx_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from nx_profiles where user_id = auth.uid() and role in ('admin', 'manager'));
$$;

alter table public.nx_docs enable row level security;
alter table public.nx_profiles enable row level security;

-- profiles: har logged-in user apni row dekh sakta hai; likh sirf service_role/SQL se.
drop policy if exists "profile self read" on public.nx_profiles;
create policy "profile self read" on public.nx_profiles for select to authenticated using (user_id = auth.uid());

-- nx_docs policies
drop policy if exists "nx read"   on public.nx_docs;
drop policy if exists "nx insert" on public.nx_docs;
drop policy if exists "nx update" on public.nx_docs;
drop policy if exists "nx delete" on public.nx_docs;

create policy "nx read" on public.nx_docs for select to authenticated using (true);

-- INSERT: sab authenticated; par sensitive collections sirf admin/manager.
create policy "nx insert" on public.nx_docs for insert to authenticated
  with check (
    collection not in ('users', 'roles', 'settings', 'processes') or public.nx_is_admin()
  );

-- UPDATE: audit kabhi nahi; sensitive sirf admin/manager.
create policy "nx update" on public.nx_docs for update to authenticated
  using (collection <> 'audit')
  with check (
    collection <> 'audit'
    and (collection not in ('users', 'roles', 'settings', 'processes') or public.nx_is_admin())
  );

-- DELETE: audit kabhi nahi; sensitive sirf admin/manager.
create policy "nx delete" on public.nx_docs for delete to authenticated
  using (
    collection <> 'audit'
    and (collection not in ('users', 'roles', 'settings', 'processes') or public.nx_is_admin())
  );

-- Data API exposure ("Automatically expose new tables" OFF hai, isliye explicit grant):
-- sirf in do tables ko API roles dikhengi; RLS upar se access control karti hai.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.nx_docs to authenticated;
grant select on public.nx_profiles to authenticated;
-- anon role ko koi table grant NAHI — bina login kuch nahi khulta.

-- Live updates for every open screen.
do $$ begin
  alter publication supabase_realtime add table public.nx_docs;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- SETUP CHECKLIST (dashboard mein, schema ke baad):
-- 1. Authentication -> Sign In / Up -> "Allow new users to sign up" = OFF
-- 2. Authentication -> Users -> apne staff ke emails Invite/Create karo
-- 3. Har admin/manager ke liye nx_profiles mein row daalo (upar ka insert)
-- 4. config.js mein sirf Project URL + PUBLISHABLE key bharo (service_role NAHI)
-- ============================================================================
