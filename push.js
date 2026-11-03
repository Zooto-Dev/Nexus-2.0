/* Nexus 2.0 — phone notifications.
   The private key never comes near the browser: nx-push keeps it on the server and hands out
   only the public key. The browser also never sends the words of a notification — it only says
   which task to announce, and nx-push reads the task itself and writes the message. */
'use strict';
const PUSH_OK = () => !!(CLOUD && !DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const PUSH = { reg: null, key: '', install: null, busy: false };

// base64url (as the server sends it) → the byte array subscribe() wants
function pushKeyBytes(k) {
  const s = (k + '='.repeat((4 - k.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const a = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
  return a;
}
const pushCall = async body => {
  const { data, error } = await SB.functions.invoke('nx-push', { body });
  let msg = data && data.error;
  if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
  if (msg) throw new Error(msg);
  return data || {};
};

async function pushReg() {
  if (PUSH.reg) return PUSH.reg;
  if (!PUSH_OK()) return null;
  try { PUSH.reg = await navigator.serviceWorker.register('sw.js', { scope: './' }); await navigator.serviceWorker.ready; } catch (e) { console.error(e); return null; }
  return PUSH.reg;
}
async function pushSub() { const r = await pushReg(); return r ? await r.pushManager.getSubscription() : null; }
// Off → never asked · Blocked → the person said no in the browser · On → the phone is registered
async function pushState() {
  if (!PUSH_OK()) return 'na';
  if (Notification.permission === 'denied') return 'blocked';
  return (await pushSub()) ? 'on' : 'off';
}
async function pushEnable() {
  if (!PUSH_OK()) throw new Error('This browser cannot show notifications. Install the app first.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are switched off for Nexus in the browser settings.');
  const r = await pushReg(); if (!r) throw new Error('Could not start the app service.');
  if (!PUSH.key) PUSH.key = (await pushCall({ action: 'key' })).key || '';
  if (!PUSH.key) throw new Error('No notification key from the server.');
  let s = await r.pushManager.getSubscription();
  if (s && s.options && s.options.applicationServerKey) {
    const cur = btoa(String.fromCharCode.apply(null, new Uint8Array(s.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (cur !== PUSH.key) { try { await s.unsubscribe(); } catch (e) { } s = null; }   // the server key changed
  }
  if (!s) s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(PUSH.key) });
  await pushCall({ action: 'subscribe', sub: s.toJSON(), doer: ME.doer || '', agent: navigator.userAgent.slice(0, 120) });
  return true;
}
async function pushDisable() {
  const s = await pushSub(); if (!s) return true;
  try { await pushCall({ action: 'unsubscribe', endpoint: s.endpoint }); } catch (e) { console.error(e); }
  try { await s.unsubscribe(); } catch (e) { }
  return true;
}
const pushTest = () => pushCall({ action: 'test' });

/* ---- sending ---- */
// a task that has just been given to someone; never blocks the screen and never shows an error
function pushTask(id) {
  if (!CLOUD || DEMO || !id) return;
  // the record is still being written to the cloud, so give it a few tries before giving up
  let n = 0;
  const go = () => pushCall({ action: 'task', id: String(id) }).then(r => {
    // say it plainly when nobody could be reached, so a missing notification is never a mystery
    if (!r.to) flash('Task saved, but no notification: that person has no Nexus login, or their login has no doer name.', 'warn');
    else if (!r.sent) flash('Task saved, but no notification: that person has not switched notifications on in the Nexus app yet.', 'warn');
  }).catch(e => {
    if (/not found/i.test(e.message) && ++n < 4) setTimeout(go, n * 2500); else console.error('push', e.message);
  });
  setTimeout(go, 1500);
}
// a flow step that has just opened for its doer
function pushStep(col, id, doer, step) {
  if (!CLOUD || DEMO || !id || !doer) return;
  setTimeout(() => { pushCall({ action: 'step', col: col, id: String(id), doer: doer, step: step }).catch(e => console.error('push', e.message)); }, 1200);
}

// "Stop reminding" sends the app here with the alarm named; tell the server and tidy the address
function ackFromUrl() {
  let id = '';
  try { id = new URLSearchParams(location.search).get('ack') || ''; } catch (e) { }
  if (!id || !CLOUD || DEMO) return;
  pushCall({ action: 'ack', id: id }).then(() => flash('That reminder has been stopped.'))
    .catch(e => console.error('ack', e.message));
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }
}
if (!DEMO) setTimeout(ackFromUrl, 4000);

/* ---- the bell in the full Nexus header: the same switch, where most people actually sit ---- */
async function bellPaint() {
  const b = document.getElementById('bellBtn'); if (!b) return;
  const st = await pushState();
  b.dataset.st = st;
  b.textContent = st === 'on' ? 'Notifications: on' : st === 'blocked' ? 'Notifications: blocked' : st === 'na' ? '' : 'Notifications: off';
  b.classList.toggle('hidden', st === 'na');
  b.classList.toggle('primary', st === 'off');
}
if (typeof ACTIONS === 'object') ACTIONS['nx-bell'] = async el => {
  const st = el.dataset.st;
  if (st === 'blocked') { flash('Notifications are blocked for Nexus in this browser. Allow them in the browser site settings, then press this again.', 'warn'); return; }
  if (st === 'on') { await pushDisable(); flash('Notifications are off on this computer.'); bellPaint(); return; }
  try { await pushEnable(); flash('Notifications are on. A test notification has been sent to this computer.'); }
  catch (e) { flash(esc(e.message), 'err'); }
  bellPaint();
};
if (!DEMO) setTimeout(bellPaint, 3000);

// the browser tells us when the app can be installed; we keep the offer for our own button
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PUSH.install = e; if (window.NX_APP === 'mobile' && typeof VIEWS === 'object' && VIEWS.mytasks && curView && curView().v === 'mytasks') VIEWS.mytasks.render(); });
window.addEventListener('appinstalled', () => { PUSH.install = null; });
// register the worker on every open, and refresh the subscription if the browser replaced it
if (PUSH_OK()) setTimeout(async () => {
  await pushReg();
  try { if (Notification.permission === 'granted' && !(await pushSub())) await pushEnable(); } catch (e) { }
}, 2500);

/* ---- alarms: the planned date and time of open work, so the server can ring it ----
   The row says only WHICH record and WHICH date; nx-push reads the doer and the words from the
   record itself, and nx-due rings it once a minute — app open, app closed or phone locked. */
const ALARM_DAYS = 21;
// alarm rows for one record (a checklist / delegation task, or a to-do)
function alarmRows(kind, t) {
  const rows = [];
  if (!t || t.active === false) return rows;
  if (kind === 'todo') {
    const at = typeof tdRemindAt === 'function' ? tdRemindAt(t) : null;
    if (at && !isNaN(at)) rows.push({ id: 'todo:' + t.id, at: at.toISOString(), kind: 'todo', ref_id: t.id, ref_date: t.due_date || '' });
    return rows;
  }
  if (typeof clDates !== 'function') return rows;
  const from = todayYmd(), to = ymdOf(new Date(Date.now() + ALARM_DAYS * 86400000));
  const r = clRule(clPin(Object.assign({}, t)));
  clDates(r, from, to).forEach(d => {
    if (clDoneOf(t, d)) return;
    const at = clPlanned(r, d);
    if (!at || isNaN(at)) return;
    rows.push({ id: 'task:' + t.id + ':' + d, at: at.toISOString(), kind: 'task', ref_id: t.id, ref_date: d });
  });
  return rows;
}
const alarmSend = rows => { if (CLOUD && !DEMO && rows.length) pushCall({ action: 'alarms', rows: rows.slice(0, 400) }).catch(e => console.error('alarm', e.message)); };
// one record was just created or changed
function alarmFor(kind, t) {
  if (!CLOUD || DEMO || !t) return;
  const rows = alarmRows(kind, t);
  // a record with nothing left to ring still has to clear its old alarms, so send a placeholder far away
  alarmSend(rows.length ? rows : [{ id: (kind === 'todo' ? 'todo:' : 'task:') + t.id + ':none', at: new Date(Date.now() + 399 * 86400000).toISOString(), kind: kind === 'todo' ? 'todo' : 'task', ref_id: t.id, ref_date: '' }]);
}
// on every open: re-arm my own open work, so a reminder survives a missed day or a changed date
function alarmSync() {
  if (!CLOUD || DEMO || !ME || !ME.doer) return;
  let rows = [];
  Store.all('checklist').filter(t => t.active !== false && norm(t.doer) === norm(ME.doer)).forEach(t => { rows = rows.concat(alarmRows('task', t)); });
  Store.all('todos').filter(t => t.active !== false && t.status !== 'Done' && norm(t.doer) === norm(ME.doer)).forEach(t => { rows = rows.concat(alarmRows('todo', t)); });
  alarmSend(rows);
}

/* ---- the sound, for when the app or Nexus is open on the screen ----
   The phone's own notification sound handles the closed app; this is for the open one. */
let BEEP_CTX = null;
function beep(times) {
  try {
    BEEP_CTX = BEEP_CTX || new (window.AudioContext || window.webkitAudioContext)();
    const c = BEEP_CTX; if (c.state === 'suspended') c.resume();
    for (let i = 0; i < (times || 2); i++) {
      const o = c.createOscillator(), g = c.createGain(); const t0 = c.currentTime + i * 0.45;
      o.type = 'sine'; o.frequency.setValueAtTime(i % 2 ? 760 : 980, t0);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.34);
    }
  } catch (e) { /* a browser that will not make a sound is not a reason to fail */ }
}
const RANG_KEY = 'nexus2_rang';
const rangLoad = () => { try { return new Set(JSON.parse(localStorage.getItem(RANG_KEY) || '[]')); } catch (e) { return new Set(); } };
const rangSave = s => { try { localStorage.setItem(RANG_KEY, JSON.stringify(Array.from(s).slice(-400))); } catch (e) { } };
// anything of mine whose time has come in the last two hours and has not been announced on this screen yet
function alarmWatch() {
  if (!ME || !ME.doer || DEMO) return;
  const rang = rangLoad(); const now = Date.now(); let hit = null, n = 0;
  const check = (id, at, label) => {
    if (!at || isNaN(at)) return;
    const ms = at.getTime();
    if (ms > now || now - ms > 2 * 3600000 || rang.has(id)) return;
    rang.add(id); n++; if (!hit) hit = label;
  };
  try {
    Store.all('checklist').filter(t => t.active !== false && norm(t.doer) === norm(ME.doer)).forEach(t => {
      const r = clRule(clPin(Object.assign({}, t)));
      clDates(r, ymdOf(new Date(now - 86400000)), todayYmd()).forEach(d => { if (!clDoneOf(t, d)) check('task:' + t.id + ':' + d, clPlanned(r, d), t.title); });
    });
    Store.all('todos').filter(t => t.active !== false && t.status !== 'Done' && norm(t.doer) === norm(ME.doer)).forEach(t => check('todo:' + t.id, tdRemindAt(t), t.title));
  } catch (e) { console.error(e); }
  if (!n) return;
  rangSave(rang); beep(3);
  flash('<b>Due now:</b> ' + esc(hit) + (n > 1 ? ' and ' + (n - 1) + ' more' : '') + ' — <a href="#/' + (window.NX_APP === 'mobile' ? 'mytasks' : 'tasks') + '">open</a>', 'warn');
}
// start the watch and the alarm upload once the data is in
if (!DEMO) setTimeout(() => { try { alarmSync(); } catch (e) { console.error(e); } alarmWatch(); setInterval(alarmWatch, 60000); setInterval(alarmSync, 1800000); }, 6000);
