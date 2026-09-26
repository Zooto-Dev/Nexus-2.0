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
--   values ('<auth user ka UUID>', 'boss@company.com', 'superadmin');
create table if not exists public.nx_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email   text not null,
  role    text not null default 'user' check (role in ('superadmin', 'admin', 'manager', 'user'))
);

create or replace function public.nx_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from nx_profiles where user_id = auth.uid() and role in ('superadmin', 'admin', 'manager'));
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
grant execute on function public.nx_is_admin() to authenticated;  -- RLS policies ke liye zaroori
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
-- build 41: one row per item for approved POs, job cards, BOMs and gate-entry QC
create or replace view public.approved_po_lines with (security_invoker = true) as
select d.data->>'no' as po_no, d.data->>'date' as po_date, d.data->>'vendor' as vendor, d.data->>'expected' as expected_delivery,
  l.ord as sr, l.line->>'material' as item_code, m.data->>'name' as item_name, m.data->>'group' as category, m.data->>'hsn' as hsn,
  l.line->>'uom' as uom, l.line->>'brand' as brand, (l.line->>'rate')::numeric as rate, (l.line->>'gst')::numeric as gst_pct,
  (l.line->>'qty')::numeric as qty, (l.line->>'qty')::numeric * coalesce((l.line->>'rate')::numeric,0) as amount,
  (l.line->>'qty')::numeric * coalesce((l.line->>'rate')::numeric,0) * (1 + coalesce((l.line->>'gst')::numeric,0)/100) as total,
  coalesce((l.line->>'received')::numeric,0) as received, coalesce((l.line->>'rejected')::numeric,0) as rejected,
  greatest(0, (l.line->>'qty')::numeric - coalesce((l.line->>'received')::numeric,0)) as pending,
  l.line->>'remark' as remark, d.data->>'created_by' as created_by, d.data->>'approved_by' as approved_by,
  (d.data->>'approved_at')::timestamptz as approved_at
from nx_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'lines','[]'::jsonb)) with ordinality l(line, ord)
left join nx_docs m on m.collection = 'materials' and upper(m.data->>'code') = upper(l.line->>'material')
where d.collection = 'purchase_orders' and d.data->>'approval' = 'Approved' and coalesce((d.data->>'cancelled')::boolean,false) = false;

create or replace view public.job_card_lines with (security_invoker = true) as
select d.data->>'no' as jc_no, d.data->>'order_no' as order_no, d.data->>'brand' as brand, d.data->>'article' as article, d.data->>'colour' as colour,
  l.ord as sr, l.line->>'process' as process, l.line->>'section' as section, l.line->>'category' as category,
  l.line->>'material' as item_code, m.data->>'name' as item_name, l.line->>'uom' as uom, (l.line->>'norms')::numeric as norms,
  (l.line->>'required')::numeric as required_qty, l.line->>'supplier' as supplier, d.data->>'status' as jc_status
from nx_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'lines','[]'::jsonb)) with ordinality l(line, ord)
left join nx_docs m on m.collection = 'materials' and upper(m.data->>'code') = upper(l.line->>'material')
where d.collection = 'job_cards';

create or replace view public.bom_lines with (security_invoker = true) as
select d.data->>'brand' as brand, d.data->>'article' as article, d.data->>'style' as style, d.data->>'colour' as colour,
  (d.data->>'version')::int as version, l.ord as sr, l.line->>'process' as process, l.line->>'section' as section, l.line->>'category' as category,
  l.line->>'material' as item_code, m.data->>'name' as item_name, l.line->>'uom' as uom, (l.line->>'qty')::numeric as norms,
  (l.line->>'price')::numeric as price, (l.line->>'qty')::numeric * coalesce((l.line->>'price')::numeric,0) as cost,
  l.line->>'supplier' as supplier, l.line->>'remark' as remark
from nx_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'lines','[]'::jsonb)) with ordinality l(line, ord)
left join nx_docs m on m.collection = 'materials' and upper(m.data->>'code') = upper(l.line->>'material')
where d.collection = 'boms';

create or replace view public.gate_entry_qc with (security_invoker = true) as
select d.data->>'no' as inward_no, (d.data->>'at')::timestamptz as time_stamp, d.data->>'bill_type' as bill_type, d.data->>'vendor' as vendor,
  d.data->>'po_no' as po_no, d.data->>'bill_no' as invoice_no, d.data->>'bill_date' as invoice_date, (d.data->>'qty')::numeric as invoice_qty,
  d.data->>'status' as status, q.line->>'material' as item_code, q.line->>'category' as category, q.line->>'result' as qc_result,
  q.line->>'m_status' as merchant_decision, q.line->>'m_by' as merchant, q.line->>'m_note' as merchant_note
from nx_docs d
left join lateral jsonb_array_elements(coalesce(d.data->'qc','[]'::jsonb)) q(line) on true
where d.collection = 'inwards';

revoke all on public.approved_po_lines, public.job_card_lines, public.bom_lines, public.gate_entry_qc from anon, public;
grant select on public.approved_po_lines, public.job_card_lines, public.bom_lines, public.gate_entry_qc to authenticated;
