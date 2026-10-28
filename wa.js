/* Nexus 2.0 — WhatsApp messages (Meta Cloud API through the nx-wa edge function).
   The app only tells the server which event happened on which record; the server picks the
   template, parameters and recipients. PO approval and final GRN also send their PDF. */
'use strict';

const WA_PDF = { po_approved: 'po', grn_final: 'grn', jc_created: 'jc' };
const WA_EVENT_LABEL = { po_submitted: 'PO sent for approval', po_approved: 'PO approved', gate_entry: 'Gate entry', invoice_approved: 'Invoice approved', qc_mismatch: 'QC mismatch', excess_pending: 'Excess approval', grn_final: 'GRN', jc_created: 'Job card', requisition: 'Requisition', order_cancel: 'Order cancelled', debit_note: 'Debit note', prod_no_material: 'Production without material', low_stock: 'Low stock', delivery_due: 'Vendor delivery reminder', test: 'Test' };

let WA_LIB = null;
function waLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!WA_LIB) WA_LIB = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'; s.onload = ok; s.onerror = () => { WA_LIB = null; bad(new Error('PDF library did not load')); }; document.head.appendChild(s); });
  return WA_LIB;
}
// the same document the Print button shows, as a PDF (base64, no prefix)
async function waPdf(kind, id) {
  const d = Store.get(kind === 'po' ? 'purchase_orders' : kind === 'jc' ? 'job_cards' : 'grns', id);
  if (!d) throw new Error('Record not found');
  return waHtmlPdf(kind === 'po' ? poDocHtml(d) : kind === 'jc' ? jcDocHtml(d) : grnDocHtml(d));
}
async function waHtmlPdf(html) {
  await waLib();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;background:#fff';
  box.innerHTML = html;
  document.body.appendChild(box);
  try {
    const uri = await window.html2pdf().set({ margin: 6, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }, pagebreak: { mode: ['css', 'legacy'] } }).from(box.firstElementChild).outputPdf('datauristring');
    return uri.slice(uri.indexOf('base64,') + 7);
  } finally { box.remove(); }
}
// wait until our own saves have reached the cloud, so the server reads the latest record
async function waSynced() { for (let t = 0; t < 40 && (pendingWrites > 0 || RETRY_Q.size); t++) await new Promise(r => setTimeout(r, 250)); }

async function waSend(event, id, resend, extra) {
  if (!CLOUD || !SB) return;
  try {
    await waSynced();
    const body = Object.assign({}, extra || {}, { event, id, resend: !!resend });
    if (WA_PDF[event]) body.pdf = await waPdf(WA_PDF[event], id);
    const { data, error } = await SB.functions.invoke('nx-wa', { body });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + ') not sent: ' + esc(msg), 'err');
    else if (data && data.failed) flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + '): ' + data.sent + ' sent, ' + data.failed + ' failed — see WhatsApp Log.', 'err');
    else if (resend && data && data.sent != null) flash('WhatsApp resent to ' + data.sent + '.');
  } catch (e) { flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + ') not sent: ' + esc(e.message), 'err'); }
}

/* ---------- Mail: queued in mail_queue, sent by the nx-mail edge function through Google Apps Script ---------- */
async function mailSend(id, resend, extra) {
  if (!CLOUD || !SB || !id) return;
  try {
    await waSynced();
    const { data, error } = await SB.functions.invoke('nx-mail', { body: Object.assign({}, extra || {}, { id }) });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) flash('Mail not sent: ' + esc(msg), 'err');
    else if (resend && data && data.ok) flash('Mail sent.');
  } catch (e) { flash('Mail not sent: ' + esc(e.message), 'err'); }
}
// Email check before an address is kept (vendors): domain must take mail, a short mail is sent to it,
// and a bounce ("address not found") in the next ~40 s means the address is dropped. Returns {email: {ok, reason}}.
async function verifyEmails(list) {
  const out = {}; const todo = [];
  Array.from(new Set(list.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))).forEach(e => { const er = emailSyntaxError(e); if (er) out[e] = { ok: false, reason: er }; else todo.push(e); });
  if (!todo.length) return out;
  if (!CLOUD || !SB) { todo.forEach(e => out[e] = { ok: true, reason: 'local mode — not checked' }); return out; }
  for (let i = 0; i < todo.length; i += 10) {
    const part = todo.slice(i, i + 10);
    try {
      await waSynced();
      const { data, error } = await SB.functions.invoke('nx-mail', { body: { action: 'verify', emails: part } });
      let msg = data && data.error;
      if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
      if (msg) part.forEach(e => out[e] = { ok: false, reason: 'could not check: ' + msg });
      else (data.results || []).forEach(r => out[String(r.email).toLowerCase()] = { ok: !!r.ok, reason: r.reason || '' });
    } catch (e) { part.forEach(x => out[x] = { ok: false, reason: 'could not check: ' + e.message }); }
    part.forEach(e => { if (!out[e]) out[e] = { ok: false, reason: 'no answer from mail check' }; });
  }
  return out;
}
function emailBusy(on, text) {
  let d = $('#emChk');
  if (!on) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement('div'); d.id = 'emChk'; d.className = 'dlg-back'; document.body.appendChild(d); }
  d.innerHTML = '<div class="dlg" style="max-width:380px;text-align:center"><div class="spin"></div><div style="margin-top:10px">' + esc(text) + '</div></div>';
}
const ML_UI = { st: '' };
VIEWS.maillog = {
  mod: 'audit', render() {
    const stName = { queued: 'Queued', sent: 'Sent', failed: 'Failed', no_recipient: 'No recipient' };
    const rows = Store.all('mail_queue').filter(r => !ML_UI.st || r.status === ML_UI.st).sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    const admin = isAdminRole();
    const m = setMain('<div class="toolbar"><select id="mlSt"><option value="">All status</option>' + Object.keys(stName).map(k => '<option value="' + k + '"' + (ML_UI.st === k ? ' selected' : '') + '>' + stName[k] + '</option>').join('') + '</select><span class="grow"></span>' + (admin && CLOUD ? '<button class="btn" data-act="ml-flush">Send queued</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Date &amp; Time</th><th>Ref</th><th>To</th><th>Subject</th><th>Status</th><th>Sent At</th><th>Error</th><th>By</th>' + (admin ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(r => '<tr><td class="nowrap">' + fmtDT(r.at) + '</td><td>' + esc(r.ref || '') + '</td><td>' + esc(r.to || '') + '</td><td>' + esc(r.subject || '') + '</td><td><span class="st ' + (r.status === 'sent' ? 'Done' : r.status === 'queued' ? 'Pending' : 'Late') + '">' + esc(stName[r.status] || r.status || '') + '</span></td><td class="nowrap">' + (r.sent_at ? fmtDT(r.sent_at) : '') + '</td><td>' + esc(r.error || '') + '</td><td>' + esc(r.by || '') + '</td>' +
        (admin ? '<td>' + (r.status !== 'sent' && r.to && !r.attach_pdf ? '<button class="btn sm" data-act="ml-resend" data-id="' + esc(r.id) + '">Resend</button>' : '') + '</td>' : '') + '</tr>').join('')
        : '<tr><td colspan="' + (admin ? 9 : 8) + '" class="empty">No mails yet</td></tr>') + '</table></div>');
    m.addEventListener('change', e => { if (e.target.id === 'mlSt') { ML_UI.st = e.target.value; VIEWS.maillog.render(); } });
  }
};
ACTIONS['ml-resend'] = async el => { if (!isAdminRole()) return; audit('mail.resend', el.dataset.id, ''); await mailSend(el.dataset.id, true); };
ACTIONS['ml-flush'] = async () => {
  if (!isAdminRole() || !CLOUD || !SB) return;
  audit('mail.flush', '', '');
  try {
    const { data, error } = await SB.functions.invoke('nx-mail', { body: { action: 'flush' } });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    flash(msg ? 'Mail not sent: ' + esc(msg) : 'Mail: ' + (data.sent || 0) + ' sent, ' + (data.failed || 0) + ' failed.', msg || data.failed ? 'err' : '');
  } catch (e) { flash('Mail not sent: ' + esc(e.message), 'err'); }
};

/* ---------- Operations → WhatsApp Log ---------- */
const WA_UI = { st: '' };
VIEWS.walog = {
  mod: 'audit', render() {
    const rows = Store.all('wa_log').filter(r => !WA_UI.st || r.status === WA_UI.st).sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    const admin = isAdminRole();
    const stName = { sent: 'Sent', failed: 'Failed', no_mobile: 'No mobile', not_configured: 'Not set up' };
    const m = setMain('<div class="toolbar"><select id="waSt"><option value="">All status</option>' + Object.keys(stName).map(k => '<option value="' + k + '"' + (WA_UI.st === k ? ' selected' : '') + '>' + stName[k] + '</option>').join('') + '</select><span class="grow"></span>' + (isSuperAdmin() && CLOUD ? '<button class="btn" data-act="wa-test">Send test messages</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Date &amp; Time</th><th>Event</th><th>Ref</th><th>Template</th><th>To</th><th>Mobile</th><th>Message</th><th>Status</th><th>Error</th><th>By</th>' + (admin ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(r => '<tr><td class="nowrap">' + fmtDT(r.at) + '</td><td>' + esc(WA_EVENT_LABEL[r.event] || r.event) + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.template) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.to) + '</td><td>' + esc(r.params) + '</td><td><span class="st ' + (r.status === 'sent' ? 'Done' : 'Late') + '">' + esc(stName[r.status] || r.status) + '</span></td><td>' + esc(r.error || '') + '</td><td>' + esc(r.by || '') + '</td>' +
        (admin ? '<td>' + (r.status !== 'sent' && r.rid ? '<button class="btn sm" data-act="wa-resend" data-e="' + esc(r.event) + '" data-id="' + esc(r.rid || '') + '">Resend</button>' : '') + '</td>' : '') + '</tr>').join('')
        : '<tr><td colspan="' + (admin ? 11 : 10) + '" class="empty">No WhatsApp messages yet</td></tr>') + '</table></div>');
    m.addEventListener('change', e => { if (e.target.id === 'waSt') { WA_UI.st = e.target.value; VIEWS.walog.render(); } });
  }
};
ACTIONS['wa-resend'] = el => { if (!isAdminRole() || !el.dataset.id) return; audit('wa.resend', el.dataset.e, el.dataset.id); waSend(el.dataset.e, el.dataset.id, true); };

// Super Admin: one sample of every template to one number (sample PDF for the document templates)
ACTIONS['wa-test'] = () => {
  if (!isSuperAdmin() || !CLOUD) return;
  formDialog('Send test WhatsApp messages', [{ k: 'to', l: 'Mobile number', type: 'tel', value: ME.mobile || '', req: true }], 'Send', v => {
    const to = String(v.to || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(to)) return 'Enter a 10-digit mobile number.';
    (async () => {
      try {
        flash('Sending test messages to ' + esc(to) + '…');
        const pdf = await waHtmlPdf('<div class="po2"><div class="po2-co"><div class="po2-name">' + esc(settings().company || 'Zooto Fashion') + '</div></div><div class="po2-title">NEXUS 2.0 — WHATSAPP TEST DOCUMENT</div><div class="po2-rem">Sent by ' + esc(ME.name) + ' on ' + fmtDT(nowIso()) + '. This is a test file; no action is needed.</div></div>');
        const { data, error } = await SB.functions.invoke('nx-wa', { body: { action: 'test', to, pdf } });
        let msg = data && data.error;
        if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
        if (msg) { flash('Test not sent: ' + esc(msg), 'err'); return; }
        const bad = (data.results || []).filter(r => !r.ok);
        flash((data.results || []).length - bad.length + ' of ' + (data.results || []).length + ' test messages sent to ' + esc(to) + '.' + (bad.length ? ' Failed: ' + bad.map(r => esc(r.template) + ' (' + esc(r.error) + ')').join('; ') : ''), bad.length ? 'err' : '');
        audit('wa.test', to, (data.results || []).map(r => r.template + ':' + (r.ok ? 'sent' : 'failed')).join(', '));
      } catch (e) { flash('Test not sent: ' + esc(e.message), 'err'); }
    })();
  });
};

/* ---------- Operations → WhatsApp Inbox: every chat on the company WhatsApp number, with reply ---------- */
const WAI = { msgs: [], loaded: false, loading: false, sel: '', draft: {}, sub: null, q: '', f: 'all', blobs: {}, reply: null, pick: null };
(function () {
  const st = document.createElement('style');
  st.textContent = '.wai{display:grid;grid-template-columns:330px 1fr;gap:12px;height:calc(100vh - 150px);min-height:420px}' +
    '.wai-list,.wai-chat{background:var(--card,#fff);border:1px solid var(--line,#e3e6e4);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}' +
    '.wai-list .rows{overflow:auto;flex:1}.wai-c{padding:10px 12px;border-bottom:1px solid var(--line,#eef0ef);cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:2px 8px}.wai-c:hover{background:#f5f8f7}.wai-c.on{background:#e8f3f2}' +
    '.wai-c .n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wai-c .t{font-size:11px;color:#6b7280;white-space:nowrap}.wai-c .s{font-size:12px;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wai-c .u{background:#16a34a;color:#fff;border-radius:10px;font-size:11px;padding:0 7px;justify-self:end;height:18px;line-height:18px}' +
    '.wai-h{padding:10px 14px;border-bottom:1px solid var(--line,#eef0ef);font-weight:700;display:flex;align-items:center;gap:6px}.wai-h .grow{flex:1}.wai-h small{font-weight:400;color:#6b7280;margin-left:8px}' +
    '.wai-m{flex:1;overflow:auto;padding:14px;background:#f3f1ec;display:flex;flex-direction:column;gap:6px}' +
    '.wai-b{max-width:70%;padding:7px 10px;border-radius:9px;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.06);white-space:pre-wrap;word-wrap:break-word;font-size:13px}.wai-b.out{align-self:flex-end;background:#dcf5d9}' +
    '.wai-b .meta{font-size:10.5px;color:#6b7280;margin-top:3px;text-align:right}.wai-b .tpl{font-size:11px;color:#0e6a73;font-weight:700}.wai-b .err{color:#b91c1c;font-size:11px}.wai-b .rd{color:#2563eb}' +
    '.wai-b{position:relative}.wai-x{display:none;position:absolute;top:2px;right:4px;font-size:12px;background:rgba(255,255,255,.9);border-radius:6px;padding:0 4px}.wai-x a{cursor:pointer;text-decoration:none}.wai-b:hover .wai-x{display:block}' +
    '.wai-q{border-left:3px solid #0e6a73;background:rgba(0,0,0,.05);padding:3px 7px;border-radius:5px;font-size:12px;color:#374151;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wai-rq{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--line,#eef0ef);background:#f8faf9}.wai-rq .wai-q{flex:1;margin:0}.wai-rq a{cursor:pointer;font-size:18px;color:#6b7280}' +
    '.wai-f{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#eef0ef)}.wai-f textarea{flex:1;resize:none;height:54px}.wai-note{padding:8px 12px;font-size:12px;color:#92400e;background:#fef3c7}' +
    '.wai-s{padding:8px;border-bottom:1px solid var(--line,#eef0ef)}.wai-s input{width:100%}' +
    '.wai-md img{max-width:100%;max-height:320px;border-radius:7px;display:block;cursor:zoom-in}.wai-md video{max-width:100%;max-height:320px;border-radius:7px;display:block}.wai-md audio{width:260px;max-width:100%;display:block}.wai-md .ph{color:#6b7280;font-size:12px;padding:30px 10px;text-align:center;background:#f3f4f6;border-radius:7px;min-width:160px}.wai-b.img{padding:4px}.wai-b.img .meta{padding:0 6px 2px}.wai-b.img .wai-q{margin:3px 6px}' +
    '.wai-re{display:flex;gap:4px;margin-top:2px}.wai-re span{background:#fff;border:1px solid var(--line,#e3e6e4);border-radius:10px;padding:0 6px;font-size:13px;line-height:20px}.wai-re span.me{border-color:#0e6a73;cursor:pointer}.wai-b.out .wai-re span{background:#eef8ec}' +
    '.wai-pk{display:flex;gap:6px;background:#fff;border:1px solid var(--line,#e3e6e4);border-radius:18px;padding:4px 8px;margin-bottom:4px;box-shadow:0 2px 6px rgba(0,0,0,.12)}.wai-pk a{cursor:pointer;font-size:20px;text-decoration:none;line-height:1}' +
    '.wai-f .btn.ghost{padding:0 7px;font-size:17px;align-self:center}.wai-f textarea{height:54px}' +
    '.wai-pv{text-align:center;padding:6px 0 10px}.wai-pv img{max-width:100%;max-height:300px;border-radius:7px}.wai-pf{font-size:15px;padding:24px 10px;background:#f3f4f6;border-radius:7px}' +
    '@media(max-width:760px){.wai{grid-template-columns:1fr;height:auto}.wai-list{max-height:300px}.wai-chat{min-height:420px}.wai-b{max-width:88%}.wai-h .btn{font-size:11px;padding:0 6px}}';
  document.head.appendChild(st);
})();
function waiWho(num) {
  if (!num) return 'Not sent — no mobile number';
  const d = String(num || '').replace(/\D/g, '').slice(-10);
  const hit = list => list.find(x => String(x.mobile || '').replace(/\D/g, '').slice(-10) === d);
  const u = hit(Store.all('users')); if (u) return u.name;
  const v = hit(Store.all('vendors')); if (v) return v.name;
  const m = WAI.msgs.find(x => x.wa === num && x.name); return m ? m.name : '+' + num;
}
function waiMerge(rows) {
  let changed = false;
  rows.forEach(r => {
    const k = WAI.msgs.findIndex(x => x.id === r.id);
    if (k >= 0) { if (JSON.stringify(WAI.msgs[k]) !== JSON.stringify(r)) { WAI.msgs[k] = r; changed = true; } }
    else { WAI.msgs.push(r); changed = true; }
  });
  if (changed && curView().v === 'wainbox') VIEWS.wainbox.render();
}
// backup refresh every 5 s while the screen is open, in case a live update is missed
let WAI_POLL = null, WAI_PING = 0;
function waiPoll() {
  if (WAI_POLL) return;
  WAI_POLL = setInterval(async () => {
    if (curView().v !== 'wainbox' || document.hidden) return;
    try { const { data } = await SB.from('nx_wa_msgs').select('*').order('at', { ascending: false }).limit(100); if (data) waiMerge(data); } catch (e) { }
  }, 5000);
}
// wake the server function when the screen opens, so the first reply is not slow
function waiWake() { if (Date.now() - WAI_PING < 240000) return; WAI_PING = Date.now(); SB.functions.invoke('nx-wa', { body: { action: 'ping' } }).catch(() => { }); }
async function waiLoad() {
  if (WAI.loading) return; WAI.loading = true;
  try {
    const { data, error } = await SB.from('nx_wa_msgs').select('*').order('at', { ascending: true }).limit(5000);
    if (error) throw error;
    WAI.msgs = data || []; WAI.loaded = true;
    if (!WAI.sub) WAI.sub = SB.channel('nx-wa-msgs').on('postgres_changes', { event: '*', schema: 'public', table: 'nx_wa_msgs' }, p => {
      const r = p.new && p.new.id ? p.new : null; if (!r) return;
      waiMerge([r]);
    }).subscribe();
  } catch (e) { flash('WhatsApp Inbox could not load: ' + esc(e.message || e), 'err'); }
  WAI.loading = false;
  if (curView().v === 'wainbox') VIEWS.wainbox.render();
}
/* media (photos, voice notes, videos, files) are fetched through the server once and kept as blob URLs for this screen */
async function waiMedia(mid) {
  if (WAI.blobs[mid]) return WAI.blobs[mid];
  WAI.blobs[mid] = (async () => {
    const { data, error } = await SB.functions.invoke('nx-wa', { body: { action: 'media', media_id: mid } });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) throw new Error(msg);
    const bin = atob(data.data); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { url: URL.createObjectURL(new Blob([arr], { type: data.mime })), mime: data.mime, filename: data.filename || '' };
  })();
  WAI.blobs[mid].catch(() => { delete WAI.blobs[mid]; });
  return WAI.blobs[mid];
}
// fill the media placeholders of the open chat (images, voice notes, videos show inline; files stay as a link)
function waiLoadMedia() {
  $$('[data-wmid]').forEach(async el => {
    const mid = el.dataset.wmid, kind = el.dataset.wkind; el.removeAttribute('data-wmid');
    try {
      const m = await waiMedia(mid);
      if (kind === 'image' || kind === 'sticker') el.innerHTML = '<a data-act="wai-img" data-src="' + esc(m.url) + '"><img src="' + esc(m.url) + '" alt=""></a>';
      else if (kind === 'audio') el.innerHTML = '<audio controls preload="metadata" src="' + esc(m.url) + '"></audio>';
      else if (kind === 'video') el.innerHTML = '<video controls preload="metadata" src="' + esc(m.url) + '"></video>';
      else el.innerHTML = '<a href="' + esc(m.url) + '" download="' + esc(m.filename || el.dataset.wname || 'file') + '" target="_blank">📎 ' + esc(el.dataset.wname || m.filename || 'Attachment') + '</a>';
    } catch (e) { el.innerHTML = '<span class="err">📎 ' + esc(el.dataset.wname || 'Attachment') + ' — ' + esc(e.message) + '</span>'; }
  });
}
const WAI_EMOJI = ['👍', '❤️', '😂', '🙏', '✅', '❌', '😮', '😢'];
const waiOpenChat = c => !!(c && c.lastIn && (Date.now() - new Date(c.lastIn).getTime()) < 24 * 3600 * 1000);
// people we can start a chat with: every active user and vendor with a mobile number
function waiPeople() {
  const d10 = m => String(m || '').replace(/\D/g, '').slice(-10);
  const out = [];
  Store.all('users').filter(u => u.active !== false && /^[6-9]\d{9}$/.test(d10(u.mobile))).forEach(u => out.push({ name: u.name, mobile: d10(u.mobile), kind: 'User' }));
  Store.all('vendors').filter(v => /^[6-9]\d{9}$/.test(d10(v.mobile))).forEach(v => out.push({ name: v.name, mobile: d10(v.mobile), kind: 'Vendor' }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function waiConversations() {
  const conv = {};
  WAI.msgs.forEach(m => {
    if (m.type === 'reaction') return;
    const c = conv[m.wa] || (conv[m.wa] = { wa: m.wa, last: m, unread: 0, lastIn: '', hits: 0 });
    if ((m.at || '') >= (c.last.at || '')) c.last = m;
    if (m.dir === 'in') { if (!m.seen) c.unread++; if ((m.at || '') > c.lastIn) c.lastIn = m.at; }
  });
  return conv;
}
VIEWS.wainbox = {
  mod: 'audit', render() {
    if (!CLOUD || !isAdminRole()) { setMain('<div class="tbl-wrap"><table><tr><td class="empty">' + (CLOUD ? 'Only Admin and Super Admin can see WhatsApp chats' : 'WhatsApp Inbox works in cloud mode') + '</td></tr></table></div>'); return; }
    waiWake(); waiPoll();
    if (!WAI.loaded) { setMain('<div class="tbl-wrap"><table><tr><td class="empty">Loading…</td></tr></table></div>'); waiLoad(); return; }
    const conv = waiConversations();
    const q = norm(WAI.q || '');
    let list = Object.values(conv);
    if (q) list.forEach(c => { c.hits = WAI.msgs.filter(m => m.wa === c.wa && m.type !== 'reaction' && norm(m.body || m.filename || m.template || '').includes(q)).length; });
    list = list.filter(c => (!q || c.hits || norm(waiWho(c.wa)).includes(q) || String(c.wa).includes(q.replace(/\D/g, '') || '§')) && (WAI.f !== 'unread' || c.unread));
    list.sort((a, b) => (b.last.at || '') < (a.last.at || '') ? -1 : 1);
    if (!WAI.sel && list.length && !q) WAI.sel = list[0].wa;
    const snip = m => (m.dir === 'out' ? '↩ ' : '') + (m.template ? m.template : m.body || (m.filename || (m.type === 'image' ? '📷 Photo' : m.type === 'audio' ? '🎤 Voice note' : m.type === 'video' ? '🎬 Video' : m.type) || ''));
    const unreadN = Object.values(conv).filter(c => c.unread).length;
    let h = '<div class="toolbar"><button class="btn primary" data-act="wai-new">+ New chat</button>' + seg('waif', [{ v: 'all', l: 'All' }, { v: 'unread', l: 'Unread (' + unreadN + ')' }], WAI.f) + '<span class="grow"></span>' + (isSuperAdmin() ? '<button class="btn" data-act="wa-test">Send test messages</button>' : '') + '</div>' +
      '<div class="wai"><div class="wai-list"><div class="wai-s"><input id="waiQ" placeholder="Search name, number or message" value="' + esc(WAI.q || '') + '"></div><div class="rows">' +
      (list.length ? list.map(c => '<div class="wai-c' + (c.wa === WAI.sel ? ' on' : '') + '" data-act="wai-open" data-wa="' + esc(c.wa) + '"><div class="n">' + esc(waiWho(c.wa)) + '</div><div class="t">' + fmtDT(c.last.at) + '</div><div class="s">' + (q && c.hits ? '<b>' + c.hits + ' match' + (c.hits > 1 ? 'es' : '') + '</b> · ' : '') + esc(snip(c.last)) + '</div>' + (c.unread ? '<div class="u">' + c.unread + '</div>' : '<div></div>') + '</div>').join('')
        : '<div class="wai-c"><div class="s">' + (q ? 'No chat matches' : WAI.f === 'unread' ? 'No unread chats' : 'No chats yet') + '</div></div>') + '</div></div>';
    const c = conv[WAI.sel];
    if (c) {
      const all = WAI.msgs.filter(m => m.wa === c.wa).sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
      const reacts = {}; all.filter(m => m.type === 'reaction' && m.reply_to).forEach(m => (reacts[m.reply_to] = reacts[m.reply_to] || []).push(m));
      const msgs = all.filter(m => m.type !== 'reaction');
      const tick = m => m.dir !== 'out' ? '' : m.status === 'sending' ? ' 🕓' : m.status === 'read' ? ' <span class="rd">✓✓</span>' : m.status === 'delivered' ? ' ✓✓' : m.status === 'failed' ? ' ✕' : ' ✓';
      const open = waiOpenChat(c);
      const byId = new Map(msgs.map(m => [m.id, m]));
      const label = m => m.template || m.body || m.filename || (m.type === 'image' ? '📷 Photo' : m.type === 'audio' ? '🎤 Voice note' : m.type === 'video' ? '🎬 Video' : m.type) || '';
      const quote = id => { const qm = byId.get(id); return qm ? '<div class="wai-q">' + esc(qm.dir === 'in' ? waiWho(qm.wa) : 'You') + ': ' + esc(label(qm).slice(0, 120)) + '</div>' : ''; };
      const mediaHtml = m => {
        if (!m.media_id) return m.filename && m.dir === 'out' ? '<div>📎 ' + esc(m.filename) + '</div>' : '';
        const kind = m.type === 'sticker' ? 'image' : m.type;
        const inline = ['image', 'audio', 'video'].includes(kind) ? kind : 'document';
        if (inline === 'document') return '<div class="wai-md"><a data-act="wai-media" data-id="' + esc(m.media_id) + '">📎 ' + esc(m.filename || 'Attachment') + '</a></div>';   // files open on click
        return '<div class="wai-md ' + inline + '" data-wmid="' + esc(m.media_id) + '" data-wkind="' + inline + '" data-wname="' + esc(m.filename || '') + '">' + (inline === 'image' ? '<div class="ph">📷 Loading…</div>' : '⏳') + '</div>';
      };
      const reactHtml = m => { const r = reacts[m.id]; if (!r || !r.length) return ''; return '<div class="wai-re">' + r.map(x => '<span class="' + (x.dir === 'out' ? 'me' : '') + '" title="' + esc(x.dir === 'out' ? (x.by_name || 'You') : waiWho(x.wa)) + '"' + (x.dir === 'out' ? ' data-act="wai-react" data-id="' + esc(m.id) + '" data-e=""' : '') + '>' + esc(x.body) + '</span>').join('') + '</div>'; };
      const wamid = m => /^wamid\./.test(m.id);
      h += '<div class="wai-chat"><div class="wai-h"><span>' + esc(waiWho(c.wa)) + (c.wa ? '<small>+' + esc(c.wa) + '</small>' : '') + '</span><span class="grow"></span>' +
        (c.wa ? '<a class="btn sm ghost" href="https://wa.me/' + esc(c.wa) + '" target="_blank" rel="noopener" title="Open this number in the WhatsApp app">Open in WhatsApp ↗</a><button class="btn sm ghost" data-act="wai-unread" title="Show this chat as unread again">Mark unread</button>' : '') +
        '<button class="btn sm ghost danger" data-act="wai-delchat" data-confirm="Delete this whole chat?">Delete chat</button></div><div class="wai-m" id="waiM">' +
        msgs.map(m => '<div class="wai-b ' + m.dir + (m.type === 'image' || m.type === 'sticker' ? ' img' : '') + '" id="wm-' + esc(m.id) + '">' +
          '<div class="wai-x">' + (open && wamid(m) ? '<a data-act="wai-reply" data-id="' + esc(m.id) + '" title="Reply">↩</a> <a data-act="wai-pick" data-id="' + esc(m.id) + '" title="React">😊</a> ' : '') + (wamid(m) || m.media_id ? '<a data-act="wai-fwd" data-id="' + esc(m.id) + '" title="Forward">➦</a> ' : '') + '<a data-act="wai-del" data-id="' + esc(m.id) + '" data-confirm="Delete?" title="Delete">🗑</a></div>' +
          (WAI.pick === m.id ? '<div class="wai-pk">' + WAI_EMOJI.map(e => '<a data-act="wai-react" data-id="' + esc(m.id) + '" data-e="' + e + '">' + e + '</a>').join('') + '</div>' : '') +
          (m.reply_to ? quote(m.reply_to) : '') + (m.template ? '<div class="tpl">' + esc(m.template) + '</div>' : '') + mediaHtml(m) + esc(m.body || '') +
          (m.ref ? '<div class="meta" style="text-align:left">' + esc(m.ref) + '</div>' : '') +
          (m.error ? '<div class="err">' + esc(m.error) + '</div>' : '') +
          (m.status === 'failed' && m.event && m.rid && isAdminRole() ? '<div><a data-act="wa-resend" data-e="' + esc(m.event) + '" data-id="' + esc(m.rid) + '">Resend</a></div>' : '') +
          '<div class="meta">' + (m.by_name ? esc(m.by_name) + ' · ' : '') + fmtDT(m.at) + tick(m) + '</div>' + reactHtml(m) + '</div>').join('') + '</div>' +
        (open || !c.wa ? '' : '<div class="wai-note">' + (c.lastIn ? 'Reply closed — no message from this number in the last 24 hours. Only a template can be sent now (New chat).' : 'Reply closed — this number has not written to us.') + '</div>') +
        (WAI.reply && byId.get(WAI.reply) && open ? '<div class="wai-rq">' + quote(WAI.reply) + '<a data-act="wai-reply-x">×</a></div>' : '') +
        (!c.wa ? '' : '<div class="wai-f">' +
          '<button class="btn sm ghost" data-act="wai-attach" title="Photo, PDF, video or file"' + (open ? '' : ' disabled') + '>📎</button><button class="btn sm ghost" data-act="wai-camera" title="Take a photo"' + (open ? '' : ' disabled') + '>📷</button><button class="btn sm ghost" data-act="wai-doc" title="Send a Nexus document (PO / Job Card / GRN)"' + (open ? '' : ' disabled') + '>📄</button>' +
          '<input type="file" id="waiFile" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx" hidden><input type="file" id="waiCam" accept="image/*" capture="environment" hidden>' +
          '<textarea id="waiTxt"' + (open ? '' : ' disabled') + ' placeholder="Type a message">' + esc(WAI.draft[c.wa] || '') + '</textarea><button class="btn primary" data-act="wai-send"' + (open ? '' : ' disabled') + '>Send</button></div>') + '</div>';
    } else h += '<div class="wai-chat"><div class="wai-m"><div class="dl-empty">' + (list.length ? 'Pick a chat' : 'Start with + New chat') + '</div></div></div>';
    h += '</div>';
    const main = setMain(h);
    const box = $('#waiM'); if (box) box.scrollTop = box.scrollHeight;
    const t = $('#waiTxt'); if (t) { t.addEventListener('input', () => { WAI.draft[WAI.sel] = t.value; }); t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ACTIONS['wai-send'](); } }); if (WAI.reply) t.focus(); }
    const sq = $('#waiQ'); if (sq) { sq.addEventListener('input', () => { WAI.q = sq.value; clearTimeout(WAI.qT); WAI.qT = setTimeout(() => { const pos = sq.selectionStart; VIEWS.wainbox.render(); const n = $('#waiQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }); }
    const fi = $('#waiFile'); if (fi) fi.addEventListener('change', () => { if (fi.files[0]) waiPickFile(fi.files[0]); fi.value = ''; });
    const ci = $('#waiCam'); if (ci) ci.addEventListener('change', () => { if (ci.files[0]) waiPickFile(ci.files[0]); ci.value = ''; });
    onSeg(e => { if (e.target.dataset.seg === 'waif') { WAI.f = e.detail; VIEWS.wainbox.render(); } });
    waiLoadMedia();
    if (c && c.unread) waiSeen(c.wa);
    return main;
  }
};
async function waiSeen(wa) {
  WAI.msgs.forEach(m => { if (m.wa === wa && m.dir === 'in') m.seen = true; });
  try { await SB.from('nx_wa_msgs').update({ seen: true }).eq('wa', wa).eq('dir', 'in').eq('seen', false); } catch (e) { }
}
ACTIONS['wai-open'] = el => { WAI.sel = el.dataset.wa; WAI.pick = null; VIEWS.wainbox.render(); };
ACTIONS['wai-img'] = el => { const w = window.open(''); if (w) { w.document.write('<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="' + el.dataset.src + '" style="max-width:100%;max-height:100vh"></body>'); } };
// talk to the server function; returns an error text or ''
async function waiCall(body) {
  try {
    const { data, error } = await SB.functions.invoke('nx-wa', { body });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    return { err: msg || '', data: data || {} };
  } catch (e) { return { err: e.message, data: {} }; }
}
// optimistic bubble: shown as "sending" until the server answers
function waiTmp(to, fields) { const tmp = Object.assign({ id: 'tmp-' + Date.now() + Math.random().toString(36).slice(2, 6), wa: to, dir: 'out', type: 'text', body: '', status: 'sending', by_name: ME.name, seen: true, at: new Date().toISOString(), reply_to: null }, fields); WAI.msgs.push(tmp); return tmp; }
function waiSettle(tmp, r) {
  const k = WAI.msgs.indexOf(tmp);
  if (r.err) { if (k >= 0) Object.assign(WAI.msgs[k], { status: 'failed', error: r.err }); flash('Not sent: ' + esc(r.err), 'err'); }
  else if (k >= 0) { const id = r.data.id; if (id && WAI.msgs.some(x => x.id === id)) WAI.msgs.splice(k, 1); else Object.assign(WAI.msgs[k], { id: id || tmp.id, status: 'sent', media_id: r.data.media_id || tmp.media_id || null }); }
  if (curView().v === 'wainbox') VIEWS.wainbox.render();
}
ACTIONS['wai-send'] = async () => {
  const t = $('#waiTxt'); const text = t ? t.value.trim() : ''; const to = WAI.sel;
  if (!text || !to) return;
  const replyTo = WAI.reply && /^wamid\./.test(WAI.reply) ? WAI.reply : '';
  const tmp = waiTmp(to, { type: 'text', body: text, reply_to: replyTo || null });
  WAI.draft[to] = ''; WAI.reply = null; VIEWS.wainbox.render();
  const r = await waiCall({ action: 'reply', to, text, reply_to: replyTo });
  if (r.err) WAI.draft[to] = text; else audit('wa.reply', '+' + to, text.slice(0, 80));
  waiSettle(tmp, r);
};
ACTIONS['wai-reply'] = el => { WAI.reply = el.dataset.id; WAI.pick = null; VIEWS.wainbox.render(); };
ACTIONS['wai-reply-x'] = () => { WAI.reply = null; VIEWS.wainbox.render(); };
ACTIONS['wai-pick'] = el => { WAI.pick = WAI.pick === el.dataset.id ? null : el.dataset.id; VIEWS.wainbox.render(); const b = $('#wm-' + CSS.escape(el.dataset.id)); if (b) b.scrollIntoView({ block: 'nearest' }); };
ACTIONS['wai-react'] = async el => {
  const id = el.dataset.id, emoji = el.dataset.e || ''; WAI.pick = null;
  const m = WAI.msgs.find(x => x.id === id); if (!m) return;
  // show it at once; the server confirms
  WAI.msgs = WAI.msgs.filter(x => !(x.type === 'reaction' && x.dir === 'out' && x.reply_to === id));
  if (emoji) WAI.msgs.push({ id: 'tmp-re-' + Date.now(), wa: m.wa, dir: 'out', type: 'reaction', body: emoji, reply_to: id, status: 'sending', by_name: ME.name, seen: true, at: new Date().toISOString() });
  VIEWS.wainbox.render();
  const r = await waiCall({ action: 'react', message_id: id, emoji });
  if (r.err) { WAI.msgs = WAI.msgs.filter(x => !String(x.id).startsWith('tmp-re-')); flash('Reaction not sent: ' + esc(r.err), 'err'); VIEWS.wainbox.render(); }
  else audit('wa.react', '+' + m.wa, (emoji || 'removed') + ' on ' + (m.body || m.type || '').slice(0, 60));
};
/* ---- attachments: photo (camera or gallery), PDF, video, voice/audio, any file; big photos are shrunk in the browser ---- */
ACTIONS['wai-attach'] = () => { const f = $('#waiFile'); if (f) f.click(); };
ACTIONS['wai-camera'] = () => { const f = $('#waiCam'); if (f) f.click(); };
function waiShrink(file) {
  return new Promise(ok => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1200000) return ok(file);
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob(bl => ok(bl ? new File([bl], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
    img.src = url;
  });
}
const waiB64 = file => new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split('base64,')[1] || ''); fr.onerror = () => bad(new Error('Could not read the file')); fr.readAsDataURL(file); });
async function waiPickFile(file0) {
  const to = WAI.sel; if (!to) return;
  const file = await waiShrink(file0);
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document';
  const limit = kind === 'image' ? 5 : 12;
  if (file.size > limit * 1024 * 1024) { flash('File is too large — WhatsApp allows ' + limit + ' MB for a ' + kind + '.', 'err'); return; }
  const old = $('#waiAtt'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'waiAtt'; d.className = 'dlg-back';
  const prev = kind === 'image' ? URL.createObjectURL(file) : '';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">Send to ' + esc(waiWho(to)) + '</div><div class="wai-pv">' + (prev ? '<img src="' + esc(prev) + '">' : '<div class="wai-pf">' + (kind === 'video' ? '🎬' : kind === 'audio' ? '🎤' : '📎') + ' ' + esc(file.name) + '</div>') + '<div class="small muted">' + esc(file.name) + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' MB</div></div>' +
    (kind === 'audio' ? '' : '<table class="jckv"><tr><td class="k">Caption</td><td class="v"><input id="waiCap" maxlength="1024"></td></tr></table>') +
    '<div class="dlg-f"><span id="waiAttMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-att-x>Cancel</button><button class="btn primary" data-att-ok>Send</button></div></div>';
  document.body.appendChild(d); const cap = $('#waiCap', d); if (cap) cap.focus();
  d.addEventListener('click', async ev => {
    if (ev.target.closest('[data-att-x]') || ev.target === d) { d.remove(); if (prev) URL.revokeObjectURL(prev); return; }
    const okb = ev.target.closest('[data-att-ok]'); if (!okb) return;
    okb.disabled = true; const caption = cap ? cap.value.trim() : '';
    let data; try { data = await waiB64(file); } catch (e) { $('#waiAttMsg', d).textContent = e.message; okb.disabled = false; return; }
    d.remove();
    const replyTo = WAI.reply && /^wamid\./.test(WAI.reply) ? WAI.reply : ''; WAI.reply = null;
    const tmp = waiTmp(to, { type: kind, body: caption, filename: file.name, reply_to: replyTo || null });
    if (prev) { WAI.blobs['tmp:' + tmp.id] = Promise.resolve({ url: prev, mime: file.type, filename: file.name }); tmp.media_id = 'tmp:' + tmp.id; tmp.media_mime = file.type; }
    VIEWS.wainbox.render();
    const r = await waiCall({ action: 'send_media', to, kind, mime: file.type || 'application/octet-stream', filename: file.name, caption, data, reply_to: replyTo });
    if (!r.err) { audit('wa.send_file', '+' + to, kind + ' ' + file.name + (caption ? ' · ' + caption.slice(0, 60) : '')); if (prev && r.data.media_id) WAI.blobs[r.data.media_id] = WAI.blobs['tmp:' + tmp.id]; }
    waiSettle(tmp, r);
  });
}
/* ---- a Nexus document (the same PDF the Print button makes) straight into the chat ---- */
ACTIONS['wai-doc'] = () => {
  const to = WAI.sel; if (!to) return;
  const kinds = { 'Purchase Order': 'po', 'Job Card': 'jc', 'GRN': 'grn' };
  const pick = kind => { const col = kind === 'po' ? 'purchase_orders' : kind === 'jc' ? 'job_cards' : 'grns'; return Store.all(col).filter(x => !x.cancelled).sort((a, b) => (b.at || b.date || '') < (a.at || a.date || '') ? -1 : 1).slice(0, 300); };
  const old = $('#waiDoc'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'waiDoc'; d.className = 'dlg-back';
  const opts = kind => pick(kind).map(x => '<option value="' + esc(x.id) + '">' + esc(x.no + (x.vendor ? ' · ' + x.vendor : x.brand ? ' · ' + x.brand : '')) + '</option>').join('');
  d.innerHTML = '<div class="dlg"><div class="dlg-h">Send a Nexus document to ' + esc(waiWho(to)) + '</div><table class="jckv"><tr><td class="k">Document *</td><td class="v"><select id="wdKind">' + Object.keys(kinds).map(k => '<option value="' + kinds[k] + '">' + k + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Number *</td><td class="v"><select id="wdId">' + opts('po') + '</select></td></tr><tr><td class="k">Caption</td><td class="v"><input id="wdCap" maxlength="1024"></td></tr></table>' +
    '<div class="dlg-f"><span id="wdMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-wd-x>Cancel</button><button class="btn primary" data-wd-ok>Send PDF</button></div></div>';
  document.body.appendChild(d);
  $('#wdKind', d).addEventListener('change', () => { $('#wdId', d).innerHTML = opts($('#wdKind', d).value); });
  d.addEventListener('click', async ev => {
    if (ev.target.closest('[data-wd-x]') || ev.target === d) { d.remove(); return; }
    const okb = ev.target.closest('[data-wd-ok]'); if (!okb) return;
    const kind = $('#wdKind', d).value, id = $('#wdId', d).value, caption = $('#wdCap', d).value.trim();
    if (!id) { $('#wdMsg', d).textContent = 'Pick a number.'; return; }
    const rec = Store.get(kind === 'po' ? 'purchase_orders' : kind === 'jc' ? 'job_cards' : 'grns', id); if (!rec) return;
    okb.disabled = true; $('#wdMsg', d).textContent = 'Making the PDF…';
    let data; try { data = await waPdf(kind, id); } catch (e) { $('#wdMsg', d).textContent = e.message; okb.disabled = false; return; }
    d.remove();
    const filename = (kind === 'po' ? 'PO_' : kind === 'jc' ? 'JobCard_' : 'GRN_') + String(rec.no || id).replace(/[^\w.-]+/g, '_') + '.pdf';
    const tmp = waiTmp(to, { type: 'document', body: caption, filename }); VIEWS.wainbox.render();
    const r = await waiCall({ action: 'send_media', to, kind: 'document', mime: 'application/pdf', filename, caption, data });
    if (!r.err) audit('wa.send_doc', '+' + to, filename + (caption ? ' · ' + caption.slice(0, 60) : ''));
    waiSettle(tmp, r);
  });
};
/* ---- forward one message to another chat (only chats that wrote to us in the last 24 hours can receive it) ---- */
ACTIONS['wai-fwd'] = el => {
  const m = WAI.msgs.find(x => x.id === el.dataset.id); if (!m) return;
  const conv = waiConversations();
  const targets = Object.values(conv).filter(c => c.wa && c.wa !== m.wa && waiOpenChat(c)).map(c => ({ wa: c.wa, l: waiWho(c.wa) + ' · +' + c.wa })).sort((a, b) => a.l.localeCompare(b.l));
  if (!targets.length) { flash('No other chat is open for a reply right now (24-hour rule).', 'err'); return; }
  formDialog('Forward to', [{ k: 'to', l: 'Chat', type: 'select', options: targets.map(t => t.l), req: true }], 'Forward', v => {
    const t = targets.find(x => x.l === v.to); if (!t) return 'Pick a chat.';
    (async () => {
      const tmp = waiTmp(t.wa, { type: m.type, body: m.template ? m.template + ': ' + (m.body || '') : m.body || '', filename: m.filename || '', media_id: m.media_id || null, media_mime: m.media_mime || null });
      WAI.sel = t.wa; WAI.pick = null; VIEWS.wainbox.render();
      const r = await waiCall({ action: 'forward', to: t.wa, id: m.id });
      if (!r.err) audit('wa.forward', '+' + t.wa, 'from +' + m.wa + ' · ' + (m.body || m.filename || m.type || '').slice(0, 60));
      waiSettle(tmp, r);
    })();
    return '';
  });
};
/* ---- start a chat: an approved template goes to a user or vendor; they can then reply and the chat opens ---- */
ACTIONS['wai-new'] = () => {
  const people = waiPeople(); if (!people.length) { flash('No user or vendor has a mobile number.', 'err'); return; }
  const labels = people.map(p => p.name + ' · ' + p.mobile + ' · ' + p.kind);
  formDialog('New chat', [{ k: 'who', l: 'Send to', type: 'select', options: labels, req: true }, { k: 'note', l: 'Note', type: 'static', value: 'WhatsApp opens a new chat only with an approved template (nexus_hello). The person can reply for 24 hours after that, and then photos, files and free text work.' }], 'Send template', v => {
    const p = people[labels.indexOf(v.who)]; if (!p) return 'Pick a person.';
    (async () => {
      const to = '91' + p.mobile;
      const r = await waiCall({ action: 'start', to: p.mobile });
      if (r.err) { flash('Not sent: ' + esc(r.err), 'err'); return; }
      audit('wa.start', '+' + to, p.name + ' (' + p.kind + ')');
      if (!WAI.msgs.some(x => x.id === r.data.id)) WAI.msgs.push({ id: r.data.id || 'tmp-' + Date.now(), wa: r.data.wa || to, dir: 'out', type: 'template', template: 'nexus_hello', body: 'name: ' + p.name, status: 'sent', by_name: ME.name, seen: true, at: new Date().toISOString() });
      WAI.sel = r.data.wa || to; WAI.q = ''; WAI.f = 'all'; flash('Template sent to ' + esc(p.name) + '.'); VIEWS.wainbox.render();
    })();
    return '';
  });
};
/* ---- unread ---- */
ACTIONS['wai-unread'] = async () => {
  const wa = WAI.sel; const last = WAI.msgs.filter(m => m.wa === wa && m.dir === 'in' && m.type !== 'reaction').sort((a, b) => (a.at || '') < (b.at || '') ? 1 : -1)[0];
  if (!last) { flash('This chat has no incoming message to mark.', 'err'); return; }
  last.seen = false; WAI.sel = null; WAI.pick = null; VIEWS.wainbox.render();
  try { await SB.from('nx_wa_msgs').update({ seen: false }).eq('id', last.id); } catch (e) { }
};
async function waiDelete(body) {
  const r = await waiCall(Object.assign({ action: 'delete' }, body));
  if (r.err) { flash('Not deleted: ' + esc(r.err), 'err'); return false; }
  return true;
}
ACTIONS['wai-del'] = async el => {
  const id = el.dataset.id; const m = WAI.msgs.find(x => x.id === id); if (!m) return;
  if (!id.startsWith('tmp-') && !(await waiDelete({ ids: [id] }))) return;
  WAI.msgs = WAI.msgs.filter(x => x.id !== id && !(x.type === 'reaction' && x.reply_to === id));
  audit('wa.delete_message', '+' + m.wa, (m.template || m.body || m.filename || m.type || '').slice(0, 80)); VIEWS.wainbox.render();
};
ACTIONS['wai-delchat'] = async () => {
  const wa = WAI.sel; if (wa == null) return;
  if (!(await waiDelete({ wa }))) return;
  const n = WAI.msgs.filter(x => x.wa === wa).length; WAI.msgs = WAI.msgs.filter(x => x.wa !== wa); WAI.sel = null; WAI.reply = null; WAI.pick = null;
  audit('wa.delete_chat', '+' + wa, n + ' message(s)'); flash('Chat deleted.'); VIEWS.wainbox.render();
};
ACTIONS['wai-media'] = async el => { try { const m = await waiMedia(el.dataset.id); const a = document.createElement('a'); a.href = m.url; a.target = '_blank'; if (m.filename) a.download = m.filename; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { flash(esc(e.message), 'err'); } };

/* ---------- daily: low stock list to Purchase, delivery reminders to vendors (server sends each once a day) ---------- */
function waDaily() {
  if (!CLOUD || !SB || !ME || new Date().getHours() < 10) return;
  if (!(isAdminRole() || can('purchase', 'edit') || can('store', 'edit'))) return;
  const day = todayYmd(); try { if (localStorage.getItem('nx_wa_daily') === day) return; localStorage.setItem('nx_wa_daily', day); } catch (e) { return; }
  try {
    const { stk } = stockMaps();
    const txt = lowStockList().map(m => (m.name || m.code) + ' (Current ' + qtyFmt(stk[norm(m.code)] || 0) + ' ' + (m.uom || '') + ' / Min ' + qtyFmt(m.min_level) + ' ' + (m.uom || '') + ')').join('; ').slice(0, 750);
    if (txt) waSend('low_stock', day, false, { text: txt });
    const t0 = new Date(day + 'T00:00:00').getTime();
    const vendors = new Set(Store.all('purchase_orders').filter(p => !p.cancelled && p.approval === 'Approved' && p.expected && (p.lines || []).some((l, k) => poLinePending(p, l, k) > 0))
      .filter(p => { const d = Math.round((new Date(p.expected + 'T00:00:00').getTime() - t0) / 86400000); return d <= 7 && d >= -21; }).map(p => p.vendor));
    vendors.forEach(v => waSend('delivery_due', v + '|' + day));
  } catch (e) { console.error(e); }
}
setInterval(() => { try { waDaily(); } catch (e) { } }, 30 * 60000);
setTimeout(() => { try { waDaily(); } catch (e) { } }, 20000);
