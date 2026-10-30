/* Nexus 2.0 — Website forms inside Nexus.
   Lead (Merchant): inquiries from zootofashion.com, with reply by mail / WhatsApp, status, owner and notes.
   Vendor Requests (Purchase): vendor registrations from the website with their documents; Approve makes the vendor. */
'use strict';

const LEAD_ST = ['New', 'Contacted', 'Quoted', 'Won', 'Closed'];
const LD_UI = { f: 'open', q: '', open: null };
const ldStCls = s => s === 'New' ? 'Late' : s === 'Won' ? 'Done' : s === 'Closed' ? 'Cancelled' : 'Pending';
const ldLast = l => [].concat(l.replies || [], l.notes || []).map(x => x.at).sort().pop() || l.at;
function ldMerchants() { return Store.all('users').filter(u => u.active !== false && /MERCHAND|MANAGEMENT|OPERATIONS/i.test(u.department || '')).map(u => u.name).sort(); }
VIEWS.leads = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit'); const q = norm(LD_UI.q);
    const all = Store.all('leads');
    const list = all.filter(l => LD_UI.f === 'all' || (LD_UI.f === 'open' ? !['Won', 'Closed'].includes(l.status) : LD_UI.f === 'new' ? l.status === 'New' : ['Won', 'Closed'].includes(l.status)))
      .filter(l => !q || norm([l.no, l.name, l.company, l.email, l.phone, l.message].join(' ')).includes(q)).sort((a, b) => ldLast(b) < ldLast(a) ? -1 : 1);
    const n = f => all.filter(l => f === 'new' ? l.status === 'New' : f === 'open' ? !['Won', 'Closed'].includes(l.status) : ['Won', 'Closed'].includes(l.status)).length;
    let h = '<div class="toolbar">' + seg('ldf', [{ v: 'new', l: 'New (' + n('new') + ')' }, { v: 'open', l: 'Open (' + n('open') + ')' }, { v: 'done', l: 'Won / Closed (' + n('done') + ')' }, { v: 'all', l: 'All' }], LD_UI.f) +
      '<input id="ldQ" placeholder="Search name, company, email, text…" value="' + esc(LD_UI.q) + '"><span class="muted small">' + list.length + ' lead(s)</span><span class="grow"></span><button class="btn" data-act="print">Print</button></div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Name</th><th>Company</th><th>Email</th><th>Mobile</th><th>Message</th><th>Status</th><th>Owner</th><th>Last activity</th><th class="noprint"></th></tr>' +
      (list.length ? list.map(l => '<tr' + (LD_UI.open === l.id ? ' class="cur"' : '') + '><td class="nowrap"><b>' + esc(l.no) + '</b></td><td class="nowrap">' + fmtDT(l.at) + '</td><td><b>' + esc(l.name) + '</b></td><td>' + esc(l.company || '') + '</td><td><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a></td><td class="nowrap">' + (l.phone ? '<a href="https://wa.me/91' + esc(l.phone) + '" target="_blank" rel="noopener">' + esc(l.phone) + '</a>' : esc(l.phone_raw || '')) + '</td><td style="max-width:320px">' + esc(String(l.message || '').slice(0, 140)) + (String(l.message || '').length > 140 ? '…' : '') + '</td>' +
        '<td><span class="st ' + ldStCls(l.status) + '">' + esc(l.status) + '</span></td><td>' + esc(l.assigned || '') + '</td><td class="nowrap">' + fmtDT(ldLast(l)) + '</td><td class="noprint"><button class="btn sm" data-act="ld-open" data-id="' + esc(l.id) + '">' + (LD_UI.open === l.id ? 'Close' : 'Open') + '</button></td></tr>' +
        (LD_UI.open === l.id ? '<tr class="inline-form"><td colspan="11">' + ldDetail(l, edit) + '</td></tr>' : '')).join('')
        : '<tr><td colspan="11" class="empty">No leads</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { const s = e.target.dataset.seg; if (s === 'ldf') { LD_UI.f = e.detail; VIEWS.leads.render(); } if (s === 'ldst') ACTIONS['ld-status'](null, e.detail); });
    const sq = $('#ldQ'); if (sq) sq.addEventListener('input', () => { LD_UI.q = sq.value; clearTimeout(LD_UI.t); LD_UI.t = setTimeout(() => { const p = sq.selectionStart; VIEWS.leads.render(); const n2 = $('#ldQ'); if (n2) { n2.focus(); n2.setSelectionRange(p, p); } }, 250); });
    const as = $('#ldAssign'); if (as) as.addEventListener('change', () => ACTIONS['ld-assign'](as));
  }
};
function ldDetail(l, edit) {
  const thread = [].concat((l.replies || []).map(r => Object.assign({ kind: r.kind || 'mail' }, r)), (l.notes || []).map(nt => Object.assign({ kind: 'note' }, nt))).sort((a, b) => a.at < b.at ? -1 : 1);
  const kindL = { mail: '✉ Mail sent', whatsapp: '💬 WhatsApp', note: '📝 Note', status: '● Status' };
  return '<div class="panel"><div class="grid2"><div><table class="kv"><tr><td class="muted" style="width:110px">From</td><td><b>' + esc(l.name) + '</b>' + (l.company ? ' · ' + esc(l.company) : '') + '</td></tr><tr><td class="muted">Email</td><td>' + esc(l.email) + '</td></tr><tr><td class="muted">Mobile</td><td>' + esc(l.phone || l.phone_raw || '—') + '</td></tr><tr><td class="muted">Received</td><td>' + fmtDT(l.at) + (l.page ? ' · ' + esc(l.page) : '') + '</td></tr><tr><td class="muted" style="vertical-align:top">Message</td><td style="white-space:pre-wrap">' + esc(l.message) + '</td></tr></table></div>' +
    '<div>' + (edit ? '<div class="toolbar"><span class="muted small">Status</span>' + seg('ldst', LEAD_ST, l.status) + '</div><div class="toolbar"><span class="muted small">Owner</span><select id="ldAssign">' + selOpts(ldMerchants(), l.assigned || '', '— nobody —') + '</select></div>' : '<div class="small">Status ' + esc(l.status) + ' · Owner ' + esc(l.assigned || '—') + '</div>') + '</div></div>' +
    '<h2>Conversation</h2>' + (thread.length ? '<div class="ld-th">' + thread.map(t => '<div class="ld-m ' + esc(t.kind) + '"><div class="small muted">' + (kindL[t.kind] || esc(t.kind)) + ' · ' + esc(t.by || '') + ' · ' + fmtDT(t.at) + (t.subject ? ' · <b>' + esc(t.subject) + '</b>' : '') + (t.status ? ' · ' + esc(t.status) : '') + '</div><div style="white-space:pre-wrap">' + esc(t.text || '') + '</div></div>').join('') + '</div>' : '<div class="small muted">No reply yet</div>') +
    (edit ? '<div class="ld-reply"><table class="jckv"><tr><td class="k">Subject</td><td class="v"><input id="ldSub" value="' + esc('Re: your inquiry to Zooto Fashion (' + l.no + ')') + '"></td></tr><tr><td class="k">Reply *</td><td class="v"><textarea id="ldTxt" rows="5" placeholder="Dear ' + esc(l.name) + ',"></textarea></td></tr></table>' +
      '<div class="toolbar"><button class="btn primary" data-act="ld-mail" data-id="' + esc(l.id) + '">Send mail</button>' + (l.phone ? '<button class="btn" data-act="ld-wa" data-id="' + esc(l.id) + '">Send on WhatsApp</button>' : '') + '<button class="btn" data-act="ld-note" data-id="' + esc(l.id) + '">Add as note</button><span id="ldMsg" class="small late-txt"></span></div></div>' : '') + '</div>';
}
ACTIONS['ld-open'] = el => { LD_UI.open = LD_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.leads.render(); };
const ldCur = () => Store.get('leads', LD_UI.open);
ACTIONS['ld-status'] = (el, st) => { if (!requirePerm('merchant', 'edit')) return; const l = ldCur(); if (!l || !LEAD_ST.includes(st) || l.status === st) return; const old = l.status; l.status = st; l.notes = (l.notes || []).concat([{ at: nowIso(), by: ME.name, text: old + ' → ' + st, kind: 'status' }]); Store.put('leads', l); audit('lead.status', l.no, old + ' → ' + st); VIEWS.leads.render(); };
ACTIONS['ld-assign'] = el => { if (!requirePerm('merchant', 'edit')) return; const l = ldCur(); if (!l) return; const old = l.assigned || ''; l.assigned = el.value; l.notes = (l.notes || []).concat([{ at: nowIso(), by: ME.name, text: 'Owner: ' + (old || '—') + ' → ' + (el.value || '—'), kind: 'status' }]); Store.put('leads', l); audit('lead.assign', l.no, l.assigned); VIEWS.leads.render(); };
ACTIONS['ld-note'] = el => { if (!requirePerm('merchant', 'edit')) return; const l = Store.get('leads', el.dataset.id); const t = ($('#ldTxt') || {}).value || ''; if (!l || !t.trim()) { const m = $('#ldMsg'); if (m) m.textContent = 'Write the note first.'; return; } l.notes = (l.notes || []).concat([{ at: nowIso(), by: ME.name, text: t.trim(), kind: 'note' }]); Store.put('leads', l); audit('lead.note', l.no, t.trim().slice(0, 80)); VIEWS.leads.render(); };
ACTIONS['ld-mail'] = async el => {
  if (!requirePerm('merchant', 'edit')) return;
  const l = Store.get('leads', el.dataset.id); const sub = ($('#ldSub') || {}).value || '', txt = (($('#ldTxt') || {}).value || '').trim(); const msg = t => { const m = $('#ldMsg'); if (m) m.textContent = t; };
  if (!l) return; if (!txt) return msg('Write the reply first.'); if (!sub.trim()) return msg('Enter the subject.');
  if (!CLOUD) return msg('Mail works in cloud mode.');
  el.disabled = true; msg('Sending…');
  const body = txt + '\n\n' + ME.name + '\n' + (settings().company || 'Zooto Fashion Pvt Ltd') + (ME.mobile ? '\n+91 ' + ME.mobile : '');
  // sent from the Nexus mailbox with reply-to = the sender, so the lead's answer lands with the person who replied
  const mq = Store.put('mail_queue', { id: uid(), to: l.email, subject: sub.trim(), body, ref: l.no, name: settings().company || 'Zooto Fashion', reply_to: ME.email || '', status: 'queued', at: nowIso(), by: ME.name });
  await mailSend(mq.id); const m2 = Store.get('mail_queue', mq.id) || {};
  const ok = m2.status === 'sent';
  l.replies = (l.replies || []).concat([{ at: nowIso(), by: ME.name, kind: 'mail', subject: sub.trim(), text: txt, status: ok ? 'sent' : 'failed' + (m2.error ? ' — ' + m2.error : '') }]);
  if (ok && l.status === 'New') l.status = 'Contacted'; if (!l.assigned && ldMerchants().includes(ME.name)) l.assigned = ME.name;
  Store.put('leads', l); audit('lead.reply', l.no, (ok ? 'mail sent' : 'mail failed') + ' · ' + sub.trim());
  flash(ok ? 'Reply mailed to ' + esc(l.email) + '.' : 'Mail failed: ' + esc(m2.error || ''), ok ? '' : 'err'); VIEWS.leads.render();
};
ACTIONS['ld-wa'] = el => {
  if (!requirePerm('merchant', 'edit')) return;
  const l = Store.get('leads', el.dataset.id); const txt = (($('#ldTxt') || {}).value || '').trim(); if (!l || !l.phone) return;
  if (!txt) { const m = $('#ldMsg'); if (m) m.textContent = 'Write the reply first.'; return; }
  window.open('https://wa.me/91' + l.phone + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  l.replies = (l.replies || []).concat([{ at: nowIso(), by: ME.name, kind: 'whatsapp', text: txt, status: 'opened in WhatsApp' }]);
  if (l.status === 'New') l.status = 'Contacted'; if (!l.assigned && ldMerchants().includes(ME.name)) l.assigned = ME.name;
  Store.put('leads', l); audit('lead.reply', l.no, 'WhatsApp · ' + txt.slice(0, 60)); VIEWS.leads.render();
};

/* ---------- Purchase → Vendor Requests ---------- */
const VR_UI = { f: 'Pending', open: null };
const VR_DOCS = [['pan_owner', 'PAN card (owner)'], ['pan_company', 'PAN card (company)'], ['gst', 'GST certificate'], ['msme', 'MSME certificate'], ['cheque', 'Cancelled cheque']];
VIEWS.vendorreq = {
  mod: 'purchase', render() {
    const edit = can('purchase', 'edit');
    const all = Store.all('vendor_requests');
    const list = all.filter(v => !VR_UI.f || v.status === VR_UI.f).sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    const n = s => all.filter(v => v.status === s).length;
    let h = '<div class="toolbar">' + seg('vrf', [{ v: 'Pending', l: 'Pending (' + n('Pending') + ')' }, { v: 'Approved', l: 'Approved' }, { v: 'Rejected', l: 'Rejected' }, { v: '', l: 'All' }], VR_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button></div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Firm</th><th>Owner</th><th>Type</th><th>GST No</th><th>State</th><th>Mobile</th><th>Email</th><th>MSME</th><th>Status</th><th>By</th><th class="noprint"></th></tr>' +
      (list.length ? list.map(v => '<tr' + (VR_UI.open === v.id ? ' class="cur"' : '') + '><td class="nowrap"><b>' + esc(v.no) + '</b></td><td class="nowrap">' + fmtDT(v.at) + '</td><td><b>' + esc(v.name) + '</b></td><td>' + esc(v.owner) + '</td><td>' + esc(v.business_type) + '</td><td class="nowrap">' + esc(v.gstin) + '</td><td>' + esc(v.state || '') + '</td><td class="nowrap">' + esc(v.mobile) + '</td><td>' + esc(v.email) + '</td><td>' + (v.msme ? esc(v.msme_type || 'Yes') : 'No') + '</td>' +
        '<td><span class="st ' + (v.status === 'Approved' ? 'Done' : v.status === 'Rejected' ? 'Cancelled' : 'Pending') + '">' + esc(v.status) + '</span></td><td>' + esc(v.decided_by || '') + (v.decided_at ? '<div class="small muted">' + fmtDT(v.decided_at) + '</div>' : '') + '</td><td class="noprint"><button class="btn sm" data-act="vr-open" data-id="' + esc(v.id) + '">' + (VR_UI.open === v.id ? 'Close' : 'Open') + '</button></td></tr>' +
        (VR_UI.open === v.id ? '<tr class="inline-form"><td colspan="13">' + vrDetail(v, edit) + '</td></tr>' : '')).join('')
        : '<tr><td colspan="13" class="empty">No vendor requests</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'vrf') { VR_UI.f = e.detail; VIEWS.vendorreq.render(); } });
  }
};
function vrDetail(v, edit) {
  const kv = rows => '<table class="kv">' + rows.map(([k, x]) => '<tr><td class="muted" style="width:150px">' + k + '</td><td>' + x + '</td></tr>').join('') + '</table>';
  return '<div class="panel"><div class="grid2"><div>' + kv([['Firm', '<b>' + esc(v.name) + '</b>'], ['Owner', esc(v.owner)], ['Business type', esc(v.business_type)], ['GST No', esc(v.gstin) + (v.state ? ' · ' + esc(v.state) : '')], ['PAN (owner)', esc(v.pan_owner)], ['PAN (company)', esc(v.pan_company || '—')], ['MSME', v.msme ? esc(v.msme_type || 'Yes') + ' · ' + esc(v.msme_no || '') : 'No'], ['Mobile', esc(v.mobile)], ['Email', esc(v.email)], ['Address', esc(v.address)]]) + '</div>' +
    '<div>' + kv([['Bank', esc(v.bank_name)], ['Account no', esc(v.bank_acc)], ['IFSC', esc(v.ifsc)], ['Submitted', fmtDT(v.at)]].concat(v.status !== 'Pending' ? [[v.status + ' by', esc(v.decided_by || '') + ' · ' + fmtDT(v.decided_at)], ['Remark', esc(v.remark || '')]] : [])) +
    '<div class="toolbar" style="margin-top:8px"><span class="muted small">Documents</span>' + VR_DOCS.filter(([k]) => (v.docs || {})[k]).map(([k, l]) => '<button class="btn sm" data-act="vr-doc" data-path="' + esc(v.docs[k]) + '">' + l + '</button>').join('') + '</div>' +
    (edit && v.status === 'Pending' ? '<div class="toolbar"><button class="btn primary" data-act="vr-approve" data-id="' + esc(v.id) + '" data-confirm="Approve and add to Vendors?">Approve → add vendor</button><button class="btn danger" data-act="vr-reject" data-id="' + esc(v.id) + '">Reject</button></div>' : '') + '</div></div></div>';
}
ACTIONS['vr-open'] = el => { VR_UI.open = VR_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.vendorreq.render(); };
ACTIONS['vr-doc'] = async el => {
  if (!CLOUD || !SB) { flash('Documents open in cloud mode.', 'err'); return; }
  el.disabled = true;
  try { const { data, error } = await SB.functions.invoke('nx-web', { body: { action: 'doc', path: el.dataset.path } }); let msg = data && data.error; if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } } if (msg) flash(esc(msg), 'err'); else window.open(data.url, '_blank', 'noopener'); } catch (e) { flash(esc(e.message), 'err'); }
  el.disabled = false;
};
ACTIONS['vr-approve'] = el => {
  if (!requirePerm('purchase', 'edit')) return;
  const v = Store.get('vendor_requests', el.dataset.id); if (!v || v.status !== 'Pending') return;
  if (Store.all('vendors').some(x => norm(x.gstin) === norm(v.gstin))) { flash('A vendor with this GST No already exists.', 'err'); return; }
  let name = v.name; if (Store.all('vendors').some(x => norm(x.name) === norm(name))) name = v.name + ' (' + v.gstin.slice(-4) + ')';
  const ven = { id: uid(), name, address: v.address, gstin: v.gstin, state: v.state || gstState(v.gstin), email: v.email, mobile: v.mobile, owner: v.owner, business_type: v.business_type, pan: v.pan_company || v.pan_owner, pan_owner: v.pan_owner, msme_no: v.msme_no || '', msme_type: v.msme_type || '', bank_name: v.bank_name, bank_acc: v.bank_acc, ifsc: v.ifsc, docs: v.docs || {}, request_no: v.no, created_at: nowIso(), created_by: ME.name };
  Store.put('vendors', ven);
  v.status = 'Approved'; v.decided_by = ME.name; v.decided_at = nowIso(); v.vendor_id = ven.id; Store.put('vendor_requests', v);
  audit('vendor.approve_request', v.no, name + ' · ' + v.gstin); flash(esc(name) + ' added to Vendors.'); VIEWS.vendorreq.render();
};
ACTIONS['vr-reject'] = el => {
  if (!requirePerm('purchase', 'edit')) return;
  const v = Store.get('vendor_requests', el.dataset.id); if (!v || v.status !== 'Pending') return;
  reasonDialog('Reject ' + v.no + ' · ' + v.name, 'Reject', why => { v.status = 'Rejected'; v.remark = why; v.decided_by = ME.name; v.decided_at = nowIso(); Store.put('vendor_requests', v); audit('vendor.reject_request', v.no, why); VIEWS.vendorreq.render(); }, true);
};
