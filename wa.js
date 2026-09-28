/* Nexus 2.0 — WhatsApp messages (Meta Cloud API through the nx-wa edge function).
   The app only tells the server which event happened on which record; the server picks the
   template, parameters and recipients. PO approval and final GRN also send their PDF. */
'use strict';

const WA_PDF = { po_approved: 'po', grn_final: 'grn' };
const WA_EVENT_LABEL = { po_submitted: 'PO sent for approval', po_approved: 'PO approved', gate_entry: 'Gate entry', invoice_approved: 'Invoice approved', qc_mismatch: 'QC mismatch', excess_pending: 'Excess approval', grn_final: 'GRN', test: 'Test' };

let WA_LIB = null;
function waLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!WA_LIB) WA_LIB = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'; s.onload = ok; s.onerror = () => { WA_LIB = null; bad(new Error('PDF library did not load')); }; document.head.appendChild(s); });
  return WA_LIB;
}
// the same document the Print button shows, as a PDF (base64, no prefix)
async function waPdf(kind, id) {
  const d = kind === 'po' ? Store.get('purchase_orders', id) : Store.get('grns', id);
  if (!d) throw new Error('Record not found');
  return waHtmlPdf(kind === 'po' ? poDocHtml(d) : grnDocHtml(d));
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

async function waSend(event, id, resend) {
  if (!CLOUD || !SB) return;
  try {
    await waSynced();
    const body = { event, id, resend: !!resend };
    if (WA_PDF[event]) body.pdf = await waPdf(WA_PDF[event], id);
    const { data, error } = await SB.functions.invoke('nx-wa', { body });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + ') not sent: ' + esc(msg), 'err');
    else if (data && data.failed) flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + '): ' + data.sent + ' sent, ' + data.failed + ' failed — see WhatsApp Log.', 'err');
    else if (resend && data && data.sent != null) flash('WhatsApp resent to ' + data.sent + '.');
  } catch (e) { flash('WhatsApp (' + esc(WA_EVENT_LABEL[event] || event) + ') not sent: ' + esc(e.message), 'err'); }
}

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
const WAI = { msgs: [], loaded: false, loading: false, sel: '', draft: {}, sub: null };
(function () {
  const st = document.createElement('style');
  st.textContent = '.wai{display:grid;grid-template-columns:330px 1fr;gap:12px;height:calc(100vh - 150px);min-height:420px}' +
    '.wai-list,.wai-chat{background:var(--card,#fff);border:1px solid var(--line,#e3e6e4);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}' +
    '.wai-list .rows{overflow:auto;flex:1}.wai-c{padding:10px 12px;border-bottom:1px solid var(--line,#eef0ef);cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:2px 8px}.wai-c:hover{background:#f5f8f7}.wai-c.on{background:#e8f3f2}' +
    '.wai-c .n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wai-c .t{font-size:11px;color:#6b7280;white-space:nowrap}.wai-c .s{font-size:12px;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wai-c .u{background:#16a34a;color:#fff;border-radius:10px;font-size:11px;padding:0 7px;justify-self:end;height:18px;line-height:18px}' +
    '.wai-h{padding:10px 14px;border-bottom:1px solid var(--line,#eef0ef);font-weight:700}.wai-h small{font-weight:400;color:#6b7280;margin-left:8px}' +
    '.wai-m{flex:1;overflow:auto;padding:14px;background:#f3f1ec;display:flex;flex-direction:column;gap:6px}' +
    '.wai-b{max-width:70%;padding:7px 10px;border-radius:9px;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.06);white-space:pre-wrap;word-wrap:break-word;font-size:13px}.wai-b.out{align-self:flex-end;background:#dcf5d9}' +
    '.wai-b .meta{font-size:10.5px;color:#6b7280;margin-top:3px;text-align:right}.wai-b .tpl{font-size:11px;color:#0e6a73;font-weight:700}.wai-b .err{color:#b91c1c;font-size:11px}.wai-b .rd{color:#2563eb}' +
    '.wai-f{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#eef0ef)}.wai-f textarea{flex:1;resize:none;height:54px}.wai-note{padding:8px 12px;font-size:12px;color:#92400e;background:#fef3c7}' +
    '@media(max-width:760px){.wai{grid-template-columns:1fr;height:auto}.wai-list{max-height:260px}.wai-chat{min-height:420px}}';
  document.head.appendChild(st);
})();
function waiWho(num) {
  const d = String(num || '').replace(/\D/g, '').slice(-10);
  const hit = list => list.find(x => String(x.mobile || '').replace(/\D/g, '').slice(-10) === d);
  const u = hit(Store.all('users')); if (u) return u.name;
  const v = hit(Store.all('vendors')); if (v) return v.name;
  const m = WAI.msgs.find(x => x.wa === num && x.name); return m ? m.name : '+' + num;
}
async function waiLoad() {
  if (WAI.loading) return; WAI.loading = true;
  try {
    const { data, error } = await SB.from('nx_wa_msgs').select('*').order('at', { ascending: true }).limit(5000);
    if (error) throw error;
    WAI.msgs = data || []; WAI.loaded = true;
    if (!WAI.sub) WAI.sub = SB.channel('nx-wa-msgs').on('postgres_changes', { event: '*', schema: 'public', table: 'nx_wa_msgs' }, p => {
      const r = p.new && p.new.id ? p.new : null; if (!r) return;
      const k = WAI.msgs.findIndex(x => x.id === r.id); if (k >= 0) WAI.msgs[k] = r; else WAI.msgs.push(r);
      if (curView().v === 'wainbox') VIEWS.wainbox.render();
    }).subscribe();
  } catch (e) { flash('WhatsApp Inbox could not load: ' + esc(e.message || e), 'err'); }
  WAI.loading = false;
  if (curView().v === 'wainbox') VIEWS.wainbox.render();
}
VIEWS.wainbox = {
  mod: 'audit', render() {
    if (!CLOUD || !isAdminRole()) { setMain('<div class="tbl-wrap"><table><tr><td class="empty">' + (CLOUD ? 'Only Admin and Super Admin can see WhatsApp chats' : 'WhatsApp Inbox works in cloud mode') + '</td></tr></table></div>'); return; }
    if (!WAI.loaded) { setMain('<div class="tbl-wrap"><table><tr><td class="empty">Loading…</td></tr></table></div>'); waiLoad(); return; }
    const conv = {};
    WAI.msgs.forEach(m => { const c = conv[m.wa] || (conv[m.wa] = { wa: m.wa, last: m, unread: 0, lastIn: '' }); if ((m.at || '') >= (c.last.at || '')) c.last = m; if (m.dir === 'in') { if (!m.seen) c.unread++; if ((m.at || '') > c.lastIn) c.lastIn = m.at; } });
    const list = Object.values(conv).sort((a, b) => (b.last.at || '') < (a.last.at || '') ? -1 : 1);
    if (!WAI.sel && list.length) WAI.sel = list[0].wa;
    const snip = m => (m.dir === 'out' ? '↩ ' : '') + (m.template ? m.template : m.body || (m.filename || m.type || ''));
    let h = '<div class="wai"><div class="wai-list"><div class="rows">' +
      (list.length ? list.map(c => '<div class="wai-c' + (c.wa === WAI.sel ? ' on' : '') + '" data-act="wai-open" data-wa="' + esc(c.wa) + '"><div class="n">' + esc(waiWho(c.wa)) + '</div><div class="t">' + fmtDT(c.last.at) + '</div><div class="s">' + esc(snip(c.last)) + '</div>' + (c.unread ? '<div class="u">' + c.unread + '</div>' : '<div></div>') + '</div>').join('')
        : '<div class="wai-c"><div class="s">No chats yet</div></div>') + '</div></div>';
    const c = conv[WAI.sel];
    if (c) {
      const msgs = WAI.msgs.filter(m => m.wa === c.wa).sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
      const tick = m => m.dir !== 'out' ? '' : m.status === 'read' ? ' <span class="rd">✓✓</span>' : m.status === 'delivered' ? ' ✓✓' : m.status === 'failed' ? ' ✕' : ' ✓';
      const open = c.lastIn && (Date.now() - new Date(c.lastIn).getTime()) < 24 * 3600 * 1000;
      h += '<div class="wai-chat"><div class="wai-h">' + esc(waiWho(c.wa)) + '<small>+' + esc(c.wa) + '</small></div><div class="wai-m" id="waiM">' +
        msgs.map(m => '<div class="wai-b ' + m.dir + '">' + (m.template ? '<div class="tpl">' + esc(m.template) + '</div>' : '') + esc(m.body || '') +
          (m.media_id ? '<div><a data-act="wai-media" data-id="' + esc(m.media_id) + '">📎 ' + esc(m.filename || m.type || 'Attachment') + '</a></div>' : (m.filename && m.dir === 'out' ? '<div>📎 ' + esc(m.filename) + '</div>' : '')) +
          (m.error ? '<div class="err">' + esc(m.error) + '</div>' : '') +
          '<div class="meta">' + (m.by_name ? esc(m.by_name) + ' · ' : '') + fmtDT(m.at) + tick(m) + '</div></div>').join('') + '</div>' +
        (open ? '' : '<div class="wai-note">' + (c.lastIn ? 'Reply closed — no message from this number in the last 24 hours.' : 'Reply closed — this number has not written to us.') + '</div>') +
        '<div class="wai-f"><textarea id="waiTxt"' + (open ? '' : ' disabled') + '>' + esc(WAI.draft[c.wa] || '') + '</textarea><button class="btn primary" data-act="wai-send"' + (open ? '' : ' disabled') + '>Send</button></div></div>';
    } else h += '<div class="wai-chat"></div>';
    h += '</div>';
    const main = setMain(h);
    const box = $('#waiM'); if (box) box.scrollTop = box.scrollHeight;
    const t = $('#waiTxt'); if (t) { t.addEventListener('input', () => { WAI.draft[WAI.sel] = t.value; }); t.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ACTIONS['wai-send'](); }); }
    if (c && c.unread) waiSeen(c.wa);
    return main;
  }
};
async function waiSeen(wa) {
  WAI.msgs.forEach(m => { if (m.wa === wa && m.dir === 'in') m.seen = true; });
  try { await SB.from('nx_wa_msgs').update({ seen: true }).eq('wa', wa).eq('dir', 'in').eq('seen', false); } catch (e) { }
}
ACTIONS['wai-open'] = el => { WAI.sel = el.dataset.wa; VIEWS.wainbox.render(); };
ACTIONS['wai-send'] = async () => {
  const t = $('#waiTxt'); const text = t ? t.value.trim() : ''; const to = WAI.sel;
  if (!text || !to) return;
  const btn = $('[data-act="wai-send"]'); if (btn) btn.disabled = true;
  try {
    const { data, error } = await SB.functions.invoke('nx-wa', { body: { action: 'reply', to, text } });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) flash('Not sent: ' + esc(msg), 'err');
    else { WAI.draft[to] = ''; audit('wa.reply', '+' + to, text.slice(0, 80)); }
  } catch (e) { flash('Not sent: ' + esc(e.message), 'err'); }
  if (btn) btn.disabled = false;
  if (curView().v === 'wainbox') VIEWS.wainbox.render();
};
ACTIONS['wai-media'] = async el => {
  try {
    const { data, error } = await SB.functions.invoke('nx-wa', { body: { action: 'media', media_id: el.dataset.id } });
    let msg = data && data.error;
    if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) { flash(esc(msg), 'err'); return; }
    const bin = atob(data.data); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: data.mime }));
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; if (data.filename) a.download = data.filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { flash(esc(e.message), 'err'); }
};
