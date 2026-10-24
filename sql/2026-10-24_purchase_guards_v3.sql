-- Nexus 2.0 · database guards v3 (replaces v1/v2 of the same day)
-- What the database itself enforces, whatever the client sends:
--   * WHO: author / approver names and ids are stamped from the login session (nx_profiles → users doc), never trusted from the client
--   * PO: waits for approval; approver ≠ raiser/amender; MOQ over-order only Super Admin; rate = approved price; approved lines frozen;
--         received/rejected on a line = exactly what its GRNs record; short close needs a reason; cancel needs a reason and no receipts
--   * GRN: only for an approved gate entry of an open approved PO of that vendor; qty maths fixed (invoice / received / PO pending);
--          never negative or NaN; one GRN per gate entry; excess decided by someone else; accepted never changes
--   * Gate entry: one per PO at a time; invoice no. unique per vendor; frozen once the invoice is approved; approver ≠ maker
--   * Opening stock / issues / returns / line rejections / write-offs: wait for approval by someone else; return ≤ issued; write-off ≤ rejection stock
--   * RTV ≤ rejected stock; materials code unique; users email unique and only Super Admin changes it; audit user stamped
-- Super Admin (nx_profiles.role = 'superadmin') and server-side jobs (no auth.uid()) are exempt. Errors start with "NX:".

create or replace function public.nx_is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from nx_profiles where user_id = auth.uid() and role = 'superadmin'); $$;

-- a number from jsonb that is never NaN / Infinity / text
create or replace function public.nx_num(v jsonb, what text) returns numeric
language plpgsql immutable as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'number' then n := (v#>>'{}')::numeric;
  elsif jsonb_typeof(v) = 'string' and (v#>>'{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then n := (v#>>'{}')::numeric;
  elsif jsonb_typeof(v) = 'string' and btrim(v#>>'{}') = '' then return 0;
  else raise exception 'NX: % is not a number', what; end if;
  if n <> n or n = 'Infinity'::numeric or n = '-Infinity'::numeric then raise exception 'NX: % is not a number', what; end if;
  return n;
end $$;

-- the Nexus user behind this login: email from nx_profiles (written only by the user-admin function), then the users doc
create or replace function public.nx_app_user() returns table (uid text, uname text)
language plpgsql stable security definer set search_path = public as $$
declare em text; n int;
begin
  select lower(p.email) into em from nx_profiles p where p.user_id = auth.uid();
  if em is null then return; end if;
  select count(*) into n from nx_docs d where d.collection = 'users' and lower(btrim(d.data->>'email')) = em;
  if n > 1 then raise exception 'NX: more than one Nexus user has the email % — ask the Super Admin', em; end if;
  return query select d.data->>'id', d.data->>'name' from nx_docs d where d.collection = 'users' and lower(btrim(d.data->>'email')) = em limit 1;
end $$;
revoke all on function public.nx_app_user() from public, anon, authenticated;
revoke all on function public.nx_num(jsonb, text) from public, anon, authenticated;

create or replace function public.nx_doc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me_id text; me_name text;
  l jsonb; ol jsonb; i int; mp numeric; po jsonb; iw jsonb; pol jsonb; got numeric; pen numeric; inv numeric; rec numeric; acc numeric; rej numeric; sh numeric; ex numeric; ov numeric; have numeric;
  strip text[] := array['received', 'rejected', 'closed', 'closed_qty', 'closed_by', 'closed_by_id', 'closed_at', 'closed_why'];
  core text[] := array['lines', 'vendor', 'expected', 'remarks'];
  keyn text;
begin
  if auth.uid() is null or nx_is_superadmin() then return coalesce(new, old); end if;
  select uid, uname into me_id, me_name from nx_app_user();
  if me_id is null then raise exception 'NX: your login is not linked to a Nexus user'; end if;
  -- the app saves with UPSERT: for an existing row the INSERT trigger fires first and then the UPDATE trigger (which does the checks)
  if tg_op = 'INSERT' and exists (select 1 from nx_docs d where d.collection = new.collection and d.id = new.id) then return new; end if;

  if tg_op = 'DELETE' then
    if old.collection in ('purchase_orders', 'grns', 'inwards', 'issues', 'rtvs', 'materials', 'users') then raise exception 'NX: % cannot be deleted', old.collection; end if;
    if old.collection = 'opening_stock' and (coalesce(old.data->>'status', '') <> 'Pending' or coalesce(old.data->>'by_id', '') <> me_id) then raise exception 'NX: only your own pending opening stock entry can be withdrawn'; end if;
    return old;
  end if;

  -- ---------- audit: the user name comes from the session ----------
  if new.collection = 'audit' then
    new.data := new.data || jsonb_build_object('user', me_name, 'user_id', me_id);
    return new;
  end if;

  -- ---------- users: one email per user, only the Super Admin changes an email ----------
  if new.collection = 'users' then
    keyn := lower(btrim(coalesce(new.data->>'email', '')));
    if keyn <> '' and exists (select 1 from nx_docs d where d.collection = 'users' and d.id <> new.id and lower(btrim(d.data->>'email')) = keyn) then raise exception 'NX: another user already has the email %', keyn; end if;
    if tg_op = 'UPDATE' and lower(btrim(coalesce(old.data->>'email', ''))) <> '' and keyn <> lower(btrim(old.data->>'email')) then raise exception 'NX: only the Super Admin can change a login email'; end if;
    return new;
  end if;

  -- ---------- materials: item code unique (the price itself is guarded by nx_price_guard) ----------
  if new.collection = 'materials' then
    keyn := upper(btrim(coalesce(new.data->>'code', '')));
    if keyn <> '' and exists (select 1 from nx_docs d where d.collection = 'materials' and d.id <> new.id and upper(btrim(d.data->>'code')) = keyn) then raise exception 'NX: item code % already exists', keyn; end if;
    return new;
  end if;

  -- every new record carries the real author; authorship never changes afterwards
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_build_object('by_id', me_id);
    if new.collection = 'purchase_orders' then new.data := new.data || jsonb_build_object('created_by_id', me_id, 'created_by', me_name);
    else new.data := new.data || jsonb_build_object('by', me_name); end if;
  else
    new.data := new.data || jsonb_build_object('by_id', old.data->'by_id');
    if old.data ? 'created_by_id' then new.data := new.data || jsonb_build_object('created_by_id', old.data->'created_by_id', 'created_by', old.data->'created_by'); end if;
    if old.data ? 'amended_by_id' then new.data := new.data || jsonb_build_object('amended_by_id', old.data->'amended_by_id', 'amended_by', old.data->'amended_by'); end if;
    if new.collection <> 'purchase_orders' then new.data := new.data || jsonb_build_object('by', old.data->'by'); end if;
  end if;

  -- ---------- RTV: never more than the rejected stock of that item ----------
  if new.collection = 'rtvs' then
    if tg_op = 'UPDATE' then raise exception 'NX: an RTV cannot be changed'; end if;
    keyn := upper(btrim(coalesce(new.data->>'material', '')));
    select coalesce(sum(nx_num(x->'rejected', 'rejected') + nx_num(x->'over_inv', 'over_inv')), 0) into have from nx_docs g, jsonb_array_elements(g.data->'lines') x where g.collection = 'grns' and upper(btrim(x->>'material')) = keyn;
    select have + coalesce(sum(nx_num(d.data->'qty', 'qty')), 0) into have from nx_docs d where d.collection = 'issues' and d.data->>'type' = 'line_reject' and d.data->>'status' = 'Approved' and upper(btrim(d.data->>'material')) = keyn;
    select have - coalesce(sum(nx_num(d.data->'qty', 'qty')), 0) into have from nx_docs d where d.collection = 'rtvs' and upper(btrim(d.data->>'material')) = keyn;
    if nx_num(new.data->'qty', 'qty') <= 0 or nx_num(new.data->'qty', 'qty') > have + 0.000001 then raise exception 'NX: only % of % is in rejected stock', have, keyn; end if;
    return new;
  end if;

  -- ---------- purchase orders ----------
  if new.collection = 'purchase_orders' then
    if jsonb_typeof(new.data->'lines') is distinct from 'array' then raise exception 'NX: PO lines are missing'; end if;
    for l in select * from jsonb_array_elements(new.data->'lines') loop perform nx_num(l->'qty', 'qty'), nx_num(l->'rate', 'rate'), nx_num(l->'received', 'received'), nx_num(l->'rejected', 'rejected'); end loop;
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'approval', '') <> 'Pending' then raise exception 'NX: a new PO must wait for approval'; end if;
      if coalesce(new.data->>'cancelled', 'false') = 'true' then raise exception 'NX: a new PO cannot be cancelled'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'purchase_orders' and lower(d.data->>'no') = lower(new.data->>'no')) then raise exception 'NX: PO number % is already taken', new.data->>'no'; end if;
      new.data := new.data - 'approved_by' - 'approved_by_id' - 'approved_at' - 'amended_by' - 'amended_by_id';
      for l in select * from jsonb_array_elements(new.data->'lines') loop
        if nx_num(l->'received', 'received') <> 0 or nx_num(l->'rejected', 'rejected') <> 0 or coalesce(l->>'closed', 'false') = 'true' then raise exception 'NX: a new PO has no receipts'; end if;
      end loop;
    else
      if old.data->>'approval' = 'Approved' and new.data->>'approval' is distinct from 'Approved' then raise exception 'NX: an approved PO cannot change its approval'; end if;
      if old.data->>'approval' = 'Rejected' and new.data->>'approval' is distinct from 'Rejected' then raise exception 'NX: a rejected PO cannot be reused'; end if;
      if new.data->'moq_log' is distinct from old.data->'moq_log' then raise exception 'NX: the MOQ record of a PO cannot change'; end if;
      if new.data->>'no' is distinct from old.data->>'no' and exists (select 1 from nx_docs d where d.collection = 'purchase_orders' and d.id <> new.id and lower(d.data->>'no') = lower(new.data->>'no')) then raise exception 'NX: PO number % is already taken', new.data->>'no'; end if;
      if coalesce(old.data->>'cancelled', 'false') = 'true' and coalesce(new.data->>'cancelled', 'false') <> 'true' then raise exception 'NX: a cancelled PO cannot be revived'; end if;
      if coalesce(old.data->>'cancelled', 'false') <> 'true' and coalesce(new.data->>'cancelled', 'false') = 'true' then
        if coalesce(new.data->>'cancel_reason', '') = '' then raise exception 'NX: a reason is needed to cancel a PO'; end if;
        if exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'po_id' = new.id) or exists (select 1 from nx_docs d where d.collection = 'inwards' and lower(d.data->>'po_no') = lower(new.data->>'no') and d.data->>'status' = 'Pending GRN') then raise exception 'NX: a PO with receipts or a gate entry cannot be cancelled — short close it'; end if;
        new.data := new.data || jsonb_build_object('cancelled_by', me_name, 'cancelled_by_id', me_id);
      end if;
      if old.data->>'approval' = 'Approved' then
        if new.data->>'vendor' is distinct from old.data->>'vendor' then raise exception 'NX: the vendor of an approved PO cannot change'; end if;
        if jsonb_array_length(new.data->'lines') <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: the lines of an approved PO cannot change'; end if;
        for i in 0 .. jsonb_array_length(old.data->'lines') - 1 loop
          ol := old.data->'lines'->i; l := new.data->'lines'->i;
          if ol - strip is distinct from l - strip then raise exception 'NX: the lines of an approved PO cannot change'; end if;
          -- received / rejected on a line are exactly what its GRNs record
          select coalesce(sum(nx_num(x->'accepted', 'accepted') + nx_num(x->'rejected', 'rejected')), 0), coalesce(sum(nx_num(x->'rejected', 'rejected')), 0) into got, rej
            from nx_docs g, jsonb_array_elements(g.data->'lines') x where g.collection = 'grns' and g.data->>'po_id' = new.id and (x->>'po_line')::int = i;
          if abs(nx_num(l->'received', 'received') - got) > 0.000001 or abs(nx_num(l->'rejected', 'rejected') - rej) > 0.000001 then
            new.data := jsonb_set(jsonb_set(new.data, array['lines', i::text, 'received'], to_jsonb(got)), array['lines', i::text, 'rejected'], to_jsonb(rej));
          end if;
          if coalesce(l->>'closed', 'false') = 'true' and coalesce(ol->>'closed', 'false') <> 'true' then
            if coalesce(l->>'closed_why', '') = '' then raise exception 'NX: a reason is needed to short close a PO line'; end if;
            new.data := jsonb_set(jsonb_set(new.data, array['lines', i::text, 'closed_by'], to_jsonb(me_name)), array['lines', i::text, 'closed_by_id'], to_jsonb(me_id));
          elsif coalesce(ol->>'closed', 'false') = 'true' and coalesce(l->>'closed', 'false') <> 'true' then raise exception 'NX: a short-closed PO line cannot be reopened'; end if;
        end loop;
      else
        -- any change to what is ordered counts as an amendment by the person who made it
        for i in 1 .. array_length(core, 1) loop
          if new.data->core[i] is distinct from old.data->core[i] then new.data := new.data || jsonb_build_object('amended_by_id', me_id, 'amended_by', me_name); exit; end if;
        end loop;
        for l in select * from jsonb_array_elements(new.data->'lines') loop
          if nx_num(l->'received', 'received') <> 0 or nx_num(l->'rejected', 'rejected') <> 0 or coalesce(l->>'closed', 'false') = 'true' then raise exception 'NX: a PO waiting for approval has no receipts'; end if;
        end loop;
      end if;
      if old.data->>'approval' is distinct from 'Approved' and new.data->>'approval' = 'Approved' then
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
        if new.data->>'created_by_id' = me_id or new.data->>'amended_by_id' = me_id then raise exception 'NX: you raised or amended this PO — someone else must approve it'; end if;
        if jsonb_array_length(coalesce(new.data->'moq_log', '[]')) > 0 then raise exception 'NX: a PO above the requirement (MOQ) is approved only by the Super Admin'; end if;
        if jsonb_array_length(new.data->'lines') = 0 then raise exception 'NX: a PO needs at least one line'; end if;
        for l in select * from jsonb_array_elements(new.data->'lines') loop
          if nx_num(l->'qty', 'qty') <= 0 then raise exception 'NX: % qty must be above 0', l->>'material'; end if;
          select nx_num(d.data->'price', 'price') into mp from nx_docs d where d.collection = 'materials' and upper(btrim(d.data->>'code')) = upper(btrim(l->>'material')) limit 1;
          if coalesce(mp, 0) <= 0 then raise exception 'NX: % has no approved price', l->>'material'; end if;
          if abs(nx_num(l->'rate', 'rate') - mp) > 0.000001 then raise exception 'NX: % rate differs from the approved item price', l->>'material'; end if;
        end loop;
      end if;
      if old.data->>'approval' is distinct from 'Rejected' and new.data->>'approval' = 'Rejected' then new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id); end if;
    end if;
  end if;

  -- ---------- GRNs ----------
  if new.collection = 'grns' then
    if jsonb_typeof(new.data->'lines') is distinct from 'array' or jsonb_array_length(new.data->'lines') = 0 then raise exception 'NX: GRN lines are missing'; end if;
    for l in select * from jsonb_array_elements(new.data->'lines') loop
      if nx_num(l->'accepted', 'accepted') < 0 or nx_num(l->'rejected', 'rejected') < 0 or nx_num(l->'excess', 'excess') < 0 or nx_num(l->'short', 'short') < 0 or nx_num(l->'over_inv', 'over_inv') < 0 or nx_num(l->'recv_qty', 'received') < 0 or nx_num(l->'inv_qty', 'invoice') < 0 then raise exception 'NX: a GRN qty cannot be negative'; end if;
    end loop;
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'inward_id', '') = '' or exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'inward_id' = new.data->>'inward_id') then raise exception 'NX: this invoice already has a GRN'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'grns' and lower(d.data->>'no') = lower(new.data->>'no')) then raise exception 'NX: GRN number % is already taken', new.data->>'no'; end if;
      select d.data into iw from nx_docs d where d.collection = 'inwards' and d.id = new.data->>'inward_id' for update;
      if iw is null or iw->>'status' <> 'Pending GRN' or iw->>'inv_status' <> 'Approved' then raise exception 'NX: the gate entry is not ready for GRN'; end if;
      select d.data into po from nx_docs d where d.collection = 'purchase_orders' and d.id = new.data->>'po_id' for update;   -- locks the PO: two GRNs at once are checked one after the other
      if po is null or po->>'approval' <> 'Approved' or coalesce(po->>'cancelled', 'false') = 'true' or lower(po->>'no') <> lower(iw->>'po_no') or lower(po->>'vendor') <> lower(iw->>'vendor') or lower(po->>'no') <> lower(coalesce(new.data->>'po_no', po->>'no')) then raise exception 'NX: the PO is not an open approved PO of this gate entry'; end if;
      for l in select * from jsonb_array_elements(new.data->'lines') loop
        if coalesce(l->>'excess_status', '') not in ('', 'Pending') then raise exception 'NX: excess is approved only after the GRN is saved'; end if;
        if l->>'po_line' is null then raise exception 'NX: GRN line without a PO line'; end if;
        pol := po->'lines'->((l->>'po_line')::int);
        if pol is null or upper(btrim(pol->>'material')) <> upper(btrim(l->>'material')) then raise exception 'NX: % is not on PO %', l->>'material', po->>'no'; end if;
        if (select count(*) from jsonb_array_elements(new.data->'lines') y where (y->>'po_line')::int = (l->>'po_line')::int) > 1 then raise exception 'NX: % is twice on this GRN', l->>'material'; end if;
        -- pending on the PO line = PO qty − what earlier GRNs recorded (never the client's copy)
        select coalesce(sum(nx_num(x->'accepted', 'accepted') + nx_num(x->'rejected', 'rejected')), 0) into got
          from nx_docs g, jsonb_array_elements(g.data->'lines') x where g.collection = 'grns' and g.data->>'po_id' = po->>'id' and (x->>'po_line')::int = (l->>'po_line')::int;
        pen := greatest(0, nx_num(pol->'qty', 'qty') - got); if coalesce(pol->>'closed', 'false') = 'true' then pen := 0; end if;
        -- the invoice qty of this line is fixed at the gate (item-wise) or taken from the line for an older gate entry
        select nx_num(x->'inv_qty', 'invoice') into inv from jsonb_array_elements(coalesce(iw->'lines', '[]')) x where (x->>'po_line')::int = (l->>'po_line')::int limit 1;
        if inv is null then if jsonb_array_length(coalesce(iw->'lines', '[]')) > 0 then raise exception 'NX: % is not on this gate entry', l->>'material'; end if; inv := nx_num(l->'inv_qty', 'invoice'); end if;
        if inv <= 0 then raise exception 'NX: % invoice qty must be above 0', l->>'material'; end if;
        -- the GRN maths, recomputed here: short / over / excess / accepted all follow from invoice, received and PO pending
        rec := nx_num(l->'recv_qty', 'received'); rej := nx_num(l->'rejected', 'rejected');
        sh := greatest(0, inv - rec); ov := greatest(0, rec - inv); ex := greatest(0, least(rec, inv) - pen); acc := greatest(0, least(rec, inv) - ex - rej);
        if rej > least(rec, inv) - ex + 0.0006 then raise exception 'NX: % reject is more than the qty received against the PO', l->>'material'; end if;
        if abs(nx_num(l->'inv_qty', 'invoice') - inv) > 0.0006 or abs(nx_num(l->'short', 'short') - sh) > 0.0006 or abs(nx_num(l->'over_inv', 'over_inv') - ov) > 0.0006 or abs(nx_num(l->'excess', 'excess') - ex) > 0.0006 or abs(nx_num(l->'accepted', 'accepted') - acc) > 0.0006 then
          raise exception 'NX: % GRN quantities do not add up (invoice %, received %, PO pending %)', l->>'material', inv, rec, pen; end if;
        if ex > 0 and coalesce(l->>'excess_status', '') <> 'Pending' then raise exception 'NX: excess must wait for approval'; end if;
      end loop;
    else
      if jsonb_array_length(new.data->'lines') <> jsonb_array_length(coalesce(old.data->'lines', '[]')) then raise exception 'NX: GRN lines cannot be added or removed'; end if;
      if new.data->>'inward_id' is distinct from old.data->>'inward_id' or new.data->>'po_id' is distinct from old.data->>'po_id' or new.data->>'no' is distinct from old.data->>'no' then raise exception 'NX: a GRN cannot be moved to another PO or gate entry'; end if;
      for i in 0 .. jsonb_array_length(old.data->'lines') - 1 loop
        ol := old.data->'lines'->i; l := new.data->'lines'->i;
        if nx_num(l->'accepted', 'accepted') <> nx_num(ol->'accepted', 'accepted') or upper(btrim(l->>'material')) <> upper(btrim(ol->>'material')) or l->>'po_line' is distinct from ol->>'po_line' then raise exception 'NX: the accepted qty of a GRN cannot change'; end if;
        if abs(nx_num(l->'rejected', 'rejected') + nx_num(l->'excess', 'excess') - nx_num(ol->'rejected', 'rejected') - nx_num(ol->'excess', 'excess')) > 0.000001 then raise exception 'NX: GRN qty can only move between excess and rejected'; end if;
        if nx_num(l->'excess', 'excess') > nx_num(ol->'excess', 'excess') + 0.000001 then raise exception 'NX: excess can only be reduced'; end if;
        if l->>'excess_status' is distinct from ol->>'excess_status' then
          if coalesce(ol->>'excess_status', '') not in ('Pending', 'Amend') or coalesce(l->>'excess_status', '') not in ('Approved', 'Rejected', 'Amend', 'Pending', '') then raise exception 'NX: excess is decided only while pending'; end if;
          if coalesce(l->>'excess_status', '') = '' and nx_num(l->'excess', 'excess') > 0 then raise exception 'NX: excess must wait for approval'; end if;
          if l->>'excess_status' in ('Approved', 'Rejected') then
            if new.data->>'by_id' = me_id then raise exception 'NX: the person who made the GRN cannot decide its excess'; end if;
            new.data := jsonb_set(jsonb_set(new.data, array['lines', i::text, 'excess_by'], to_jsonb(me_name)), array['lines', i::text, 'excess_by_id'], to_jsonb(me_id));
          end if;
        elsif coalesce(ol->>'excess_status', '') in ('Approved', 'Rejected') and (nx_num(l->'excess', 'excess') <> nx_num(ol->'excess', 'excess') or nx_num(l->'rejected', 'rejected') <> nx_num(ol->'rejected', 'rejected')) then raise exception 'NX: decided excess cannot change'; end if;
      end loop;
    end if;
  end if;

  -- ---------- gate entries (inwards) ----------
  if new.collection = 'inwards' then
    perform nx_num(new.data->'qty', 'qty'), nx_num(new.data->'inv_value', 'invoice value');
    for l in select * from jsonb_array_elements(coalesce(new.data->'lines', '[]')) loop if nx_num(l->'inv_qty', 'invoice') < 0 then raise exception 'NX: a gate entry qty cannot be negative'; end if; end loop;
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') <> 'Pending GRN' or coalesce(new.data->>'inv_status', '') <> '' then raise exception 'NX: a new gate entry waits for invoice approval'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'inwards' and lower(d.data->>'vendor') = lower(new.data->>'vendor')
                 and regexp_replace(lower(coalesce(d.data->>'bill_no', '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(new.data->>'bill_no', '')), '[^a-z0-9]', '', 'g')
                 and coalesce(d.data->>'inv_status', '') <> 'Rejected') then raise exception 'NX: this vendor already has this invoice number'; end if;
      select d.data into po from nx_docs d where d.collection = 'purchase_orders' and lower(d.data->>'no') = lower(new.data->>'po_no') limit 1;
      if po is null or po->>'approval' <> 'Approved' or coalesce(po->>'cancelled', 'false') = 'true' or lower(po->>'vendor') <> lower(new.data->>'vendor') then raise exception 'NX: % is not an open approved PO of %', new.data->>'po_no', new.data->>'vendor'; end if;
      if exists (select 1 from nx_docs d where d.collection = 'inwards' and lower(d.data->>'po_no') = lower(new.data->>'po_no') and d.data->>'status' = 'Pending GRN') then raise exception 'NX: this PO already has a gate entry waiting for GRN'; end if;
      new.data := new.data - 'inv_by' - 'inv_by_id' - 'inv_at';
    else
      if old.data->>'inv_status' is distinct from 'Approved' and new.data->>'inv_status' = 'Approved' then
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who made the gate entry cannot approve its invoice'; end if;
        new.data := new.data || jsonb_build_object('inv_by', me_name, 'inv_by_id', me_id);
      end if;
      -- once the invoice is approved, what was invoiced is frozen
      if old.data->>'inv_status' = 'Approved' and (new.data->'lines' is distinct from old.data->'lines' or new.data->>'qty' is distinct from old.data->>'qty' or new.data->>'bill_no' is distinct from old.data->>'bill_no' or new.data->>'bill_date' is distinct from old.data->>'bill_date' or new.data->>'po_no' is distinct from old.data->>'po_no' or new.data->>'vendor' is distinct from old.data->>'vendor' or new.data->>'inv_value' is distinct from old.data->>'inv_value') then raise exception 'NX: an approved invoice cannot change — reject it and enter it again'; end if;
      if old.data->>'status' = 'GRN Done' and new.data->>'status' is distinct from 'GRN Done' then raise exception 'NX: a gate entry with a GRN cannot be reopened'; end if;
      if old.data->>'status' is distinct from 'GRN Done' and new.data->>'status' = 'GRN Done' and not exists (select 1 from nx_docs d where d.collection = 'grns' and d.data->>'inward_id' = new.id) then raise exception 'NX: no GRN exists for this gate entry'; end if;
      if new.data->>'po_no' is distinct from old.data->>'po_no' or new.data->>'vendor' is distinct from old.data->>'vendor' then raise exception 'NX: a gate entry cannot move to another PO or vendor'; end if;
    end if;
  end if;

  -- ---------- opening stock ----------
  if new.collection = 'opening_stock' then
    keyn := upper(regexp_replace(btrim(coalesce(new.data->>'material', '')), '\s+', ' ', 'g'));
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock waits for approval'; end if;
      if nx_num(new.data->'qty', 'qty') <= 0 then raise exception 'NX: opening stock qty must be above 0'; end if;
      if not exists (select 1 from nx_docs d where d.collection = 'materials' and upper(btrim(d.data->>'code')) = keyn) then raise exception 'NX: % is not an item', keyn; end if;
      if exists (select 1 from nx_docs d where d.collection = 'opening_stock' and upper(regexp_replace(btrim(d.data->>'material'), '\s+', ' ', 'g')) = keyn and coalesce(d.data->>'status', '') <> 'Rejected') then raise exception 'NX: % already has opening stock', keyn; end if;
      new.data := new.data - 'approved_by' - 'approved_by_id' - 'approved_at';
    else
      if old.data->>'status' is distinct from new.data->>'status' then
        if coalesce(old.data->>'status', '') <> 'Pending' then raise exception 'NX: opening stock is decided only while pending'; end if;
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who entered opening stock cannot approve it'; end if;
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
      end if;
      if new.data->'qty' is distinct from old.data->'qty' or new.data->>'material' is distinct from old.data->>'material' or new.data->'rate' is distinct from old.data->'rate' then raise exception 'NX: opening stock qty / item / rate cannot change — reject it and enter it again'; end if;
    end if;
  end if;

  -- ---------- issues, returns, line rejections, write-offs ----------
  if new.collection = 'issues' then
    keyn := upper(btrim(coalesce(new.data->>'material', '')));
    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') = 'Approved' then raise exception 'NX: an issue waits for approval'; end if;
      if nx_num(new.data->'qty', 'qty') <= 0 then raise exception 'NX: issue qty must be above 0'; end if;
      new.data := new.data - 'approved_by' - 'approved_by_id' - 'approved_at';
    else
      if new.data->>'type' is distinct from old.data->>'type' or new.data->>'material' is distinct from old.data->>'material' or new.data->>'to_jc' is distinct from old.data->>'to_jc' then raise exception 'NX: an issue cannot change its item, type or job card'; end if;
      if old.data->>'status' is distinct from 'Approved' and new.data->>'status' = 'Approved' then
        if new.data->>'by_id' = me_id then raise exception 'NX: the person who entered this cannot approve it'; end if;
        new.data := new.data || jsonb_build_object('approved_by', me_name, 'approved_by_id', me_id);
        if coalesce(new.data->>'type', '') in ('return', 'line_reject') then   -- never more than what is issued to that job card
          select coalesce(sum(case when d.data->>'type' in ('return', 'line_reject') then -nx_num(d.data->'qty', 'qty') else nx_num(d.data->'qty', 'qty') end), 0) into have
            from nx_docs d where d.collection = 'issues' and d.id <> new.id and d.data->>'status' = 'Approved' and coalesce(d.data->>'type', '') <> 'scrap' and lower(d.data->>'to_jc') = lower(new.data->>'to_jc') and upper(btrim(d.data->>'material')) = keyn;
          if nx_num(new.data->'qty', 'qty') > have + 0.000001 then raise exception 'NX: only % of % is issued to %', have, keyn, new.data->>'to_jc'; end if;
        elsif coalesce(new.data->>'type', '') = 'scrap' then   -- never more than the non-returnable rejected stock
          select coalesce(sum(case when d.data->>'type' = 'scrap' then -nx_num(d.data->'qty', 'qty') else nx_num(d.data->'qty', 'qty') end), 0) into have
            from nx_docs d where d.collection = 'issues' and d.id <> new.id and d.data->>'status' = 'Approved' and ((d.data->>'type' = 'line_reject' and coalesce(d.data->>'returnable', 'false') <> 'true') or d.data->>'type' = 'scrap') and upper(btrim(d.data->>'material')) = keyn;
          if nx_num(new.data->'qty', 'qty') > have + 0.000001 then raise exception 'NX: only % of % is in rejection stock', have, keyn; end if;
        end if;
      end if;
      if old.data->>'status' = 'Approved' and (new.data->'qty' is distinct from old.data->'qty' or new.data->>'status' is distinct from 'Approved') then raise exception 'NX: an approved issue cannot change'; end if;
      if nx_num(new.data->'qty', 'qty') > nx_num(old.data->'qty', 'qty') + 0.000001 and old.data->>'status' <> 'Amend' then raise exception 'NX: an issue qty can only be reduced at approval'; end if;
    end if;
  end if;

  return new;
exception
  when others then
    if sqlerrm like 'NX:%' then raise; end if;
    raise exception 'NX: invalid record (%)', sqlerrm;
end $$;
revoke all on function public.nx_doc_guard() from public, anon, authenticated;

create or replace trigger nx_docs_guard before insert or update on public.nx_docs
  for each row when (new.collection in ('purchase_orders', 'grns', 'inwards', 'opening_stock', 'issues', 'rtvs', 'materials', 'users', 'audit'))
  execute function public.nx_doc_guard();
create or replace trigger nx_docs_guard_del before delete on public.nx_docs
  for each row when (old.collection in ('purchase_orders', 'grns', 'inwards', 'opening_stock', 'issues', 'rtvs', 'materials', 'users'))
  execute function public.nx_doc_guard();
