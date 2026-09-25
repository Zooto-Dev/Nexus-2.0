/* Nexus 2.0 — department modules: Purchase, Merchant, Store, Development, Production, Accounts, Tickets, Checklist. */
'use strict';

/* ---------- shared helpers ---------- */
function matBy(code) { return Store.all('materials').find(m => norm(m.code) === norm(code) || norm(m.name) === norm(code)); }
function dlMat(id) { return '<datalist id="' + id + '">' + Store.all('materials').map(m => '<option value="' + esc(m.code) + '">' + esc(m.name + ' · ' + m.uom) + '</option>').join('') + '</datalist>'; }
function vendorNames() { return Store.all('vendors').map(v => v.name).sort(); }
function vendorBy(name) { return Store.all('vendors').find(v => norm(v.name) === norm(name)); }
function lowStockList() { const { stk } = stockMaps(); return Store.all('materials').filter(m => num(m.min_level) > 0 && (stk[norm(m.code)] || 0) < num(m.min_level)); }
function dlVendor() { return '<datalist id="dlVen">' + vendorNames().map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>'; }
function stockMaps() {
  const stk = {}, rej = {};
  const add = (m, k, q) => { const key = norm(k); m[key] = (m[key] || 0) + q; };
  Store.all('grns').forEach(g => (g.lines || []).forEach(l => { add(stk, l.material, num(l.accepted)); add(rej, l.material, num(l.rejected)); }));
  // sirf APPROVED issues stock kaatti hain (pending request se stock nahi hilta); return wapas jodta hai
  Store.all('issues').forEach(i => { if (i.status === 'Pending' || i.status === 'Rejected') return; add(stk, i.material, i.type === 'return' ? num(i.qty) : -num(i.qty)); });
  Store.all('rtvs').forEach(r => add(rej, r.material, -num(r.qty)));
  return { stk, rej };
}
function stockOf(code) { return stockMaps().stk[norm(code)] || 0; }
// Reserved stock per JC (purane RSJW jaisa): reserved physical stock ka hissa hai.
function reservedOf(code, jc) { return Store.all('rsjw').filter(r => norm(r.material) === norm(code) && (!jc || norm(r.jc_no) === norm(jc))).reduce((s2, r) => s2 + num(r.qty), 0); }
function openStockOf(code) { return Math.max(0, stockOf(code) - reservedOf(code)); }
// Transit = approved POs mein order hua par aaya nahi
function transitOf(code) { return openPOs().reduce((s2, p) => s2 + p.lines.filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + Math.max(0, num(l.qty) - num(l.received)), 0), 0); }
function jcBy(no) { return Store.all('job_cards').find(j => norm(j.no) === norm(no)); }
function issuedToJc(jc, code) { return Store.all('issues').filter(i => i.status === 'Approved' && norm(i.to_jc) === norm(jc) && norm(i.material) === norm(code)).reduce((s2, i) => s2 + (i.type === 'return' ? -num(i.qty) : num(i.qty)), 0); }
function poPending(po) { return (po.lines || []).reduce((s, l) => s + Math.max(0, num(l.qty) - num(l.received)), 0); }
function poStatus(po) {
  if (po.cancelled) return 'Cancelled';
  if (po.approval === 'Rejected') return 'Rejected';
  if (po.approval !== 'Approved') return 'Pending Approval';
  const p = poPending(po); const got = (po.lines || []).some(l => num(l.received) > 0);
  return p <= 0 ? 'Received' : got ? 'Partial' : 'Open';
}
function poStCls(st) { return st === 'Received' ? 'Done' : st === 'Partial' ? 'Pending' : st === 'Cancelled' || st === 'Rejected' ? 'Cancelled' : st === 'Pending Approval' ? 'Late' : 'Waiting'; }
// GRN, followup, inwarding sirf APPROVED POs par chalte hain.
function openPOs() { return Store.all('purchase_orders').filter(p => !p.cancelled && p.approval === 'Approved' && poPending(p) > 0); }
function autoTask(title, doer, dueDays) {
  const due = new Date(Date.now() + (dueDays || 0) * 86400000); if (due.getDay() === 0) due.setDate(due.getDate() + 1); // Sunday -> Monday
  Store.put('checklist', { id: uid(), title, doer, freq: 'Once', due: ymdOf(due), done: {}, active: true, by: 'auto', auto: true });
}
function newBtn(label, act) { return '<button class="btn primary" data-act="' + act + '">+ ' + label + '</button>'; }
function subTitle(t, extra) { return '<h1>' + t + (extra ? ' <span class="muted small">' + extra + '</span>' : '') + '</h1>'; }

/* ================= PURCHASE ================= */
VIEWS.purchasedash = {
  mod: 'purchase', render() {
    const pos = Store.all('purchase_orders').filter(p => !p.cancelled);
    const open = pos.filter(p => poPending(p) > 0);
    const overdue = open.filter(p => p.expected && p.expected < todayYmd());
    const fuDue = open.filter(p => { const f = (p.followups || [])[p.followups ? p.followups.length - 1 : -1]; return !f || !f.next || f.next <= todayYmd(); });
    const month = todayYmd().slice(0, 7);
    const grnMonth = Store.all('grns').filter(g => (g.date || '').startsWith(month)).reduce((s, g) => s + g.lines.reduce((a, l) => a + num(l.accepted), 0), 0);
    const apprPend = Store.all('purchase_orders').filter(p => !p.cancelled && (!p.approval || p.approval === 'Pending'));
    const low = lowStockList();
    let h = subTitle('Purchase Dashboard');
    h += '<div class="kpis">' +
      '<a href="#/po/approvals"><b class="' + (apprPend.length ? 'late-txt' : '') + '">' + apprPend.length + '</b><span>PO approval pending</span></a>' +
      '<a href="#/stock"><b class="' + (low.length ? 'late-txt' : '') + '">' + low.length + '</b><span>Low stock items</span></a>' +
      '<a href="#/po"><b>' + open.length + '</b><span>Open POs</span></a>' +
      '<a href="#/po"><b class="' + (overdue.length ? 'late-txt' : '') + '">' + overdue.length + '</b><span>Overdue POs</span></a>' +
      '<div><b>' + qtyFmt(open.reduce((s, p) => s + poPending(p), 0)) + '</b><span>Qty pending</span></div>' +
      '<a href="#/followup"><b>' + fuDue.length + '</b><span>Followups due</span></a>' +
      '<div><b>' + qtyFmt(grnMonth) + '</b><span>Qty received this month</span></div></div>';
    h += '<h2>Open purchase orders</h2><div class="tbl-wrap"><table><tr><th>PO</th><th>Date</th><th>Vendor</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Pending</th><th>Expected</th><th>Status</th></tr>' +
      (open.length ? open.map(p => { const oq = p.lines.reduce((s, l) => s + num(l.qty), 0), rq = p.lines.reduce((s, l) => s + num(l.received), 0); return '<tr class="click" data-act="go" data-v="po" data-p="' + esc(p.id) + '"><td><b>' + esc(p.no) + '</b></td><td>' + fmtD(p.date) + '</td><td>' + esc(p.vendor) + '</td><td class="num">' + qtyFmt(oq) + '</td><td class="num">' + qtyFmt(rq) + '</td><td class="num">' + qtyFmt(oq - rq) + '</td><td class="nowrap ' + (p.expected && p.expected < todayYmd() ? 'late-txt' : '') + '">' + fmtD(p.expected) + '</td><td>' + stHtml(poStatus(p)).replace('Partial', 'Partial').replace('st Partial', 'st Pending').replace('st Open', 'st Waiting').replace('st Received', 'st Done') + '</td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">No open POs</td></tr>') + '</table></div>';
    setMain(h);
  }
};

const PO_UI = { f: 'open', form: false, open: null };
VIEWS.po = {
  mod: 'purchase', render(param) {
    if (param === 'approvals') { PO_UI.f = 'appr'; }
    else if (param) { const p = Store.get('purchase_orders', param); if (p) { PO_UI.f = 'all'; PO_UI.q = p.no; } }
    const edit = can('purchase', 'edit');
    const rows = Store.all('purchase_orders').slice().sort((a, b) => b.at < a.at ? -1 : 1).filter(p => {
      if (PO_UI.q && !norm(p.no + ' ' + p.vendor + ' ' + p.lines.map(l => l.material).join(' ')).includes(norm(PO_UI.q))) return false;
      const st = poStatus(p);
      switch (PO_UI.f) {
        case 'appr': return st === 'Pending Approval';
        case 'open': return st === 'Open' || st === 'Partial';
        case 'done': return st === 'Received';
        case 'cancel': return st === 'Cancelled' || st === 'Rejected';
        default: return true;
      }
    });
    let h = subTitle('Purchase Orders', 'approve hone ke baad hi GRN/followup mein aata hai') + '<div class="toolbar">' + seg('f', [{ v: 'appr', l: 'For approval' }, { v: 'open', l: 'Open' }, { v: 'done', l: 'Received' }, { v: 'cancel', l: 'Rejected/Cancelled' }, { v: 'all', l: 'All' }], PO_UI.f) +
      '<input id="poQ" placeholder="PO / vendor / material…" value="' + esc(PO_UI.q || '') + '"><span class="grow"></span>' + (edit ? newBtn('New PO', 'po-new') : '') + '</div>';
    if (PO_UI.form && edit) h += poForm();
    h += '<div class="tbl-wrap"><table><tr><th>PO</th><th>Date</th><th>Vendor</th><th>Materials</th><th class="num">Qty</th><th class="num">Received</th><th>Expected</th><th>Status</th><th></th></tr>' +
      (rows.length ? rows.map(p => {
        const oq = p.lines.reduce((s, l) => s + num(l.qty), 0), rq = p.lines.reduce((s, l) => s + num(l.received), 0); const st = poStatus(p);
        let row = '<tr class="click" data-act="po-toggle" data-id="' + esc(p.id) + '"><td><b>' + esc(p.no) + '</b><div class="muted small">' + esc(p.created_by || '') + '</div></td><td class="nowrap">' + fmtD(p.date) + '</td><td>' + esc(p.vendor) + '</td><td class="small">' + p.lines.map(l => esc(l.material) + ' × ' + qtyFmt(l.qty)).join('<br>') + '</td><td class="num">' + qtyFmt(oq) + '</td><td class="num">' + qtyFmt(rq) + '</td><td class="nowrap">' + fmtD(p.expected) + '</td><td><span class="st ' + poStCls(st) + '">' + st + '</span>' + (p.approved_by ? '<div class="muted small">' + esc(p.approved_by) + '</div>' : '') + '</td>' +
          '<td class="right nowrap">' + (st === 'Pending Approval' && canApprove() ? '<button class="btn sm primary" data-act="po-approve" data-id="' + esc(p.id) + '">Approve</button> <button class="btn sm danger" data-act="po-reject" data-id="' + esc(p.id) + '" data-confirm="Reject PO?">Reject</button>' : '') +
          (edit && (st === 'Open' || st === 'Pending Approval') ? ' <button class="btn ghost sm danger" data-act="po-cancel" data-id="' + esc(p.id) + '" data-confirm="Cancel PO?">Cancel</button>' : '') + '</td></tr>';
        if (PO_UI.open === p.id) row += '<tr class="inline-form"><td colspan="9">' + poDetail(p) + '</td></tr>';
        return row;
      }).join('') : '<tr><td colspan="9" class="empty">No purchase orders</td></tr>') + '</table></div>';
    if (!canApprove()) h += '<div class="muted small" style="margin-top:8px">PO approve/reject sirf Admin ya Manager kar sakta hai.</div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'poMode') { PO_UI.mode = e.detail; poFormSetup(); const v = vendorBy($('#npVen').value); if (v && e.detail === 'jc') poFillJc(v.name); return; } PO_UI.f = e.detail; VIEWS.po.render(); });
    $('#poQ').addEventListener('input', e => { PO_UI.q = e.target.value; clearTimeout(PO_UI.t); PO_UI.t = setTimeout(() => { VIEWS.po.render(); const i = $('#poQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};
function poDetail(p) {
  const v = vendorBy(p.vendor) || {}; const total = p.lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  return '<div class="po-doc" style="padding:8px 4px"><div class="row" style="justify-content:space-between"><div><b>' + esc(settings().company || '') + '</b><div class="muted small">' + esc(settings().address || '') + (settings().gstin ? ' · GSTIN ' + esc(settings().gstin) : '') + '</div></div>' +
    '<div class="right"><b>' + esc(p.no) + '</b><div class="muted small">' + fmtD(p.date) + ' · Expected ' + fmtD(p.expected) + '</div></div></div>' +
    '<div class="small" style="margin:6px 0"><b>Vendor:</b> ' + esc(p.vendor) + (v.address ? ' · ' + esc(v.address) : '') + (v.gstin ? ' · GSTIN ' + esc(v.gstin) : '') + (v.mobile ? ' · ' + esc(v.mobile) : '') + '</div>' +
    '<table style="max-width:640px"><tr><th>Material</th><th>UOM</th><th class="num">Qty</th><th class="num">Rate ₹</th><th class="num">Amount ₹</th></tr>' +
    p.lines.map(l => '<tr><td>' + esc(l.material) + (l.jc_no ? ' <span class="muted small">' + esc(l.jc_no) + '</span>' : '') + '</td><td>' + esc(l.uom) + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + money(l.rate) + '</td><td class="num">' + money(num(l.qty) * num(l.rate)) + '</td></tr>').join('') +
    '<tr><td colspan="4" class="right"><b>Total</b></td><td class="num"><b>' + money(total) + '</b></td></tr></table>' +
    (p.remarks ? '<div class="small" style="margin-top:4px"><b>Remarks:</b> ' + esc(p.remarks) + '</div>' : '') +
    '<div class="toolbar noprint" style="margin-top:8px"><button class="btn sm" data-act="po-print">Print</button></div></div>';
}
ACTIONS['po-toggle'] = (el, ev) => { if (ev.target.closest('button')) return; PO_UI.open = PO_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.po.render(); };
ACTIONS['po-print'] = el => { document.body.classList.add('print-po'); window.print(); setTimeout(() => document.body.classList.remove('print-po'), 500); };
ACTIONS['po-approve'] = el => {
  if (!canApprove()) { flash('PO approve sirf Admin/Manager kar sakta hai.', 'err'); return; }
  const p = Store.get('purchase_orders', el.dataset.id);
  if (p.approval === 'Approved') { flash('Ye PO pehle se approved hai.', 'err'); return; }
  p.approval = 'Approved'; p.approved_by = ME.name; p.approved_at = nowIso(); Store.put('purchase_orders', p);
  // JC lines ka "PO Raised" update (purane IMS ka approve step)
  p.lines.forEach(l => { if (!l.jc_no) return; const j = jcBy(l.jc_no); if (!j) return; const jl = (j.lines || []).find(x => norm(x.material) === norm(l.material)); if (jl) { jl.po_raised = num(jl.po_raised) + num(l.qty); Store.put('job_cards', j); } });
  audit('po.approve', p.no, p.vendor); flash(esc(p.no) + ' approved — ab GRN/followup mein aayega.'); VIEWS.po.render();
};
ACTIONS['po-reject'] = el => {
  if (!canApprove()) { flash('PO reject sirf Admin/Manager kar sakta hai.', 'err'); return; }
  const p = Store.get('purchase_orders', el.dataset.id); p.approval = 'Rejected'; p.approved_by = ME.name; Store.put('purchase_orders', p);
  audit('po.reject', p.no, p.vendor); flash(esc(p.no) + ' rejected.'); VIEWS.po.render();
};
function poForm() {
  return '<div class="panel" style="margin-bottom:12px">' + dlVendor() + dlMat('dlMatPo') +
    '<div class="row"><label>Mode' + seg('poMode', [{ v: 'jc', l: 'JC requirement se' }, { v: 'manual', l: 'Manual' }], PO_UI.mode || 'jc') + '</label>' +
    '<label>Vendor *<input id="npVen" list="dlVen"></label><label>PO date<input id="npDate" type="date" value="' + todayYmd() + '"></label><label>Expected delivery *<input id="npExp" type="date"></label><label style="flex:1">Remarks<input id="npRem"></label></div>' +
    '<div id="npHint" class="muted small" style="margin:6px 0"></div>' +
    '<table style="margin-top:4px"><tr id="npHead"></tr><tbody id="npLines"></tbody></table><a class="small" data-act="po-line" id="npAdd">+ material</a>' +
    '<div class="toolbar" style="margin-top:10px"><button class="btn primary" data-act="po-save">Save PO</button><button class="btn" data-act="po-new">Close</button><span id="npMsg" class="small"></span></div></div>';
}
function poFormSetup() {
  const mode = PO_UI.mode || 'jc';
  $('#npHead').innerHTML = mode === 'manual'
    ? '<th style="width:200px">Material</th><th style="width:70px">UOM</th><th class="num" style="width:110px">Qty</th><th class="num" style="width:110px">Rate ₹</th><th style="width:30px"></th>'
    : '<th style="width:110px">JC</th><th style="width:180px">Material</th><th class="num">JC pending</th><th class="num">Stock free</th><th class="num">Transit</th><th class="num" style="width:110px">Order qty</th><th class="num" style="width:100px">Rate ₹</th>';
  $('#npAdd').classList.toggle('hidden', mode !== 'manual');
  $('#npLines').innerHTML = mode === 'manual' ? poLineRow() : '';
  $('#npHint').textContent = mode === 'manual' ? '' : 'Vendor chuno — us supplier ke saare open JC materials jinka PO banna baaki hai, apne aap aa jayenge (purana "vendor pending list" logic).';
}
// vendor ke pending JC lines: pending = required − po_raised; prefill net = max(0, pending − stockFree − transit) per material FIFO
function poJcRows(vendor) {
  const rows = [];
  Store.all('job_cards').filter(j => j.status !== 'Closed').forEach(j => (j.lines || []).forEach((l, li) => {
    if (norm(l.supplier) !== norm(vendor)) return;
    const pen = Math.max(0, num(l.required) - num(l.po_raised));
    if (pen > 0.0001) rows.push({ jc: j.no, jid: j.id, li, material: l.material, uom: l.uom, pending: pen });
  }));
  const free = {}, tran = {};
  rows.forEach(r => { const k = norm(r.material); if (free[k] == null) { free[k] = openStockOf(r.material); tran[k] = transitOf(r.material); } });
  rows.forEach(r => { const k = norm(r.material); const cover = Math.min(r.pending, Math.max(0, free[k]) + Math.max(0, tran[k])); const use = Math.min(cover, free[k] + tran[k]); r.stockFree = free[k]; r.transit = tran[k]; r.net = Math.max(0, r.pending - use); const t = Math.min(r.pending, free[k]); free[k] -= t; tran[k] = Math.max(0, tran[k] - Math.max(0, Math.min(r.pending - t, tran[k]))); });
  return rows;
}
function poFillJc(vendor) {
  const rows = poJcRows(vendor);
  const src = Store.all('sourcing');
  $('#npLines').innerHTML = rows.length ? rows.map((r, i) => {
    const rate = (src.find(x => norm(x.material) === norm(r.material) && norm(x.vendor) === norm(vendor)) || {}).rate || '';
    return '<tr data-jrow data-jc="' + esc(r.jc) + '" data-mat="' + esc(r.material) + '" data-max="' + r.pending + '"><td>' + esc(r.jc) + '</td><td>' + esc(r.material) + ' <span class="muted small">' + esc(r.uom) + '</span></td><td class="num">' + qtyFmt(r.pending) + '</td><td class="num muted">' + qtyFmt(r.stockFree) + '</td><td class="num muted">' + qtyFmt(r.transit) + '</td><td><input class="qty" type="number" min="0" max="' + r.pending + '" step="any" data-jqty value="' + r.net + '"></td><td><input class="qty" type="number" min="0" step="any" data-jrate value="' + rate + '"></td></tr>';
  }).join('') : '<tr><td colspan="7" class="empty">Is vendor ka koi pending JC requirement nahi — Manual mode use karo.</td></tr>';
  $('#npHint').innerHTML = rows.length ? 'Order qty pehle se <b>net-to-order</b> hai (pending − free stock − transit). JC pending se zyada nahi ja sakti. Rate sourcing se aaya hai.' : '';
}
function poLineRow() { return '<tr><td><input data-np="mat" list="dlMatPo"></td><td class="muted" data-uom></td><td><input data-np="qty" type="number" min="0" step="any" class="right"></td><td><input data-np="rate" type="number" min="0" step="any" class="right"></td><td><button class="btn ghost sm" data-act="po-line-del">×</button></td></tr>'; }
ACTIONS['po-new'] = () => { PO_UI.form = !PO_UI.form; VIEWS.po.render(); if (PO_UI.form) { poFormSetup(); $('#npVen').focus(); } };
document.addEventListener('change', e => { if (e.target.id === 'npVen' && (PO_UI.mode || 'jc') === 'jc') { const v = vendorBy(e.target.value); if (v) poFillJc(v.name); } });
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.jqty != null) { const tr = e.target.closest('tr'); if (num(e.target.value) > num(tr.dataset.max)) { e.target.value = tr.dataset.max; flash('JC pending se zyada order nahi ho sakta.', 'err'); } } });
ACTIONS['po-line'] = () => { $('#npLines').insertAdjacentHTML('beforeend', poLineRow()); };
ACTIONS['po-line-del'] = el => el.closest('tr').remove();
document.addEventListener('change', e => { if (e.target.dataset.np === 'mat') { const m = matBy(e.target.value); if (m) { e.target.value = m.code; $('[data-uom]', e.target.closest('tr')).textContent = m.uom; } } });
ACTIONS['po-save'] = () => {
  if (!requirePerm('purchase', 'edit')) return;
  const ven = $('#npVen').value.trim(); const exp = $('#npExp').value;
  const mode = PO_UI.mode || 'jc';
  const lines = mode === 'manual'
    ? $$('#npLines tr').map(tr => { const m = matBy($('[data-np="mat"]', tr).value); return { material: m ? m.code : ($('[data-np="mat"]', tr) ? $('[data-np="mat"]', tr).value.trim().toUpperCase() : ''), uom: m ? m.uom : '', qty: num(($('[data-np="qty"]', tr) || {}).value), rate: num(($('[data-np="rate"]', tr) || {}).value), received: 0, rejected: 0 }; }).filter(l => l.material && l.qty > 0)
    : $$('#npLines tr[data-jrow]').map(tr => { const m = matBy(tr.dataset.mat); return { material: tr.dataset.mat, uom: m ? m.uom : '', qty: num($('[data-jqty]', tr).value), rate: num($('[data-jrate]', tr).value), jc_no: tr.dataset.jc, received: 0, rejected: 0 }; }).filter(l => l.qty > 0);
  if (!ven || !exp || !lines.length) { $('#npMsg').innerHTML = '<span class="late-txt">Vendor, expected date aur kam se kam ek material line chahiye.</span>'; return; }
  const vm = vendorBy(ven);
  if (!vm) { $('#npMsg').innerHTML = '<span class="late-txt">Vendor master mein nahi hai — pehle Purchase → Vendors mein add karo (GST/mobile ke saath).</span>'; return; }
  if (!vm.mobile && !vm.email) { $('#npMsg').innerHTML = '<span class="late-txt">Vendor ka mobile ya email vendor master mein bharo, tabhi PO banega.</span>'; return; }
  const bad = lines.find(l => !matBy(l.material)); if (bad) { $('#npMsg').innerHTML = '<span class="late-txt">Material "' + esc(bad.material) + '" master mein nahi hai — pehle Store → Materials mein add karo.</span>'; return; }
  // double-submit guard: same vendor + same lines within 60s (old IMS ka 45s MD5 guard)
  const sig = norm(ven) + '|' + lines.map(l => l.material + ':' + l.qty).sort().join(',');
  const dup = Store.all('purchase_orders').find(p => p._sig === sig && (Date.now() - new Date(p.at)) < 60000);
  if (dup) { $('#npMsg').innerHTML = '<span class="late-txt">Bilkul same PO abhi ' + esc(dup.no) + ' ban chuka hai (double-submit guard).</span>'; return; }
  const po = Store.put('purchase_orders', { id: uid(), no: fyNo('purchase_orders', 'PO', 3), date: $('#npDate').value || todayYmd(), vendor: vm.name, expected: exp, remarks: $('#npRem').value.trim(), lines, followups: [], approval: 'Pending', created_by: ME.name, at: nowIso(), _sig: sig });
  audit('po.create', po.no, ven + ' · ' + qtyFmt(lines.reduce((s, l) => s + l.qty, 0)) + ' qty');
  PO_UI.form = false; flash(esc(po.no) + ' saved — <b>approval pending</b>. Admin/Manager approve karega tabhi vendor ke against chalega.'); VIEWS.po.render();
};
ACTIONS['po-cancel'] = el => { const p = Store.get('purchase_orders', el.dataset.id); p.cancelled = true; Store.put('purchase_orders', p); audit('po.cancel', p.no, ''); VIEWS.po.render(); };

VIEWS.sourcing = {
  mod: 'purchase', render() {
    masterView({
      col: 'sourcing', mod: 'purchase', title: 'Sourcing', view: VIEWS.sourcing, sort: 'material', paste: true,
      cols: [{ k: 'material', l: 'Material', w: 140, upper: true }, { k: 'vendor', l: 'Vendor' }, { k: 'rate', l: 'Rate ₹', type: 'number', w: 90 }, { k: 'moq', l: 'MOQ', type: 'number', w: 80 }, { k: 'lead_days', l: 'Lead days', type: 'number', w: 80 }, { k: 'remark', l: 'Remark' }],
      validate: d => !String(d.material || '').trim() ? 'Material is required.' : !String(d.vendor || '').trim() ? 'Vendor is required.' : (Store.all('sourcing').some(x => x.id !== d.id && norm(x.material) === norm(d.material) && norm(x.vendor) === norm(d.vendor)) ? 'This material+vendor already exists.' : '')
    });
    $('#main').insertAdjacentHTML('beforeend', '<div class="muted small" style="margin-top:8px">Ek material ke kai vendors ho sakte hain — PO banate waqt yahin se rate dekh lo.</div>');
  }
};

VIEWS.followup = {
  mod: 'purchase', render() {
    const edit = can('purchase', 'edit');
    const rows = openPOs().map(p => { const f = (p.followups || []).slice(-1)[0]; return { p, f }; })
      .sort((a, b) => ((a.f && a.f.next) || '0') < ((b.f && b.f.next) || '0') ? -1 : 1);
    let h = subTitle('PO Followup', 'sirf open POs') + '<div class="tbl-wrap"><table><tr><th>PO</th><th>Vendor</th><th class="num">Pending qty</th><th>Expected</th><th>Last followup</th><th>Next</th>' + (edit ? '<th style="min-width:260px">New followup</th>' : '') + '</tr>' +
      (rows.length ? rows.map(x => '<tr' + (x.f && x.f.next && x.f.next <= todayYmd() ? '' : '') + '><td><b>' + esc(x.p.no) + '</b></td><td>' + esc(x.p.vendor) + '</td><td class="num">' + qtyFmt(poPending(x.p)) + '</td><td class="nowrap ' + (x.p.expected < todayYmd() ? 'late-txt' : '') + '">' + fmtD(x.p.expected) + '</td>' +
        '<td class="small">' + (x.f ? esc(x.f.note) + '<div class="muted">' + esc(x.f.by) + ' · ' + fmtD(x.f.at) + '</div>' : '<span class="muted">—</span>') + '</td><td class="nowrap ' + (x.f && x.f.next && x.f.next <= todayYmd() ? 'late-txt' : '') + '">' + (x.f ? fmtD(x.f.next) : '') + '</td>' +
        (edit ? '<td><div class="row" style="align-items:center"><input data-fu-note placeholder="baat kya hui" style="flex:1;min-width:120px"><input data-fu-next type="date" style="width:130px"><button class="btn sm" data-act="fu-save" data-id="' + esc(x.p.id) + '">Save</button></div></td>' : '') + '</tr>').join('') : '<tr><td colspan="7" class="empty">Koi open PO nahi</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['fu-save'] = el => {
  const tr = el.closest('tr'); const note = $('[data-fu-note]', tr).value.trim(); const next = $('[data-fu-next]', tr).value;
  if (!note) { flash('Followup note likho.', 'err'); return; }
  const p = Store.get('purchase_orders', el.dataset.id);
  p.followups = p.followups || []; p.followups.push({ at: todayYmd(), by: ME.name, note, next });
  Store.put('purchase_orders', p); audit('po.followup', p.no, note); flash('Followup saved.'); VIEWS.followup.render();
};

/* ================= MERCHANT: job cards ================= */
const JC_UI = { f: 'open', form: false };
VIEWS.jobcards = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const rows = Store.all('job_cards').slice().sort((a, b) => b.no < a.no ? -1 : 1).filter(j => JC_UI.f === 'all' || (JC_UI.f === 'open' ? j.status !== 'Closed' : j.status === 'Closed'));
    let h = subTitle('Job Cards') + '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open' }, { v: 'closed', l: 'Closed' }, { v: 'all', l: 'All' }], JC_UI.f) + '<span class="grow"></span>' + (edit ? newBtn('New job card', 'jc-new') : '') + '</div>';
    if (JC_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px"><datalist id="dlOrd">' + Store.all('orders').filter(o => orderState(o).open).map(o => '<option value="' + esc(o.no) + '">' + esc(o.customer_name) + '</option>').join('') + '</datalist>' +
      '<div class="row"><label>Order (optional)<input id="njOrd" list="dlOrd"></label><label>Brand *<input id="njBrand" list="dlBrand2"></label><label>Article *<input id="njArt" list="dlArt2"></label><label>Colour<input id="njCol"></label><label>Qty *<input id="njQty" type="number" min="0" style="width:90px"></label><button class="btn primary" data-act="jc-save">Save</button><span id="njMsg" class="small"></span></div>' +
      '<datalist id="dlBrand2">' + Store.all('customers').map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist><datalist id="dlArt2">' + Store.all('items').map(i => '<option value="' + esc(i.code) + '">').join('') + '</datalist></div>';
    h += '<div class="tbl-wrap"><table><tr><th>JC No</th><th>Order</th><th>Brand</th><th>Article</th><th class="num">Qty</th><th>Material</th><th>Swatch</th><th>Corrections</th><th>Status</th><th></th></tr>' +
      (rows.length ? rows.map(j => {
        const oc = (j.corrections || []).filter(x => !x.resolved).length;
        const L = j.lines || []; const req = L.reduce((s2, l) => s2 + num(l.required), 0);
        const iss = L.reduce((s2, l) => s2 + Math.min(num(l.required), issuedToJc(j.no, l.material)), 0);
        const ready = req ? Math.round(iss / req * 100) : null;
        let row = '<tr class="click" data-act="jc-toggle" data-id="' + esc(j.id) + '"><td><b>' + esc(j.no) + '</b><div class="muted small">' + esc(j.by) + ' · ' + fmtD(j.at) + '</div></td><td>' + esc(j.order_no || '') + '</td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + (j.colour ? ' <span class="muted">' + esc(j.colour) + '</span>' : '') + '</td><td class="num">' + qtyFmt(j.qty) + '</td>' +
          '<td>' + (ready == null ? '<span class="late-txt small">No BOM</span>' : '<span class="' + (ready >= 100 ? 'st Done' : 'small') + '">' + ready + '% issued</span>') + '</td>' +
          '<td><span class="st ' + (j.swatch_status === 'Approved' ? 'Done' : j.swatch_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(j.swatch_status) + '</span></td><td>' + (oc ? '<span class="late-txt">' + oc + ' open</span>' : (j.corrections || []).length ? 'resolved' : '—') + '</td><td>' + stHtml(j.status === 'Closed' ? 'Done' : 'Pending').replace('>Done<', '>Closed<').replace('>Pending<', '>Open<') + '</td>' +
          '<td class="right">' + (edit && j.status !== 'Closed' ? '<button class="btn sm" data-act="jc-close" data-id="' + esc(j.id) + '" data-confirm="Close JC?">Close</button>' : '') + '</td></tr>';
        if (JC_UI.open === j.id) row += '<tr class="inline-form"><td colspan="10">' + (L.length ? '<table style="max-width:860px;margin:4px 0"><tr><th>Material</th><th>Supplier</th><th class="num">Norms</th><th class="num">Required (+2%)</th><th class="num">PO raised</th><th class="num">Transit</th><th class="num">Reserved</th><th class="num">Issued</th><th class="num">Pending PO</th></tr>' +
          L.map(l => { const issd = issuedToJc(j.no, l.material); const pen = Math.max(0, num(l.required) - num(l.po_raised)); return '<tr><td>' + esc(l.material) + '</td><td class="small">' + esc(l.supplier || '') + '</td><td class="num">' + l.norms + '</td><td class="num">' + qtyFmt(l.required) + '</td><td class="num">' + qtyFmt(l.po_raised) + '</td><td class="num muted">' + qtyFmt(transitOf(l.material)) + '</td><td class="num">' + qtyFmt(reservedOf(l.material, j.no)) + '</td><td class="num">' + qtyFmt(issd) + '</td><td class="num ' + (pen ? 'late-txt' : '') + '">' + (pen ? qtyFmt(pen) : '—') + '</td></tr>'; }).join('') + '</table>' : '<span class="muted small">BOM nahi mila tha — Development se BOM banwa ke JC dobara banao.</span>') + '</td></tr>';
        return row;
      }).join('') : '<tr><td colspan="10" class="empty">No job cards</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { JC_UI.f = e.detail; VIEWS.jobcards.render(); });
    const ordIn = $('#njOrd'); if (ordIn) ordIn.addEventListener('change', e => {
      const o = Store.all('orders').find(x => norm(x.no) === norm(e.target.value)); if (!o) return;
      $('#njBrand').value = o.customer_name; const l = o.lines[0] || {}; $('#njArt').value = l.article || ''; $('#njCol').value = l.colour || ''; $('#njQty').value = orderTotals(o).qty;
    });
  }
};
ACTIONS['jc-new'] = () => { JC_UI.form = !JC_UI.form; VIEWS.jobcards.render(); };
// BOM se JC material lines: required = ceil(norms x qty x 1.02) — purane IMS ka size-extra rule
function jcLinesFromBom(article, qty) {
  const b = Store.all('boms').filter(x => norm(x.article) === norm(article)).sort((a2, b2) => b2.version - a2.version)[0];
  if (!b) return null;
  return b.lines.map(l => ({ material: l.material, uom: l.uom, norms: num(l.qty), supplier: l.supplier || '', required: Math.ceil(num(l.qty) * qty * 1.02 * 1000) / 1000, po_raised: 0 }));
}
ACTIONS['jc-save'] = () => {
  if (!requirePerm('merchant', 'edit')) return;
  const brand = $('#njBrand').value.trim(), art = $('#njArt').value.trim().toUpperCase(), qty = num($('#njQty').value);
  if (!brand || !art || qty <= 0) { $('#njMsg').innerHTML = '<span class="late-txt">Brand, article aur qty chahiye.</span>'; return; }
  const lines = jcLinesFromBom(art, qty);
  const j = Store.put('job_cards', { id: uid(), no: nextNo('job_cards', 'JC'), order_no: $('#njOrd').value.trim(), brand, article: art, colour: $('#njCol').value.trim(), qty, lines: lines || [], swatch_status: 'Pending', status: 'Open', corrections: [], by: ME.name, at: nowIso() });
  audit('jc.create', j.no, brand + ' · ' + art + ' × ' + qty + (lines ? ' · BOM v-latest (' + lines.length + ' materials)' : ' · BOM NAHI mila'));
  JC_UI.form = false;
  flash(esc(j.no) + ' created — swatch approval pending.' + (lines ? ' Material requirement BOM se ban gayi (' + lines.length + ' items, +2%).' : ' <b>Is article ka BOM nahi hai</b> — Development se banwao, phir JC dobara banana.'), lines ? '' : 'err');
  VIEWS.jobcards.render();
};
ACTIONS['jc-toggle'] = (el, ev) => { if (ev.target.closest('button')) return; JC_UI.open = JC_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.jobcards.render(); };
ACTIONS['jc-close'] = el => { const j = Store.get('job_cards', el.dataset.id); if ((j.corrections || []).some(c => !c.resolved)) { flash('Pehle open corrections resolve karo.', 'err'); return; } j.status = 'Closed'; Store.put('job_cards', j); audit('jc.close', j.no, ''); VIEWS.jobcards.render(); };

VIEWS.swatch = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const rows = Store.all('job_cards').filter(j => j.swatch_status === 'Pending' || j.swatch_status === 'Rejected');
    let h = subTitle('Swatch Approval', 'pending + rejected') + '<div class="tbl-wrap"><table><tr><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th class="num">Qty</th><th>Status</th><th>Note</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(j => '<tr><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + '</td><td>' + esc(j.colour) + '</td><td class="num">' + qtyFmt(j.qty) + '</td><td><span class="st ' + (j.swatch_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(j.swatch_status) + '</span></td>' +
        '<td>' + (edit ? '<input data-sw-note placeholder="optional" value="' + esc(j.swatch_note || '') + '">' : esc(j.swatch_note || '')) + '</td>' +
        (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="sw-set" data-id="' + esc(j.id) + '" data-s="Approved">Approve</button> <button class="btn sm danger" data-act="sw-set" data-id="' + esc(j.id) + '" data-s="Rejected">Reject</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="8" class="empty">Sab swatch approve ho chuke 🎉</td></tr>') + '</table></div>';
    h += '<h2>Approved (last 10)</h2><div class="tbl-wrap"><table><tr><th>JC</th><th>Brand</th><th>Article</th><th>Note</th></tr>' + Store.all('job_cards').filter(j => j.swatch_status === 'Approved').slice(-10).reverse().map(j => '<tr><td>' + esc(j.no) + '</td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + '</td><td class="small">' + esc(j.swatch_note || '') + '</td></tr>').join('') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['sw-set'] = el => {
  const j = Store.get('job_cards', el.dataset.id); const tr = el.closest('tr');
  j.swatch_status = el.dataset.s; j.swatch_note = $('[data-sw-note]', tr).value.trim(); j.swatch_by = ME.name;
  Store.put('job_cards', j); audit('jc.swatch', j.no, el.dataset.s + (j.swatch_note ? ' — ' + j.swatch_note : '')); flash(esc(j.no) + ' swatch ' + el.dataset.s.toLowerCase() + '.'); VIEWS.swatch.render();
};

VIEWS.jccorrection = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const rows = Store.all('job_cards').filter(j => j.status !== 'Closed');
    let h = subTitle('Job Card Correction') + '<div class="tbl-wrap"><table><tr><th>JC No</th><th>Brand · Article</th><th>Open corrections</th>' + (edit ? '<th style="min-width:280px">Add correction</th>' : '') + '</tr>' +
      (rows.length ? rows.map(j => '<tr><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.brand + ' · ' + j.article + (j.colour ? ' · ' + j.colour : '')) + '</td>' +
        '<td>' + ((j.corrections || []).length ? j.corrections.map((c, i) => '<div class="small' + (c.resolved ? ' muted' : '') + '">' + (c.resolved ? '✓ ' : '• ') + esc(c.note) + ' <span class="muted">' + esc(c.by) + '</span>' + (!c.resolved && edit ? ' <a data-act="jcc-resolve" data-id="' + esc(j.id) + '" data-i="' + i + '">resolve</a>' : '') + '</div>').join('') : '<span class="muted">—</span>') + '</td>' +
        (edit ? '<td><div class="row"><input data-jcc-note placeholder="kya theek karna hai" style="flex:1"><button class="btn sm" data-act="jcc-add" data-id="' + esc(j.id) + '">Add</button></div></td>' : '') + '</tr>').join('') : '<tr><td colspan="4" class="empty">No open job cards</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['jcc-add'] = el => {
  const note = $('[data-jcc-note]', el.closest('tr')).value.trim(); if (!note) return;
  const j = Store.get('job_cards', el.dataset.id); j.corrections = j.corrections || []; j.corrections.push({ at: nowIso(), by: ME.name, note, resolved: false });
  Store.put('job_cards', j); audit('jc.correction', j.no, note); VIEWS.jccorrection.render();
};
ACTIONS['jcc-resolve'] = el => { const j = Store.get('job_cards', el.dataset.id); j.corrections[+el.dataset.i].resolved = true; Store.put('job_cards', j); audit('jc.correction.resolve', j.no, j.corrections[+el.dataset.i].note); VIEWS.jccorrection.render(); };

/* ================= STORE ================= */
const INW_UI = { form: false };
VIEWS.inward = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const rows = Store.all('inwards').slice().sort((a, b) => b.no < a.no ? -1 : 1);
    let h = subTitle('Inwarding', 'gate entry — GRN alag hota hai') + '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New inward', 'inw-new') : '') + '</div>';
    if (INW_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px">' + dlVendor() + dlMat('dlMatI') +
      '<div class="row"><label>Date<input id="niDate" type="date" value="' + todayYmd() + '"></label><label>Vendor *<input id="niVen" list="dlVen"></label><label>PO no<input id="niPo" list="dlPoNo"></label><label>Material *<input id="niMat" list="dlMatI"></label><label>Qty *<input id="niQty" type="number" min="0" style="width:100px"></label><label style="flex:1">Remark<input id="niRem"></label><button class="btn primary" data-act="inw-save">Save</button><span id="niMsg" class="small"></span></div>' +
      '<datalist id="dlPoNo">' + openPOs().map(p => '<option value="' + esc(p.no) + '">' + esc(p.vendor) + '</option>').join('') + '</datalist></div>';
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Vendor</th><th>PO</th><th>Material</th><th class="num">Qty</th><th>Swatch match</th><th>Remark</th></tr>' +
      (rows.length ? rows.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no || '') + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td><span class="st ' + (i.swatch_match === 'Pass' ? 'Done' : i.swatch_match === 'Fail' ? 'Late' : 'Pending') + '">' + (i.swatch_match || 'Pending') + '</span></td><td class="small">' + esc(i.remark || '') + '</td></tr>').join('') : '<tr><td colspan="8" class="empty">No inward entries</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['inw-new'] = () => { INW_UI.form = !INW_UI.form; VIEWS.inward.render(); };
ACTIONS['inw-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const ven = $('#niVen').value.trim(); const m = matBy($('#niMat').value); const qty = num($('#niQty').value);
  if (!ven || !m || qty <= 0) { $('#niMsg').innerHTML = '<span class="late-txt">Vendor, material (master wala) aur qty chahiye.</span>'; return; }
  const i = Store.put('inwards', { id: uid(), no: nextNo('inwards', 'INW'), date: $('#niDate').value || todayYmd(), vendor: ven, po_no: $('#niPo').value.trim(), material: m.code, uom: m.uom, qty, remark: $('#niRem').value.trim(), swatch_match: '', by: ME.name });
  audit('inward.create', i.no, ven + ' · ' + m.code + ' × ' + qty); INW_UI.form = false; flash(esc(i.no) + ' saved — swatch matching pending.'); VIEWS.inward.render();
};

VIEWS.swatchmatch = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const rows = Store.all('inwards').filter(i => !i.swatch_match);
    let h = subTitle('Swatch Matching', 'inward material vs approved swatch') + '<div class="tbl-wrap"><table><tr><th>Inward</th><th>Date</th><th>Vendor</th><th>Material</th><th class="num">Qty</th><th>Note</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td>' +
        '<td>' + (edit ? '<input data-sm-note placeholder="optional">' : '') + '</td>' +
        (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="sm-set" data-id="' + esc(i.id) + '" data-s="Pass">Pass</button> <button class="btn sm danger" data-act="sm-set" data-id="' + esc(i.id) + '" data-s="Fail">Fail</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="7" class="empty">Sab match ho chuka 🎉</td></tr>') + '</table></div>';
    h += '<h2>Recent results</h2><div class="tbl-wrap"><table><tr><th>Inward</th><th>Material</th><th>Result</th><th>Note</th><th>By</th></tr>' + Store.all('inwards').filter(i => i.swatch_match).slice(-10).reverse().map(i => '<tr><td>' + esc(i.no) + '</td><td>' + esc(i.material) + '</td><td><span class="st ' + (i.swatch_match === 'Pass' ? 'Done' : 'Late') + '">' + i.swatch_match + '</span></td><td class="small">' + esc(i.swatch_note || '') + '</td><td>' + esc(i.swatch_by || '') + '</td></tr>').join('') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['sm-set'] = el => {
  const i = Store.get('inwards', el.dataset.id); i.swatch_match = el.dataset.s; i.swatch_note = ($('[data-sm-note]', el.closest('tr')) || { value: '' }).value.trim(); i.swatch_by = ME.name;
  Store.put('inwards', i); audit('inward.swatch', i.no, el.dataset.s); flash(esc(i.no) + ': swatch ' + el.dataset.s + '.'); VIEWS.swatchmatch.render();
};

const GRN_UI = { open: null };
VIEWS.grn = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const pos = openPOs();
    let h = subTitle('GRN', 'PO ke against receiving') + '<div class="tbl-wrap"><table><tr><th>PO</th><th>Vendor</th><th>Expected</th><th class="num">Pending qty</th><th></th></tr>' +
      (pos.length ? pos.map(p => {
        let row = '<tr><td><b>' + esc(p.no) + '</b></td><td>' + esc(p.vendor) + '</td><td class="nowrap ' + (p.expected < todayYmd() ? 'late-txt' : '') + '">' + fmtD(p.expected) + '</td><td class="num">' + qtyFmt(poPending(p)) + '</td><td class="right">' + (edit ? '<button class="btn sm ' + (GRN_UI.open === p.id ? '' : 'primary') + '" data-act="grn-open" data-id="' + esc(p.id) + '">' + (GRN_UI.open === p.id ? 'Close' : 'Make GRN') + '</button>' : '') + '</td></tr>';
        if (GRN_UI.open === p.id) row += '<tr class="inline-form"><td colspan="5"><table style="max-width:880px;margin:6px 0"><tr><th>Material</th><th class="num">PO pending</th><th class="num">Invoice qty</th><th class="num">Accept (GRN)</th><th class="num">Reject</th><th class="num">Short</th><th class="num">Excess</th></tr>' +
          p.lines.map((l, i) => { const pen = Math.max(0, num(l.qty) - num(l.received)); return '<tr data-i="' + i + '" data-pen="' + pen + '"><td>' + esc(l.material) + '</td><td class="num">' + qtyFmt(pen) + '</td><td><input class="qty" type="number" min="0" step="any" data-gi value="' + (pen || '') + '"' + (pen ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-ga value="' + (pen || '') + '"' + (pen ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-gr value="0"' + (pen ? '' : ' disabled') + '></td><td class="num muted" data-gs>—</td><td class="num muted" data-gx>—</td></tr>'; }).join('') +
          '</table><div class="row"><label>Invoice / challan no *<input id="grnInv"></label><label>Date<input id="grnDate" type="date" value="' + todayYmd() + '"></label><button class="btn primary" data-act="grn-save" data-id="' + esc(p.id) + '">Save GRN</button><span id="grnMsg" class="small"></span></div><div class="muted small" style="margin-top:4px">Accept = stock · Reject = rejection stock (RTV) · <b>Short</b> = invoice mein hai par aaya nahi (Debit Note auto-task) · <b>Excess</b> = PO pending se zyada bill hua</div></td></tr>';
        return row;
      }).join('') : '<tr><td colspan="5" class="empty">Koi open PO nahi — pehle Purchase Order banao</td></tr>') + '</table></div>';
    const gs = Store.all('grns').slice().sort((a, b) => b.no < a.no ? -1 : 1).slice(0, 15);
    h += '<h2>Recent GRNs</h2><div class="tbl-wrap"><table><tr><th>GRN</th><th>Date</th><th>PO</th><th>Vendor</th><th class="num">Accepted</th><th class="num">Rej + Short</th><th>By</th></tr>' +
      (gs.length ? gs.map(g => '<tr><td><b>' + esc(g.no) + '</b></td><td class="nowrap">' + fmtD(g.date) + '</td><td>' + esc(g.po_no) + '</td><td>' + esc(g.vendor) + '</td><td class="num">' + qtyFmt(g.lines.reduce((s, l) => s + num(l.accepted), 0)) + '</td><td class="num late-txt">' + qtyFmt(g.lines.reduce((s, l) => s + num(l.rejected) + num(l.short || 0), 0)) + '</td><td>' + esc(g.by) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">No GRNs yet</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['grn-open'] = el => { GRN_UI.open = GRN_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.grn.render(); };
function grnCalcRow(tr) {
  const inv = num($('[data-gi]', tr).value), acc = num($('[data-ga]', tr).value), rej = num($('[data-gr]', tr).value), pen = num(tr.dataset.pen);
  const excess = Math.max(0, inv - pen);                       // billed beyond PO balance
  const short = Math.max(0, inv - acc - rej);                  // billed but physically nahi aaya
  $('[data-gx]', tr).textContent = excess ? qtyFmt(excess) : '—';
  $('[data-gs]', tr).textContent = short ? qtyFmt(short) : '—';
  return { inv, acc, rej, excess, short };
}
document.addEventListener('input', e => { const tr = e.target.closest('tr[data-pen]'); if (tr && (e.target.dataset.gi != null || e.target.dataset.ga != null || e.target.dataset.gr != null)) grnCalcRow(tr); });
ACTIONS['grn-save'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const p = Store.get('purchase_orders', el.dataset.id);
  const rows = $$('tr[data-pen]').map(tr => Object.assign({ i: +tr.dataset.i, material: p.lines[+tr.dataset.i].material }, grnCalcRow(tr))).filter(r => r.inv > 0 || r.acc > 0 || r.rej > 0);
  if (!rows.length) { $('#grnMsg').innerHTML = '<span class="late-txt">Invoice qty ya accept/reject qty dalo.</span>'; return; }
  for (const r of rows) {
    const pen = Math.max(0, num(p.lines[r.i].qty) - num(p.lines[r.i].received));
    if (r.acc + r.rej > r.inv + 1e-9) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(r.material) + ': accept + reject invoice qty se zyada hai.</span>'; return; }
    if (r.acc + r.rej > pen + r.excess + 1e-9) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(r.material) + ': qty PO pending + excess se zyada hai.</span>'; return; }
  }
  const inv = $('#grnInv').value.trim();
  if (!inv) { $('#grnMsg').innerHTML = '<span class="late-txt">Invoice / challan no zaroori hai.</span>'; return; }
  if (Store.all('grns').some(g => norm(g.vendor) === norm(p.vendor) && norm(g.invoice) === norm(inv))) { $('#grnMsg').innerHTML = '<span class="late-txt">Is vendor ki ye invoice pehle GRN ho chuki hai (duplicate guard).</span>'; return; }
  const failedInward = Store.all('inwards').find(iw => norm(iw.vendor) === norm(p.vendor) && norm(iw.po_no) === norm(p.no) && iw.swatch_match === 'Fail');
  if (failedInward) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(failedInward.no) + ' ka swatch FAIL hai — Merchant se sort hone tak is PO ki GRN block hai.</span>'; return; }
  rows.forEach(r => { const pl = p.lines[r.i]; pl.received = num(pl.received) + r.acc + r.rej; pl.rejected = num(pl.rejected) + r.rej; });
  Store.put('purchase_orders', p);
  const lines = rows.map(r => ({ material: r.material, inv_qty: r.inv, accepted: r.acc, rejected: r.rej, short: r.short, excess: r.excess }));
  const g = Store.put('grns', { id: uid(), no: fyNo('grns', 'GRN', 4), date: $('#grnDate').value || todayYmd(), po_id: p.id, po_no: p.no, vendor: p.vendor, invoice: inv, lines, by: ME.name });
  const totRej = rows.reduce((x, r) => x + r.rej, 0), totShort = rows.reduce((x, r) => x + r.short, 0), totExcess = rows.reduce((x, r) => x + r.excess, 0);
  // Auto tasks (purane IMS jaisa): short/reject -> Debit Note (Accounts) + RTV (Store); har GRN -> Tally Entry agle din.
  if (totRej > 0 || totShort > 0) {
    autoTask('Debit Note — ' + inv + ' (' + p.vendor + '): reject ' + qtyFmt(totRej) + ', short ' + qtyFmt(totShort), 'ACCOUNTS', 0);
    if (totRej > 0) autoTask('RTV — ' + p.vendor + ' inv ' + inv + ': ' + rows.filter(r => r.rej).map(r => r.material + ' × ' + qtyFmt(r.rej)).join(', '), 'STORE', 1);
  }
  autoTask('Tally Entry — GRN ' + g.no + ' (' + p.vendor + ', inv ' + inv + ')', 'ACCOUNTS', 1);
  audit('grn.create', g.no, p.no + ' · inv ' + inv + ' · acc ' + qtyFmt(rows.reduce((x, r) => x + r.acc, 0)) + (totRej ? ' / rej ' + qtyFmt(totRej) : '') + (totShort ? ' / short ' + qtyFmt(totShort) : '') + (totExcess ? ' / excess ' + qtyFmt(totExcess) : ''));
  GRN_UI.open = null;
  flash(esc(g.no) + ' saved — stock update.' + (totRej || totShort ? ' <b>Debit Note' + (totRej ? ' + RTV' : '') + ' task auto ban gaya.</b>' : '') + (poPending(p) <= 0 ? ' ' + esc(p.no) + ' fully received.' : ''));
  VIEWS.grn.render();
};

const ISS_UI = { form: false, ret: false };
function pendingIssues() { return Store.all('issues').filter(i => i.status === 'Pending'); }
VIEWS.issuance = {
  mod: 'store', render() {
    const edit = can('store', 'edit'); const appr = canApprove();
    const reqs = Store.all('requisitions').filter(r => r.status === 'Pending');
    const { stk } = stockMaps();
    let h = subTitle('Issuance', 'request → approval → tabhi stock katta hai');

    // 1) approvals
    const pend = pendingIssues();
    h += '<h2 style="margin-top:0">Issue approvals (' + pend.length + ')</h2><div class="tbl-wrap"><table><tr><th>No</th><th>Material</th><th class="num">Qty</th><th>Source</th><th>To</th><th>Req</th><th>By</th>' + (appr ? '<th></th>' : '') + '</tr>' +
      (pend.length ? pend.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td class="small">' + esc(i.source || 'AUTO') + '</td><td>' + esc(i.to_jc || i.to_dept || '') + '</td><td>' + esc(i.req_no || '') + '</td><td>' + esc(i.by) + '</td>' +
        (appr ? '<td class="right nowrap"><button class="btn sm primary" data-act="iss-approve" data-id="' + esc(i.id) + '">Approve</button> <button class="btn sm ghost danger" data-act="iss-deny" data-id="' + esc(i.id) + '" data-confirm="Reject?">Reject</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="8" class="empty">Koi issue approval pending nahi</td></tr>') + '</table></div>' +
      (appr ? '' : '<div class="muted small" style="margin-top:4px">Approve sirf Admin/Manager kar sakta hai — stock tabhi katta hai.</div>');

    // 2) pending requisitions
    h += '<h2>Pending requisitions</h2><div class="tbl-wrap"><table><tr><th>Req</th><th>Date</th><th>JC / Dept</th><th>Materials</th><th>Stock check</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (reqs.length ? reqs.map(r => {
        const short = r.lines.filter(l => (stk[norm(l.material)] || 0) < num(l.qty));
        return '<tr><td><b>' + esc(r.no) + '</b><div class="muted small">' + esc(r.by) + '</div></td><td class="nowrap">' + fmtD(r.date) + '</td><td>' + esc(r.jc_no || r.dept) + '</td><td class="small">' + r.lines.map(l => esc(l.material) + ' × ' + qtyFmt(l.qty)).join('<br>') + '</td>' +
          '<td>' + (short.length ? '<span class="late-txt small">Short: ' + short.map(l => esc(l.material)).join(', ') + '</span>' : '<span class="st Done">OK</span>') + '</td>' +
          (edit ? '<td class="right nowrap"><button class="btn sm primary" data-act="iss-req" data-id="' + esc(r.id) + '"' + (short.length ? ' disabled title="stock short"' : '') + '>Send for issue</button> <button class="btn sm ghost danger" data-act="req-reject" data-id="' + esc(r.id) + '" data-confirm="Reject?">Reject</button></td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="6" class="empty">Koi pending requisition nahi</td></tr>') + '</table></div>';

    // 3) direct issue + return
    h += '<div class="toolbar" style="margin-top:14px"><h2 style="margin:0">Direct issue / return</h2>' +
      (edit ? '<button class="btn sm" data-act="iss-new">' + (ISS_UI.form ? 'Close' : '+ Issue material') + '</button><button class="btn sm" data-act="ret-new">' + (ISS_UI.ret ? 'Close' : '+ Material return') + '</button>' : '') + '</div>';
    if (ISS_UI.form && edit) h += '<div class="panel" style="margin-bottom:10px">' + dlMat('dlMatIs') + '<datalist id="dlJc2">' + Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist>' +
      '<div class="row"><label>Material *<input id="isMat" list="dlMatIs"></label><label>Qty *<input id="isQty" type="number" min="0" style="width:100px"></label><label>To JC<input id="isJc" list="dlJc2"></label><label>To dept<input id="isDept" list="dlDept"><datalist id="dlDept">' + ['Production', 'Development', 'Merchant', 'Dispatch'].map(d => '<option>' + d + '</option>').join('') + '</datalist></label>' +
      '<label>Source' + seg('isSrc', [{ v: 'AUTO', l: 'Auto (reserved→open)' }, { v: 'RSJW', l: 'JC reserved' }, { v: 'OPEN', l: 'Open stock' }], 'AUTO') + '</label><button class="btn primary" data-act="iss-save">Request issue</button><span id="isMsg" class="small"></span></div></div>';
    if (ISS_UI.ret && edit) h += '<div class="panel" style="margin-bottom:10px">' + dlMat('dlMatRt') + '<datalist id="dlJc3">' + Store.all('job_cards').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist>' +
      '<div class="row"><label>JC *<input id="rtJc" list="dlJc3"></label><label>Material *<input id="rtMat" list="dlMatRt"></label><label>Qty *<input id="rtQty" type="number" min="0" style="width:100px"></label><label style="flex:1">Remark<input id="rtRem"></label><button class="btn primary" data-act="ret-save">Return to stock</button><span id="rtMsg" class="small"></span></div>' +
      '<div class="muted small">Wapas open stock mein jayega. Issued se zyada return nahi ho sakta.</div></div>';

    // 4) history
    const iss = Store.all('issues').filter(i => i.status !== 'Pending').slice().sort((a2, b2) => (b2.at || '') < (a2.at || '') ? -1 : 1).slice(0, 15);
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Type</th><th>Material</th><th class="num">Qty</th><th>To / From</th><th>Req</th><th>Status</th><th>By / Approved</th></tr>' +
      (iss.length ? iss.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + (i.type === 'return' ? 'Return' : 'Issue') + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(i.to_jc || i.to_dept || '') + '</td><td>' + esc(i.req_no || '') + '</td><td><span class="st ' + (i.status === 'Approved' ? 'Done' : 'Cancelled') + '">' + esc(i.status || 'Approved') + '</span></td><td class="small">' + esc(i.by) + (i.approved_by ? ' → ' + esc(i.approved_by) : '') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No issues yet</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['iss-new'] = () => { ISS_UI.form = !ISS_UI.form; ISS_UI.ret = false; VIEWS.issuance.render(); };
ACTIONS['ret-new'] = () => { ISS_UI.ret = !ISS_UI.ret; ISS_UI.form = false; VIEWS.issuance.render(); };
ACTIONS['iss-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const m = matBy($('#isMat').value); const qty = num($('#isQty').value); const src = segVal($('[data-seg="isSrc"]')) || 'AUTO'; const jc = $('#isJc').value.trim();
  if (!m || qty <= 0) { $('#isMsg').innerHTML = '<span class="late-txt">Material aur qty chahiye.</span>'; return; }
  if (src === 'RSJW' && (!jc || reservedOf(m.code, jc) < qty)) { $('#isMsg').innerHTML = '<span class="late-txt">' + (jc ? 'Is JC ka reserved sirf ' + qtyFmt(reservedOf(m.code, jc)) + ' hai.' : 'JC reserved se issue ke liye JC chahiye.') + '</span>'; return; }
  const avail = src === 'OPEN' ? openStockOf(m.code) : src === 'RSJW' ? reservedOf(m.code, jc) : (openStockOf(m.code) + (jc ? reservedOf(m.code, jc) : 0));
  if (qty > avail) { $('#isMsg').innerHTML = '<span class="late-txt">Available sirf ' + qtyFmt(avail) + ' hai (' + src + ').</span>'; return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), material: m.code, qty, source: src, to_jc: jc, to_dept: $('#isDept').value.trim(), status: 'Pending', by: ME.name, at: nowIso() });
  audit('issue.request', i.no, m.code + ' × ' + qty + ' (' + src + ')'); ISS_UI.form = false;
  flash(esc(i.no) + ' request bhej di — approval ke baad stock katega.'); VIEWS.issuance.render();
};
ACTIONS['iss-req'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const r = Store.get('requisitions', el.dataset.id); const { stk } = stockMaps();
  if (r.lines.some(l => (stk[norm(l.material)] || 0) < num(l.qty))) { flash('Stock short hai.', 'err'); return; }
  r.lines.forEach(l => Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), material: l.material, qty: num(l.qty), source: 'AUTO', to_jc: r.jc_no, to_dept: r.dept, req_no: r.no, status: 'Pending', by: ME.name, at: nowIso() }));
  r.status = 'Sent for Approval'; Store.put('requisitions', r);
  audit('req.send', r.no, r.lines.map(l => l.material + '×' + l.qty).join(', ')); flash(esc(r.no) + ' approval ke liye bheja.'); VIEWS.issuance.render();
};
ACTIONS['iss-approve'] = el => {
  if (!canApprove()) { flash('Approve sirf Admin/Manager.', 'err'); return; }
  const i = Store.get('issues', el.dataset.id); if (i.status !== 'Pending') return;
  // final stock check at approval time
  const avail = i.source === 'OPEN' ? openStockOf(i.material) : i.source === 'RSJW' ? reservedOf(i.material, i.to_jc) : (openStockOf(i.material) + (i.to_jc ? reservedOf(i.material, i.to_jc) : 0));
  if (num(i.qty) > avail) { flash('Ab stock kam hai (' + qtyFmt(avail) + ') — reject karo ya stock aane do.', 'err'); return; }
  // consume reservation first (AUTO/RSJW)
  if (i.to_jc && i.source !== 'OPEN') {
    let need = num(i.qty);
    Store.all('rsjw').filter(r => norm(r.jc_no) === norm(i.to_jc) && norm(r.material) === norm(i.material)).forEach(r => {
      if (need <= 0) return; const take = Math.min(need, num(r.qty)); r.qty = num(r.qty) - take; need -= take;
      if (r.qty <= 0.0001) Store.del('rsjw', r.id); else Store.put('rsjw', r);
    });
  }
  i.status = 'Approved'; i.approved_by = ME.name; i.approved_at = nowIso(); Store.put('issues', i);
  // requisition close when all its issues resolved
  if (i.req_no) {
    const req = Store.all('requisitions').find(r => norm(r.no) === norm(i.req_no));
    if (req && !Store.all('issues').some(x => x.req_no === i.req_no && x.status === 'Pending')) { req.status = 'Issued'; req.issued_by = ME.name; Store.put('requisitions', req); }
  }
  audit('issue.approve', i.no, i.material + ' × ' + qtyFmt(i.qty)); flash(esc(i.no) + ' approved — stock kat gaya.'); VIEWS.issuance.render();
};
ACTIONS['iss-deny'] = el => {
  if (!canApprove()) { flash('Reject sirf Admin/Manager.', 'err'); return; }
  const i = Store.get('issues', el.dataset.id); i.status = 'Rejected'; i.approved_by = ME.name; Store.put('issues', i);
  if (i.req_no) { const req = Store.all('requisitions').find(r => norm(r.no) === norm(i.req_no)); if (req) { req.status = 'Pending'; Store.put('requisitions', req); } }
  audit('issue.reject', i.no, ''); VIEWS.issuance.render();
};
ACTIONS['ret-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const jc = $('#rtJc').value.trim(); const m = matBy($('#rtMat').value); const qty = num($('#rtQty').value);
  if (!jc || !m || qty <= 0) { $('#rtMsg').innerHTML = '<span class="late-txt">JC, material aur qty chahiye.</span>'; return; }
  const net = issuedToJc(jc, m.code);
  if (qty > net) { $('#rtMsg').innerHTML = '<span class="late-txt">Is JC ko net issued sirf ' + qtyFmt(net) + ' hai — usse zyada return nahi hota.</span>'; return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), type: 'return', material: m.code, qty, to_jc: jc, status: 'Approved', by: ME.name, approved_by: ME.name, at: nowIso(), remark: $('#rtRem').value.trim() });
  audit('issue.return', i.no, m.code + ' × ' + qty + ' ← ' + jc); ISS_UI.ret = false; flash('Return ho gaya — open stock badh gaya.'); VIEWS.issuance.render();
};
ACTIONS['req-reject'] = el => { const r = Store.get('requisitions', el.dataset.id); r.status = 'Rejected'; Store.put('requisitions', r); audit('req.reject', r.no, ''); VIEWS.issuance.render(); };

VIEWS.stock = {
  mod: 'store', render() {
    const { stk } = stockMaps();
    const rows = Store.all('materials').map(m => ({ m, q: stk[norm(m.code)] || 0 })).sort((a, b) => a.m.code.localeCompare(b.m.code));
    const low = rows.filter(x => num(x.m.min_level) > 0 && x.q < num(x.m.min_level));
    setMain(subTitle('Stock View', 'GRN accepted − issued') + '<div class="toolbar">' + (low.length ? '<span class="late-txt small"><b>' + low.length + ' item min level se neeche</b></span>' : '<span class="muted small">Sab items min level se upar</span>') + '<span class="grow"></span><button class="btn" data-act="stock-csv">Export CSV</button></div>' +
      '<div class="tbl-wrap"><table><tr><th>Material</th><th>Name</th><th>Group</th><th>UOM</th><th>Rack</th><th class="num">Min level</th><th class="num">Reserved (JC)</th><th class="num">Open</th><th class="num">Total stock</th>' + (can('store', 'edit') ? '<th></th>' : '') + '</tr>' +
      rows.map(x => { const lowRow = num(x.m.min_level) > 0 && x.q < num(x.m.min_level); return '<tr' + (lowRow ? ' style="background:#fdf3f3"' : x.q <= 0 ? ' class="muted"' : '') + '><td><b>' + esc(x.m.code) + '</b>' + (lowRow ? ' <span class="late-txt small">LOW</span>' : '') + '</td><td>' + esc(x.m.name) + '</td><td>' + esc(x.m.group || '') + '</td><td>' + esc(x.m.uom) + '</td><td>' + esc(x.m.rack || '') + '</td><td class="num muted">' + (num(x.m.min_level) || '') + '</td><td class="num">' + qtyFmt(reservedOf(x.m.code)) + '</td><td class="num">' + qtyFmt(openStockOf(x.m.code)) + '</td><td class="num"><b>' + qtyFmt(x.q) + '</b></td>' + (can('store', 'edit') ? '<td class="right">' + (openStockOf(x.m.code) > 0 ? '<button class="btn ghost sm" data-act="rsv-open" data-c="' + esc(x.m.code) + '">Reserve</button>' : '') + '</td>' : '') + '</tr>' + (VIEWS.stock.rsv === x.m.code ? '<tr class="inline-form"><td colspan="11"><div class="row"><datalist id="dlJcR">' + Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist><label>JC *<input id="rsvJc" list="dlJcR"></label><label>Qty * (open: ' + qtyFmt(openStockOf(x.m.code)) + ')<input id="rsvQty" type="number" min="0" style="width:100px"></label><button class="btn primary sm" data-act="rsv-save" data-c="' + esc(x.m.code) + '">Reserve for JC</button><span id="rsvMsg" class="small"></span></div></td></tr>' : ''); }).join('') + '</table></div>');
    VIEWS.stock.rows = rows;
  }
};
ACTIONS['stock-csv'] = () => downloadCsv('stock-' + todayYmd() + '.csv', [['Material', 'Name', 'Group', 'UOM', 'Stock']].concat((VIEWS.stock.rows || []).map(x => [x.m.code, x.m.name, x.m.group, x.m.uom, x.q])));

VIEWS.rejstock = {
  mod: 'store', render() {
    const { rej } = stockMaps();
    const rows = Object.entries(rej).filter(([, q]) => q > 0.0001).map(([k, q]) => ({ m: matBy(k) || { code: k.toUpperCase(), name: '', uom: '' }, q }));
    setMain(subTitle('Rejection Stock', 'GRN rejected − RTV done') + '<div class="tbl-wrap"><table><tr><th>Material</th><th>Name</th><th class="num">Rejected qty</th><th></th></tr>' +
      (rows.length ? rows.map(x => '<tr><td><b>' + esc(x.m.code) + '</b></td><td>' + esc(x.m.name) + '</td><td class="num late-txt">' + qtyFmt(x.q) + '</td><td class="right">' + (can('store', 'edit') ? '<a href="#/rtv">RTV karo →</a>' : '') + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Rejection stock khali hai 🎉</td></tr>') + '</table></div>');
  }
};

const RTV_UI = { form: false };
VIEWS.rtv = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const { rej } = stockMaps();
    let h = subTitle('RTV', 'Return to Vendor — rejection stock se') + '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New RTV', 'rtv-new') : '') + '</div>';
    if (RTV_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px">' + dlVendor() + '<datalist id="dlRejM">' + Object.entries(rej).filter(([, q]) => q > 0).map(([k, q]) => '<option value="' + esc((matBy(k) || { code: k }).code) + '">' + qtyFmt(q) + ' available</option>').join('') + '</datalist>' +
      '<div class="row"><label>Material *<input id="rvMat" list="dlRejM"></label><label>Qty *<input id="rvQty" type="number" min="0" style="width:100px"></label><label>Vendor *<input id="rvVen" list="dlVen"></label><label style="flex:1">Reason<input id="rvWhy"></label><button class="btn primary" data-act="rtv-save">Save</button><span id="rvMsg" class="small"></span></div></div>';
    const rows = Store.all('rtvs').slice().sort((a, b) => b.no < a.no ? -1 : 1);
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Vendor</th><th>Material</th><th class="num">Qty</th><th>Reason</th><th>By</th></tr>' +
      (rows.length ? rows.map(r => '<tr><td><b>' + esc(r.no) + '</b></td><td class="nowrap">' + fmtD(r.date) + '</td><td>' + esc(r.vendor) + '</td><td>' + esc(r.material) + '</td><td class="num">' + qtyFmt(r.qty) + '</td><td class="small">' + esc(r.reason || '') + '</td><td>' + esc(r.by) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">No RTVs</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['rtv-new'] = () => { RTV_UI.form = !RTV_UI.form; VIEWS.rtv.render(); };
ACTIONS['rtv-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const m = matBy($('#rvMat').value); const qty = num($('#rvQty').value); const ven = $('#rvVen').value.trim();
  const avail = m ? (stockMaps().rej[norm(m.code)] || 0) : 0;
  if (!m || qty <= 0 || !ven) { $('#rvMsg').innerHTML = '<span class="late-txt">Material, qty aur vendor chahiye.</span>'; return; }
  if (qty > avail + 1e-9) { $('#rvMsg').innerHTML = '<span class="late-txt">Rejection stock sirf ' + qtyFmt(avail) + ' hai.</span>'; return; }
  const r = Store.put('rtvs', { id: uid(), no: nextNo('rtvs', 'RTV'), date: todayYmd(), vendor: ven, material: m.code, qty, reason: $('#rvWhy').value.trim(), by: ME.name });
  audit('rtv.create', r.no, m.code + ' × ' + qty + ' → ' + ven); RTV_UI.form = false; flash(esc(r.no) + ' saved.'); VIEWS.rtv.render();
};

VIEWS.materials = {
  mod: 'masters', render() {
    masterView({
      col: 'materials', mod: 'masters', title: 'Materials', view: VIEWS.materials, sort: 'code', paste: true,
      cols: [{ k: 'code', l: 'Code', w: 120, upper: true, ph: 'MAT-001' }, { k: 'name', l: 'Material name', ph: 'e.g. EVA Sheet 10mm' }, { k: 'group', l: 'Group', w: 130 }, { k: 'uom', l: 'UOM', w: 80, upper: true }, { k: 'min_level', l: 'Min level', type: 'number', w: 90 }, { k: 'rack', l: 'Rack', w: 80, upper: true }],
      defaults: { uom: 'PCS' },
      validate: d => uniq('materials', 'code', 'Code')(d),
      inUse: d => (Store.all('purchase_orders').some(p => p.lines.some(l => norm(l.material) === norm(d.code))) || Store.all('issues').some(i => norm(i.material) === norm(d.code))) ? 'Material use ho chuka hai — delete nahi hoga.' : ''
    });
  }
};

/* ================= DEVELOPMENT: BOM ================= */
const BOM_UI = {};
VIEWS.bom = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    if (!edit) { go('boms'); return; }
    let h = subTitle('Make BOM') + '<div class="panel">' + dlMat('dlMatB') + dlVendor() + '<datalist id="dlArtB">' + Store.all('items').map(i => '<option value="' + esc(i.code) + '">' + esc(i.name) + '</option>').join('') + '</datalist>' +
      '<div class="row"><label>Article *<input id="nbArt" list="dlArtB"></label><label>Colour<input id="nbCol" placeholder="blank = all colours"></label></div>' +
      '<table style="margin-top:10px;max-width:640px"><tr><th>Material</th><th style="width:70px">UOM</th><th class="num" style="width:120px">Qty per pair</th><th style="width:170px">Supplier</th><th style="width:30px"></th></tr><tbody id="nbLines"><tr><td><input data-nb="mat" list="dlMatB"></td><td class="muted" data-uom></td><td><input data-nb="qty" type="number" min="0" step="any" class="right"></td><td><input data-nb="sup" list="dlVen"></td><td><button class="btn ghost sm" data-act="bom-line-del">×</button></td></tr></tbody></table><a class="small" data-act="bom-line">+ material</a>' +
      '<div class="toolbar" style="margin-top:10px"><button class="btn primary" data-act="bom-save">Save as Final</button><span id="nbMsg" class="small"></span></div>' +
      '<div class="muted small">Same article ka dobara BOM banaya toh naya version ban jaata hai; MRS hamesha latest final version uthata hai.</div></div>';
    setMain(h);
  }
};
ACTIONS['bom-line'] = () => $('#nbLines').insertAdjacentHTML('beforeend', '<tr><td><input data-nb="mat" list="dlMatB"></td><td class="muted" data-uom></td><td><input data-nb="qty" type="number" min="0" step="any" class="right"></td><td><input data-nb="sup" list="dlVen"></td><td><button class="btn ghost sm" data-act="bom-line-del">×</button></td></tr>');
ACTIONS['bom-line-del'] = el => el.closest('tr').remove();
document.addEventListener('change', e => { if (e.target.dataset.nb === 'mat') { const m = matBy(e.target.value); if (m) { e.target.value = m.code; $('[data-uom]', e.target.closest('tr')).textContent = m.uom; } } });
ACTIONS['bom-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const art = $('#nbArt').value.trim().toUpperCase();
  const lines = $$('#nbLines tr').map(tr => { const m = matBy($('[data-nb="mat"]', tr).value); return m ? { material: m.code, uom: m.uom, qty: num($('[data-nb="qty"]', tr).value), supplier: $('[data-nb="sup"]', tr).value.trim() } : null; }).filter(l => l && l.qty > 0);
  if (!art || !lines.length) { $('#nbMsg').innerHTML = '<span class="late-txt">Article aur kam se kam ek material line (master wala) chahiye.</span>'; return; }
  const ver = Store.all('boms').filter(b => norm(b.article) === norm(art)).reduce((m, b) => Math.max(m, b.version), 0) + 1;
  const b = Store.put('boms', { id: uid(), article: art, colour: $('#nbCol').value.trim(), version: ver, lines, status: 'Final', by: ME.name, at: nowIso() });
  audit('bom.create', art + ' v' + ver, lines.length + ' materials'); flash('BOM saved: ' + esc(art) + ' v' + ver + '.'); go('boms');
};
VIEWS.boms = {
  mod: 'development', render() {
    const byArt = {};
    Store.all('boms').forEach(b => { const k = norm(b.article); if (!byArt[k] || byArt[k].version < b.version) byArt[k] = b; });
    const rows = Object.values(byArt).sort((a, b) => a.article.localeCompare(b.article));
    setMain(subTitle('Created BOMs', 'latest version per article') + '<div class="toolbar"><span class="grow"></span>' + (can('development', 'edit') ? '<a class="btn primary" href="#/bom">+ Make BOM</a>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Article</th><th>Colour</th><th>Version</th><th>Materials (per pair)</th><th>By</th><th>Date</th></tr>' +
      (rows.length ? rows.map(b => '<tr><td><b>' + esc(b.article) + '</b></td><td>' + esc(b.colour || 'All') + '</td><td>v' + b.version + '</td><td class="small">' + b.lines.map(l => esc(l.material) + ' × ' + l.qty + ' ' + esc(l.uom)).join('<br>') + '</td><td>' + esc(b.by) + '</td><td class="nowrap">' + fmtD(b.at) + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">Koi BOM nahi bana</td></tr>') + '</table></div>');
  }
};

/* ================= PRODUCTION ================= */
const REQ_UI = { form: false };
VIEWS.requisition = {
  mod: 'production', render() {
    const edit = can('production', 'edit');
    let h = subTitle('Requisition Slip', 'store se material mangwane ke liye') + '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New requisition', 'req-new') : '') + '</div>';
    const stale = staleReqs();
    if (stale.length) h += '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px"><b>' + stale.length + ' slip 24h+ se pending</b> — jab tak Store issue/reject nahi karta, nayi slip nahi banegi (Manager/Admin exempt). <a href="#/issuance">Issuance →</a></div>';
    if (REQ_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px">' + dlMat('dlMatR') + '<datalist id="dlJc">' + Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">' + esc(j.article) + '</option>').join('') + '</datalist>' +
      '<div class="row"><label>Job card<input id="nrJc" list="dlJc"></label><label>Dept<input id="nrDept" value="Production"></label></div>' +
      '<table style="margin-top:8px;max-width:560px"><tr><th>Material</th><th class="num" style="width:120px">Qty</th><th style="width:30px"></th></tr><tbody id="nrLines"><tr><td><input data-nr="mat" list="dlMatR"></td><td><input data-nr="qty" type="number" min="0" step="any" class="right"></td><td><button class="btn ghost sm" data-act="req-line-del">×</button></td></tr></tbody></table><a class="small" data-act="req-line">+ material</a>' +
      '<div class="toolbar" style="margin-top:10px"><button class="btn primary" data-act="req-save">Submit</button><span id="nrMsg" class="small"></span></div></div>';
    const rows = Store.all('requisitions').slice().sort((a, b) => b.no < a.no ? -1 : 1);
    h += '<div class="tbl-wrap"><table><tr><th>Req</th><th>Date</th><th>JC / Dept</th><th>Materials</th><th>Status</th><th>By</th></tr>' +
      (rows.length ? rows.map(r => '<tr><td><b>' + esc(r.no) + '</b></td><td class="nowrap">' + fmtD(r.date) + '</td><td>' + esc(r.jc_no || r.dept) + '</td><td class="small">' + r.lines.map(l => esc(l.material) + ' × ' + qtyFmt(l.qty)).join('<br>') + '</td><td><span class="st ' + (r.status === 'Issued' ? 'Done' : r.status === 'Rejected' ? 'Late' : 'Pending') + '">' + r.status + '</span>' + (r.issued_by ? '<div class="muted small">' + esc(r.issued_by) + '</div>' : '') + '</td><td>' + esc(r.by) + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">No requisitions</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['req-new'] = () => { REQ_UI.form = !REQ_UI.form; VIEWS.requisition.render(); };
ACTIONS['req-line'] = () => $('#nrLines').insertAdjacentHTML('beforeend', '<tr><td><input data-nr="mat" list="dlMatR"></td><td><input data-nr="qty" type="number" min="0" step="any" class="right"></td><td><button class="btn ghost sm" data-act="req-line-del">×</button></td></tr>');
ACTIONS['req-line-del'] = el => el.closest('tr').remove();
document.addEventListener('change', e => { if (e.target.dataset.nr === 'mat') { const m = matBy(e.target.value); if (m) e.target.value = m.code; } });
function staleReqs() { return Store.all('requisitions').filter(r => r.status === 'Pending' && (Date.now() - new Date(r.date + 'T00:00')) > 24 * 3600000); }
ACTIONS['req-save'] = () => {
  if (!requirePerm('production', 'edit')) return;
  const stale = staleReqs();
  if (stale.length && !canApprove()) { $('#nrMsg').innerHTML = '<span class="late-txt">' + esc(stale[0].no) + ' 24 ghante se pending hai — pehle Store se issue/reject karwao, tabhi nayi slip banegi.</span>'; return; }
  const lines = $$('#nrLines tr').map(tr => { const m = matBy($('[data-nr="mat"]', tr).value); return m ? { material: m.code, qty: num($('[data-nr="qty"]', tr).value) } : null; }).filter(l => l && l.qty > 0);
  if (!lines.length) { $('#nrMsg').innerHTML = '<span class="late-txt">Kam se kam ek material line chahiye.</span>'; return; }
  const r = Store.put('requisitions', { id: uid(), no: nextNo('requisitions', 'RQ'), date: todayYmd(), jc_no: $('#nrJc').value.trim(), dept: $('#nrDept').value.trim() || 'Production', lines, status: 'Pending', by: ME.name });
  audit('req.create', r.no, lines.map(l => l.material + '×' + l.qty).join(', ')); REQ_UI.form = false; flash(esc(r.no) + ' submitted — Store issuance mein dikhega.'); VIEWS.requisition.render();
};

VIEWS.prodtracker = {
  mod: 'production', render() {
    const rows = Store.all('orders').map(o => ({ o, st: orderState(o), r: resolveOrder(o) })).filter(x => x.st.open && x.r);
    setMain(subTitle('Production Tracker', 'har order production ke stages par') + '<div class="tbl-wrap"><table><tr><th>Order</th><th>Brand</th><th class="num">Qty</th><th>Material</th><th>Production</th><th>QC</th><th>Current step</th><th class="num">Delay</th></tr>' +
      (rows.length ? rows.map(x => {
        const cell = id => { const s = x.r.steps[id]; if (!s || s.status === 'N/A') return '<td class="muted">—</td>'; return '<td><span class="st ' + stCls(s.status) + '">' + s.status + '</span>' + (s.planned && s.status !== 'Done' ? '<div class="muted small">' + fmtDT(s.planned) + '</div>' : s.actual ? '<div class="muted small">' + fmtDT(s.actual) + '</div>' : '') + '</td>'; };
        return '<tr class="click" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td><b>' + esc(x.o.no) + '</b></td><td>' + esc(x.o.customer_name) + '</td><td class="num">' + qtyFmt(orderTotals(x.o).qty) + '</td>' + cell('material') + cell('production') + cell('qc') + '<td>' + (x.st.cur ? esc(x.st.cur.name) : '') + '</td><td class="num late-txt">' + (x.st.cur ? fmtDelay(x.st.cur.delayMinutes) : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">No open orders</td></tr>') + '</table></div>');
  }
};

VIEWS.mrs = {
  mod: 'production', render() {
    const { stk } = stockMaps();
    let h = subTitle('MRS', 'Material Requirement Sheet — order × BOM') + '<div class="panel" style="margin-bottom:12px"><div class="row"><label>Order *<input id="mrsOrd" list="dlOrdM" value="' + esc(VIEWS.mrs.sel || '') + '"><datalist id="dlOrdM">' + Store.all('orders').filter(o => orderState(o).open).map(o => '<option value="' + esc(o.no) + '">' + esc(o.customer_name) + '</option>').join('') + '</datalist></label><button class="btn primary" data-act="mrs-run">Calculate</button></div></div>';
    const o = Store.all('orders').find(x => norm(x.no) === norm(VIEWS.mrs.sel || ''));
    if (o) {
      const need = {};
      const noBom = [];
      o.lines.forEach(l => {
        const bs = Store.all('boms').filter(b => norm(b.article) === norm(l.article)).sort((a, b) => b.version - a.version);
        const b = bs[0];
        if (!b) { noBom.push(l.article); return; }
        b.lines.forEach(bl => { const k = norm(bl.material); need[k] = need[k] || { material: bl.material, uom: bl.uom, qty: 0 }; need[k].qty += num(bl.qty) * num(l.qty); });
      });
      const rows = Object.values(need);
      if (noBom.length) h += '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px">BOM missing: <b>' + noBom.map(esc).join(', ') + '</b> — Development se banwao, tab tak MRS adhoora hai.</div>';
      h += '<div class="toolbar"><span class="muted small">' + esc(o.no) + ' · ' + esc(o.customer_name) + ' · ' + qtyFmt(orderTotals(o).qty) + ' pairs</span><span class="grow"></span><button class="btn" data-act="mrs-csv">Export CSV</button></div>';
      h += '<div class="tbl-wrap"><table><tr><th>Material</th><th>UOM</th><th class="num">Required</th><th class="num">In stock</th><th class="num">Shortfall</th></tr>' +
        (rows.length ? rows.map(x => { const st = stk[norm(x.material)] || 0; const short = Math.max(0, x.qty - st); return '<tr><td><b>' + esc(x.material) + '</b></td><td>' + esc(x.uom) + '</td><td class="num">' + qtyFmt(x.qty) + '</td><td class="num">' + qtyFmt(st) + '</td><td class="num ' + (short ? 'late-txt' : '') + '">' + (short ? qtyFmt(short) : '—') + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Is order ke articles ka koi BOM nahi mila</td></tr>') + '</table></div>';
      VIEWS.mrs.rows = rows.map(x => [x.material, x.uom, x.qty, stk[norm(x.material)] || 0, Math.max(0, x.qty - (stk[norm(x.material)] || 0))]);
    }
    setMain(h);
  }
};
ACTIONS['mrs-run'] = () => { VIEWS.mrs.sel = $('#mrsOrd').value.trim(); VIEWS.mrs.render(); };
ACTIONS['mrs-csv'] = () => downloadCsv('mrs-' + (VIEWS.mrs.sel || '') + '.csv', [['Material', 'UOM', 'Required', 'In stock', 'Shortfall']].concat(VIEWS.mrs.rows || []));

/* ================= ACCOUNTS ================= */
VIEWS.invoices = {
  mod: 'accounts', render() {
    const edit = can('accounts', 'edit');
    const rows = Store.all('dispatches').filter(d => !d.cancelled).sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    const pend = rows.filter(d => d.payment !== 'Received');
    let h = subTitle('Invoices') + '<div class="kpis">' +
      '<div><b>' + rows.length + '</b><span>Total invoices</span></div>' +
      '<div><b class="' + (pend.length ? 'late-txt' : '') + '">' + pend.length + '</b><span>Payment pending</span></div>' +
      '<div><b>' + rows.filter(d => (d.date || '').startsWith(todayYmd().slice(0, 7))).length + '</b><span>This month</span></div></div>';
    h += '<div class="tbl-wrap"><table><tr><th>Invoice</th><th>Date</th><th>Dispatch</th><th>Order</th><th>Brand</th><th class="num">Qty</th><th>Payment</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(d => { const o = Store.get('orders', d.order_id) || {}; const paid = d.payment === 'Received'; return '<tr><td><b>' + esc(d.invoice_no) + '</b></td><td class="nowrap">' + fmtD(d.date) + '</td><td>' + esc(d.no) + '</td><td><a href="#/order/' + esc(d.order_id) + '">' + esc(o.no || '') + '</a></td><td>' + esc(o.customer_name || '') + '</td><td class="num">' + qtyFmt(d.lines.reduce((s, l) => s + num(l.qty), 0)) + '</td><td><span class="st ' + (paid ? 'Done' : 'Pending') + '">' + (paid ? 'Received' : 'Pending') + '</span></td>' +
        (edit ? '<td class="right">' + (paid ? '' : '<button class="btn sm" data-act="pay-mark" data-id="' + esc(d.id) + '">Mark received</button>') + '</td>' : '') + '</tr>'; }).join('') : '<tr><td colspan="8" class="empty">No invoices yet — dispatch hone par invoice yahan aata hai</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['pay-mark'] = el => { if (!requirePerm('accounts', 'edit')) return; const d = Store.get('dispatches', el.dataset.id); d.payment = 'Received'; d.payment_by = ME.name; d.payment_at = nowIso(); Store.put('dispatches', d); audit('invoice.paid', d.invoice_no, d.no); flash(esc(d.invoice_no) + ' payment received.'); VIEWS.invoices.render(); };

/* ================= OPERATIONS: tickets ================= */
function ticketEscalated(t) { return t.status !== 'Closed' && (t.priority === 'Critical' || (Date.now() - new Date(t.at)) > 48 * 3600000); }
const TKT_UI = { f: 'open', form: false };
VIEWS.tickets = {
  mod: 'tickets', render() {
    const edit = can('tickets', 'edit');
    const rows = Store.all('tickets').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1).filter(t => TKT_UI.f === 'all' || (TKT_UI.f === 'open' ? t.status !== 'Closed' : TKT_UI.f === 'esc' ? ticketEscalated(t) : t.status === 'Closed'));
    let h = subTitle('Tickets') + '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open' }, { v: 'esc', l: 'Escalated' }, { v: 'closed', l: 'Closed' }, { v: 'all', l: 'All' }], TKT_UI.f) + '<span class="grow"></span>' + (edit ? newBtn('Raise ticket', 'tkt-new') : '') + '</div>';
    if (TKT_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px"><div class="row"><label style="flex:2">Subject *<input id="ntSub"></label><label>Department *' + seg('ntDept', ['Purchase', 'Merchant', 'Store', 'Development', 'Production', 'Accounts', 'Dispatch', 'IT'], '') + '</label></div>' +
      '<div class="row" style="margin-top:8px"><label>Priority' + seg('ntPri', ['Low', 'Normal', 'High', 'Critical'], 'Normal') + '</label><label style="flex:1">Detail<input id="ntDet"></label><button class="btn primary" data-act="tkt-save">Raise</button><span id="ntMsg" class="small"></span></div></div>';
    h += '<div class="tbl-wrap"><table><tr><th>Ticket</th><th>Subject</th><th>Dept</th><th>Priority</th><th>Raised by</th><th>Age</th><th>Status</th><th>Last comment</th>' + (edit ? '<th style="min-width:230px"></th>' : '') + '</tr>' +
      (rows.length ? rows.map(t => {
        const esc48 = ticketEscalated(t); const age = Math.floor((Date.now() - new Date(t.at)) / 3600000);
        const last = (t.comments || []).slice(-1)[0];
        return '<tr><td><b>' + esc(t.no) + '</b>' + (esc48 ? ' <span class="late-txt small">ESCALATED</span>' : '') + '</td><td>' + esc(t.subject) + (t.detail ? '<div class="muted small">' + esc(t.detail) + '</div>' : '') + '</td><td>' + esc(t.dept) + '</td><td class="' + (t.priority === 'Critical' ? 'late-txt' : t.priority === 'High' ? '' : 'muted') + '">' + esc(t.priority) + '</td><td>' + esc(t.by) + '</td><td class="nowrap">' + (age < 48 ? age + 'h' : Math.floor(age / 24) + 'd') + '</td>' +
          '<td><span class="st ' + (t.status === 'Closed' ? 'Done' : t.status === 'In Progress' ? 'Pending' : 'Late') + '">' + t.status + '</span></td><td class="small">' + (last ? esc(last.note) + ' <span class="muted">· ' + esc(last.by) + '</span>' : '') + '</td>' +
          (edit ? '<td class="right nowrap">' + (t.status !== 'Closed' ? '<input data-tk-note placeholder="comment" style="width:110px"> <button class="btn sm" data-act="tkt-comment" data-id="' + esc(t.id) + '">Add</button> ' + (t.status === 'Open' ? '<button class="btn sm" data-act="tkt-status" data-id="' + esc(t.id) + '" data-s="In Progress">Start</button> ' : '') + '<button class="btn sm primary" data-act="tkt-status" data-id="' + esc(t.id) + '" data-s="Closed">Close</button>' : '') + '</td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="9" class="empty">No tickets</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'f') { TKT_UI.f = e.detail; VIEWS.tickets.render(); } });
  }
};
ACTIONS['tkt-new'] = () => { TKT_UI.form = !TKT_UI.form; VIEWS.tickets.render(); if (TKT_UI.form) $('#ntSub').focus(); };
ACTIONS['tkt-save'] = () => {
  if (!requirePerm('tickets', 'edit')) return;
  const sub = $('#ntSub').value.trim(); const dept = segVal($('[data-seg="ntDept"]'));
  if (!sub || !dept) { $('#ntMsg').innerHTML = '<span class="late-txt">Subject aur department chahiye.</span>'; return; }
  const t = Store.put('tickets', { id: uid(), no: nextNo('tickets', 'TKT'), at: nowIso(), by: ME.name, dept, priority: segVal($('[data-seg="ntPri"]')) || 'Normal', subject: sub, detail: $('#ntDet').value.trim(), status: 'Open', comments: [] });
  audit('ticket.create', t.no, dept + ' · ' + sub); TKT_UI.form = false; flash(esc(t.no) + ' raised.'); VIEWS.tickets.render();
};
ACTIONS['tkt-comment'] = el => { const note = $('[data-tk-note]', el.closest('tr')).value.trim(); if (!note) return; const t = Store.get('tickets', el.dataset.id); t.comments = t.comments || []; t.comments.push({ at: nowIso(), by: ME.name, note }); Store.put('tickets', t); VIEWS.tickets.render(); };
ACTIONS['tkt-status'] = el => { const t = Store.get('tickets', el.dataset.id); t.status = el.dataset.s; if (el.dataset.s === 'Closed') { t.closed_by = ME.name; t.closed_at = nowIso(); } Store.put('tickets', t); audit('ticket.' + el.dataset.s.toLowerCase().replace(' ', ''), t.no, ''); VIEWS.tickets.render(); };

/* ================= TASK: checklist ================= */
function checklistDueToday(t) {
  if (t.active === false) return false;
  const d = new Date();
  if (t.freq === 'Daily') return !(t.done || {})[todayYmd()];
  if (t.freq === 'Weekly') return d.getDay() === num(t.wday) && !(t.done || {})[todayYmd()];
  return !(t.done || {}).once && (!t.due || t.due <= todayYmd());
}
function myChecklistDue() { return Store.all('checklist').filter(t => isMyDoer(t.doer) && checklistDueToday(t)); }
const CHK_UI = { who: 'mine', form: false };
VIEWS.checklist = {
  mod: 'checklist', render() {
    const edit = can('checklist', 'edit');
    const all = can('tracker', 'edit') || myRole().system;
    if (!all) CHK_UI.who = 'mine';
    let rows = Store.all('checklist').filter(t => t.active !== false);
    if (CHK_UI.who === 'mine') rows = rows.filter(t => isMyDoer(t.doer));
    rows = rows.slice().sort((a, b) => (checklistDueToday(b) ? 1 : 0) - (checklistDueToday(a) ? 1 : 0));
    let h = subTitle('Checklist', 'roz / hafte ke fixed kaam') + '<div class="toolbar">' + (all ? seg('who', [{ v: 'mine', l: 'Mine' }, { v: 'all', l: 'Everyone' }], CHK_UI.who) : '') + '<span class="grow"></span>' + (edit ? newBtn('Add task', 'chk-new') : '') + '</div>';
    if (CHK_UI.form && edit) h += '<div class="panel" style="margin-bottom:12px"><div class="row"><label style="flex:2">Task *<input id="ncTitle"></label><label>Doer *<input id="ncDoer" list="dlDoers2" value="' + esc(ME.doer || '') + '"><datalist id="dlDoers2">' + Array.from(new Set(Store.all('users').map(u => u.doer).filter(Boolean))).map(d => '<option>' + esc(d) + '</option>').join('') + '</datalist></label>' +
      '<label>Repeat' + seg('ncFreq', ['Once', 'Daily', 'Weekly'], 'Daily') + '</label><label>Due / Weekday<input id="ncDue" placeholder="date ya 0-6"></label><button class="btn primary" data-act="chk-save">Add</button><span id="ncMsg" class="small"></span></div></div>';
    h += '<div class="tbl-wrap"><table><tr><th>Task</th><th>Doer</th><th>Repeat</th><th>Today</th><th>Last done</th><th></th></tr>' +
      (rows.length ? rows.map(t => {
        const due = checklistDueToday(t); const doneKeys = Object.keys(t.done || {});
        const lastK = doneKeys.sort().slice(-1)[0];
        const canMark = due && (isMyDoer(t.doer) || can('tracker', 'edit'));
        return '<tr><td>' + esc(t.title) + '</td><td>' + esc(t.doer) + '</td><td>' + esc(t.freq) + (t.freq === 'Weekly' ? ' (' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][num(t.wday)] + ')' : t.freq === 'Once' && t.due ? ' · ' + fmtD(t.due) : '') + '</td>' +
          '<td>' + (due ? '<span class="st Pending">Due</span>' : '<span class="st Done">' + (t.freq === 'Once' && (t.done || {}).once ? 'Done' : 'OK') + '</span>') + '</td><td class="small muted">' + (lastK ? esc(lastK === 'once' ? (t.done.once || '') : lastK + ' · ' + t.done[lastK]) : '—') + '</td>' +
          '<td class="right nowrap">' + (canMark ? '<button class="btn sm primary" data-act="chk-done" data-id="' + esc(t.id) + '">Done</button> ' : '') + (edit && (t.by === ME.name || myRole().system) ? '<button class="btn ghost sm danger" data-act="chk-del" data-id="' + esc(t.id) + '" data-confirm="Delete?">×</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">Checklist khali hai</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'who') { CHK_UI.who = e.detail; VIEWS.checklist.render(); } });
  }
};
ACTIONS['chk-new'] = () => { CHK_UI.form = !CHK_UI.form; VIEWS.checklist.render(); };
ACTIONS['chk-save'] = () => {
  if (!requirePerm('checklist', 'edit')) return;
  const title = $('#ncTitle').value.trim(); const doer = $('#ncDoer').value.trim().toUpperCase(); const freq = segVal($('[data-seg="ncFreq"]')) || 'Daily';
  if (!title || !doer) { $('#ncMsg').innerHTML = '<span class="late-txt">Task aur doer chahiye.</span>'; return; }
  const due = $('#ncDue').value.trim();
  const t = Store.put('checklist', { id: uid(), title, doer, freq, due: freq === 'Once' ? due : '', wday: freq === 'Weekly' ? num(due) : null, done: {}, active: true, by: ME.name });
  audit('checklist.create', title, doer + ' · ' + freq); CHK_UI.form = false; flash('Task added.'); VIEWS.checklist.render(); renderNav();
};
ACTIONS['chk-done'] = el => {
  const t = Store.get('checklist', el.dataset.id); t.done = t.done || {};
  if (t.freq === 'Once') t.done.once = ME.name + ' · ' + todayYmd(); else t.done[todayYmd()] = ME.name;
  Store.put('checklist', t); audit('checklist.done', t.title, ''); VIEWS.checklist.render(); renderNav();
};
ACTIONS['chk-del'] = el => { const t = Store.get('checklist', el.dataset.id); Store.del('checklist', t.id); audit('checklist.delete', t.title, ''); VIEWS.checklist.render(); };

/* ================= Vendors master ================= */
VIEWS.vendors = {
  mod: 'purchase', render() {
    masterView({
      col: 'vendors', mod: 'purchase', title: 'Vendors', view: VIEWS.vendors, sort: 'name', paste: true,
      cols: [{ k: 'name', l: 'Vendor name', ph: 'Vendor name' }, { k: 'gstin', l: 'GSTIN', w: 160, upper: true }, { k: 'address', l: 'Address' }, { k: 'mobile', l: 'Mobile', w: 120 }, { k: 'email', l: 'Email', w: 180 }],
      validate: d => uniq('vendors', 'name', 'Vendor')(d),
      inUse: d => Store.all('purchase_orders').some(p => norm(p.vendor) === norm(d.name)) ? 'Vendor ke POs hain — delete nahi hoga.' : ''
    });
    $('#main').insertAdjacentHTML('beforeend', '<div class="muted small" style="margin-top:8px">PO banane ke liye vendor ka mobile ya email hona zaroori hai.</div>');
  }
};


ACTIONS['rsv-open'] = el => { VIEWS.stock.rsv = VIEWS.stock.rsv === el.dataset.c ? null : el.dataset.c; VIEWS.stock.render(); };
ACTIONS['rsv-save'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const code = el.dataset.c; const jc = $('#rsvJc').value.trim(); const qty = num($('#rsvQty').value);
  if (!jc || !jcBy(jc)) { $('#rsvMsg').innerHTML = '<span class="late-txt">Sahi JC chuno.</span>'; return; }
  if (qty <= 0 || qty > openStockOf(code)) { $('#rsvMsg').innerHTML = '<span class="late-txt">Open stock sirf ' + qtyFmt(openStockOf(code)) + ' hai.</span>'; return; }
  Store.put('rsjw', { id: uid(), jc_no: jc, material: code, qty, by: ME.name, at: nowIso() });
  audit('stock.reserve', jc, code + ' × ' + qtyFmt(qty)); VIEWS.stock.rsv = null; flash(qtyFmt(qty) + ' ' + esc(code) + ' reserve ho gaya ' + esc(jc) + ' ke liye.'); VIEWS.stock.render();
};
