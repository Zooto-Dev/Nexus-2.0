// Nexus 2.0 website bridge (public): the zootofashion.com forms post here.
//   inquiry  → nx_docs 'leads'            (Merchant → Lead)
//   vendor   → nx_docs 'vendor_requests'  (Purchase → Vendor Requests), documents in the private 'vendor-docs' bucket
//   gst      → is this GST number already a vendor / request?
//   doc      → signed link to one vendor document (signed-in Nexus user with Purchase access only)
// No key goes to the website: this function checks the data, limits abuse (honeypot, size, 20 posts per IP per hour)
// and writes with the server key. New leads / requests are mailed to the Super Admins and the EA through the mail script.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Doc = Record<string, any>;
const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GST_STATES: Record<string, string> = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' };
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const mobile = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); const m = d.length > 10 ? d.slice(-10) : d; return /^[6-9]\d{9}$/.test(m) ? m : ''; };
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
const docs = async (col: string) => ((await db.from('nx_docs').select('data').eq('collection', col)).data || []).map((r: { data: Doc }) => r.data);
// next number like LEAD-2026-0007 (same shape the app uses)
async function nextNo(col: string, prefix: string) {
  const yr = new Date().getFullYear(); const head = prefix + '-' + yr + '-';
  const max = (await docs(col)).reduce((m: number, d: Doc) => d.no && String(d.no).startsWith(head) ? Math.max(m, parseInt(String(d.no).slice(head.length), 10) || 0) : m, 0);
  return head + String(max + 1).padStart(4, '0');
}
async function sha(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// who gets told: Super Admins and the EA (users with an email)
async function notify(subject: string, body: string) {
  const url = Deno.env.get('GAS_MAIL_URL') || '', secret = Deno.env.get('GAS_MAIL_SECRET') || '';
  const to = (await docs('users')).filter((u) => u.active !== false && (u.role_id === 'r_admin' || /EXECUTIVE ASSISTANT/i.test(String(u.designation || ''))) && EMAIL.test(String(u.email || '').trim().toLowerCase())).map((u) => String(u.email).trim().toLowerCase());
  const row = { id: uid(), to: to.join(','), subject, body, ref: subject.split(' — ')[0], name: 'Nexus Website', no_reply: true, status: to.length ? 'queued' : 'no_recipient', at: new Date().toISOString(), by: 'Website' };
  let status = row.status, error = '';
  if (to.length && url && secret) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, to: row.to, subject, body, ref: row.ref, name: row.name, noReply: true }), redirect: 'follow' });
      const j = await r.json().catch(() => ({})); status = j.ok ? 'sent' : 'failed'; error = j.ok ? '' : String(j.error || r.status);
    } catch (e) { status = 'failed'; error = String((e as Error).message || e); }
  }
  await db.from('nx_docs').insert({ collection: 'mail_queue', id: row.id, data: { ...row, status, error, sent_at: status === 'sent' ? new Date().toISOString() : '' } }).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 60 * 1024 * 1024) return out({ error: 'Too large' }, 413);
    const b = JSON.parse(raw || '{}');
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim() || 'unknown';
    const ipk = await sha(ip + '|' + Deno.env.get('SUPABASE_URL'));

    // ----- Nexus user: signed link to a vendor document -----
    if (b.action === 'doc') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: who } = await db.auth.getUser(jwt);
      if (!who?.user) return out({ error: 'Not signed in' }, 401);
      const { data: me } = await db.from('nx_profiles').select('role, email').eq('user_id', who.user.id).maybeSingle();
      if (!me) return out({ error: 'No Nexus profile' }, 403);
      const path = String(b.path || '');
      if (!/^VR-\d{4}-\d{4}\/[\w.-]+$/.test(path)) return out({ error: 'Bad path' }, 400);
      // the request must exist and the caller must be Admin or hold Purchase access (same rule as the app: settings.access)
      const vr = (await docs('vendor_requests')).find((v) => Object.values(v.docs || {}).includes(path));
      if (!vr) return out({ error: 'Document not found' }, 404);
      if (!['superadmin', 'admin'].includes(me.role)) {
        const [{ data: sRow }, users] = await Promise.all([db.from('nx_docs').select('data').eq('collection', 'settings').eq('id', 'main').maybeSingle(), docs('users')]);
        const acc = ((sRow?.data || {}) as Doc).access || {}; const u = users.find((x) => String(x.email || '').toLowerCase() === String(me.email).toLowerCase()) || {};
        const lv = (o: Doc | undefined) => (o && (o.purchase || o['s:vendorreq'])) || '';
        const level = lv((acc.user || {})[u.id]) || lv((acc.desig || {})[(u.department || '') + '|' + (u.designation || '')]) || lv((acc.dept || {})[u.department || '']) || lv(acc.role_user) || 'none';
        if (level === 'none') return out({ error: 'No Purchase access' }, 403);
      }
      const { data: signed, error } = await db.storage.from('vendor-docs').createSignedUrl(path, 120);
      if (error || !signed) return out({ error: 'Could not open the document: ' + (error?.message || '') }, 500);
      return out({ ok: true, url: signed.signedUrl });
    }

    // ----- public: abuse limits -----
    if (clean(b.website, 10) || clean(b.hp, 10)) return out({ ok: true, no: 'received' });   // honeypot filled: pretend success
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count } = await db.from('nx_docs').select('id', { count: 'exact', head: true }).in('collection', ['leads', 'vendor_requests']).eq('data->>ip', ipk).gte('updated_at', since);
    if ((count || 0) >= 20) return out({ error: 'Too many submissions from this network. Please try again in an hour.' }, 429);

    if (b.action === 'gst') {
      const g = norm(b.gst); if (!GSTIN.test(g)) return out({ ok: true, valid: false, exists: false });
      const inVendors = (await docs('vendors')).some((v) => norm(v.gstin) === g);
      const inReq = (await docs('vendor_requests')).some((v) => norm(v.gstin) === g && v.status !== 'Rejected');
      return out({ ok: true, valid: true, exists: inVendors || inReq, state: GST_STATES[g.slice(0, 2)] || '' });
    }

    if (b.action === 'inquiry') {
      const d: Doc = { name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), phone: mobile(b.phone), phone_raw: clean(b.phone, 30), company: clean(b.company, 160), message: clean(b.message, 4000), page: clean(b.page, 200) };
      if (!d.name) return out({ error: 'Name is required' }, 400);
      if (!EMAIL.test(d.email)) return out({ error: 'Enter a valid email ID' }, 400);
      if (d.phone_raw && !d.phone) return out({ error: 'Enter a valid 10-digit mobile number' }, 400);
      if (!d.message) return out({ error: 'Message is required' }, 400);
      // the same person sending the same text twice in a row: give the earlier number back
      const dup = (await docs('leads')).find((l) => l.email === d.email && l.message === d.message && Date.now() - new Date(l.at).getTime() < 3600 * 1000);
      if (dup) return out({ ok: true, no: dup.no });
      const no = await nextNo('leads', 'LEAD'); const id = uid(); const at = new Date().toISOString();
      const lead = { id, no, ...d, source: 'website', status: 'New', assigned: '', replies: [], notes: [], at, ip: ipk };
      const { error } = await db.from('nx_docs').insert({ collection: 'leads', id, data: lead });
      if (error) return out({ error: 'Could not save: ' + error.message }, 500);
      await notify(no + ' — new website inquiry from ' + d.name + (d.company ? ' (' + d.company + ')' : ''), 'A new inquiry came from the website.\n\nName: ' + d.name + '\nCompany: ' + (d.company || '-') + '\nEmail: ' + d.email + '\nMobile: ' + (d.phone || '-') + '\n\nMessage:\n' + d.message + '\n\nOpen Nexus → Merchant → Lead to reply.');
      return out({ ok: true, no });
    }

    if (b.action === 'vendor') {
      const bt = clean(b.businessType, 40); const isProp = bt === 'Proprietorship';
      const msme = b.msmeFlag === 'yes';
      const d: Doc = { name: clean(b.vendorName, 160), owner: clean(b.ownerName, 120), business_type: bt, gstin: norm(b.gstNo), pan_owner: norm(b.panOwner), pan_company: isProp ? '' : norm(b.panCompany), msme: msme, msme_no: msme ? clean(b.msmeNumber, 40) : '', msme_type: msme ? clean(b.msmeType, 40) : '',
        mobile: mobile(b.mobileNo), email: clean(b.emailId, 160).toLowerCase(), address: clean(b.businessAddress, 600), bank_acc: clean(b.bankAccNo, 30).replace(/\s+/g, ''), bank_name: clean(b.bankName, 120), ifsc: norm(b.ifscCode) };
      if (!d.name) return out({ error: 'Vendor / firm name is required' }, 400);
      if (!d.owner) return out({ error: 'Owner name is required' }, 400);
      if (!['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited', 'HUF', 'Other'].includes(bt)) return out({ error: 'Select the business type' }, 400);
      if (!GSTIN.test(d.gstin)) return out({ error: 'GST number is not valid' }, 400);
      if (!PAN.test(d.pan_owner)) return out({ error: 'Owner PAN is not valid' }, 400);
      if (!isProp && !PAN.test(d.pan_company)) return out({ error: 'Company PAN is not valid' }, 400);
      if (!d.mobile) return out({ error: 'Enter a valid 10-digit mobile number' }, 400);
      if (!EMAIL.test(d.email)) return out({ error: 'Enter a valid email ID' }, 400);
      if (!d.address) return out({ error: 'Business address is required' }, 400);
      if (!/^\d{6,20}$/.test(d.bank_acc)) return out({ error: 'Bank account number is not valid' }, 400);
      if (!IFSC.test(d.ifsc)) return out({ error: 'IFSC code is not valid' }, 400);
      if (!d.bank_name) return out({ error: 'Bank name is required' }, 400);
      if ((await docs('vendors')).some((v) => norm(v.gstin) === d.gstin)) return out({ error: 'This GST number is already registered with us' }, 409);
      if ((await docs('vendor_requests')).some((v) => norm(v.gstin) === d.gstin && v.status !== 'Rejected')) return out({ error: 'A registration with this GST number is already under review' }, 409);
      d.state = GST_STATES[d.gstin.slice(0, 2)] || '';
      // documents: data URLs from the form → private bucket; each ≤ 8 MB
      const files: [string, string, boolean][] = [['pan_owner', b.imgPanOwner, true], ['gst', b.imgGst, true], ['cheque', b.imgCheque, true], ['pan_company', b.imgPanCompany, !isProp], ['msme', b.imgMsme, msme]];
      const no = await nextNo('vendor_requests', 'VR');
      const paths: Record<string, string> = {};
      for (const [key, dataUrl, need] of files) {
        const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
        if (!m) { if (need) return out({ error: 'Document missing or not a JPG / PNG / PDF: ' + key.replace('_', ' ') }, 400); continue; }
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        if (bytes.length > 8 * 1024 * 1024) return out({ error: 'Document too large (8 MB max): ' + key.replace('_', ' ') }, 400);
        const ext = m[1] === 'application/pdf' ? 'pdf' : m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
        const path = no + '/' + key + '.' + ext;
        const { error } = await db.storage.from('vendor-docs').upload(path, bytes, { contentType: m[1], upsert: true });
        if (error) return out({ error: 'Could not store the ' + key.replace('_', ' ') + ' document: ' + error.message }, 500);
        paths[key] = path;
      }
      const id = uid(); const at = new Date().toISOString();
      const vr = { id, no, ...d, docs: paths, status: 'Pending', at, ip: ipk, source: 'website' };
      const { error } = await db.from('nx_docs').insert({ collection: 'vendor_requests', id, data: vr });
      if (error) return out({ error: 'Could not save: ' + error.message }, 500);
      await notify(no + ' — new vendor registration: ' + d.name, 'A vendor registered on the website.\n\nFirm: ' + d.name + '\nOwner: ' + d.owner + '\nType: ' + bt + '\nGST: ' + d.gstin + ' (' + d.state + ')\nMobile: ' + d.mobile + '\nEmail: ' + d.email + '\n\nOpen Nexus → Purchase → Vendor Requests to review and approve.');
      return out({ ok: true, no });
    }
    return out({ error: 'Unknown action' }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
