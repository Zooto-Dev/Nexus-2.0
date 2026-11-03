// Nexus 2.0 — the alarm clock. Runs once a minute (pg_cron) and rings whatever is due:
// a task whose planned date and time has arrived, or a to-do reminder. It works whether the
// app is open, closed or uninstalled, because nothing here needs a browser.
// There is no JWT: the only key is x-nx-key, which is kept in public.nx_cron and never leaves the server.
// An alarm row says only WHICH record is due; the words are read from the record itself, right here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Doc = Record<string, any>;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
const APP_URL = Deno.env.get('NX_APP_URL') || 'https://zooto-dev.github.io/Nexus-2.0/app.html';
const logIt = (row: Doc) => db.from('nx_push_log').insert(row).then(() => { }, () => { });

async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await db.from('nx_push_keys').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (data?.public_key) return { publicKey: data.public_key, privateKey: data.private_key };
  const k = webpush.generateVAPIDKeys();
  await db.from('nx_push_keys').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  return k;
}
async function pushTo(userIds: string[], payload: Doc): Promise<{ sent: number; gone: number }> {
  if (!userIds.length) return { sent: 0, gone: 0 };
  const { data: subs } = await db.from('nx_push_subs').select('*').in('user_id', userIds);
  if (!subs || !subs.length) return { sent: 0, gone: 0 };
  const k = await vapid();
  webpush.setVapidDetails('mailto:ea@zootofashion.com', k.publicKey, k.privateKey);
  let sent = 0, gone = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      sent++; await db.from('nx_push_subs').update({ last_ok: new Date().toISOString(), fails: 0 }).eq('id', s.id);
    } catch (e) {
      const code = Number((e as Doc).statusCode || 0);
      if (code === 404 || code === 410) { await db.from('nx_push_subs').delete().eq('id', s.id); gone++; }
      else await db.from('nx_push_subs').update({ fails: (s.fails || 0) + 1 }).eq('id', s.id);
    }
  }
  return { sent, gone };
}
// one lookup of the user list, reused for every alarm in this run
async function doerMap(): Promise<Record<string, string[]>> {
  const users = ((await db.from('nx_docs').select('data').eq('collection', 'users')).data || []).map((r: Doc) => r.data as Doc).filter((u) => u.active !== false && u.doer && u.email);
  const emails = users.map((u) => String(u.email).toLowerCase());
  if (!emails.length) return {};
  const { data: profs } = await db.from('nx_profiles').select('user_id, email').in('email', emails);
  const byEmail: Record<string, string> = {};
  (profs || []).forEach((p: Doc) => { byEmail[String(p.email).toLowerCase()] = String(p.user_id); });
  const map: Record<string, string[]> = {};
  users.forEach((u) => { const id = byEmail[String(u.email).toLowerCase()]; if (!id) return; const k = norm(u.doer); (map[k] || (map[k] = [])).push(id); });
  return map;
}
const doneKey = (t: Doc, ymd: string) => (t.freq === 'Once' || t.type === 'Delegation') ? 'once' : ymd;
// claim a record: the first caller to get it announces it, everyone else stays quiet.
// This is what keeps the browser and the scheduler from both ringing the same task.
async function claim(key: string): Promise<boolean> {
  const { data } = await db.from('nx_push_seen').upsert({ id: key }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  return !!(data && data.length);
}
// anything given out in the last half hour that nobody has been told about yet
async function announceNew(map: Record<string, string[]>): Promise<number> {
  const since = new Date(Date.now() - 30 * 60e3);
  let told = 0;
  for (const col of ['checklist', 'todos'] as const) {
    const { data } = await db.from('nx_docs').select('id, data').eq('collection', col).gte('updated_at', since.toISOString()).limit(300);
    for (const row of data || []) {
      const t = row.data as Doc;
      if (!t || t.active === false) continue;
      if (col === 'checklist' && t.done && Object.keys(t.done).length) continue;
      if (col === 'todos' && t.status === 'Done') continue;
      const made = Date.parse(String(t.created_at || ''));
      if (!made || made < since.getTime()) continue;              // only genuinely new ones
      if (!(await claim('new:' + col + ':' + row.id))) continue;  // somebody already announced it
      const ids = map[norm(t.doer)] || [];
      const r = await pushTo(ids, {
        title: col === 'todos' ? 'New to-do for you' : 'New task for you',
        body: clean(t.title, 120), url: APP_URL + (col === 'todos' ? '#/mytodo' : '#/mytasks'), tag: 'nx-new-' + String(row.id).slice(-14)
      });
      if (r.sent) told++;
      logIt({ action: 'new:' + col, doer: String(t.doer || ''), sent: r.sent, gone: r.gone, recipients: ids.length, err: ids.length ? (r.sent ? null : 'no phone registered for this doer') : 'no login found for this doer' });
    }
  }
  return told;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const { data: ck } = await db.from('nx_cron').select('token').eq('id', 1).maybeSingle();
    if (!ck?.token || req.headers.get('x-nx-key') !== ck.token) {
      // lengths only, never the values, so a mismatch can be told apart from a missing key
      return out({ error: 'Not allowed', header: (req.headers.get('x-nx-key') || '').length, stored: (ck?.token || '').length }, 401);
    }

    const map = await doerMap();
    const told = await announceNew(map);

    // everything that has come due in the last three hours and has not rung yet
    const { data: due } = await db.from('nx_alarms').select('*')
      .is('fired_at', null).lte('at', new Date().toISOString()).gte('at', new Date(Date.now() - 3 * 3600e3).toISOString())
      .order('at').limit(200);
    if (!due || !due.length) return out({ ok: true, due: 0, told });
    let rang = 0, skipped = 0;
    for (const a of due) {
      const col = a.kind === 'todo' ? 'todos' : 'checklist';
      const { data: rec } = await db.from('nx_docs').select('data').eq('collection', col).eq('id', String(a.ref_id)).maybeSingle();
      const t = rec?.data as Doc | undefined;
      const open = !!t && t.active !== false && (a.kind === 'todo'
        ? t.status !== 'Done'
        : !((t.done || {})[doneKey(t, String(a.ref_date || ''))]));
      if (!open) { await db.from('nx_alarms').update({ fired_at: new Date().toISOString() }).eq('id', a.id); skipped++; continue; }
      const doer = String(t!.doer || a.doer || '');
      const ids = map[norm(doer)] || [];
      const r = await pushTo(ids, {
        title: a.kind === 'todo' ? 'To-do reminder' : 'Task due now',
        body: clean(t!.title, 120), url: APP_URL + (a.kind === 'todo' ? '#/mytodo' : '#/mytasks'), tag: 'nx-due-' + String(a.id).slice(-16)
      });
      await db.from('nx_alarms').update({ fired_at: new Date().toISOString() }).eq('id', a.id);
      if (r.sent) rang++;
      logIt({ action: 'due:' + a.kind, doer, sent: r.sent, gone: r.gone, recipients: ids.length, err: ids.length ? (r.sent ? null : 'no phone registered for this doer') : 'no login found for this doer' });
    }
    return out({ ok: true, due: due.length, rang, skipped, told });
  } catch (e) {
    const msg = String((e as Error).message || e);
    logIt({ action: 'due:error', err: msg });
    return out({ error: msg }, 500);
  }
});
