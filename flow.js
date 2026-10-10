/* Nexus 2.0 — purchase-to-GRN flow: PO document + approval (approve / amend / reject),
   gate entry, QC check for selected categories, merchant approval of mismatches, GRN per gate entry. */
'use strict';

/* ---------- shared ---------- */
function isSuperAdminPo() { return isSuperAdmin(); }
function readDoc(file, cb) {
  if (!file) return cb('');
  if (/^image\//.test(file.type)) return readImg(file, cb);
  if (file.size > 1.5e6) { flash('File is too large (max 1.5 MB).', 'err'); return cb(''); }
  const fr = new FileReader(); fr.onload = () => cb(fr.result); fr.readAsDataURL(file);
}
function docThumb(src) { return !src ? '' : /^data:application\/pdf/.test(src) ? '<a data-act="doc-view" data-src="' + esc(src) + '">PDF</a>' : photoThumb(src); }
ACTIONS['doc-view'] = el => { const w = window.open(''); w.document.write('<iframe src="' + el.dataset.src + '" style="border:0;width:100%;height:100vh"></iframe>'); w.document.close(); };
function qcCats() { const s = settings(); return Array.isArray(s.qc_categories) ? s.qc_categories : ['Silicon', 'Fabric', 'Synthetic']; }
function isQcCat(cat) { return qcCats().some(c => norm(c) === norm(cat)); }
function brandMerchant(brand) { const c = Store.all('customers').find(x => norm(x.name) === norm(brand)); return c ? String(c.merchandiser || '').trim() : ''; }
function isMyMerchant(name) { if (!ME || !name) return false; const n = norm(name); return norm(ME.doer || '') === n || norm(String(ME.name || '').split(/[\s(]/)[0]) === n; }
function pendingInwardOf(poNo) { return Store.all('inwards').find(i => i.status === 'Pending GRN' && norm(i.po_no) === norm(poNo)); }
// a PO with a gate entry still waiting for GRN cannot take another gate entry
function inwardPOs(vendor) { return openPOs().filter(p => (!vendor || norm(p.vendor) === norm(vendor)) && !pendingInwardOf(p.no)); }
function qcOpen(q) { return !q.result || (q.result === 'Mismatch' && !q.m_status); }
const kvTable = rows => '<table class="jckv">' + rows.map(([k, v]) => '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>').join('') + '</table>';

/* ================= PO document (screen, approval and print share it) ================= */
const PO_TERMS_DEFAULT = 'Excess Quantity against PO will not be accepted.\nPlease attach a copy of this PO with your invoice.\nThe PO will be canceled if the delivery date is not met.';
function amt2(n) { return (Math.round(num(n) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function inWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : t[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const w = x => { if (!x) return ''; const parts = []; const cr = Math.floor(x / 1e7), lk = Math.floor(x / 1e5) % 100, th = Math.floor(x / 1e3) % 100, rest = x % 1000;
    if (cr) parts.push(w(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (rest) parts.push(three(rest)); return parts.join(' '); };
  const r = Math.floor(num(n)), p = Math.round((num(n) - r) * 100);
  return (w(r) || 'Zero') + ' Rupees' + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}
function poDocHtml(p) {
  const v = vendorBy(p.vendor) || {}; const s = settings(); const e = x => esc(x == null ? '' : String(x));
  let amt = 0, gst = 0, tot = 0;
  const rows = (p.lines || []).map((l, i) => {
    const m = matBy(l.material) || {}; const a = num(l.qty) * num(l.rate); const g = a * num(l.gst) / 100; amt += a; gst += g; tot += a + g;
    const ph = m.photo || '';
    return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + (ph ? '<img src="' + e(ph) + '" onerror="this.remove()">' : '') + '</td><td>' + e(l.material) + '</td><td class="c">' + e(m.hsn || '') + '</td><td>' + e(m.name || l.material) + '</td><td class="c">' + e(l.remark || 'NA') + '</td>' +
      '<td class="r">' + amt2(l.qty) + '</td><td class="c">' + e(l.uom || m.uom || '') + '</td><td class="r">' + amt2(l.rate) + '</td><td class="r">' + amt2(a) + '</td><td class="r">' + num(l.gst) + '% | ' + amt2(g) + '</td><td class="r">' + amt2(a + g) + '</td></tr>';
  }).join('');
  const terms = String(s.po_terms || PO_TERMS_DEFAULT).split('\n').map(x => x.trim()).filter(Boolean);
  const vAddr = [v.address, v.state].filter(Boolean).join(', ');
  return '<div class="po2">' +
    '<div class="po2-co"><div class="po2-name">' + e(s.company || '') + '</div><div class="po2-sub">' + e(s.address || '') + '</div><div class="po2-sub">' + [s.gstin ? 'GSTIN: ' + e(s.gstin) : '', s.email ? 'Email: ' + e(s.email) : ''].filter(Boolean).join(' | ') + '</div></div>' +
    '<div class="po2-title">PURCHASE ORDER</div>' +
    '<div class="po2-parties"><table class="po2-kv"><tr><th>Supplier:</th><td>' + e(p.vendor) + '</td></tr><tr><th>Address:</th><td>' + e(vAddr) + '</td></tr><tr><th>GSTIN:</th><td>' + e(v.gstin || '') + '</td></tr>' + (v.mobile ? '<tr><th>Mobile:</th><td>' + e(v.mobile) + '</td></tr>' : '') + (v.email ? '<tr><th>Email:</th><td>' + e(v.email) + '</td></tr>' : '') + '</table>' +
    '<table class="po2-kv po2-right"><tr><th>PO Number:</th><td>' + e(p.no) + '</td></tr><tr><th>PO Date:</th><td>' + e(fmtD(p.date)) + '</td></tr><tr><th>Order Date:</th><td>' + e(fmtD((p.at || p.date || '').slice(0, 10))) + '</td></tr><tr><th>Delivery Date:</th><td>' + e(fmtD(p.expected)) + '</td></tr></table></div>' +
    '<table class="po2-items"><thead><tr><th class="c">S No</th><th class="c">Photo</th><th>Part Code</th><th class="c">HSN</th><th>Description</th><th class="c">Remark</th><th class="r">Qty</th><th class="c">Unit</th><th class="r">Rate (₹)</th><th class="r">Amount (₹)</th><th class="r">GST (₹)</th><th class="r">Total (₹)</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="9" class="r">Total:</td><td class="r">' + amt2(amt) + '</td><td class="r">' + amt2(gst) + '</td><td class="r">' + amt2(tot) + '</td></tr></tfoot></table>' +
    '<div class="po2-words">Total Amount in Words: ' + inWords(tot) + '</div>' +
    (p.remarks ? '<div class="po2-rem"><b>Remarks:</b> ' + e(p.remarks) + '</div>' : '') +
    '<div class="po2-terms"><div class="po2-th">Terms and Conditions:</div><ol>' + terms.map(x => '<li>' + e(x) + '</li>').join('') + '</ol></div>' +
    '<div class="po2-sign"><div><div class="po2-sl">Prepared By:</div><div class="po2-sn">' + e(p.created_by || '') + '</div></div><div class="r"><div class="po2-sl">Approved By:</div><div class="po2-sn">' + e(p.approval === 'Approved' ? p.approved_by || '' : '') + '</div></div></div>' +
    '</div>';
}
const PO_DOC_CSS = '.po2 table{width:auto;border:0;background:none;border-collapse:collapse;margin:0}.po2 th,.po2 td{background:none;border:0;color:inherit;text-transform:none;letter-spacing:0;font-size:inherit;height:auto;box-shadow:none}.po2 tr{background:none!important}' + '.po2{font-family:Helvetica,Arial,sans-serif;color:#111;background:#fff;padding:18px 22px;font-size:11px}' +
  '.po2-co{text-align:center;border-bottom:1px solid #555;padding-bottom:8px}.po2-name{color:#0e6a73;font-size:18px;font-weight:700;letter-spacing:.02em}.po2-sub{font-size:9.5px;font-weight:600;color:#333;margin-top:2px}' +
  '.po2-title{text-align:center;color:#0e6a73;font-size:15px;font-weight:700;margin:14px 0 10px}' +
  '.po2-parties{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:12px}.po2-kv{border-collapse:collapse;font-size:10.5px}.po2 .po2-kv th,.po2 .po2-kv td{padding:2px 0;vertical-align:top;line-height:1.35;font-size:10.5px}.po2 .po2-kv th{text-align:left;font-weight:700;padding-right:8px;white-space:nowrap}.po2-kv td{max-width:330px}' +
  '.po2 .po2-right th{text-align:right}.po2 .po2-right td{text-align:right;white-space:nowrap}' +
  '.po2 .po2-items{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}.po2 .po2-items thead th{background:#f1f4f6;font-weight:700;padding:6px 6px;border-bottom:1px solid #cfd6da;text-align:left;white-space:nowrap}' +
  '.po2 .po2-items td{padding:6px 6px;height:34px;border-bottom:1px solid #e6eaec;vertical-align:middle}.po2-items img{height:30px;max-width:44px;object-fit:cover;border-radius:2px}' +
  '.po2 .po2-items .c{text-align:center}.po2 .po2-items .r{text-align:right;white-space:nowrap}.po2 .po2-items tfoot td{font-weight:700;border-bottom:0;border-top:1px solid #999;padding-top:8px}' +
  '.po2-words{font-weight:700;font-size:11.5px;margin:12px 0 10px}.po2-rem{font-size:10.5px;margin-bottom:8px}' +
  '.po2 .po2-items td.po2-note{font-size:9.5px;max-width:220px;white-space:normal}.po2-terms{border-left:10px solid #0e6a73;padding:4px 12px;font-size:10px}.po2-th{font-weight:700;font-size:11px;margin-bottom:4px}.po2-terms ol{margin:0;padding-left:16px}' +
  '.po2-sign{display:flex;justify-content:space-between;margin-top:34px}.po2-sign .r{text-align:right}.po2-sl{font-weight:700;font-size:11px}.po2-sn{font-weight:700;font-size:10.5px;margin-top:18px;text-transform:uppercase}';
(function () { const st = document.createElement('style'); st.textContent = PO_DOC_CSS; document.head.appendChild(st); })();
ACTIONS['po-print'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id); if (!p) return;
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(p.no) + '</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' + PO_DOC_CSS + '</style></head><body>' + poDocHtml(p) + '<script>window.onload=function(){window.print()}</' + 'script></body></html>');
  w.document.close();
};

/* ================= PO Approval ================= */
const PA_UI = { id: null, act: null, view: null };
VIEWS.poapproval = {
  mod: 'purchase', render() {
    const list = Store.all('purchase_orders').filter(p => !p.cancelled && p.approval === 'Pending').sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
    const p = PA_UI.view ? list.find(x => x.id === PA_UI.view) : null;
    if (!p) {
      PA_UI.view = null;
      setMain('<div class="tbl-wrap"><table><tr><th>PO No</th><th>PO Date</th><th>Vendor</th><th>Expected</th><th>Raised By</th><th></th></tr>' +
        (list.length ? list.map(x => '<tr><td><b>' + esc(x.no) + '</b></td><td>' + fmtD(x.date) + '</td><td>' + esc(x.vendor) + '</td><td>' + fmtD(x.expected) + '</td><td>' + esc(x.created_by || '') + '</td><td class="right"><button class="btn sm primary" data-act="pa-view" data-id="' + esc(x.id) + '">View</button></td></tr>').join('')
          : '<tr><td colspan="6" class="empty">No purchase orders waiting for approval</td></tr>') + '</table></div>');
      return;
    }
    const ok = canApprovePo(p);
    let bar = '<div class="toolbar"><button class="btn" data-act="pa-back">‹ Back</button><span class="grow"></span>';
    if (ok && PA_UI.id === p.id) bar += '<input id="paRem" autocomplete="off" style="min-width:320px" placeholder="' + (PA_UI.act === 'amend' ? 'What to amend' : 'Reason for rejection') + '"><button class="btn ' + (PA_UI.act === 'amend' ? 'primary' : 'danger') + '" data-act="pa-confirm" data-id="' + esc(p.id) + '">' + (PA_UI.act === 'amend' ? 'Send for amendment' : 'Reject PO') + '</button><button class="btn" data-act="pa-cancel">Cancel</button>';
    else bar += (ok ? '<button class="btn primary" data-act="pa-approve" data-id="' + esc(p.id) + '">Approve</button><button class="btn" data-act="pa-open" data-a="amend" data-id="' + esc(p.id) + '">Amend</button><button class="btn danger" data-act="pa-open" data-a="reject" data-id="' + esc(p.id) + '">Reject</button>' : '') + '<button class="btn ghost" data-act="po-print" data-id="' + esc(p.id) + '">Print</button>';
    bar += '</div>';
    const hist = (p.amend_log || []).length ? '<div class="tbl-wrap" style="margin-top:12px"><table><tr><th>Amendment</th><th>By</th><th>Date</th></tr>' + p.amend_log.map(x => '<tr><td>' + esc(x.remark) + '</td><td>' + esc(x.by) + '</td><td>' + fmtDT(x.at) + '</td></tr>').join('') + '</table></div>' : '';
    const moq = (p.moq_log || []).length ? '<div class="tbl-wrap" style="margin-top:12px"><table><tr><th>Item Code</th><th class="num">Net Requirement</th><th class="num">Ordered (MOQ)</th><th class="num">Extra</th><th>Reason</th><th>By</th></tr>' + p.moq_log.map(x => '<tr><td>' + esc(x.material) + '</td><td class="num">' + qtyFmt(x.net) + '</td><td class="num">' + qtyFmt(x.moq) + '</td><td class="num">' + qtyFmt(x.extra) + '</td><td>' + esc(x.reason) + '</td><td>' + esc(x.by) + '</td></tr>').join('') + '</table></div>' : '';
    const rev = p.revised_from ? '<div class="tbl-wrap" style="margin-bottom:12px"><table class="nopage"><tr><th>Replaces PO</th><th>Item Code</th><th>Item Name</th><th class="num">Old Rate</th><th class="num">New Rate</th><th>Reason</th></tr>' +
      (p.price_changes || []).map(x => '<tr><td><b>' + esc(p.revised_from) + '</b></td><td>' + esc(x.material) + '</td><td>' + esc((matBy(x.material) || {}).name || '') + '</td><td class="num">' + esc(x.from) + '</td><td class="num"><b>' + esc(x.to) + '</b></td><td>' + esc(p.revise_reason || '') + '</td></tr>').join('') + '</table></div>' : '';
    setMain(bar + rev + '<div class="card po2-card">' + poDocHtml(p) + '</div>' + moq + hist);
    const r = $('#paRem'); if (r) r.focus();
  }
};
ACTIONS['pa-view'] = el => { PA_UI.view = el.dataset.id; PA_UI.id = null; VIEWS.poapproval.render(); };
ACTIONS['pa-back'] = () => { PA_UI.view = null; PA_UI.id = null; VIEWS.poapproval.render(); };
ACTIONS['pa-approve'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id);
  if (!p || p.approval !== 'Pending') return;
  if (!canApprovePo(p)) { flash(poOwn(p) ? 'You raised this PO — someone else must approve it.' : 'Only Admin/Manager can approve POs.', 'err'); return; }
  if (p.revised_from && !isSuperAdmin()) { flash('A price revision is approved by the CEO (Super Admin).', 'err'); return; }
  poMarkApproved(p); flash(esc(p.no) + ' approved.'); PA_UI.view = null; VIEWS.poapproval.render();
};
// PO approved: job card PO quantities go up and the vendor gets the PO on WhatsApp
function poJcRaise(p, sign) { (p.lines || []).forEach(l => { if (!l.jc_no) return; const j = jcBy(l.jc_no); if (!j) return; const jl = (j.lines || []).find(x => norm(x.material) === norm(l.material)); if (jl) { jl.po_raised = Math.max(0, num(jl.po_raised) + sign * num(l.qty)); Store.put('job_cards', j); } }); }
function poMarkApproved(p, how) {
  p.approval = 'Approved'; p.approved_by = ME.name; p.approved_at = nowIso(); Store.put('purchase_orders', p);
  poJcRaise(p, 1); audit(how || 'po.approve', p.no, p.vendor + (p.revised_from ? ' · replaces ' + p.revised_from : '')); waSend('po_approved', p.id);
}
ACTIONS['pa-open'] = el => { PA_UI.id = el.dataset.id; PA_UI.act = el.dataset.a; VIEWS.poapproval.render(); };
ACTIONS['pa-cancel'] = () => { PA_UI.id = null; PA_UI.act = null; VIEWS.poapproval.render(); };
ACTIONS['pa-confirm'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id); if (!p || p.approval !== 'Pending') return;
  if (!canApprovePo(p)) { flash('You cannot act on this PO.', 'err'); return; }
  const rem = ($('#paRem') || { value: '' }).value.trim();
  if (!rem) { flash(PA_UI.act === 'amend' ? 'Write what needs to be amended.' : 'Write the reason for rejection.', 'err'); return; }
  if (PA_UI.act === 'amend') {
    // the approver amends the PO himself; it is approved when he saves it (it does not go back to the creator)
    p.approval = 'Amend'; p.amend_by = ME.name; p.amend_by_id = ME.id; p.amend_log = (p.amend_log || []).concat([{ remark: rem, by: ME.name, at: nowIso() }]);
    Store.put('purchase_orders', p); audit('po.amend', p.no, rem); PA_UI.id = null; PA_UI.act = null; PA_UI.view = null;
    go('po'); setTimeout(() => ACTIONS['po-edit']({ dataset: { id: p.id } }), 60); return;
  }
  p.approval = 'Rejected'; p.approved_by = ME.name; p.approved_at = nowIso(); p.reject_remark = rem;
  audit('po.reject', p.no, rem); flash(esc(p.no) + ' rejected.');
  // a rejected price revision puts the earlier PO back
  if (p.revised_from_id) { const old = Store.get('purchase_orders', p.revised_from_id); if (old && old.cancelled && old.superseded_by === p.no) { old.cancelled = false; old.cancel_reason = ''; old.superseded_by = ''; Store.put('purchase_orders', old); audit('po.revision_rejected', old.no, 'restored — ' + p.no + ' rejected'); } }
  Store.put('purchase_orders', p); PA_UI.id = null; PA_UI.act = null; PA_UI.view = null; VIEWS.poapproval.render();
};

/* ================= Vendor details dialog (PO form) ================= */
const VEN_REQ = [['address', 'Address'], ['state', 'State'], ['gstin', 'GST No'], ['mobile', 'Mobile No.'], ['email', 'Email ID']];
function vendorMissing(v) { return v ? VEN_REQ.filter(([k]) => !String(v[k] || '').trim()) : []; }
function vendorDialog(v, done) {
  const old = $('#venDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'venDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + esc(v.name) + '</div><table class="jckv">' +
    VEN_REQ.map(([k, l]) => '<tr><td class="k">' + l + ' *</td><td class="v">' + (k === 'state' ? '<select data-vd="state"><option value=""></option>' + (v.state && !stateNames().includes(v.state) ? '<option selected>' + esc(v.state) + '</option>' : '') + stateNames().map(n => '<option' + (n === v.state ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : '<input data-vd="' + k + '" value="' + esc(v[k] || '') + '"' + (k === 'gstin' ? ' style="text-transform:uppercase" maxlength="15"' : k === 'mobile' ? ' inputmode="numeric" maxlength="10"' : '') + '>') + '</td></tr>').join('') +
    '</table><div class="dlg-f"><span id="vdMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-vd-cancel>Cancel</button><button class="btn primary" data-vd-save>Save</button></div></div>';
  document.body.appendChild(d);
  const first = VEN_REQ.map(([k]) => $('[data-vd="' + k + '"]', d)).find(i => !i.value.trim()); (first || $('[data-vd]', d)).focus();
  // the state follows the GST No (first 2 digits)
  $('[data-vd="gstin"]', d).addEventListener('input', ev => { const g = ev.target.value.trim().toUpperCase(); if (g.length === 15 && !gstinError(g)) $('[data-vd="state"]', d).value = gstState(g); });
  d.addEventListener('click', async ev => {
    if (ev.target.closest('[data-vd-cancel]')) { d.remove(); return; }
    const btn = ev.target.closest('[data-vd-save]'); if (!btn || btn.disabled) return;
    const val = {}; VEN_REQ.forEach(([k]) => { val[k] = $('[data-vd="' + k + '"]', d).value.trim(); }); val.gstin = val.gstin.toUpperCase(); val.email = val.email.toLowerCase();
    const err = VEN_REQ.filter(([k]) => !val[k]).map(x => x[1]).join(', ');
    const bad = err ? 'Required: ' + err : gstinError(val.gstin) || (gstState(val.gstin) !== val.state ? 'State does not match the GST No (' + val.gstin.slice(0, 2) + ' = ' + gstState(val.gstin) + ').' : '') || mobileError(val.mobile) || emailSyntaxError(val.email);
    if (bad) { $('#vdMsg', d).textContent = bad; return; }
    // a new email is kept only when the mail check passes
    if (norm(val.email) !== norm(v.email || '')) {
      btn.disabled = true; $('#vdMsg', d).textContent = 'Checking email — a short mail is sent to it (about 40 seconds)…';
      const r = (await verifyEmails([val.email]))[val.email]; btn.disabled = false;
      if (!r || !r.ok) { $('#vdMsg', d).textContent = 'Email not accepted: ' + ((r && r.reason) || 'check failed') + '. Enter a working email ID.'; audit('vendors.email_rejected', v.name, val.email + ' · ' + ((r && r.reason) || '')); return; }
      val.email_verified_at = nowIso();
    }
    const cur = vendorBy(v.name); Object.assign(cur, val); Store.put('vendors', cur); audit('vendor.edit', cur.name, 'details completed from PO');
    d.remove(); flash(esc(cur.name) + ' updated.'); if (done) done(cur);
  });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') d.remove(); if (ev.key === 'Enter') { ev.preventDefault(); $('[data-vd-save]', d).click(); } });
}
document.addEventListener('change', e => {
  if (e.target.id !== 'npVen') return;
  const v = vendorBy(e.target.value);
  if (!v && e.target.value) flash(esc(e.target.value) + ' is not in the Vendors master — add it in Purchase › Vendors first.', 'err');
  if (v && vendorMissing(v).length) vendorDialog(v);
});

/* ================= Attach control ================= */
// A clear drop-zone style picker: paper-clip + "Attach …" when empty, thumbnail + "Change" when filled.
function attachBox(attrs, src, label) {
  const box = '<label class="attach' + (src ? ' has' : '') + '">' + (src ? docThumb(src) + '<span class="attach-t">Change</span>' : '<span class="attach-i">&#128206;</span><span class="attach-t">' + esc(label || 'Attach file') + '</span>') + '<input type="file" ' + attrs + ' style="display:none"></label>';
  // image boxes also get a Camera button: a phone connected as a webcam (USB) or the laptop camera
  return /accept="[^"]*image/.test(attrs) ? '<span class="attach-wrap">' + box + '<button type="button" class="btn sm cam-btn" data-act="cam-open" title="Take a photo with a camera (phone as webcam)">&#128247; Camera</button>' +
    (CLOUD ? '<button type="button" class="btn sm cam-btn" data-act="phone-cam" data-lbl="' + esc(label || 'Photo') + '" title="Take the photo on your phone (Nexus Camera app)">&#128241; Phone</button>' : '') + '</span>' : box;
}

/* ================= Phone camera (cam.html) ================= */
// The laptop asks, the same user's phone (Nexus Camera, cam.html) takes the photo, and it lands in this attach box.
// Requests and photos live in table nx_cam, readable only by their own user.
const camUrl = () => new URL('cam.html', location.href).href;
function loadQr() { return window.qrcode ? Promise.resolve() : new Promise(ok => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); }); }
ACTIONS['phone-cam'] = async el => {
  const input = el.closest('.attach-wrap') && el.closest('.attach-wrap').querySelector('input[type=file]'); if (!input || !SB) return;
  const { data: ses } = await SB.auth.getSession(); const uid = ses && ses.session && ses.session.user.id; if (!uid) { flash('Sign in again to use the phone camera.', 'err'); return; }
  const cv = curView().v; const navIt = NAV.reduce((a, g) => a.concat(g.items || []), []).find(x => x.v === cv); const where = navIt ? navIt.l : ''; const label = (el.dataset.lbl || 'Photo') + (where ? ' · ' + where : '');
  const { data: rq, error } = await SB.from('nx_cam').insert({ kind: 'req', label: label.slice(0, 120) }).select('id').single();
  if (error) { flash('Phone camera: ' + esc(error.message), 'err'); return; }
  const old = $('#pcDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'pcDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg pc"><div class="dlg-h">&#128241; Take the photo on your phone</div>' +
    '<div class="pc-wait"><span class="pc-spin"></span> Waiting for the phone… <b>' + esc(el.dataset.lbl || 'Photo') + '</b></div>' +
    '<div class="pc-help"><div id="pcQr" class="pc-qr"></div><div class="small">Open <b>Nexus Camera</b> on your phone and sign in with the same login. First time: scan this code or open<br><a href="' + esc(camUrl()) + '" target="_blank">' + esc(camUrl()) + '</a><br>then <i>Add to Home screen</i> so it is one tap next time.</div></div>' +
    '<div class="dlg-f"><span id="pcMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-pc="x">Cancel</button></div></div>';
  document.body.appendChild(d);
  loadQr().then(() => { try { if (!window.qrcode) return; const q = window.qrcode(0, 'M'); q.addData(camUrl()); q.make(); const box = $('#pcQr', d); if (box) box.innerHTML = q.createImgTag(4, 8); } catch (e) { } });
  let done = false;
  const ch = SB.channel('pc-' + rq.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nx_cam', filter: 'uid=eq.' + uid }, async p => {
    if (done || p.new.kind !== 'photo' || p.new.req_id !== rq.id) return; done = true;
    $('.pc-wait', d).innerHTML = '<span class="pc-spin"></span> Photo received — attaching…';
    const { data: row } = await SB.from('nx_cam').select('img').eq('id', p.new.id).single();
    const img = row && row.img; if (!img) { $('#pcMsg', d).textContent = 'The photo could not be read — try again.'; done = false; return; }
    const bin = atob(img.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'phone-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
    finish(); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    SB.from('nx_cam').delete().in('id', [rq.id, p.new.id]).then(() => {});
    flash('Photo from the phone attached.');
  }).subscribe();
  const finish = () => { SB.removeChannel(ch); d.remove(); };
  d.addEventListener('click', ev => { const b = ev.target.closest('[data-pc]'); if (b && b.dataset.pc === 'x') { finish(); if (!done) SB.from('nx_cam').delete().eq('id', rq.id).then(() => {}); } });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') { finish(); if (!done) SB.from('nx_cam').delete().eq('id', rq.id).then(() => {}); } });
};

// Photos sent from the phone without a request (no "Phone" button pressed) go into the photo box that is open:
// Item Creation's photo, else the only empty photo box on the screen.
let CAM_LISTEN = null;
async function camListen() {
  if (CAM_LISTEN || !CLOUD || !SB) return; CAM_LISTEN = 'starting';
  const { data: ses } = await SB.auth.getSession(); const uid = ses && ses.session && ses.session.user.id; if (!uid) { CAM_LISTEN = null; return; }
  CAM_LISTEN = SB.channel('cam-free-' + uid).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nx_cam', filter: 'uid=eq.' + uid }, async p => {
    if (p.new.kind !== 'photo' || p.new.req_id) return;
    const vis = i => !!(i && i.closest('.attach-wrap') && i.closest('.attach-wrap').offsetParent);
    let target = curView().v === 'itemcreate' ? $('#icPhoto') : null;
    if (!vis(target)) { const empty = $$('.attach-wrap input[type=file]').filter(i => vis(i) && /image/.test(i.accept || '') && !i.closest('.attach').classList.contains('has')); target = empty.length === 1 ? empty[0] : null; }
    if (!target) { flash('Photo from the phone not attached — open the screen with the photo box first.', 'err'); SB.from('nx_cam').delete().eq('id', p.new.id).then(() => {}); return; }
    const { data: row } = await SB.from('nx_cam').select('img').eq('id', p.new.id).single();
    if (!row || !row.img) return;
    const bin = atob(row.img.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'phone-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
    target.files = dt.files; target.dispatchEvent(new Event('change', { bubbles: true }));
    SB.from('nx_cam').delete().eq('id', p.new.id).then(() => {});
    flash('Photo from the phone attached.');
  }).subscribe();
}

/* ================= Camera capture ================= */
// Opens a live camera (any webcam the computer sees, including a phone in USB webcam mode), captures a photo and
// hands it to the attach box's file input as if the file had been chosen, so every screen works unchanged.
const CAM_KEY = 'nexus2_cam';
ACTIONS['cam-open'] = async el => {
  const input = el.closest('.attach-wrap') && el.closest('.attach-wrap').querySelector('input[type=file]'); if (!input) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { flash('This browser cannot open a camera here.', 'err'); return; }
  const old = $('#camDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'camDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg cam"><div class="dlg-h">Camera</div><div class="cam-bar"><select id="camDev"><option>Opening camera…</option></select></div>' +
    '<div class="cam-view"><video id="camVid" autoplay playsinline muted></video><img id="camShot" class="hidden"></div>' +
    '<div class="dlg-f"><span id="camMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-cam="x">Cancel</button><button class="btn hidden" data-cam="again">Retake</button><button class="btn primary" data-cam="snap">Capture</button><button class="btn primary hidden" data-cam="use">Use photo</button></div></div>';
  document.body.appendChild(d);
  const vid = $('#camVid', d), sel = $('#camDev', d), shot = $('#camShot', d); let stream = null, blob = null;
  const stop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  const close = () => { stop(); d.remove(); };
  const start = async id => {
    stop(); $('#camMsg', d).textContent = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ width: { ideal: 1920 }, height: { ideal: 1080 } }, id ? { deviceId: { exact: id } } : { facingMode: 'environment' }), audio: false });
      vid.srcObject = stream; const cur = stream.getVideoTracks()[0].getSettings().deviceId || id || '';
      try { localStorage.setItem(CAM_KEY, cur); } catch (e) { }
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'videoinput');
      sel.innerHTML = cams.map((c, k) => '<option value="' + esc(c.deviceId) + '"' + (c.deviceId === cur ? ' selected' : '') + '>' + esc(c.label || 'Camera ' + (k + 1)) + '</option>').join('');
    } catch (e) { $('#camMsg', d).textContent = e.name === 'NotAllowedError' ? 'Allow the camera in the browser (camera icon in the address bar).' : e.name === 'NotFoundError' ? 'No camera found — connect the phone in webcam mode.' : 'Camera: ' + e.message; }
  };
  sel.addEventListener('change', () => start(sel.value));
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-cam]'); if (!b) return; const k = b.dataset.cam;
    if (k === 'x') close();
    if (k === 'snap') {
      if (!stream || !vid.videoWidth) return; const cv = document.createElement('canvas'); cv.width = vid.videoWidth; cv.height = vid.videoHeight; cv.getContext('2d').drawImage(vid, 0, 0);
      cv.toBlob(bl => { blob = bl; shot.src = URL.createObjectURL(bl); shot.classList.remove('hidden'); vid.classList.add('hidden');
        ['snap'].forEach(x => $('[data-cam=' + x + ']', d).classList.add('hidden')); ['again', 'use'].forEach(x => $('[data-cam=' + x + ']', d).classList.remove('hidden')); }, 'image/jpeg', 0.9);
    }
    if (k === 'again') { blob = null; shot.classList.add('hidden'); vid.classList.remove('hidden'); $('[data-cam=snap]', d).classList.remove('hidden'); ['again', 'use'].forEach(x => $('[data-cam=' + x + ']', d).classList.add('hidden')); }
    if (k === 'use' && blob) {
      const f = new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' }); const dt = new DataTransfer(); dt.items.add(f);
      input.files = dt.files; close(); input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
  let last = ''; try { last = localStorage.getItem(CAM_KEY) || ''; } catch (e) { }
  await start(last); if (!stream && last) await start('');
};

/* ================= GRN number (reserved at gate entry) ================= */
function reserveGrnNo() {
  const co = (settings().company_code || 'ZF').toUpperCase();
  const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const head = co + '/GRN/' + y + '-' + String((y + 1) % 100).padStart(2, '0') + '/';
  const nos = Store.all('grns').map(g => g.no).concat(Store.all('inwards').map(i => i.grn_no));
  const max = nos.reduce((m, n) => n && n.startsWith(head) ? Math.max(m, parseInt(n.slice(head.length), 10) || 0) : m, 0);
  return head + String(max + 1).padStart(4, '0');
}

/* ================= Stage of a gate entry ================= */
// Gate entry → Invoice approval → QC (QC categories) → Merchant approval (QC mismatch) → GRN
function inwardQcState(i) {
  const qs = i.qc || [];
  if (qs.some(q => !q.result)) return { ok: false, label: 'QC pending' };
  if (qs.some(q => q.result === 'Mismatch' && !q.m_status)) return { ok: false, label: 'Merchant approval pending' };
  return { ok: true, label: qs.length ? 'QC done' : 'No QC needed' };
}
function inwardStage(i) {
  if (i.status === 'GRN Done') return 'GRN Done';
  if (i.status === 'Invoice Rejected' || i.inv_status === 'Rejected') return 'Invoice Rejected';
  if (i.inv_status === 'Hold') return 'Invoice on Hold';
  if (i.inv_status !== 'Approved') return 'Invoice Approval Pending';
  const q = inwardQcState(i);
  return q.ok ? 'Ready for GRN' : q.label;
}
const invApproved = i => i.status === 'Pending GRN' && i.inv_status === 'Approved';

/* ================= Gate entry (Invoice / Sample) ================= */
const INW_UI = { form: false, bt: 'Invoice', ven: '', po: '', f: {}, photo: '', qcDoc: '' };
VIEWS.inward = {
  mod: 'store', render() {
    const edit = can('store', 'edit'); const U = INW_UI; const F = U.f;
    let h = '<div class="toolbar"><span class="grow"></span>' + (edit ? '<button class="btn ' + (U.form ? '' : 'primary') + '" data-act="inw-new">' + (U.form ? 'Close' : '+ Gate Entry') + '</button>' : '') + '</div>';
    if (U.form && edit) {
      const vendors = Array.from(new Set(inwardPOs().map(p => p.vendor))).sort();
      const pos = U.ven ? inwardPOs(U.ven) : [];
      const qc = !!(vendorBy(U.ven) || {}).qc_required;
      const sel = (id, opts, val, ph, dis) => '<select id="' + id + '"' + (dis ? ' disabled' : '') + '><option value="">' + ph + '</option>' + opts.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
      const inp = (k, type) => '<input data-f="' + k + '"' + (type ? ' type="' + type + '"' + (type === 'number' ? ' min="0" step="any"' : '') : '') + ' value="' + esc(F[k] || '') + '" autocomplete="off">';
      const left = [
        ['Bill Type', seg('inwBt', ['Invoice', 'Sample'], U.bt)],
        ['Vendor *', sel('inwVen', vendors, U.ven, vendors.length ? 'Select vendor…' : 'No open PO')],
        ['PO Number *', sel('inwPo', pos.map(p => p.no), U.po, U.ven ? (pos.length ? 'Select PO…' : 'No PO available') : '—', !U.ven)],
        [U.bt + ' No *', inp('bill_no')],
        [U.bt + ' Date *', inp('bill_date', 'date')],
        ['Inwarding Date', '<input value="' + fmtD(todayYmd()) + '" readonly>']
      ];
      const right = [['Invoice Qty *', inp('qty', 'number')]]
        .concat(qc ? [['QC No *', inp('qc_no')], ['QC Report *', attachBox('id="inwQc" accept="image/*,application/pdf"', U.qcDoc, 'Attach QC report')]] : [])
        .concat([['Invoice Photo *', attachBox('id="inwPhoto" accept="image/*"', U.photo, 'Attach invoice photo')], ['Remark', inp('remark')]]);
      h += '<div class="card"><div class="card-b"><div class="inwform">' + kvTable(left) + kvTable(right) + '</div></div>' +
        '<div class="card-f"><button class="btn primary" data-act="inw-save">Save</button><span id="niMsg" class="small"></span></div></div>';
    }
    const am = Store.all('inwards').filter(i => i.inv_status === 'Amend');
    if (am.length) h += '<h2>Sent back for amendment</h2><div class="tbl-wrap"><table class="bomflat"><tr><th>Gate Entry</th><th>Vendor</th><th>PO Number</th><th>Invoice No</th><th>Invoice Date</th><th class="num">Invoice Qty</th><th>Reason</th><th>Sent By</th><th>Sent At</th><th></th></tr>' +
      am.map(i => { const a = (i.amend_log || []).slice(-1)[0] || {}; return '<tr><td><b>' + esc(i.no) + '</b></td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(i.bill_no) + '</td><td>' + fmtD(i.bill_date) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(a.remark || '') + '</td><td>' + esc(a.by || '') + '</td><td class="nowrap">' + fmtDT(a.at) + '</td><td class="right">' + (edit ? '<button class="btn sm primary" data-act="inw-fix" data-id="' + esc(i.id) + '">Correct &amp; resend</button>' : '') + '</td></tr>'; }).join('') + '</table></div>';
    const rows = Store.all('inwards').slice().sort((a, b) => (b.at || b.date || '') < (a.at || a.date || '') ? -1 : 1);
    h += '<h2>Previous gate entry logs</h2><div class="tbl-wrap"><table><tr><th>Timestamp</th><th>Bill Type</th><th>Vendor</th><th>PO Number</th><th>Invoice No</th><th>Invoice Date</th><th class="num">Aging (Days)</th><th class="num">Invoice Qty</th><th>Photo</th><th>Remark</th><th>GRN No</th><th>Stage</th></tr>' +
      (rows.length ? rows.map(i => { const ts = i.at || i.date; return '<tr><td>' + fmtDT(ts) + '</td><td>' + esc(i.bill_type || 'Invoice') + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no || '') + '</td><td>' + esc(i.bill_no || '') + '</td><td>' + fmtD(i.bill_date) + '</td><td class="num">' + Math.max(0, Math.floor((Date.now() - new Date(ts)) / 86400000)) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + photoThumb(i.photo) + '</td><td>' + esc(i.remark || '') + '</td><td>' + esc(i.grn_no || '') + '</td><td>' + esc(inwardStage(i)) + '</td></tr>'; }).join('')
        : '<tr><td colspan="12" class="empty">No gate entries</td></tr>') + '</table></div>';
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'inwBt') { U.bt = e.detail; VIEWS.inward.render(); } });
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'inwVen') { U.ven = t.value; U.po = ''; VIEWS.inward.render(); }
      if (t.id === 'inwPo') U.po = t.value;
      if (t.id === 'inwPhoto') readImg(t.files[0], src => { U.photo = src; VIEWS.inward.render(); });
      if (t.id === 'inwQc') readDoc(t.files[0], src => { U.qcDoc = src; VIEWS.inward.render(); });
    });
    m.addEventListener('input', e => { if (e.target.dataset.f) F[e.target.dataset.f] = e.target.value; });
  }
};
ACTIONS['inw-fix'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const i = Store.get('inwards', el.dataset.id); if (!i || i.inv_status !== 'Amend') return;
  formDialog('Correct ' + i.no, [{ k: 'bill_no', l: (i.bill_type || 'Invoice') + ' No', value: i.bill_no, req: true }, { k: 'bill_date', l: (i.bill_type || 'Invoice') + ' Date', type: 'date', value: i.bill_date, req: true }, { k: 'qty', l: 'Invoice Qty', type: 'number', value: i.qty, req: true }, { k: 'remark', l: 'Remark', value: i.remark }, { k: 'note', l: 'What was corrected', type: 'textarea', req: true }], 'Resend for approval', v => {
    Object.assign(i, { bill_no: v.bill_no, bill_date: v.bill_date, qty: v.qty, remark: v.remark, inv_status: '' });
    i.amend_log = (i.amend_log || []).concat([{ at: nowIso(), by: ME.name, remark: v.note, stage: 'Corrected' }]);
    Store.put('inwards', i); audit('inward.corrected', i.no, v.note); flash(esc(i.no) + ' corrected and sent back for invoice approval.'); VIEWS.inward.render();
  });
};
ACTIONS['inw-new'] = () => { Object.assign(INW_UI, { form: !INW_UI.form, ven: '', po: '', f: {}, photo: '', qcDoc: '' }); VIEWS.inward.render(); };
ACTIONS['inw-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const U = INW_UI, F = U.f; const vm = vendorBy(U.ven) || {}; const qc = !!vm.qc_required;
  const billNo = String(F.bill_no || '').trim();
  const err = !U.ven ? 'Select the vendor.' : !U.po ? 'Select the PO number.' : !billNo ? U.bt + ' No is required.' : !F.bill_date ? U.bt + ' Date is required.'
    : num(F.qty) <= 0 ? 'Invoice Qty is required.' : (qc && !String(F.qc_no || '').trim()) ? 'QC No is required for this vendor.' : (qc && !U.qcDoc) ? 'Attach the QC report.'
      : !U.photo ? 'Attach the invoice photo.' : '';
  if (err) { $('#niMsg').innerHTML = '<span class="late-txt">' + esc(err) + '</span>'; return; }
  if (Store.all('inwards').some(x => norm(x.vendor) === norm(U.ven) && norm(x.bill_no) === norm(billNo))) { $('#niMsg').innerHTML = '<span class="late-txt">' + esc(U.ven) + ' already has ' + esc(billNo) + '.</span>'; return; }
  if (pendingInwardOf(U.po)) { $('#niMsg').innerHTML = '<span class="late-txt">' + esc(U.po) + ' already has a gate entry waiting for GRN.</span>'; return; }
  const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(U.po)); if (!p) return;
  const qcl = [];
  p.lines.forEach(l => {
    const m = matBy(l.material); if (!m || !isQcCat(m.group)) return;
    let q = qcl.find(x => x.material === m.code);
    if (!q) { q = { material: m.code, category: m.group, brands: [], result: '', photo: '', m_status: '', m_photo: '', m_note: '' }; qcl.push(q); }
    String(l.brand || '').split(',').map(x => x.trim()).filter(Boolean).forEach(b => { if (!q.brands.includes(b)) q.brands.push(b); });
  });
  qcl.forEach(q => { q.merchants = Array.from(new Set(q.brands.map(brandMerchant).filter(Boolean))); });
  const grnNo = reserveGrnNo();
  const i = Store.put('inwards', { id: uid(), no: nextNo('inwards', 'INW'), grn_no: grnNo, at: nowIso(), date: todayYmd(), bill_type: U.bt, vendor: U.ven, po_no: U.po, bill_no: billNo, bill_date: F.bill_date, qty: num(F.qty),
    qc_no: String(F.qc_no || '').trim(), qc_report: U.qcDoc || '', photo: U.photo, remark: String(F.remark || '').trim(), status: 'Pending GRN', inv_status: '', qc: qcl, by: ME.name });
  audit('inward.create', i.no, U.bt + ' · ' + U.ven + ' · ' + U.po + ' · ' + billNo + ' · ' + grnNo); waSend('gate_entry', i.id);
  Object.assign(U, { form: false, ven: '', po: '', f: {}, photo: '', qcDoc: '' });
  flash(esc(i.no) + ' saved — GRN No ' + esc(grnNo) + '. Invoice approval pending.'); VIEWS.inward.render();
};

/* ================= Invoice approval (purchase) ================= */
const IA_UI = { view: null, act: null, notes: [] };
VIEWS.invapproval = {
  mod: 'purchase', render() {
    const edit = can('purchase', 'edit');
    const list = Store.all('inwards').filter(i => i.status === 'Pending GRN' && !['Approved', 'Rejected', 'Amend'].includes(i.inv_status)).sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
    const i = IA_UI.view ? list.find(x => x.id === IA_UI.view) : null;
    if (!i) {
      IA_UI.view = null;
      setMain('<div class="tbl-wrap"><table><tr><th>Gate Entry</th><th>Timestamp</th><th>Bill Type</th><th>Vendor</th><th>PO Number</th><th>Invoice No</th><th>Invoice Date</th><th class="num">Invoice Qty</th><th>GRN No</th><th>Status</th><th>Hold Reason</th><th></th></tr>' +
        (list.length ? list.map(x => '<tr><td><b>' + esc(x.no) + '</b></td><td>' + fmtDT(x.at) + '</td><td>' + esc(x.bill_type || 'Invoice') + '</td><td>' + esc(x.vendor) + '</td><td>' + esc(x.po_no) + '</td><td>' + esc(x.bill_no) + '</td><td>' + fmtD(x.bill_date) + '</td><td class="num">' + qtyFmt(x.qty) + '</td><td>' + esc(x.grn_no || '') + '</td><td><span class="st ' + (x.inv_status === 'Hold' ? 'Late' : 'Pending') + '">' + (x.inv_status === 'Hold' ? 'On Hold' : 'Pending') + '</span></td><td>' + esc(x.inv_status === 'Hold' ? x.inv_hold_reason || '' : '') + '</td><td class="right"><button class="btn sm primary" data-act="ia-view" data-id="' + esc(x.id) + '">View</button></td></tr>').join('')
          : '<tr><td colspan="12" class="empty">No invoices waiting for approval</td></tr>') + '</table></div>');
      return;
    }
    const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(i.po_no)) || { lines: [] };
    const codes = p.lines.map(l => l.material);
    if (!IA_UI.notes.length) IA_UI.notes = (i.grn_notes || []).length ? i.grn_notes.map(x => Object.assign({}, x)) : [{ inv_item: '', code: '', note: '' }];
    let h = '<div class="toolbar"><button class="btn" data-act="ia-back">‹ Back</button><span class="grow"></span>';
    if (edit && IA_UI.act) h += '<input id="iaRem" style="min-width:320px" placeholder="' + (IA_UI.act === 'hold' ? 'Reason for hold' : 'Reason for rejection') + '"><button class="btn ' + (IA_UI.act === 'hold' ? 'primary' : 'danger') + '" data-act="ia-confirm" data-id="' + esc(i.id) + '">' + (IA_UI.act === 'hold' ? 'Put on Hold' : 'Reject Invoice') + '</button><button class="btn" data-act="ia-cancel">Cancel</button>';
    else if (edit) h += '<button class="btn primary" data-act="ia-approve" data-id="' + esc(i.id) + '">Approve</button><button class="btn" data-act="ia-amend" data-id="' + esc(i.id) + '">Amend</button><button class="btn" data-act="ia-open" data-a="hold">Hold</button><button class="btn danger" data-act="ia-open" data-a="reject">Reject</button>';
    h += '</div>';
    h += '<div class="grid2"><div>' + kvTable([['Gate Entry', esc(i.no)], ['GRN No', esc(i.grn_no || '')], ['Bill Type', esc(i.bill_type || 'Invoice')], ['Vendor', '<b>' + esc(i.vendor) + '</b>'], ['PO Number', esc(i.po_no)], ['Invoice No', esc(i.bill_no)], ['Invoice Date', fmtD(i.bill_date)], ['Invoice Qty', qtyFmt(i.qty)], ['Inwarding', fmtDT(i.at)], ['Remark', esc(i.remark || '')]].concat(i.inv_status === 'Hold' ? [['Hold Reason', esc(i.inv_hold_reason || '')]] : [])) + '</div>' +
      '<div class="ia-photo">' + (i.photo ? '<img src="' + i.photo + '" data-act="img-view" data-src="' + esc(i.photo) + '">' : '') + '</div></div>';
    h += '<h2>PO items</h2><div class="tbl-wrap"><table><tr><th class="num">Sr</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">PO Qty</th><th class="num">Received</th><th class="num">Pending</th></tr>' +
      p.lines.map((l, k) => '<tr><td class="num">' + (k + 1) + '</td><td>' + esc(l.material) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + qtyFmt(num(l.received)) + '</td><td class="num">' + qtyFmt(Math.max(0, num(l.qty) - num(l.received))) + '</td></tr>').join('') + '</table></div>';
    h += '<h2>GRN notes</h2><div class="tbl-wrap"><table id="iaNotes"><tr><th class="num">Sr</th><th>Item name on invoice</th><th>Item Code</th><th>Item Name</th><th>Note</th><th></th></tr>' +
      IA_UI.notes.map((n, k) => '<tr data-ian="' + k + '"><td class="num">' + (k + 1) + '</td><td><input data-ia="inv_item" value="' + esc(n.inv_item) + '" style="min-width:220px"' + (edit ? '' : ' disabled') + '></td><td><select data-ia="code"' + (edit ? '' : ' disabled') + '><option value="">Select…</option>' + codes.map(c => '<option' + (norm(c) === norm(n.code) ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></td><td>' + esc((matBy(n.code) || {}).name || '') + '</td><td><input data-ia="note" value="' + esc(n.note) + '" style="min-width:220px"' + (edit ? '' : ' disabled') + '></td><td>' + (edit ? '<button class="btn ghost sm danger" data-act="ia-del" data-k="' + k + '">×</button>' : '') + '</td></tr>').join('') + '</table></div>' +
      (edit ? '<a class="small" data-act="ia-add">+ add item</a>' : '');
    const m = setMain(h);
    m.addEventListener('input', e => { const tr = e.target.closest('tr[data-ian]'); if (tr && e.target.dataset.ia) IA_UI.notes[+tr.dataset.ian][e.target.dataset.ia] = e.target.value; });
    m.addEventListener('change', e => { const tr = e.target.closest('tr[data-ian]'); if (tr && e.target.dataset.ia === 'code') { IA_UI.notes[+tr.dataset.ian].code = e.target.value; VIEWS.invapproval.render(); } });
    const r = $('#iaRem'); if (r) r.focus();
  }
};
ACTIONS['ia-amend'] = el => {
  if (!requirePerm('purchase', 'edit')) return;
  const i = Store.get('inwards', el.dataset.id); if (!i) return;
  // the approver corrects it here; it stays with him for approval (it does not go back to Store)
  formDialog('Amend ' + i.no, [{ k: 'bill_no', l: (i.bill_type || 'Invoice') + ' No', value: i.bill_no, req: true }, { k: 'bill_date', l: (i.bill_type || 'Invoice') + ' Date', type: 'date', value: i.bill_date, req: true },
    { k: 'qty', l: 'Invoice Qty', type: 'number', value: i.qty, req: true }, { k: 'remark', l: 'Remark', value: i.remark || '' }, { k: 'note', l: 'What was amended', type: 'textarea', req: true }], 'Save amendment', v => {
    if (Store.all('inwards').some(x => x.id !== i.id && norm(x.vendor) === norm(i.vendor) && norm(x.bill_no) === norm(v.bill_no))) return i.vendor + ' already has ' + v.bill_no + '.';
    const was = (i.bill_no || '') + ' · ' + (i.bill_date || '') + ' · ' + qtyFmt(i.qty);
    Object.assign(i, { bill_no: v.bill_no, bill_date: v.bill_date, qty: v.qty, remark: v.remark });
    i.amend_log = (i.amend_log || []).concat([{ at: nowIso(), by: ME.name, remark: v.note + ' (was ' + was + ')', stage: 'Amended at invoice approval' }]);
    Store.put('inwards', i); audit('inward.invoice_amend', i.no, v.note + ' — was ' + was); flash(esc(i.no) + ' amended — approve it now.'); VIEWS.invapproval.render();
  });
};
ACTIONS['ia-view'] = el => { IA_UI.view = el.dataset.id; IA_UI.act = null; IA_UI.notes = []; VIEWS.invapproval.render(); };
ACTIONS['ia-back'] = () => { IA_UI.view = null; IA_UI.act = null; IA_UI.notes = []; VIEWS.invapproval.render(); };
ACTIONS['ia-add'] = () => { IA_UI.notes.push({ inv_item: '', code: '', note: '' }); VIEWS.invapproval.render(); };
ACTIONS['ia-del'] = el => { IA_UI.notes.splice(+el.dataset.k, 1); if (!IA_UI.notes.length) IA_UI.notes.push({ inv_item: '', code: '', note: '' }); VIEWS.invapproval.render(); };
ACTIONS['ia-open'] = el => { IA_UI.act = el.dataset.a; VIEWS.invapproval.render(); };
ACTIONS['ia-cancel'] = () => { IA_UI.act = null; VIEWS.invapproval.render(); };
ACTIONS['ia-approve'] = el => {
  if (!requirePerm('purchase', 'edit')) return;
  const i = Store.get('inwards', el.dataset.id); if (!i || i.status !== 'Pending GRN') return;
  const notes = IA_UI.notes.map(n => ({ inv_item: String(n.inv_item || '').trim(), code: String(n.code || '').trim(), note: String(n.note || '').trim() })).filter(n => n.inv_item || n.code || n.note);
  const bad = notes.find(n => !n.inv_item || !n.code);
  if (!notes.length) { flash('Add the GRN note: invoice item name and its item code.', 'err'); return; }
  if (bad) { flash('Every note row needs the invoice item name and the item code.', 'err'); return; }
  i.inv_status = 'Approved'; i.grn_notes = notes; i.inv_by = ME.name; i.inv_at = nowIso(); i.inv_hold_reason = '';
  Store.put('inwards', i); audit('inward.invoice_approve', i.no, i.bill_no + ' · ' + notes.length + ' note(s)'); if ((i.qc || []).length) waSend('invoice_approved', i.id);
  IA_UI.view = null; IA_UI.notes = []; flash(esc(i.bill_no) + ' approved.' + ((i.qc || []).length ? ' QC check pending.' : ' Ready for GRN.')); VIEWS.invapproval.render();
};
ACTIONS['ia-confirm'] = el => {
  if (!requirePerm('purchase', 'edit')) return;
  const i = Store.get('inwards', el.dataset.id); if (!i) return;
  const rem = ($('#iaRem') || { value: '' }).value.trim();
  if (!rem) { flash(IA_UI.act === 'hold' ? 'Write why the invoice is on hold.' : 'Write the reason for rejection.', 'err'); return; }
  if (IA_UI.act === 'hold') { i.inv_status = 'Hold'; i.inv_hold_reason = rem; i.inv_hold_by = ME.name; i.inv_hold_at = nowIso(); audit('inward.invoice_hold', i.no, rem); flash(esc(i.bill_no) + ' put on hold.'); }
  else { i.inv_status = 'Rejected'; i.status = 'Invoice Rejected'; i.inv_reject_reason = rem; i.inv_by = ME.name; i.inv_at = nowIso(); audit('inward.invoice_reject', i.no, rem); flash(esc(i.bill_no) + ' rejected.'); }
  Store.put('inwards', i); IA_UI.view = null; IA_UI.act = null; IA_UI.notes = []; VIEWS.invapproval.render();
};

/* ================= QC check (store) ================= */
const QC_UI = { ph: {} };
VIEWS.swatchmatch = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const pend = []; const done = [];
    Store.all('inwards').filter(invApproved).forEach(i => (i.qc || []).forEach(q => (q.result ? done : pend).push({ i, q })));
    Store.all('inwards').filter(i => i.status === 'GRN Done').forEach(i => (i.qc || []).forEach(q => { if (q.result) done.push({ i, q }); }));
    let h = '<div class="tbl-wrap"><table><tr><th>Inward</th><th>Timestamp</th><th>Vendor</th><th>PO</th><th>Item Code</th><th>Item Name</th><th>Category</th><th>Brand</th><th>Amendment Note</th><th>Material Photo</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (pend.length ? pend.map(({ i, q }) => { const k = i.id + '|' + q.material; const m = matBy(q.material) || {};
        return '<tr><td><b>' + esc(i.no) + '</b></td><td>' + fmtDT(i.at || i.date) + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(q.material) + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(q.category) + '</td><td>' + esc(q.brands.join(', ')) + '</td><td>' + esc(q.qc_note || '') + '</td>' +
          '<td>' + (edit ? attachBox('accept="image/*" data-qcf="' + esc(k) + '"', QC_UI.ph[k], 'Attach photo') : '') + '</td>' +
          (edit ? '<td class="right"><button class="btn sm primary" data-act="qc-set" data-k="' + esc(k) + '" data-r="Match">Match</button> <button class="btn sm danger" data-act="qc-set" data-k="' + esc(k) + '" data-r="Mismatch">Mismatch</button></td>' : '') + '</tr>'; }).join('')
        : '<tr><td colspan="10" class="empty">No items waiting for QC</td></tr>') + '</table></div>';
    done.sort((a, b) => (b.q.at || '') < (a.q.at || '') ? -1 : 1);
    h += '<h2>Recent QC results</h2><div class="tbl-wrap"><table><tr><th>Inward</th><th>Item Code</th><th>Item Name</th><th>Result</th><th>Photo</th><th>QC By</th><th>QC Date</th><th>Merchant</th><th>Merchant Decision</th><th>Decision By</th><th>Approval Photo</th></tr>' +
      (done.length ? done.slice(0, 30).map(({ i, q }) => '<tr><td>' + esc(i.no) + '</td><td>' + esc(q.material) + '</td><td>' + esc((matBy(q.material) || {}).name || '') + '</td><td><span class="st ' + (q.result === 'Match' ? 'Done' : 'Late') + '">' + esc(q.result) + '</span></td><td>' + photoThumb(q.photo) + '</td><td>' + esc(q.by || '') + '</td><td>' + fmtDT(q.at) + '</td><td>' + (q.result === 'Mismatch' ? esc((q.merchants || []).join(', ')) : '') + '</td><td>' + (q.result === 'Mismatch' ? '<span class="st ' + (q.m_status === 'Approved' ? 'Done' : q.m_status === 'Rejected' ? 'Cancelled' : 'Pending') + '">' + esc(q.m_status || 'Pending') + '</span>' : '') + '</td><td>' + esc(q.m_by || '') + '</td><td>' + photoThumb(q.m_photo) + '</td></tr>').join('')
        : '<tr><td colspan="11" class="empty">No QC results yet</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => { const k = e.target.dataset.qcf; if (k) readImg(e.target.files[0], src => { QC_UI.ph[k] = src; VIEWS.swatchmatch.render(); }); });
  }
};
function qcFind(k) { const [id, code] = k.split('|'); const i = Store.get('inwards', id); return i ? { i, q: (i.qc || []).find(x => x.material === code) } : {}; }
ACTIONS['qc-set'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const { i, q } = qcFind(el.dataset.k); if (!q || q.result || !invApproved(i)) return;
  if (el.dataset.r === 'Match' && !QC_UI.ph[el.dataset.k]) { flash('Attach the material photo to pass QC.', 'err'); return; }
  q.result = el.dataset.r; q.photo = QC_UI.ph[el.dataset.k] || ''; q.by = ME.name; q.at = nowIso();
  Store.put('inwards', i); delete QC_UI.ph[el.dataset.k];
  audit('inward.qc', i.no, q.material + ' · ' + q.result); if (q.result === 'Mismatch') waSend('qc_mismatch', i.id + '|' + q.material);
  flash(esc(q.material) + ': ' + (q.result === 'Match' ? 'QC passed.' : 'sent to ' + esc((q.merchants || []).join(', ') || 'merchant') + ' for approval.')); VIEWS.swatchmatch.render();
};

/* ================= Swatch approval (merchant): material QC mismatches ================= */
const SW_UI = { ph: {} };
VIEWS.swatch = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const mine = [];
    Store.all('inwards').filter(invApproved).forEach(i => (i.qc || []).forEach(q => {
      if (q.result !== 'Mismatch' || q.m_status) return;
      const ms = q.merchants || [];
      if (isSuperAdmin() || ms.some(isMyMerchant) || (!ms.length && canApprove())) mine.push({ i, q });
    }));
    let h = '<div class="tbl-wrap"><table><tr><th>Inward</th><th>Vendor</th><th>PO</th><th>Item Code</th><th>Item Name</th><th>Brand</th><th>Merchant</th><th>QC By</th><th>Approval Card + Sample Photo</th><th>Note</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (mine.length ? mine.map(({ i, q }) => { const k = i.id + '|' + q.material;
        return '<tr><td><b>' + esc(i.no) + '</b></td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(q.material) + '</td><td>' + esc((matBy(q.material) || {}).name || '') + '</td><td>' + esc(q.brands.join(', ')) + '</td><td>' + esc((q.merchants || []).join(', ')) + '</td><td>' + esc(q.by || '') + '</td>' +
          '<td>' + (edit ? attachBox('accept="image/*" data-swf="' + esc(k) + '"', SW_UI.ph[k], 'Attach approval card') : '') + '</td>' +
          '<td>' + (edit ? '<input data-swn="' + esc(k) + '">' : '') + '</td>' +
          (edit ? '<td class="right"><button class="btn sm primary" data-act="qcm-set" data-k="' + esc(k) + '" data-s="Approved">Approve</button> <button class="btn sm" data-act="qcm-amend" data-k="' + esc(k) + '">Amend</button> <button class="btn sm danger" data-act="qcm-set" data-k="' + esc(k) + '" data-s="Rejected">Reject</button></td>' : '') + '</tr>'; }).join('')
        : '<tr><td colspan="11" class="empty">Nothing waiting for you</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => { const k = e.target.dataset.swf; if (k) readImg(e.target.files[0], src => { SW_UI.ph[k] = src; VIEWS.swatch.render(); }); });
  }
};
ACTIONS['qcm-set'] = el => {
  if (!requirePerm('merchant', 'edit')) return;
  const k = el.dataset.k; const { i, q } = qcFind(k); if (!q || q.m_status) return;
  if (el.dataset.s === 'Approved' && !SW_UI.ph[k]) { flash('Attach the approval card with the sample photo.', 'err'); return; }
  q.m_status = el.dataset.s; q.m_photo = SW_UI.ph[k] || ''; q.m_note = ($('[data-swn="' + k + '"]') || { value: '' }).value.trim(); q.m_by = ME.name; q.m_at = nowIso();
  Store.put('inwards', i); delete SW_UI.ph[k];
  audit('inward.qc_merchant', i.no, q.material + ' · ' + q.m_status + (q.m_note ? ' · ' + q.m_note : ''));
  flash(esc(q.material) + ' ' + q.m_status.toLowerCase() + (q.m_status === 'Rejected' ? ' — it will not be taken in GRN.' : '.')); VIEWS.swatch.render();
};
ACTIONS['qcm-amend'] = el => {
  if (!requirePerm('merchant', 'edit')) return;
  const k = el.dataset.k; const { i, q } = qcFind(k); if (!q || q.m_status) return;
  // the merchant corrects the QC result himself (a wrong mismatch becomes a match); it does not go back to QC
  formDialog('Amend QC · ' + q.material, [{ k: 'res', l: 'QC result', type: 'select', options: ['Match', 'Mismatch'], value: 'Match' }, { k: 'why', l: 'Reason', type: 'textarea', req: true }], 'Save amendment', v => {
    q.amend_log = (q.amend_log || []).concat([{ at: nowIso(), by: ME.name, remark: v.why, stage: 'Swatch Approval', result: q.result + ' → ' + v.res }]);
    q.result = v.res; q.qc_note = v.why; if (v.res === 'Match') { q.m_status = 'Approved'; q.m_by = ME.name; q.m_at = nowIso(); q.m_note = 'Amended to Match — ' + v.why; }
    Store.put('inwards', i); audit('inward.swatch_amend', i.no, q.material + ' · ' + v.res + ' · ' + v.why);
    flash(esc(q.material) + (v.res === 'Match' ? ' amended to Match — goes to GRN.' : ' stays a mismatch — approve or reject it.')); VIEWS.swatch.render();
  });
};

/* ================= GRN ================= */
// Vendor → PO (every step cleared, still open) → invoice (gate entry) → items from that PO only.
// Per item: Short = Invoice − Received; Excess = received beyond PO pending; GRN = Received − Excess − Reject;
// Total = GRN + Reject + Short + Excess, which always equals the item's invoice qty.
// Save is allowed only when the grand total equals the gate-entry invoice qty.
const GRN_UI = { ven: '', po: '', inw: '', rows: [], why: '' };
function qcBlocked(i, code) { const q = (i.qc || []).find(x => norm(x.material) === norm(code)); return q && q.result === 'Mismatch' && q.m_status === 'Rejected'; }
function grnReady() { return Store.all('inwards').filter(i => invApproved(i) && inwardQcState(i).ok).filter(i => { const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(i.po_no)); return p && !p.cancelled && p.approval === 'Approved' && poPending(p) > 0; }); }
function grnCalc(r, pen) {
  const inv = num(r.inv), rec = num(r.recv), rej = num(r.rej);
  const short = Math.max(0, inv - rec);
  const got = Math.min(rec, inv);
  const excess = Math.max(0, got - pen);
  const grn = Math.max(0, got - excess - rej);
  return { inv, rec, rej, short, excess, grn, total: grn + rej + short + excess };
}
function grnDialog(p, k, done) {
  const l = p.lines[k]; const m = matBy(l.material) || {}; const pen = Math.max(0, num(l.qty) - num(l.received));
  const old = $('#grnDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'grnDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + esc(l.material) + ' — ' + esc(m.name || '') + '</div><table class="jckv"><tr><td class="k">PO Pending</td><td class="v">' + qtyFmt(pen) + ' ' + esc(l.uom || m.uom || '') + '</td></tr>' +
    '<tr><td class="k">Invoice Qty *</td><td class="v"><input data-gd="inv" type="number" min="0" step="any"></td></tr><tr><td class="k">Received Qty *</td><td class="v"><input data-gd="recv" type="number" min="0" step="any"></td></tr></table>' +
    '<div class="dlg-f"><span id="gdMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-gd-cancel>Cancel</button><button class="btn primary" data-gd-ok>Add</button></div></div>';
  document.body.appendChild(d); $('[data-gd="inv"]', d).focus();
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-gd-cancel]')) { d.remove(); return; }
    if (!ev.target.closest('[data-gd-ok]')) return;
    const inv = num($('[data-gd="inv"]', d).value), recv = num($('[data-gd="recv"]', d).value);
    if (inv <= 0) { $('#gdMsg', d).textContent = 'Enter the invoice qty.'; return; }
    if ($('[data-gd="recv"]', d).value === '') { $('#gdMsg', d).textContent = 'Enter the received qty.'; return; }
    d.remove(); done({ i: k, inv, recv, rej: 0, rack: m.rack || '' });
  });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') d.remove(); if (ev.key === 'Enter') { ev.preventDefault(); $('[data-gd-ok]', d).click(); } });
}
VIEWS.grn = {
  mod: 'store', render() {
    const edit = can('store', 'edit'); const U = GRN_UI;
    const ready = grnReady();
    const vendors = Array.from(new Set(ready.map(i => i.vendor))).sort();
    if (U.ven && !vendors.includes(U.ven)) Object.assign(U, { ven: '', po: '', inw: '', rows: [] });
    const pos = Array.from(new Set(ready.filter(i => i.vendor === U.ven).map(i => i.po_no)));
    const invs = ready.filter(i => i.vendor === U.ven && i.po_no === U.po);
    const iw = invs.find(i => i.id === U.inw) || null;
    const p = iw ? Store.all('purchase_orders').find(x => norm(x.no) === norm(iw.po_no)) : null;
    const opt = (list, val, ph, dis) => '<option value="">' + ph + '</option>' + list.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    let h = '';
    if (edit) {
      const items = p ? p.lines.map((l, k) => ({ l, k, pen: Math.max(0, num(l.qty) - num(l.received)) })).filter(x => x.pen > 0 && !qcBlocked(iw, x.l.material) && !U.rows.some(r => r.i === x.k)) : [];
      const left = [
        ['Vendor Name *', '<select id="grVen">' + opt(vendors.map(v => [v, v]), U.ven, vendors.length ? 'Select vendor…' : 'Nothing ready for GRN') + '</select>'],
        ['PO Number *', '<select id="grPo"' + (U.ven ? '' : ' disabled') + '>' + opt(pos.map(x => [x, x]), U.po, U.ven ? 'Select PO…' : '—') + '</select>'],
        ['Invoice No *', '<select id="grInv"' + (U.po ? '' : ' disabled') + '>' + opt(invs.map(i => [i.id, i.bill_no + ' · ' + fmtD(i.bill_date) + ' · Qty ' + qtyFmt(i.qty)]), U.inw, U.po ? 'Select invoice…' : '—') + '</select>'],
        ['Item *', '<select id="grItem"' + (iw ? '' : ' disabled') + '>' + opt(items.map(x => [String(x.k), x.l.material + ' — ' + ((matBy(x.l.material) || {}).name || '')]), '', iw ? (items.length ? 'Select item…' : 'All items added') : '—') + '</select>']
      ];
      const right = iw ? [['Gate Entry', esc(iw.no)], ['Invoice Qty', '<b>' + qtyFmt(iw.qty) + '</b>'], ['Invoice Date', fmtD(iw.bill_date)], ['Invoice Photo', photoThumb(iw.photo)], ['Invoice Approved By', esc(iw.inv_by || '')]] : [];
      h += '<div class="card"><div class="card-b"><div class="inwform">' + kvTable(left) + (iw ? kvTable(right) : '<div></div>') + '</div>';
      if (iw) {
        const tot = { inv: 0, rec: 0, rej: 0, short: 0, excess: 0, grn: 0, total: 0 };
        const body = U.rows.map((r, n) => { const l = p.lines[r.i]; const mt = matBy(l.material) || {}; const pen = Math.max(0, num(l.qty) - num(l.received)); const c = grnCalc(r, pen); Object.keys(tot).forEach(k => { tot[k] += c[k]; });
          return '<tr data-gr="' + n + '"><td class="num">' + (n + 1) + '</td><td><b>' + esc(l.material) + '</b></td><td>' + esc(mt.name || '') + '</td><td>' + esc(l.uom || mt.uom || '') + '</td><td class="num">' + qtyFmt(pen) + '</td><td class="num">' + qtyFmt(c.inv) + '</td><td class="num">' + qtyFmt(c.rec) + '</td><td class="num late-txt">' + (c.short ? qtyFmt(c.short) : '') + '</td>' +
            '<td><input class="qty" type="number" min="0" step="any" data-grrej value="' + (r.rej || '') + '"></td><td class="num"><b>' + qtyFmt(c.grn) + '</b></td><td class="num">' + (c.excess ? qtyFmt(c.excess) : '') + '</td><td class="num">' + qtyFmt(c.total) + '</td><td><input data-grrack value="' + esc(r.rack || '') + '" style="width:80px"></td><td><button class="btn ghost sm danger" data-act="gr-del" data-n="' + n + '">×</button></td></tr>'; }).join('');
        const match = U.rows.length && Math.abs(tot.total - num(iw.qty)) < 1e-6;
        const badRej = U.rows.some(r => { const c = grnCalc(r, Math.max(0, num(p.lines[r.i].qty) - num(p.lines[r.i].received))); return num(r.rej) > Math.min(c.rec, c.inv) - c.excess + 1e-9; });
        h += '<div class="tbl-wrap" style="margin-top:12px"><table><tr><th class="num">Sr</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">PO Pending</th><th class="num">Invoice Qty</th><th class="num">Received Qty</th><th class="num">Short</th><th class="num">Reject</th><th class="num">GRN Qty</th><th class="num">Excess</th><th class="num">Total</th><th>Rack</th><th></th></tr>' +
          (body || '<tr><td colspan="14" class="empty">Select an item</td></tr>') +
          '<tr class="tt"><td></td><td colspan="4"><b>Grand Total</b></td><td class="num"><b>' + qtyFmt(tot.inv) + '</b></td><td class="num"><b>' + qtyFmt(tot.rec) + '</b></td><td class="num"><b>' + qtyFmt(tot.short) + '</b></td><td class="num"><b>' + qtyFmt(tot.rej) + '</b></td><td class="num"><b>' + qtyFmt(tot.grn) + '</b></td><td class="num"><b>' + qtyFmt(tot.excess) + '</b></td><td class="num"><b>' + qtyFmt(tot.total) + '</b></td><td></td><td></td></tr></table></div>' +
          (tot.rej > 0 ? '<div class="row" style="margin-top:8px"><label style="flex:1">Reject Reason *<input id="grWhy" value="' + esc(U.why || '') + '"></label></div>' : '');
        h += '</div><div class="card-f"><span class="grn-no">GRN No: <b>' + (match && !badRej ? esc(iw.grn_no || '') : '—') + '</b></span><span class="small muted">Invoice Qty ' + qtyFmt(iw.qty) + ' · Total ' + qtyFmt(tot.total) + '</span><span class="grow"></span><button class="btn primary" data-act="grn-save"' + (match && !badRej ? '' : ' disabled') + '>Save GRN</button><span id="grnMsg" class="small">' + (badRej ? '<span class="late-txt">Reject is more than the qty received against the PO.</span>' : '') + '</span></div></div>';
      } else h += '</div></div>';
    }
    const nl = ready.filter(i => (!U.ven || i.vendor === U.ven) && (!U.po || i.po_no === U.po) && (!U.inw || i.id === U.inw));
    const notes = []; nl.forEach(i => (i.grn_notes || []).forEach((n, k) => notes.push({ i, n, k })));
    h += '<h2>GRN notes</h2><div class="tbl-wrap"><table><tr><th>Gate Entry</th><th>GRN No</th><th>Vendor</th><th>PO No</th><th>Invoice No</th><th class="num">Sr</th><th>Item name on invoice</th><th>Item Code</th><th>Item Name</th><th>Note</th><th>Approved By</th></tr>' +
      (notes.length ? notes.map(({ i, n, k }) => '<tr' + (k === 0 ? ' class="bomfirst"' : '') + '><td>' + esc(i.no) + '</td><td>' + esc(i.grn_no || '') + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(i.bill_no) + '</td><td class="num">' + (k + 1) + '</td><td>' + esc(n.inv_item) + '</td><td><b>' + esc(n.code) + '</b></td><td>' + esc((matBy(n.code) || {}).name || '') + '</td><td>' + esc(n.note || '') + '</td><td>' + esc(i.inv_by || '') + '</td></tr>').join('') : '<tr><td colspan="11" class="empty">No GRN notes</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'grVen') { Object.assign(U, { ven: t.value, po: '', inw: '', rows: [], why: '' }); VIEWS.grn.render(); }
      if (t.id === 'grPo') { Object.assign(U, { po: t.value, inw: '', rows: [], why: '' }); VIEWS.grn.render(); }
      if (t.id === 'grInv') { Object.assign(U, { inw: t.value, rows: [], why: '' }); VIEWS.grn.render(); }
      if (t.id === 'grItem' && t.value !== '') { const k = +t.value; t.value = ''; grnDialog(p, k, r => { U.rows.push(r); VIEWS.grn.render(); }); }
      const tr = t.closest && t.closest('tr[data-gr]');
      if (tr && t.dataset.grrej != null) { U.rows[+tr.dataset.gr].rej = num(t.value); VIEWS.grn.render(); }
    });
    m.addEventListener('input', e => { const tr = e.target.closest('tr[data-gr]'); if (tr && e.target.dataset.grrack != null) U.rows[+tr.dataset.gr].rack = e.target.value; if (e.target.id === 'grWhy') U.why = e.target.value; });
  }
};
ACTIONS['gr-del'] = el => { GRN_UI.rows.splice(+el.dataset.n, 1); VIEWS.grn.render(); };
ACTIONS['grn-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const U = GRN_UI; const iw = Store.get('inwards', U.inw);
  if (!iw || !invApproved(iw) || !inwardQcState(iw).ok) { flash('This invoice is not ready for GRN.', 'err'); return; }
  const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(iw.po_no)); if (!p) return;
  const calc = U.rows.map(r => { const l = p.lines[r.i]; const pen = Math.max(0, num(l.qty) - num(l.received)); return Object.assign({ r, l, pen }, grnCalc(r, pen)); });
  const total = calc.reduce((a, c) => a + c.total, 0);
  if (!calc.length || Math.abs(total - num(iw.qty)) > 1e-6) { flash('Grand total must equal the invoice qty (' + qtyFmt(iw.qty) + ').', 'err'); return; }
  if (calc.some(c => qcBlocked(iw, c.l.material))) { flash('An item rejected by the merchant cannot be taken in GRN.', 'err'); return; }
  const why = String(U.why || '').trim();
  if (calc.some(c => c.rej > 0) && !why) { flash('Reject reason is required.', 'err'); return; }
  if (Store.all('grns').some(g => g.inward_id === iw.id)) { flash('This invoice already has a GRN.', 'err'); return; }
  calc.forEach(c => { c.l.received = num(c.l.received) + c.grn + c.rej; c.l.rejected = num(c.l.rejected) + c.rej; });
  Store.put('purchase_orders', p);
  const lines = calc.map(c => ({ material: c.l.material, jc_no: c.l.jc_no || '', brand: c.l.brand || '', uom: c.l.uom || '', po_pending: c.pen, inv_qty: c.inv, recv_qty: c.rec, short: c.short, rejected: c.rej, accepted: c.grn, excess: c.excess, excess_status: c.excess > 0 ? 'Pending' : '', rack: String(c.r.rack || '').trim() }));
  const g = Store.put('grns', { id: uid(), no: iw.grn_no || reserveGrnNo(), date: todayYmd(), at: nowIso(), inward_id: iw.id, inward_no: iw.no, po_id: p.id, po_no: p.no, vendor: p.vendor, invoice: iw.bill_no, invoice_date: iw.bill_date, reject_reason: why, lines, by: ME.name });
  iw.status = 'GRN Done'; Store.put('inwards', iw);
  const totRej = calc.reduce((x, c) => x + c.rej, 0), totShort = calc.reduce((x, c) => x + c.short, 0), totEx = calc.reduce((x, c) => x + c.excess, 0);
  if (totRej > 0 || totShort > 0) autoTask('Debit Note — ' + iw.bill_no + ' (' + p.vendor + '): reject ' + qtyFmt(totRej) + ', short ' + qtyFmt(totShort), autoDoer('debit_note', 'ACCOUNTS'), 0,
    { kind: 'debit_note', vendor: p.vendor, invoice: iw.bill_no || '', items: calc.filter(c => c.rej || c.short).map(c => ((matBy(c.l.material) || {}).name || c.l.material)).join(', ').slice(0, 300), party: p.vendor, ref: iw.bill_no || '' });
  if (totRej > 0) autoTask('RTV — ' + p.vendor + ' inv ' + iw.bill_no + ': ' + calc.filter(c => c.rej).map(c => c.l.material + ' × ' + qtyFmt(c.rej)).join(', '), autoDoer('rtv', 'STORE'), 1);
  autoTask('Tally Entry — GRN ' + g.no + ' (' + p.vendor + ', inv ' + iw.bill_no + ')', autoDoer('tally_entry', 'ACCOUNTS'), 1);
  audit('grn.create', g.no, iw.no + ' · ' + p.no + ' · inv ' + iw.bill_no + ' · GRN ' + qtyFmt(calc.reduce((x, c) => x + c.grn, 0)) + (totRej ? ' / rej ' + qtyFmt(totRej) : '') + (totShort ? ' / short ' + qtyFmt(totShort) : '') + (totEx ? ' / excess ' + qtyFmt(totEx) : ''));
  Object.assign(U, { ven: '', po: '', inw: '', rows: [], why: '' });
  VIEWS.grn.render();
  waSend(totEx > 0 ? 'excess_pending' : 'grn_final', g.id);
  if (totEx > 0) {
    const to = String(settings().alert_excess_email || '').trim();
    const body = 'GRN ' + g.no + ' · ' + p.vendor + ' · PO ' + p.no + ' · Invoice ' + iw.bill_no + '\n' + calc.filter(c => c.excess > 0).map(c => c.l.material + ' — ' + ((matBy(c.l.material) || {}).name || '') + ': PO pending ' + qtyFmt(c.pen) + ', invoice ' + qtyFmt(c.inv) + ', excess ' + qtyFmt(c.excess)).join('\n') + '\nGRN by ' + ME.name;
    const mq = Store.put('mail_queue', { id: uid(), to, subject: 'Excess material for approval — ' + g.no + ' (' + p.vendor + ')', body, ref: g.no, status: to ? 'queued' : 'no_recipient', name: 'Nexus 2.0', no_reply: true, at: nowIso(), by: ME.name }); if (to) mailSend(mq.id);
    flash(esc(g.no) + ' saved — stock updated. Excess ' + qtyFmt(totEx) + ' sent for approval' + (to ? ' (mail to ' + esc(to) + ')' : '') + '; GRN report after the decision.');
  }
  else { flash(esc(g.no) + ' saved — stock updated.'); ACTIONS['print-grn']({ dataset: { id: g.id } }); }
};

/* ================= Excess approval (CEO) ================= */
function canApproveExcess() { return isAdminRole() || can('excess', 'edit'); }
VIEWS.excessapproval = {
  mod: 'purchase', render() {
    const ok = canApproveExcess(); const rows = [];
    Store.all('grns').forEach(g => (g.lines || []).forEach((l, k) => { if (l.excess_status === 'Pending') rows.push({ g, l, k }); }));
    setMain('<div class="tbl-wrap"><table><tr><th>GRN No</th><th>GRN Date</th><th>Vendor</th><th>PO No</th><th>Invoice No</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">PO Pending</th><th class="num">Invoice Qty</th><th class="num">Received</th><th class="num">Excess</th><th>GRN By</th>' + (ok ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(({ g, l, k }) => '<tr><td><b>' + esc(g.no) + '</b></td><td>' + fmtD(g.date) + '</td><td>' + esc(g.vendor) + '</td><td>' + esc(g.po_no) + '</td><td>' + esc(g.invoice || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + qtyFmt(l.po_pending || 0) + '</td><td class="num">' + qtyFmt(l.inv_qty || 0) + '</td><td class="num">' + qtyFmt(l.recv_qty || 0) + '</td><td class="num late-txt"><b>' + qtyFmt(l.excess) + '</b></td><td>' + esc(g.by) + '</td>' +
        (ok ? '<td class="right"><button class="btn sm primary" data-act="ex-set" data-id="' + esc(g.id) + '" data-k="' + k + '" data-s="Approved">Accept</button> <button class="btn sm" data-act="ex-amend" data-id="' + esc(g.id) + '" data-k="' + k + '">Amend</button> <button class="btn sm danger" data-act="ex-set" data-id="' + esc(g.id) + '" data-k="' + k + '" data-s="Rejected">Reject</button></td>' : '') + '</tr>').join('')
        : '<tr><td colspan="14" class="empty">No excess waiting for approval</td></tr>') + '</table></div>');
  }
};
ACTIONS['ex-set'] = el => {
  if (!canApproveExcess()) { flash('Only the CEO can decide excess material.', 'err'); return; }
  const g = Store.get('grns', el.dataset.id); const l = g && g.lines[+el.dataset.k]; if (!l || l.excess_status !== 'Pending') return;
  l.excess_status = el.dataset.s; l.excess_by = ME.name; l.excess_at = nowIso(); Store.put('grns', g);
  audit('grn.excess_' + el.dataset.s.toLowerCase(), g.no, l.material + ' × ' + qtyFmt(l.excess));
  const done = !g.lines.some(x => x.excess_status === 'Pending');
  if (!g.lines.some(x => x.excess_status === 'Pending' || x.excess_status === 'Amend')) waSend('grn_final', g.id);
  flash(esc(l.material) + ': excess ' + (el.dataset.s === 'Approved' ? 'accepted — added to stock.' : 'rejected — moved to RTV stock.') + (done ? ' GRN ' + esc(g.no) + ' report is ready.' : ''));
  VIEWS.excessapproval.render();
};

ACTIONS['ex-amend'] = el => {
  if (!canApproveExcess()) { flash('Only the CEO can decide excess material.', 'err'); return; }
  const g = Store.get('grns', el.dataset.id); const l = g && g.lines[+el.dataset.k]; if (!l || l.excess_status !== 'Pending') return;
  // the CEO corrects the excess qty himself and then decides; it does not go back to Store
  formDialog('Amend excess · ' + g.no + ' · ' + l.material, [{ k: 'excess', l: 'Excess Qty', type: 'number', value: l.excess }, { k: 'why', l: 'What was amended', type: 'textarea', req: true }], 'Save amendment', v => {
    const ex = Math.max(0, num(v.excess)); if (ex > num(l.excess) + 1e-9) return 'Excess can only be reduced (it is ' + qtyFmt(l.excess) + ').';
    l.recv_qty = num(l.recv_qty != null ? l.recv_qty : num(l.accepted) + num(l.rejected) + num(l.excess)) - (num(l.excess) - ex);
    l.amend_log = (l.amend_log || []).concat([{ at: nowIso(), by: ME.name, remark: v.why + ' (excess ' + qtyFmt(l.excess) + ' → ' + qtyFmt(ex) + ')', stage: 'Amended at excess approval' }]);
    l.excess = ex; l.excess_status = ex > 0 ? 'Pending' : '';
    Store.put('grns', g); audit('grn.excess_amend', g.no, l.material + ' · excess ' + qtyFmt(ex) + ' · ' + v.why);
    if (!g.lines.some(x => x.excess_status === 'Pending' || x.excess_status === 'Amend')) waSend('grn_final', g.id);
    flash(ex > 0 ? 'Excess amended to ' + qtyFmt(ex) + ' — accept or reject it now.' : 'Excess removed.'); VIEWS.excessapproval.render();
  });
};
ACTIONS['ex-fix'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const g = Store.get('grns', el.dataset.id); const l = g && g.lines[+el.dataset.k]; if (!l || l.excess_status !== 'Amend') return;
  const a = (l.amend_log || []).slice(-1)[0] || {};
  formDialog('Correct excess · ' + g.no + ' · ' + l.material, [{ k: 'r', l: 'Reason', type: 'static', value: a.remark }, { k: 'excess', l: 'Excess Qty', type: 'number', value: l.excess }, { k: 'note', l: 'What was corrected', type: 'textarea', req: true }], 'Resend for approval', v => {
    const ex = Math.max(0, num(v.excess)); if (ex > num(l.excess) + 1e-9) return 'Excess can only be reduced here (it was ' + qtyFmt(l.excess) + ').';
    l.recv_qty = num(l.recv_qty != null ? l.recv_qty : num(l.accepted) + num(l.rejected) + num(l.excess)) - (num(l.excess) - ex); l.excess = ex;
    l.excess_status = ex > 0 ? 'Pending' : ''; l.amend_log = l.amend_log.concat([{ at: nowIso(), by: ME.name, remark: v.note, stage: 'Corrected' }]);
    Store.put('grns', g); audit('grn.excess_corrected', g.no, l.material + ' · excess ' + qtyFmt(ex) + ' · ' + v.note);
    if (g.lines.some(x => x.excess_status === 'Pending')) waSend('excess_pending', g.id); else if (!g.lines.some(x => x.excess_status === 'Amend')) waSend('grn_final', g.id); flash('Corrected' + (ex > 0 ? ' and sent back for excess approval.' : '.')); VIEWS.grnlist.render();
  });
};

/* ================= GRN register ================= */
VIEWS.grnlist = {
  mod: 'store', render() {
    const gs = Store.all('grns').slice().sort((a, b) => b.no < a.no ? -1 : 1);
    setMain('<div class="tbl-wrap"><table><tr><th>GRN No</th><th>GRN Date</th><th>Inward</th><th>PO No</th><th>Vendor</th><th>Invoice No</th><th class="num">Sr</th><th>Item Code</th><th>Item Name</th><th class="num">Invoice Qty</th><th class="num">Received</th><th class="num">Short</th><th class="num">Reject</th><th class="num">GRN Qty</th><th class="num">Excess</th><th>Excess Status</th><th>Rack</th><th>By</th><th>Report</th></tr>' +
      (gs.length ? gs.map(g => { const pend = (g.lines || []).some(l => l.excess_status === 'Pending' || l.excess_status === 'Amend'); return g.lines.map((l, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><b>' + esc(g.no) + '</b></td><td>' + fmtD(g.date) + '</td><td>' + esc(g.inward_no || '') + '</td><td>' + esc(g.po_no) + '</td><td>' + esc(g.vendor) + '</td><td>' + esc(g.invoice || '') + '</td><td class="num">' + (i + 1) + '</td><td>' + esc(l.material) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td class="num">' + qtyFmt(l.inv_qty || 0) + '</td><td class="num">' + qtyFmt(l.recv_qty != null ? l.recv_qty : num(l.accepted) + num(l.rejected)) + '</td><td class="num">' + qtyFmt(l.short || 0) + '</td><td class="num">' + qtyFmt(l.rejected || 0) + '</td><td class="num">' + qtyFmt(l.accepted || 0) + '</td><td class="num">' + qtyFmt(l.excess || 0) + '</td><td>' + (num(l.excess) > 0 ? '<span class="st ' + (l.excess_status === 'Approved' ? 'Done' : l.excess_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(l.excess_status || 'Pending') + '</span>' : '') + (l.excess_status === 'Amend' && can('store', 'edit') ? ' <button class="btn sm primary" data-act="ex-fix" data-id="' + esc(g.id) + '" data-k="' + i + '">Correct</button>' : '') + '</td><td>' + esc(l.rack || '') + '</td><td>' + esc(g.by) + '</td><td>' + (i === 0 ? (pend ? '<span class="st Pending">Excess approval pending</span>' : '<button class="btn sm ghost" data-act="print-grn" data-id="' + esc(g.id) + '">Print</button>') : '') + '</td></tr>').join(''); }).join('') : '<tr><td colspan="19" class="empty">No GRNs yet</td></tr>') + '</table></div>');
  }
};

/* ================= Activity list (basis for tasks & scoring) ================= */
// Every completed step with who did it and when, read from the records themselves.
function activityRows() {
  const A = [];
  const add = (at, act, ref, party, detail, by, result) => { if (at) A.push({ at, act, ref, party: party || '', detail: detail || '', by: by || '', result: result || '' }); };
  Store.all('purchase_orders').forEach(p => {
    add(p.at || p.created_at || p.date, 'PO Raised', p.no, p.vendor, p.lines.length + ' item(s)', p.created_by);
    (p.amend_log || []).forEach(x => add(x.at, 'PO Approval', p.no, p.vendor, x.remark, x.by, 'Amend'));
    if (p.approval === 'Approved') add(p.approved_at, 'PO Approval', p.no, p.vendor, '', p.approved_by, 'Approved');
    if (p.approval === 'Rejected') add(p.approved_at || p.at, 'PO Approval', p.no, p.vendor, p.reject_remark, p.approved_by, 'Rejected');
  });
  Store.all('inwards').forEach(i => {
    add(i.at, 'Gate Entry', i.no, i.vendor, 'Invoice ' + (i.bill_no || '') + ' · Qty ' + qtyFmt(i.qty), i.by);
    if (i.inv_hold_at) add(i.inv_hold_at, 'Invoice Approval', i.no, i.vendor, i.inv_hold_reason, i.inv_hold_by, 'Hold');
    if (i.inv_status === 'Approved' || i.inv_status === 'Rejected') add(i.inv_at, 'Invoice Approval', i.no, i.vendor, i.inv_status === 'Rejected' ? i.inv_reject_reason : (i.grn_notes || []).length + ' note(s)', i.inv_by, i.inv_status);
    (i.qc || []).forEach(q => {
      if (q.result) add(q.at, 'QC Check', i.no, i.vendor, q.material, q.by, q.result);
      if (q.m_status) add(q.m_at, 'Swatch Approval', i.no, i.vendor, q.material + (q.m_note ? ' · ' + q.m_note : ''), q.m_by, q.m_status);
    });
  });
  Store.all('grns').forEach(g => {
    add(g.at || g.date, 'GRN', g.no, g.vendor, 'PO ' + g.po_no + ' · Invoice ' + (g.invoice || '') + ' · ' + g.lines.length + ' item(s)', g.by);
    g.lines.forEach(l => { if (l.excess_status && l.excess_status !== 'Pending') add(l.excess_at, 'Excess Approval', g.no, g.vendor, l.material + ' × ' + qtyFmt(l.excess), l.excess_by, l.excess_status === 'Approved' ? 'Accepted' : 'Rejected'); });
  });
  return A.sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
}
const ACT_UI = { act: '', by: '', from: '', to: '' };
VIEWS.activity = {
  mod: 'audit', render() {
    const all = activityRows(); const U = ACT_UI;
    const acts = ['PO Raised', 'PO Approval', 'Gate Entry', 'Invoice Approval', 'QC Check', 'Swatch Approval', 'GRN', 'Excess Approval'];
    const people = Array.from(new Set(all.map(r => r.by).filter(Boolean))).sort();
    const rows = all.filter(r => (!U.act || r.act === U.act) && (!U.by || r.by === U.by) && (!U.from || String(r.at).slice(0, 10) >= U.from) && (!U.to || String(r.at).slice(0, 10) <= U.to));
    const sel = (id, list, val, ph) => '<select id="' + id + '"><option value="">' + ph + '</option>' + list.map(x => '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
    setMain('<div class="toolbar">' + sel('acAct', acts, U.act, 'All activities') + sel('acBy', people, U.by, 'Everyone') + '<input id="acFrom" type="date" value="' + esc(U.from) + '"><input id="acTo" type="date" value="' + esc(U.to) + '"><span class="muted small">' + rows.length + ' record(s)</span><span class="grow"></span><button class="btn" data-act="act-csv">Export CSV</button></div>' +
      '<div class="tbl-wrap"><table><tr><th>Date &amp; Time</th><th>Activity</th><th>Reference</th><th>Vendor</th><th>Detail</th><th>Result</th><th>Done By</th></tr>' +
      (rows.length ? rows.map(r => '<tr><td>' + fmtDT(r.at) + '</td><td>' + esc(r.act) + '</td><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party) + '</td><td>' + esc(r.detail) + '</td><td>' + esc(r.result) + '</td><td>' + esc(r.by) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">No activity</td></tr>') + '</table></div>');
    VIEWS.activity.rows = rows;
    const m = $('#main');
    m.addEventListener('change', e => { const k = { acAct: 'act', acBy: 'by', acFrom: 'from', acTo: 'to' }[e.target.id]; if (k) { U[k] = e.target.value; VIEWS.activity.render(); } });
  }
};
ACTIONS['act-csv'] = () => downloadCsv('activity-' + todayYmd() + '.csv', [['Date & Time', 'Activity', 'Reference', 'Vendor', 'Detail', 'Result', 'Done By']].concat((VIEWS.activity.rows || []).map(r => [fmtDT(r.at), r.act, r.ref, r.party, r.detail, r.result, r.by])));

/* ================= GRN document (format 1: same family as the PO) ================= */
function grnRemark(l, g) {
  const u = l.uom || (matBy(l.material) || {}).uom || '';
  const r = [num(l.rejected) > 0 ? qtyFmt(l.rejected) + ' ' + u + ' rejected' + (g.reject_reason ? ' (' + g.reject_reason + ')' : '') + '.' : '', num(l.short) > 0 ? qtyFmt(l.short) + ' short delivered by vendor.' : '', num(l.excess) > 0 ? qtyFmt(l.excess) + ' excess received' + (l.excess_status ? ' — ' + (l.excess_status === 'Rejected' ? 'rejected (RTV)' : l.excess_status.toLowerCase()) : '') + '.' : ''].filter(Boolean).join(' ');
  return r || 'All received in good condition. Zero rejection.';
}
function grnDocHtml(g) {
  const v = vendorBy(g.vendor) || {}; const s = settings(); const e = x => esc(x == null ? '' : String(x));
  const t = k => g.lines.reduce((a, l) => a + num(l[k] || 0), 0);
  const rec = l => l.recv_qty != null ? num(l.recv_qty) : num(l.accepted) + num(l.rejected);
  const rows = g.lines.map((l, i) => { const m = matBy(l.material) || {};
    return '<tr><td class="c">' + (i + 1) + '</td><td>' + e(l.material) + '</td><td>' + e(m.name || '') + '</td><td class="c">' + e(l.uom || m.uom || '') + '</td><td class="r">' + qtyFmt(l.po_pending || 0) + '</td><td class="r">' + qtyFmt(l.inv_qty || 0) + '</td><td class="r">' + qtyFmt(rec(l)) + '</td><td class="r">' + qtyFmt(l.short || 0) + '</td><td class="r">' + qtyFmt(l.rejected || 0) + '</td><td class="r"><b>' + qtyFmt(l.accepted || 0) + '</b></td><td class="r">' + qtyFmt(l.excess || 0) + '</td><td>' + e(num(l.excess) > 0 ? (l.excess_status === 'Rejected' ? 'Rejected (RTV)' : l.excess_status || '') : '') + '</td><td>' + e(l.rack || '') + '</td><td class="po2-note">' + e(grnRemark(l, g)) + '</td></tr>'; }).join('');
  const iw = Store.get('inwards', g.inward_id) || {};
  const sh = t('short'), rj = t('rejected'), ex = t('excess');
  const acts = [sh > 0 ? 'Debit Note to be raised for ' + qtyFmt(sh) + ' short supply.' : '', rj > 0 ? 'Debit Note to be raised for ' + qtyFmt(rj) + ' rejected qty. Vendor informed to collect rejected material within 7 days.' : '', ...g.lines.filter(l => num(l.excess) > 0).map(l => l.excess_status === 'Approved' ? 'Excess ' + qtyFmt(l.excess) + ' of ' + l.material + ' accepted by CEO.' : l.excess_status === 'Rejected' ? 'Excess ' + qtyFmt(l.excess) + ' of ' + l.material + ' rejected by CEO — return to vendor (RTV).' : 'Excess ' + qtyFmt(l.excess) + ' of ' + l.material + ' requires CEO approval before acceptance.')].filter(Boolean);
  const exBy = (g.lines.find(l => num(l.excess) > 0 && l.excess_by) || {}).excess_by || '';
  return '<div class="po2">' +
    '<div class="po2-co"><div class="po2-name">' + e(s.company || '') + '</div><div class="po2-sub">' + e(s.address || '') + '</div><div class="po2-sub">' + [s.gstin ? 'GSTIN: ' + e(s.gstin) : '', s.email ? 'Email: ' + e(s.email) : ''].filter(Boolean).join(' | ') + '</div></div>' +
    '<div class="po2-title">GOODS RECEIPT NOTE</div>' +
    '<div class="po2-parties"><table class="po2-kv"><tr><th>Supplier:</th><td>' + e(g.vendor) + '</td></tr><tr><th>Address:</th><td>' + e([v.address, v.state].filter(Boolean).join(', ')) + '</td></tr><tr><th>GSTIN:</th><td>' + e(v.gstin || '') + '</td></tr></table>' +
    '<table class="po2-kv po2-right"><tr><th>GRN No:</th><td>' + e(g.no) + '</td></tr><tr><th>GRN Date &amp; Time:</th><td>' + e(fmtDT(g.at || g.date)) + '</td></tr><tr><th>PO No:</th><td>' + e(g.po_no) + '</td></tr><tr><th>Invoice No:</th><td>' + e(g.invoice || '') + '</td></tr><tr><th>Invoice Date:</th><td>' + e(fmtD(g.invoice_date || iw.bill_date)) + '</td></tr><tr><th>Gate Entry:</th><td>' + e(g.inward_no || '') + '</td></tr></table></div>' +
    '<table class="po2-items"><thead><tr><th class="c">S No</th><th>Item Code</th><th>Description</th><th class="c">UOM</th><th class="r">PO Pending</th><th class="r">Invoice Qty</th><th class="r">Received</th><th class="r">Short</th><th class="r">Reject</th><th class="r">GRN Qty</th><th class="r">Excess</th><th>Excess Status</th><th>Rack</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="4" class="r">Total:</td><td class="r">' + qtyFmt(t('po_pending')) + '</td><td class="r">' + qtyFmt(t('inv_qty')) + '</td><td class="r">' + qtyFmt(g.lines.reduce((a, l) => a + rec(l), 0)) + '</td><td class="r">' + qtyFmt(t('short')) + '</td><td class="r">' + qtyFmt(t('rejected')) + '</td><td class="r">' + qtyFmt(t('accepted')) + '</td><td class="r">' + qtyFmt(t('excess')) + '</td><td></td><td></td><td></td></tr></tfoot></table>' +
    (g.reject_reason ? '<div class="po2-rem"><b>Reject reason:</b> ' + e(g.reject_reason) + '</div>' : '') +
    '<div class="po2-terms"><div class="po2-th">Non-Conformance / Action Remark (For Shortage &amp; Rejection):</div>' + (acts.length ? '<ol>' + acts.map(x => '<li>' + e(x) + '</li>').join('') + '</ol>' : 'No non-conformance. All items received as per PO.') + '</div>' +
    '<div class="po2-sign"><div><div class="po2-sl">Inwarding:</div><div class="po2-sn">' + e(iw.by || '') + '</div></div><div style="text-align:center"><div class="po2-sl">Store Keeper (GRN):</div><div class="po2-sn">' + e(g.by || '') + '</div></div><div class="r"><div class="po2-sl">CEO Approval (Excess Qty):</div><div class="po2-sn">' + (ex > 0 ? e(exBy) : '&nbsp;') + '</div></div></div>' +
    '</div>';
}
ACTIONS['print-grn'] = el => {
  const g = Store.get('grns', el.dataset.id); if (!g) return;
  if ((g.lines || []).some(l => l.excess_status === 'Pending' || l.excess_status === 'Amend')) { flash('GRN report is available after the excess approval decision.', 'err'); return; }
  const w = window.open(''); if (!w) { flash('Allow pop-ups for this site to print the GRN.', 'err'); return; }
  w.document.write('<html><head><title>' + esc(g.no) + '</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' + PO_DOC_CSS + '</style></head><body>' + grnDocHtml(g) + '<script>window.onload=function(){window.print()}</' + 'script></body></html>');
  w.document.close();
};
