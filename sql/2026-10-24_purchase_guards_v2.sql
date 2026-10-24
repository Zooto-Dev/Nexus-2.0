-- Nexus 2.0 · database guards v2 (replaces v1 of the same day)
-- v2 change: the database stamps WHO did what from the login session itself (created_by, by, approved_by, excess_by …),
-- so a client cannot pass someone else's name or id to get round the "someone else must approve" rules.
-- GRN quantities are checked against the PO's real receipts in the database (row locked), not against the client's copy.
-- Super Admin (nx_profiles.role = 'superadmin') and server-side jobs (no auth.uid()) are exempt. Errors start with "NX:".

create or replace function public.nx_app_user() returns table (uid text, uname text)
language sql stable security definer set search_path = public as $$
  select d.data->>'id', d.data->>'name' from nx_docs d
  where d.collection = 'users'
    and lower(d.data->>'email') = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', ''))
  order by d.id limit 1
$$;
revoke all on function public.nx_app_user() from public, anon, authenticated;

create or replace function public.nx_doc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me_id text; me_name text;
  l jsonb; ol jsonb; i int; mp numeric; po jsonb; iw jsonb; pol jsonb; got numeric; pen numeric; inv numeric;
  strip text[] := array['received', 'rejected', 'closed', 'closed_qty', 'closed_by', 'closed_at', 'closed_why'];
  core text[] := array['lines', 'vendor', 'moq_log', 'expected', 'remarks'];
begin
  if auth.uid() is null or nx_is_superadmin() then return coalesce(new, old); end if;
  select uid, uname into me_id, me_name from nx_app_user();
  if me_id is null then raise exception 'NX: your login is not linked to a Nexus user'; end if;
  -- the app saves with UPSERT: for an existing row the INSERT trigger fires first and then the UPDATE trigger (which does the checks)
  if tg_op = 'INSERT' and exists (select 1 from nx_docs d where d.collection = new.collection and d.id = new.id) then return new; end if;

  if tg_op = 'DELETE' then
    if old.collection in ('purchase_orders', 'grns', 'inwards', 'issues') then raise exception 'NX: % cannot be deleted', old.collection; end if;
    if old.collection = 'opening_stock' and (coalesce(old.data->>'status', '') <> 'Pending' or coalesce(old.data->>'by_id', '') <> me_id) then raise exception 'NX: only your own pending opening stock entry can be withdrawn'; end if;
    return old;
  end if;

  -- every new record carries the real author
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_build_object('by_id', me_id);
    if new.collection = 'purchase_orders' then new.data := new.data || jsonb_build_object('created_by_id', me_id, 'created_by', me_name);
    else new.data := new.data || jsonb_build_object('by', me_name); end if;
  else
    -- authorship never changes afterwards
    new.data := new.data || jsonb_build_object('by_id', old.data->'by_id');
    if old.data ? 'created_by_id' then new.data := new.data || jsonb_build_object('created_by_id', old.data->'created_by_id', 'created_by', old.data->'created_by'); end if;
    if old.data ? 'amended_by_id' then new.data := new.data || jsonb_build_object('amended_by_id', old.data->'amended_by_id', 'amended_by', old.data->'amended_by'); end if;
    if new.collection <> 'purchase_orders' then new.data := new.data || jsonb_build_object('by', old.data->'by'); end if;
  end if;

  -- ---------- purchase orders ----------
  if new.collection = 'purchase_orders' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'approval', '') <> 'Pending' then raise exception 'NX: a new PO must wait for approval'; end if;
      if coalesce(new.data->>'cancelled', 'false') = 'true' then raise exception 'NX: a new PO cannot be cancelled'; end if;
      new.data := new.data - 'approved_by' - 'approved_by_id' - 'approved_at';
    else
      if old.data->>'approval' = 'Approved' and new.data->>'approval' is distinct from 'Approved' then raise exception 'NX: an approved PO cannot change its approval'; end if;
      if old.data->>'approval' = 'Rejected' and new.data->>'approval' is distinct from 'Rejected' then raise exception 'NX: a rejected PO cannot be reused'; end if;
      if coalesce(old.data->>'cancelled', 'false') = 'true' and coalesce(new.data->>'cancelled', 'false') <> 'true' then raise exception 'NX: a cancelled PO cannot be revived'; end if;
      if coalesce(old.data->>'cancelled', 'false') <> 'true' and coalesce(new.data->>'cancelled', 'false') = 'true' then
        if coalesce(new.data->>'cancel_reason', '') = '' then raise exception 'NX: a reason is needed to cancel a PO'; end if;
        if exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'po_id' = new.id) then raise exception 'NX: a PO with receipts cannot be cancelled'; end if;
        new.data := new.data || jsonb_build_object('cancelled_by', me_name, 'cancelled_by_id', me_id);
      end if;
      if old.data->>'approval' = 'Approved' then
        if new.data->>'vendor' is distinct from old.data->>'vendor' then raise exception 'NX: the vendor of an approved PO cannot change'; end if;
        if jsonb_array_length(coalesce(new.data->'lines', '[]')) <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: the lines of an approved PO cannot change'; end if;
        for i in 0 .. jsonb_array_length(coalesce(old.data->'lines', '[]')) - 1 loop
          if (old.data->'lines'->i) - strip is distinct from (new.data->'lines'->i) - strip then raise exception 'NX: the lines of an approved PO cannot change'; end if;
        end loop;
      else
        -- any change to what is ordered counts as an amendment by the person who made it
        for i in 1 .. array_length(core, 1) loop
          if new.data->core[i] is distinct from old.data->core[i] then new.data := new.data || jsonb_build_object('amended_by_id', me_id, 'amended_by', me_name); exit; end if;
        end loop;
      end if;
      if old.data->>'approval' is distinct from 'Approved' and new.data->>'approval' = 'Approved' then
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
        if new.data->>'created_by_id' = me_id or new.data->>'amended_by_id' = me_id then raise exception 'NX: you raised or amended this PO — someone else must approve it'; end if;
        if jsonb_array_length(coalesce(new.data->'moq_log', '[]')) > 0 then raise exception 'NX: a PO above the requirement (MOQ) is approved only by the Super Admin'; end if;
        if jsonb_array_length(coalesce(new.data->'lines', '[]')) = 0 then raise exception 'NX: a PO needs at least one line'; end if;
        for l in select * from jsonb_array_elements(coalesce(new.data->'lines', '[]')) loop
          if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'NX: % qty must be above 0', l->>'material'; end if;
          select (d.data->>'price')::numeric into mp from nx_docs d where d.collection = 'materials' and upper(d.data->>'code') = upper(l->>'material') limit 1;
          if coalesce(mp, 0) <= 0 then raise exception 'NX: % has no approved price', l->>'material'; end if;
          if abs(coalesce((l->>'rate')::numeric, 0) - mp) > 0.000001 then raise exception 'NX: % rate differs from the approved item price', l->>'material'; end if;
        end loop;
      end if;
      if old.data->>'approval' is distinct from 'Rejected' and new.data->>'approval' = 'Rejected' then new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id); end if;
    end if;
  end if;

  -- ---------- GRNs ----------
  if new.collection = 'grns' then
    if jsonb_typeof(new.data->'lines') is distinct from 'array' then raise exception 'NX: GRN lines are missing'; end if;
    for l in select * from jsonb_array_elements(new.data->'lines') loop
      if coalesce((l->>'accepted')::numeric, 0) < 0 or coalesce((l->>'rejected')::numeric, 0) < 0 or coalesce((l->>'excess')::numeric, 0) < 0 or coalesce((l->>'short')::numeric, 0) < 0 then raise exception 'NX: a GRN qty cannot be negative'; end if;
    end loop;
    if tg_op = 'INSERT' then
      if exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'inward_id' = new.data->>'inward_id') then raise exception 'NX: this invoice already has a GRN'; end if;
      select d.data into iw from nx_docs d where d.collection = 'inwards' and d.id = new.data->>'inward_id' for update;
      if iw is null or iw->>'status' <> 'Pending GRN' or iw->>'inv_status' <> 'Approved' then raise exception 'NX: the gate entry is not ready for GRN'; end if;
      select d.data into po from nx_docs d where d.collection = 'purchase_orders' and d.id = new.data->>'po_id' for update;   -- locks the PO: two GRNs at once are checked one after the other
      if po is null or po->>'approval' <> 'Approved' or coalesce(po->>'cancelled', 'false') = 'true' or lower(po->>'no') <> lower(iw->>'po_no') or lower(po->>'vendor') <> lower(iw->>'vendor') then raise exception 'NX: the PO is not an open approved PO of this gate entry'; end if;
      for l in select * from jsonb_array_elements(new.data->'lines') loop
        if coalesce(l->>'excess_status', '') not in ('', 'Pending') then raise exception 'NX: excess is approved only after the GRN is saved'; end if;
        if coalesce((l->>'excess')::numeric, 0) > 0 and coalesce(l->>'excess_status', '') <> 'Pending' then raise exception 'NX: excess must wait for approval'; end if;
        pol := po->'lines'->((l->>'po_line')::int);
        if pol is null or upper(pol->>'material') <> upper(l->>'material') then raise exception 'NX: % is not on PO %', l->>'material', po->>'no'; end if;
        -- received so far = what earlier GRNs of this PO recorded for this line (never the client's copy)
        select coalesce(sum(coalesce((x->>'accepted')::numeric, 0) + coalesce((x->>'rejected')::numeric, 0)), 0) into got
          from nx_docs g, jsonb_array_elements(g.data->'lines') x
          where g.collection = 'grns' and g.data->>'po_id' = po->>'id' and (x->>'po_line')::int = (l->>'po_line')::int;
        pen := greatest(0, coalesce((pol->>'qty')::numeric, 0) - got);
        if coalesce(pol->>'closed', 'false') = 'true' then pen := 0; end if;
        if coalesce((l->>'accepted')::numeric, 0) + coalesce((l->>'rejected')::numeric, 0) > pen + 0.000001 then raise exception 'NX: % — only % pending on the PO; the rest must go to excess', l->>'material', pen; end if;
        -- item-wise invoice qty fixed at the gate: the GRN line must add up to it
        select x into inv from (select (x->>'inv_qty')::numeric from jsonb_array_elements(coalesce(iw->'lines', '[]')) x where (x->>'po_line')::int = (l->>'po_line')::int limit 1) s(x);
        if inv is not null and abs(coalesce((l->>'accepted')::numeric, 0) + coalesce((l->>'rejected')::numeric, 0) + coalesce((l->>'short')::numeric, 0) + coalesce((l->>'excess')::numeric, 0) - coalesce((l->>'over_inv')::numeric, 0) - inv) > 0.000001 then raise exception 'NX: % does not add up to the invoice qty %', l->>'material', inv; end if;
      end loop;
    else
      if jsonb_array_length(new.data->'lines') <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: GRN lines cannot be added or removed'; end if;
      for i in 0 .. jsonb_array_length(old.data->'lines') - 1 loop
        ol := old.data->'lines'->i; l := new.data->'lines'->i;
        if coalesce((l->>'accepted')::numeric, 0) <> coalesce((ol->>'accepted')::numeric, 0) then raise exception 'NX: the accepted qty of a GRN cannot change'; end if;
        if abs(coalesce((l->>'rejected')::numeric, 0) + coalesce((l->>'excess')::numeric, 0) - coalesce((ol->>'rejected')::numeric, 0) - coalesce((ol->>'excess')::numeric, 0)) > 0.000001 then raise exception 'NX: GRN qty can only move between excess and rejected'; end if;
        if l->>'excess_status' is distinct from ol->>'excess_status' then
          if coalesce(ol->>'excess_status', '') not in ('Pending', 'Amend') or coalesce(l->>'excess_status', '') not in ('Approved', 'Rejected', 'Amend', 'Pending') then raise exception 'NX: excess is decided only while pending'; end if;
          if l->>'excess_status' in ('Approved', 'Rejected') then
            if new.data->>'by_id' = me_id then raise exception 'NX: the person who made the GRN cannot decide its excess'; end if;
            new.data := jsonb_set(new.data, array['lines', i::text, 'excess_by'], to_jsonb(me_name));
          end if;
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
      select d.data into po from nx_docs d where d.collection = 'purchase_orders' and lower(d.data->>'no') = lower(new.data->>'po_no') limit 1;
      if po is null or po->>'approval' <> 'Approved' or coalesce(po->>'cancelled', 'false') = 'true' or lower(po->>'vendor') <> lower(new.data->>'vendor') then raise exception 'NX: % is not an open approved PO of %', new.data->>'po_no', new.data->>'vendor'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'inwards' and lower(d.data->>'po_no') = lower(new.data->>'po_no') and d.data->>'status' = 'Pending GRN') then raise exception 'NX: this PO already has a gate entry waiting for GRN'; end if;
      new.data := new.data - 'inv_by' - 'inv_at';
    else
      if old.data->>'inv_status' is distinct from 'Approved' and new.data->>'inv_status' = 'Approved' then
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who made the gate entry cannot approve its invoice'; end if;
        new.data := new.data || jsonb_build_object('inv_by', me_name, 'inv_by_id', me_id);
      end if;
      if old.data->>'status' = 'GRN Done' and (new.data->'lines' is distinct from old.data->'lines' or new.data->>'qty' is distinct from old.data->>'qty' or new.data->>'status' is distinct from 'GRN Done') then raise exception 'NX: a gate entry with a GRN cannot change'; end if;
      if old.data->>'status' is distinct from 'GRN Done' and new.data->>'status' = 'GRN Done' and not exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'inward_id' = new.id) then raise exception 'NX: no GRN exists for this gate entry'; end if;
    end if;
  end if;

  -- ---------- opening stock ----------
  if new.collection = 'opening_stock' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock waits for approval'; end if;
      if coalesce((new.data->>'qty')::numeric, 0) <= 0 then raise exception 'NX: opening stock qty must be above 0'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'opening_stock' and upper(d.data->>'material') = upper(new.data->>'material') and coalesce(d.data->>'status', '') <> 'Rejected') then raise exception 'NX: % already has opening stock', new.data->>'material'; end if;
      new.data := new.data - 'approved_by' - 'approved_at';
    else
      if old.data->>'status' is distinct from new.data->>'status' then
        if coalesce(old.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock is decided only while pending'; end if;
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who entered opening stock cannot approve it'; end if;
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
      end if;
      if old.data->>'status' <> 'Pending' and (new.data->'qty' is distinct from old.data->'qty' or new.data->'material' is distinct from old.data->'material' or new.data->'rate' is distinct from old.data->'rate') then raise exception 'NX: decided opening stock cannot change'; end if;
    end if;
  end if;

  -- ---------- issues, returns, line rejections, write-offs ----------
  if new.collection = 'issues' then
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') = 'Approved' then raise exception 'NX: an issue waits for approval'; end if;
      if coalesce((new.data->>'qty')::numeric, 0) <= 0 then raise exception 'NX: issue qty must be above 0'; end if;
      new.data := new.data - 'approved_by' - 'approved_at';
    else
      if old.data->>'status' is distinct from 'Approved' and new.data->>'status' = 'Approved' then
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who entered this cannot approve it'; end if;
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
      end if;
      if old.data->>'status' = 'Approved' and (new.data->'qty' is distinct from old.data->'qty' or new.data->'material' is distinct from old.data->'material' or new.data->'type' is distinct from old.data->'type' or new.data->'to_jc' is distinct from old.data->'to_jc' or new.data->>'status' is distinct from 'Approved') then raise exception 'NX: an approved issue cannot change'; end if;
      if coalesce((new.data->>'qty')::numeric, 0) > coalesce((old.data->>'qty')::numeric, 0) + 0.000001 and old.data->>'status' <> 'Amend' then raise exception 'NX: an issue qty can only be reduced at approval'; end if;
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
