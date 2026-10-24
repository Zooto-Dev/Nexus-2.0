-- Nexus 2.0 · database guards for purchasing and receiving (applied 2026-10-24)
-- Every rule the app enforces on screen is enforced here too, so a direct write to the database cannot get round it.
-- The Super Admin (nx_profiles.role = 'superadmin') and server-side jobs (no auth.uid()) are exempt.
-- Errors start with "NX:" — the app shows them and does not retry the write.

create or replace function public.nx_app_user_id() returns text
language sql stable security definer set search_path = public as $$
  select d.data->>'id' from nx_docs d
  where d.collection = 'users'
    and lower(d.data->>'email') = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', ''))
  limit 1
$$;
revoke all on function public.nx_app_user_id() from public, anon, authenticated;

create or replace function public.nx_doc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text := nx_app_user_id();
  l jsonb; ol jsonb; i int; mp numeric; k text;
  strip text[] := array['received', 'rejected', 'closed', 'closed_qty', 'closed_by', 'closed_at', 'closed_why'];
begin
  if auth.uid() is null or nx_is_superadmin() then return coalesce(new, old); end if;
  -- the app saves with UPSERT: for an existing row the INSERT trigger fires first and then the UPDATE trigger (which does the checks)
  if tg_op = 'INSERT' and exists (select 1 from nx_docs d where d.collection = new.collection and d.id = new.id) then return new; end if;

  -- ---------- deletes: only the Super Admin (a pending opening-stock entry may be withdrawn) ----------
  if tg_op = 'DELETE' then
    if old.collection in ('purchase_orders', 'grns', 'inwards', 'issues') then raise exception 'NX: % cannot be deleted', old.collection; end if;
    if old.collection = 'opening_stock' and coalesce(old.data->>'status', '') <> 'Pending' then raise exception 'NX: an approved opening stock entry cannot be deleted'; end if;
    return old;
  end if;

  -- ---------- purchase orders ----------
  if new.collection = 'purchase_orders' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'approval', '') <> 'Pending' then raise exception 'NX: a new PO must wait for approval'; end if;
      if coalesce(new.data->>'cancelled', 'false') = 'true' then raise exception 'NX: a new PO cannot be cancelled'; end if;
      if me is not null and coalesce(new.data->>'created_by_id', '') <> '' and new.data->>'created_by_id' <> me then raise exception 'NX: a PO is raised in your own name'; end if;
    else
      if old.data->>'approval' = 'Approved' and new.data->>'approval' is distinct from 'Approved' then raise exception 'NX: an approved PO cannot change its approval'; end if;
      if old.data->>'approval' = 'Rejected' and new.data->>'approval' is distinct from 'Rejected' then raise exception 'NX: a rejected PO cannot be reused'; end if;
      if coalesce(old.data->>'cancelled', 'false') = 'true' and coalesce(new.data->>'cancelled', 'false') <> 'true' then raise exception 'NX: a cancelled PO cannot be revived'; end if;
      if coalesce(old.data->>'cancelled', 'false') <> 'true' and coalesce(new.data->>'cancelled', 'false') = 'true' and coalesce(new.data->>'cancel_reason', '') = '' then raise exception 'NX: a reason is needed to cancel a PO'; end if;
      if old.data->>'approval' = 'Approved' then
        if new.data->>'vendor' is distinct from old.data->>'vendor' then raise exception 'NX: the vendor of an approved PO cannot change'; end if;
        if jsonb_array_length(coalesce(new.data->'lines', '[]')) <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: the lines of an approved PO cannot change'; end if;
        for i in 0 .. jsonb_array_length(coalesce(old.data->'lines', '[]')) - 1 loop
          if (old.data->'lines'->i) - strip is distinct from (new.data->'lines'->i) - strip then raise exception 'NX: the lines of an approved PO cannot change'; end if;
        end loop;
      end if;
      if old.data->>'approval' is distinct from 'Approved' and new.data->>'approval' = 'Approved' then
        if coalesce(new.data->>'approved_by', '') = '' then raise exception 'NX: approved_by is missing'; end if;
        if me is not null and (new.data->>'created_by_id' = me or new.data->>'amended_by_id' = me) then raise exception 'NX: you raised or amended this PO — someone else must approve it'; end if;
        if jsonb_array_length(coalesce(new.data->'moq_log', '[]')) > 0 then raise exception 'NX: a PO above the requirement (MOQ) is approved only by the Super Admin'; end if;
        for l in select * from jsonb_array_elements(coalesce(new.data->'lines', '[]')) loop
          select (d.data->>'price')::numeric into mp from nx_docs d where d.collection = 'materials' and upper(d.data->>'code') = upper(l->>'material') limit 1;
          if coalesce(mp, 0) <= 0 then raise exception 'NX: % has no approved price', l->>'material'; end if;
          if abs(coalesce((l->>'rate')::numeric, 0) - mp) > 0.000001 then raise exception 'NX: % rate differs from the approved item price', l->>'material'; end if;
        end loop;
      end if;
    end if;
  end if;

  -- ---------- GRNs ----------
  if new.collection = 'grns' then
    for l in select * from jsonb_array_elements(coalesce(new.data->'lines', '[]')) loop
      if coalesce((l->>'accepted')::numeric, 0) < 0 or coalesce((l->>'rejected')::numeric, 0) < 0 or coalesce((l->>'excess')::numeric, 0) < 0 or coalesce((l->>'short')::numeric, 0) < 0 then raise exception 'NX: a GRN qty cannot be negative'; end if;
    end loop;
    if tg_op = 'INSERT' then
      if exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'inward_id' = new.data->>'inward_id') then raise exception 'NX: this invoice already has a GRN'; end if;
      for l in select * from jsonb_array_elements(coalesce(new.data->'lines', '[]')) loop
        if coalesce(l->>'excess_status', '') not in ('', 'Pending') then raise exception 'NX: excess is approved only after the GRN is saved'; end if;
      end loop;
    else
      if jsonb_array_length(coalesce(new.data->'lines', '[]')) <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: GRN lines cannot be added or removed'; end if;
      for i in 0 .. jsonb_array_length(coalesce(old.data->'lines', '[]')) - 1 loop
        ol := old.data->'lines'->i; l := new.data->'lines'->i;
        if coalesce((l->>'accepted')::numeric, 0) <> coalesce((ol->>'accepted')::numeric, 0) then raise exception 'NX: the accepted qty of a GRN cannot change'; end if;
        if abs(coalesce((l->>'rejected')::numeric, 0) + coalesce((l->>'excess')::numeric, 0) - coalesce((ol->>'rejected')::numeric, 0) - coalesce((ol->>'excess')::numeric, 0)) > 0.000001 then raise exception 'NX: GRN qty can only move between excess and rejected'; end if;
        if l->>'excess_status' is distinct from ol->>'excess_status' and l->>'excess_status' in ('Approved', 'Rejected') then
          if coalesce(ol->>'excess_status', '') <> 'Pending' then raise exception 'NX: excess is decided only while pending'; end if;
          if coalesce(l->>'excess_by', '') = '' or l->>'excess_by' = new.data->>'by' then raise exception 'NX: the person who made the GRN cannot decide its excess'; end if;
        end if;
      end loop;
    end if;
  end if;

  -- ---------- gate entries (inwards) ----------
  if new.collection = 'inwards' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') <> 'Pending GRN' or coalesce(new.data->>'inv_status', '') <> '' then raise exception 'NX: a new gate entry waits for invoice approval'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'inwards' and lower(d.data->>'vendor') = lower(new.data->>'vendor')
                 and regexp_replace(lower(coalesce(d.data->>'bill_no', '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(new.data->>'bill_no', '')), '[^a-z0-9]', '', 'g')
                 and coalesce(d.data->>'inv_status', '') <> 'Rejected') then raise exception 'NX: this vendor already has this invoice number'; end if;
    else
      if old.data->>'inv_status' is distinct from 'Approved' and new.data->>'inv_status' = 'Approved' and (coalesce(new.data->>'inv_by', '') = '' or new.data->>'inv_by' = new.data->>'by') then raise exception 'NX: the person who made the gate entry cannot approve its invoice'; end if;
      if old.data->>'status' = 'GRN Done' and (new.data->'lines' is distinct from old.data->'lines' or new.data->>'qty' is distinct from old.data->>'qty') then raise exception 'NX: a gate entry with a GRN cannot change its quantities'; end if;
    end if;
  end if;

  -- ---------- opening stock ----------
  if new.collection = 'opening_stock' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock waits for approval'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'opening_stock' and upper(d.data->>'material') = upper(new.data->>'material') and coalesce(d.data->>'status', '') <> 'Rejected') then raise exception 'NX: % already has opening stock', new.data->>'material'; end if;
    else
      if old.data->>'status' is distinct from new.data->>'status' then
        if coalesce(old.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock is decided only while pending'; end if;
        if new.data->>'status' = 'Approved' and (coalesce(new.data->>'approved_by', '') = '' or new.data->>'approved_by' = new.data->>'by') then raise exception 'NX: the person who entered opening stock cannot approve it'; end if;
      end if;
      if old.data->>'status' = 'Approved' and (new.data->'qty' is distinct from old.data->'qty' or new.data->'material' is distinct from old.data->'material') then raise exception 'NX: approved opening stock cannot change'; end if;
    end if;
  end if;

  -- ---------- issues, returns, line rejections, write-offs ----------
  if new.collection = 'issues' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') = 'Approved' then raise exception 'NX: an issue waits for approval'; end if;
    else
      if old.data->>'status' is distinct from 'Approved' and new.data->>'status' = 'Approved' then
        if coalesce(new.data->>'approved_by', '') = '' or new.data->>'approved_by' = new.data->>'by' then raise exception 'NX: the person who entered this cannot approve it'; end if;
      end if;
      if old.data->>'status' = 'Approved' and (new.data->'qty' is distinct from old.data->'qty' or new.data->'material' is distinct from old.data->'material' or new.data->>'status' is distinct from 'Approved') then raise exception 'NX: an approved issue cannot change'; end if;
    end if;
  end if;

  return new;
end $$;
revoke all on function public.nx_doc_guard() from public, anon, authenticated;

drop trigger if exists nx_docs_guard on public.nx_docs;
drop trigger if exists nx_docs_guard_del on public.nx_docs;
create trigger nx_docs_guard before insert or update on public.nx_docs
  for each row when (new.collection in ('purchase_orders', 'grns', 'inwards', 'opening_stock', 'issues'))
  execute function public.nx_doc_guard();
create trigger nx_docs_guard_del before delete on public.nx_docs
  for each row when (old.collection in ('purchase_orders', 'grns', 'inwards', 'opening_stock', 'issues'))
  execute function public.nx_doc_guard();
