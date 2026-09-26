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
function poDocHtml(p) {
  const v = vendorBy(p.vendor) || {}; const s = settings();
  let amt = 0, tot = 0, q = 0;
  const rows = (p.lines || []).map((l, i) => {
    const m = matBy(l.material) || {}; const a = num(l.qty) * num(l.rate); const t = a * (1 + num(l.gst) / 100); amt += a; tot += t; q += num(l.qty);
    return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + (m.photo ? '<img class="po-ph" src="' + m.photo + '">' : '') + '</td><td>' + esc(m.name || l.material) + '</td><td>' + esc(m.group || '') + '</td><td class="c">' + esc(l.material) + '</td><td class="c">' + esc(m.hsn || '') + '</td><td class="c">' + esc(l.uom || m.uom || '') + '</td><td>' + esc(l.brand || '') + '</td>' +
      '<td class="r">' + money(l.rate || 0) + '</td><td class="c">' + (l.gst || 0) + '</td><td>' + esc(l.remark || '') + '</td><td class="r">' + qtyFmt(l.qty) + '</td><td class="r">' + money(a) + '</td><td class="r">' + money(t) + '</td></tr>';
  }).join('');
  const e = x => esc(x == null ? '' : String(x));
  return '<div class="jcdoc podoc"><div class="jcban">PURCHASE ORDER</div><div class="jcmid">' +
    '<div class="podoc-col">' + kvTable([['Company', e(s.company)], ['Address', e(s.address)], ['GSTIN', e(s.gstin)]]) + '</div>' +
    '<div class="podoc-col">' + kvTable([['PO No', '<b>' + e(p.no) + '</b>'], ['PO Date', e(fmtD(p.date))], ['Expected Delivery', e(fmtD(p.expected))], ['Raised By', e(p.created_by)], ['Status', e(poStatus(p))]]) + '</div>' +
    '<div class="podoc-col">' + kvTable([['Vendor', '<b>' + e(p.vendor) + '</b>'], ['Address', e(v.address)], ['GSTIN', e(v.gstin)], ['Mobile', e(v.mobile)], ['Email', e(v.email)]]) + '</div></div>' +
    '<table class="jcbom"><tr class="hd"><th>Sr</th><th>Photo</th><th>Item Name</th><th>Category</th><th>Code</th><th>HSN</th><th>UOM</th><th>Brand</th><th>Rate</th><th>GST %</th><th>Remark</th><th>Qty</th><th>Amount</th><th>Total</th></tr>' + rows +
    '<tr class="tt"><td colspan="11" class="r">Total</td><td class="r">' + qtyFmt(q) + '</td><td class="r">' + money(amt) + '</td><td class="r">' + money(tot) + '</td></tr></table>' +
    (p.remarks ? '<div class="podoc-note"><b>Remarks:</b> ' + esc(p.remarks) + '</div>' : '') +
    ((p.moq_log || []).length ? '<div class="podoc-note"><b>MOQ:</b> ' + p.moq_log.map(x => esc(x.material) + ' net ' + qtyFmt(x.net) + ' → ' + qtyFmt(x.moq) + ' · ' + esc(x.reason)).join('; ') + '</div>' : '') +
    ((p.amend_log || []).length ? '<div class="podoc-note"><b>Amendments:</b> ' + p.amend_log.map(x => esc(x.remark) + ' (' + esc(x.by) + ', ' + fmtDT(x.at) + ')').join('; ') + '</div>' : '') +
    (p.reject_remark ? '<div class="podoc-note late-txt"><b>Rejected:</b> ' + esc(p.reject_remark) + '</div>' : '') +
    '</div>';
}
ACTIONS['po-print'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id); if (!p) return;
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(p.no) + '</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000}' +
    JC_DOC_CSS + '.podoc-col{flex:1}.jcbom .r{text-align:right}.jcbom tr.tt td{font-weight:bold;background:#e3f2f2}.po-ph{height:34px}.podoc-note{font-size:11px;margin-top:6px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '</style></head><body>' + poDocHtml(p) + '<script>window.print()</' + 'script></body></html>');
  w.document.close();
};

/* ================= PO Approval ================= */
const PA_UI = { id: null, act: null };
VIEWS.poapproval = {
  mod: 'purchase', render() {
    const list = Store.all('purchase_orders').filter(p => !p.cancelled && p.approval === 'Pending').sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
    let h = list.length ? '' : '<div class="panel empty">No purchase orders waiting for approval</div>';
    list.forEach(p => {
      const ok = canApprovePo(p);
      h += '<div class="card"><div class="card-b">' + poDocHtml(p) + '</div><div class="card-f">' +
        (ok && PA_UI.id === p.id
          ? '<label style="flex:1">' + (PA_UI.act === 'amend' ? 'What to amend and why *' : 'Reason for rejection *') + '<input id="paRem" autocomplete="off"></label>' +
            '<button class="btn ' + (PA_UI.act === 'amend' ? 'primary' : 'confirm') + '" data-act="pa-confirm" data-id="' + esc(p.id) + '">' + (PA_UI.act === 'amend' ? 'Send for amendment' : 'Reject PO') + '</button><button class="btn" data-act="pa-cancel">Cancel</button>'
          : (ok ? '<button class="btn primary" data-act="pa-approve" data-id="' + esc(p.id) + '">Approve</button><button class="btn" data-act="pa-open" data-a="amend" data-id="' + esc(p.id) + '">Amend</button><button class="btn danger" data-act="pa-open" data-a="reject" data-id="' + esc(p.id) + '">Reject</button>' : '') +
            '<span class="grow"></span><button class="btn ghost" data-act="po-print" data-id="' + esc(p.id) + '">Print</button>') +
        '</div></div>';
    });
    setMain(h);
    const r = $('#paRem'); if (r) r.focus();
  }
};
ACTIONS['pa-approve'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id);
  if (!p || p.approval !== 'Pending') return;
  if (!canApprovePo(p)) { flash(poOwn(p) ? 'You raised this PO — someone else must approve it.' : 'Only Admin/Manager can approve POs.', 'err'); return; }
  p.approval = 'Approved'; p.approved_by = ME.name; p.approved_at = nowIso(); Store.put('purchase_orders', p);
  p.lines.forEach(l => { if (!l.jc_no) return; const j = jcBy(l.jc_no); if (!j) return; const jl = (j.lines || []).find(x => norm(x.material) === norm(l.material)); if (jl) { jl.po_raised = num(jl.po_raised) + num(l.qty); Store.put('job_cards', j); } });
  audit('po.approve', p.no, p.vendor); flash(esc(p.no) + ' approved.'); VIEWS.poapproval.render();
};
ACTIONS['pa-open'] = el => { PA_UI.id = el.dataset.id; PA_UI.act = el.dataset.a; VIEWS.poapproval.render(); };
ACTIONS['pa-cancel'] = () => { PA_UI.id = null; PA_UI.act = null; VIEWS.poapproval.render(); };
ACTIONS['pa-confirm'] = el => {
  const p = Store.get('purchase_orders', el.dataset.id); if (!p || p.approval !== 'Pending') return;
  if (!canApprovePo(p)) { flash('You cannot act on this PO.', 'err'); return; }
  const rem = ($('#paRem') || { value: '' }).value.trim();
  if (!rem) { flash(PA_UI.act === 'amend' ? 'Write what needs to be amended.' : 'Write the reason for rejection.', 'err'); return; }
  if (PA_UI.act === 'amend') {
    p.approval = 'Amend'; p.amend_log = (p.amend_log || []).concat([{ remark: rem, by: ME.name, at: nowIso() }]);
    audit('po.amend_request', p.no, rem); flash(esc(p.no) + ' sent back to ' + esc(p.created_by || 'the creator') + ' for amendment.');
  } else {
    p.approval = 'Rejected'; p.approved_by = ME.name; p.reject_remark = rem;
    audit('po.reject', p.no, rem); flash(esc(p.no) + ' rejected.');
  }
  Store.put('purchase_orders', p); PA_UI.id = null; PA_UI.act = null; VIEWS.poapproval.render();
};

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
      const file = (id, src, accept) => '<label class="icphoto">' + (src ? docThumb(src) + ' <span class="small">change</span>' : '<span class="muted">Attach</span>') + '<input type="file" id="' + id + '" accept="' + accept + '" style="display:none"></label>';
      const left = [
        ['Bill Type', seg('inwBt', ['Invoice', 'Sample'], U.bt)],
        ['Vendor *', sel('inwVen', vendors, U.ven, vendors.length ? 'Select vendor…' : 'No open PO')],
        ['PO Number *', sel('inwPo', pos.map(p => p.no), U.po, U.ven ? (pos.length ? 'Select PO…' : 'No PO available') : '—', !U.ven)],
        [U.bt + ' No *', inp('bill_no')],
        [U.bt + ' Date *', inp('bill_date', 'date')],
        ['Inwarding Date', '<input value="' + fmtD(todayYmd()) + '" readonly>']
      ];
      const right = [['Invoice Qty *', inp('qty', 'number')]]
        .concat(qc ? [['QC No *', inp('qc_no')], ['QC Report *', file('inwQc', U.qcDoc, 'image/*,application/pdf')]] : [])
        .concat([['Invoice Photo *', file('inwPhoto', U.photo, 'image/*')], ['Remark', inp('remark')]]);
      h += '<div class="card"><div class="card-b"><div class="inwform">' + kvTable(left) + kvTable(right) + '</div></div>' +
        '<div class="card-f"><button class="btn primary" data-act="inw-save">Save</button><span id="niMsg" class="small"></span></div></div>';
    }
    const rows = Store.all('inwards').slice().sort((a, b) => (b.at || b.date || '') < (a.at || a.date || '') ? -1 : 1);
    h += '<h2>Previous gate entry logs</h2><div class="tbl-wrap"><table><tr><th>Timestamp</th><th>Bill Type</th><th>Vendor</th><th>PO Number</th><th>Invoice No</th><th>Invoice Date</th><th class="num">Aging (Days)</th><th class="num">Invoice Qty</th><th>Photo</th><th>Remark</th></tr>' +
      (rows.length ? rows.map(i => { const ts = i.at || i.date; return '<tr><td class="nowrap">' + fmtDT(ts) + '</td><td>' + esc(i.bill_type || 'Invoice') + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no || '') + '</td><td>' + esc(i.bill_no || '') + '</td><td class="nowrap">' + fmtD(i.bill_date) + '</td><td class="num">' + Math.max(0, Math.floor((Date.now() - new Date(ts)) / 86400000)) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + photoThumb(i.photo) + '</td><td class="small">' + esc(i.remark || '') + '</td></tr>'; }).join('')
        : '<tr><td colspan="10" class="empty">No gate entries</td></tr>') + '</table></div>';
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
  // QC lines for materials whose category needs a QC check; merchants come from the PO line brands (CDB)
  const qcl = [];
  p.lines.forEach(l => {
    const m = matBy(l.material); if (!m || !isQcCat(m.group)) return;
    let q = qcl.find(x => x.material === m.code);
    if (!q) { q = { material: m.code, category: m.group, brands: [], result: '', photo: '', m_status: '', m_photo: '', m_note: '' }; qcl.push(q); }
    String(l.brand || '').split(',').map(x => x.trim()).filter(Boolean).forEach(b => { if (!q.brands.includes(b)) q.brands.push(b); });
  });
  qcl.forEach(q => { q.merchants = Array.from(new Set(q.brands.map(brandMerchant).filter(Boolean))); });
  const i = Store.put('inwards', { id: uid(), no: nextNo('inwards', 'INW'), at: nowIso(), date: todayYmd(), bill_type: U.bt, vendor: U.ven, po_no: U.po, bill_no: billNo, bill_date: F.bill_date, qty: num(F.qty),
    qc_no: String(F.qc_no || '').trim(), qc_report: U.qcDoc || '', photo: U.photo, remark: String(F.remark || '').trim(), status: 'Pending GRN', qc: qcl, by: ME.name });
  audit('inward.create', i.no, U.bt + ' · ' + U.ven + ' · ' + U.po + ' · ' + billNo);
  Object.assign(U, { form: false, ven: '', po: '', f: {}, photo: '', qcDoc: '' });
  flash(esc(i.no) + ' saved' + (qcl.length ? ' — QC check pending for ' + qcl.length + ' item(s).' : '.')); VIEWS.inward.render();
};

/* ================= QC check (store) ================= */
const QC_UI = { ph: {} };
VIEWS.swatchmatch = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const pend = []; const done = [];
    Store.all('inwards').filter(i => i.status === 'Pending GRN').forEach(i => (i.qc || []).forEach(q => (q.result ? done : pend).push({ i, q })));
    Store.all('inwards').filter(i => i.status !== 'Pending GRN').forEach(i => (i.qc || []).forEach(q => { if (q.result) done.push({ i, q }); }));
    let h = '<div class="tbl-wrap"><table><tr><th>Inward</th><th>Timestamp</th><th>Vendor</th><th>PO</th><th>Item</th><th>Category</th><th>Brand</th><th>Material Photo</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (pend.length ? pend.map(({ i, q }) => { const k = i.id + '|' + q.material; const m = matBy(q.material) || {};
        return '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtDT(i.at || i.date) + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(m.name || q.material) + '</td><td>' + esc(q.category) + '</td><td>' + esc(q.brands.join(', ')) + '</td>' +
          '<td>' + (edit ? '<label class="icphoto">' + (QC_UI.ph[k] ? photoThumb(QC_UI.ph[k]) + ' <span class="small">change</span>' : '<span class="muted">Attach</span>') + '<input type="file" accept="image/*" data-qcf="' + esc(k) + '" style="display:none"></label>' : '') + '</td>' +
          (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="qc-set" data-k="' + esc(k) + '" data-r="Match">Match</button> <button class="btn sm danger" data-act="qc-set" data-k="' + esc(k) + '" data-r="Mismatch">Mismatch</button></td>' : '') + '</tr>'; }).join('')
        : '<tr><td colspan="9" class="empty">No items waiting for QC</td></tr>') + '</table></div>';
    done.sort((a, b) => (b.q.at || '') < (a.q.at || '') ? -1 : 1);
    h += '<h2>Recent QC results</h2><div class="tbl-wrap"><table><tr><th>Inward</th><th>Item</th><th>Result</th><th>Photo</th><th>Merchant</th><th>Merchant decision</th><th>Approval photo</th></tr>' +
      (done.length ? done.slice(0, 20).map(({ i, q }) => '<tr><td>' + esc(i.no) + '</td><td>' + esc((matBy(q.material) || {}).name || q.material) + '</td><td><span class="st ' + (q.result === 'Match' ? 'Done' : 'Late') + '">' + esc(q.result) + '</span></td><td>' + photoThumb(q.photo) + '</td><td>' + esc((q.merchants || []).join(', ')) + '</td><td>' + (q.result === 'Mismatch' ? '<span class="st ' + (q.m_status === 'Approved' ? 'Done' : q.m_status === 'Rejected' ? 'Cancelled' : 'Pending') + '">' + esc(q.m_status || 'Pending') + '</span>' + (q.m_note ? ' <span class="small muted">' + esc(q.m_note) + '</span>' : '') : '') + '</td><td>' + photoThumb(q.m_photo) + '</td></tr>').join('')
        : '<tr><td colspan="7" class="empty">No QC results yet</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => { const k = e.target.dataset.qcf; if (k) readImg(e.target.files[0], src => { QC_UI.ph[k] = src; VIEWS.swatchmatch.render(); }); });
  }
};
function qcFind(k) { const [id, code] = k.split('|'); const i = Store.get('inwards', id); return i ? { i, q: (i.qc || []).find(x => x.material === code) } : {}; }
ACTIONS['qc-set'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const { i, q } = qcFind(el.dataset.k); if (!q || q.result) return;
  if (el.dataset.r === 'Match' && !QC_UI.ph[el.dataset.k]) { flash('Attach the material photo to pass QC.', 'err'); return; }
  q.result = el.dataset.r; q.photo = QC_UI.ph[el.dataset.k] || ''; q.by = ME.name; q.at = nowIso();
  Store.put('inwards', i); delete QC_UI.ph[el.dataset.k];
  audit('inward.qc', i.no, q.material + ' · ' + q.result);
  flash(esc(q.material) + ': ' + (q.result === 'Match' ? 'QC passed.' : 'sent to ' + esc((q.merchants || []).join(', ') || 'merchant') + ' for approval.')); VIEWS.swatchmatch.render();
};

/* ================= Swatch approval (merchant): QC mismatches + JC swatches ================= */
const SW_UI = { ph: {} };
VIEWS.swatch = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const mine = [];
    Store.all('inwards').filter(i => i.status === 'Pending GRN').forEach(i => (i.qc || []).forEach(q => {
      if (q.result !== 'Mismatch' || q.m_status) return;
      const ms = q.merchants || [];
      if (isSuperAdmin() || ms.some(isMyMerchant) || (!ms.length && canApprove())) mine.push({ i, q });
    }));
    let h = '<h2 style="margin-top:0">Material QC mismatch</h2><div class="tbl-wrap"><table><tr><th>Inward</th><th>Vendor</th><th>PO</th><th>Item</th><th>Brand</th><th>Merchant</th><th>Approval card + sample photo</th><th>Note</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (mine.length ? mine.map(({ i, q }) => { const k = i.id + '|' + q.material;
        return '<tr><td><b>' + esc(i.no) + '</b></td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc((matBy(q.material) || {}).name || q.material) + '</td><td>' + esc(q.brands.join(', ')) + '</td><td>' + esc((q.merchants || []).join(', ')) + '</td>' +
          '<td>' + (edit ? '<label class="icphoto">' + (SW_UI.ph[k] ? photoThumb(SW_UI.ph[k]) + ' <span class="small">change</span>' : '<span class="muted">Attach</span>') + '<input type="file" accept="image/*" data-swf="' + esc(k) + '" style="display:none"></label>' : '') + '</td>' +
          '<td>' + (edit ? '<input data-swn="' + esc(k) + '">' : '') + '</td>' +
          (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="qcm-set" data-k="' + esc(k) + '" data-s="Approved">Approve</button> <button class="btn sm danger" data-act="qcm-set" data-k="' + esc(k) + '" data-s="Rejected">Reject</button></td>' : '') + '</tr>'; }).join('')
        : '<tr><td colspan="9" class="empty">Nothing waiting for you</td></tr>') + '</table></div>';
    const rows = Store.all('job_cards').filter(j => j.swatch_status === 'Pending' || j.swatch_status === 'Rejected');
    h += '<h2>Job card swatch</h2><div class="tbl-wrap"><table><tr><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th class="num">Qty</th><th>Status</th><th>Note</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(j => '<tr><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + '</td><td>' + esc(j.colour) + '</td><td class="num">' + qtyFmt(j.qty) + '</td><td><span class="st ' + (j.swatch_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(j.swatch_status) + '</span></td>' +
        '<td>' + (edit ? '<input data-sw-note value="' + esc(j.swatch_note || '') + '">' : esc(j.swatch_note || '')) + '</td>' +
        (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="sw-set" data-id="' + esc(j.id) + '" data-s="Approved">Approve</button> <button class="btn sm danger" data-act="sw-set" data-id="' + esc(j.id) + '" data-s="Rejected">Reject</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="8" class="empty">No swatches pending</td></tr>') + '</table></div>';
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
ACTIONS['sw-set'] = el => {
  const j = Store.get('job_cards', el.dataset.id); const tr = el.closest('tr');
  j.swatch_status = el.dataset.s; j.swatch_note = $('[data-sw-note]', tr).value.trim(); j.swatch_by = ME.name;
  Store.put('job_cards', j); audit('jc.swatch', j.no, el.dataset.s + (j.swatch_note ? ' — ' + j.swatch_note : '')); flash(esc(j.no) + ' swatch ' + el.dataset.s.toLowerCase() + '.'); VIEWS.swatch.render();
};

/* ================= GRN (one per gate entry) ================= */
const GRN_UI = { open: null };
function inwardQcState(i) {
  const qs = i.qc || [];
  if (qs.some(q => !q.result)) return { ok: false, label: 'QC pending' };
  if (qs.some(q => q.result === 'Mismatch' && !q.m_status)) return { ok: false, label: 'Merchant approval pending' };
  return { ok: true, label: qs.length ? 'QC done' : 'No QC needed' };
}
function qcBlocked(i, code) { const q = (i.qc || []).find(x => norm(x.material) === norm(code)); return q && q.result === 'Mismatch' && q.m_status === 'Rejected'; }
VIEWS.grn = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const ins = Store.all('inwards').filter(i => i.status === 'Pending GRN').sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
    let h = '<div class="tbl-wrap"><table><tr><th>Inward</th><th>Timestamp</th><th>Vendor</th><th>PO</th><th>Invoice No</th><th class="num">Invoice Qty</th><th>QC</th><th></th></tr>' +
      (ins.length ? ins.map(i => {
        const st = inwardQcState(i); const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(i.po_no));
        let row = '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtDT(i.at || i.date) + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no) + '</td><td>' + esc(i.bill_no) + '</td><td class="num">' + qtyFmt(i.qty) + '</td>' +
          '<td><span class="st ' + (st.ok ? 'Done' : 'Pending') + '">' + st.label + '</span></td><td class="right">' + (edit && p ? '<button class="btn sm ' + (GRN_UI.open === i.id ? '' : 'primary') + '" data-act="grn-open" data-id="' + esc(i.id) + '"' + (st.ok ? '' : ' disabled') + '>' + (GRN_UI.open === i.id ? 'Close' : 'Make GRN') + '</button>' : '') + '</td></tr>';
        if (GRN_UI.open === i.id && p) row += '<tr class="inline-form"><td colspan="8"><table style="max-width:960px;margin:6px 0"><tr><th>Item</th><th>Brand</th><th class="num">PO Pending</th><th class="num">Inv Qty</th><th class="num">GRN Qty</th><th class="num">Reject</th><th class="num">Short</th><th class="num">Excess</th><th>Rack</th></tr>' +
          p.lines.map((l, k) => {
            const pen = Math.max(0, num(l.qty) - num(l.received)); const mt = matBy(l.material) || {}; const blocked = qcBlocked(i, l.material); const on = pen > 0 && !blocked;
            return '<tr data-i="' + k + '" data-pen="' + pen + '"' + (blocked ? ' class="muted"' : '') + '><td>' + esc(mt.name || l.material) + (blocked ? ' <span class="st Cancelled">Rejected by merchant</span>' : '') + '</td><td class="small">' + esc(l.brand || '') + '</td><td class="num">' + qtyFmt(pen) + '</td>' +
              '<td><input class="qty" type="number" min="0" step="any" data-gi value="' + (on ? pen : '') + '"' + (on ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-ga value="' + (on ? pen : '') + '"' + (on ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-gr value="0"' + (on ? '' : ' disabled') + '></td>' +
              '<td class="num muted" data-gs>—</td><td class="num muted" data-gx>—</td><td><input data-grack value="' + esc(mt.rack || '') + '" style="width:60px"' + (on ? '' : ' disabled') + '></td></tr>';
          }).join('') +
          '</table><div class="row"><label>GRN Date<input id="grnDate" type="date" value="' + todayYmd() + '"></label><button class="btn primary" data-act="grn-save" data-id="' + esc(i.id) + '">Save GRN</button><span id="grnMsg" class="small"></span></div><div class="row" id="grnWhyBox" style="display:none;margin-top:4px"><label style="flex:1">Reject reason *<input id="grnWhy"></label></div></td></tr>';
        return row;
      }).join('') : '<tr><td colspan="8" class="empty">No gate entries waiting for GRN</td></tr>') + '</table></div>';
    const gs = Store.all('grns').slice().sort((a, b) => b.no < a.no ? -1 : 1).slice(0, 15);
    h += '<h2>Recent GRNs</h2><div class="tbl-wrap"><table><tr><th>GRN No</th><th>GRN Date</th><th>Inward</th><th>PO No</th><th>Vendor</th><th>Invoice No</th><th class="num">Sr</th><th>Item Name</th><th>Item Code</th><th>Brand</th><th class="num">Inv Qty</th><th class="num">Accepted</th><th class="num">Rejected</th><th class="num">Short</th><th class="num">Excess</th><th>Rack</th><th>By</th><th></th></tr>' +
      (gs.length ? gs.map(g => g.lines.map((l, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><b>' + esc(g.no) + '</b></td><td>' + fmtD(g.date) + '</td><td>' + esc(g.inward_no || '') + '</td><td>' + esc(g.po_no) + '</td><td>' + esc(g.vendor) + '</td><td>' + esc(g.invoice || '') + '</td><td class="num">' + (i + 1) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(l.brand || '') + '</td><td class="num">' + qtyFmt(l.inv_qty || 0) + '</td><td class="num">' + qtyFmt(l.accepted || 0) + '</td><td class="num">' + qtyFmt(l.rejected || 0) + '</td><td class="num">' + qtyFmt(l.short || 0) + '</td><td class="num">' + qtyFmt(l.excess || 0) + '</td><td>' + esc(l.rack || '') + '</td><td>' + esc(g.by) + '</td><td class="right">' + (i === 0 ? '<button class="btn sm ghost" data-act="print-grn" data-id="' + esc(g.id) + '">Print</button>' : '') + '</td></tr>').join('')).join('') : '<tr><td colspan="18" class="empty">No GRNs yet</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['grn-open'] = el => { GRN_UI.open = GRN_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.grn.render(); };
function grnCalcRow(tr) {
  const inv = num($('[data-gi]', tr).value), acc = num($('[data-ga]', tr).value), rej = num($('[data-gr]', tr).value), pen = num(tr.dataset.pen);
  const excess = Math.max(0, inv - pen);                       // billed beyond PO balance
  const short = Math.max(0, inv - acc - rej);                  // billed but not physically received
  $('[data-gx]', tr).textContent = excess ? qtyFmt(excess) : '—';
  $('[data-gs]', tr).textContent = short ? qtyFmt(short) : '—';
  return { inv, acc, rej, excess, short };
}
document.addEventListener('input', e => { const tr = e.target.closest && e.target.closest('tr[data-pen]'); if (tr && (e.target.dataset.gi != null || e.target.dataset.ga != null || e.target.dataset.gr != null)) { grnCalcRow(tr); const anyRej = $$('tr[data-pen]').some(t => num(($('[data-gr]', t) || {}).value) > 0); const box = $('#grnWhyBox'); if (box) box.style.display = anyRej ? '' : 'none'; } });
ACTIONS['grn-save'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const iw = Store.get('inwards', el.dataset.id); if (!iw || iw.status !== 'Pending GRN') return;
  if (!inwardQcState(iw).ok) { flash('QC is not complete for ' + esc(iw.no) + '.', 'err'); return; }
  const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(iw.po_no)); if (!p) return;
  const rows = $$('tr[data-pen]').filter(tr => !$('[data-gi]', tr).disabled).map(tr => Object.assign({ i: +tr.dataset.i, tr, material: p.lines[+tr.dataset.i].material }, grnCalcRow(tr))).filter(r => r.inv > 0 || r.acc > 0 || r.rej > 0);
  if (!rows.length) { $('#grnMsg').innerHTML = '<span class="late-txt">Enter invoice qty or accept/reject qty.</span>'; return; }
  for (const r of rows) {
    const pen = Math.max(0, num(p.lines[r.i].qty) - num(p.lines[r.i].received));
    if (qcBlocked(iw, r.material)) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(r.material) + ' was rejected by the merchant.</span>'; return; }
    if (r.acc + r.rej > r.inv + 1e-9) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(r.material) + ': accept + reject exceeds invoice qty.</span>'; return; }
    if (r.acc + r.rej > pen + r.excess + 1e-9) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(r.material) + ': qty exceeds PO pending + excess.</span>'; return; }
  }
  const why = ($('#grnWhy') || { value: '' }).value.trim();
  if (rows.some(r => r.rej > 0) && !why) { $('#grnMsg').innerHTML = '<span class="late-txt">Reject reason is required.</span>'; return; }
  const inv = iw.bill_no;
  if (Store.all('grns').some(g => norm(g.vendor) === norm(p.vendor) && norm(g.invoice) === norm(inv))) { $('#grnMsg').innerHTML = '<span class="late-txt">This vendor invoice already has a GRN.</span>'; return; }
  rows.forEach(r => { const pl = p.lines[r.i]; pl.received = num(pl.received) + r.acc + r.rej; pl.rejected = num(pl.rejected) + r.rej; });
  Store.put('purchase_orders', p);
  const lines = rows.map(r => ({ material: r.material, jc_no: p.lines[r.i].jc_no || '', brand: p.lines[r.i].brand || '', inv_qty: r.inv, accepted: r.acc, rejected: r.rej, short: r.short, excess: r.excess, rack: ($('[data-grack]', r.tr) || { value: '' }).value.trim() }));
  const g = Store.put('grns', { id: uid(), no: fyNo('grns', 'GRN', 4), date: $('#grnDate').value || todayYmd(), inward_id: iw.id, inward_no: iw.no, po_id: p.id, po_no: p.no, vendor: p.vendor, invoice: inv, reject_reason: why, lines, by: ME.name });
  iw.status = 'GRN Done'; iw.grn_no = g.no; Store.put('inwards', iw);
  const totRej = rows.reduce((x, r) => x + r.rej, 0), totShort = rows.reduce((x, r) => x + r.short, 0), totExcess = rows.reduce((x, r) => x + r.excess, 0);
  if (totRej > 0 || totShort > 0) {
    autoTask('Debit Note — ' + inv + ' (' + p.vendor + '): reject ' + qtyFmt(totRej) + ', short ' + qtyFmt(totShort), 'ACCOUNTS', 0);
    if (totRej > 0) autoTask('RTV — ' + p.vendor + ' inv ' + inv + ': ' + rows.filter(r => r.rej).map(r => r.material + ' × ' + qtyFmt(r.rej)).join(', '), 'STORE', 1);
  }
  autoTask('Tally Entry — GRN ' + g.no + ' (' + p.vendor + ', inv ' + inv + ')', 'ACCOUNTS', 1);
  audit('grn.create', g.no, iw.no + ' · ' + p.no + ' · inv ' + inv + ' · acc ' + qtyFmt(rows.reduce((x, r) => x + r.acc, 0)) + (totRej ? ' / rej ' + qtyFmt(totRej) : '') + (totShort ? ' / short ' + qtyFmt(totShort) : '') + (totExcess ? ' / excess ' + qtyFmt(totExcess) : ''));
  GRN_UI.open = null;
  flash(esc(g.no) + ' saved — stock updated.' + (poPending(p) <= 0 ? ' ' + esc(p.no) + ' fully received.' : ''));
  VIEWS.grn.render();
};
