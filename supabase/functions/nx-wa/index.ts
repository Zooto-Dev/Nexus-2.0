// Nexus 2.0 WhatsApp sender (Meta WhatsApp Cloud API).
// The browser only says WHICH event happened for WHICH record (and, for PO/GRN, hands over the PDF).
// Template parameters and recipient numbers are worked out here from the database, so a user
// cannot use this function to message arbitrary numbers or send arbitrary text.
// Secrets (set in Supabase → Edge Functions → Secrets): WA_TOKEN, WA_PHONE_ID.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const GRAPH = 'https://graph.facebook.com/v20.0/';
const MAX_PDF = 5 * 1024 * 1024;

type Doc = Record<string, any>;
type Msg = { to: string; name: string; template: string; params: [string, string][]; doc?: boolean };

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
const safe = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 900) || 'NA';
const num = (x: unknown) => { const n = parseFloat(String(x ?? '')); return isFinite(n) ? n : 0; };
const phone = (m: unknown) => { const d = String(m ?? '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d.length === 12 && d.startsWith('91') ? d : ''; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? m[3] + '-' + MON[+m[2] - 1] + '-' + m[1] : safe(s); };
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
// Server key: the new secret key (sb_secret_…) when the project has one, else the legacy service_role key.
function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
// The caller's own profile, read with their own login (row-level security lets a user read their own row).
async function myProfile(jwt: string) {
  let pub = '';
  try { const k = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'); pub = String(k.default || Object.values(k)[0] || ''); } catch (_e) { /* not set */ }
  pub = pub || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const u = createClient(Deno.env.get('SUPABASE_URL')!, pub, { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + jwt } } });
  const { data: who } = await u.auth.getUser(jwt);
  if (!who?.user) return { user: null, profile: null };
  const { data: profile } = await u.from('nx_profiles').select('role, email').eq('user_id', who.user.id).maybeSingle();
  return { user: who.user, profile: profile as { role: string; email: string } | null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { user, profile: me } = await myProfile(jwt);
    if (!user) return out({ error: 'Not signed in' }, 401);
    if (!me) return out({ error: 'No Nexus profile for ' + (user.email || 'this login') }, 403);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
    { const { error: kErr } = await db.from('nx_docs').select('id').limit(1); if (kErr) return out({ error: 'Server key problem: ' + kErr.message }, 500); }

    const b = await req.json();
    const event = String(b.event || ''), id = String(b.id || ''), resend = b.resend === true;
    if (!id && b.action !== 'test') return out({ error: 'Missing record id' }, 400);
    if (resend && !['superadmin', 'admin'].includes(me.role)) return out({ error: 'Only Admin can resend' }, 403);

    const getDoc = async (col: string, key: string) => (await db.from('nx_docs').select('data').eq('collection', col).eq('id', key).maybeSingle()).data?.data as Doc | undefined;
    const all = async (col: string) => ((await db.from('nx_docs').select('data').eq('collection', col)).data || []).map((r: { data: Doc }) => r.data);
    const users = (await all('users')).filter((u) => u.active !== false);
    const byName = Object.fromEntries(users.map((u) => [norm(u.name), u]));
    const actor = users.find((u) => norm(u.email) === norm(me.email));
    const isHead = (u: Doc) => ['r_admin', 'r_adm'].includes(u.role_id) || /HEAD|MANAGER|INCHARGE/.test(norm(u.designation));
    const inDept = (u: Doc, re: RegExp) => re.test(norm(u.department));
    const heads = (re: RegExp) => users.filter((u) => inDept(u, re) && isHead(u));
    const dept = (re: RegExp) => users.filter((u) => inDept(u, re));
    const superAdmins = () => users.filter((u) => u.role_id === 'r_admin');
    const vendorOf = async (name: string) => (await all('vendors')).find((v) => norm(v.name) === norm(name));
    const staff = (list: Doc[], template: string, params: [string, string][], doc = false): Msg[] => list.map((u) => ({ to: phone(u.mobile), name: String(u.name || ''), template, params, doc }));
    const byFirstName = (n: string) => users.find((u) => norm(u.doer) === norm(n) || norm(String(u.name || '').split(/[\s(]/)[0]) === norm(n));

    const token = Deno.env.get('WA_TOKEN') || '', phoneId = Deno.env.get('WA_PHONE_ID') || '';
    const uploadPdf = async (b64: string, name: string): Promise<{ id?: string; error?: string }> => {
      const bytes = Uint8Array.from(atob(String(b64 || '')), (c) => c.charCodeAt(0));
      if (!bytes.length || bytes.length > MAX_PDF || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { error: 'PDF missing or invalid' };
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
      const up = await fetch(GRAPH + phoneId + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      const uj = await up.json().catch(() => ({}));
      return uj.id ? { id: uj.id } : { error: 'PDF upload failed: ' + (uj.error?.message || up.status) };
    };
    const sendTpl = async (m: Msg, media: string, fileName: string): Promise<string> => {
      const comp: Doc[] = [];
      if (m.doc) comp.push({ type: 'header', parameters: [{ type: 'document', document: { id: media, filename: fileName } }] });
      comp.push({ type: 'body', parameters: m.params.map(([k, v]) => ({ type: 'text', parameter_name: k, text: v })) });
      const r = await fetch(GRAPH + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template, language: { code: 'en' }, components: comp } }) });
      const j = await r.json().catch(() => ({}));
      return j.messages && j.messages.length ? '' : String(j.error?.error_data?.details || j.error?.message || r.status);
    };

    // Super Admin: one sample of every template to one number, to check the WhatsApp setup
    if (b.action === 'test') {
      if (me.role !== 'superadmin') return out({ error: 'Only a Super Admin can send test messages' }, 403);
      const to = phone(b.to); if (!to) return out({ error: 'Enter a valid 10-digit mobile number' }, 400);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID missing in Supabase secrets)' }, 400);
      const S: Msg[] = [
        { to, name: 'Test', template: 'po_approval_request', params: [['po_number', 'TEST/PO/001'], ['creator_name', 'Nexus Test']] },
        { to, name: 'Test', template: 'po_approval_vendor', params: [['po_number', 'TEST/PO/001'], ['total_amount', '1180.00'], ['delivery_date', '05-Oct-2026']], doc: true },
        { to, name: 'Test', template: 'po_approval_creator', params: [['po_number', 'TEST/PO/001'], ['creator_name', 'Nexus Test']], doc: true },
        { to, name: 'Test', template: 'gate_entry_alert', params: [['vendor_name', 'Test Vendor'], ['invoice_no', 'INV-TEST-1']] },
        { to, name: 'Test', template: 'invoice_approved_store', params: [['invoice_no', 'INV-TEST-1'], ['vendor_name', 'Test Vendor']] },
        { to, name: 'Test', template: 'swatch_reject_merchant', params: [['invoice_no', 'INV-TEST-1'], ['vendor_name', 'Test Vendor']] },
        { to, name: 'Test', template: 'excess_approval_md', params: [['vendor_name', 'Test Vendor'], ['invoice_no', 'INV-TEST-1']] },
        { to, name: 'Test', template: 'grn_accounts_alert', params: [['vendor_name', 'Test Vendor'], ['total_qty', '100']], doc: true },
        { to, name: 'Test', template: 'grn_vendor_alert', params: [['vendor_name', 'Test Vendor']], doc: true }
      ];
      const up = await uploadPdf(b.pdf, 'Nexus_Test.pdf');
      const now = new Date().toISOString(); const by = actor?.name || me.email;
      const results: { template: string; ok: boolean; error: string }[] = [];
      for (const m of S) {
        const err = m.doc && !up.id ? (up.error || 'PDF upload failed') : await sendTpl(m, up.id || '', 'Nexus_Test.pdf');
        results.push({ template: m.template, ok: !err, error: err });
      }
      const rows = results.map((r, k) => { const rid = crypto.randomUUID(); return { collection: 'wa_log', id: rid, data: { id: rid, key: 'test|' + now, rid: '', event: 'test', ref: 'Test', template: r.template, to, name: 'Test', params: S[k].params.map(([a, v]) => a + ': ' + v).join(' | ') + (S[k].doc ? ' | PDF' : ''), status: r.ok ? 'sent' : 'failed', error: r.error, at: now, by } }; });
      await db.from('nx_docs').insert(rows);
      return out({ ok: results.every((r) => r.ok), results });
    }

    let msgs: Msg[] = []; let ref = ''; let pdfName = ''; let needPdf = false; let round = '';

    if (event === 'po_submitted' || event === 'po_approved') {
      const p = await getDoc('purchase_orders', id); if (!p) return out({ error: 'PO not found' }, 404);
      ref = p.no;
      if (event === 'po_submitted') {
        if (p.approval !== 'Pending') return out({ error: 'PO is not waiting for approval' }, 409);
        round = String((p.edit_log || []).length);
        msgs = staff(heads(/PURCHASE/), 'po_approval_request', [['po_number', safe(p.no)], ['creator_name', safe(p.created_by)]]);
      } else {
        if (p.approval !== 'Approved') return out({ error: 'PO is not approved' }, 409);
        needPdf = true; pdfName = String(p.no || 'Purchase_Order').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
        const total = (p.lines || []).reduce((a: number, l: Doc) => a + num(l.rate) * num(l.qty) * (1 + num(l.gst) / 100), 0);
        const v = await vendorOf(p.vendor);
        msgs.push({ to: phone(v?.mobile), name: String(p.vendor || ''), template: 'po_approval_vendor', params: [['po_number', safe(p.no)], ['total_amount', total.toFixed(2)], ['delivery_date', fmtD(p.expected)]], doc: true });
        const creator = byName[norm(p.created_by)];
        const purchase = [creator, ...dept(/PURCHASE/).filter((u) => !isHead(u))].filter(Boolean) as Doc[];
        msgs.push(...staff(purchase, 'po_approval_creator', [['po_number', safe(p.no)], ['creator_name', safe(p.created_by)]], true));
      }
    } else if (event === 'gate_entry' || event === 'invoice_approved') {
      const i = await getDoc('inwards', id); if (!i) return out({ error: 'Gate entry not found' }, 404);
      ref = i.no;
      if (event === 'gate_entry') msgs = staff(heads(/PURCHASE/), 'gate_entry_alert', [['vendor_name', safe(i.vendor)], ['invoice_no', safe(i.bill_no)]]);
      else {
        if (i.inv_status !== 'Approved') return out({ error: 'Invoice is not approved' }, 409);
        msgs = staff(dept(/STORE/), 'invoice_approved_store', [['invoice_no', safe(i.bill_no)], ['vendor_name', safe(i.vendor)]]);
      }
    } else if (event === 'qc_mismatch') {
      const [inwId, code] = id.split('|');
      const i = await getDoc('inwards', inwId); const q = (i?.qc || []).find((x: Doc) => x.material === code);
      if (!i || !q) return out({ error: 'QC line not found' }, 404);
      if (q.result !== 'Mismatch') return out({ error: 'QC is not a mismatch' }, 409);
      ref = i.no + ' · ' + code;
      let list = (q.merchants || []).map(byFirstName).filter(Boolean) as Doc[];
      if (!list.length) list = dept(/MERCHAND/).filter((u) => /SR|HEAD|MANAGER/.test(norm(u.designation)));
      msgs = staff(list, 'swatch_reject_merchant', [['invoice_no', safe(i.bill_no)], ['vendor_name', safe(i.vendor)]]);
    } else if (event === 'excess_pending' || event === 'grn_final') {
      const g = await getDoc('grns', id); if (!g) return out({ error: 'GRN not found' }, 404);
      ref = g.no;
      const lines = g.lines || [];
      if (event === 'excess_pending') {
        if (!lines.some((l: Doc) => l.excess_status === 'Pending')) return out({ error: 'No excess waiting' }, 409);
        round = String(lines.reduce((a: number, l: Doc) => a + (l.amend_log || []).length, 0));
        msgs = staff(superAdmins(), 'excess_approval_md', [['vendor_name', safe(g.vendor)], ['invoice_no', safe(g.invoice)]]);
      } else {
        if (lines.some((l: Doc) => l.excess_status === 'Pending' || l.excess_status === 'Amend')) return out({ error: 'Excess decision pending' }, 409);
        needPdf = true; pdfName = 'GRN_' + String(g.vendor || '').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
        const grnQty = lines.reduce((a: number, l: Doc) => a + num(l.accepted) + (l.excess_status === 'Approved' ? num(l.excess) : 0), 0);
        msgs = staff(heads(/ACCOUNT/), 'grn_accounts_alert', [['vendor_name', safe(g.vendor)], ['total_qty', qty(grnQty)]], true);
        const v = await vendorOf(g.vendor);
        msgs.push({ to: phone(v?.mobile), name: String(g.vendor || ''), template: 'grn_vendor_alert', params: [['vendor_name', safe(g.vendor)]], doc: true });
      }
    } else return out({ error: 'Unknown event' }, 400);

    // one send per event and record, unless an Admin asks to resend
    const logKey = event + '|' + id + (round && round !== '0' ? '|' + round : '');
    if (!resend) {
      const { data: prev } = await db.from('nx_docs').select('id').eq('collection', 'wa_log').eq('data->>key', logKey).eq('data->>status', 'sent').limit(1);
      if (prev && prev.length) return out({ ok: true, skipped: 'already sent' });
    }

    const now = new Date().toISOString();
    const by = actor?.name || me.email;
    const log = (m: Msg, status: string, error = '') => ({ collection: 'wa_log', id: crypto.randomUUID(), data: { id: '', key: logKey, rid: id, event, ref, template: m.template, to: m.to, name: m.name, params: m.params.map(([k, v]) => k + ': ' + v).join(' | ') + (m.doc ? ' | PDF' : ''), status, error, at: now, by } });

    // unique recipients per template; numbers we cannot reach are logged, not dropped silently
    const seen = new Set<string>(); msgs = msgs.filter((m) => { const k = m.template + m.to; if (m.to && seen.has(k)) return false; seen.add(k); return true; });
    const rows: ReturnType<typeof log>[] = [];
    const finish = async () => { rows.forEach((r) => { r.data.id = r.id; }); if (rows.length) await db.from('nx_docs').insert(rows); };

    if (!token || !phoneId) { msgs.forEach((m) => rows.push(log(m, 'not_configured', 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)'))); await finish(); return out({ ok: false, error: 'WhatsApp is not set up yet', count: msgs.length }); }

    let media = '';
    if (needPdf) {
      const up = await uploadPdf(b.pdf, pdfName);
      if (!up.id) { msgs.forEach((m) => rows.push(log(m, 'failed', up.error || 'PDF upload failed'))); await finish(); return out({ ok: false, error: up.error }); }
      media = up.id;
    }

    let sent = 0, failed = 0;
    for (const m of msgs) {
      if (!m.to) { rows.push(log(m, 'no_mobile', 'No valid mobile number')); failed++; continue; }
      const err = await sendTpl(m, media, pdfName);
      if (!err) { rows.push(log(m, 'sent')); sent++; } else { rows.push(log(m, 'failed', err)); failed++; }
    }
    await finish();
    return out({ ok: failed === 0, sent, failed });
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
