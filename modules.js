/* Nexus 2.0 — department modules: Purchase, Merchant, Store, Development, Production, Accounts, Tickets, Checklist. */
'use strict';

/* ---------- shared helpers ---------- */
function matBy(code) { return Store.all('materials').find(m => norm(m.code) === norm(code) || norm(m.name) === norm(code)); }
const UOMS = ['NOS', 'PAIR', 'PCS', 'PACK', 'BOX', 'ROLL', 'SET', 'DOZ', 'KGS', 'GM', 'MTR', 'CM', 'MM', 'INCH', 'FT', 'YARD', 'DM', 'LTR', 'ML', 'CAN', 'SQFT', 'SQM', 'SHEET'];
const ITEM_CATS = ['Compound', 'Consumable Item', 'Fabric', 'Grinderies', 'Leather', 'Packaging', 'Silicon', 'Sole', 'Synthetic', 'Upper'];
const CAT_PREFIX = { 'compound': 'COM', 'consumable item': 'CON', 'fabric': 'FAB', 'grinderies': 'GRI', 'leather': 'LEA', 'packaging': 'PAC', 'silicon': 'SIL', 'sole': 'SOL', 'synthetic': 'SYN' };
function itemCodeAuto(cat) {
  const p = CAT_PREFIX[norm(cat)] || (cat ? norm(cat).slice(0, 3).toUpperCase() : 'ITM');
  const max = Store.all('materials').reduce((m, x) => x.code && x.code.startsWith(p) ? Math.max(m, parseInt(x.code.slice(p.length), 10) || 0) : m, 0);
  return p + String(max + 1).padStart(4, '0');
}
function jcNo() {
  let max = 0;
  const scan = no => { if (no && String(no).startsWith('ZF-')) max = Math.max(max, parseInt(String(no).slice(3), 10) || 0); };
  Store.all('job_cards').forEach(j => scan(j.no));
  Store.all('orders').forEach(o => (o.lines || []).forEach(l => scan(l.jc_no)));
  return 'ZF-' + String(max + 1).padStart(4, '0');
}
// image -> small JPEG dataURL (800px max) so localStorage/Supabase par bhaari na pade
function readImg(file, cb) {
  if (!file) return cb('');
  const img = new Image(); const fr = new FileReader();
  fr.onload = () => { img.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 800 / Math.max(img.width, img.height)); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); cb(c.toDataURL('image/jpeg', 0.72)); }; img.src = fr.result; };
  fr.readAsDataURL(file);
}
function imgField(id, label, req) { return '<label>' + label + (req ? ' *' : '') + '<input type="file" id="' + id + '" accept="image/*"></label>'; }
function photoThumb(src) { return src ? '<a data-act="img-view" data-src="' + esc(src) + '"><img src="' + esc(src) + '" style="height:26px;border-radius:3px;vertical-align:middle"></a>' : ''; }
ACTIONS['img-view'] = el => { const w = window.open(''); w.document.write('<img src="' + el.dataset.src + '" style="max-width:100%">'); };
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
// Standard letterhead document printer — har report iska use karta hai
function printDoc(o) {
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(o.ref || o.title) + '</title><style>' +
    'body{font:12.5px/1.5 "Segoe UI",system-ui,sans-serif;color:#111;margin:34px}' +
    '.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #16202b;padding-bottom:10px;margin-bottom:14px}' +
    '.hd h1{margin:0;font-size:19px}.hd small{color:#555}.hd .doc{text-align:right}.hd .doc b{font-size:15px;text-transform:uppercase;letter-spacing:.06em}' +
    '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px 26px;margin:10px 0 14px}' +
    '.meta div{padding:2.5px 0;border-bottom:1px dotted #ccc}.meta span{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.04em;display:inline-block;min-width:92px}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #8a8f96;padding:5px 9px;text-align:left}' +
    'th{background:#eef1f5;font-size:11px;text-transform:uppercase;letter-spacing:.04em}td.n,th.n{text-align:right}' +
    'tfoot td{font-weight:700;background:#f6f8fa}.note{color:#555;font-size:11.5px;margin-top:8px}' +
    '.sig{display:flex;justify-content:space-between;margin-top:52px}.sig div{border-top:1px solid #333;padding:4px 26px 0;font-size:11.5px;color:#333}' +
    '@media print{body{margin:12mm}}</style></head><body>' +
    '<div class="hd"><div><h1>' + esc(settings().company || 'Nexus 2.0') + '</h1><small>' + esc(settings().address || '') + (settings().gstin ? ' · GSTIN ' + esc(settings().gstin) : '') + '</small></div>' +
    '<div class="doc"><b>' + esc(o.title) + '</b><br><small>' + esc(o.ref || '') + (o.date ? ' · ' + fmtD(o.date) : '') + '</small></div></div>' +
    (o.meta && o.meta.length ? '<div class="meta">' + o.meta.filter(x => x[1] !== undefined && x[1] !== '').map(x => '<div><span>' + esc(x[0]) + '</span> <b>' + esc(x[1]) + '</b></div>').join('') + '</div>' : '') +
    o.body +
    (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
    '<div class="sig"><div>Prepared By' + (o.by ? ': ' + esc(o.by) : '') + '</div><div>Checked By</div><div>Authorised Signatory</div></div>' +
    '<script>window.print()</' + 'script></body></html>');
  w.document.close();
}
function pTable(heads, rows, foot) {
  return '<table><thead><tr>' + heads.map(h => '<th' + (h[1] === 'n' ? ' class="n"' : '') + '>' + esc(h[0] || h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map((c, i) => '<td' + ((heads[i] && heads[i][1]) === 'n' ? ' class="n"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>' +
    (foot ? '<tfoot><tr>' + foot.map((c, i) => '<td' + ((heads[i] && heads[i][1]) === 'n' ? ' class="n"' : '') + '>' + c + '</td>').join('') + '</tr></tfoot>' : '') + '</table>';
}
ACTIONS['print-jc'] = el => {
  const j = Store.get('job_cards', el.dataset.id); if (!j) return;
  const sizes = (j.sizes || []);
  printDoc({
    title: 'Job Card', ref: j.no, date: j.at, by: j.by,
    meta: [['Order No', j.order_no], ['Brand', j.brand], ['Article', j.article], ['Style', j.style], ['Colour', j.colour], ['Gender', j.gender], ['Category', j.category], ['Order Qty', qtyFmt(j.qty)], ['Swatch', j.swatch_status], ['Status', j.status]],
    body: (j.photo ? '<img src="' + j.photo + '" style="max-height:110px;border:1px solid #ccc;border-radius:4px;margin-bottom:6px">' : '') +
      (sizes.length ? '<h3 style="margin:10px 0 0;font-size:13px">Sizes</h3>' + pTable([['Size'], ['Act. Order', 'n'], ['Extra (2%)', 'n']], sizes.map(x => [esc(x.size), qtyFmt(x.act), qtyFmt(x.extra)]), ['Total', qtyFmt(sizes.reduce((a, x) => a + num(x.act), 0)), qtyFmt(sizes.reduce((a, x) => a + num(x.extra), 0))]) : '') +
      '<h3 style="margin:12px 0 0;font-size:13px">Material Requirements (BOM)</h3>' +
      pTable([['#'], ['Section'], ['Category'], ['Item Name'], ['Code'], ['UOM'], ['Norms', 'n'], ['Req. Qty', 'n'], ['Supplier']],
        (j.lines || []).map((l, i) => [i + 1, esc(l.section || ''), esc(l.category || ''), esc((matBy(l.material) || {}).name || ''), esc(l.material), esc(l.uom), l.norms, qtyFmt(l.required), esc(l.supplier || '')])),
    note: j.remarks ? 'Remarks: ' + j.remarks : ''
  });
};
ACTIONS['print-bom'] = el => {
  const b = Store.get('boms', el.dataset.id); if (!b) return;
  const rmc = b.lines.reduce((a, l) => a + num(l.qty) * num(l.price || 0), 0);
  printDoc({
    title: 'Bill of Materials', ref: b.article + ' · v' + b.version, date: b.at, by: b.by,
    meta: [['Brand', b.brand], ['Article', b.article], ['Style', b.style], ['Colour', b.colour || 'All'], ['Gender', b.gender], ['Category', b.category], ['Size Run', b.size_run], ['Last (Mould No)', b.mould_no]],
    body: (b.photo ? '<img src="' + b.photo + '" style="max-height:110px;border:1px solid #ccc;border-radius:4px;margin-bottom:6px">' : '') +
      pTable([['#'], ['Section'], ['Category'], ['Item Name'], ['Code'], ['UOM'], ['Norms', 'n'], ['Price', 'n'], ['Cost', 'n'], ['Supplier'], ['Remark']],
        b.lines.map((l, i) => [i + 1, esc(l.section || ''), esc(l.category || ''), esc((matBy(l.material) || {}).name || ''), esc(l.material), esc(l.uom), l.qty, money(l.price || 0), money(num(l.qty) * num(l.price || 0)), esc(l.supplier || ''), esc(l.remark || '')]),
        ['', '', '', '', '', '', '', 'Total RMC/Pair', money(rmc), '', '']),
    note: b.remark ? 'Remark: ' + b.remark : ''
  });
};
ACTIONS['print-grn'] = el => {
  const g = Store.get('grns', el.dataset.id); if (!g) return;
  const t = k => g.lines.reduce((a, l) => a + num(l[k] || 0), 0);
  printDoc({
    title: 'Goods Receipt Note', ref: g.no, date: g.date, by: g.by,
    meta: [['Vendor', g.vendor], ['PO Number', g.po_no], ['Invoice No', g.invoice], ['GRN Date', fmtD(g.date)]],
    body: pTable([['#'], ['Item Name'], ['Code'], ['JC'], ['Inv Qty', 'n'], ['GRN Qty', 'n'], ['Reject', 'n'], ['Short', 'n'], ['Excess', 'n'], ['Rack']],
      g.lines.map((l, i) => [i + 1, esc((matBy(l.material) || {}).name || ''), esc(l.material), esc(l.jc_no || ''), qtyFmt(l.inv_qty || 0), qtyFmt(l.accepted), qtyFmt(l.rejected), qtyFmt(l.short || 0), qtyFmt(l.excess || 0), esc(l.rack || '')]),
      ['', 'Total', '', '', qtyFmt(t('inv_qty')), qtyFmt(t('accepted')), qtyFmt(t('rejected')), qtyFmt(t('short')), qtyFmt(t('excess')), '']),
    note: (g.reject_reason ? 'Reject reason: ' + g.reject_reason + '. ' : '') + 'Accepted qty stock mein add ho chuki hai; reject rejection-stock mein hai.'
  });
};
ACTIONS['print-req'] = el => {
  const r = Store.all('requisitions').find(x => x.id === el.dataset.id || norm(x.no) === norm(el.dataset.id)); if (!r) return;
  printDoc({
    title: 'Requisition Slip', ref: r.no, date: r.date, by: r.by,
    meta: [['Job Card', r.jc_no], ['Department', r.dept], ['Requested By', r.by], ['Status', r.status], ['Issued By', r.issued_by || '']],
    body: pTable([['#'], ['Item Name'], ['Code'], ['UOM'], ['Req Qty', 'n'], ['Issued Qty', 'n']],
      r.lines.map((l, i) => { const m = matBy(l.material) || {}; const issued = Store.all('issues').filter(x => x.status === 'Approved' && norm(x.req_no || '') === norm(r.no) && norm(x.material) === norm(l.material)).reduce((a, x) => a + num(x.qty), 0); return [i + 1, esc(m.name || '') + (l.extra ? ' (extra)' : ''), esc(l.material), esc(m.uom || ''), qtyFmt(l.qty), qtyFmt(issued)]; }),
      ['', 'Total', '', '', qtyFmt(r.lines.reduce((a, l) => a + num(l.qty), 0)), ''])
  });
};
ACTIONS['print-iss'] = el => {
  const i = Store.get('issues', el.dataset.id); if (!i) return;
  const m = matBy(i.material) || {};
  printDoc({
    title: i.type === 'return' ? 'Material Return Slip' : 'Material Issuance Report', ref: i.no, date: i.date, by: i.by,
    meta: [['Job Card', i.to_jc || ''], ['Issued To', i.to_dept || ''], ['Issue Type', i.issue_type || 'Regular'], ['Source', i.source || 'AUTO'], ['Requisition', i.req_no || ''], ['Status', i.status || 'Approved'], ['Approved By', i.approved_by || '']],
    body: pTable([['#'], ['Item Name'], ['Code'], ['UOM'], ['Qty', 'n']], [[1, esc(m.name || ''), esc(i.material), esc(m.uom || ''), qtyFmt(i.qty)]], ['', 'Total', '', '', qtyFmt(i.qty)]),
    note: i.remark ? 'Remark: ' + i.remark : ''
  });
};

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
    p.lines.map(l => '<tr><td>' + esc(l.material) + (l.jc_no ? ' <span class="muted small">' + esc(l.jc_no) + '</span>' : '') + (l.remark ? '<div class="muted small">' + esc(l.remark) + '</div>' : '') + '</td><td>' + esc(l.uom) + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + money(l.rate) + (l.gst ? '<div class="muted small">+' + l.gst + '% GST</div>' : '') + '</td><td class="num">' + money(num(l.qty) * num(l.rate) * (1 + num(l.gst || 0) / 100)) + '</td></tr>').join('') +
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
  return '<div class="card"><div class="card-h"><b>New Purchase Order</b><span class="muted small">' + fyNo('purchase_orders', 'PO', 3) + ' · save hote hi approval mein jayega</span></div><div class="card-b">' + dlVendor() + dlMat('dlMatPo') +
    '<div class="row"><label>Mode' + seg('poMode', [{ v: 'jc', l: 'JC requirement se' }, { v: 'manual', l: 'Manual' }], PO_UI.mode || 'jc') + '</label>' +
    '<label>Vendor *<input id="npVen" list="dlVen"></label><label>PO date<input id="npDate" type="date" value="' + todayYmd() + '"></label><label>Expected delivery *<input id="npExp" type="date"></label><label style="flex:1">Remarks<input id="npRem"></label></div>' +
    '<div id="npHint" class="muted small" style="margin:6px 0"></div>' +
    '<table style="margin-top:4px"><tr id="npHead"></tr><tbody id="npLines"></tbody></table><a class="small" data-act="po-line" id="npAdd">+ material</a>' +
    '</div><div class="card-f"><button class="btn primary" data-act="po-save">Save PO</button><button class="btn" data-act="po-new">Close</button><span id="npMsg" class="small"></span></div></div>';
}
function poFormSetup() {
  const mode = PO_UI.mode || 'jc';
  $('#npHead').innerHTML = mode === 'manual'
    ? '<th>Item Name</th><th>Category</th><th>Code</th><th>HSN</th><th>UOM</th><th class="num">Rate</th><th class="num">GST %</th><th>Remark</th><th>Job Card</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Total</th><th></th>'
    : '<th style="width:110px">JC</th><th style="width:180px">Material</th><th class="num">JC pending</th><th class="num">Stock free</th><th class="num">Transit</th><th class="num" style="width:110px">Order qty</th><th class="num" style="width:100px">Rate ₹</th>';
  $('#npAdd').classList.toggle('hidden', mode !== 'manual');
  $('#npLines').innerHTML = mode === 'manual' ? poLineRow() : '';
  const tb = $('#npLines').closest('table');
  if (!$('#npFoot', tb)) tb.insertAdjacentHTML('beforeend', '<tr id="npFoot"></tr>');
  $('#npFoot').innerHTML = '';
  if (!document.getElementById('dlJcPo')) document.body.insertAdjacentHTML('beforeend', '<datalist id="dlJcPo"></datalist>');
  document.getElementById('dlJcPo').innerHTML = Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">').join('');
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
function poLineRow() {
  return '<tr data-mline><td><input data-np="mat" list="dlMatPo" placeholder="Item Name"></td><td class="muted small" data-np-cat></td><td class="muted" data-np-code></td><td class="muted small" data-np-hsn></td><td class="muted" data-uom></td>' +
    '<td><input data-np="rate" type="number" min="0" step="any" class="right" style="width:80px"></td><td><input data-np="gst" type="number" min="0" step="any" class="right" style="width:60px"></td>' +
    '<td><input data-np="rem" style="width:100px"></td><td><input data-np="jc" list="dlJcPo" style="width:90px"></td>' +
    '<td><input data-np="qty" type="number" min="0" step="any" class="right" style="width:80px"></td><td class="num muted" data-np-amt>0</td><td class="num muted" data-np-tot>0</td><td><button class="btn ghost sm" data-act="po-line-del">×</button></td></tr>';
}
function poManualRecalc() {
  let q = 0, amt = 0, net = 0;
  $$('#npLines tr[data-mline]').forEach(tr => { const a2 = num($('[data-np="qty"]', tr).value) * num($('[data-np="rate"]', tr).value); const g = a2 * (1 + num($('[data-np="gst"]', tr).value) / 100); $('[data-np-amt]', tr).textContent = a2 ? money(a2) : '0'; $('[data-np-tot]', tr).textContent = a2 ? money(g) : '0'; q += num($('[data-np="qty"]', tr).value); amt += a2; net += g; });
  const f = $('#npFoot'); if (f) f.innerHTML = '<td><b>Total:</b></td><td colspan="8"></td><td class="num"><b>' + qtyFmt(q) + '</b></td><td class="num"><b>' + money(amt) + '</b></td><td class="num"><b>' + money(net) + '</b></td><td></td>';
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('tr[data-mline]')) poManualRecalc(); });
ACTIONS['po-new'] = () => { PO_UI.form = !PO_UI.form; VIEWS.po.render(); if (PO_UI.form) { poFormSetup(); $('#npVen').focus(); } };
document.addEventListener('change', e => { if (e.target.id === 'npVen' && (PO_UI.mode || 'jc') === 'jc') { const v = vendorBy(e.target.value); if (v) poFillJc(v.name); } });
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.jqty != null) { const tr = e.target.closest('tr'); if (num(e.target.value) > num(tr.dataset.max)) { e.target.value = tr.dataset.max; flash('JC pending se zyada order nahi ho sakta.', 'err'); } } });
ACTIONS['po-line'] = () => { $('#npLines').insertAdjacentHTML('beforeend', poLineRow()); };
ACTIONS['po-line-del'] = el => el.closest('tr').remove();
document.addEventListener('change', e => {
  if (e.target.dataset.np !== 'mat') return;
  const m = Store.all('materials').find(x => norm(x.name) === norm(e.target.value) || norm(x.code) === norm(e.target.value));
  const tr = e.target.closest('tr'); if (!m) return;
  e.target.value = m.name;
  $('[data-np-cat]', tr).textContent = m.group || ''; $('[data-np-code]', tr).textContent = m.code; $('[data-np-hsn]', tr).textContent = m.hsn || ''; $('[data-uom]', tr).textContent = m.uom;
  const r = $('[data-np="rate"]', tr); if (!r.value) r.value = m.price || '';
  const g = $('[data-np="gst"]', tr); if (!g.value && m.gst != null) g.value = m.gst;
  poManualRecalc();
});
ACTIONS['po-save'] = () => {
  if (!requirePerm('purchase', 'edit')) return;
  const ven = $('#npVen').value.trim(); const exp = $('#npExp').value;
  const mode = PO_UI.mode || 'jc';
  const lines = mode === 'manual'
    ? $$('#npLines tr[data-mline]').map(tr => { const m = Store.all('materials').find(x => norm(x.name) === norm($('[data-np="mat"]', tr).value) || norm(x.code) === norm($('[data-np="mat"]', tr).value)); return m ? { material: m.code, uom: m.uom, qty: num($('[data-np="qty"]', tr).value), rate: num($('[data-np="rate"]', tr).value), gst: num($('[data-np="gst"]', tr).value), remark: $('[data-np="rem"]', tr).value.trim(), jc_no: $('[data-np="jc"]', tr).value.trim(), received: 0, rejected: 0 } : null; }).filter(l => l && l.qty > 0)
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
const JC_UI = { f: 'open', form: false, open: null };
let JCF = null;   // job card form state
function jcOrderLine(o, idx) { return (o.lines || [])[idx] || {}; }
function jcBomFor(article, colour) {
  const all = Store.all('boms').filter(x => norm(x.article) === norm(article));
  return all.find(x => colour && norm(x.colour) === norm(colour)) || all.filter(x => !x.colour || true).sort((p, q) => q.version - p.version)[0] || null;
}
VIEWS.jobcards = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const rows = Store.all('job_cards').slice().sort((a2, b2) => b2.no < a2.no ? -1 : 1).filter(j => JC_UI.f === 'all' || (JC_UI.f === 'open' ? j.status !== 'Closed' : j.status === 'Closed'));
    let h = subTitle('Job Card', 'format: ZF-0001') + '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open' }, { v: 'closed', l: 'Closed' }, { v: 'all', l: 'All' }], JC_UI.f) + '<span class="grow"></span>' + (edit ? newBtn('New job card', 'jc-new') : '') + '</div>';
    if (JC_UI.form && edit) h += jcForm();
    h += '<div class="tbl-wrap"><table><tr><th>JC No</th><th>Order</th><th>Brand</th><th>Article / Style</th><th class="num">Qty</th><th>Material</th><th>Swatch</th><th>Corrections</th><th>Status</th><th></th></tr>' +
      (rows.length ? rows.map(j => {
        const oc = (j.corrections || []).filter(x => !x.resolved).length;
        const L = j.lines || []; const req = L.reduce((s2, l) => s2 + num(l.required), 0);
        const iss = L.reduce((s2, l) => s2 + Math.min(num(l.required), issuedToJc(j.no, l.material)), 0);
        const ready = req ? Math.round(iss / req * 100) : null;
        let row = '<tr class="click" data-act="jc-toggle" data-id="' + esc(j.id) + '"><td><b>' + esc(j.no) + '</b><div class="muted small">' + esc(j.by) + ' · ' + fmtD(j.at) + '</div></td><td>' + esc(j.order_no || '') + '</td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + (j.style ? ' · ' + esc(j.style) : '') + (j.colour ? ' <span class="muted">' + esc(j.colour) + '</span>' : '') + '</td><td class="num">' + qtyFmt(j.qty) + '</td>' +
          '<td>' + (ready == null ? '<span class="late-txt small">No BOM</span>' : '<span class="' + (ready >= 100 ? 'st Done' : 'small') + '">' + ready + '% issued</span>') + '</td>' +
          '<td><span class="st ' + (j.swatch_status === 'Approved' ? 'Done' : j.swatch_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(j.swatch_status) + '</span></td><td>' + (oc ? '<span class="late-txt">' + oc + ' open</span>' : (j.corrections || []).length ? 'resolved' : '—') + '</td><td>' + stHtml(j.status === 'Closed' ? 'Done' : 'Pending').replace('>Done<', '>Closed<').replace('>Pending<', '>Open<') + '</td>' +
          '<td class="right">' + (edit && j.status !== 'Closed' ? '<button class="btn sm" data-act="jc-close" data-id="' + esc(j.id) + '" data-confirm="Close JC?">Close</button>' : '') + '</td></tr>';
        if (JC_UI.open === j.id) row += '<tr class="inline-form"><td colspan="10">' + jcDetail(j) + '</td></tr>';
        return row;
      }).join('') : '<tr><td colspan="10" class="empty">No job cards</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => {
      if (e.target.dataset.seg === 'f') { JC_UI.f = e.detail; VIEWS.jobcards.render(); return; }
    });
    if (JC_UI.form) jcFormWire();
  }
};
function jcDetail(j) {
  let h = '';
  if (j.photo) h += '<div style="margin:4px 0">' + photoThumb(j.photo) + '</div>';
  if ((j.sizes || []).length) h += '<table style="max-width:420px;margin:4px 0"><tr><th>SIZE</th><th class="num">Act.Ord</th><th class="num">Extra(2%)</th></tr>' + j.sizes.map(sz => '<tr><td>' + esc(sz.size) + '</td><td class="num">' + qtyFmt(sz.act) + '</td><td class="num">' + qtyFmt(sz.extra) + '</td></tr>').join('') + '<tr><td><b>Total</b></td><td class="num"><b>' + qtyFmt(j.sizes.reduce((s2, x) => s2 + num(x.act), 0)) + '</b></td><td class="num"><b>' + qtyFmt(j.sizes.reduce((s2, x) => s2 + num(x.extra), 0)) + '</b></td></tr></table>';
  const L = j.lines || [];
  h += L.length ? '<table style="max-width:960px;margin:4px 0"><tr><th>Section</th><th>Category</th><th>Item</th><th>Code</th><th>UOM</th><th class="num">Norms</th><th class="num">Req.Qty</th><th>Supplier</th><th class="num">PO raised</th><th class="num">Transit</th><th class="num">Reserved</th><th class="num">Issued</th><th class="num">Pending PO</th></tr>' +
    L.map(l => { const issd = issuedToJc(j.no, l.material); const pen = Math.max(0, num(l.required) - num(l.po_raised)); const m = matBy(l.material) || {}; return '<tr><td class="small">' + esc(l.section || '') + '</td><td class="small">' + esc(l.category || m.group || '') + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(l.uom) + '</td><td class="num">' + l.norms + '</td><td class="num">' + qtyFmt(l.required) + '</td><td class="small">' + esc(l.supplier || '') + '</td><td class="num">' + qtyFmt(l.po_raised) + '</td><td class="num muted">' + qtyFmt(transitOf(l.material)) + '</td><td class="num">' + qtyFmt(reservedOf(l.material, j.no)) + '</td><td class="num">' + qtyFmt(issd) + '</td><td class="num ' + (pen ? 'late-txt' : '') + '">' + (pen ? qtyFmt(pen) : '—') + '</td></tr>'; }).join('') + '</table>'
    : '<span class="muted small">BOM nahi mila tha — Development se BOM banwa ke JC dobara banao.</span>';
  if (j.remarks) h += '<div class="small"><b>Remarks:</b> ' + esc(j.remarks) + '</div>';
  h += '<div class="toolbar noprint" style="margin:8px 0 2px"><button class="btn sm" data-act="print-jc" data-id="' + esc(j.id) + '">Print Job Card</button></div>';
  return h;
}
function jcForm() {
  const orders = Store.all('orders').filter(o => orderState(o).open);
  return '<div class="card"><div class="card-h"><b>New Job Card</b><span class="muted small">' + jcNo() + ' · order chuno, sizes check karo, BOM auto aayega</span></div><div class="card-b"><datalist id="dlOrdJc">' + orders.map(o => '<option value="' + esc(o.no) + '">' + esc(o.customer_name) + '</option>').join('') + '</datalist>' +
    '<div class="row"><label>Order *<input id="jfOrd" list="dlOrdJc" placeholder="Select order..."></label><label>Article line *<select id="jfLine" disabled><option value="">—</option></select></label><label>JC No <span class="muted small">(order se auto)</span><input id="jfNo" value="" readonly style="width:100px"></label></div>' +
    '<div class="grid2" style="margin-top:10px"><div><h2 style="margin-top:0">Order details</h2><table class="kv" id="jfDetails"><tr><td class="muted">Pehle order aur article chuno</td></tr></table>' +
    '<div class="row" style="margin-top:8px">' + imgField('jfPhoto', 'Product Image') + '<span id="jfPhotoTag" class="muted small"></span></div></div>' +
    '<div><h2 style="margin-top:0">Sizes</h2><table id="jfSizes" style="max-width:420px"><tr><th>SIZE</th><th class="num">Act.Ord</th><th class="num">Extra(2%)</th><th></th></tr><tr id="jfSzTotal"><td><b>Total</b></td><td class="num"><b id="jfActT">0</b></td><td class="num"><b id="jfExtT">0</b></td><td></td></tr></table>' +
    '<a class="small" data-act="jcf-size">+ size row</a> <span id="jfSzMsg" class="small"></span>' +
    '<div class="row" style="margin-top:8px"><label>Status' + seg('jfStatus', ['NA', 'ONLINE', 'OFFLINE'], 'NA') + '</label><label style="flex:1">Remarks<input id="jfRem" placeholder="Remarks..."></label></div></div></div>' +
    '<h2>Material Requirements BOM</h2><div class="toolbar"><a class="small" data-act="jcf-bomrow">+ Add</a><a class="small" data-act="jcf-paste">Bulk Paste</a><span id="jfBomTag" class="muted small"></span></div>' +
    '<div id="jfPasteBox" class="hidden" style="margin-bottom:6px"><textarea id="jfPaste" rows="4" class="mono" placeholder="Ek line par ek item name (ya Name[TAB]Norms[TAB]Supplier)"></textarea> <button class="btn sm" data-act="jcf-paste-go">Import</button></div>' +
    dlMat('dlMatJc') + dlVendor() +
    '<div class="tbl-wrap"><table id="jfBom"><tr><th>#</th><th style="width:120px">Section</th><th style="width:130px">Category</th><th>Item Name</th><th style="width:90px">Item Code</th><th style="width:60px">Uom</th><th class="num" style="width:80px">Stock</th><th class="num" style="width:90px">Norms</th><th class="num" style="width:90px">Req.Qty</th><th style="width:150px">Supplier</th><th style="width:30px"></th></tr></table></div>' +
    '</div><div class="card-f"><button class="btn primary" data-save data-act="jc-save">Submit Job Card</button><button class="btn" data-act="jc-new">Close</button><span id="njMsg" class="small"></span></div></div>';
}
function jcfSizeRow(size, act) {
  return '<tr data-szrow><td><input data-sz="size" placeholder="Size" value="' + esc(size || '') + '" style="width:90px"></td><td><input data-sz="act" type="number" min="0" class="right" value="' + esc(act || '') + '" style="width:90px"></td><td class="num" data-sz-ext>0</td><td><button class="btn ghost sm" data-act="jcf-size-del">×</button></td></tr>';
}
function jcfBomRow(l) {
  l = l || {}; const m = matBy(l.material) || {};
  return '<tr data-bomrow><td class="muted" data-idx></td><td><input data-b="section" value="' + esc(l.section || '') + '"></td><td><input data-b="category" list="dlCatJc" value="' + esc(l.category || m.group || '') + '"></td>' +
    '<td><input data-b="mat" list="dlMatJc" value="' + esc(m.name || l.material || '') + '"></td><td class="muted" data-b-code>' + esc(l.material || '') + '</td><td class="muted" data-b-uom>' + esc(l.uom || m.uom || '') + '</td><td class="num muted" data-b-stock>' + (l.material ? qtyFmt(stockOf(l.material)) : '') + '</td>' +
    '<td><input data-b="norms" type="number" min="0" step="any" class="right" value="' + esc(l.norms || l.qty || '') + '"></td><td class="num" data-b-req>0</td><td><input data-b="supplier" list="dlVen" value="' + esc(l.supplier || '') + '"></td><td><button class="btn ghost sm" data-act="jcf-bom-del">×</button></td></tr>';
}
function jcfRecalc() {
  let act = 0, ext = 0;
  $$('#jfSizes tr[data-szrow]').forEach(tr => { const a2 = num($('[data-sz="act"]', tr).value); const e2 = Math.ceil(a2 * 1.02); $('[data-sz-ext]', tr).textContent = a2 ? qtyFmt(e2) : '0'; act += a2; ext += a2 ? e2 : 0; });
  $('#jfActT').textContent = qtyFmt(act); $('#jfExtT').textContent = qtyFmt(ext);
  const o = Store.all('orders').find(x => norm(x.no) === norm(($('#jfOrd') || {}).value || ''));
  const li = num(($('#jfLine') || {}).value); const oq = o ? num(jcOrderLine(o, li).qty) : 0;
  $('#jfSzMsg').innerHTML = oq && act !== oq ? '<span class="late-txt">Act total ' + qtyFmt(act) + ' ≠ order qty ' + qtyFmt(oq) + '</span>' : (oq ? '<span class="st Done">Act = order qty</span>' : '');
  $$('#jfBom tr[data-bomrow]').forEach((tr, i2) => {
    $('[data-idx]', tr).textContent = i2 + 1;
    const n = num($('[data-b="norms"]', tr).value);
    $('[data-b-req]', tr).textContent = n && ext ? qtyFmt(Math.ceil(n * ext * 1000) / 1000) : '0';
  });
  return { act, ext };
}
function jcFormWire() {
  const m = $('#main');
  m.insertAdjacentHTML('beforeend', '<datalist id="dlCatJc">' + ITEM_CATS.map(c => '<option>' + c + '</option>').join('') + '</datalist>');
  m.addEventListener('input', e => { if (e.target.closest('#jfSizes') || e.target.closest('#jfBom')) jcfRecalc(); });
  m.addEventListener('change', e => {
    if (e.target.id === 'jfOrd') {
      const o = Store.all('orders').find(x => norm(x.no) === norm(e.target.value)); const sel = $('#jfLine');
      if (o && sel.dataset.ord === o.no) return;   // same order dobara fire hua — selection mat udao
      sel.dataset.ord = o ? o.no : '';
      sel.disabled = !o; sel.innerHTML = '<option value="">—</option>' + (o ? o.lines.map((l, i2) => '<option value="' + i2 + '">' + esc(l.article + ' · ' + (l.colour || '') + ' · ' + qtyFmt(l.qty)) + '</option>').join('') : '');
      if (o && o.lines.length === 1) { sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    if (e.target.id === 'jfLine') jcfFillFromOrder();
    if (e.target.id === 'jfPhoto') readImg(e.target.files[0], src => { JCF.photo = src; $('#jfPhotoTag').innerHTML = photoThumb(src); });
    if (e.target.dataset.b === 'mat') {
      const mt = matBy(e.target.value); const tr = e.target.closest('tr');
      if (mt) { e.target.value = mt.name; $('[data-b-code]', tr).textContent = mt.code; $('[data-b-uom]', tr).textContent = mt.uom; $('[data-b-stock]', tr).textContent = qtyFmt(stockOf(mt.code)); const c = $('[data-b="category"]', tr); if (!c.value) c.value = mt.group || ''; }
      else { $('[data-b-code]', tr).textContent = ''; $('[data-b-uom]', tr).textContent = ''; }
      jcfRecalc();
    }
  });
  JCF = { photo: '' };
}
function jcfFillFromOrder() {
  const o = Store.all('orders').find(x => norm(x.no) === norm($('#jfOrd').value)); if (!o) return;
  const li = num($('#jfLine').value); const l = jcOrderLine(o, li);
  if ($('#jfNo')) $('#jfNo').value = l.jc_no || jcNo();
  $('#jfDetails').innerHTML = [['Date', fmtD(o.order_date)], ['Brand', o.customer_name], ['Style', l.style], ['Colour', l.colour], ['Gender', l.gender], ['Category', o.category], ['Tooling', o.tooling_no], ['Article', l.article], ['Size Run', l.size], ['Order Qty', qtyFmt(l.qty)]]
    .map(([k, v]) => '<tr><td class="muted" style="width:90px">' + k + '</td><td>' + esc(v || '') + '</td></tr>').join('');
  // size rows: order line ke size-wise breakup se prefill (fallback: single row)
  $$('#jfSizes tr[data-szrow]').forEach(tr => tr.remove());
  if (l.sizes && l.sizes.length) l.sizes.forEach(sz => $('#jfSzTotal').insertAdjacentHTML('beforebegin', jcfSizeRow(sz.size, sz.qty)));
  else $('#jfSzTotal').insertAdjacentHTML('beforebegin', jcfSizeRow(l.size || '', l.qty || ''));
  // BOM auto-load
  const b = jcBomFor(l.article, l.colour);
  $$('#jfBom tr[data-bomrow]').forEach(tr => tr.remove());
  if (b) { b.lines.forEach(x => $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow(x))); $('#jfBomTag').textContent = 'BOM se auto-load (' + b.article + (b.colour ? ' ' + b.colour : '') + ' v' + b.version + ', ' + b.lines.length + ' items)'; if (b.photo && !JCF.photo) { JCF.photo = b.photo; $('#jfPhotoTag').innerHTML = photoThumb(b.photo) + ' <span class="muted small">BOM se auto</span>'; } }
  else { $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow()); $('#jfBomTag').innerHTML = '<span class="late-txt">Is article ka Dev BOM nahi hai — rows khud bharo ya Development se banwao.</span>'; }
  jcfRecalc();
}
ACTIONS['jcf-size'] = () => { $('#jfSzTotal').insertAdjacentHTML('beforebegin', jcfSizeRow()); };
ACTIONS['jcf-size-del'] = el => { el.closest('tr').remove(); jcfRecalc(); };
ACTIONS['jcf-bomrow'] = () => { $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow()); jcfRecalc(); };
ACTIONS['jcf-bom-del'] = el => { el.closest('tr').remove(); jcfRecalc(); };
ACTIONS['jcf-paste'] = () => $('#jfPasteBox').classList.toggle('hidden');
ACTIONS['jcf-paste-go'] = () => {
  let ok = 0, bad = [];
  $('#jfPaste').value.split(/\r?\n/).map(x => x.split('\t')).filter(r => r.join('').trim()).forEach(r => {
    const m = Store.all('materials').find(x => norm(x.name) === norm(r[0]) || norm(x.code) === norm(r[0]));
    if (!m) { bad.push(r[0]); return; }
    $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow({ material: m.code, uom: m.uom, norms: r[1] || '', supplier: r[2] || '' })); ok++;
  });
  $('#jfPasteBox').classList.add('hidden'); jcfRecalc();
  flash(ok + ' items import hue.' + (bad.length ? ' Match nahi hue: ' + esc(bad.join(', ')) : ''), bad.length ? 'err' : '');
};
ACTIONS['jc-new'] = () => { JC_UI.form = !JC_UI.form; VIEWS.jobcards.render(); };
ACTIONS['jc-toggle'] = (el, ev) => { if (ev.target.closest('button')) return; JC_UI.open = JC_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.jobcards.render(); };
ACTIONS['jc-save'] = () => {
  if (!requirePerm('merchant', 'edit')) return;
  const o = Store.all('orders').find(x => norm(x.no) === norm($('#jfOrd').value));
  if (!o || $('#jfLine').value === '') { $('#njMsg').innerHTML = '<span class="late-txt">Order aur article line chuno.</span>'; return; }
  const l = jcOrderLine(o, num($('#jfLine').value));
  const { act, ext } = jcfRecalc();
  if (act !== num(l.qty)) { $('#njMsg').innerHTML = '<span class="late-txt">Act.Ord total (' + qtyFmt(act) + ') order qty (' + qtyFmt(l.qty) + ') ke barabar hona chahiye.</span>'; return; }
  const sizes = $$('#jfSizes tr[data-szrow]').map(tr => ({ size: $('[data-sz="size"]', tr).value.trim().toUpperCase(), act: num($('[data-sz="act"]', tr).value), extra: Math.ceil(num($('[data-sz="act"]', tr).value) * 1.02) })).filter(x => x.act > 0);
  const lines = $$('#jfBom tr[data-bomrow]').map(tr => {
    const m = matBy($('[data-b="mat"]', tr).value); const n = num($('[data-b="norms"]', tr).value);
    return m && n > 0 ? { section: $('[data-b="section"]', tr).value.trim(), category: $('[data-b="category"]', tr).value.trim() || m.group || '', material: m.code, uom: m.uom, norms: n, required: Math.ceil(n * ext * 1000) / 1000, supplier: $('[data-b="supplier"]', tr).value.trim(), po_raised: 0 } : null;
  }).filter(Boolean);
  const badNorm = $$('#jfBom tr[data-bomrow]').some(tr => matBy($('[data-b="mat"]', tr).value) && num($('[data-b="norms"]', tr).value) <= 0);
  if (badNorm) { $('#njMsg').innerHTML = '<span class="late-txt">Har item ka Norms 0 se zyada hona chahiye.</span>'; return; }
  if (!lines.length) { $('#njMsg').innerHTML = '<span class="late-txt">Kam se kam ek BOM item chahiye (master wala).</span>'; return; }
  const wantNo = (($('#jfNo') || {}).value || l.jc_no || '').trim();
  const useNo = wantNo && !Store.all('job_cards').some(x => norm(x.no) === norm(wantNo)) ? wantNo : jcNo();
  const j = Store.put('job_cards', {
    id: uid(), no: useNo, order_no: o.no, brand: o.customer_name, article: l.article, style: l.style || '', colour: l.colour || '', gender: l.gender || '', category: o.category,
    qty: act, sizes, lines, photo: JCF.photo || '', line_status: segVal($('[data-seg="jfStatus"]')) || 'NA', remarks: $('#jfRem').value.trim(),
    swatch_status: 'Pending', status: 'Open', corrections: [], by: ME.name, at: nowIso()
  });
  audit('jc.create', j.no, o.no + ' · ' + l.article + ' × ' + act + ' · ' + lines.length + ' materials');
  JC_UI.form = false; JCF = null;
  flash(esc(j.no) + ' created — material requirement ban gayi (' + lines.length + ' items, extra +2%). Swatch approval pending.');
  VIEWS.jobcards.render();
};
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
const BILL_TYPES = [
  { v: 'Invoice', l: 'Invoice (PO ke against, accounts me)' },
  { v: 'Challan', l: 'Challan (PO ke against, accounts me)' },
  { v: 'FOC', l: 'FOC / Free of Cost (sirf stock, accounts me nahi)' },
  { v: 'Sample', l: 'Sample (PO ke bina, sirf stock, accounts me)' }
];
VIEWS.inward = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const rows = Store.all('inwards').slice().sort((a2, b2) => b2.no < a2.no ? -1 : 1);
    let h = subTitle('NEW GATE ENTRY', 'inwarding — GRN alag hota hai') + '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New gate entry', 'inw-new') : '') + '</div>';
    if (INW_UI.form && edit) {
      const bt = INW_UI.bt || 'Invoice'; const isFoc = bt === 'FOC', isSample = bt === 'Sample';
      h += '<div class="card"><div class="card-h"><b>New Gate Entry</b><span class="muted small">material factory mein aaya — pehla step</span></div><div class="card-b">' + dlVendor() + dlMat('dlMatI') +
        '<div class="toolbar" style="margin-bottom:14px">' + seg('inwBt', BILL_TYPES, bt) + '</div>' +
        '<div class="row" style="margin-top:8px"><label>Vendor Name *<input id="niVen" list="dlVen"></label>' +
        (isSample ? '<label>Concern Person *<input id="niPerson" list="dlUsers"><datalist id="dlUsers">' + Store.all('users').map(u => '<option value="' + esc(u.name) + '">').join('') + '</datalist></label>'
          : '<label>PO Number *<input id="niPo" list="dlPoNo"><datalist id="dlPoNo">' + openPOs().map(p => '<option value="' + esc(p.no) + '">' + esc(p.vendor) + '</option>').join('') + '</datalist></label>') +
        '<label>' + bt + ' Number' + (isFoc ? '' : ' *') + '<input id="niNum" placeholder="' + (isFoc ? '(optional)' : bt.toUpperCase() + '-XXXX') + '"></label>' +
        '<label>' + bt + ' Date' + (isFoc ? '' : ' *') + '<input id="niBillDate" type="date"></label>' +
        '<label>Inwarding Date *<input id="niDate" type="date" value="' + todayYmd() + '"></label></div>' +
        '<div class="row" style="margin-top:8px"><label>Material *<input id="niMat" list="dlMatI"></label><label>Invoice Qty *<input id="niQty" type="number" min="0" style="width:100px"></label>' +
        '<label>QC Report Number (If Any)<input id="niQc"></label>' + imgField('niPhoto', 'Attach ' + bt + ' Photo', !isFoc) + '<span id="niPhotoTag"></span>' + imgField('niQcPhoto', 'Attach QC Report Photo') + '<span id="niQcTag"></span>' +
        '<label style="flex:1">Remark<input id="niRem"></label><button class="btn primary" data-act="inw-save">Save</button><span id="niMsg" class="small"></span></div>' +
        '</div><div class="card-f"><span class="muted small">Inward By: ' + esc(ME.name) + ' (auto)</span></div></div>';
    }
    h += '<h2>PREVIOUS GATE ENTRY LOGS</h2><div class="tbl-wrap"><table><tr><th>Timestamp</th><th>Bill</th><th>Vendor</th><th>PO Number</th><th>Invoice No</th><th>Invoice Date</th><th class="num">Aging (Days)</th><th>Material</th><th class="num">Invoice Qty</th><th>Photo</th><th>Swatch match</th><th>Remark</th></tr>' +
      (rows.length ? rows.map(i => '<tr><td class="nowrap">' + fmtD(i.date) + '</td><td>' + esc(i.bill_type || 'Invoice') + '</td><td>' + esc(i.vendor) + '</td><td>' + esc(i.po_no || (i.bill_type === 'Sample' ? 'SAMPLE: ' + (i.person || '') : '')) + '</td><td>' + esc(i.bill_no || '') + '</td><td class="nowrap">' + fmtD(i.bill_date) + '</td><td class="num">' + Math.max(0, Math.floor((Date.now() - new Date(i.date)) / 86400000)) + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + photoThumb(i.photo) + '</td><td><span class="st ' + (i.swatch_match === 'Pass' ? 'Done' : i.swatch_match === 'Fail' ? 'Late' : 'Pending') + '">' + (i.swatch_match || 'Pending') + '</span></td><td class="small">' + esc(i.remark || '') + '</td></tr>').join('') : '<tr><td colspan="12" class="empty">No gate entries</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'inwBt') { INW_UI.bt = e.detail; VIEWS.inward.render(); } });
    const m = $('#main');
    m.addEventListener('change', e => {
      if (e.target.id === 'niPhoto') readImg(e.target.files[0], src => { INW_UI.photo = src; $('#niPhotoTag').innerHTML = photoThumb(src); });
      if (e.target.id === 'niQcPhoto') readImg(e.target.files[0], src => { INW_UI.qcPhoto = src; $('#niQcTag').innerHTML = photoThumb(src); });
    });
  }
};
ACTIONS['inw-new'] = () => { INW_UI.form = !INW_UI.form; INW_UI.photo = ''; INW_UI.qcPhoto = ''; VIEWS.inward.render(); };
ACTIONS['inw-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const bt = INW_UI.bt || 'Invoice'; const isFoc = bt === 'FOC', isSample = bt === 'Sample';
  const ven = $('#niVen').value.trim(); const m = matBy($('#niMat').value); const qty = num($('#niQty').value);
  const billNo = $('#niNum').value.trim(); const billDate = $('#niBillDate').value; const po = isSample ? '' : ($('#niPo') ? $('#niPo').value.trim() : '');
  const err = !ven ? 'Vendor chahiye.' : !m ? 'Material (master wala) chahiye.' : qty <= 0 ? 'Invoice qty chahiye.'
    : (!isSample && !po) ? 'PO Number chahiye.' : (isSample && !$('#niPerson').value.trim()) ? 'Concern Person chahiye.'
    : (!isFoc && !billNo) ? bt + ' Number chahiye.' : (!isFoc && !billDate) ? bt + ' Date chahiye.'
    : (!isFoc && !INW_UI.photo) ? bt + ' photo attach karo.' : '';
  if (err) { $('#niMsg').innerHTML = '<span class="late-txt">' + esc(err) + '</span>'; return; }
  if (billNo && Store.all('inwards').some(x => norm(x.vendor) === norm(ven) && norm(x.bill_no) === norm(billNo))) { $('#niMsg').innerHTML = '<span class="late-txt">Is vendor ki ye ' + bt + ' number pehle entry ho chuki hai (duplicate guard).</span>'; return; }
  const i = Store.put('inwards', { id: uid(), no: nextNo('inwards', 'INW'), date: $('#niDate').value || todayYmd(), bill_type: bt, vendor: ven, po_no: po, person: isSample ? $('#niPerson').value.trim() : '', bill_no: billNo, bill_date: billDate, material: m.code, uom: m.uom, qty, qc_no: $('#niQc').value.trim(), photo: INW_UI.photo || '', qc_photo: INW_UI.qcPhoto || '', remark: $('#niRem').value.trim(), swatch_match: '', by: ME.name });
  audit('inward.create', i.no, bt + ' · ' + ven + ' · ' + m.code + ' × ' + qty); INW_UI.form = false;
  flash(esc(i.no) + ' saved — swatch matching pending.'); VIEWS.inward.render();
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
        if (GRN_UI.open === p.id) row += '<tr class="inline-form"><td colspan="5"><table style="max-width:880px;margin:6px 0"><tr><th>Material</th><th>JC</th><th class="num">PO Pending</th><th class="num">JC Qty</th><th class="num">Inv Qty</th><th class="num">GRN Qty</th><th class="num">Reject</th><th class="num">Short</th><th class="num">Excess</th><th>Rack</th></tr>' +
          p.lines.map((l, i) => { const pen = Math.max(0, num(l.qty) - num(l.received)); const mt = matBy(l.material) || {}; const jq = l.jc_no ? (((jcBy(l.jc_no) || {}).lines || []).find(x => norm(x.material) === norm(l.material)) || {}).required : ''; return '<tr data-i="' + i + '" data-pen="' + pen + '"><td>' + esc(l.material) + '</td><td class="small">' + esc(l.jc_no || '') + '</td><td class="num">' + qtyFmt(pen) + '</td><td class="num muted">' + (jq ? qtyFmt(jq) : '—') + '</td><td><input class="qty" type="number" min="0" step="any" data-gi value="' + (pen || '') + '"' + (pen ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-ga value="' + (pen || '') + '"' + (pen ? '' : ' disabled') + '></td><td><input class="qty" type="number" min="0" step="any" data-gr value="0"' + (pen ? '' : ' disabled') + '></td><td class="num muted" data-gs>—</td><td class="num muted" data-gx>—</td><td><input data-grack value="' + esc(mt.rack || '') + '" style="width:60px"></td></tr>'; }).join('') +
          '</table><div class="row"><label>Invoice / challan no *<input id="grnInv" list="dlGrnInv"><datalist id="dlGrnInv">' + Store.all('inwards').filter(iw => norm(iw.vendor) === norm(p.vendor) && iw.bill_no && iw.swatch_match !== 'Fail').map(iw => '<option value="' + esc(iw.bill_no) + '">' + esc(iw.no) + '</option>').join('') + '</datalist></label><label>Date<input id="grnDate" type="date" value="' + todayYmd() + '"></label><button class="btn primary" data-act="grn-save" data-id="' + esc(p.id) + '">Save GRN</button><span id="grnMsg" class="small"></span></div><div class="row" id="grnWhyBox" style="display:none;margin-top:4px"><label style="flex:1">Reject reason *<input id="grnWhy"></label></div><div class="muted small" style="margin-top:4px">Accept = stock · Reject = rejection stock (RTV) · <b>Short</b> = invoice mein hai par aaya nahi (Debit Note auto-task) · <b>Excess</b> = PO pending se zyada bill hua</div></td></tr>';
        return row;
      }).join('') : '<tr><td colspan="5" class="empty">Koi open PO nahi — pehle Purchase Order banao</td></tr>') + '</table></div>';
    const gs = Store.all('grns').slice().sort((a, b) => b.no < a.no ? -1 : 1).slice(0, 15);
    h += '<h2>Recent GRNs</h2><div class="tbl-wrap"><table><tr><th>GRN</th><th>Date</th><th>PO</th><th>Vendor</th><th class="num">Accepted</th><th class="num">Rej + Short</th><th>By</th><th></th></tr>' +
      (gs.length ? gs.map(g => '<tr><td><b>' + esc(g.no) + '</b></td><td class="nowrap">' + fmtD(g.date) + '</td><td>' + esc(g.po_no) + '</td><td>' + esc(g.vendor) + '</td><td class="num">' + qtyFmt(g.lines.reduce((s, l) => s + num(l.accepted), 0)) + '</td><td class="num late-txt">' + qtyFmt(g.lines.reduce((s, l) => s + num(l.rejected) + num(l.short || 0), 0)) + '</td><td>' + esc(g.by) + '</td><td class="right"><button class="btn sm ghost" data-act="print-grn" data-id="' + esc(g.id) + '">Print</button></td></tr>').join('') : '<tr><td colspan="8" class="empty">No GRNs yet</td></tr>') + '</table></div>';
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
document.addEventListener('input', e => { const tr = e.target.closest('tr[data-pen]'); if (tr && (e.target.dataset.gi != null || e.target.dataset.ga != null || e.target.dataset.gr != null)) { grnCalcRow(tr); const anyRej = $$('tr[data-pen]').some(t => num(($('[data-gr]', t) || {}).value) > 0); const box = $('#grnWhyBox'); if (box) box.style.display = anyRej ? '' : 'none'; } });
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
  const totRejPre = rows.reduce((x, r) => x + r.rej, 0);
  const why = ($('#grnWhy') || { value: '' }).value.trim();
  if (totRejPre > 0 && !why) { $('#grnMsg').innerHTML = '<span class="late-txt">Reject reason likhna zaroori hai.</span>'; return; }
  if (Store.all('grns').some(g => norm(g.vendor) === norm(p.vendor) && norm(g.invoice) === norm(inv))) { $('#grnMsg').innerHTML = '<span class="late-txt">Is vendor ki ye invoice pehle GRN ho chuki hai (duplicate guard).</span>'; return; }
  const failedInward = Store.all('inwards').find(iw => norm(iw.vendor) === norm(p.vendor) && norm(iw.po_no) === norm(p.no) && iw.swatch_match === 'Fail');
  if (failedInward) { $('#grnMsg').innerHTML = '<span class="late-txt">' + esc(failedInward.no) + ' ka swatch FAIL hai — Merchant se sort hone tak is PO ki GRN block hai.</span>'; return; }
  rows.forEach(r => { const pl = p.lines[r.i]; pl.received = num(pl.received) + r.acc + r.rej; pl.rejected = num(pl.rejected) + r.rej; });
  Store.put('purchase_orders', p);
  const lines = rows.map(r => { const tr = $$('tr[data-pen]')[r.i] || $$('tr[data-pen]').find(t => +t.dataset.i === r.i); return { material: r.material, jc_no: p.lines[r.i].jc_no || '', inv_qty: r.inv, accepted: r.acc, rejected: r.rej, short: r.short, excess: r.excess, rack: tr ? ($('[data-grack]', tr) || { value: '' }).value.trim() : '' }; });
  const g = Store.put('grns', { id: uid(), no: fyNo('grns', 'GRN', 4), date: $('#grnDate').value || todayYmd(), po_id: p.id, po_no: p.no, vendor: p.vendor, invoice: inv, reject_reason: why, lines, by: ME.name });
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
      '<div class="row"><label>Material *<input id="isMat" list="dlMatIs"></label><label>Issue Qty *<input id="isQty" type="number" min="0" style="width:100px"></label><label>Job Card<input id="isJc" list="dlJc2"></label>' +
      '<label>Issued To * <span class="muted small">(Person / Department)</span><input id="isTo" list="dlDept"><datalist id="dlDept">' + ['Production', 'Development', 'Merchant', 'Dispatch'].map(d => '<option>' + d + '</option>').join('') + '</datalist></label>' +
      '<label>Issue Type' + seg('isTyp', ['Regular', 'Sample'], 'Regular') + '</label>' +
      '<label>Issue Source' + seg('isSrc', [{ v: 'AUTO', l: 'Auto (reserved→open)' }, { v: 'RSJW', l: 'RESERVED STOCK' }, { v: 'OPEN', l: 'OPEN STOCK' }], 'AUTO') + '</label><button class="btn primary" data-act="iss-save">Request issue</button><span id="isMsg" class="small"></span></div></div>';
    if (ISS_UI.ret && edit) h += '<div class="panel" style="margin-bottom:10px">' + dlMat('dlMatRt') + '<datalist id="dlJc3">' + Store.all('job_cards').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist>' +
      '<div class="row"><label>Job Card *<input id="rtJc" list="dlJc3"></label><label>Material *<input id="rtMat" list="dlMatRt"></label><label>Return Qty *<input id="rtQty" type="number" min="0" style="width:100px"></label><label>Returned By *<input id="rtBy" value="' + esc(ME.name) + '"></label><label style="flex:1">Remark <span class="muted small">(Optional)</span><input id="rtRem"></label><button class="btn primary" data-act="ret-save">Return to stock</button><span id="rtMsg" class="small"></span></div>' +
      '<div class="muted small">Wapas open stock mein jayega. Issued se zyada return nahi ho sakta.</div></div>';

    // 4) history
    const iss = Store.all('issues').filter(i => i.status !== 'Pending').slice().sort((a2, b2) => (b2.at || '') < (a2.at || '') ? -1 : 1).slice(0, 15);
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>DATE</th><th>TYPE</th><th>ITEM</th><th class="num">QUANTITY</th><th>SOURCE TYPE</th><th>JOB CARD</th><th>ISSUED TO</th><th>ISSUE TYPE</th><th>REQ</th><th>STATUS</th><th>ISSUED BY</th><th></th></tr>' +
      (iss.length ? iss.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + (i.type === 'return' ? 'Return' : 'Issue') + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(i.source || 'AUTO') + '</td><td>' + esc(i.to_jc || '') + '</td><td>' + esc(i.to_dept || '') + '</td><td>' + esc(i.issue_type || 'Regular') + '</td><td>' + esc(i.req_no || '') + '</td><td><span class="st ' + (i.status === 'Approved' ? 'Done' : 'Cancelled') + '">' + esc(i.status || 'Approved') + '</span></td><td class="small">' + esc(i.by) + (i.approved_by ? ' → ' + esc(i.approved_by) : '') + '</td><td class="right"><button class="btn sm ghost" data-act="print-iss" data-id="' + esc(i.id) + '">Print</button></td></tr>').join('') : '<tr><td colspan="13" class="empty">No issues yet</td></tr>') + '</table></div>';
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
  const to = $('#isTo').value.trim();
  if (!to) { $('#isMsg').innerHTML = '<span class="late-txt">Issued To (person/department) chahiye.</span>'; return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), material: m.code, qty, source: src, to_jc: segVal($('[data-seg="isTyp"]')) === 'Sample' ? 'SAMPLE' : jc, to_dept: to, issue_type: segVal($('[data-seg="isTyp"]')) || 'Regular', status: 'Pending', by: ME.name, at: nowIso() });
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
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), type: 'return', material: m.code, qty, to_jc: jc, status: 'Approved', by: ($('#rtBy') ? $('#rtBy').value.trim() : ME.name) || ME.name, approved_by: ME.name, at: nowIso(), remark: $('#rtRem').value.trim() });
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
const RTV_REASONS = ['Rejection Return', 'Excess Return', 'Quality Issue', 'Wrong Material', 'Damaged'];
VIEWS.rtv = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const { rej } = stockMaps();
    let h = subTitle('Rejection RTV — Return To Vendor') + '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New RTV', 'rtv-new') : '') + '</div>';
    if (RTV_UI.form && edit) {
      // vendor-wise rejection sources from GRNs
      const srcRows = [];
      Store.all('grns').forEach(g => g.lines.forEach(l => { if (num(l.rejected) > 0) srcRows.push({ vendor: g.vendor, material: l.material, invoice: g.invoice, date: g.date, qty: num(l.rejected) }); }));
      const returned = {};
      Store.all('rtvs').forEach(r => { const k = norm(r.vendor + '|' + r.material); returned[k] = (returned[k] || 0) + num(r.qty); });
      const avail = srcRows.map(r => { const k = norm(r.vendor + '|' + r.material); const take = Math.min(r.qty, Math.max(0, r.qty - (returned[k] || 0))); returned[k] = Math.max(0, (returned[k] || 0) - r.qty); return Object.assign({}, r, { avail: take }); }).filter(r => r.avail > 0);
      const vendors = Array.from(new Set(avail.map(r => r.vendor)));
      const sel = RTV_UI.vendor || vendors[0] || '';
      h += '<div class="card"><div class="card-h"><b>New RTV</b><span class="muted small">rejection stock vendor ko wapas — NRGP print hoga</span></div><div class="card-b"><div class="row">' +
        '<label>Vendor *<select id="rvVen">' + (vendors.length ? vendors.map(v => '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + ' (' + avail.filter(r => r.vendor === v).length + ')</option>').join('') : '<option value="">Koi rejection stock nahi</option>') + '</select></label>' +
        '<label>Reason<select id="rvWhy">' + RTV_REASONS.map(x => '<option>' + x + '</option>').join('') + '</select></label>' +
        '<label>Vehicle No<input id="rvVeh" placeholder="HR-26-XX-1234"></label><label>Driver Name<input id="rvDrv"></label><label style="flex:1">Remarks<input id="rvRem" placeholder="Optional remarks (NRGP me print hoga)"></label></div>' +
        '<table style="margin-top:8px;max-width:820px"><tr><th>#</th><th>Item</th><th>Code</th><th>Invoice</th><th>UOM</th><th>Date</th><th class="num">Rejected Qty</th><th class="num" style="width:110px">Return Qty</th></tr>' +
        avail.filter(r => r.vendor === sel).map((r, i) => '<tr data-rvrow data-mat="' + esc(r.material) + '" data-inv="' + esc(r.invoice) + '" data-max="' + r.avail + '"><td class="muted">' + (i + 1) + '</td><td>' + esc((matBy(r.material) || {}).name || '') + '</td><td>' + esc(r.material) + '</td><td>' + esc(r.invoice) + '</td><td>' + esc((matBy(r.material) || {}).uom || '') + '</td><td class="nowrap">' + fmtD(r.date) + '</td><td class="num late-txt">' + qtyFmt(r.avail) + '</td><td><input class="qty right" type="number" min="0" max="' + r.avail + '" step="any" data-rvq value="' + r.avail + '"></td></tr>').join('') +
        '</table></div><div class="card-f"><button class="btn primary" data-act="rtv-save">Create RTV &amp; Generate NRGP</button><span id="rvMsg" class="small"></span></div></div>';
    }
    const rows = Store.all('rtvs').slice().sort((a2, b2) => b2.no < a2.no ? -1 : 1);
    h += '<div class="tbl-wrap"><table><tr><th>NRGP</th><th>Date</th><th>Vendor</th><th>Item</th><th>Code</th><th class="num">Qty</th><th>Invoice</th><th>Reason</th><th>Vehicle</th><th>By</th><th></th></tr>' +
      (rows.length ? rows.map(r => '<tr><td><b>' + esc(r.no) + '</b></td><td class="nowrap">' + fmtD(r.date) + '</td><td>' + esc(r.vendor) + '</td><td>' + esc((matBy(r.material) || {}).name || '') + '</td><td>' + esc(r.material) + '</td><td class="num">' + qtyFmt(r.qty) + '</td><td>' + esc(r.invoice || '') + '</td><td class="small">' + esc(r.reason || '') + '</td><td>' + esc(r.vehicle || '') + '</td><td>' + esc(r.by) + '</td><td class="right"><button class="btn sm ghost" data-act="nrgp-print" data-id="' + esc(r.id) + '">NRGP</button></td></tr>').join('') : '<tr><td colspan="11" class="empty">No RTVs</td></tr>') + '</table></div>';
    setMain(h);
    const v = $('#rvVen'); if (v) v.addEventListener('change', e => { RTV_UI.vendor = e.target.value.replace(/ \(\d+\)$/, ''); VIEWS.rtv.render(); });
  }
};
ACTIONS['rtv-new'] = () => { RTV_UI.form = !RTV_UI.form; RTV_UI.vendor = null; VIEWS.rtv.render(); };
ACTIONS['rtv-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const ven = ($('#rvVen').value || '').replace(/ \(\d+\)$/, '');
  const rows = $$('tr[data-rvrow]').map(tr => ({ material: tr.dataset.mat, invoice: tr.dataset.inv, qty: num($('[data-rvq]', tr).value), max: num(tr.dataset.max) })).filter(r => r.qty > 0);
  if (!ven || !rows.length) { $('#rvMsg').innerHTML = '<span class="late-txt">Vendor aur return qty chahiye.</span>'; return; }
  const over = rows.find(r => r.qty > r.max + 1e-9);
  if (over) { $('#rvMsg').innerHTML = '<span class="late-txt">' + esc(over.material) + ': rejected qty se zyada return nahi hota.</span>'; return; }
  const why = $('#rvWhy').value, veh = $('#rvVeh').value.trim(), drv = $('#rvDrv').value.trim(), rem = $('#rvRem').value.trim();
  const ids = rows.map(r => Store.put('rtvs', { id: uid(), no: fyNo('rtvs', 'NRGP', 4), date: todayYmd(), vendor: ven, material: r.material, uom: (matBy(r.material) || {}).uom || '', qty: r.qty, invoice: r.invoice, reason: why, vehicle: veh, driver: drv, remarks: rem, by: ME.name }).id);
  audit('rtv.create', Store.get('rtvs', ids[0]).no, ven + ' · ' + rows.map(r => r.material + '×' + r.qty).join(', ') + ' · ' + why);
  RTV_UI.form = false; flash(rows.length + ' item ka RTV ban gaya — NRGP print karo.'); VIEWS.rtv.render();
  ACTIONS['nrgp-print']({ dataset: { id: ids[0] } });
};
ACTIONS['nrgp-print'] = el => {
  const r = Store.get('rtvs', el.dataset.id); if (!r) return;
  const sib = Store.all('rtvs').filter(x => x.vendor === r.vendor && x.date === r.date && x.reason === r.reason && x.vehicle === r.vehicle);
  const v = vendorBy(r.vendor) || {};
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(r.no) + '</title><style>body{font:13px/1.5 system-ui;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #999;padding:5px 8px;text-align:left}h2{margin:0}small{color:#555}</style></head><body>' +
    '<div style="display:flex;justify-content:space-between"><div><h2>' + esc(settings().company || '') + '</h2><small>' + esc(settings().address || '') + (settings().gstin ? ' · GSTIN ' + esc(settings().gstin) : '') + '</small></div>' +
    '<div style="text-align:right"><h2>Non-Returnable Gate Pass (NRGP)</h2><small>Ref: ' + esc(r.no) + ' · ' + fmtD(r.date) + '</small></div></div>' +
    '<p><b>Vendor:</b> ' + esc(r.vendor) + (v.address ? ', ' + esc(v.address) : '') + (v.gstin ? '<br>GSTIN: ' + esc(v.gstin) : '') + (v.mobile ? ' · Mob: ' + esc(v.mobile) : '') + '</p>' +
    '<table><tr><th>S.No</th><th>Item Description</th><th>Item Code</th><th>Invoice Ref</th><th>UOM</th><th>Qty</th></tr>' +
    sib.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc((matBy(x.material) || {}).name || '') + '</td><td>' + esc(x.material) + '</td><td>' + esc(x.invoice || '') + '</td><td>' + esc(x.uom) + '</td><td>' + qtyFmt(x.qty) + '</td></tr>').join('') +
    '<tr><td colspan="5" style="text-align:right"><b>Total Quantity:</b></td><td><b>' + qtyFmt(sib.reduce((s2, x) => s2 + num(x.qty), 0)) + '</b></td></tr></table>' +
    '<p>Reason / Purpose: ' + esc(r.reason || '') + '<br>Vehicle No: ' + esc(r.vehicle || '') + '<br>Driver Name: ' + esc(r.driver || '') + '<br>Remarks: ' + esc(r.remarks || '') + '</p>' +
    '<p><small>Declaration: Goods are being returned to the vendor and are non-returnable against this gate pass.</small></p>' +
    '<p style="margin-top:40px">Prepared By: ' + esc(r.by) + ' _____________ &nbsp;&nbsp;&nbsp; Authorised Signatory _____________</p>' +
    '<script>window.print()</' + 'script></body></html>');
  w.document.close();
};

VIEWS.materials = {
  mod: 'masters', render() {
    masterView({
      col: 'materials', mod: 'masters', title: 'Materials', view: VIEWS.materials, sort: 'code', paste: true,
      cols: [{ k: 'code', l: 'Item Code', w: 100, upper: true, ph: 'auto' }, { k: 'name', l: 'Item Name', ph: 'Item name' },
        { k: 'group', l: 'Category', opts: () => [''].concat(ITEM_CATS).map(v => ({ v, l: v || '—' })) },
        { k: 'uom', l: 'UOM', opts: () => UOMS.map(v => ({ v, l: v })) },
        { k: 'price', l: 'Price ₹', type: 'number', w: 90 }, { k: 'rack', l: 'Rack No.', w: 80, upper: true },
        { k: 'gst', l: 'GST %', type: 'number', w: 70 }, { k: 'hsn', l: 'HSN', w: 90 },
        { k: 'min_level', l: 'Min level', type: 'number', w: 80 }],
      defaults: { uom: 'PCS' },
      beforeAdd: d => { if (!String(d.code || '').trim()) d.code = itemCodeAuto(d.group); },
      validate: d => (!String(d.name || '').trim() ? 'Item name is required.' : Store.all('materials').some(x => x.id !== d.id && d.code && norm(x.code) === norm(d.code)) ? 'Code exists.' : ''),
      inUse: d => (Store.all('purchase_orders').some(p => p.lines.some(l => norm(l.material) === norm(d.code))) || Store.all('issues').some(i => norm(i.material) === norm(d.code))) ? 'Material use ho chuka hai — delete nahi hoga.' : ''
    });
  }
};

/* ================= DEVELOPMENT: BOM ================= */
VIEWS.bom = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    if (!edit) { go('boms'); return; }
    const brands = Store.all('customers').map(c => c.name);
    let h = subTitle('Development BOM') + '<div class="card"><div class="card-h"><b>New BOM</b><span class="muted small">article + brand ka master recipe — JC isi se banta hai</span></div><div class="card-b">' + dlMat('dlMatB') + dlVendor() +
      '<datalist id="dlArtB">' + Store.all('items').map(i => '<option value="' + esc(i.code) + '">' + esc(i.name) + '</option>').join('') + '</datalist>' +
      '<datalist id="dlBrandB">' + brands.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<datalist id="dlCatJc2">' + ITEM_CATS.map(x => '<option>' + x + '</option>').join('') + '</datalist><datalist id="dlCatB">' + fieldOptions('category').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<div class="row"><label>Brand *<input id="nbBrand" list="dlBrandB"></label><label>Article Name *<input id="nbArt" list="dlArtB"></label><label>Style Name<input id="nbStyle"></label><label>Colour Wise<input id="nbCol" placeholder="blank = all colours"></label>' +
      '<label>Gender<select id="nbGen"><option value=""></option>' + GENDERS.map(g => '<option>' + g + '</option>').join('') + '</select></label><label>Category<input id="nbCat" list="dlCatB"></label></div>' +
      '<div class="row" style="margin-top:8px"><label>Size Run<input id="nbRun" placeholder="e.g. 6X10"></label><label>Last (Mould No)<input id="nbMould"></label>' + imgField('nbPhoto', 'Photo') + '<span id="nbPhotoTag"></span><label style="flex:1">Remark<input id="nbRem" style="text-transform:uppercase;color:var(--late)"></label></div>' +
      '<div class="toolbar" style="margin-top:10px"><a class="small" data-act="bom-line">+ Add Row</a><a class="small" data-act="bom-paste-t">Bulk Paste</a>' +
      '<label class="small" style="flex-direction:row;align-items:center;gap:4px">Copy items from <select id="nbCopy"><option value="">—</option>' + Store.all('boms').map(x => '<option value="' + esc(x.id) + '">' + esc(x.article + (x.colour ? ' · ' + x.colour : '') + ' v' + x.version) + '</option>').join('') + '</select></label><span class="grow"></span><span id="nbRmc" class="small"></span></div>' +
      '<div id="nbPasteBox" class="hidden"><textarea id="nbPaste" rows="4" class="mono" placeholder="Section[TAB]Category[TAB]Item Name[TAB]Norms[TAB]Price[TAB]Supplier[TAB]Remark — ek line ek item"></textarea> <button class="btn sm" data-act="bom-paste-go">Import</button></div>' +
      '<div class="tbl-wrap"><table id="nbTable"><tr><th>Sr</th><th style="width:110px">Section</th><th style="width:140px">Category</th><th>Item Name</th><th style="width:90px">Item Code</th><th style="width:60px">UOM</th><th class="num" style="width:90px">Norms</th><th class="num" style="width:90px">Price</th><th class="num" style="width:90px">Cost</th><th style="width:150px">Supplier</th><th style="width:130px">Remark</th><th style="width:30px"></th></tr>' +
      '</table></div>' +
      '</div><div class="card-f"><button class="btn primary" data-act="bom-save">Save BOM</button><span id="nbMsg" class="small"></span></div></div>';
    setMain(h);
    $('#nbTable').insertAdjacentHTML('beforeend', bomRow());
    const m = $('#main'); window.NBF = { photo: '' };
    m.addEventListener('input', e => { if (e.target.closest('#nbTable')) bomRecalc(); });
    m.addEventListener('change', e => {
      if (e.target.dataset.nb === 'mat') { const mt = Store.all('materials').find(x => norm(x.name) === norm(e.target.value) || norm(x.code) === norm(e.target.value)); const tr = e.target.closest('tr'); if (mt) { e.target.value = mt.name; $('[data-nb-code]', tr).textContent = mt.code; $('[data-nb-uom]', tr).textContent = mt.uom; const pr = $('[data-nb="price"]', tr); if (!pr.value) pr.value = mt.price || ''; const c = $('[data-nb="cat"]', tr); if (!c.value) c.value = mt.group || ''; } bomRecalc(); }
      if (e.target.id === 'nbPhoto') readImg(e.target.files[0], src => { NBF.photo = src; $('#nbPhotoTag').innerHTML = photoThumb(src); });
      if (e.target.id === 'nbCopy' && e.target.value) { const src = Store.get('boms', e.target.value); $$('#nbTable tr[data-bline]').forEach(tr => tr.remove()); src.lines.forEach(l => $('#nbTable').insertAdjacentHTML('beforeend', bomRow(l))); bomRecalc(); }
    });
  }
};
function bomRow(l) {
  l = l || {}; const m = matBy(l.material) || {};
  return '<tr data-bline><td class="muted" data-sr></td><td><input data-nb="section" value="' + esc(l.section || '') + '"></td><td><input data-nb="cat" list="dlCatJc2" value="' + esc(l.category || m.group || '') + '"></td><td><input data-nb="mat" list="dlMatB" value="' + esc(m.name || '') + '"></td><td class="muted" data-nb-code>' + esc(l.material || '') + '</td><td class="muted" data-nb-uom>' + esc(l.uom || '') + '</td>' +
    '<td><input data-nb="qty" type="number" min="0" step="any" class="right" value="' + esc(l.qty || '') + '"></td><td><input data-nb="price" type="number" min="0" step="any" class="right" value="' + esc(l.price || '') + '"></td><td class="num muted" data-nb-cost>0</td><td><input data-nb="sup" list="dlVen" value="' + esc(l.supplier || '') + '"></td><td><input data-nb="rem" value="' + esc(l.remark || '') + '"></td><td><button class="btn ghost sm" data-act="bom-line-del">×</button></td></tr>';
}
function bomRecalc() {
  let rmc = 0;
  $$('#nbTable tr[data-bline]').forEach((tr, i) => { $('[data-sr]', tr).textContent = i + 1; const c = num($('[data-nb="qty"]', tr).value) * num($('[data-nb="price"]', tr).value); $('[data-nb-cost]', tr).textContent = c ? money(c) : '0'; rmc += c; });
  $('#nbRmc').innerHTML = rmc ? '<b>Total RMC/Pair: ₹' + money(rmc) + '</b>' : '';
}
ACTIONS['bom-line'] = () => { $('#nbTable').insertAdjacentHTML('beforeend', bomRow()); bomRecalc(); };
ACTIONS['bom-line-del'] = el => { el.closest('tr').remove(); bomRecalc(); };
ACTIONS['bom-paste-t'] = () => $('#nbPasteBox').classList.toggle('hidden');
ACTIONS['bom-paste-go'] = () => {
  let ok = 0, bad = [];
  $('#nbPaste').value.split(/\r?\n/).map(x => x.split('\t')).filter(r => r.join('').trim()).forEach(r => {
    const hasSec = r.length >= 3;
    const nameIdx = hasSec ? 2 : 0;
    const m = Store.all('materials').find(x => norm(x.name) === norm(r[nameIdx]) || norm(x.code) === norm(r[nameIdx]));
    if (!m) { bad.push(r[nameIdx]); return; }
    $('#nbTable').insertAdjacentHTML('beforeend', bomRow({ section: hasSec ? r[0] : '', category: hasSec ? r[1] : m.group, material: m.code, uom: m.uom, qty: r[hasSec ? 3 : 1] || '', price: r[hasSec ? 4 : 2] || m.price || '', supplier: r[hasSec ? 5 : 3] || '', remark: r[hasSec ? 6 : 4] || '' })); ok++;
  });
  $('#nbPasteBox').classList.add('hidden'); bomRecalc();
  flash(ok + ' items import hue.' + (bad.length ? ' Match nahi hue: ' + esc(bad.join(', ')) : ''), bad.length ? 'err' : '');
};
ACTIONS['bom-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const brand = $('#nbBrand').value.trim(); const artIn = $('#nbArt').value.trim().toUpperCase();
  const art = (Store.all('items').find(i => norm(i.code) === norm(artIn) || norm(i.name) === norm(artIn)) || { code: artIn }).code;
  const style = $('#nbStyle').value.trim(), col = $('#nbCol').value.trim(), gen = $('#nbGen').value, cat = $('#nbCat').value.trim();
  const lines = $$('#nbTable tr[data-bline]').map(tr => {
    const m = Store.all('materials').find(x => norm(x.name) === norm($('[data-nb="mat"]', tr).value) || norm(x.code) === norm($('[data-nb="mat"]', tr).value));
    return m ? { section: $('[data-nb="section"]', tr).value.trim(), category: $('[data-nb="cat"]', tr).value.trim() || m.group || '', material: m.code, uom: m.uom, qty: num($('[data-nb="qty"]', tr).value), price: num($('[data-nb="price"]', tr).value), supplier: $('[data-nb="sup"]', tr).value.trim(), remark: $('[data-nb="rem"]', tr).value.trim() } : null;
  }).filter(l => l && l.qty > 0);
  if (!brand || !art || !lines.length) { $('#nbMsg').innerHTML = '<span class="late-txt">Brand, Article aur kam se kam ek item line (Norms > 0) chahiye.</span>'; return; }
  const dupKey = lines.map(l => norm(l.section + '|' + l.material)).filter((x, i, a2) => a2.indexOf(x) !== i);
  if (dupKey.length) { $('#nbMsg').innerHTML = '<span class="late-txt">Same Section + Item do baar hai — hatao.</span>'; return; }
  const ver = Store.all('boms').filter(b2 => norm(b2.article) === norm(art) && norm(b2.brand || '') === norm(brand) && norm(b2.style || '') === norm(style) && norm(b2.colour || '') === norm(col)).reduce((mx, b2) => Math.max(mx, b2.version), 0) + 1;
  const b2 = Store.put('boms', { id: uid(), brand, article: art, style, colour: col, gender: gen, category: cat, size_run: $('#nbRun').value.trim(), mould_no: $('#nbMould').value.trim(), photo: (window.NBF || {}).photo || '', remark: $('#nbRem').value.trim().toUpperCase(), version: ver, lines, status: 'Final', by: ME.name, at: nowIso() });
  audit('bom.create', art + ' v' + ver, brand + (col ? ' · ' + col : '') + ' · ' + lines.length + ' items · RMC ₹' + money(lines.reduce((s2, l) => s2 + l.qty * l.price, 0)));
  flash('BOM saved: ' + esc(art) + ' v' + ver + (ver > 1 ? ' (naya version)' : '') + '.'); go('boms');
};
VIEWS.boms = {
  mod: 'development', render() {
    const byKey = {};
    Store.all('boms').forEach(b2 => { const k = norm(b2.article + '|' + (b2.brand || '') + '|' + (b2.style || '') + '|' + (b2.colour || '')); if (!byKey[k] || byKey[k].version < b2.version) byKey[k] = b2; });
    const rows = Object.values(byKey).sort((a2, b3) => a2.article.localeCompare(b3.article));
    setMain(subTitle('Created BOMs', 'latest version per article+brand+style+colour') + '<div class="toolbar"><span class="grow"></span>' + (can('development', 'edit') ? '<a class="btn primary" href="#/bom">+ Make BOM</a>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Photo</th><th>Brand</th><th>Article</th><th>Style</th><th>Colour</th><th>Gender</th><th>Ver</th><th>Items (Norms × Price → Cost)</th><th class="num">RMC/Pair ₹</th><th>By</th><th>Date</th><th></th></tr>' +
      (rows.length ? rows.map(b2 => '<tr><td>' + photoThumb(b2.photo) + '</td><td>' + esc(b2.brand || '') + '</td><td><b>' + esc(b2.article) + '</b></td><td>' + esc(b2.style || '') + '</td><td>' + esc(b2.colour || 'All') + '</td><td>' + esc(b2.gender || '') + '</td><td>v' + b2.version + '</td><td class="small">' + b2.lines.map(l => esc(l.material) + ' × ' + l.qty + (l.price ? ' @ ₹' + l.price : '') + (l.supplier ? ' <span class="muted">(' + esc(l.supplier) + ')</span>' : '')).join('<br>') + '</td><td class="num">' + money(b2.lines.reduce((s2, l) => s2 + num(l.qty) * num(l.price || 0), 0)) + '</td><td>' + esc(b2.by) + '</td><td class="nowrap">' + fmtD(b2.at) + '</td><td class="right"><button class="btn sm ghost" data-act="print-bom" data-id="' + esc(b2.id) + '">Print</button></td></tr>').join('') : '<tr><td colspan="12" class="empty">Koi BOM nahi bana</td></tr>') + '</table></div>');
  }
};

/* ================= PRODUCTION ================= */
const REQ_UI = { form: false };
function staleReqs() { return Store.all('requisitions').filter(r => r.status === 'Pending' && (Date.now() - new Date(r.date + 'T00:00')) > 24 * 3600000); }
VIEWS.requisition = {
  mod: 'production', render() {
    const edit = can('production', 'edit');
    let h = subTitle('Requisition Slip', 'JC ke pending materials store se mangwao');
    const stale = staleReqs();
    if (stale.length) h += '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px"><b>' + stale.length + ' slip 24h+ se pending</b> — jab tak Store issue/reject nahi karta, nayi slip nahi banegi (Manager/Admin exempt). <a href="#/issuance">Issuance →</a></div>';
    h += '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New requisition', 'req-new') : '') + '</div>';
    if (REQ_UI.form && edit) {
      h += '<div class="card"><div class="card-h"><b>New Requisition Slip</b><span class="muted small">JC chuno — pending material khud aa jayega</span></div><div class="card-b">' + dlMat('dlMatR') + '<datalist id="dlJc">' + Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">' + esc(j.article) + '</option>').join('') + '</datalist>' +
        '<div class="row"><label>Job Card *<input id="nrJc" list="dlJc"></label><label>Requested By<input value="' + esc(ME.name) + '" readonly></label><button class="btn sm" data-act="req-fill">Fill All Pending Qty</button></div>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table id="nrTable" style="max-width:820px"><tr><th>#</th><th>Item Name</th><th>UOM</th><th class="num">Req Qty</th><th class="num">Stock</th><th>Coverage</th><th class="num" style="width:120px">Requisition Qty</th><th style="width:30px"></th></tr></table></div>' +
        '<a class="small" data-act="req-extra">+ Add Extra Item</a>' +
        '</div><div class="card-f"><button class="btn primary" data-act="req-save">Generate Requisition Slip</button><span id="nrMsg" class="small"></span></div></div>';
    }
    const rows = Store.all('requisitions').slice().sort((a2, b2) => b2.no < a2.no ? -1 : 1);
    h += '<div class="tbl-wrap"><table><tr><th>Req</th><th>Date</th><th>JC / Dept</th><th>Materials (req → issued)</th><th>Status</th><th>By</th><th></th></tr>' +
      (rows.length ? rows.map(r => '<tr><td><b>' + esc(r.no) + '</b></td><td class="nowrap">' + fmtD(r.date) + '</td><td>' + esc(r.jc_no || r.dept) + '</td><td class="small">' + r.lines.map(l => esc(l.material) + ' × ' + qtyFmt(l.qty) + (l.extra ? ' <span class="muted">(extra)</span>' : '')).join('<br>') + '</td><td><span class="st ' + (r.status === 'Issued' ? 'Done' : r.status === 'Rejected' ? 'Late' : 'Pending') + '">' + r.status + '</span>' + (r.issued_by ? '<div class="muted small">' + esc(r.issued_by) + '</div>' : '') + '</td><td>' + esc(r.by) + '</td><td class="right"><button class="btn sm ghost" data-act="print-req" data-id="' + esc(r.id) + '">Print Slip</button></td></tr>').join('') : '<tr><td colspan="7" class="empty">No requisitions</td></tr>') + '</table></div>';
    setMain(h);
    const m = $('#main');
    m.addEventListener('change', e => { if (e.target.id === 'nrJc') reqFillJc(); if (e.target.dataset.nr === 'mat') { const mt = matBy(e.target.value); if (mt) { e.target.value = mt.code; const tr = e.target.closest('tr'); $('[data-nr-uom]', tr).textContent = mt.uom; } } });
  }
};
function reqCoverage(reqQty, stock) { return stock >= reqQty ? '<span class="st Done">Covered</span>' : stock > 0 ? '<span class="st Pending">' + qtyFmt(stock) + ' only</span>' : '<span class="st Late">No stock</span>'; }
function reqFillJc() {
  const j = jcBy($('#nrJc').value); const t = $('#nrTable');
  $$('#nrTable tr[data-rrow]').forEach(tr => tr.remove());
  if (!j) return;
  (j.lines || []).forEach((l, i) => {
    const pend = Math.max(0, num(l.required) - issuedToJc(j.no, l.material));
    if (pend <= 0.0001) return;
    const stk = stockOf(l.material); const cap = Math.min(pend, stk);
    t.insertAdjacentHTML('beforeend', '<tr data-rrow data-mat="' + esc(l.material) + '" data-cap="' + cap + '"><td class="muted">' + (i + 1) + '</td><td>' + esc((matBy(l.material) || {}).name || l.material) + ' <span class="muted small">' + esc(l.material) + '</span></td><td>' + esc(l.uom) + '</td><td class="num">' + qtyFmt(pend) + '</td><td class="num">' + qtyFmt(stk) + '</td><td>' + reqCoverage(pend, stk) + '</td><td><input class="qty right" type="number" min="0" max="' + cap + '" step="any" data-rq' + (stk <= 0 ? ' disabled' : '') + '></td><td></td></tr>');
  });
  if (!$$('#nrTable tr[data-rrow]').length) t.insertAdjacentHTML('beforeend', '<tr data-rrow><td colspan="8" class="empty">Is JC ka sab material issue ho chuka hai 🎉</td></tr>');
}
ACTIONS['req-fill'] = () => { $$('#nrTable tr[data-rrow] [data-rq]').forEach(inp => { inp.value = inp.closest('tr').dataset.cap; }); };
ACTIONS['req-extra'] = () => { $('#nrTable').insertAdjacentHTML('beforeend', '<tr data-rrow data-extra="1"><td class="muted">+</td><td><input data-nr="mat" list="dlMatR" placeholder="Item"></td><td class="muted" data-nr-uom></td><td class="num muted">extra</td><td class="num muted">extra</td><td></td><td><input class="qty right" type="number" min="0" step="any" data-rq></td><td><button class="btn ghost sm" data-act="req-extra-del">×</button></td></tr>'); };
ACTIONS['req-extra-del'] = el => el.closest('tr').remove();
ACTIONS['req-new'] = () => { REQ_UI.form = !REQ_UI.form; VIEWS.requisition.render(); };
ACTIONS['req-save'] = () => {
  if (!requirePerm('production', 'edit')) return;
  const stale = staleReqs();
  if (stale.length && !canApprove()) { $('#nrMsg').innerHTML = '<span class="late-txt">' + esc(stale[0].no) + ' 24 ghante se pending hai — pehle Store se issue/reject karwao, tabhi nayi slip banegi.</span>'; return; }
  const jc = $('#nrJc').value.trim();
  if (!jcBy(jc)) { $('#nrMsg').innerHTML = '<span class="late-txt">Sahi Job Card chuno.</span>'; return; }
  const lines = [];
  let overCap = '';
  $$('#nrTable tr[data-rrow]').forEach(tr => {
    const q = num(($('[data-rq]', tr) || {}).value); if (q <= 0) return;
    if (tr.dataset.extra) { const mt = matBy($('[data-nr="mat"]', tr).value); if (mt) lines.push({ material: mt.code, qty: Math.min(q, stockOf(mt.code)), extra: true }); return; }
    if (q > num(tr.dataset.cap) + 1e-9) overCap = tr.dataset.mat;
    lines.push({ material: tr.dataset.mat, qty: Math.min(q, num(tr.dataset.cap)) });
  });
  if (overCap) { $('#nrMsg').innerHTML = '<span class="late-txt">' + esc(overCap) + ': qty cap (pending/stock) se zyada thi — cap pe laga di.</span>'; }
  if (!lines.length) { $('#nrMsg').innerHTML = '<span class="late-txt">Kisi item ki requisition qty dalo.</span>'; return; }
  const r = Store.put('requisitions', { id: uid(), no: nextNo('requisitions', 'REQ'), date: todayYmd(), jc_no: jc, dept: 'Production', lines, status: 'Pending', by: ME.name });
  audit('req.create', r.no, jc + ' · ' + lines.map(l => l.material + '×' + l.qty).join(', ')); REQ_UI.form = false;
  flash('<b>' + esc(r.no) + '</b> ban gayi — Store ki issuance screen par pahunch gayi.'); VIEWS.requisition.render();
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
      cols: [{ k: 'name', l: 'Vendor Name', ph: 'e.g. ABC Textiles' }, { k: 'address', l: 'Address' }, { k: 'state', l: 'State', w: 130 }, { k: 'gstin', l: 'GST No', w: 160, upper: true }, { k: 'email', l: 'Email ID', w: 180 }, { k: 'mobile', l: 'Mobile No.', w: 120 }],
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
