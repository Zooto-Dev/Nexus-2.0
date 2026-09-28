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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await db.auth.getUser(jwt);
    if (whoErr || !who?.user) return out({ error: 'Not signed in' }, 401);
    const { data: me } = await db.from('nx_profiles').select('role, email').eq('user_id', who.user.id).maybeSingle();
    if (!me) return out({ error: 'No Nexus profile' }, 403);

    const b = await req.json();
    const event = String(b.event || ''), id = String(b.id || ''), resend = b.resend === true;
    if (!id) return out({ error: 'Missing record id' }, 400);
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

    const token = Deno.env.get('WA_TOKEN') || '', phoneId = Deno.env.get('WA_PHONE_ID') || '';
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
      const b64 = String(b.pdf || '');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (!bytes.length || bytes.length > MAX_PDF || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') { msgs.forEach((m) => rows.push(log(m, 'failed', 'PDF missing or invalid'))); await finish(); return out({ ok: false, error: 'PDF missing or invalid' }, 400); }
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('file', new Blob([bytes], { type: 'application/pdf' }), pdfName);
      const up = await fetch(GRAPH + phoneId + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      const uj = await up.json().catch(() => ({}));
      media = uj.id || '';
      if (!media) { msgs.forEach((m) => rows.push(log(m, 'failed', 'PDF upload failed: ' + (uj.error?.message || up.status)))); await finish(); return out({ ok: false, error: 'PDF upload failed' }); }
    }

    let sent = 0, failed = 0;
    for (const m of msgs) {
      if (!m.to) { rows.push(log(m, 'no_mobile', 'No valid mobile number')); failed++; continue; }
      const comp: Doc[] = [];
      if (m.doc) comp.push({ type: 'header', parameters: [{ type: 'document', document: { id: media, filename: pdfName } }] });
      comp.push({ type: 'body', parameters: m.params.map(([k, v]) => ({ type: 'text', parameter_name: k, text: v })) });
      const r = await fetch(GRAPH + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template, language: { code: 'en' }, components: comp } }) });
      const j = await r.json().catch(() => ({}));
      if (j.messages && j.messages.length) { rows.push(log(m, 'sent')); sent++; } else { rows.push(log(m, 'failed', String(j.error?.message || r.status))); failed++; }
    }
    await finish();
    return out({ ok: failed === 0, sent, failed });
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
