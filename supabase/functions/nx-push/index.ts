// Nexus 2.0 push notifications: one phone gets told when a task lands on its person.
// The VAPID key pair is made here on first use and never leaves the server (table nx_push_keys, no RLS policy).
// The browser only says WHICH task to announce; the words are built here from the record, so nobody can
// push arbitrary text to someone else's phone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Doc = Record<string, any>;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? m[3] + '-' + MON[+m[2] - 1] + '-' + m[1] : ''; };

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
// every call is written down, so a notification that did not arrive can be explained
const logIt = (row: Doc) => db.from('nx_push_log').insert(row).then(() => { }, () => { });
const APP_URL = Deno.env.get('NX_APP_URL') || 'https://zooto-dev.github.io/Nexus-2.0/app.html';

// the key pair lives in the database; it is made once, on the first call
async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await db.from('nx_push_keys').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (data?.public_key) return { publicKey: data.public_key, privateKey: data.private_key };
  const k = webpush.generateVAPIDKeys();
  await db.from('nx_push_keys').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  return k;
}
// send one notification to every phone of these people; dead subscriptions are dropped
async function pushTo(userIds: string[], payload: Doc): Promise<{ sent: number; gone: number }> {
  if (!userIds.length) return { sent: 0, gone: 0 };
  const { data: subs } = await db.from('nx_push_subs').select('*').in('user_id', userIds);
  if (!subs || !subs.length) return { sent: 0, gone: 0 };
  const k = await vapid();
  webpush.setVapidDetails('mailto:ea@zootofashion.com', k.publicKey, k.privateKey);
  let sent = 0, gone = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 });
      sent++; await db.from('nx_push_subs').update({ last_ok: new Date().toISOString(), fails: 0 }).eq('id', s.id);
    } catch (e) {
      const code = Number((e as Doc).statusCode || 0);
      if (code === 404 || code === 410) { await db.from('nx_push_subs').delete().eq('id', s.id); gone++; }
      else await db.from('nx_push_subs').update({ fails: (s.fails || 0) + 1 }).eq('id', s.id);
    }
  }
  return { sent, gone };
}
const docs = async (col: string) => ((await db.from('nx_docs').select('data').eq('collection', col)).data || []).map((r: { data: Doc }) => r.data);
// every login that belongs to this doer name
async function usersOfDoer(doer: string): Promise<string[]> {
  if (!doer) return [];
  const emails = (await docs('users')).filter((u) => u.active !== false && norm(u.doer) === norm(doer)).map((u) => String(u.email || '').toLowerCase()).filter(Boolean);
  if (!emails.length) return [];
  const { data } = await db.from('nx_profiles').select('user_id, email').in('email', emails);
  return (data || []).map((p: Doc) => String(p.user_id));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    // the public key is public by design: the browser needs it to subscribe
    if (b.action === 'key') return out({ ok: true, key: (await vapid()).publicKey });

    const uid = jwtUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!uid) { logIt({ action: String(b.action || ''), err: 'not signed in' }); return out({ error: 'Not signed in' }, 401); }

    if (b.action === 'subscribe') {
      const s = b.sub || {};
      const endpoint = String(s.endpoint || ''); const p256dh = String(s.keys?.p256dh || ''); const auth = String(s.keys?.auth || '');
      if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return out({ error: 'Bad subscription' }, 400);
      const { error } = await db.from('nx_push_subs').upsert({ id: endpoint, user_id: uid, doer: clean(b.doer, 60), endpoint, p256dh, auth, agent: clean(b.agent, 120), created_at: new Date().toISOString() }, { onConflict: 'endpoint' });
      if (error) { logIt({ action: 'subscribe', user_id: uid, doer: clean(b.doer, 60), err: error.message }); return out({ error: error.message }, 500); }
      // proof straight away, so nobody has to wonder whether it worked
      const r = await pushTo([uid], { title: 'Nexus', body: 'Notifications are on for this phone.', url: APP_URL + '#/mytasks', tag: 'nx-on' });
      logIt({ action: 'subscribe', user_id: uid, doer: clean(b.doer, 60), sent: r.sent, gone: r.gone, recipients: 1, err: r.sent ? null : 'subscribed but nothing delivered' });
      return out({ ok: true, ...r });
    }
    if (b.action === 'unsubscribe') {
      await db.from('nx_push_subs').delete().eq('endpoint', String(b.endpoint || '')).eq('user_id', uid);
      return out({ ok: true });
    }
    if (b.action === 'test') {
      const r = await pushTo([uid], { title: 'Nexus', body: 'Notifications are working on this phone.', url: APP_URL, tag: 'nx-test' });
      logIt({ action: 'test', user_id: uid, sent: r.sent, gone: r.gone, recipients: 1 });
      return out({ ok: true, ...r });
    }
    // a task that was just given to someone: the words come from the record itself
    if (b.action === 'task') {
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', 'checklist').eq('id', String(b.id || '')).maybeSingle();
      const t = rec?.data as Doc | undefined;
      if (!t) { logIt({ action: 'task', user_id: uid, err: 'task not found: ' + String(b.id || '') }); return out({ error: 'Task not found' }, 404); }
      if (t.active === false || (t.done && Object.keys(t.done).length)) { logIt({ action: 'task', user_id: uid, doer: clean(t.doer, 60), err: 'task not open' }); return out({ ok: true, skipped: 'not open' }); }
      // claim it, so the minute-by-minute scheduler does not announce the same task again
      const { data: claimed } = await db.from('nx_push_seen').upsert({ id: 'new:checklist:' + String(b.id) }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (!claimed || !claimed.length) return out({ ok: true, skipped: 'already announced' });
      const ids = await usersOfDoer(String(t.doer || ''));
      const due = fmtD(t.start || t.due);
      const r = await pushTo(ids, { title: 'New task for you', body: clean(t.title, 120) + (due ? '\nBy ' + due : ''), url: APP_URL + '#/mytasks', tag: 'nx-task-' + String(b.id).slice(-12) });
      logIt({ action: 'task', user_id: uid, doer: clean(t.doer, 60), sent: r.sent, gone: r.gone, recipients: ids.length, err: ids.length ? (r.sent ? null : 'no phone registered for this doer') : 'no login found for this doer' });
      return out({ ok: true, ...r, to: ids.length });
    }
    // a flow step that has just opened for its doer
    if (b.action === 'step') {
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', String(b.col || 'orders')).eq('id', String(b.id || '')).maybeSingle();
      const o = rec?.data as Doc | undefined;
      if (!o) return out({ error: 'Record not found' }, 404);
      const ids = await usersOfDoer(String(b.doer || ''));
      const r = await pushTo(ids, { title: 'New step for you', body: clean(b.step, 90) + '\n' + clean(o.no, 40) + (o.customer_name ? ' · ' + clean(o.customer_name, 40) : ''), url: APP_URL + '#/mytasks', tag: 'nx-step-' + clean(o.no, 20) });
      logIt({ action: 'step', user_id: uid, doer: clean(b.doer, 60), sent: r.sent, gone: r.gone, recipients: ids.length, err: ids.length ? (r.sent ? null : 'no phone registered for this doer') : 'no login found for this doer' });
      return out({ ok: true, ...r, to: ids.length });
    }
    // the person pressed "Stop reminding": that alarm rests, and only its own doer may do it
    if (b.action === 'ack') {
      const { data: al } = await db.from('nx_alarms').select('id, doer').eq('id', String(b.id || '')).maybeSingle();
      if (!al) return out({ ok: true, skipped: 'no such reminder' });
      const mine = await usersOfDoer(String(al.doer || ''));
      if (!mine.includes(uid)) return out({ error: 'This reminder is not yours' }, 403);
      await db.from('nx_alarms').update({ fired_at: new Date().toISOString() }).eq('id', al.id);
      logIt({ action: 'ack', user_id: uid, doer: String(al.doer || '') });
      return out({ ok: true });
    }
    // the app tells the server WHEN each open task or to-do has to ring.
    // The row carries only the record's id and date: the doer and the words are taken from the record here.
    if (b.action === 'alarms') {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 400);
      if (!rows.length) return out({ ok: true, kept: 0 });
      const ids = { checklist: [] as string[], todos: [] as string[] };
      rows.forEach((r: Doc) => { const c = r.kind === 'todo' ? 'todos' : 'checklist'; const id = String(r.ref_id || ''); if (id && !ids[c].includes(id)) ids[c].push(id); });
      const found: Record<string, Doc> = {};
      for (const col of ['checklist', 'todos'] as const) {
        if (!ids[col].length) continue;
        const { data } = await db.from('nx_docs').select('id, data').eq('collection', col).in('id', ids[col]);
        (data || []).forEach((r: Doc) => { found[col + ':' + r.id] = r.data as Doc; });
      }
      const keep: Doc[] = [];
      const horizon = Date.now() + 400 * 86400e3;
      rows.forEach((r: Doc) => {
        const kind = r.kind === 'todo' ? 'todo' : 'task';
        const doc = found[(kind === 'todo' ? 'todos' : 'checklist') + ':' + String(r.ref_id || '')];
        if (!doc || doc.active === false) return;                       // no record, no alarm
        const at = new Date(String(r.at || ''));
        if (isNaN(at.getTime()) || at.getTime() > horizon) return;
        keep.push({ id: String(r.id || '').slice(0, 120), at: at.toISOString(), kind, ref_id: String(r.ref_id), ref_date: String(r.ref_date || '').slice(0, 10), doer: clean(doc.doer, 60), title: clean(doc.title, 160) });
      });
      if (!keep.length) return out({ ok: true, kept: 0 });
      // clear the not-yet-rung alarms of these records first, so a task that moved cannot ring at its old
      // time; the ones that already rang stay, and the upsert below leaves their fired_at alone
      const refs = ids.checklist.concat(ids.todos);
      if (refs.length) await db.from('nx_alarms').delete().in('ref_id', refs).is('fired_at', null);
      const { error } = await db.from('nx_alarms').upsert(keep, { onConflict: 'id' });
      if (error) { logIt({ action: 'alarms', user_id: uid, err: error.message }); return out({ error: error.message }, 500); }
      return out({ ok: true, kept: keep.length });
    }
    return out({ error: 'Unknown action' }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    logIt({ action: 'error', err: msg });
    return out({ error: msg }, 500);
  }
});
