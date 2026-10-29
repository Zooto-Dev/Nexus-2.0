// Nexus 2.0 WhatsApp sender (Meta WhatsApp Cloud API).
// The browser only says WHICH event happened for WHICH record (and, for PO/GRN, hands over the PDF).
// Template parameters and recipient numbers are worked out here from the database, so a user
// cannot use this function to message arbitrary numbers or send arbitrary text.
// Every message sent or received is kept in nx_wa_msgs, which the WhatsApp screen shows as chats.
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
// The platform has already verified the login token (verify_jwt), so only its user id is read here.
function jwtUser(jwt: string): string {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
    return p.role === 'authenticated' ? String(p.sub || '') : '';
  } catch (_e) { return ''; }
}
// one client per warm worker, reused across calls
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    if (b.action === 'ping') return out({ ok: true });   // wakes the function when the WhatsApp screen opens
    const uid = jwtUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!uid) return out({ error: 'Not signed in' }, 401);
    const { data: me, error: pErr } = await db.from('nx_profiles').select('role, email').eq('user_id', uid).maybeSingle();
    if (pErr) return out({ error: 'Server key problem: ' + pErr.message }, 500);
    if (!me) return out({ error: 'No Nexus profile for this login' }, 403);
    const isAdmin = ['superadmin', 'admin'].includes(me.role);

    const event = String(b.event || ''), id = String(b.id || ''), resend = b.resend === true;
    if (!id && !['test', 'reply', 'media', 'delete', 'send_media', 'react', 'forward', 'start'].includes(b.action)) return out({ error: 'Missing record id' }, 400);
    if (resend && !isAdmin) return out({ error: 'Only Admin can resend' }, 403);

    const token = Deno.env.get('WA_TOKEN') || '', phoneId = Deno.env.get('WA_PHONE_ID') || '';
    let actorName = '';
    const actor = async () => {
      if (!actorName) { const { data } = await db.from('nx_docs').select('data').eq('collection', 'users').ilike('data->>email', me.email).limit(1); actorName = String(data?.[0]?.data?.name || me.email); }
      return actorName;
    };
    // context of the event being sent, stored with each chat message so it can be resent
    let ctx = { event: '', rid: '', ref: '' };
    const keepOut = async (to: string, type: string, body: string, template: string, wamid: string, err: string, filename = '', name = '', replyTo = '', mediaId = '', mediaMime = '') => {
      await db.from('nx_wa_msgs').insert({ id: wamid || crypto.randomUUID(), wa: to, name: name || null, dir: 'out', type, body, template: template || null, filename: filename || null, status: err ? 'failed' : 'sent', error: err || null, by_name: await actor(), seen: true, event: ctx.event || null, rid: ctx.rid || null, ref: ctx.ref || null, reply_to: replyTo || null, media_id: mediaId || null, media_mime: mediaMime || null });
    };
    // free-form messages (text, photo, file, forward, reaction) go only to a number that wrote to us in the last 24 hours (WhatsApp rule)
    const chatOpen = async (to: string): Promise<string> => {
      const { data: last } = await db.from('nx_wa_msgs').select('at').eq('wa', to).eq('dir', 'in').order('at', { ascending: false }).limit(1);
      if (!last || !last.length) return 'This number has not written to us — only templates can be sent to it';
      if (Date.now() - new Date(last[0].at).getTime() > 24 * 3600 * 1000) return 'No message from this number in the last 24 hours — WhatsApp allows only templates now';
      return '';
    };
    const wamidOk = (x: unknown) => /^wamid\.[\w=+/-]+$/.test(String(x || ''));
    // one WhatsApp message of any kind; returns [wamid, error]
    const sendRaw = async (payload: Doc): Promise<[string, string]> => {
      const r = await fetch(GRAPH + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }) });
      const j = await r.json().catch(() => ({}));
      return [j.messages?.[0]?.id || '', j.messages && j.messages.length ? '' : String(j.error?.error_data?.details || j.error?.message || r.status)];
    };
    const MEDIA_MAX: Record<string, number> = { image: 5 * 1024 * 1024, sticker: 500 * 1024, audio: 16 * 1024 * 1024, video: 16 * 1024 * 1024, document: 12 * 1024 * 1024 };
    const uploadMedia = async (b64: string, mime: string, name: string, kind: string): Promise<{ id?: string; error?: string }> => {
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = Uint8Array.from(atob(String(b64 || '')), (c) => c.charCodeAt(0)); } catch (_e) { return { error: 'File data is not valid' }; }
      if (!bytes.length) return { error: 'File is empty' };
      if (bytes.length > (MEDIA_MAX[kind] || MEDIA_MAX.document)) return { error: 'File is too large for WhatsApp (' + Math.round((MEDIA_MAX[kind] || MEDIA_MAX.document) / 1048576) + ' MB max for ' + kind + ')' };
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('file', new Blob([bytes], { type: mime }), name);
      const up = await fetch(GRAPH + phoneId + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      const uj = await up.json().catch(() => ({}));
      return uj.id ? { id: uj.id } : { error: 'Upload failed: ' + (uj.error?.message || up.status) };
    };
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
      const call = async (params: [string, string][]) => {
        const comp: Doc[] = [];
        if (m.doc) comp.push({ type: 'header', parameters: [{ type: 'document', document: { id: media, filename: fileName } }] });
        // named templates send parameter_name; the older positional ones ({{1}}, {{2}}) have an empty key
        comp.push({ type: 'body', parameters: params.map(([k, v]) => (k && !/^\d+$/.test(k) ? { type: 'text', parameter_name: k, text: v } : { type: 'text', text: v })) });
        const r = await fetch(GRAPH + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template, language: { code: 'en' }, components: comp } }) });
        const j = await r.json().catch(() => ({}));
        return { j, err: j.messages && j.messages.length ? '' : String(j.error?.error_data?.details || j.error?.message || r.status) };
      };
      let params = m.params; let { j, err } = await call(params);
      // the template in Meta has fewer {{n}} than we send (someone made it shorter): keep the first ones, join the rest into the last
      const want = /expected number of params \((\d+)\)/.exec(err);
      if (want && +want[1] > 0 && +want[1] < params.length) {
        const n = +want[1]; const head = params.slice(0, n - 1); const tail = params.slice(n - 1).map(([, v]) => v).filter(Boolean).join(' - ');
        params = head.concat([[String(n), tail]]).map(([k, v], i) => [/^\d+$/.test(k) || !k ? String(i + 1) : k, v]) as [string, string][];
        ({ j, err } = await call(params));
      }
      await keepOut(m.to, 'template', params.map(([k, v]) => k + ': ' + v).join(' | '), m.template, j.messages?.[0]?.id || '', err, m.doc ? fileName : '', m.name).catch(() => {});
      return err;
    };

    // Reply with free text to someone who has written to us (WhatsApp allows it for 24 hours)
    if (b.action === 'reply') {
      if (!isAdmin) return out({ error: 'Only Admin can reply' }, 403);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)' }, 400);
      const to = String(b.to || '').replace(/\D/g, ''); const text = String(b.text || '').trim();
      if (!to || !text) return out({ error: 'Number and message are required' }, 400);
      if (text.length > 4000) return out({ error: 'Message is too long (max 4000 characters)' }, 400);
      const [{ data: last }] = await Promise.all([db.from('nx_wa_msgs').select('at').eq('wa', to).eq('dir', 'in').order('at', { ascending: false }).limit(1), actor()]);
      if (!last || !last.length) return out({ error: 'This number has not written to us — only templates can be sent to it' }, 400);
      // reply to one message: WhatsApp shows it quoted on the phone
      const replyTo = /^wamid\.[\w=+/-]+$/.test(String(b.reply_to || '')) ? String(b.reply_to) : '';
      const r = await fetch(GRAPH + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: false }, ...(replyTo ? { context: { message_id: replyTo } } : {}) }) });
      const j = await r.json().catch(() => ({}));
      const err = j.messages && j.messages.length ? '' : String(j.error?.error_data?.details || j.error?.message || r.status);
      const wamid = j.messages?.[0]?.id || '';
      await keepOut(to, 'text', text, '', wamid, err, '', '', replyTo);
      return err ? out({ ok: false, error: err }) : out({ ok: true, id: wamid });
    }
    // Photo / file / video / voice note from the chat screen (the browser sends the file as base64)
    if (b.action === 'send_media') {
      if (!isAdmin) return out({ error: 'Only Admin can send files' }, 403);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)' }, 400);
      const to = String(b.to || '').replace(/\D/g, ''); if (!to) return out({ error: 'Number is required' }, 400);
      const mime = String(b.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
      const kind = ['image', 'video', 'audio', 'document'].includes(String(b.kind)) ? String(b.kind) : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
      const filename = String(b.filename || (kind + '.' + (mime.split('/')[1] || 'bin'))).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
      const caption = String(b.caption || '').trim().slice(0, 1024);
      const replyTo = wamidOk(b.reply_to) ? String(b.reply_to) : '';
      const closed = await chatOpen(to); if (closed) return out({ error: closed }, 400);
      const up = await uploadMedia(b.data, mime, filename, kind);
      if (!up.id) { await keepOut(to, kind, caption, '', '', up.error || 'Upload failed', filename); return out({ ok: false, error: up.error }); }
      const media: Doc = { id: up.id };
      if (kind === 'document') media.filename = filename;
      if (caption && kind !== 'audio') media.caption = caption;
      const [wamid, err] = await sendRaw({ to, type: kind, [kind]: media, ...(replyTo ? { context: { message_id: replyTo } } : {}) });
      await keepOut(to, kind, caption, '', wamid, err, filename, '', replyTo, up.id, mime);
      return err ? out({ ok: false, error: err }) : out({ ok: true, id: wamid, media_id: up.id });
    }
    // Emoji reaction on one message (empty emoji removes ours)
    if (b.action === 'react') {
      if (!isAdmin) return out({ error: 'Only Admin can react' }, 403);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)' }, 400);
      const mid = String(b.message_id || ''); if (!wamidOk(mid)) return out({ error: 'Message not found' }, 400);
      const { data: row } = await db.from('nx_wa_msgs').select('wa, dir').eq('id', mid).maybeSingle();
      if (!row) return out({ error: 'Message not found' }, 404);
      const emoji = String(b.emoji || '').trim().slice(0, 8);
      const closed = await chatOpen(row.wa); if (closed) return out({ error: closed }, 400);
      const [wamid, err] = await sendRaw({ to: row.wa, type: 'reaction', reaction: { message_id: mid, emoji } });
      if (err) return out({ ok: false, error: err });
      // one reaction of ours per message: replace the old one
      await db.from('nx_wa_msgs').delete().eq('type', 'reaction').eq('dir', 'out').eq('reply_to', mid);
      if (emoji) await keepOut(row.wa, 'reaction', emoji, '', wamid, '', '', '', mid);
      return out({ ok: true, id: wamid });
    }
    // Forward one message (text or attachment) to another chat
    if (b.action === 'forward') {
      if (!isAdmin) return out({ error: 'Only Admin can forward' }, 403);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)' }, 400);
      const to = String(b.to || '').replace(/\D/g, ''); const src = String(b.id || '');
      if (!to || !src) return out({ error: 'Message and number are required' }, 400);
      const { data: m } = await db.from('nx_wa_msgs').select('*').eq('id', src).maybeSingle();
      if (!m) return out({ error: 'Message not found' }, 404);
      const closed = await chatOpen(to); if (closed) return out({ error: closed }, 400);
      let payload: Doc; let type = String(m.type || 'text');
      if (m.media_id && ['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
        const media: Doc = { id: m.media_id }; if (type === 'document' && m.filename) media.filename = m.filename; if (m.body && type !== 'audio' && type !== 'sticker') media.caption = m.body;
        payload = { to, type, [type]: media };
      } else {
        const text = String(m.template ? (m.template + ': ' + (m.body || '')) : m.body || '').trim(); if (!text) return out({ error: 'Nothing to forward' }, 400);
        type = 'text'; payload = { to, type: 'text', text: { body: text, preview_url: false } };
      }
      const [wamid, err] = await sendRaw(payload);
      if (err && m.media_id) return out({ ok: false, error: 'Could not forward the attachment (WhatsApp keeps files for 30 days): ' + err });
      await keepOut(to, type, type === 'text' ? String(payload.text.body) : String(m.body || ''), '', wamid, err, m.filename || '', '', '', m.media_id || '', m.media_mime || '');
      return err ? out({ ok: false, error: err }) : out({ ok: true, id: wamid });
    }
    // Start a chat with a user or vendor: only an approved template can open a conversation
    if (b.action === 'start') {
      if (!isAdmin) return out({ error: 'Only Admin can start a chat' }, 403);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)' }, 400);
      const to = phone(b.to); if (!to) return out({ error: 'Enter a valid 10-digit mobile number' }, 400);
      // the number must belong to a Nexus user or vendor: this function never messages arbitrary numbers
      const people = [...(await db.from('nx_docs').select('data').eq('collection', 'users')).data || [], ...(await db.from('nx_docs').select('data').eq('collection', 'vendors')).data || []].map((r: { data: Doc }) => r.data);
      const who = people.find((x) => phone(x.mobile) === to);
      if (!who) return out({ error: 'This number is not a Nexus user or vendor' }, 400);
      const tpl = String(b.template || Deno.env.get('WA_HELLO_TEMPLATE') || 'nexus_hello').replace(/[^a-z0-9_]/g, '').slice(0, 64);
      const name = safe(who.name);
      const tryLang = async (lang: string) => sendRaw({ to, type: 'template', template: { name: tpl, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }] } });
      let [wamid, err] = await tryLang('en');
      if (err && /language|locale/i.test(err)) [wamid, err] = await tryLang('en_US');
      if (err && /parameter|component/i.test(err)) [wamid, err] = await sendRaw({ to, type: 'template', template: { name: tpl, language: { code: 'en' } } });   // template without a name parameter
      await keepOut(to, 'template', 'name: ' + name, tpl, wamid, err, '', String(who.name || ''));
      return err ? out({ ok: false, error: err }) : out({ ok: true, id: wamid, wa: to });
    }
    // Delete messages or a whole chat from Nexus (WhatsApp does not allow deleting them from the other phone)
    if (b.action === 'delete') {
      if (!isAdmin) return out({ error: 'Only Admin can delete chats' }, 403);
      const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(Boolean).slice(0, 500) : [];
      const wa = String(b.wa || '').replace(/\D/g, '');
      if (!ids.length && !wa && b.wa !== '') return out({ error: 'Nothing to delete' }, 400);
      const q = db.from('nx_wa_msgs').delete({ count: 'exact' });
      const { error, count } = ids.length ? await q.in('id', ids) : await q.eq('wa', wa);
      if (error) return out({ error: error.message }, 500);
      return out({ ok: true, deleted: count || 0 });
    }
    // Open a photo / document someone sent us
    if (b.action === 'media') {
      if (!isAdmin) return out({ error: 'Only Admin can open attachments' }, 403);
      const mid = String(b.media_id || '');
      const { data: row } = await db.from('nx_wa_msgs').select('media_mime, filename').eq('media_id', mid).limit(1).maybeSingle();
      if (!row) return out({ error: 'Attachment not found' }, 404);
      const meta = await (await fetch(GRAPH + mid, { headers: { Authorization: 'Bearer ' + token } })).json().catch(() => ({}));
      if (!meta.url) return out({ error: 'Attachment is no longer available on WhatsApp' }, 404);
      const bin = new Uint8Array(await (await fetch(meta.url, { headers: { Authorization: 'Bearer ' + token } })).arrayBuffer());
      if (bin.length > 12 * 1024 * 1024) return out({ error: 'Attachment is too large to open here' }, 413);
      let s = ''; for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
      return out({ ok: true, mime: row.media_mime || meta.mime_type || 'application/octet-stream', filename: row.filename || '', data: btoa(s) });
    }
    // Super Admin: one sample of every template to one number, to check the WhatsApp setup
    if (b.action === 'test') {
      if (me.role !== 'superadmin') return out({ error: 'Only a Super Admin can send test messages' }, 403);
      const to = phone(b.to); if (!to) return out({ error: 'Enter a valid 10-digit mobile number' }, 400);
      if (!token || !phoneId) return out({ error: 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID missing in Supabase secrets)' }, 400);
      ctx = { event: 'test', rid: '', ref: 'Test' };
      const S: Msg[] = [
        { to, name: '', template: 'po_approval_request', params: [['po_number', 'TEST/PO/001'], ['creator_name', 'Nexus Test']] },
        { to, name: '', template: 'po_approval_vendor', params: [['po_number', 'TEST/PO/001'], ['total_amount', '1180.00'], ['delivery_date', '05-Oct-2026']], doc: true },
        { to, name: '', template: 'po_approval_creator', params: [['po_number', 'TEST/PO/001'], ['creator_name', 'Nexus Test']], doc: true },
        { to, name: '', template: 'gate_entry_alert', params: [['vendor_name', 'Test Vendor'], ['invoice_no', 'INV-TEST-1']] },
        { to, name: '', template: 'invoice_approved_store', params: [['invoice_no', 'INV-TEST-1'], ['vendor_name', 'Test Vendor']] },
        { to, name: '', template: 'swatch_reject_merchant', params: [['invoice_no', 'INV-TEST-1'], ['vendor_name', 'Test Vendor']] },
        { to, name: '', template: 'excess_approval_md', params: [['vendor_name', 'Test Vendor'], ['invoice_no', 'INV-TEST-1']] },
        { to, name: '', template: 'grn_accounts_alert', params: [['vendor_name', 'Test Vendor'], ['total_qty', '100']], doc: true },
        { to, name: '', template: 'grn_vendor_alert', params: [['vendor_name', 'Test Vendor']], doc: true },
        { to, name: '', template: 'jc_review_merchant', params: [['merchant_name', 'Nexus Test'], ['job_card', 'ZF-TEST']], doc: true },
        { to, name: '', template: 'material_reservation_alert', params: [['job_card', 'ZF-TEST'], ['items_list', 'EVA-10 120 PAIR; SIL0785 240 PAIR'], ['total_qty', '120']] },
        { to, name: '', template: 'pending_po_purchase', params: [['job_card', 'ZF-TEST'], ['items_list', 'EVA-10 short 40 PAIR']] },
        { to, name: '', template: 'requisition_pending_alert', params: [['1', 'REQ-TEST'], ['2', 'ZF-TEST'], ['3', '2'], ['4', 'https://nexus']] },
        { to, name: '', template: 'order_cancel_alert', params: [['1', 'ZF-TEST'], ['2', 'TEST/PO/001'], ['3', 'Test Vendor']] },
        { to, name: '', template: 'debit_note_vendor', params: [['1', 'Test Vendor'], ['2', 'INV-TEST-1'], ['3', 'EVA-10']], doc: true },
        { to, name: '', template: 'high_alert_material_issue', params: [['1', 'ZF-TEST'], ['2', 'Stitching']] },
        { to, name: '', template: 'production_no_material_alert', params: [['1', 'ZF-TEST']] },
        { to, name: '', template: 'low_stock_alert', params: [['1', 'EVA-10 (Current 10 PAIR / Min 100 PAIR)']] },
        { to, name: '', template: 'po_revised_vendor', params: [['old_po_number', 'TEST/PO/001'], ['po_number', 'TEST/PO/002'], ['total_amount', '1100.00'], ['delivery_date', '05-Oct-2026']], doc: true },
        { to, name: '', template: 'vendor_delivery_due', params: [['1', 'Test Vendor'], ['2', 'EVA-10 (qty 100, due 05-Oct-2026)'], ['3', 'TEST/PO/001'], ['4', '05-Oct-2026']] },
        { to, name: '', template: 'nexus_followup', params: [['1', 'Nexus Test'], ['2', 'TEST/PO/001'], ['3', 'Delivery of EVA sheets due on 05-Nov-2026']] },
        { to, name: '', template: 'nexus_daily_brief', params: [['1', 'Nexus'], ['2', 'Meetings today: 2 | Late tasks: 3 | Decisions pending: 1 | Follow-ups today: 2']] }
      ];
      const up = await uploadPdf(b.pdf, 'Nexus_Test.pdf');
      const results: { template: string; ok: boolean; error: string }[] = [];
      for (const m of S) {
        let err = '';
        if (m.doc && !up.id) { err = up.error || 'PDF upload failed'; await keepOut(to, 'template', m.params.map(([k, v]) => k + ': ' + v).join(' | '), m.template, '', err, 'Nexus_Test.pdf'); }
        else err = await sendTpl(m, up.id || '', 'Nexus_Test.pdf');
        results.push({ template: m.template, ok: !err, error: err });
      }
      return out({ ok: results.every((r) => r.ok), results });
    }

    // ----- business events: recipients and parameters come from the records -----
    const getDoc = async (col: string, key: string) => (await db.from('nx_docs').select('data').eq('collection', col).eq('id', key).maybeSingle()).data?.data as Doc | undefined;
    const all = async (col: string) => ((await db.from('nx_docs').select('data').eq('collection', col)).data || []).map((r: { data: Doc }) => r.data);
    const users = (await all('users')).filter((u) => u.active !== false);
    const byName = Object.fromEntries(users.map((u) => [norm(u.name), u]));
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
        // a price revision is approved by the CEO (Super Admin)
        msgs = staff(p.revised_from ? superAdmins() : heads(/PURCHASE/), 'po_approval_request', [['po_number', safe(p.no)], ['creator_name', safe(p.created_by)]]);
      } else {
        if (p.approval !== 'Approved') return out({ error: 'PO is not approved' }, 409);
        needPdf = true; pdfName = String(p.no || 'Purchase_Order').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
        const total = (p.lines || []).reduce((a: number, l: Doc) => a + num(l.rate) * num(l.qty) * (1 + num(l.gst) / 100), 0);
        const v = await vendorOf(p.vendor);
        // price revision: the vendor is told the earlier PO is cancelled and this one replaces it
        if (p.revised_from) msgs.push({ to: phone(v?.mobile), name: String(p.vendor || ''), template: 'po_revised_vendor', params: [['old_po_number', safe(p.revised_from)], ['po_number', safe(p.no)], ['total_amount', total.toFixed(2)], ['delivery_date', fmtD(p.expected)]], doc: true });
        else msgs.push({ to: phone(v?.mobile), name: String(p.vendor || ''), template: 'po_approval_vendor', params: [['po_number', safe(p.no)], ['total_amount', total.toFixed(2)], ['delivery_date', fmtD(p.expected)]], doc: true });
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
    } else if (event === 'jc_created') {
      // job card made: PDF to the brand merchandiser, reservation list to Store, short items to Purchase
      const j = await getDoc('job_cards', id); if (!j) return out({ error: 'Job card not found' }, 404);
      ref = j.no; needPdf = true; pdfName = 'JobCard_' + String(j.no || '').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
      const mats = Object.fromEntries((await all('materials')).map((m) => [norm(m.code), m]));
      const lineTxt = (l: Doc, q: number) => safe((mats[norm(l.material)]?.name || l.material) + ' ' + qty(q) + ' ' + (l.uom || mats[norm(l.material)]?.uom || ''));
      const cust = (await all('customers')).find((c) => norm(c.name) === norm(j.brand));
      let merch = cust && cust.merchandiser ? [byFirstName(cust.merchandiser)].filter(Boolean) as Doc[] : [];
      if (!merch.length) merch = dept(/MERCHAND/).filter((u) => /SR|HEAD|MANAGER/.test(norm(u.designation)));
      msgs = merch.map((u) => ({ to: phone(u.mobile), name: String(u.name || ''), template: 'jc_review_merchant', params: [['merchant_name', safe(u.name)], ['job_card', safe(j.no)]] as [string, string][], doc: true }));
      const items = (j.lines || []).map((l: Doc) => lineTxt(l, num(l.required))).join('; ').slice(0, 750) || 'NA';
      msgs.push(...staff(dept(/STORE/), 'material_reservation_alert', [['job_card', safe(j.no)], ['items_list', items], ['total_qty', qty(num(j.qty))]]));
      const short = String(b.short || '').replace(/[\r\n\t]+/g, ' ').slice(0, 750);
      if (short) msgs.push(...staff(dept(/PURCHASE/), 'pending_po_purchase', [['job_card', safe(j.no)], ['items_list', safe(short)]]));
    } else if (event === 'requisition') {
      const r = await getDoc('requisitions', id); if (!r) return out({ error: 'Requisition not found' }, 404);
      ref = r.no;
      const link = /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(String(b.link || '')) ? String(b.link) : 'Nexus';
      msgs = staff(dept(/STORE/), 'requisition_pending_alert', [['1', safe(r.no)], ['2', safe(r.jc_no || r.dept || '-')], ['3', String((r.lines || []).length)], ['4', link]]);
    } else if (event === 'order_cancel') {
      const o = await getDoc('orders', id); if (!o) return out({ error: 'Order not found' }, 404);
      if (o.priority !== 'Cancelled') return out({ error: 'Order is not cancelled' }, 409);
      ref = o.no;
      const jcs = (o.lines || []).map((l: Doc) => norm(l.jc_no)).filter(Boolean);
      const pos = (await all('purchase_orders')).filter((p) => !p.cancelled && (p.lines || []).some((l: Doc) => jcs.includes(norm(l.jc_no))));
      msgs = staff(dept(/PURCHASE/), 'order_cancel_alert', [['1', safe(jcs.join(', ') || o.no)], ['2', safe(pos.map((p) => p.no).join(', ') || '-')], ['3', safe([...new Set(pos.map((p) => p.vendor))].join(', ') || '-')]]);
    } else if (event === 'debit_note') {
      // checklist task "Debit Note …" closed with the debit note PDF: the PDF goes to the vendor
      const [tid] = id.split('|'); const t = await getDoc('checklist', tid); if (!t) return out({ error: 'Debit note task not found' }, 404);
      if (!t.vendor) { const m = /Debit Note\s*[—-]\s*(.*?)\s*\((.*)\)\s*:/.exec(String(t.title || '')); if (m) { t.invoice = m[1]; t.vendor = m[2]; } }
      if (!t.vendor) return out({ error: 'Vendor not known for this debit note' }, 400);
      ref = t.invoice || t.title; needPdf = true; pdfName = 'DN_' + String(t.invoice || 'DN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30) + '.pdf';
      const v = await vendorOf(t.vendor);
      msgs = [{ to: phone(v?.mobile), name: String(t.vendor), template: 'debit_note_vendor', params: [['1', safe(t.vendor)], ['2', safe(t.invoice || '-')], ['3', safe(t.items || '-')]], doc: true }];
    } else if (event === 'prod_no_material') {
      const pr = await getDoc('prod_reports', id); if (!pr) return out({ error: 'Production report not found' }, 404);
      ref = pr.jc_no;
      const issued = (await all('issues')).some((i) => [i.jc, i.to_jc, i.jc_no].some((x) => x && norm(x) === norm(pr.jc_no)) && i.status === 'Approved');
      if (issued) return out({ ok: true, skipped: 'material was issued' });
      msgs = staff(dept(/STORE|PLANNING|PPC/), 'high_alert_material_issue', [['1', safe(pr.jc_no)], ['2', safe(pr.stage)]]);
      msgs.push(...staff(superAdmins(), 'production_no_material_alert', [['1', safe(pr.jc_no)]]));
    } else if (event === 'low_stock') {
      // once a day: the list of items below their minimum level, worked out from stock the app shows
      ref = 'Low stock ' + id; round = id;
      const text = String(b.text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 750);
      if (!text) return out({ ok: true, skipped: 'nothing below minimum' });
      msgs = staff(dept(/PURCHASE/), 'low_stock_alert', [['1', text]]);
    } else if (event === 'delivery_due') {
      // daily reminder to a vendor: PO items due within 7 days or overdue up to 21 days
      const [vname, day] = [id.split('|')[0], id.split('|')[1] || '']; ref = vname; round = day;
      const today = new Date(day ? day + 'T00:00:00' : Date.now());
      const due: { item: string; q: number; d: Date; po: string }[] = [];
      const mats = Object.fromEntries((await all('materials')).map((m) => [norm(m.code), m]));
      (await all('purchase_orders')).filter((p) => !p.cancelled && p.approval === 'Approved' && norm(p.vendor) === norm(vname) && p.expected).forEach((p) => {
        const d = new Date(p.expected + 'T00:00:00'); const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (diff > 7 || diff < -21) return;
        (p.lines || []).forEach((l: Doc) => { const left = num(l.qty) - num(l.received); if (left > 1e-9) due.push({ item: String(mats[norm(l.material)]?.name || l.material), q: left, d, po: p.no }); });
      });
      if (!due.length) return out({ ok: true, skipped: 'nothing due' });
      due.sort((a, c) => a.d.getTime() - c.d.getTime());
      const fd = (d: Date) => String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + d.getFullYear();
      const items = due.slice(0, 15).map((x) => x.item + ' (qty ' + qty(x.q) + ', due ' + fd(x.d) + ')').join(', ') + (due.length > 15 ? ', +' + (due.length - 15) + ' more' : '');
      const v = await vendorOf(vname);
      msgs = [{ to: phone(v?.mobile), name: vname, template: 'vendor_delivery_due', params: [['1', safe(vname)], ['2', safe(items)], ['3', safe([...new Set(due.map((x) => x.po))].join(', '))], ['4', fd(due[0].d)]] }];
    } else if (event === 'followup') {
      // EA follow-up reminder: a short text to one user / vendor / contact, at the time set in Nexus
      const f = await getDoc('followups', id); if (!f) return out({ error: 'Follow-up not found' }, 404);
      if (f.status === 'Cancelled') return out({ error: 'Follow-up is cancelled' }, 409);
      ref = f.no;
      const people = [...users, ...(await all('vendors')), ...(await all('contacts'))];
      const who = people.find((x) => norm(x.name) === norm(f.to_name) || (f.mobile && phone(x.mobile) === phone(f.mobile)));
      if (!who) return out({ error: f.to_name + ' is not a Nexus user, vendor or contact' }, 400);
      msgs = [{ to: phone(who.mobile), name: String(who.name || ''), template: 'nexus_followup', params: [['1', safe(who.name)], ['2', safe(f.ref || f.no)], ['3', safe(f.text)]] }];
    } else if (event === 'daily_brief') {
      // morning brief to the Super Admins (and the EA): today's meetings, late tasks, pending decisions / follow-ups — text built in the app
      ref = 'Daily brief ' + id; round = id;
      const text = String(b.text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 900);
      if (!text) return out({ ok: true, skipped: 'nothing to brief' });
      const eaUsers = users.filter((u) => /EXECUTIVE ASSISTANT/.test(norm(u.designation)));
      msgs = [...superAdmins(), ...eaUsers].map((u) => ({ to: phone(u.mobile), name: String(u.name || ''), template: 'nexus_daily_brief', params: [['1', safe(String(u.name || '').split(/[\s(]/)[0])], ['2', text]] as [string, string][] }));
    } else return out({ error: 'Unknown event' }, 400);
    ctx = { event, rid: id, ref };

    // one send per event and record, unless an Admin asks to resend
    const logKey = event + '|' + id + (round && round !== '0' ? '|' + round : '');
    if (!resend) {
      const { data: prev } = await db.from('nx_docs').select('id').eq('collection', 'wa_log').eq('data->>key', logKey).eq('data->>status', 'sent').limit(1);
      if (prev && prev.length) return out({ ok: true, skipped: 'already sent' });
    }

    const now = new Date().toISOString();
    const by = await actor();
    const log = (m: Msg, status: string, error = '') => ({ collection: 'wa_log', id: crypto.randomUUID(), data: { id: '', key: logKey, rid: id, event, ref, template: m.template, to: m.to, name: m.name, params: m.params.map(([k, v]) => k + ': ' + v).join(' | ') + (m.doc ? ' | PDF' : ''), status, error, at: now, by } });

    // unique recipients per template; people we cannot reach are recorded, not dropped silently
    const seen = new Set<string>(); msgs = msgs.filter((m) => { const k = m.template + m.to; if (m.to && seen.has(k)) return false; seen.add(k); return true; });
    const rows: ReturnType<typeof log>[] = [];
    const finish = async () => { rows.forEach((r) => { r.data.id = r.id; }); if (rows.length) await db.from('nx_docs').insert(rows); };
    const notSent = (m: Msg, why: string) => keepOut(m.to || '', 'template', m.name + ' — ' + m.params.map(([k, v]) => k + ': ' + v).join(' | '), m.template, '', why, m.doc ? pdfName : '', m.name).catch(() => {});

    if (!token || !phoneId) { for (const m of msgs) { rows.push(log(m, 'not_configured', 'WhatsApp is not set up')); await notSent(m, 'WhatsApp is not set up (WA_TOKEN / WA_PHONE_ID)'); } await finish(); return out({ ok: false, error: 'WhatsApp is not set up yet', count: msgs.length }); }

    let media = '';
    if (needPdf) {
      const up = await uploadPdf(b.pdf, pdfName);
      if (!up.id) { for (const m of msgs) { rows.push(log(m, 'failed', up.error || 'PDF upload failed')); await notSent(m, up.error || 'PDF upload failed'); } await finish(); return out({ ok: false, error: up.error }); }
      media = up.id;
    }

    let sent = 0, failed = 0;
    for (const m of msgs) {
      if (!m.to) { rows.push(log(m, 'no_mobile', 'No valid mobile number')); await notSent(m, 'No valid mobile number for ' + (m.name || 'this person')); failed++; continue; }
      let err = await sendTpl(m, media, pdfName);
      // revised-PO template not approved in Meta yet: the vendor still gets the new PO with the normal template
      if (err && m.template === 'po_revised_vendor') { rows.push(log(m, 'failed', err)); m.template = 'po_approval_vendor'; m.params = m.params.filter(([k]) => k !== 'old_po_number'); err = await sendTpl(m, media, pdfName); }
      if (!err) { rows.push(log(m, 'sent')); sent++; } else { rows.push(log(m, 'failed', err)); failed++; }
    }
    await finish();
    return out({ ok: failed === 0, sent, failed });
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
