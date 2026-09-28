/* Nexus 2.0 — WhatsApp messages (Meta Cloud API through the nx-wa edge function).
   The app only tells the server which event happened on which record; the server picks the
   template, parameters and recipients. PO approval and final GRN also send their PDF. */
'use strict';

const WA_PDF = { po_approved: 'po', grn_final: 'grn' };
const WA_EVENT_LABEL = { po_submitted: 'PO sent for approval', po_approved: 'PO approved', gate_entry: 'Gate entry', invoice_approved: 'Invoice approved', qc_mismatch: 'QC mismatch', excess_pending: 'Excess approval', grn_final: 'GRN' };

let WA_LIB = null;
function waLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!WA_LIB) WA_LIB = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'; s.onload = ok; s.onerror = () => { WA_LIB = null; bad(new Error('PDF library did not load')); }; document.head.appendChild(s); });
  return WA_LIB;
}
// the same document the Print button shows, as a PDF (base64, no prefix)
async function waPdf(kind, id) {
  await waLib();
  const d = kind === 'po' ? Store.get('purchase_orders', id) : Store.get('grns', id);
  if (!d) throw new Error('Record not found');
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;background:#fff';
  box.innerHTML = kind === 'po' ? poDocHtml(d) : grnDocHtml(d);
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
    const m = setMain('<div class="toolbar"><select id="waSt"><option value="">All status</option>' + Object.keys(stName).map(k => '<option value="' + k + '"' + (WA_UI.st === k ? ' selected' : '') + '>' + stName[k] + '</option>').join('') + '</select></div>' +
      '<div class="tbl-wrap"><table><tr><th>Date &amp; Time</th><th>Event</th><th>Ref</th><th>Template</th><th>To</th><th>Mobile</th><th>Message</th><th>Status</th><th>Error</th><th>By</th>' + (admin ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(r => '<tr><td class="nowrap">' + fmtDT(r.at) + '</td><td>' + esc(WA_EVENT_LABEL[r.event] || r.event) + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.template) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.to) + '</td><td>' + esc(r.params) + '</td><td><span class="st ' + (r.status === 'sent' ? 'Done' : 'Late') + '">' + esc(stName[r.status] || r.status) + '</span></td><td>' + esc(r.error || '') + '</td><td>' + esc(r.by || '') + '</td>' +
        (admin ? '<td>' + (r.status !== 'sent' ? '<button class="btn sm" data-act="wa-resend" data-e="' + esc(r.event) + '" data-id="' + esc(r.rid || '') + '">Resend</button>' : '') + '</td>' : '') + '</tr>').join('')
        : '<tr><td colspan="' + (admin ? 11 : 10) + '" class="empty">No WhatsApp messages yet</td></tr>') + '</table></div>');
    m.addEventListener('change', e => { if (e.target.id === 'waSt') { WA_UI.st = e.target.value; VIEWS.walog.render(); } });
  }
};
ACTIONS['wa-resend'] = el => { if (!isAdminRole() || !el.dataset.id) return; audit('wa.resend', el.dataset.e, el.dataset.id); waSend(el.dataset.e, el.dataset.id, true); };
