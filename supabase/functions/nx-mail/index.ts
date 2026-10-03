// Nexus 2.0 mail sender: hands a queued mail (nx_docs collection 'mail_queue') to the Google Apps Script mailer.
// The browser only says WHICH queued mail to send; the text and recipients are read here from the database,
// and recipients must be a known address (Settings alert emails, users, vendors), so nobody can use this to
// mail arbitrary people from the company account.
// Secrets (Supabase → Edge Functions → Secrets): GAS_MAIL_URL (Apps Script web-app URL), GAS_MAIL_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Doc = Record<string, any>;
const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const list = (s: unknown) => String(s ?? '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const MAX_PDF = 5 * 1024 * 1024;

function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function jwtUser(jwt: string): string {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
    return p.role === 'authenticated' ? String(p.sub || '') : '';
  } catch (_e) { return ''; }
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    const uid = jwtUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!uid) return out({ error: 'Not signed in' }, 401);
    const { data: me } = await db.from('nx_profiles').select('role, email').eq('user_id', uid).maybeSingle();
    if (!me) return out({ error: 'No Nexus profile for this login' }, 403);
    const isAdmin = ['superadmin', 'admin'].includes(me.role);

    const url = Deno.env.get('GAS_MAIL_URL') || '', secret = Deno.env.get('GAS_MAIL_SECRET') || '';
    if (!/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(url) || !secret) return out({ ok: false, error: 'Mail is not set up yet (GAS_MAIL_URL / GAS_MAIL_SECRET)' });

    // addresses Nexus may write to
    const docs = async (col: string) => ((await db.from('nx_docs').select('data').eq('collection', col)).data || []).map((r: { data: Doc }) => r.data);
    const [settingsRow, users, vendors] = await Promise.all([db.from('nx_docs').select('data').eq('collection', 'settings').eq('id', 'main').maybeSingle(), docs('users'), docs('vendors')]);
    const allowed = new Set<string>();
    Object.values((settingsRow.data?.data || {}) as Doc).forEach((v) => { if (typeof v === 'string') list(v).filter((x) => EMAIL.test(x)).forEach((x) => allowed.add(x)); });
    [...users, ...vendors].forEach((u) => list(u.email).filter((x) => EMAIL.test(x)).forEach((x) => allowed.add(x)));

    const sendOne = async (row: Doc, pdf?: { b64: string; name: string }) => {
      const to = list(row.to), cc = list(row.cc);
      const bad = [...to, ...cc].find((x) => !EMAIL.test(x) || !allowed.has(x));
      let status = 'sent', error = '';
      if (!to.length) { status = 'no_recipient'; error = 'No recipient'; }
      else if (bad) { status = 'failed'; error = bad + ' is not a Nexus user, vendor or Settings alert email'; }
      else {
        const payload: Doc = { secret, to: to.join(','), cc: cc.join(','), subject: String(row.subject || '').slice(0, 250), body: String(row.body || '').slice(0, 20000), ref: String(row.ref || '') };
        // sender settings of this mail type: name, no-reply, reply-to and the Gmail alias to send from
        payload.name = String(row.name || 'Nexus 2.0').replace(/[\r\n<>"]+/g, ' ').slice(0, 80);
        payload.noReply = row.no_reply === true;
        const rt = list(row.reply_to)[0] || '', fr = list(row.from)[0] || '';
        if (EMAIL.test(rt)) payload.replyTo = rt;
        if (EMAIL.test(fr)) payload.from = fr;
        if (pdf) payload.attachments = [{ name: pdf.name, mime: 'application/pdf', data: pdf.b64 }];
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'follow' });
          const j = await r.json().catch(() => ({}));
          if (!j.ok) { status = 'failed'; error = String(j.error || 'Apps Script answered ' + r.status).slice(0, 300); }
        } catch (e) { status = 'failed'; error = String((e as Error).message || e).slice(0, 300); }
      }
      const data = { ...row, status, error, sent_at: status === 'sent' ? new Date().toISOString() : (row.sent_at || ''), tries: (Number(row.tries) || 0) + 1 };
      await db.from('nx_docs').update({ data, updated_at: new Date().toISOString() }).eq('collection', 'mail_queue').eq('id', row.id);
      return { id: row.id, status, error };
    };

    // one queued mail (normal use, right after it is queued); a failed one only by Admin
    if (b.id) {
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', 'mail_queue').eq('id', String(b.id)).maybeSingle();
      const row = rec?.data as Doc | undefined;
      if (!row) return out({ error: 'Mail not found' }, 404);
      if (row.status === 'sent') return out({ ok: true, skipped: 'already sent' });
      if (row.status !== 'queued' && !isAdmin) return out({ error: 'Only Admin can resend a mail' }, 403);
      if (row.attach_pdf && !b.pdf) return out({ error: 'This mail goes with its PDF — send it again from where it was made' }, 400);
      let pdf: { b64: string; name: string } | undefined;
      if (b.pdf) {
        const bytes = atob(String(b.pdf).slice(0, 8)).slice(0, 5);
        if (bytes !== '%PDF-' || String(b.pdf).length > MAX_PDF * 1.4) return out({ error: 'PDF missing or invalid' }, 400);
        pdf = { b64: String(b.pdf), name: String(b.pdf_name || 'Nexus.pdf').replace(/[^\w.-]/g, '_').slice(0, 80) };
      }
      const r = await sendOne(row, pdf);
      return out({ ok: r.status === 'sent', ...r });
    }
    // Admin: send everything still queued (e.g. mails made while mail was not set up)
    if (b.action === 'flush') {
      if (!isAdmin) return out({ error: 'Only Admin' }, 403);
      const rows = (await docs('mail_queue')).filter((r) => r.status === 'queued' && !r.attach_pdf).slice(0, 25);
      const res = [];
      for (const r of rows) res.push(await sendOne(r));
      return out({ ok: res.every((r) => r.status === 'sent'), sent: res.filter((r) => r.status === 'sent').length, failed: res.filter((r) => r.status !== 'sent').length });
    }
    return out({ error: 'Nothing to do' }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
