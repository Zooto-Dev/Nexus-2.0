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
  const go = () => pushCall({ action: 'task', id: String(id) }).catch(e => {
    if (/not found/i.test(e.message) && ++n < 4) setTimeout(go, n * 2500); else console.error('push', e.message);
  });
  setTimeout(go, 1500);
}
// a flow step that has just opened for its doer
function pushStep(col, id, doer, step) {
  if (!CLOUD || DEMO || !id || !doer) return;
  setTimeout(() => { pushCall({ action: 'step', col: col, id: String(id), doer: doer, step: step }).catch(e => console.error('push', e.message)); }, 1200);
}

// the browser tells us when the app can be installed; we keep the offer for our own button
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PUSH.install = e; if (window.NX_APP === 'mobile' && typeof VIEWS === 'object' && VIEWS.mytasks && curView && curView().v === 'mytasks') VIEWS.mytasks.render(); });
window.addEventListener('appinstalled', () => { PUSH.install = null; });
// register the worker on every open, and refresh the subscription if the browser replaced it
if (PUSH_OK()) setTimeout(async () => {
  await pushReg();
  try { if (Notification.permission === 'granted' && !(await pushSub())) await pushEnable(); } catch (e) { }
}, 2500);
