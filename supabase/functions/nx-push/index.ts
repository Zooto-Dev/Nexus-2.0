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
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
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

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await db.auth.getUser(jwt);
    if (!who?.user) return out({ error: 'Not signed in' }, 401);
    const uid = who.user.id;

    if (b.action === 'subscribe') {
      const s = b.sub || {};
      const endpoint = String(s.endpoint || ''); const p256dh = String(s.keys?.p256dh || ''); const auth = String(s.keys?.auth || '');
      if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return out({ error: 'Bad subscription' }, 400);
      const { error } = await db.from('nx_push_subs').upsert({ id: endpoint, user_id: uid, doer: clean(b.doer, 60), endpoint, p256dh, auth, agent: clean(b.agent, 120), created_at: new Date().toISOString() }, { onConflict: 'endpoint' });
      if (error) return out({ error: error.message }, 500);
      return out({ ok: true });
    }
    if (b.action === 'unsubscribe') {
      await db.from('nx_push_subs').delete().eq('endpoint', String(b.endpoint || '')).eq('user_id', uid);
      return out({ ok: true });
    }
    if (b.action === 'test') {
      const r = await pushTo([uid], { title: 'Nexus', body: 'Notifications are working on this phone.', url: APP_URL, tag: 'nx-test' });
      return out({ ok: true, ...r });
    }
    // a task that was just given to someone: the words come from the record itself
    if (b.action === 'task') {
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', 'checklist').eq('id', String(b.id || '')).maybeSingle();
      const t = rec?.data as Doc | undefined;
      if (!t) return out({ error: 'Task not found' }, 404);
      if (t.active === false || (t.done && Object.keys(t.done).length)) return out({ ok: true, skipped: 'not open' });
      const ids = await usersOfDoer(String(t.doer || ''));
      const due = fmtD(t.start || t.due);
      const r = await pushTo(ids, { title: 'New task for you', body: clean(t.title, 120) + (due ? '\nBy ' + due : ''), url: APP_URL + '#/mytasks', tag: 'nx-task-' + String(b.id).slice(-12) });
      return out({ ok: true, ...r, to: ids.length });
    }
    // a flow step that has just opened for its doer
    if (b.action === 'step') {
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', String(b.col || 'orders')).eq('id', String(b.id || '')).maybeSingle();
      const o = rec?.data as Doc | undefined;
      if (!o) return out({ error: 'Record not found' }, 404);
      const ids = await usersOfDoer(String(b.doer || ''));
      const r = await pushTo(ids, { title: 'New step for you', body: clean(b.step, 90) + '\n' + clean(o.no, 40) + (o.customer_name ? ' · ' + clean(o.customer_name, 40) : ''), url: APP_URL + '#/mytasks', tag: 'nx-step-' + clean(o.no, 20) });
      return out({ ok: true, ...r, to: ids.length });
    }
    return out({ error: 'Unknown action' }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
