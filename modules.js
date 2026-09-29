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
// image -> small JPEG dataURL (800px max) to keep localStorage/Supabase light
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
// stk = good stock; rej = GRN rejection (goes back to the vendor);
// rejLine = line rejection that is unused and can go back to the vendor; rejScrap = line rejection that cannot
function stockMaps() {
  const stk = {}, rej = {}, rejLine = {}, rejScrap = {}, rtvx = {};
  const add = (m, k, q) => { const key = norm(k); m[key] = (m[key] || 0) + q; };
  Store.all('grns').forEach(g => (g.lines || []).forEach(l => { add(stk, l.material, num(l.accepted) + (l.excess_status === 'Approved' ? num(l.excess) : 0)); add(rej, l.material, num(l.rejected)); if (l.excess_status === 'Rejected') add(rtvx, l.material, num(l.excess)); }));
  // only APPROVED issues deduct stock (a pending request does not); returns add back
  Store.all('issues').forEach(i => {
    if (i.status !== 'Approved' && i.status) return;
    if (i.type === 'line_reject') { add(i.returnable ? rejLine : rejScrap, i.material, num(i.qty)); return; }
    if (i.type === 'scrap') { add(rejScrap, i.material, -num(i.qty)); return; }
    add(stk, i.material, i.type === 'return' ? num(i.qty) : -num(i.qty));
  });
  Store.all('rtvs').forEach(r => add(r.source === 'line' ? rejLine : r.source === 'excess' ? rtvx : rej, r.material, -num(r.qty)));
  return { stk, rej, rejLine, rejScrap, rtvx };
}
function stockOf(code) { return stockMaps().stk[norm(code)] || 0; }
// Reserved stock per JC: reserved qty is part of physical stock.
function reservedOf(code, jc) { return Store.all('rsjw').filter(r => norm(r.material) === norm(code) && (!jc || norm(r.jc_no) === norm(jc))).reduce((s2, r) => s2 + num(r.qty), 0); }
function openStockOf(code) { return Math.max(0, stockOf(code) - reservedOf(code)); }
// Transit = ordered on approved POs but not yet received
function transitOf(code) { return openPOs().reduce((s2, p) => s2 + p.lines.filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + Math.max(0, num(l.qty) - num(l.received)), 0), 0); }
function jcBy(no) { return Store.all('job_cards').find(j => norm(j.no) === norm(no)); }
// net issued to a JC: returns and line rejections come off, so a replacement for rejected material
// re-opens within the JC balance instead of counting as excess
function issuedToJc(jc, code) { return Store.all('issues').filter(i => i.status === 'Approved' && i.type !== 'scrap' && norm(i.to_jc) === norm(jc) && norm(i.material) === norm(code)).reduce((s2, i) => s2 + (i.type === 'return' || i.type === 'line_reject' ? -num(i.qty) : num(i.qty)), 0); }
// Net requirement per item across all open JCs:
//   JC balance (required − net issued) − good stock − open PO pending (approved + awaiting approval) + min level (if set)
function netReqRows(vendor, excludePo) {
  const by = {};
  const row = code => { const k = norm(code); return by[k] || (by[k] = { material: (matBy(code) || {}).code || code, jcs: [], demand: 0, suppliers: new Set() }); };
  Store.all('job_cards').filter(j => j.status !== 'Closed').forEach(j => (j.lines || []).forEach(l => {
    const bal = Math.max(0, num(l.required) - issuedToJc(j.no, l.material));
    if (bal <= 0.0001) return;
    const r = row(l.material); r.demand += bal; r.jcs.push({ jc: j.no, bal, supplier: l.supplier || '', brand: j.brand || '', article: j.article || '', colour: j.colour || '' }); if (l.supplier) r.suppliers.add(l.supplier);
  }));
  Store.all('materials').filter(m => num(m.min_level) > 0).forEach(m => row(m.code));
  const src = Store.all('sourcing');
  const openPo = code => Store.all('purchase_orders').filter(p => !p.cancelled && p.approval !== 'Rejected' && p.id !== excludePo)
    .reduce((s2, p) => s2 + (p.lines || []).filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + Math.max(0, num(l.qty) - num(l.received)), 0), 0);
  return Object.values(by).map(r => {
    const m = matBy(r.material) || {};
    src.filter(x => norm(x.material) === norm(r.material)).forEach(x => { if (!r.suppliers.size) r.suppliers.add(x.vendor); });
    r.name = m.name || r.material; r.uom = m.uom || ''; r.min = num(m.min_level);
    r.stock = Math.max(0, stockOf(r.material)); r.openPo = openPo(r.material);
    r.net = Math.max(0, r.demand + r.min - r.stock - r.openPo);
    const sc = vendor ? src.find(x => norm(x.material) === norm(r.material) && norm(x.vendor) === norm(vendor)) : null;
    r.rate = sc ? sc.rate : (m.price || ''); r.moq = sc ? num(sc.moq) : 0;
    r.jcs.sort((a, b) => String(a.jc).localeCompare(String(b.jc)));
    return r;
  }).filter(r => (r.demand > 0 || r.net > 0) && (!vendor || Array.from(r.suppliers).some(v => norm(v) === norm(vendor))))
    .sort((a, b) => (b.net > 0) - (a.net > 0) || a.material.localeCompare(b.material));
}
function poPending(po) { return (po.lines || []).reduce((s, l) => s + Math.max(0, num(l.qty) - num(l.received)), 0); }
function poStatus(po) {
  if (po.cancelled) return 'Cancelled';
  if (po.approval === 'Rejected') return 'Rejected';
  if (po.approval === 'Amend') return 'Amend';
  if (po.approval !== 'Approved') return 'Pending Approval';
  const p = poPending(po); const got = (po.lines || []).some(l => num(l.received) > 0);
  return p <= 0 ? 'Received' : got ? 'Partial' : 'Open';
}
function poStCls(st) { return st === 'Received' ? 'Done' : st === 'Partial' ? 'Pending' : st === 'Cancelled' || st === 'Rejected' ? 'Cancelled' : st === 'Pending Approval' || st === 'Amend' ? 'Late' : 'Waiting'; }
// GRN, followup and inwarding run only against APPROVED POs.
function openPOs() { return Store.all('purchase_orders').filter(p => !p.cancelled && p.approval === 'Approved' && poPending(p) > 0); }
function autoTask(title, doer, dueDays) {
  const due = new Date(Date.now() + (dueDays || 0) * 86400000); if (due.getDay() === 0) due.setDate(due.getDate() + 1); // Sunday -> Monday
  Store.put('checklist', { id: uid(), title, doer, freq: 'Once', due: ymdOf(due), done: {}, active: true, by: 'auto', auto: true });
}
// Standard letterhead document printer used by every report
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
// Job Card document: one fixed layout shared by the screen view and the print/PDF.
// Teal banner, 12-field details table, product photo, size table with 2% extra, full-width BOM.
function jcDocHtml(j) {
  const o = Store.all('orders').find(x => norm(x.no) === norm(j.order_no)) || {};
  const ol = (o.lines || []).find(l => norm(l.article) === norm(j.article) && (!j.colour || norm(l.colour || '') === norm(j.colour))) || (o.lines || [])[0] || {};
  const sizes = j.sizes || [];
  const run = ol.size_run || ol.size || (sizes.length ? sizes[0].size + '-' + sizes[sizes.length - 1].size : '');
  const mean = sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)].size : '';
  const actT = sizes.reduce((a, x) => a + num(x.act), 0), extT = sizes.reduce((a, x) => a + num(x.extra), 0);
  const leftRows = [['JOB CARD', j.no], ['Date', fmtD(j.at)], ['Brand', j.brand], ['Style Name', j.style || ol.style || ''], ['Colour', j.colour || ol.colour || ''], ['Gender', j.gender || ol.gender || ''],
    ['Category', j.category || o.category || ''], ['Last/Tooling', o.tooling_no || ''], ['Mean Size', mean], ['Article', j.article], ['Size Run', run], ['Style Code/No.', j.style_code || 'NA']];
  let szRows = '';
  const nRows = Math.max(10, sizes.length);   // pad so the size box matches the photo/details height
  for (let i = 0; i < nRows; i++) {
    const s = sizes[i]; let c0 = '', c1 = '', hl = '';
    if (i === 0) { c0 = esc(j.order_no || ''); c1 = esc(fmtD(o.order_date || o.created_at)); }
    else if (i === 3) c0 = esc(j.line_status && j.line_status !== 'NA' ? j.line_status : (o.channel || '').toUpperCase());
    else if (i === 5) { c0 = esc(j.remarks || (ol.pack ? ol.pack.toUpperCase() + ' PACKING' : '')); hl = ' class="hl"'; }
    szRows += '<tr><td' + hl + '>' + c0 + '</td><td' + hl + '>' + c1 + '</td><td>' + (s ? esc(s.size) : '') + '</td><td>' + (s ? qtyFmt(s.act) : '') + '</td><td>' + (s ? qtyFmt(s.extra) : '') + '</td></tr>';
  }
  return '<div class="jcdoc"><div class="jcban">JOB CARD</div>' +
    '<div class="jcmid"><div class="jcl"><table class="jckv">' + leftRows.map((r, i) => '<tr><td class="k">' + esc(r[0]) + '</td><td class="v' + (i === 0 ? ' b' : '') + '">' + esc(String(r[1] || '')) + '</td></tr>').join('') + '</table></div>' +
    '<div class="jcph">' + (j.photo ? '<img src="' + j.photo + '">' : 'PRODUCT PHOTO') + '</div>' +
    '<div class="jcr"><table class="jcszt"><tr class="hd"><th>Order No</th><th>Order Date</th><th>SIZE</th><th>Act.Ord</th><th>With 2% Extra</th></tr>' + szRows +
    '<tr class="tt"><td></td><td>Total</td><td></td><td>' + qtyFmt(actT) + '</td><td>' + qtyFmt(extT) + '</td></tr></table></div></div>' +
    '<table class="jcbom"><tr class="hd"><th>Sr No</th><th>Process</th><th>Section</th><th>Item Category</th><th>Item Name</th><th>Item Code</th><th>Uom</th><th>Norms</th><th>Required Qty</th><th>Supplier</th></tr>' +
    (j.lines || []).map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(l.process || '') + '</td><td>' + esc(l.section || '') + '</td><td>' + esc(l.category || '') + '</td><td>' + esc((matBy(l.material) || {}).name || l.material) + '</td><td class="c">' + esc(l.material) + '</td><td class="c">' + esc(l.uom || '') + '</td><td class="c">' + l.norms + '</td><td class="c">' + qtyFmt(l.required) + '</td><td>' + esc(l.supplier || '') + '</td></tr>').join('') +
    '</table></div>';
}
const JC_DOC_CSS =
  '.jcdoc table{border-collapse:collapse}' +
  '.jcban{background:#0d7377;color:#fff;text-align:center;font-weight:bold;font-size:15px;padding:6px;border-radius:4px}' +
  '.jcmid{display:flex;gap:10px;margin:10px 0;align-items:stretch}' +
  '.jcl,.jcr{flex:none;display:flex}' +
  '.jckv{width:100%}.jckv td{border:1px solid #b9d4d4;font-size:11px;padding:3px 8px}.jckv .k{font-weight:bold;width:95px;background:#e3f2f2;color:#0a5c5f}.jckv .b{font-weight:bold}' +
  '.jcph{border:1px solid #b9d4d4;border-radius:4px;flex:1;min-height:220px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;letter-spacing:.2em;overflow:hidden}' +
  '.jcph img{max-width:100%;max-height:250px;object-fit:contain}' +
  '.jcszt{height:100%}.jcszt th,.jcszt td{border:1px solid #b9d4d4;font-size:11px;padding:3px 7px;text-align:center}.jcszt .hd th{background:#0d7377;color:#fff}.jcszt .tt td{font-weight:bold;background:#e3f2f2}.jcszt .hl{background:#e3f2f2;font-weight:bold}' +
  '.jcbom{width:100%}.jcbom th,.jcbom td{border:1px solid #b9d4d4;font-size:10.5px;padding:3.5px 7px}.jcbom .hd th{background:#0d7377;color:#fff;text-align:center}.jcbom .c{text-align:center}';
const JC_EXTRA_CSS =
  '.jcph-wrap{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}' +
  '.jcrem{border:1px solid #b9d4d4;border-radius:4px;padding:4px 8px;font-size:12px;font-weight:bold;color:#c62828;text-transform:uppercase;display:flex;gap:8px;align-items:center}' +
  '.jcrem .k{color:#0a5c5f}';
/* Excel-style grid: Enter/ArrowDown move down the same column (a new row appears at the end),
   ArrowUp moves up, and pasting multi-cell clipboard data fills rows directly. */
function excelGrid(tbl, opts) {
  if (!tbl) return;
  tbl.addEventListener('keydown', e => {
    const inp = e.target.closest('input'); if (!inp) return;
    const key = e.key.toLowerCase();
    const tr = inp.closest('tr'); const rows = $$(opts.rowSel, tbl);
    const ri = rows.indexOf(tr); if (ri < 0) return;
    const ci = $$('input,select', tr).indexOf(inp);
    if ((e.ctrlKey || e.metaKey) && key === 'd') {   // Excel fill-down: copy the cell above
      e.preventDefault();
      if (ri > 0) {
        const src = $$('input,select', rows[ri - 1])[ci];
        if (src) { inp.value = src.value; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'c') {   // Ctrl+C with nothing selected copies the whole cell
      if (inp.selectionStart === inp.selectionEnd) { e.preventDefault(); try { navigator.clipboard.writeText(inp.value); } catch (err) {} }
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (e.key === 'ArrowUp') { if (ri > 0) { const t2 = $$('input,select', rows[ri - 1])[ci]; if (t2) t2.focus(); } return; }
    if (ri === rows.length - 1 && e.key === 'Enter') opts.addRow();
    const rows2 = $$(opts.rowSel, tbl);
    if (rows2[ri + 1]) { const t2 = $$('input,select', rows2[ri + 1])[ci]; if (t2) { t2.focus(); if (t2.select) t2.select(); } }
  });
  tbl.addEventListener('paste', e => {
    const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (!/\t|\n/.test(txt)) return;   // single-cell paste behaves normally
    e.preventDefault();
    opts.importText(txt);
  });
}
ACTIONS['print-jc'] = el => {
  const j = Store.get('job_cards', el.dataset.id); if (!j) return;
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(j.no) + '</title><style>' +
    '@page{size:A4 landscape;margin:8mm}' +
    'html,body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000}' +
    JC_DOC_CSS +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '</style></head><body>' + jcDocHtml(j) +
    '<script>window.print()</' + 'script></body></html>');
  w.document.close();
};
// BOM document: same fixed layout for the screen form and the print/PDF (mirrors the Job Card document)
function bomDocHtml(b) {
  const leftRows = [['Brand', b.brand || ''], ['Article Name', b.article || ''], ['Style Name', b.style || ''], ['Colour Wise', b.colour || 'All'], ['Gender', b.gender || ''],
    ['Category', b.category || ''], ['Size Run', b.size_run || ''], ['Last (Mould No)', b.mould_no || ''], ['Version', 'v' + b.version], ['Date', fmtD(b.at)]];
  const rmc = (b.lines || []).reduce((a, l) => a + num(l.qty) * num(l.price || 0), 0);
  return '<div class="jcdoc"><div class="jcban">BILL OF MATERIALS</div><div class="jcmid">' +
    '<div class="jcl"><table class="jckv">' + leftRows.map(([k, v], i) => '<tr><td class="k">' + k + '</td><td class="v' + (i === 0 ? ' b' : '') + '">' + esc(String(v)) + '</td></tr>').join('') + '</table></div>' +
    '<div class="jcph-wrap"><div class="jcph">' + (b.photo ? '<img src="' + b.photo + '">' : 'PRODUCT PHOTO') + '</div>' +
    '<div class="jcrem"><span class="k">REMARK</span><span>' + esc(b.remark || '') + '</span></div></div></div>' +
    '<table class="jcbom"><tr class="hd"><th>Sr No</th><th>Process</th><th>Section</th><th>Category</th><th>Item Name</th><th>Item Code</th><th>UOM</th><th>Norms</th><th>Price</th><th>Cost</th><th>Supplier</th><th>Remark</th></tr>' +
    (b.lines || []).map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(l.process || '') + '</td><td>' + esc(l.section || '') + '</td><td>' + esc(l.category || '') + '</td><td>' + esc((matBy(l.material) || {}).name || l.material) + '</td><td class="c">' + esc(l.material) + '</td><td class="c">' + esc(l.uom || '') + '</td><td class="c">' + l.qty + '</td><td class="c">' + money(l.price || 0) + '</td><td class="c">' + money(num(l.qty) * num(l.price || 0)) + '</td><td>' + esc(l.supplier || '') + '</td><td>' + esc(l.remark || '') + '</td></tr>').join('') +
    '<tr><td colspan="9" style="text-align:right;font-weight:bold;background:#e3f2f2">Total RMC/Pair</td><td class="c" style="font-weight:bold;background:#e3f2f2">' + money(rmc) + '</td><td style="background:#e3f2f2"></td><td style="background:#e3f2f2"></td></tr>' +
    '</table></div>';
}
ACTIONS['print-bom'] = el => {
  const b = Store.get('boms', el.dataset.id); if (!b) return;
  const w = window.open('');
  w.document.write('<html><head><title>BOM ' + esc(b.article) + ' v' + b.version + '</title><style>' +
    '@page{size:A4 landscape;margin:8mm}html,body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000}' +
    JC_DOC_CSS + JC_EXTRA_CSS + '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '</style></head><body>' + bomDocHtml(b) + '<script>window.print()</' + 'script></body></html>');
  w.document.close();
};
// Code 128 (set B) barcode as inline SVG
const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
function barcodeSvg(text, h) {
  const vals = [104].concat(String(text).split('').map(c => Math.max(0, Math.min(94, c.charCodeAt(0) - 32))));
  const chk = vals.reduce((s2, v, i) => s2 + (i === 0 ? v : v * i), 0) % 103;
  const seq = vals.concat([chk, 106]).map(v => C128[v]).join('');
  let x = 10, bars = '';
  for (let i = 0; i < seq.length; i++) { const w = +seq[i]; if (i % 2 === 0) bars += '<rect x="' + x + '" y="0" width="' + w + '" height="' + h + '"/>'; x += w; }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (x + 10) * 1.4 + '" height="' + (h * 1.4) + '" viewBox="0 0 ' + (x + 10) + ' ' + h + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">' + bars + '</g></svg>';
}
function slipWin(title, html) {
  const w = window.open('');
  w.document.write('<html><head><title>' + esc(title) + '</title><style>' +
    'body{font:12px/1.45 "Segoe UI",system-ui,sans-serif;color:#111;margin:28px}' +
    '.band{background:#0e6a73;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:8px 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.band b{font-size:15px;letter-spacing:.06em}' +
    '.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin:10px 0}.hd h1{margin:0;font-size:17px}.hd small{color:#555}.bc{text-align:center;font:600 11px monospace}' +
    '.box{border:1.5px solid #111;padding:8px 10px;margin:10px 0}.kv{display:grid;grid-template-columns:repeat(3,max-content max-content);gap:4px 12px}.kv span{color:#555}.kv b{white-space:nowrap}' +
    'table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #8a8f96;padding:5px 8px;text-align:left;white-space:nowrap}th{background:#eef1f5;font-size:11px;text-transform:uppercase;letter-spacing:.03em}.n{text-align:right}tfoot td{font-weight:700;background:#f6f8fa}' +
    '.sig{display:flex;justify-content:space-between;margin-top:56px}.sig div{border-top:1px solid #333;padding:4px 30px 0;font-size:11.5px}' +
    '@media print{body{margin:10mm}}</style></head><body>' + html + '<script>window.print()</' + 'script></body></html>');
  w.document.close();
}
const kvHtml = pairs => '<div class="kv">' + pairs.map(([k, v]) => '<span>' + esc(k) + '</span><b>' + esc(v == null ? '' : v) + '</b>').join('') + '</div>';
// Requisition Slip — format R5 (header band, boxed details, barcode, no footer)
ACTIONS['print-req'] = el => {
  const r = Store.all('requisitions').find(x => x.id === el.dataset.id || norm(x.no) === norm(el.dataset.id)); if (!r) return;
  const j = r.jc_no ? jcBy(r.jc_no) : null;
  const rows = r.lines.map((l, i) => { const m = matBy(l.material) || {}; return '<tr><td>' + (i + 1) + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(m.uom || '') + '</td><td class="n">' + (l.req != null ? qtyFmt(l.req) : '') + '</td><td class="n">' + (l.stock != null ? qtyFmt(l.stock) : '') + '</td><td class="n">' + qtyFmt(l.qty) + '</td></tr>'; }).join('');
  slipWin(r.no, '<div class="band"><b>REQUISITION SLIP</b><span>' + esc(r.no) + ' · ' + esc(r.at ? fmtDT(r.at) : fmtD(r.date)) + '</span></div>' +
    '<div class="hd"><div><h1>' + esc(settings().company || 'Nexus 2.0') + '</h1><small>' + esc(settings().address || '') + '</small></div><div class="bc">' + barcodeSvg(r.no, 44) + '<br>' + esc(r.no) + '</div></div>' +
    '<div class="box">' + kvHtml([['Method', r.method === 'cons' ? 'Consumable Items' : 'Job Card'], ['Job Card', r.jc_no || ''], ['Department', r.dept || ''], ['Brand', j ? j.brand || '' : ''], ['Article', j ? j.article || '' : ''], ['Process', r.process || ''], ['Line', r.line || ''], ['Picker Name', r.picker || ''], ['Requested By', r.by], ['Created At', r.at ? fmtDT(r.at) : fmtD(r.date)]]) + '</div>' +
    '<table><thead><tr><th>#</th><th>Item Name</th><th>Item Code</th><th>UOM</th><th class="n">Req Qty</th><th class="n">Stock</th><th class="n">Requisition Qty</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="n">' + (r.lines.some(l => l.req != null) ? qtyFmt(r.lines.reduce((a, l) => a + num(l.req || 0), 0)) : '') + '</td><td></td><td class="n">' + qtyFmt(r.lines.reduce((a, l) => a + num(l.qty), 0)) + '</td></tr></tfoot></table>');
};
// Issue Slip — format I6 (barcode, Req Qty and Issue Qty); one slip per issue batch
ACTIONS['print-iss'] = el => {
  const i0 = Store.get('issues', el.dataset.id); if (!i0) return;
  const list = i0.slip_no ? Store.all('issues').filter(x => x.slip_no === i0.slip_no) : [i0];
  const ref = i0.slip_no || i0.no; const req = i0.req_no ? Store.all('requisitions').find(r => r.no === i0.req_no) : null;
  const rows = list.map((i, k) => { const m = matBy(i.material) || {}; return '<tr><td>' + (k + 1) + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(i.material) + '</td><td>' + esc(m.uom || '') + '</td><td class="n">' + (i.req_qty != null ? qtyFmt(i.req_qty) : '') + '</td><td class="n">' + qtyFmt(i.qty) + '</td><td>' + esc(i.status) + '</td></tr>'; }).join('');
  const appr = list.find(i => i.approved_by);
  slipWin(ref, '<div class="hd"><div><h1>' + esc(settings().company || 'Nexus 2.0') + '</h1><small>' + (i0.type === 'return' ? 'Material Return Slip' : 'Material Issue Slip') + '</small></div><div class="bc">' + barcodeSvg(ref, 44) + '<br>' + esc(ref) + '</div></div>' +
    kvHtml([['Issued At', fmtDT(i0.at)], ['Req No', i0.req_no || ''], ['Job Card', i0.to_jc || (req ? req.dept : '')], ['Process', i0.process || ''], ['Line', i0.line || ''], ['Picker Name', i0.picker || ''], ['Issued To', i0.to_dept || ''], ['Issue Type', i0.issue_type || 'Regular'], ['Issued By', i0.by], ['Approved By', appr ? appr.approved_by + ' · ' + fmtDT(appr.approved_at) : '']]) +
    '<table><thead><tr><th>#</th><th>Item Name</th><th>Item Code</th><th>UOM</th><th class="n">Req Qty</th><th class="n">Issue Qty</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="n">' + qtyFmt(list.reduce((a, i) => a + num(i.req_qty || 0), 0)) + '</td><td class="n">' + qtyFmt(list.reduce((a, i) => a + num(i.qty), 0)) + '</td><td></td></tr></tfoot></table>' +
    '<div class="sig"><div>Issued By</div><div>Received By</div></div>');
};

function newBtn(label, act) { return '<button class="btn primary" data-act="' + act + '">+ ' + label + '</button>'; }
function subTitle() { return ''; }

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
    let h = subTitle('Purchase Orders', 'GRN/followup only after approval') + '<div class="toolbar">' + seg('f', [{ v: 'appr', l: 'For approval' }, { v: 'open', l: 'Open' }, { v: 'done', l: 'Received' }, { v: 'cancel', l: 'Rejected/Cancelled' }, { v: 'all', l: 'All' }], PO_UI.f) +
      '<input id="poQ" placeholder="PO / vendor / material…" value="' + esc(PO_UI.q || '') + '"><span class="grow"></span>' + (edit ? newBtn('New PO', 'po-new') : '') + '</div>';
    if (PO_UI.form && edit) h = poForm();
    else h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>PO No</th><th>PO Date</th><th>Vendor</th><th class="num">Sr</th><th>Item Name</th><th>Item Code</th><th>Brand</th><th>UOM</th><th class="num">Qty</th><th class="num">Received</th><th class="num">Pending</th><th>Expected</th><th>Status</th><th>Raised By</th><th>Approved By</th><th></th></tr>' +
      (rows.length ? rows.map(p => {
        const st = poStatus(p);
        const act = (st === 'Amend' && edit && (poOwn(p) || isSuperAdmin()) ? '<button class="btn sm primary" data-act="po-edit" data-id="' + esc(p.id) + '">Edit</button>' : '') +
          (edit && (st === 'Open' || st === 'Pending Approval' || st === 'Amend') ? ' <button class="btn ghost sm danger" data-act="po-cancel" data-id="' + esc(p.id) + '" data-confirm="Cancel PO?">Cancel</button>' : '');
        let row = p.lines.map((l, i) => '<tr class="click' + (i === 0 ? ' bomfirst' : '') + '" data-act="po-toggle" data-id="' + esc(p.id) + '"><td><b>' + esc(p.no) + '</b></td><td>' + fmtD(p.date) + '</td><td>' + esc(p.vendor) + '</td><td class="num">' + (i + 1) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(l.brand || '') + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + qtyFmt(num(l.received)) + '</td><td class="num">' + qtyFmt(Math.max(0, num(l.qty) - num(l.received))) + '</td><td>' + fmtD(p.expected) + '</td><td><span class="st ' + poStCls(st) + '">' + st + '</span></td><td>' + esc(p.created_by || '') + '</td><td>' + esc(p.approved_by || '') + '</td><td class="right">' + (i === 0 ? act : '') + '</td></tr>').join('');
        if (PO_UI.open === p.id) row += '<tr class="inline-form"><td colspan="16">' + poDetail(p) + '</td></tr>';
        return row;
      }).join('') : '<tr><td colspan="16" class="empty">No purchase orders</td></tr>') + '</table></div>';
    setMain(h);
    if (PO_UI.form && edit) poFormSetup();
    onSeg(e => { if (e.target.dataset.seg === 'poMode') { PO_UI.mode = e.detail; poFormSetup(); const v = vendorBy($('#npVen').value); if (v && e.detail === 'jc') poFillJc(v.name); return; } PO_UI.f = e.detail; VIEWS.po.render(); });
    const poQ = $('#poQ'); if (poQ) poQ.addEventListener('input', e => { PO_UI.q = e.target.value; clearTimeout(PO_UI.t); PO_UI.t = setTimeout(() => { VIEWS.po.render(); const i = $('#poQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};
// the person who raised a PO never approves it; only the Super Admin (system role) is exempt
function poOwn(p) { return !!ME && ((p.created_by_id && p.created_by_id === ME.id) || (!p.created_by_id && p.created_by === ME.name)); }
function canApprovePo(p) { return canApprove() && (!poOwn(p) || isSuperAdmin()); }
function poDetail(p) {
  return poDocHtml(p) + '<div class="toolbar noprint" style="margin-top:8px"><button class="btn sm" data-act="po-print" data-id="' + p.id + '">Print</button></div>';
}
ACTIONS['po-toggle'] = (el, ev) => { if (ev.target.closest('button')) return; PO_UI.open = PO_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.po.render(); };
function poForm() {
  const ed = PO_UI.editId ? Store.get('purchase_orders', PO_UI.editId) : null;
  const lastAmend = ed && (ed.amend_log || []).length ? ed.amend_log[ed.amend_log.length - 1] : null;
  return '<div class="card"><div class="card-b">' + dlVendor() + dlMat('dlMatPo') + '<datalist id="dlBrandPo">' + Store.all('customers').map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' +
    (lastAmend ? '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px"><b>' + esc(ed.no) + '</b> \u2014 ' + esc(lastAmend.remark) + ' <span class="muted small">(' + esc(lastAmend.by) + ', ' + fmtDT(lastAmend.at) + ')</span></div>' : '') +
    '<div class="row">' + (ed ? '' : '<label>Mode' + seg('poMode', [{ v: 'jc', l: 'From JC requirement' }, { v: 'manual', l: 'Manual' }], PO_UI.mode || 'jc') + '</label>') +
    '<label>Vendor *<input id="npVen" list="dlVen" value="' + esc(ed ? ed.vendor : '') + '"' + (ed ? ' readonly' : '') + '></label><label>PO date<input id="npDate" type="date" value="' + esc(ed ? ed.date : todayYmd()) + '"></label><label>Expected delivery *<input id="npExp" type="date" value="' + esc(ed ? ed.expected : '') + '"></label><label style="flex:1">Remarks<input id="npRem" value="' + esc(ed ? ed.remarks || '' : '') + '"></label></div>' +
    '<div id="npHint" class="muted small" style="margin:6px 0"></div>' +
    '<table style="margin-top:4px"><tr id="npHead"></tr><tbody id="npLines"></tbody></table><a class="small" data-act="po-line" id="npAdd">+ material</a>' +
    '</div><div class="card-f"><button class="btn primary" data-act="po-save">' + (ed ? 'Save & send for approval' : 'Save PO') + '</button><button class="btn" data-act="po-new">Close</button><span id="npMsg" class="small"></span></div></div>';
}
function poFormSetup() {
  if (PO_UI.editId) PO_UI.mode = 'manual';
  const mode = PO_UI.mode || 'jc';
  $('#npHead').innerHTML = mode === 'manual'
    ? '<th>Item Name</th><th>Category</th><th>Code</th><th>HSN</th><th>UOM</th><th>Brand *</th><th class="num">Rate</th><th class="num">GST %</th><th>Remark</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Total</th><th></th>'
    : '<th>Photo</th><th>Item Name</th><th>Category</th><th>Code</th><th>HSN</th><th>UOM</th><th>Brand</th><th class="num" style="width:90px">Rate</th><th class="num" style="width:70px">GST %</th><th style="width:160px">Remark</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Total</th>';
  $('#npAdd').classList.toggle('hidden', mode !== 'manual');
  const ed = PO_UI.editId ? Store.get('purchase_orders', PO_UI.editId) : null;
  $('#npLines').innerHTML = ed ? ed.lines.map(l => poLineRow(l)).join('') : mode === 'manual' ? poLineRow() : '';
  const tb = $('#npLines').closest('table');
  if (!$('#npFoot', tb)) tb.insertAdjacentHTML('beforeend', '<tr id="npFoot"></tr>');
  $('#npFoot').innerHTML = '';
  if (!document.getElementById('dlJcPo')) document.body.insertAdjacentHTML('beforeend', '<datalist id="dlJcPo"></datalist>');
  document.getElementById('dlJcPo').innerHTML = Store.all('job_cards').filter(j => j.status !== 'Closed').map(j => '<option value="' + esc(j.no) + '">').join('');
  $('#npHint').textContent = '';
}
// JC mode: rows come from the net requirement split over JCs; qty is computed, never typed.
// An MOQ override may raise one item's qty above net — it is logged on the PO and mailed to the alert person.
function poFillJc(vendor) {
  PO_UI.vendor = vendor; PO_UI.net = netReqRows(vendor).filter(r => r.net > 0.0001);
  PO_UI.moq = {}; PO_UI.ed = {};
  poJcDraw();
}
// one line per item (POs are item-wise, not job-card-wise); an MOQ override raises that item's qty
function poJcLines() {
  return (PO_UI.net || []).map(r => {
    const m = matBy(r.material) || {}; const o = PO_UI.moq[r.material];
    const jcs = r.jcs.map(x => jcBy(x.jc)).filter(Boolean);
    return { key: r.material, r, m, qty: o && o.qty > r.net + 1e-9 ? o.qty : r.net, moq: !!(o && o.qty > r.net + 1e-9),
      brand: Array.from(new Set(jcs.map(j => j.brand).filter(Boolean))).join(', '), photo: m.photo || '' };
  });
}
function poJcDraw() {
  const lines = poJcLines(); const vendor = PO_UI.vendor;
  const src = Store.all('sourcing');
  let q = 0, amt = 0, tot = 0;
  const html = lines.map(L => {
    const e = PO_UI.ed[L.key] || {};
    const rate = e.rate != null ? e.rate : ((src.find(x => norm(x.material) === norm(L.r.material) && norm(x.vendor) === norm(vendor)) || {}).rate || L.m.price || '');
    const gst = e.gst != null ? e.gst : (L.m.gst != null ? L.m.gst : '');
    const rem = e.rem != null ? e.rem : (L.moq ? 'MOQ: net ' + qtyFmt(L.r.net) + ' → ' + qtyFmt(L.qty) : !L.r.demand && L.r.min ? 'Min level' : '');
    const a2 = num(L.qty) * num(rate); const g2 = a2 * (1 + num(gst) / 100); q += num(L.qty); amt += a2; tot += g2;
    return '<tr data-jrow data-key="' + esc(L.key) + '"' + (L.moq ? ' class="moqrow"' : '') + '><td>' + photoThumb(L.photo) + '</td>' +
      '<td><b>' + esc(L.m.name || L.r.material) + '</b></td><td>' + esc(L.m.group || '') + '</td><td>' + esc(L.r.material) + '</td><td>' + esc(L.m.hsn || '') + '</td><td>' + esc(L.m.uom || '') + '</td>' +
      '<td>' + (L.brand ? esc(L.brand) : '<input data-jbrand list="dlBrandPo" style="width:120px" value="' + esc((PO_UI.ed[L.key] || {}).brand || '') + '">') + '</td>' +
      '<td><input class="qty" type="number" min="0" step="any" data-jrate value="' + esc(rate) + '"></td><td><input class="qty" type="number" min="0" step="any" data-jgst value="' + esc(gst) + '"></td>' +
      '<td><input data-jrem value="' + esc(rem) + '"></td>' +
      '<td class="num"><b>' + qtyFmt(L.qty) + '</b>' + '<div><a class="small" data-act="po-moq" data-m="' + esc(L.r.material) + '">' + (L.moq ? 'MOQ ✎' : 'MOQ') + '</a></div>' + '</td>' +
      '<td class="num">' + money(a2) + '</td><td class="num">' + money(g2) + '</td></tr>' +
      (PO_UI.moqOpen === L.r.material ? '<tr class="inline-form"><td colspan="13"><div class="row">' +
        '<span class="small">Net requirement <b>' + qtyFmt(L.r.net) + ' ' + esc(L.m.uom || '') + '</b></span>' +
        '<label>MOQ (min order qty) *<input id="moqQty" type="number" min="0" step="any" value="' + esc((PO_UI.moq[L.r.material] || {}).qty || L.r.moq || '') + '"></label>' +
        '<label style="flex:1">Reason *<input id="moqWhy" value="' + esc((PO_UI.moq[L.r.material] || {}).reason || 'Vendor minimum order quantity') + '"></label>' +
        '<button class="btn primary sm" data-act="po-moq-set" data-m="' + esc(L.r.material) + '">Apply MOQ</button>' +
        (PO_UI.moq[L.r.material] ? '<button class="btn sm" data-act="po-moq-clear" data-m="' + esc(L.r.material) + '">Remove MOQ</button>' : '') + '</div></td></tr>' : '');
  }).join('');
  $('#npLines').innerHTML = lines.length ? html : '<tr><td colspan="13" class="empty">Nothing to order from this vendor — net requirement is covered by stock and open POs.</td></tr>';
  const f = $('#npFoot'); if (f) f.innerHTML = lines.length ? '<td colspan="10" class="right"><b>Total</b></td><td class="num"><b>' + qtyFmt(q) + '</b></td><td class="num"><b>' + money(amt) + '</b></td><td class="num"><b>' + money(tot) + '</b></td>' : '';
  $('#npHint').innerHTML = '';
}
document.addEventListener('input', e => {
  const tr = e.target.closest && e.target.closest('#npLines tr[data-jrow]'); if (!tr) return;
  const k = tr.dataset.key; const ed = PO_UI.ed[k] || (PO_UI.ed[k] = {});
  if (e.target.dataset.jrate != null) ed.rate = e.target.value;
  else if (e.target.dataset.jgst != null) ed.gst = e.target.value;
  else if (e.target.dataset.jrem != null) { ed.rem = e.target.value; return; }
  else if (e.target.dataset.jbrand != null) { ed.brand = e.target.value; return; }
  else return;
  clearTimeout(PO_UI.dt); PO_UI.dt = setTimeout(() => { const pos = e.target.selectionStart; const sel = '[data-key="' + k + '"] ' + (e.target.dataset.jrate != null ? '[data-jrate]' : '[data-jgst]'); poJcDraw(); const x = $(sel); if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch (err) {} } }, 400);
});
ACTIONS['po-moq'] = el => { PO_UI.moqOpen = PO_UI.moqOpen === el.dataset.m ? null : el.dataset.m; poJcDraw(); const i = $('#moqQty'); if (i) i.focus(); };
ACTIONS['po-moq-set'] = el => {
  const r = (PO_UI.net || []).find(x => x.material === el.dataset.m); if (!r) return;
  const q = num($('#moqQty').value); const why = $('#moqWhy').value.trim();
  if (!why) { flash('Reason is required for an MOQ order.', 'err'); return; }
  if (q <= r.net + 1e-9) { flash('MOQ ' + qtyFmt(q) + ' is not above the net requirement ' + qtyFmt(r.net) + ' — no MOQ needed.', 'err'); return; }
  PO_UI.moq[r.material] = { qty: q, reason: why }; PO_UI.moqOpen = null; poJcDraw();
};
ACTIONS['po-moq-clear'] = el => { delete PO_UI.moq[el.dataset.m]; PO_UI.moqOpen = null; poJcDraw(); };
function poLineRow(l) {
  l = l || {}; const m = l.material ? (matBy(l.material) || {}) : {};
  const a2 = num(l.qty) * num(l.rate), g2 = a2 * (1 + num(l.gst) / 100);
  return '<tr data-mline><td><input data-np="mat" list="dlMatPo" placeholder="Item Name" value="' + esc(m.name || '') + '"></td><td class="muted small" data-np-cat>' + esc(m.group || '') + '</td><td class="muted" data-np-code>' + esc(m.code || '') + '</td><td class="muted small" data-np-hsn>' + esc(m.hsn || '') + '</td><td class="muted" data-uom>' + esc(m.uom || '') + '</td>' +
    '<td><input data-np="brand" list="dlBrandPo" style="width:120px" value="' + esc(l.brand || '') + '"></td>' +
    '<td><input data-np="rate" type="number" min="0" step="any" class="right" style="width:80px" value="' + esc(l.rate != null ? l.rate : '') + '"></td><td><input data-np="gst" type="number" min="0" step="any" class="right" style="width:60px" value="' + esc(l.gst != null ? l.gst : '') + '"></td>' +
    '<td><input data-np="rem" style="width:120px" value="' + esc(l.remark || '') + '"></td>' +
    '<td><input data-np="qty" type="number" min="0" step="any" class="right" style="width:80px" value="' + esc(l.qty || '') + '"></td><td class="num muted" data-np-amt>' + (a2 ? money(a2) : '0') + '</td><td class="num muted" data-np-tot>' + (a2 ? money(g2) : '0') + '</td><td><button class="btn ghost sm" data-act="po-line-del">\u00d7</button></td></tr>';
}
function poManualRecalc() {
  let q = 0, amt = 0, net = 0;
  $$('#npLines tr[data-mline]').forEach(tr => { const a2 = num($('[data-np="qty"]', tr).value) * num($('[data-np="rate"]', tr).value); const g = a2 * (1 + num($('[data-np="gst"]', tr).value) / 100); $('[data-np-amt]', tr).textContent = a2 ? money(a2) : '0'; $('[data-np-tot]', tr).textContent = a2 ? money(g) : '0'; q += num($('[data-np="qty"]', tr).value); amt += a2; net += g; });
  const f = $('#npFoot'); if (f) f.innerHTML = '<td><b>Total:</b></td><td colspan="8"></td><td class="num"><b>' + qtyFmt(q) + '</b></td><td class="num"><b>' + money(amt) + '</b></td><td class="num"><b>' + money(net) + '</b></td><td></td>';
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('tr[data-mline]')) poManualRecalc(); });
ACTIONS['po-new'] = () => { PO_UI.form = !PO_UI.form; PO_UI.editId = null; VIEWS.po.render(); if (PO_UI.form) $('#npVen').focus(); };
ACTIONS['po-edit'] = el => { PO_UI.form = true; PO_UI.editId = el.dataset.id; VIEWS.po.render(); poManualRecalc(); window.scrollTo(0, 0); };
document.addEventListener('change', e => { if (e.target.id === 'npVen' && (PO_UI.mode || 'jc') === 'jc') { const v = vendorBy(e.target.value); PO_UI.moqOpen = null; if (v) poFillJc(v.name); } });
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
  const q = $('[data-np="qty"]', tr); if (!q.value) { const nr = netReqRows(null, PO_UI.editId).find(x => norm(x.material) === norm(m.code)); q.value = nr && nr.net > 0 ? +nr.net.toFixed(3) : ''; }
  poManualRecalc();
});
ACTIONS['po-save'] = () => {
  if (!requirePerm('purchase', 'edit')) return;
  const ven = $('#npVen').value.trim(); const exp = $('#npExp').value;
  { const vv = vendorBy(ven); if (vv && vendorMissing(vv).length) { vendorDialog(vv); return; } }
  const mode = PO_UI.mode || 'jc';
  const lines = mode === 'manual'
    ? $$('#npLines tr[data-mline]').map(tr => { const m = Store.all('materials').find(x => norm(x.name) === norm($('[data-np="mat"]', tr).value) || norm(x.code) === norm($('[data-np="mat"]', tr).value)); return m ? { material: m.code, uom: m.uom, qty: num($('[data-np="qty"]', tr).value), rate: num($('[data-np="rate"]', tr).value), gst: num($('[data-np="gst"]', tr).value), remark: $('[data-np="rem"]', tr).value.trim(), brand: $('[data-np="brand"]', tr).value.trim(), jc_no: '', received: 0, rejected: 0 } : null; }).filter(l => l && l.qty > 0)
    : poJcLines().map(L => { const tr = $('#npLines tr[data-key="' + L.key + '"]'); return { material: L.r.material, uom: L.m.uom || '', qty: L.qty, rate: num($('[data-jrate]', tr).value), gst: num($('[data-jgst]', tr).value), remark: $('[data-jrem]', tr).value.trim(), jc_no: '', brand: L.brand || ($('[data-jbrand]', tr) || { value: '' }).value.trim(), moq: L.moq, net: L.r.net, received: 0, rejected: 0 }; });
  const brandNames = Store.all('customers').map(c => norm(c.name));
  const noBrand = lines.find(l => !l.brand || l.brand.split(',').some(b => !brandNames.includes(norm(b))));
  if (noBrand) { $('#npMsg').innerHTML = '<span class="late-txt">' + esc(noBrand.material) + ': select a Brand from the CDB list.</span>'; return; }
  // never above net requirement (fresh figures) unless an MOQ override is logged for that item
  const freshNet = {}; netReqRows(ven).forEach(r => { freshNet[norm(r.material)] = r.net; });
  const allNet = {}; netReqRows(null, PO_UI.editId).forEach(r => { allNet[norm(r.material)] = r.net; });
  if (PO_UI.editId) (Store.get('purchase_orders', PO_UI.editId).moq_log || []).forEach(x => { const k = norm(x.material); if (allNet[k] != null) allNet[k] = Math.max(allNet[k], num(x.moq)); });
  const byMat = {}; lines.forEach(l => { byMat[norm(l.material)] = (byMat[norm(l.material)] || 0) + num(l.qty); });
  for (const k of Object.keys(byMat)) {
    const cap = mode === 'manual' ? allNet[k] : Math.max(freshNet[k] || 0, ((PO_UI.moq || {})[(matBy(k) || {}).code] || {}).qty || 0);
    if (cap != null && byMat[k] > cap + 1e-6) { $('#npMsg').innerHTML = '<span class="late-txt">' + esc((matBy(k) || {}).code || k) + ': qty ' + qtyFmt(byMat[k]) + ' is more than the net requirement ' + qtyFmt(cap) + (mode === 'manual' ? ' — use From JC requirement (with MOQ if the vendor needs it).' : ' — refresh the vendor to recalculate.') + '</span>'; return; }
  }
  const moqLog = mode === 'manual' ? [] : Object.keys(PO_UI.moq || {}).map(code => { const r = (PO_UI.net || []).find(x => x.material === code) || {}; return { material: code, net: r.net || 0, moq: PO_UI.moq[code].qty, extra: PO_UI.moq[code].qty - (r.net || 0), reason: PO_UI.moq[code].reason, by: ME.name, at: nowIso() }; });
  if (!ven || !exp || !lines.length) { $('#npMsg').innerHTML = '<span class="late-txt">Vendor, expected date and at least one material line are required.</span>'; return; }
  const vm = vendorBy(ven);
  if (!vm) { $('#npMsg').innerHTML = '<span class="late-txt">Vendor is not in the master — add it in Purchase → Vendors first (with GST/mobile).</span>'; return; }
  if (!vm.mobile && !vm.email) { $('#npMsg').innerHTML = '<span class="late-txt">Add the vendor mobile or email in the vendor master to create a PO.</span>'; return; }
  const bad = lines.find(l => !matBy(l.material)); if (bad) { $('#npMsg').innerHTML = '<span class="late-txt">Material "' + esc(bad.material) + '" is not in the master — add it in Store → Materials first.</span>'; return; }
  // double-submit guard: same vendor + same lines within 60s
  const sig = norm(ven) + '|' + lines.map(l => l.material + ':' + l.qty).sort().join(',');
  if (PO_UI.editId) {
    const ep = Store.get('purchase_orders', PO_UI.editId);
    if (!ep || ep.approval !== 'Amend') { $('#npMsg').innerHTML = '<span class="late-txt">This PO is no longer open for amendment.</span>'; return; }
    Object.assign(ep, { date: $('#npDate').value || ep.date, expected: exp, remarks: $('#npRem').value.trim(), lines, approval: 'Pending' });
    ep.edit_log = (ep.edit_log || []).concat([{ by: ME.name, at: nowIso() }]);
    Store.put('purchase_orders', ep); audit('po.amended', ep.no, 'resubmitted for approval'); waSend('po_submitted', ep.id);
    PO_UI.form = false; PO_UI.editId = null; flash(esc(ep.no) + ' updated and sent for approval.'); VIEWS.po.render(); return;
  }
  const dup = Store.all('purchase_orders').find(p => p._sig === sig && (Date.now() - new Date(p.at)) < 60000);
  if (dup) { $('#npMsg').innerHTML = '<span class="late-txt">An identical PO ' + esc(dup.no) + ' was just created (double-submit guard).</span>'; return; }
  const po = Store.put('purchase_orders', { id: uid(), no: fyNo('purchase_orders', 'PO', 3), date: $('#npDate').value || todayYmd(), vendor: vm.name, expected: exp, remarks: $('#npRem').value.trim(), lines, moq_log: moqLog, followups: [], approval: 'Pending', created_by: ME.name, created_by_id: ME.id, at: nowIso(), _sig: sig });
  audit('po.create', po.no, ven + ' · ' + qtyFmt(lines.reduce((s, l) => s + l.qty, 0)) + ' qty'); waSend('po_submitted', po.id);
  let mailNote = '';
  if (moqLog.length) {
    moqLog.forEach(x => audit('po.moq_override', po.no, x.material + ' net ' + qtyFmt(x.net) + ' → ' + qtyFmt(x.moq) + ' (+' + qtyFmt(x.extra) + ') · ' + x.reason));
    const to = String(settings().alert_moq_email || '').trim();
    const body = 'PO ' + po.no + ' (' + vm.name + ') was raised above the net requirement because of MOQ.\n\n' +
      moqLog.map(x => x.material + ' ' + ((matBy(x.material) || {}).name || '') + ': net ' + qtyFmt(x.net) + ', ordered ' + qtyFmt(x.moq) + ' (+' + qtyFmt(x.extra) + '). Reason: ' + x.reason).join('\n') + '\n\nRaised by ' + ME.name + '.';
    Store.put('mail_queue', { id: uid(), to, subject: 'MOQ over-order on ' + po.no + ' — ' + vm.name, body, ref: po.no, status: to ? 'queued' : 'no_recipient', at: nowIso(), by: ME.name });
    mailNote = to ? ' MOQ alert queued for ' + esc(to) + '.' : ' <b>Set the MOQ alert email in Settings</b> — the alert is logged but has no recipient.';
  }
  PO_UI.form = false; PO_UI.moq = {}; flash(esc(po.no) + ' saved — <b>approval pending</b>.' + mailNote); VIEWS.po.render();
};
ACTIONS['po-cancel'] = el => { const p = Store.get('purchase_orders', el.dataset.id); p.cancelled = true; Store.put('purchase_orders', p); audit('po.cancel', p.no, ''); VIEWS.po.render(); };

VIEWS.netreq = {
  mod: 'purchase', render() {
    const rows = netReqRows();
    const toOrder = rows.filter(r => r.net > 0);
    setMain(subTitle('Net Requirement', 'JC requirement − stock − open PO + min level') +
      '<div class="toolbar"><span class="small"><b>' + toOrder.length + '</b> item(s) to order</span><span class="grow"></span>' + (can('purchase', 'edit') ? '<a class="btn primary" data-act="netreq-po">+ New PO</a>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th>Supplier</th><th class="num">JC Balance</th><th class="num">Total JC Requirement</th><th class="num">Stock</th><th class="num">Open PO</th><th class="num">Min Level</th><th class="num">Net Requirement</th></tr>' +
      (rows.length ? rows.map(r => (r.jcs.length ? r.jcs : [{ jc: '', bal: 0, supplier: Array.from(r.suppliers)[0] || '' }]).map((x, i) => '<tr class="' + (i === 0 ? 'bomfirst' : '') + (r.net > 0 ? '' : ' muted') + '"><td><b>' + esc(r.material) + '</b></td><td>' + esc(r.name) + '</td><td>' + esc(r.uom) + '</td><td>' + esc(x.jc) + '</td><td>' + esc(x.brand || '') + '</td><td>' + esc(x.article || '') + '</td><td>' + esc(x.colour || '') + '</td><td>' + esc(x.supplier || '') + '</td><td class="num">' + (x.jc ? qtyFmt(x.bal) : '') + '</td>' +
        '<td class="num">' + qtyFmt(r.demand) + '</td><td class="num">' + qtyFmt(r.stock) + '</td><td class="num">' + qtyFmt(r.openPo) + '</td><td class="num">' + (r.min ? qtyFmt(r.min) : '') + '</td><td class="num"><b' + (r.net > 0 ? ' class="late-txt"' : '') + '>' + qtyFmt(r.net) + '</b></td></tr>').join('')).join('')
        : '<tr><td colspan="14" class="empty">No open JC requirement</td></tr>') + '</table></div>');
  }
};
ACTIONS['netreq-po'] = () => { PO_UI.form = true; PO_UI.mode = 'jc'; go('po'); };

VIEWS.sourcing = {
  mod: 'purchase', render() {
    masterView({
      col: 'sourcing', mod: 'purchase', title: 'Sourcing', view: VIEWS.sourcing, sort: 'material', paste: true,
      cols: [{ k: 'material', l: 'Material', w: 140, upper: true }, { k: 'vendor', l: 'Vendor' }, { k: 'rate', l: 'Rate ₹', type: 'number', w: 90 }, { k: 'moq', l: 'MOQ', type: 'number', w: 80 }, { k: 'lead_days', l: 'Lead days', type: 'number', w: 80 }, { k: 'remark', l: 'Remark' }],
      validate: d => !String(d.material || '').trim() ? 'Material is required.' : !String(d.vendor || '').trim() ? 'Vendor is required.' : (Store.all('sourcing').some(x => x.id !== d.id && norm(x.material) === norm(d.material) && norm(x.vendor) === norm(d.vendor)) ? 'This material+vendor already exists.' : '')
    });
    $('#main').insertAdjacentHTML('beforeend', '');
  }
};

VIEWS.followup = {
  mod: 'purchase', render() {
    const edit = can('purchase', 'edit');
    const rows = openPOs().map(p => { const f = (p.followups || []).slice(-1)[0]; return { p, f }; })
      .sort((a, b) => ((a.f && a.f.next) || '0') < ((b.f && b.f.next) || '0') ? -1 : 1);
    let h = '<div class="tbl-wrap"><table class="bomflat"><tr><th>PO No</th><th>Vendor</th><th class="num">Pending Qty</th><th>Expected</th><th>Last Followup</th><th>Followup By</th><th>Followup Date</th><th>Next Followup</th>' + (edit ? '<th>New Followup</th><th>Next Date</th><th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(x => '<tr><td><b>' + esc(x.p.no) + '</b></td><td>' + esc(x.p.vendor) + '</td><td class="num">' + qtyFmt(poPending(x.p)) + '</td><td class="' + (x.p.expected < todayYmd() ? 'late-txt' : '') + '">' + fmtD(x.p.expected) + '</td>' +
        '<td>' + (x.f ? esc(x.f.note) : '') + '</td><td>' + (x.f ? esc(x.f.by) : '') + '</td><td>' + (x.f ? fmtD(x.f.at) : '') + '</td><td class="' + (x.f && x.f.next && x.f.next <= todayYmd() ? 'late-txt' : '') + '">' + (x.f ? fmtD(x.f.next) : '') + '</td>' +
        (edit ? '<td><input data-fu-note style="min-width:160px"></td><td><input data-fu-next type="date" style="width:130px"></td><td><button class="btn sm" data-act="fu-save" data-id="' + esc(x.p.id) + '">Save</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="11" class="empty">No open POs</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['fu-save'] = el => {
  const tr = el.closest('tr'); const note = $('[data-fu-note]', tr).value.trim(); const next = $('[data-fu-next]', tr).value;
  if (!note) { flash('Enter a followup note.', 'err'); return; }
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
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>JC No</th><th>JC Date</th><th>Order</th><th>Brand</th><th>Article</th><th>Style</th><th>Colour</th><th class="num">Qty</th><th>Material</th><th>Swatch</th><th>Corrections</th><th>Status</th><th>By</th><th></th></tr>' +
      (rows.length ? rows.map(j => {
        const oc = (j.corrections || []).filter(x => !x.resolved).length;
        const L = j.lines || []; const req = L.reduce((s2, l) => s2 + num(l.required), 0);
        const iss = L.reduce((s2, l) => s2 + Math.min(num(l.required), issuedToJc(j.no, l.material)), 0);
        const ready = req ? Math.round(iss / req * 100) : null;
        let row = '<tr class="click" data-act="jc-toggle" data-id="' + esc(j.id) + '"><td><b>' + esc(j.no) + '</b></td><td>' + fmtD(j.at) + '</td><td>' + esc(j.order_no || '') + '</td><td>' + esc(j.brand) + '</td><td>' + esc(j.article) + '</td><td>' + esc(j.style || '') + '</td><td>' + esc(j.colour || '') + '</td><td class="num">' + qtyFmt(j.qty) + '</td>' +
          '<td>' + (ready == null ? '<span class="late-txt small">No BOM</span>' : '<span class="' + (ready >= 100 ? 'st Done' : 'small') + '">' + ready + '% issued</span>') + '</td>' +
          '<td><span class="st ' + (j.swatch_status === 'Approved' ? 'Done' : j.swatch_status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(j.swatch_status) + '</span></td><td>' + (oc ? '<span class="late-txt">' + oc + ' open</span>' : (j.corrections || []).length ? 'resolved' : '—') + '</td><td>' + stHtml(j.status === 'Closed' ? 'Done' : 'Pending').replace('>Done<', '>Closed<').replace('>Pending<', '>Open<') + '</td>' +
          '<td>' + esc(j.by || '') + '</td><td class="right">' + (edit && j.status !== 'Closed' ? '<button class="btn sm" data-act="jc-close" data-id="' + esc(j.id) + '" data-confirm="Close JC?">Close</button>' : '') + '</td></tr>';
        if (JC_UI.open === j.id) row += '<tr class="inline-form"><td colspan="14">' + jcDetail(j) + '</td></tr>';
        return row;
      }).join('') : '<tr><td colspan="14" class="empty">No job cards</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => {
      if (e.target.dataset.seg === 'f') { JC_UI.f = e.detail; VIEWS.jobcards.render(); return; }
    });
    if (JC_UI.form) jcFormWire();
  }
};
function jcDetail(j) {
  // Screen view mirrors the printed Job Card exactly; procurement numbers follow below.
  let h = jcDocHtml(j);
  const L = j.lines || [];
  if (!L.length) h += '<div class="muted small" style="margin:6px 0">No BOM was found — create the BOM in Development, then recreate the JC.</div>';
  if (L.length) {
    h += '<h2>Material Status</h2><table style="max-width:860px;margin:4px 0"><tr><th>Item</th><th>Code</th><th class="num">Req.Qty</th><th class="num">PO raised</th><th class="num">Transit</th><th class="num">Reserved</th><th class="num">Issued (net)</th><th class="num">Balance to issue</th></tr>' +
      L.map(l => { const issd = issuedToJc(j.no, l.material); const pen = Math.max(0, num(l.required) - issd); const m = matBy(l.material) || {}; return '<tr><td>' + esc(m.name || l.material) + '</td><td>' + esc(l.material) + '</td><td class="num">' + qtyFmt(l.required) + '</td><td class="num">' + qtyFmt(l.po_raised) + '</td><td class="num muted">' + qtyFmt(transitOf(l.material)) + '</td><td class="num">' + qtyFmt(reservedOf(l.material, j.no)) + '</td><td class="num">' + qtyFmt(issd) + '</td><td class="num ' + (pen ? 'late-txt' : '') + '">' + (pen ? qtyFmt(pen) : '—') + '</td></tr>'; }).join('') + '</table>';
  }
  h += '<div class="toolbar noprint" style="margin:8px 0 2px"><button class="btn sm primary" data-act="print-jc" data-id="' + esc(j.id) + '">Print Job Card</button></div>';
  return h;
}
function jcForm() {
  // JC picker: every open order line's JC number that has no job card yet
  const used = new Set(Store.all('job_cards').map(j => norm(j.no)));
  const picks = Store.all('orders').filter(o => orderState(o).open)
    .flatMap(o => (o.lines || []).filter(l => l.jc_no && !used.has(norm(l.jc_no)))
      .map(l => '<option value="' + esc(l.jc_no) + '">' + esc(o.customer_name + ' · ' + l.article + (l.colour ? ' ' + l.colour : '') + ' · ' + qtyFmt(l.qty)) + '</option>')).join('');
  return '<div class="card"><div class="card-b"><datalist id="dlJcPick">' + picks + '</datalist>' +
    '<input type="hidden" id="jfOrd"><input type="hidden" id="jfLine"><input type="hidden" id="jfNo">' +
    '<div class="jcdoc"><div class="jcban">JOB CARD</div><div class="jcmid">' +
    '<div class="jcl"><table class="jckv" id="jfDetails">' + jcfDetailRows() + '</table></div>' +
    '<label class="jcph jcph-form" title="Click to add the product photo"><span id="jfPhotoTag">PRODUCT PHOTO</span><input type="file" id="jfPhoto" accept="image/*" style="display:none"></label>' +
    '<div class="jcr"><table id="jfSizes" class="jcszt"><tr class="hd"><th>Order No</th><th>Order Date</th><th>SIZE</th><th>Act.Ord</th><th>With 2% Extra</th></tr>' +
    Array.from({ length: 10 }, (x, i) => jcfSizeRow('', '', i === 3 ? 'status' : i === 5 ? 'rem' : '')).join('') +
    '<tr id="jfSzTotal" class="tt"><td></td><td>Total</td><td></td><td id="jfActT">0</td><td id="jfExtT">0</td></tr></table>' +
    '<div class="noprint" style="margin-top:4px"><a class="small" data-act="jcf-size">+ size row</a> <span id="jfSzMsg" class="small"></span></div></div></div></div>' +
    '<h2>Material Requirements BOM</h2><div class="toolbar"><a class="small" data-act="jcf-bomrow">+ Add</a><a class="small" data-act="jcf-paste">Bulk Paste</a><span id="jfBomTag" class="muted small"></span></div>' +
    '<div id="jfPasteBox" class="hidden" style="margin-bottom:6px"><textarea id="jfPaste" rows="5" class="mono" placeholder="PROCESS | SECTION | ITEM NAME | NORMS | SUPPLIER  (one row per line; separate with Tab or | — Excel/Sheets paste works directly. Item name alone also works.)"></textarea> <button class="btn sm" data-act="jcf-paste-go">Import</button></div>' +
    dlMat('dlMatJc') + dlVendor() +
    '<div class="jcdoc"><table id="jfBom" class="jcbom"><tr class="hd"><th style="width:36px">Sr No</th><th style="width:100px">Process</th><th style="width:110px">Section</th><th style="width:120px">Item Category</th><th>Item Name</th><th style="width:90px">Item Code</th><th style="width:60px">Uom</th><th style="width:85px">Norms</th><th style="width:90px">Required Qty</th><th style="width:150px">Supplier</th><th style="width:26px"></th></tr></table></div>' +
    '</div><div class="card-f"><button class="btn primary" data-save data-act="jc-save">Submit Job Card</button><button class="btn" data-act="jc-new">Close</button><span id="njMsg" class="small"></span></div></div>';
}
function jcfSizeRow(size, act, sp) {
  const c0 = sp === 'rem' ? '<input id="jfRem" autocomplete="off">'
    : sp === 'status' ? '<select id="jfStatus"><option value="NA">NA</option><option>ONLINE</option><option>OFFLINE</option></select>' : '';
  return '<tr data-szrow><td data-c0>' + c0 + '</td><td data-c1></td><td><input data-sz="size" value="' + esc(size || '') + '"></td><td><input data-sz="act" type="number" min="0" value="' + esc(act || '') + '"></td><td data-sz-ext></td></tr>';
}
// Left details table; row 1 holds the JC picker — selecting a JC number fills the whole document
function jcfDetailRows(o, l, jc) {
  o = o || {}; l = l || {};
  const mean = (l.sizes && l.sizes.length) ? l.sizes[Math.floor((l.sizes.length - 1) / 2)].size : '';
  const rows = [['JOB CARD', '<input id="jfJc" list="dlJcPick" placeholder="Select JC No…" value="' + esc(jc || '') + '" autocomplete="off">'],
    ['Date', esc(o.order_date ? fmtD(o.order_date) : '')], ['Brand', esc(o.customer_name || '')], ['Style Name', esc(l.style || '')], ['Colour', esc(l.colour || '')], ['Gender', esc(l.gender || '')],
    ['Category', esc(o.category || '')], ['Last/Tooling', esc(o.tooling_no || '')], ['Mean Size', esc(mean)], ['Article', esc(l.article || '')], ['Size Run', esc(l.size_run || l.size || '')], ['Style Code/No.', o.id ? 'NA' : '']];
  return rows.map(([k, v], i) => '<tr><td class="k">' + k + '</td><td class="v' + (i === 0 ? ' b' : '') + '">' + v + '</td></tr>').join('');
}
// Mirror the printed size panel: Order No/Date on row 1, channel on row 4, packing (highlighted)
// on row 6, and filler rows so the box always holds at least 10 lines.
function jcfDecorate() {
  if (!$('#jfSizes')) return;
  const o = Store.all('orders').find(x => norm(x.no) === norm(($('#jfOrd') || {}).value || '')) || {};
  const li = num(($('#jfLine') || {}).value); const l = o.lines ? jcOrderLine(o, li) : {};
  $$('#jfSizes tr[data-szrow]').forEach((tr, i) => {
    const c0 = $('[data-c0]', tr), c1 = $('[data-c1]', tr);
    c1.textContent = ''; c0.classList.remove('hl'); c1.classList.remove('hl');
    if (i === 5) {
      // remarks are typed right here, in the highlighted packing cell — same as the print
      const inp = $('#jfRem', c0);
      if (inp) inp.placeholder = l.pack ? l.pack.toUpperCase() + ' PACKING' : 'REMARKS…';
      c0.classList.add('hl'); c1.classList.add('hl');
      return;
    }
    if (i === 3) {
      // the channel/status dropdown lives here; NA shows the order's channel, same as the print
      const st = $('#jfStatus', c0);
      if (st && st.options[0]) st.options[0].text = (o.channel || 'NA').toUpperCase();
      return;
    }
    c0.textContent = '';
    if (i === 0) { c0.textContent = ($('#jfNo') || {}).value || ''; c1.textContent = o.order_date ? fmtD(o.order_date) : ''; }
  });
}
document.addEventListener('input', e => { if (e.target.id === 'jfRem' && window.JCF) JCF.rem = e.target.value; });
function jcfBomRow(l) {
  l = l || {}; const m = matBy(l.material) || {};
  return '<tr data-bomrow><td class="c" data-idx></td><td><input data-b="process" value="' + esc(l.process || '') + '"></td><td><input data-b="section" value="' + esc(l.section || '') + '"></td><td><input data-b="category" list="dlCatJc" value="' + esc(l.category || m.group || '') + '"></td>' +
    '<td><input data-b="mat" list="dlMatJc" value="' + esc(m.name || l.material || '') + '"></td><td class="c muted" data-b-code>' + esc(l.material || '') + '</td><td class="c muted" data-b-uom>' + esc(l.uom || m.uom || '') + '</td>' +
    '<td><input data-b="norms" type="number" min="0" step="any" class="right" value="' + esc(l.norms || l.qty || '') + '"></td><td class="c" data-b-req>0</td><td><input data-b="supplier" list="dlVen" value="' + esc(l.supplier || '') + '"></td><td class="c"><a data-act="jcf-bom-del" title="Remove">×</a></td></tr>';
}
function jcfRecalc() {
  let act = 0, ext = 0;
  $$('#jfSizes tr[data-szrow]').forEach(tr => { const a2 = num($('[data-sz="act"]', tr).value); const e2 = Math.ceil(a2 * 1.02); $('[data-sz-ext]', tr).textContent = a2 ? qtyFmt(e2) : ''; act += a2; ext += a2 ? e2 : 0; });
  $('#jfActT').textContent = qtyFmt(act); $('#jfExtT').textContent = qtyFmt(ext);
  const o = Store.all('orders').find(x => norm(x.no) === norm(($('#jfOrd') || {}).value || ''));
  const li = num(($('#jfLine') || {}).value); const oq = o ? num(jcOrderLine(o, li).qty) : 0;
  $('#jfSzMsg').innerHTML = oq && act !== oq ? '<span class="late-txt">Act total ' + qtyFmt(act) + ' ≠ order qty ' + qtyFmt(oq) + '</span>' : (oq ? '<span class="st Done">Act = order qty</span>' : '');
  $$('#jfBom tr[data-bomrow]').forEach((tr, i2) => {
    $('[data-idx]', tr).textContent = i2 + 1;
    const n = num($('[data-b="norms"]', tr).value);
    $('[data-b-req]', tr).textContent = n && ext ? qtyFmt(Math.ceil(n * ext * 1000) / 1000) : '0';
  });
  jcfDecorate();
  return { act, ext };
}
function jcFormWire() {
  const m = $('#main');
  m.insertAdjacentHTML('beforeend', '<datalist id="dlCatJc">' + itemCats().map(c => '<option>' + c + '</option>').join('') + '</datalist>');
  m.addEventListener('input', e => { if (e.target.closest('#jfSizes') || e.target.closest('#jfBom')) jcfRecalc(); });
  m.addEventListener('change', e => {
    if (e.target.id === 'jfJc') {
      const jc = e.target.value.trim().toUpperCase();
      const o = Store.all('orders').find(x => (x.lines || []).some(l2 => norm(l2.jc_no) === norm(jc)));
      if (!o) { if (jc) flash('No open order line has JC ' + esc(jc) + '.', 'err'); return; }
      if (Store.all('job_cards').some(x => norm(x.no) === norm(jc))) { flash('Job card ' + esc(jc) + ' already exists.', 'err'); return; }
      $('#jfOrd').value = o.no;
      $('#jfLine').value = o.lines.findIndex(l2 => norm(l2.jc_no) === norm(jc));
      $('#jfNo').value = jc;
      jcfFillFromOrder();
    }
    if (e.target.id === 'jfPhoto') readImg(e.target.files[0], src => { JCF.photo = src; $('#jfPhotoTag').innerHTML = '<img src="' + src + '">'; });
    if (e.target.dataset.b === 'mat') {
      const mt = matBy(e.target.value); const tr = e.target.closest('tr');
      if (mt) { e.target.value = mt.name; $('[data-b-code]', tr).textContent = mt.code; $('[data-b-uom]', tr).textContent = mt.uom; const c = $('[data-b="category"]', tr); if (!c.value) c.value = mt.group || ''; }
      else { $('[data-b-code]', tr).textContent = ''; $('[data-b-uom]', tr).textContent = ''; }
      jcfRecalc();
    }
  });
  JCF = { photo: '', rem: '' };
  excelGrid($('#jfBom'), { rowSel: 'tr[data-bomrow]', addRow: () => $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow()), importText: jcfImportText });
  m.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('#jfBom')) { e.preventDefault(); ACTIONS['jc-save'](); } });
  jcfRecalc();
}
function jcfFillFromOrder() {
  const o = Store.all('orders').find(x => norm(x.no) === norm($('#jfOrd').value)); if (!o) return;
  const li = num($('#jfLine').value); const l = jcOrderLine(o, li);
  if ($('#jfNo')) $('#jfNo').value = l.jc_no || jcNo();
  $('#jfDetails').innerHTML = jcfDetailRows(o, l, l.jc_no || jcNo());
  // sizes go into the fixed rows (extra rows only beyond 10)
  const szl = (l.sizes && l.sizes.length) ? l.sizes : [{ size: l.size || '', qty: l.qty || '' }];
  while ($$('#jfSizes tr[data-szrow]').length < szl.length) $('#jfSzTotal').insertAdjacentHTML('beforebegin', jcfSizeRow('', '', false));
  $$('#jfSizes tr[data-szrow]').forEach((tr, i) => {
    $('[data-sz="size"]', tr).value = szl[i] ? szl[i].size : '';
    $('[data-sz="act"]', tr).value = szl[i] ? (szl[i].qty || '') : '';
  });
  // BOM auto-load
  const b = jcBomFor(l.article, l.colour);
  $$('#jfBom tr[data-bomrow]').forEach(tr => tr.remove());
  if (b) { b.lines.forEach(x => $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow(x))); $('#jfBomTag').textContent = 'Auto-loaded from BOM (' + b.article + (b.colour ? ' ' + b.colour : '') + ' v' + b.version + ', ' + b.lines.length + ' items)'; if (b.photo && !JCF.photo) { JCF.photo = b.photo; $('#jfPhotoTag').innerHTML = '<img src="' + b.photo + '">'; } }
  else { $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow()); $('#jfBomTag').textContent = ''; flash('No Development BOM for this article — fill the rows manually or create one in Development.', 'err'); }
  jcfRecalc();
}
ACTIONS['jcf-size'] = () => { $('#jfSzTotal').insertAdjacentHTML('beforebegin', jcfSizeRow()); jcfRecalc(); };
ACTIONS['jcf-size-del'] = el => { el.closest('tr').remove(); jcfRecalc(); };
ACTIONS['jcf-bomrow'] = () => { $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow()); jcfRecalc(); };
ACTIONS['jcf-bom-del'] = el => { el.closest('tr').remove(); jcfRecalc(); };
ACTIONS['jcf-paste'] = () => $('#jfPasteBox').classList.toggle('hidden');
function jcfImportText(text) {
  let ok = 0, bad = [];
  const matOf = c => Store.all('materials').find(x => norm(x.name) === norm(c) || norm(x.code) === norm(c));
  text.split(/\r?\n/).forEach(line => {
    const cells = line.split(/\t|\s*\|\s*/).map(x => x.trim());
    if (!cells.join('')) return;
    // find the item-name cell; cells before it are Process, Section; after it Norms (number) and Supplier
    const mi = cells.findIndex(c => c && matOf(c));
    if (mi < 0) { bad.push(cells.find(Boolean) || line.trim()); return; }
    const m = matOf(cells[mi]);
    const before = cells.slice(0, mi), after = cells.slice(mi + 1);
    const isNum = c => /^\d*\.?\d+$/.test(c);
    const ni = after.findIndex(isNum);
    $('#jfBom').insertAdjacentHTML('beforeend', jcfBomRow({
      process: before[0] || '', section: before[1] || '',
      material: m.code, uom: m.uom,
      norms: ni >= 0 ? after[ni] : '',
      supplier: after.find((c, k) => k !== ni && c && !isNum(c)) || ''
    })); ok++;
  });
  if (ok) $$('#jfBom tr[data-bomrow]').forEach(tr => { if (!$('[data-b="mat"]', tr).value.trim() && !$('[data-b="norms"]', tr).value) tr.remove(); });
  jcfRecalc();
  flash(ok + ' items imported.' + (bad.length ? ' Not matched: ' + esc(bad.join(', ')) : ''), bad.length ? 'err' : '');
}
ACTIONS['jcf-paste-go'] = () => { $('#jfPasteBox').classList.add('hidden'); jcfImportText($('#jfPaste').value); };
ACTIONS['jc-new'] = () => { JC_UI.form = !JC_UI.form; VIEWS.jobcards.render(); };
ACTIONS['jc-toggle'] = (el, ev) => { if (ev.target.closest('button')) return; JC_UI.open = JC_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.jobcards.render(); };
ACTIONS['jc-save'] = () => {
  if (!requirePerm('merchant', 'edit')) return;
  const o = Store.all('orders').find(x => norm(x.no) === norm($('#jfOrd').value));
  if (!o || $('#jfLine').value === '') { $('#njMsg').innerHTML = '<span class="late-txt">Select a JC No in the JOB CARD field first.</span>'; return; }
  const l = jcOrderLine(o, num($('#jfLine').value));
  const { act, ext } = jcfRecalc();
  if (act !== num(l.qty)) { $('#njMsg').innerHTML = '<span class="late-txt">Act.Ord total (' + qtyFmt(act) + ') must equal order qty (' + qtyFmt(l.qty) + ').</span>'; return; }
  const sizes = $$('#jfSizes tr[data-szrow]').map(tr => ({ size: $('[data-sz="size"]', tr).value.trim().toUpperCase(), act: num($('[data-sz="act"]', tr).value), extra: Math.ceil(num($('[data-sz="act"]', tr).value) * 1.02) })).filter(x => x.act > 0);
  const lines = $$('#jfBom tr[data-bomrow]').map(tr => {
    const m = matBy($('[data-b="mat"]', tr).value); const n = num($('[data-b="norms"]', tr).value);
    return m && n > 0 ? { process: $('[data-b="process"]', tr).value.trim(), section: $('[data-b="section"]', tr).value.trim(), category: $('[data-b="category"]', tr).value.trim() || m.group || '', material: m.code, uom: m.uom, norms: n, required: Math.ceil(n * ext * 1000) / 1000, supplier: $('[data-b="supplier"]', tr).value.trim(), po_raised: 0 } : null;
  }).filter(Boolean);
  const badNorm = $$('#jfBom tr[data-bomrow]').some(tr => matBy($('[data-b="mat"]', tr).value) && num($('[data-b="norms"]', tr).value) <= 0);
  if (badNorm) { $('#njMsg').innerHTML = '<span class="late-txt">Norms must be greater than 0 for every item.</span>'; return; }
  if (!lines.length) { $('#njMsg').innerHTML = '<span class="late-txt">At least one BOM item (from the master) is required.</span>'; return; }
  const wantNo = (($('#jfNo') || {}).value || l.jc_no || '').trim();
  const useNo = wantNo && !Store.all('job_cards').some(x => norm(x.no) === norm(wantNo)) ? wantNo : jcNo();
  const j = Store.put('job_cards', {
    id: uid(), no: useNo, order_no: o.no, brand: o.customer_name, article: l.article, style: l.style || '', colour: l.colour || '', gender: l.gender || '', category: o.category,
    qty: act, sizes, lines, photo: JCF.photo || '', line_status: (($('#jfStatus') || {}).value || 'NA'), remarks: (($('#jfRem') || {}).value || '').trim(),
    swatch_status: 'Pending', status: 'Open', corrections: [], by: ME.name, at: nowIso()
  });
  audit('jc.create', j.no, o.no + ' · ' + l.article + ' × ' + act + ' · ' + lines.length + ' materials');
  JC_UI.form = false; JCF = null;
  flash(esc(j.no) + ' created — material requirement generated (' + lines.length + ' items, extra +2%). Swatch approval pending.');
  VIEWS.jobcards.render();
};
ACTIONS['jc-close'] = el => { const j = Store.get('job_cards', el.dataset.id); if ((j.corrections || []).some(c => !c.resolved)) { flash('Resolve open corrections first.', 'err'); return; } j.status = 'Closed'; Store.put('job_cards', j); audit('jc.close', j.no, ''); VIEWS.jobcards.render(); };

VIEWS.jccorrection = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit');
    const rows = Store.all('job_cards').filter(j => j.status !== 'Closed');
    let h = '<div class="tbl-wrap"><table class="bomflat"><tr><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th class="num">Sr</th><th>Correction</th><th>By</th><th>Date</th><th>Status</th><th></th>' + (edit ? '<th>Add Correction</th><th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(j => { const cs = (j.corrections || []).length ? j.corrections : [null];
        return cs.map((c, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.brand || '') + '</td><td>' + esc(j.article || '') + '</td><td>' + esc(j.colour || '') + '</td><td class="num">' + (c ? i + 1 : '') + '</td><td>' + (c ? esc(c.note) : '') + '</td><td>' + (c ? esc(c.by || '') : '') + '</td><td>' + (c && c.at ? fmtD(c.at) : '') + '</td><td>' + (c ? (c.resolved ? '<span class="st Done">Resolved</span>' : '<span class="st Pending">Open</span>') : '') + '</td><td>' + (c && !c.resolved && edit ? '<button class="btn sm ghost" data-act="jcc-resolve" data-id="' + esc(j.id) + '" data-i="' + i + '">Resolve</button>' : '') + '</td>' +
          (edit ? (i === 0 ? '<td><input data-jcc-note style="min-width:180px"></td><td><button class="btn sm" data-act="jcc-add" data-id="' + esc(j.id) + '">Add</button></td>' : '<td></td><td></td>') : '') + '</tr>').join(''); }).join('') : '<tr><td colspan="12" class="empty">No open job cards</td></tr>') + '</table></div>';
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
const ISS_UI = { form: false, ret: false };
function pendingIssues() { return Store.all('issues').filter(i => i.status === 'Pending'); }
VIEWS.issuance = {
  mod: 'store', render() {
    const edit = can('store', 'edit'); const appr = canApproveIssue(); const U = ISS_UI;
    const pend = pendingIssues();
    const open = Store.all('requisitions').filter(r => reqIsOpen(r)).sort((a, b) => String(a.no).localeCompare(String(b.no)));
    if (!U.tab || !['iss', 'approve', 'ret', 'lr', 'reg'].includes(U.tab)) U.tab = 'iss';
    let h = '<div class="tabs">' + [['iss', 'Issuance (' + open.length + ')'], ['approve', 'Issue Approvals (' + pend.length + ')'], ['ret', 'Material Return'], ['lr', 'Line Rejection'], ['reg', 'Issue Register']].map(([k, l]) => '<a data-act="iss-tab" data-t="' + k + '" class="' + (U.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';

    if (U.tab === 'approve') {
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Req No</th><th>JC / Dept</th><th>Process</th><th>Line</th><th>Picker Name</th><th>Item Name</th><th>Item Code</th><th class="num">Req Qty</th><th class="num">Issue Qty</th><th>Issue Source</th><th>Issued To</th><th>Issue Type</th><th>Sent By</th><th>Sent At</th>' + (appr ? '<th></th>' : '') + '</tr>' +
        (pend.length ? pend.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td>' + fmtD(i.date) + '</td><td>' + esc(i.req_no || '') + '</td><td>' + esc(i.to_jc || '') + '</td><td>' + esc(i.process || '') + '</td><td>' + esc(i.line || '') + '</td><td>' + esc(i.picker || '') + '</td><td>' + esc((matBy(i.material) || {}).name || '') + '</td><td>' + esc(i.material) + '</td><td class="num">' + (i.req_qty != null ? qtyFmt(i.req_qty) : '') + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(i.source || 'AUTO') + '</td><td>' + esc(i.to_dept || '') + '</td><td>' + esc(i.issue_type || 'Regular') + '</td><td>' + esc(i.by) + '</td><td class="nowrap">' + fmtDT(i.at) + '</td>' +
          (appr ? '<td class="right nowrap"><button class="btn sm primary" data-act="iss-approve" data-id="' + esc(i.id) + '">Approve</button> <button class="btn sm" data-act="iss-amend" data-id="' + esc(i.id) + '">Amend</button> <button class="btn sm ghost danger" data-act="iss-deny" data-id="' + esc(i.id) + '">Reject</button></td>' : '') + '</tr>').join('') : '<tr><td colspan="17" class="empty">No issue approvals pending</td></tr>') + '</table></div>';
    }

    if (U.tab === 'iss') {
      if (U.req && !open.some(r => r.id === U.req)) U.req = '';
      const r0 = U.req ? Store.get('requisitions', U.req) : null;
      const people = Store.all('users').filter(u => u.active !== false).map(u => u.name).sort();
      h += '<div class="card"><div class="card-b"><div class="row"><label>Requisition Slip *<select id="irReq"' + (edit ? '' : ' disabled') + '><option value="">— select —</option>' + open.map(r => '<option value="' + esc(r.id) + '"' + (r.id === U.req ? ' selected' : '') + '>' + esc(r.no + ' · ' + (r.jc_no || r.dept) + ' · ' + (r.line || '') + ' · ' + (r.picker || r.by)) + '</option>').join('') + '</select></label>' +
        '<label>Process<input value="' + esc(r0 ? r0.process || '' : '') + '" readonly></label><label>Line<input value="' + esc(r0 ? r0.line || '' : '') + '" readonly></label><label>Picker Name<input value="' + esc(r0 ? r0.picker || '' : '') + '" readonly></label>' +
        '<label>Issued To *<select id="irTo">' + selOpts(people, U.to || '') + '</select></label>' +
        '<label>Issue Type *<select id="irType">' + ['Regular', 'Sample'].map(x => '<option' + (x === (U.type || 'Regular') ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label></div>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="bomflat nopage" id="irTable"><tr><th class="num">#</th><th>Item Name</th><th>UOM</th><th class="num">Req Qty</th><th>Rack</th><th class="num">RESERVED STOCK</th><th class="num">OPEN STOCK</th><th>Issue Source</th><th class="num">Issue Qty</th></tr>' +
        (!r0 ? '<tr><td colspan="9" class="empty">Select a Requisition Slip</td></tr>' : r0.lines.map((l, i) => {
          const m = matBy(l.material) || {}; const left = lineLeft(r0, l);
          const rs = r0.jc_no ? reservedOf(l.material, r0.jc_no) : 0; const os = openStockOf(l.material);
          const rack = m.rack || ((Store.all('grns').slice().reverse().flatMap(g => g.lines || []).find(x => norm(x.material) === norm(l.material) && x.rack) || {}).rack || '');
          return '<tr data-irow data-mat="' + esc(l.material) + '" data-left="' + left + '" data-rs="' + rs + '" data-os="' + os + '"><td class="num">' + (i + 1) + '</td><td>' + esc(m.name || l.material) + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + qtyFmt(left) + '</td><td>' + esc(rack) + '</td><td class="num">' + qtyFmt(rs) + '</td><td class="num">' + qtyFmt(os) + '</td>' +
            '<td><select data-isrc' + (left <= 0 ? ' disabled' : '') + '><option value="AUTO">Auto</option>' + (r0.jc_no ? '<option value="RSJW">Reserved</option>' : '') + '<option value="OPEN">Open</option></select></td><td><input class="qty right" type="number" min="0" step="any" data-iq value="' + (left > 0 ? Math.min(left, rs + os) : '') + '"' + (left <= 0 ? ' disabled' : '') + '></td></tr>';
        }).join('')) + '</table></div></div>' +
        (r0 ? amendRows(r0) : '') +
        (edit ? '<div class="card-f"><button class="btn primary" data-act="ir-save"' + (r0 ? '' : ' disabled') + '>Issue</button>' + (r0 ? '<button class="btn ghost danger" data-act="req-reject" data-id="' + esc(r0.id) + '" data-confirm="Reject this slip?">Reject slip</button>' : '') + '<span id="irMsg" class="small"></span></div>' : '') + '</div>';
    }

    if (U.tab === 'ret') {
      if (edit) h += '<div class="panel" style="margin-bottom:10px">' + dlMat('dlMatRt') + '<datalist id="dlJc3">' + Store.all('job_cards').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist>' +
        '<div class="row"><label>Job Card *<select id="rtJc">' + selOpts(Store.all('job_cards').map(j => j.no).sort(), '') + '</select></label><label>Material *<select id="rtMat"><option value="">— select —</option>' + Store.all('materials').slice().sort((a2, b2) => String(a2.name).localeCompare(String(b2.name))).map(m => '<option value="' + esc(m.code) + '">' + esc(m.name + ' · ' + m.code) + '</option>').join('') + '</select></label><label>Return Qty *<input id="rtQty" type="number" min="0" style="width:100px"></label><label>Returned By *<select id="rtBy">' + selOpts(Store.all('users').filter(u => u.active !== false).map(u => u.name).sort(), ME.name) + '</select></label><label style="flex:1">Remark<input id="rtRem"></label><button class="btn primary" data-act="ret-save">Return to stock</button><span id="rtMsg" class="small"></span></div></div>';
      h += issueTable(Store.all('issues').filter(i => i.type === 'return').slice().sort((a2, b2) => (b2.at || '') < (a2.at || '') ? -1 : 1));
    }
    if (U.tab === 'lr') {
      if (edit) h += '<div class="panel" style="margin-bottom:10px">' + dlMat('dlMatLr') + dlVendor() + '<datalist id="dlJc4">' + Store.all('job_cards').map(j => '<option value="' + esc(j.no) + '">').join('') + '</datalist>' +
        '<div class="row"><label>Job Card *<select id="lrJc">' + selOpts(Store.all('job_cards').map(j => j.no).sort(), '') + '</select></label><label>Material *<select id="lrMat"><option value="">— select —</option>' + Store.all('materials').slice().sort((a2, b2) => String(a2.name).localeCompare(String(b2.name))).map(m => '<option value="' + esc(m.code) + '">' + esc(m.name + ' · ' + m.code) + '</option>').join('') + '</select></label><label>Rejected Qty *<input id="lrQty" type="number" min="0" step="any"></label>' +
        '<label>Reason<select id="lrWhy">' + LR_REASONS.map(x => '<option>' + x + '</option>').join('') + '</select></label>' +
        '<label>Condition' + seg('lrCond', [{ v: 'used', l: 'Used — not returnable' }, { v: 'unused', l: 'Unused — back to vendor' }], 'used') + '</label>' +
        '<label>Vendor<select id="lrVen">' + selOpts(vendorNames(), '') + '</select></label><label>Remark<input id="lrRem"></label>' +
        '<button class="btn primary" data-act="lr-save">Save line rejection</button><span id="lrMsg" class="small"></span></div></div>';
      h += issueTable(Store.all('issues').filter(i => i.type === 'line_reject' || i.type === 'scrap').slice().sort((a2, b2) => (b2.at || '') < (a2.at || '') ? -1 : 1));
    }

    if (U.tab === 'reg') h += issueTable(Store.all('issues').filter(i => i.status !== 'Pending').slice().sort((a2, b2) => (b2.at || '') < (a2.at || '') ? -1 : 1));

    const mm = setMain(h);
    mm.addEventListener('change', e => { const t = e.target; if (t.id === 'irReq') { ISS_UI.req = t.value; VIEWS.issuance.render(); } else if (t.id === 'irTo') ISS_UI.to = t.value; else if (t.id === 'irType') ISS_UI.type = t.value; });
  }
};
function amendRows(r) {
  const a = Store.all('issues').filter(i => i.req_no === r.no && (i.status === 'Amend' || i.status === 'Rejected'));
  if (!a.length) return '';
  return '<div class="tbl-wrap" style="margin:8px 16px"><table class="bomflat nopage"><tr><th>Issue No</th><th>Item Name</th><th class="num">Issue Qty</th><th>Decision</th><th>Reason</th><th>By</th><th>At</th></tr>' +
    a.map(i => '<tr><td>' + esc(i.no) + '</td><td>' + esc((matBy(i.material) || {}).name || i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td><span class="st ' + (i.status === 'Amend' ? 'Pending' : 'Late') + '">' + (i.status === 'Amend' ? 'Amend' : 'Rejected') + '</span></td><td>' + esc(i.decision_note || '') + '</td><td>' + esc(i.decided_by || i.approved_by || '') + '</td><td class="nowrap">' + fmtDT(i.decided_at || '') + '</td></tr>').join('') + '</table></div>';
}
function issueTable(list) {
  return '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Type</th><th>Req No</th><th>Job Card</th><th>Process</th><th>Line</th><th>Picker Name</th><th>Item Name</th><th>Item Code</th><th class="num">Req Qty</th><th class="num">Qty</th><th>Issue Source</th><th>Issued To</th><th>Issue Type</th><th>Status</th><th>Issued By</th><th>Issued At</th><th>Approved / Decided By</th><th>Approved / Decided At</th><th></th></tr>' +
    (list.length ? list.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + (i.type === 'return' ? 'Return' : i.type === 'line_reject' ? '<span class="late-txt">Line Reject</span>' : i.type === 'scrap' ? 'Write-off' : 'Issue') + '</td><td>' + esc(i.req_no || '') + '</td><td>' + esc(i.to_jc || '') + '</td><td>' + esc(i.process || '') + '</td><td>' + esc(i.line || '') + '</td><td>' + esc(i.picker || '') + '</td><td>' + esc((matBy(i.material) || {}).name || '') + '</td><td>' + esc(i.material) + '</td><td class="num">' + (i.req_qty != null ? qtyFmt(i.req_qty) : '') + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(i.type ? '' : i.source || 'AUTO') + '</td><td>' + esc(i.to_dept || '') + '</td><td>' + esc(i.type ? '' : i.issue_type || 'Regular') + '</td><td><span class="st ' + (i.status === 'Approved' ? 'Done' : i.status === 'Pending' || i.status === 'Amend' ? 'Pending' : 'Cancelled') + '">' + esc(i.status || 'Approved') + '</span></td><td>' + esc(i.by) + '</td><td class="nowrap">' + fmtDT(i.at) + '</td><td>' + esc(i.approved_by || i.decided_by || '') + '</td><td class="nowrap">' + fmtDT(i.approved_at || i.decided_at || '') + '</td><td class="right"><button class="btn sm ghost" data-act="print-iss" data-id="' + esc(i.id) + '">Print</button></td></tr>').join('') : '<tr><td colspan="22" class="empty">No records</td></tr>') + '</table></div>';
}
ACTIONS['iss-tab'] = el => { ISS_UI.tab = el.dataset.t; VIEWS.issuance.render(); };
ACTIONS['lr-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const jc = $('#lrJc').value.trim(); const m = matBy($('#lrMat').value); const qty = num($('#lrQty').value);
  const returnable = segVal($('[data-seg="lrCond"]')) === 'unused';
  if (!jc || !m || qty <= 0) { $('#lrMsg').innerHTML = '<span class="late-txt">JC, material and qty are required.</span>'; return; }
  const net = issuedToJc(jc, m.code);
  if (qty > net + 1e-9) { $('#lrMsg').innerHTML = '<span class="late-txt">Net issued to ' + esc(jc) + ' is only ' + qtyFmt(net) + ' — cannot reject more.</span>'; return; }
  const j = jcBy(jc); const jl = j ? (j.lines || []).find(l => norm(l.material) === norm(m.code)) : null;
  const vendor = returnable ? ($('#lrVen').value.trim() || (jl && jl.supplier) || '') : '';
  if (returnable && !vendor) { $('#lrMsg').innerHTML = '<span class="late-txt">Vendor is required for material that goes back to the vendor.</span>'; return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), type: 'line_reject', material: m.code, qty, to_jc: jc, returnable, vendor, reason: $('#lrWhy').value, remark: $('#lrRem').value.trim(), status: 'Approved', by: ME.name, approved_by: ME.name, at: nowIso() });
  audit('issue.line_reject', i.no, m.code + ' × ' + qty + ' ← ' + jc + (returnable ? ' (returnable to ' + vendor + ')' : ' (not returnable)'));
  flash('Line rejection saved — ' + esc(jc) + ' can be re-issued ' + qtyFmt(qty) + ' as replacement (not excess).'); VIEWS.issuance.render();
};
const LR_REASONS = ['Defective material', 'Damaged in production', 'Wrong cutting', 'Colour / shade mismatch', 'Size mismatch', 'Other'];
ACTIONS['ir-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const msg = t => { $('#irMsg').innerHTML = '<span class="late-txt">' + t + '</span>'; };
  const r = Store.get('requisitions', ISS_UI.req); if (!r || !reqIsOpen(r)) { msg('Select a Requisition Slip.'); return; }
  const to = $('#irTo').value; const typ = $('#irType').value || 'Regular';
  if (!to) { msg('Select Issued To.'); return; }
  const out = []; let bad = '';
  $$('#irTable tr[data-irow]').forEach(tr => {
    if (!$('[data-iq]', tr) || $('[data-iq]', tr).disabled) return;
    const q = num(($('[data-iq]', tr) || {}).value); if (q <= 0) return;
    const src = $('[data-isrc]', tr).value; const left = num(tr.dataset.left); const rs = num(tr.dataset.rs); const os = num(tr.dataset.os);
    const avail = src === 'RSJW' ? rs : src === 'OPEN' ? os : rs + os;
    if (q > left + 1e-9) bad = bad || tr.dataset.mat + ': more than Req Qty.';
    else if (q > avail + 1e-9) bad = bad || tr.dataset.mat + ': stock is only ' + qtyFmt(avail) + '.';
    else out.push({ material: tr.dataset.mat, qty: q, source: src });
  });
  if (bad) { msg(esc(bad)); return; }
  if (!out.length) { msg('Enter an Issue Qty.'); return; }
  const slipNo = r.no + '/' + (new Set(Store.all('issues').filter(i => i.req_no === r.no && i.slip_no).map(i => i.slip_no)).size + 1);
  out.forEach(x => Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), slip_no: slipNo, req_qty: num((r.lines.find(l => norm(l.material) === norm(x.material)) || {}).qty), date: todayYmd(), material: x.material, qty: x.qty, source: x.source, to_jc: r.jc_no || '', to_dept: to, process: r.process || '', line: r.line || '', picker: r.picker || '', issue_type: typ, req_no: r.no, status: 'Pending', by: ME.name, at: nowIso() }));
  r.status = r.lines.every(l => lineLeft(r, l) <= 1e-9) ? 'Sent for Approval' : 'Part Sent'; Store.put('requisitions', r);
  audit('req.issue', r.no, out.map(x => x.material + '×' + x.qty).join(', ') + ' → ' + to);
  ISS_UI.req = ''; flash(esc(r.no) + ': ' + out.length + ' item(s) sent for issue approval.'); VIEWS.issuance.render();
};
function canApproveIssue() { return isAdminRole() || can('issue_approve', 'edit'); }
function reqRefresh(reqNo) {
  const req = Store.all('requisitions').find(r => norm(r.no) === norm(reqNo)); if (!req || !reqIsOpen(req)) return;
  if (Store.all('issues').some(x => x.req_no === req.no && x.status === 'Pending')) return;
  const done = req.lines.every(l => lineOpen(req, l) <= 1e-9);
  req.status = done ? 'Issued' : req.lines.some(l => reqIssued(req.no, l.material) > 0) ? 'Part Issued' : 'Pending';
  if (done) { req.issued_by = ME.name; req.issued_at = nowIso(); }
  Store.put('requisitions', req);
}
ACTIONS['iss-approve'] = el => {
  if (!canApproveIssue()) { flash('Only the Store Incharge can approve an issue.', 'err'); return; }
  const i = Store.get('issues', el.dataset.id); if (i.status !== 'Pending') return;
  const avail = i.source === 'OPEN' ? openStockOf(i.material) : i.source === 'RSJW' ? reservedOf(i.material, i.to_jc) : (openStockOf(i.material) + (i.to_jc ? reservedOf(i.material, i.to_jc) : 0));
  if (num(i.qty) > avail) { flash('Stock is now only ' + qtyFmt(avail) + ' — send it back for amendment or reject.', 'err'); return; }
  if (i.to_jc && i.source !== 'OPEN') {
    let need = num(i.qty);
    Store.all('rsjw').filter(r => norm(r.jc_no) === norm(i.to_jc) && norm(r.material) === norm(i.material)).forEach(r => {
      if (need <= 0) return; const take = Math.min(need, num(r.qty)); r.qty = num(r.qty) - take; need -= take;
      if (r.qty <= 0.0001) Store.del('rsjw', r.id); else Store.put('rsjw', r);
    });
  }
  i.status = 'Approved'; i.approved_by = ME.name; i.approved_at = nowIso(); Store.put('issues', i);
  if (i.req_no) reqRefresh(i.req_no);
  audit('issue.approve', i.no, i.material + ' × ' + qtyFmt(i.qty)); flash(esc(i.no) + ' approved — stock deducted.'); VIEWS.issuance.render();
};
// Amend = back to store to correct and issue again; Reject = this item will not be issued on the slip
function issDecide(id, kind) {
  if (!canApproveIssue()) { flash('Only the Store Incharge can do this.', 'err'); return; }
  const i = Store.get('issues', id); if (!i || i.status !== 'Pending') return;
  const old = $('#idDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'idDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + (kind === 'amend' ? 'Send for amendment' : 'Reject') + ' · ' + esc(i.no) + '</div><table class="jckv"><tr><td class="k">Item</td><td class="v">' + esc((matBy(i.material) || {}).name || i.material) + ' · ' + qtyFmt(i.qty) + '</td></tr><tr><td class="k">Reason *</td><td class="v"><textarea id="idWhy" rows="3"></textarea></td></tr></table>' +
    '<div class="dlg-f"><span id="idMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-id-cancel>Cancel</button><button class="btn ' + (kind === 'amend' ? 'primary' : 'danger') + '" data-id-ok>' + (kind === 'amend' ? 'Send for amendment' : 'Reject') + '</button></div></div>';
  document.body.appendChild(d); $('#idWhy').focus();
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-id-cancel]')) { d.remove(); return; }
    if (!ev.target.closest('[data-id-ok]')) return;
    const why = $('#idWhy').value.trim(); if (!why) { $('#idMsg').textContent = 'Write the reason.'; return; }
    i.status = kind === 'amend' ? 'Amend' : 'Rejected'; i.decision_note = why; i.decided_by = ME.name; i.decided_at = nowIso(); Store.put('issues', i);
    if (kind === 'reject' && i.req_no) { const req = Store.all('requisitions').find(r => norm(r.no) === norm(i.req_no)); const l = req && req.lines.find(x => norm(x.material) === norm(i.material)); if (l && reqSent(req.no, l.material) <= reqIssued(req.no, l.material) + 1e-9) { l.closed = true; l.closed_note = why; l.closed_by = ME.name; l.closed_at = nowIso(); Store.put('requisitions', req); } }
    if (i.req_no) reqRefresh(i.req_no);
    audit(kind === 'amend' ? 'issue.amend' : 'issue.reject', i.no, why); d.remove();
    flash(esc(i.no) + (kind === 'amend' ? ' sent back to Store for amendment.' : ' rejected.')); VIEWS.issuance.render();
  });
}
ACTIONS['iss-amend'] = el => issDecide(el.dataset.id, 'amend');
ACTIONS['iss-deny'] = el => issDecide(el.dataset.id, 'reject');
ACTIONS['ret-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const jc = $('#rtJc').value.trim(); const m = matBy($('#rtMat').value); const qty = num($('#rtQty').value);
  if (!jc || !m || qty <= 0) { $('#rtMsg').innerHTML = '<span class="late-txt">JC, material and qty are required.</span>'; return; }
  const net = issuedToJc(jc, m.code);
  if (qty > net) { $('#rtMsg').innerHTML = '<span class="late-txt">Net issued to this JC is only ' + qtyFmt(net) + ' — cannot return more.</span>'; return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), type: 'return', material: m.code, qty, to_jc: jc, status: 'Approved', by: ($('#rtBy') ? $('#rtBy').value.trim() : ME.name) || ME.name, approved_by: ME.name, at: nowIso(), remark: $('#rtRem').value.trim() });
  audit('issue.return', i.no, m.code + ' × ' + qty + ' ← ' + jc); flash('Returned — open stock increased.'); VIEWS.issuance.render();
};
ACTIONS['req-reject'] = el => { const r = Store.get('requisitions', el.dataset.id); r.status = 'Rejected'; Store.put('requisitions', r); audit('req.reject', r.no, ''); VIEWS.issuance.render(); };

VIEWS.stock = {
  mod: 'store', render() {
    const { stk } = stockMaps();
    const rows = Store.all('materials').map(m => ({ m, q: stk[norm(m.code)] || 0 })).sort((a, b) => a.m.code.localeCompare(b.m.code));
    const low = rows.filter(x => num(x.m.min_level) > 0 && x.q < num(x.m.min_level));
    setMain('<div class="toolbar">' + (low.length ? '<span class="late-txt small"><b>' + low.length + ' item(s) below min level</b></span>' : '') + '<span class="grow"></span><button class="btn" data-act="stock-csv">Export CSV</button></div>' +
      '<div class="tbl-wrap"><table><tr><th>Item Code</th><th>Item Name</th><th>Category</th><th>UOM</th><th>Rack</th><th class="num">Min Level</th><th class="num">Stock</th><th>Status</th></tr>' +
      rows.map(x => { const lowRow = num(x.m.min_level) > 0 && x.q < num(x.m.min_level); return '<tr' + (lowRow ? ' style="background:#fdf3f3"' : x.q <= 0 ? ' class="muted"' : '') + '><td><b>' + esc(x.m.code) + '</b></td><td>' + esc(x.m.name) + '</td><td>' + esc(x.m.group || '') + '</td><td>' + esc(x.m.uom) + '</td><td>' + esc(x.m.rack || '') + '</td><td class="num">' + (num(x.m.min_level) ? qtyFmt(x.m.min_level) : '') + '</td><td class="num"><b>' + qtyFmt(x.q) + '</b></td><td>' + (lowRow ? '<span class="late-txt">Below min</span>' : '') + '</td></tr>'; }).join('') + '</table></div>');
    VIEWS.stock.rows = rows;
  }
};
ACTIONS['stock-csv'] = () => downloadCsv('stock-' + todayYmd() + '.csv', [['Material', 'Name', 'Group', 'UOM', 'Stock']].concat((VIEWS.stock.rows || []).map(x => [x.m.code, x.m.name, x.m.group, x.m.uom, x.q])));

VIEWS.rejstock = {
  mod: 'store', render() {
    const { rej, rejLine, rejScrap, rtvx } = stockMaps(); const edit = can('store', 'edit');
    const list = mp => Object.entries(mp).filter(([, q]) => q > 0.0001).map(([k, q]) => ({ m: matBy(k) || { code: k.toUpperCase(), name: '', uom: '' }, q }));
    const g = list(rej);
    const codes = Array.from(new Set(Object.keys(rejLine).concat(Object.keys(rejScrap)))).filter(k => (rejLine[k] || 0) > 0.0001 || (rejScrap[k] || 0) > 0.0001);
    let h = subTitle('Rejection Stock') +
      '<h2 style="margin-top:0">GRN rejection</h2><div class="tbl-wrap"><table><tr><th>Material</th><th>Name</th><th>UOM</th><th class="num">Rejected qty</th><th></th></tr>' +
      (g.length ? g.map(x => '<tr><td><b>' + esc(x.m.code) + '</b></td><td>' + esc(x.m.name) + '</td><td>' + esc(x.m.uom || '') + '</td><td class="num late-txt">' + qtyFmt(x.q) + '</td><td class="right">' + (edit ? '<a href="#/rtv">RTV \u2192</a>' : '') + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">No GRN rejection stock</td></tr>') + '</table></div>' +
      '<h2>Line rejection</h2><div class="tbl-wrap"><table><tr><th>Material</th><th>Name</th><th>UOM</th><th class="num">Unused (returnable)</th><th class="num">Used (not returnable)</th><th></th></tr>' +
      (codes.length ? codes.map(k => { const m = matBy(k) || { code: k.toUpperCase(), name: '', uom: '' }; const a = rejLine[k] || 0, b = rejScrap[k] || 0;
        return '<tr><td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + (a > 0.0001 ? qtyFmt(a) : '\u2014') + '</td><td class="num late-txt">' + (b > 0.0001 ? qtyFmt(b) : '\u2014') + '</td>' +
          '<td class="right nowrap">' + (edit && a > 0.0001 ? '<a href="#/rtv">RTV \u2192</a> ' : '') + (edit && b > 0.0001 ? '<button class="btn sm ghost" data-act="scrap-open" data-c="' + esc(m.code) + '">Write off</button>' : '') + '</td></tr>' +
          (VIEWS.rejstock.scrap === m.code ? '<tr class="inline-form"><td colspan="6"><div class="row"><label>Write-off qty * (max ' + qtyFmt(b) + ')<input id="scQty" type="number" min="0" step="any" value="' + b + '"></label><label>Remark<input id="scRem" placeholder="e.g. scrapped / sold as waste"></label><button class="btn primary sm" data-act="scrap-save" data-c="' + esc(m.code) + '" data-max="' + b + '">Write off</button></div></td></tr>' : ''); }).join('')
        : '<tr><td colspan="6" class="empty">No line rejection stock</td></tr>') + '</table></div>';
    const xs = []; Store.all('grns').forEach(g2 => (g2.lines || []).forEach(l => { if (l.excess_status === 'Rejected' && num(l.excess) > 0) xs.push({ g: g2, l }); }));
    const xret = {}; Store.all('rtvs').filter(r => r.source === 'excess').forEach(r => { const k = norm(r.vendor + '|' + r.material); xret[k] = (xret[k] || 0) + num(r.qty); });
    h += '<h2>Excess RTV stock</h2><div class="tbl-wrap"><table><tr><th>GRN No</th><th>GRN Date</th><th>Vendor</th><th>Invoice No</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Excess Rejected</th><th>Rejected By</th><th class="num">Balance to Return</th><th></th></tr>' +
      (xs.length ? xs.map(({ g: g2, l }) => { const k = norm(g2.vendor + '|' + l.material); const back = Math.min(num(l.excess), xret[k] || 0); xret[k] = Math.max(0, (xret[k] || 0) - num(l.excess)); const m = matBy(l.material) || {}; const bal = num(l.excess) - back;
        return '<tr><td><b>' + esc(g2.no) + '</b></td><td>' + fmtD(g2.date) + '</td><td>' + esc(g2.vendor) + '</td><td>' + esc(g2.invoice || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + qtyFmt(l.excess) + '</td><td>' + esc(l.excess_by || '') + '</td><td class="num late-txt">' + qtyFmt(bal) + '</td><td class="right">' + (edit && bal > 0.0001 ? '<a href="#/rtv">RTV \u2192</a>' : '') + '</td></tr>'; }).join('')
        : '<tr><td colspan="11" class="empty">No excess RTV stock</td></tr>') + '</table></div>';
    const log = Store.all('issues').filter(i => i.type === 'line_reject').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1).slice(0, 20);
    h += '<h2>Recent line rejections</h2><div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Job Card</th><th>Material</th><th class="num">Qty</th><th>Reason</th><th>Condition</th><th>Vendor</th><th>By</th></tr>' +
      (log.length ? log.map(i => '<tr><td><b>' + esc(i.no) + '</b></td><td class="nowrap">' + fmtD(i.date) + '</td><td>' + esc(i.to_jc || '') + '</td><td>' + esc(i.material) + '</td><td class="num">' + qtyFmt(i.qty) + '</td><td>' + esc(i.reason || '') + '</td><td>' + (i.returnable ? 'Unused \u2014 back to vendor' : 'Used \u2014 not returnable') + '</td><td>' + esc(i.vendor || '') + '</td><td>' + esc(i.by) + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No line rejections yet</td></tr>') + '</table></div>';
    setMain(h);
  }
};
ACTIONS['scrap-open'] = el => { VIEWS.rejstock.scrap = VIEWS.rejstock.scrap === el.dataset.c ? null : el.dataset.c; VIEWS.rejstock.render(); };
ACTIONS['scrap-save'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const qty = num($('#scQty').value); if (qty <= 0 || qty > num(el.dataset.max) + 1e-9) { flash('Write-off qty must be between 0 and ' + qtyFmt(num(el.dataset.max)) + '.', 'err'); return; }
  const i = Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), date: todayYmd(), type: 'scrap', material: el.dataset.c, qty, remark: $('#scRem').value.trim(), status: 'Approved', by: ME.name, approved_by: ME.name, at: nowIso() });
  audit('rejection.writeoff', i.no, el.dataset.c + ' × ' + qty); VIEWS.rejstock.scrap = null; flash('Written off.'); VIEWS.rejstock.render();
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
      Store.all('grns').forEach(g => g.lines.forEach(l => { if (num(l.rejected) > 0) srcRows.push({ vendor: g.vendor, material: l.material, invoice: g.invoice, date: g.date, qty: num(l.rejected), source: 'grn' }); if (l.excess_status === 'Rejected' && num(l.excess) > 0) srcRows.push({ vendor: g.vendor, material: l.material, invoice: g.invoice, date: g.date, qty: num(l.excess), source: 'excess' }); }));
      Store.all('issues').filter(i => i.type === 'line_reject' && i.returnable && i.vendor).forEach(i => srcRows.push({ vendor: i.vendor, material: i.material, invoice: 'LINE ' + (i.to_jc || ''), date: i.date, qty: num(i.qty), source: 'line' }));
      const returned = {};
      Store.all('rtvs').forEach(r => { const k = norm(r.vendor + '|' + r.material + '|' + (r.source || 'grn')); returned[k] = (returned[k] || 0) + num(r.qty); });
      const avail = srcRows.map(r => { const k = norm(r.vendor + '|' + r.material + '|' + r.source); const take = Math.min(r.qty, Math.max(0, r.qty - (returned[k] || 0))); returned[k] = Math.max(0, (returned[k] || 0) - r.qty); return Object.assign({}, r, { avail: take }); }).filter(r => r.avail > 0);
      const vendors = Array.from(new Set(avail.map(r => r.vendor)));
      const sel = RTV_UI.vendor || vendors[0] || '';
      h += '<div class="card"><div class="card-b"><div class="row">' +
        '<label>Vendor *<select id="rvVen">' + (vendors.length ? vendors.map(v => '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + ' (' + avail.filter(r => r.vendor === v).length + ')</option>').join('') : '<option value="">No rejection stock</option>') + '</select></label>' +
        '<label>Reason<select id="rvWhy">' + RTV_REASONS.map(x => '<option>' + x + '</option>').join('') + '</select></label>' +
        '<label>Vehicle No<input id="rvVeh" placeholder="HR-26-XX-1234"></label><label>Driver Name<input id="rvDrv"></label><label style="flex:1">Remarks<input id="rvRem" placeholder="Optional remarks (printed on NRGP)"></label></div>' +
        '<table style="margin-top:8px;max-width:820px"><tr><th>#</th><th>Item</th><th>Code</th><th>Invoice</th><th>UOM</th><th>Date</th><th class="num">Rejected Qty</th><th class="num" style="width:110px">Return Qty</th></tr>' +
        avail.filter(r => r.vendor === sel).map((r, i) => '<tr data-rvrow data-mat="' + esc(r.material) + '" data-inv="' + esc(r.invoice) + '" data-src="' + r.source + '" data-max="' + r.avail + '"><td class="muted">' + (i + 1) + '</td><td>' + esc((matBy(r.material) || {}).name || '') + '</td><td>' + esc(r.material) + '</td><td>' + esc(r.invoice) + '</td><td>' + esc((matBy(r.material) || {}).uom || '') + '</td><td class="nowrap">' + fmtD(r.date) + '</td><td class="num late-txt">' + qtyFmt(r.avail) + '</td><td><input class="qty right" type="number" min="0" max="' + r.avail + '" step="any" data-rvq value="' + r.avail + '"></td></tr>').join('') +
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
  const rows = $$('tr[data-rvrow]').map(tr => ({ material: tr.dataset.mat, invoice: tr.dataset.inv, source: tr.dataset.src || 'grn', qty: num($('[data-rvq]', tr).value), max: num(tr.dataset.max) })).filter(r => r.qty > 0);
  if (!ven || !rows.length) { $('#rvMsg').innerHTML = '<span class="late-txt">Vendor and return qty are required.</span>'; return; }
  const over = rows.find(r => r.qty > r.max + 1e-9);
  if (over) { $('#rvMsg').innerHTML = '<span class="late-txt">' + esc(over.material) + ': cannot return more than the rejected qty.</span>'; return; }
  const why = $('#rvWhy').value, veh = $('#rvVeh').value.trim(), drv = $('#rvDrv').value.trim(), rem = $('#rvRem').value.trim();
  const ids = rows.map(r => Store.put('rtvs', { id: uid(), no: fyNo('rtvs', 'NRGP', 4), date: todayYmd(), vendor: ven, material: r.material, uom: (matBy(r.material) || {}).uom || '', qty: r.qty, invoice: r.invoice, source: r.source, reason: why, vehicle: veh, driver: drv, remarks: rem, by: ME.name }).id);
  audit('rtv.create', Store.get('rtvs', ids[0]).no, ven + ' · ' + rows.map(r => r.material + '×' + r.qty).join(', ') + ' · ' + why);
  RTV_UI.form = false; flash('RTV created for ' + rows.length + ' item(s) — print the NRGP.'); VIEWS.rtv.render();
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
        { k: 'group', l: 'Category', opts: () => [''].concat(itemCats()).map(v => ({ v, l: v || '—' })) },
        { k: 'uom', l: 'UOM', opts: () => UOMS.map(v => ({ v, l: v })) },
        { k: 'price', l: 'Price ₹', type: 'number', w: 90 }, { k: 'rack', l: 'Rack No.', w: 80, upper: true },
        { k: 'gst', l: 'GST %', type: 'number', w: 70 }, { k: 'hsn', l: 'HSN', w: 90 },
        { k: 'min_level', l: 'Min level', type: 'number', w: 80 }],
      defaults: { uom: 'PCS' },
      beforeAdd: d => { if (!String(d.code || '').trim()) d.code = itemCodeAuto(d.group); },
      validate: d => (!String(d.name || '').trim() ? 'Item name is required.' : Store.all('materials').some(x => x.id !== d.id && d.code && norm(x.code) === norm(d.code)) ? 'Code exists.' : ''),
      inUse: d => (Store.all('purchase_orders').some(p => p.lines.some(l => norm(l.material) === norm(d.code))) || Store.all('issues').some(i => norm(i.material) === norm(d.code))) ? 'Material is in use — cannot delete.' : ''
    });
  }
};

/* ================= DEVELOPMENT: BOM ================= */
VIEWS.bom = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    if (!edit) { go('boms'); return; }
    const brands = Store.all('customers').map(c => c.name);
    const kvIn = (id, list, ph) => '<input id="' + id + '"' + (list ? ' list="' + list + '"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off">';
    // punched-order lines that still need a BOM (a BOM for the same brand+article+style
    // with the same colour — or blank colour = all colours — counts as made)
    const pend = [];
    Store.all('orders').forEach(o => (o.lines || []).forEach(l => {
      const key = norm(o.customer_name + '|' + l.article + '|' + (l.style || '') + '|' + (l.colour || ''));
      if (pend.some(p => p.key === key)) return;
      const has = Store.all('boms').some(b2 => norm(b2.brand || '') === norm(o.customer_name) && norm(b2.article) === norm(l.article) &&
        norm(b2.style || '') === norm(l.style || '') && (!String(b2.colour || '').trim() || norm(b2.colour) === norm(l.colour || '')));
      if (!has) pend.push({ key, brand: o.customer_name, article: l.article, style: l.style || '', colour: l.colour || '', gender: l.gender || '', category: o.category || '', run: l.size_run || l.size || '', mould: o.tooling_no || '' });
    }));
    const pendBrands = Array.from(new Set(pend.map(p => p.brand)));
    let h = subTitle('Development BOM') + '<div class="card"><div class="card-b">' + dlMat('dlMatB') + dlVendor() +
      '<datalist id="dlCatJc2">' + itemCats().map(x => '<option>' + x + '</option>').join('') + '</datalist><datalist id="dlCatB">' + fieldOptions('category').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<div class="jcdoc"><div class="jcban">BILL OF MATERIALS</div><div class="jcmid">' +
      '<div class="jcl"><table class="jckv">' +
      '<tr><td class="k">Brand *</td><td><select id="nbBrand"><option value="">Select brand…</option>' + pendBrands.map(x => '<option>' + esc(x) + '</option>').join('') + '</select></td></tr>' +
      '<tr><td class="k">Article Name *</td><td><select id="nbArt" disabled><option value="">—</option></select></td></tr>' +
      '<tr><td class="k">Style Name</td><td>' + kvIn('nbStyle') + '</td></tr>' +
      '<tr><td class="k">Colour Wise</td><td>' + kvIn('nbCol', '', 'blank = all colours') + '</td></tr>' +
      '<tr><td class="k">Gender</td><td><select id="nbGen"><option value=""></option>' + GENDERS_().map(g => '<option>' + g + '</option>').join('') + '</select></td></tr>' +
      '<tr><td class="k">Category</td><td>' + kvIn('nbCat', 'dlCatB') + '</td></tr>' +
      '<tr><td class="k">Size Run</td><td>' + kvIn('nbRun', '', 'e.g. 6X10') + '</td></tr>' +
      '<tr><td class="k">Last (Mould No)</td><td>' + kvIn('nbMould') + '</td></tr>' +
      '<tr><td class="k">Date</td><td>' + fmtD(new Date()) + '</td></tr></table></div>' +
      '<div class="jcph-wrap"><label class="jcph jcph-form" title="Click to add the product photo"><span id="nbPhotoTag">PRODUCT PHOTO</span><input type="file" id="nbPhoto" accept="image/*" style="display:none"></label>' +
      '<div class="jcrem"><span class="k">REMARK</span><input id="nbRem"></div></div></div>' +
      '<div class="toolbar" style="margin-top:10px"><a class="small" data-act="bom-line">+ Add Row</a><a class="small" data-act="bom-paste-t">Bulk Paste</a>' +
      '<label class="small" style="flex-direction:row;align-items:center;gap:4px">Copy items from <select id="nbCopy" style="height:26px"><option value="">—</option>' + Store.all('boms').map(x => '<option value="' + esc(x.id) + '">' + esc(x.article + (x.colour ? ' · ' + x.colour : '') + ' v' + x.version) + '</option>').join('') + '</select></label><span class="grow"></span><span id="nbRmc" class="small"></span></div>' +
      '<div id="nbPasteBox" class="hidden"><textarea id="nbPaste" rows="5" class="mono" placeholder="PROCESS | SECTION | CATEGORY | ITEM NAME | NORMS | PRICE | SUPPLIER | REMARK  (Tab or | separated — Excel/Sheets paste works directly; you can also paste straight into the table below)"></textarea> <button class="btn sm" data-act="bom-paste-go">Import</button></div>' +
      '<table id="nbTable" class="jcbom"><tr class="hd"><th style="width:36px">Sr No</th><th style="width:95px">Process</th><th style="width:100px">Section</th><th style="width:110px">Category</th><th>Item Name</th><th style="width:85px">Item Code</th><th style="width:55px">UOM</th><th style="width:80px">Norms</th><th style="width:80px">Price</th><th style="width:85px">Cost</th><th style="width:140px">Supplier</th><th style="width:120px">Remark</th><th style="width:40px">Action</th></tr>' +
      '</table></div>' +
      '</div><div class="card-f"><button class="btn primary" data-act="bom-save">Save BOM</button><span id="nbMsg" class="small"></span></div></div>';
    setMain(h);
    for (let i = 0; i < 5; i++) $('#nbTable').insertAdjacentHTML('beforeend', bomRow());
    const m = $('#main'); window.NBF = { photo: '' };
    m.addEventListener('input', e => { if (e.target.closest('#nbTable')) bomRecalc(); });
    m.addEventListener('change', e => {
      if (e.target.dataset.nb === 'mat') { const mt = Store.all('materials').find(x => norm(x.name) === norm(e.target.value) || norm(x.code) === norm(e.target.value)); const tr = e.target.closest('tr'); if (mt) { e.target.value = mt.name; $('[data-nb-code]', tr).textContent = mt.code; $('[data-nb-uom]', tr).textContent = mt.uom; const pr = $('[data-nb="price"]', tr); if (!pr.value) pr.value = mt.price || ''; const c = $('[data-nb="cat"]', tr); if (!c.value) c.value = mt.group || ''; } bomRecalc(); }
      if (e.target.id === 'nbPhoto') readImg(e.target.files[0], src => { NBF.photo = src; $('#nbPhotoTag').innerHTML = '<img src="' + src + '">'; });
      if (e.target.id === 'nbCopy' && e.target.value) { const src = Store.get('boms', e.target.value); $$('#nbTable tr[data-bline]').forEach(tr => tr.remove()); src.lines.forEach(l => $('#nbTable').insertAdjacentHTML('beforeend', bomRow(l))); bomRecalc(); }
      if (e.target.id === 'nbBrand') {
        const sel = $('#nbArt'); const mine = pend.filter(p => p.brand === e.target.value);
        sel.disabled = !mine.length;
        sel.innerHTML = '<option value="">' + (mine.length ? 'Select article…' : 'All BOMs made for this brand') + '</option>' +
          mine.map(p => '<option value="' + esc(p.article) + '" data-k="' + esc(p.key) + '">' + esc([p.article, p.style, p.colour, p.gender, p.category].filter(Boolean).join(' · ')) + '</option>').join('');
        ['nbStyle', 'nbCol', 'nbCat', 'nbRun', 'nbMould'].forEach(id => { $('#' + id).value = ''; }); $('#nbGen').value = '';
      }
      if (e.target.id === 'nbArt') {
        const opt = e.target.selectedOptions[0]; const p = pend.find(x => x.key === (opt ? opt.dataset.k : ''));
        if (p) { $('#nbStyle').value = p.style; $('#nbCol').value = p.colour; $('#nbGen').value = p.gender; $('#nbCat').value = p.category; $('#nbRun').value = p.run; $('#nbMould').value = p.mould; }
      }
    });
    m.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); ACTIONS['bom-save'](); } });
    excelGrid($('#nbTable'), { rowSel: 'tr[data-bline]', addRow: () => $('#nbTable').insertAdjacentHTML('beforeend', bomRow()), importText: bomImportText });
    bomRecalc();
    $('#nbBrand').focus();
  }
};
function bomRow(l) {
  l = l || {}; const m = matBy(l.material) || {};
  return '<tr data-bline><td class="c" data-sr></td><td><input data-nb="process" value="' + esc(l.process || '') + '"></td><td><input data-nb="section" value="' + esc(l.section || '') + '"></td><td><input data-nb="cat" list="dlCatJc2" value="' + esc(l.category || m.group || '') + '"></td><td><input data-nb="mat" list="dlMatB" value="' + esc(m.name || '') + '"></td><td class="c muted" data-nb-code>' + esc(l.material || '') + '</td><td class="c muted" data-nb-uom>' + esc(l.uom || '') + '</td>' +
    '<td><input data-nb="qty" type="number" min="0" step="any" class="right" value="' + esc(l.qty || '') + '"></td><td><input data-nb="price" type="number" min="0" step="any" class="right" value="' + esc(l.price || '') + '"></td><td class="c muted" data-nb-cost>0</td><td><input data-nb="sup" list="dlVen" value="' + esc(l.supplier || '') + '"></td><td><input data-nb="rem" value="' + esc(l.remark || '') + '"></td><td class="c"><a data-act="bom-line-del" title="Remove">×</a></td></tr>';
}
function bomRecalc() {
  let rmc = 0;
  $$('#nbTable tr[data-bline]').forEach((tr, i) => { $('[data-sr]', tr).textContent = i + 1; const c = num($('[data-nb="qty"]', tr).value) * num($('[data-nb="price"]', tr).value); $('[data-nb-cost]', tr).textContent = c ? money(c) : '0'; rmc += c; });
  $('#nbRmc').innerHTML = rmc ? '<b>Total RMC/Pair: ₹' + money(rmc) + '</b>' : '';
}
ACTIONS['bom-line'] = () => { $('#nbTable').insertAdjacentHTML('beforeend', bomRow()); bomRecalc(); };
ACTIONS['bom-line-del'] = el => { el.closest('tr').remove(); bomRecalc(); };
ACTIONS['bom-paste-t'] = () => $('#nbPasteBox').classList.toggle('hidden');
function bomImportText(text) {
  let ok = 0, bad = [];
  const matOf = c => Store.all('materials').find(x => norm(x.name) === norm(c) || norm(x.code) === norm(c));
  const isNum = c => /^\d*\.?\d+$/.test(c);
  text.split(/\r?\n/).forEach(line => {
    const cells = line.split(/\t|\s*\|\s*/).map(x => x.trim());
    if (!cells.join('')) return;
    // the item-name cell anchors the row; before it: [Process, Section, Category] (right-aligned),
    // after it: numbers = Norms then Price, texts = Supplier then Remark
    const mi = cells.findIndex(c => c && matOf(c));
    if (mi < 0) { bad.push(cells.find(Boolean) || line.trim()); return; }
    const m = matOf(cells[mi]);
    const before = cells.slice(0, mi), after = cells.slice(mi + 1);
    const nums = [], txts = [];
    after.forEach(c => { if (c === '') return; if (isNum(c)) nums.push(c); else txts.push(c); });
    $('#nbTable').insertAdjacentHTML('beforeend', bomRow({
      process: before.length >= 3 ? before[before.length - 3] : '',
      section: before.length >= 2 ? before[before.length - 2] : '',
      category: before.length >= 1 ? before[before.length - 1] : (m.group || ''),
      material: m.code, uom: m.uom, qty: nums[0] || '', price: nums[1] || m.price || '',
      supplier: txts[0] || '', remark: txts[1] || ''
    })); ok++;
  });
  if (ok) $$('#nbTable tr[data-bline]').forEach(tr => { if (!$('[data-nb="mat"]', tr).value.trim() && !$('[data-nb="qty"]', tr).value) tr.remove(); });
  bomRecalc();
  flash(ok + ' items imported.' + (bad.length ? ' Not matched: ' + esc(bad.join(', ')) : ''), bad.length ? 'err' : '');
}
ACTIONS['bom-paste-go'] = () => { $('#nbPasteBox').classList.add('hidden'); bomImportText($('#nbPaste').value); };
ACTIONS['bom-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const brand = $('#nbBrand').value.trim(); const artIn = $('#nbArt').value.trim().toUpperCase();
  const art = (Store.all('items').find(i => norm(i.code) === norm(artIn) || norm(i.name) === norm(artIn)) || { code: artIn }).code;
  const style = $('#nbStyle').value.trim(), col = $('#nbCol').value.trim(), gen = $('#nbGen').value, cat = $('#nbCat').value.trim();
  const lines = $$('#nbTable tr[data-bline]').map(tr => {
    const m = Store.all('materials').find(x => norm(x.name) === norm($('[data-nb="mat"]', tr).value) || norm(x.code) === norm($('[data-nb="mat"]', tr).value));
    return m ? { process: $('[data-nb="process"]', tr).value.trim(), section: $('[data-nb="section"]', tr).value.trim(), category: $('[data-nb="cat"]', tr).value.trim() || m.group || '', material: m.code, uom: m.uom, qty: num($('[data-nb="qty"]', tr).value), price: num($('[data-nb="price"]', tr).value), supplier: $('[data-nb="sup"]', tr).value.trim(), remark: $('[data-nb="rem"]', tr).value.trim() } : null;
  }).filter(l => l && l.qty > 0);
  if (!brand || !art || !lines.length) { $('#nbMsg').innerHTML = '<span class="late-txt">Brand, Article and at least one item line (Norms > 0) are required.</span>'; return; }
  const dupKey = lines.map(l => norm(l.section + '|' + l.material)).filter((x, i, a2) => a2.indexOf(x) !== i);
  if (dupKey.length) { $('#nbMsg').innerHTML = '<span class="late-txt">Duplicate Section + Item — remove it.</span>'; return; }
  const ver = Store.all('boms').filter(b2 => norm(b2.article) === norm(art) && norm(b2.brand || '') === norm(brand) && norm(b2.style || '') === norm(style) && norm(b2.colour || '') === norm(col)).reduce((mx, b2) => Math.max(mx, b2.version), 0) + 1;
  const b2 = Store.put('boms', { id: uid(), brand, article: art, style, colour: col, gender: gen, category: cat, size_run: $('#nbRun').value.trim(), mould_no: $('#nbMould').value.trim(), photo: (window.NBF || {}).photo || '', remark: $('#nbRem').value.trim().toUpperCase(), version: ver, lines, status: 'Final', by: ME.name, at: nowIso() });
  audit('bom.create', art + ' v' + ver, brand + (col ? ' · ' + col : '') + ' · ' + lines.length + ' items · RMC ₹' + money(lines.reduce((s2, l) => s2 + l.qty * l.price, 0)));
  flash('BOM saved: ' + esc(art) + ' v' + ver + (ver > 1 ? ' (new version)' : '') + '.'); go('boms');
};
VIEWS.boms = {
  mod: 'development', render() {
    const byKey = {};
    Store.all('boms').forEach(b2 => { const k = norm(b2.article + '|' + (b2.brand || '') + '|' + (b2.style || '') + '|' + (b2.colour || '')); if (!byKey[k] || byKey[k].version < b2.version) byKey[k] = b2; });
    const rows = Object.values(byKey).sort((a2, b3) => a2.article.localeCompare(b3.article));
    setMain(subTitle('Created BOMs', 'latest version per article+brand+style+colour') + '<div class="toolbar"><span class="grow"></span>' + (can('development', 'edit') ? '<a class="btn primary" href="#/bom">+ Make BOM</a>' : '') + '</div>' +
      '<div class="tbl-wrap"><table class="bomflat"><tr><th>Brand</th><th>Article</th><th>Style</th><th>Colour</th><th>Gender</th><th>Ver</th><th class="num">Sr</th><th>Process</th><th>Section</th><th>Category</th><th>Item Name</th><th>Item Code</th><th>UOM</th><th class="num">Norms</th><th class="num">Price</th><th class="num">Cost</th><th>Supplier</th><th>Remark</th><th>Date</th><th></th></tr>' +
      (rows.length ? rows.map(b2 => b2.lines.map((l, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td>' + esc(b2.brand || '') + '</td><td><b>' + esc(b2.article) + '</b></td><td>' + esc(b2.style || '') + '</td><td>' + esc(b2.colour || '') + '</td><td>' + esc(b2.gender || '') + '</td><td>v' + b2.version + '</td><td class="num">' + (i + 1) + '</td><td>' + esc(l.process || '') + '</td><td>' + esc(l.section || '') + '</td><td>' + esc(l.category || '') + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.material) + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + l.qty + '</td><td class="num">' + (l.price ? money(l.price) : '') + '</td><td class="num">' + (l.price ? money(num(l.qty) * num(l.price)) : '') + '</td><td>' + esc(l.supplier || '') + '</td><td>' + esc(l.remark || '') + '</td><td>' + fmtD(b2.at) + '</td><td class="right">' + (i === 0 ? '<button class="btn sm ghost" data-act="print-bom" data-id="' + esc(b2.id) + '">Print</button>' : '') + '</td></tr>').join('')).join('') : '<tr><td colspan="20" class="empty">No BOMs yet</td></tr>') + '</table></div>');
  }
};

/* ================= PRODUCTION ================= */
const REQ_UI = { form: false, method: 'jc', jc: '', dept: '', cons: [] };
const reqIsOpen = r => !['Issued', 'Rejected', 'Closed'].includes(r.status);
function staleReqs() { return Store.all('requisitions').filter(r => r.status === 'Pending' && (Date.now() - new Date(r.date + 'T00:00')) > 24 * 3600000); }
// qty of a slip line issued (approved) / sent to store (pending + approved)
function reqIssued(reqNo, code) { return Store.all('issues').filter(i => i.req_no === reqNo && norm(i.material) === norm(code) && i.status === 'Approved' && !i.type).reduce((s2, i) => s2 + num(i.qty), 0); }
function reqSent(reqNo, code) { return Store.all('issues').filter(i => i.req_no === reqNo && norm(i.material) === norm(code) && (i.status === 'Pending' || i.status === 'Approved') && !i.type).reduce((s2, i) => s2 + num(i.qty), 0); }
// stock already held by open slips (not yet issued) and by pending direct issues
function reqHeld(code) {
  let q = 0;
  Store.all('requisitions').filter(reqIsOpen).forEach(r => (r.lines || []).forEach(l => { if (norm(l.material) === norm(code)) q += lineOpen(r, l); }));
  Store.all('issues').filter(i => i.status === 'Pending' && !i.req_no && norm(i.material) === norm(code)).forEach(i => { q += num(i.qty); });
  return q;
}
function lineOpen(r, l) { return l.closed ? 0 : Math.max(0, num(l.qty) - reqIssued(r.no, l.material)); }
function lineLeft(r, l) { return l.closed ? 0 : Math.max(0, num(l.qty) - reqSent(r.no, l.material)); }
function freeStock(code) { return Math.max(0, stockOf(code) - reqHeld(code)); }
// JC qty still to be asked for: required − issued − already on an open slip
function jcOpenReqQty(jc, code) { return Store.all('requisitions').filter(r => reqIsOpen(r) && norm(r.jc_no) === norm(jc)).reduce((s2, r) => s2 + (r.lines || []).filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + lineOpen(r, l), 0), 0); }
function reqJcRows(jc, proc) {
  const j = jcBy(jc); if (!j) return [];
  return (j.lines || []).filter(l => !proc || !String(l.process || '').trim() || norm(l.process) === norm(proc)).map(l => {
    const pend = Math.max(0, num(l.required) - issuedToJc(j.no, l.material) - jcOpenReqQty(j.no, l.material));
    const free = freeStock(l.material);
    return { material: l.material, uom: l.uom || (matBy(l.material) || {}).uom || '', pend, free, cap: Math.min(pend, free) };
  }).filter(x => x.pend > 0.0001);
}
const reqProcs = () => { const j = REQ_UI.method === 'jc' && REQ_UI.jc ? jcBy(REQ_UI.jc) : null; const fromJc = j ? Array.from(new Set((j.lines || []).map(l => String(l.process || '').trim()).filter(Boolean))) : []; return fromJc.length ? fromJc : optList('process'); };
const reqPR = () => '<label>Process *<select id="nrProc">' + selOpts(reqProcs(), REQ_UI.process || '') + '</select></label>';
const reqLP = () => '<label>Line *<select id="nrLine">' + selOpts(optList('prod_line'), REQ_UI.line || '') + '</select></label><label>Picker Name *<select id="nrPick">' + selOpts(optList('picker'), REQ_UI.picker || '') + '</select></label>';
const consumables = () => Store.all('materials').filter(m => /consumable/i.test(m.group || '')).sort((a, b) => String(a.name).localeCompare(String(b.name)));
function reqCoverage(reqQty, stock) { return stock >= reqQty ? '<span class="st Done">Covered</span>' : stock > 0 ? '<span class="st Pending">' + qtyFmt(stock) + ' only</span>' : '<span class="st Late">No stock</span>'; }
VIEWS.requisition = {
  mod: 'production', render() {
    const edit = can('production', 'edit'); const U = REQ_UI;
    let h = '';
    const stale = staleReqs();
    if (stale.length) h += '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px"><b>' + stale.length + ' slip(s) pending for 24h+</b> <a href="#/issuance">Issuance →</a></div>';
    h += '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('New requisition', 'req-new') : '') + '</div>';
    if (U.form && edit) {
      h += '<div class="card"><div class="card-b"><div class="row"><label>Method *<select id="nrMethod"><option value="jc">Job Card</option><option value="cons"' + (U.method === 'cons' ? ' selected' : '') + '>Consumable Items</option></select></label>';
      if (U.method === 'jc') {
        h += '<label>Job Card *<select id="nrJc"><option value="">— select —</option>' + Store.all('job_cards').filter(j => j.status !== 'Closed').sort((a, b) => String(a.no).localeCompare(String(b.no))).map(j => '<option value="' + esc(j.no) + '"' + (norm(j.no) === norm(U.jc) ? ' selected' : '') + '>' + esc(j.no + ' · ' + (j.brand || '') + ' · ' + (j.article || '')) + '</option>').join('') + '</select></label>';
        h += reqPR() + reqLP() + '<label>Requested By<input value="' + esc(ME.name) + '" readonly></label></div>';
        const rows = U.jc && U.process ? reqJcRows(U.jc, U.process) : [];
        h += '<div class="tbl-wrap" style="margin-top:8px"><table class="bomflat nopage" id="nrTable"><tr><th>Item Name</th><th>UOM</th><th class="num">Req Qty</th><th class="num">Stock</th><th>Coverage</th><th class="num">Requisition Qty</th></tr>' +
          (!U.jc || !U.process ? '<tr><td colspan="6" class="empty">Select a Job Card and Process</td></tr>' : rows.length ? rows.map(x => '<tr data-rrow data-mat="' + esc(x.material) + '" data-cap="' + x.cap + '"><td>' + esc((matBy(x.material) || {}).name || x.material) + '</td><td>' + esc(x.uom) + '</td><td class="num">' + qtyFmt(x.pend) + '</td><td class="num">' + qtyFmt(x.free) + '</td><td>' + reqCoverage(x.pend, x.free) + '</td><td><input class="qty right" type="number" min="0" max="' + x.cap + '" step="any" data-rq' + (x.free <= 0 ? ' disabled' : '') + '></td></tr>').join('') : '<tr><td colspan="6" class="empty">Nothing pending for this Job Card</td></tr>') + '</table></div>';
        if (rows.some(x => x.cap > 0)) h += '<button class="btn sm" data-act="req-fill" style="margin-top:6px">Fill All Pending Qty</button>';
      } else {
        h += '<label>Department *<select id="nrDept">' + selOpts(deptList(), U.dept || ME.department || '') + '</select></label>' + reqPR() + reqLP() + '<label>Requested By<input value="' + esc(ME.name) + '" readonly></label></div>';
        const cons = consumables();
        h += '<div class="tbl-wrap" style="margin-top:8px"><table class="bomflat nopage" id="nrTable"><tr><th>Item Name</th><th>UOM</th><th class="num">Stock</th><th>Coverage</th><th class="num">Requisition Qty</th><th></th></tr>' +
          (U.cons.length ? U.cons.map((c, i) => { const m = matBy(c.material); const free = m ? freeStock(m.code) : 0; return '<tr data-crow="' + i + '"><td><select data-cmat><option value="">— select —</option>' + cons.map(x => '<option value="' + esc(x.code) + '"' + (m && x.code === m.code ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></td><td>' + esc(m ? m.uom : '') + '</td><td class="num">' + (m ? qtyFmt(free) : '') + '</td><td>' + (m ? reqCoverage(num(c.qty) || 0.0001, free) : '') + '</td><td><input class="qty right" type="number" min="0" step="any" data-cq value="' + esc(c.qty || '') + '"' + (m && free <= 0 ? ' disabled' : '') + '></td><td><button class="btn ghost sm" data-act="req-cdel" data-i="' + i + '">×</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">Add an item</td></tr>') + '</table></div><a class="small" data-act="req-cadd">+ Add item</a>';
      }
      h += '</div><div class="card-f"><button class="btn primary" data-act="req-save">Generate Requisition Slip</button><span id="nrMsg" class="small"></span></div></div>';
    }
    const rows = Store.all('requisitions').slice().sort((a2, b2) => b2.no < a2.no ? -1 : 1);
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Req No</th><th>Date</th><th>Method</th><th>JC / Dept</th><th>Process</th><th>Line</th><th>Picker Name</th><th class="num">Sr</th><th>Item Name</th><th>Item Code</th><th class="num">Qty</th><th class="num">Issued</th><th>Status</th><th>Raised By</th><th>Issued By</th><th></th></tr>' +
      (rows.length ? rows.map(r => r.lines.map((l, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><b>' + esc(r.no) + '</b></td><td>' + fmtD(r.date) + '</td><td>' + (r.method === 'cons' ? 'Consumable Items' : 'Job Card') + '</td><td>' + esc(r.jc_no || r.dept) + '</td><td>' + esc(r.process || '') + '</td><td>' + esc(r.line || '') + '</td><td>' + esc(r.picker || '') + '</td><td class="num">' + (i + 1) + '</td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.material) + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + qtyFmt(reqIssued(r.no, l.material)) + '</td><td><span class="st ' + (r.status === 'Issued' ? 'Done' : r.status === 'Rejected' ? 'Late' : 'Pending') + '">' + esc(r.status) + '</span></td><td>' + esc(r.by) + '</td><td>' + esc(r.issued_by || '') + '</td><td class="right">' + (i === 0 ? '<button class="btn sm ghost" data-act="print-req" data-id="' + esc(r.id) + '">Print Slip</button>' : '') + '</td></tr>').join('')).join('') : '<tr><td colspan="16" class="empty">No requisitions</td></tr>') + '</table></div>';
    setMain(h);
    const m = $('#main');
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'nrMethod') { U.method = t.value; U.jc = ''; U.cons = []; VIEWS.requisition.render(); }
      else if (t.id === 'nrJc') { U.jc = t.value; U.process = ''; VIEWS.requisition.render(); }
      else if (t.id === 'nrDept') U.dept = t.value;
      else if (t.id === 'nrLine') U.line = t.value;
      else if (t.id === 'nrProc') { U.process = t.value; if (U.method === 'jc') VIEWS.requisition.render(); }
      else if (t.id === 'nrPick') U.picker = t.value;
      else if (t.dataset.cmat != null) { const i = +t.closest('tr').dataset.crow; if (U.cons.some((c, k) => k !== i && c.material === t.value)) { flash('Item already added.', 'err'); t.value = U.cons[i].material || ''; return; } U.cons[i].material = t.value; VIEWS.requisition.render(); }
    });
    m.addEventListener('input', e => { if (e.target.dataset.cq != null) U.cons[+e.target.closest('tr').dataset.crow].qty = e.target.value; });
  }
};
ACTIONS['req-fill'] = () => { $$('#nrTable tr[data-rrow] [data-rq]').forEach(inp => { if (!inp.disabled) inp.value = inp.closest('tr').dataset.cap; }); };
ACTIONS['req-cadd'] = () => { REQ_UI.cons.push({ material: '', qty: '' }); VIEWS.requisition.render(); };
ACTIONS['req-cdel'] = el => { REQ_UI.cons.splice(+el.dataset.i, 1); VIEWS.requisition.render(); };
ACTIONS['req-new'] = () => { REQ_UI.form = !REQ_UI.form; REQ_UI.jc = ''; REQ_UI.cons = []; VIEWS.requisition.render(); };
ACTIONS['req-save'] = () => {
  if (!requirePerm('production', 'edit')) return;
  const U = REQ_UI; const msg = t => { $('#nrMsg').innerHTML = '<span class="late-txt">' + t + '</span>'; };
  const stale = staleReqs();
  if (stale.length && !canApprove()) { msg(esc(stale[0].no) + ' has been pending for 24h — Store must issue or reject it first.'); return; }
  const lines = []; let bad = '';
  U.line = $('#nrLine').value; U.picker = $('#nrPick').value; U.process = $('#nrProc').value;
  if (!U.process) { msg('Select the Process.'); return; }
  if (!U.line || !U.picker) { msg('Select Line and Picker Name.'); return; }
  if (U.method === 'jc') {
    if (!jcBy(U.jc)) { msg('Select a Job Card.'); return; }
    const fresh = Object.fromEntries(reqJcRows(U.jc, U.process).map(x => [norm(x.material), x]));
    $$('#nrTable tr[data-rrow]').forEach(tr => {
      const q = num(($('[data-rq]', tr) || {}).value); if (q <= 0) return;
      const x = fresh[norm(tr.dataset.mat)];
      if (!x || x.free <= 0) { bad = bad || tr.dataset.mat + ': no stock.'; return; }
      if (q > x.cap + 1e-9) { bad = bad || tr.dataset.mat + ': max ' + qtyFmt(x.cap) + '.'; return; }
      lines.push({ material: x.material, qty: q, req: x.pend, stock: x.free });
    });
  } else {
    const dept = $('#nrDept').value; if (!dept) { msg('Select the department.'); return; }
    U.dept = dept;
    U.cons.forEach(c => { const m = matBy(c.material); const q = num(c.qty); if (!m || q <= 0) return; const free = freeStock(m.code); if (free <= 0) { bad = bad || m.name + ': no stock.'; return; } if (q > free + 1e-9) { bad = bad || m.name + ': only ' + qtyFmt(free) + ' free.'; return; } lines.push({ material: m.code, qty: q, stock: free }); });
  }
  if (bad) { msg(esc(bad)); return; }
  if (!lines.length) { msg('Enter a requisition qty for at least one item.'); return; }
  const r = Store.put('requisitions', { id: uid(), no: nextNo('requisitions', 'REQ'), date: todayYmd(), method: U.method, jc_no: U.method === 'jc' ? U.jc : '', dept: U.method === 'jc' ? 'Production' : U.dept, process: U.process, line: U.line, picker: U.picker, lines, status: 'Pending', by: ME.name, at: nowIso() });
  audit('req.create', r.no, (r.jc_no || r.dept) + ' · ' + lines.map(l => l.material + '×' + l.qty).join(', ')); U.form = false; U.jc = ''; U.cons = [];
  flash('<b>' + esc(r.no) + '</b> created — sent to Store issuance.'); VIEWS.requisition.render();
};

/* ================= PRODUCTION REPORT ================= */
const PR_UI = { form: false, jc: '', stage: '', qty: {}, remark: '' };
function prodDone(jc, stage, size) { return Store.all('prod_reports').filter(p => norm(p.jc_no) === norm(jc) && p.stage === stage).reduce((a, p) => a + (p.sizes || []).filter(x => String(x.size) === String(size)).reduce((b, x) => b + num(x.qty), 0), 0); }
VIEWS.prodreport = {
  mod: 'production', render() {
    const edit = can('production', 'edit'); const U = PR_UI;
    let h = '<div class="toolbar"><span class="grow"></span>' + (edit ? newBtn('Production report', 'pr-new') : '') + '</div>';
    if (U.form && edit) {
      const j = U.jc ? jcBy(U.jc) : null; const o = j ? Store.all('orders').find(x => norm(x.no) === norm(j.order_no)) || {} : {};
      h += '<div class="card"><div class="card-b"><div class="row"><label>Job Card *<select id="prJc">' + '<option value="">— select —</option>' + Store.all('job_cards').filter(x => x.status !== 'Closed').sort((a, b) => String(a.no).localeCompare(String(b.no))).map(x => '<option value="' + esc(x.no) + '"' + (norm(x.no) === norm(U.jc) ? ' selected' : '') + '>' + esc(x.no + ' · ' + (x.brand || '') + ' · ' + (x.article || '')) + '</option>').join('') + '</select></label>' +
        '<label>Category<input value="' + esc(j ? j.category || o.category || '' : '') + '" readonly></label><label>Brand<input value="' + esc(j ? j.brand || '' : '') + '" readonly></label><label>Article<input value="' + esc(j ? j.article || '' : '') + '" readonly></label><label>Colour<input value="' + esc(j ? j.colour || '' : '') + '" readonly></label>' +
        '<label>Stage *<select id="prStage">' + selOpts(optList('prod_stage'), U.stage) + '</select></label></div>';
      const sizes = j ? (j.sizes || []) : [];
      h += '<div class="tbl-wrap" style="margin-top:8px"><table class="bomflat nopage" id="prTable"><tr><th>Size</th><th class="num">Order Qty</th><th class="num">Produced till now (' + esc(U.stage || 'stage') + ')</th><th class="num">Balance</th><th class="num">Quantity produced (this report)</th></tr>' +
        (!j ? '<tr><td colspan="5" class="empty">Select a Job Card</td></tr>' : !sizes.length ? '<tr><td colspan="5" class="empty">This Job Card has no size breakup</td></tr>' : sizes.map(z => {
          const tgt = num(z.act); const done = U.stage ? prodDone(j.no, U.stage, z.size) : 0; const bal = Math.max(0, tgt - done);
          return '<tr data-prs="' + esc(z.size) + '" data-bal="' + bal + '"><td><b>' + esc(z.size) + '</b></td><td class="num">' + qtyFmt(tgt) + '</td><td class="num">' + qtyFmt(done) + '</td><td class="num">' + qtyFmt(bal) + '</td><td><input class="qty right" type="number" min="0" step="1" data-prq value="' + esc(U.qty[z.size] || '') + '"' + (U.stage ? '' : ' disabled') + '></td></tr>';
        }).join('') + '<tr class="tot"><td>Total</td><td class="num">' + qtyFmt(sizes.reduce((a, z) => a + num(z.act), 0)) + '</td><td class="num">' + (U.stage ? qtyFmt(sizes.reduce((a, z) => a + prodDone(j.no, U.stage, z.size), 0)) : '') + '</td><td></td><td class="num" id="prTot">' + qtyFmt(Object.values(U.qty).reduce((a, v) => a + num(v), 0)) + '</td></tr>') + '</table></div>' +
        '<label style="margin-top:8px">Remark<textarea id="prRem" rows="2">' + esc(U.remark) + '</textarea></label>' +
        '</div><div class="card-f"><button class="btn primary" data-act="pr-save">Save report</button><span id="prMsg" class="small"></span></div></div>';
    }
    const rows = Store.all('prod_reports').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Report No</th><th>Date &amp; Time</th><th>Job Card</th><th>Category</th><th>Brand</th><th>Article</th><th>Colour</th><th>Stage</th><th>Size</th><th class="num">Qty Produced</th><th>Remark</th><th>Reported By</th></tr>' +
      (rows.length ? rows.map(p => (p.sizes || []).filter(x => num(x.qty) > 0).map((x, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><b>' + esc(p.no) + '</b></td><td class="nowrap">' + fmtDT(p.at) + '</td><td>' + esc(p.jc_no) + '</td><td>' + esc(p.category || '') + '</td><td>' + esc(p.brand || '') + '</td><td>' + esc(p.article || '') + '</td><td>' + esc(p.colour || '') + '</td><td>' + esc(p.stage) + '</td><td>' + esc(x.size) + '</td><td class="num">' + qtyFmt(x.qty) + '</td><td>' + esc(p.remark || '') + '</td><td>' + esc(p.by) + '</td></tr>').join('')).join('') : '<tr><td colspan="12" class="empty">No production reports yet</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'prJc') { U.jc = t.value; U.qty = {}; VIEWS.prodreport.render(); }
      else if (t.id === 'prStage') { U.stage = t.value; U.qty = {}; VIEWS.prodreport.render(); }
    });
    m.addEventListener('input', e => {
      if (e.target.dataset.prq != null) { U.qty[e.target.closest('tr').dataset.prs] = e.target.value; const tt = $('#prTot'); if (tt) tt.textContent = qtyFmt(Object.values(U.qty).reduce((a, v) => a + num(v), 0)); }
      if (e.target.id === 'prRem') U.remark = e.target.value;
    });
  }
};
ACTIONS['pr-new'] = () => { Object.assign(PR_UI, { form: !PR_UI.form, jc: '', stage: '', qty: {}, remark: '' }); VIEWS.prodreport.render(); };
ACTIONS['pr-save'] = () => {
  if (!requirePerm('production', 'edit')) return;
  const U = PR_UI; const msg = t => { $('#prMsg').innerHTML = '<span class="late-txt">' + t + '</span>'; };
  const j = jcBy(U.jc); if (!j) { msg('Select a Job Card.'); return; }
  if (!U.stage) { msg('Select the Stage.'); return; }
  let bad = ''; const sizes = [];
  $$('#prTable tr[data-prs]').forEach(tr => { const q = num(($('[data-prq]', tr) || {}).value); if (q <= 0) return; if (q > num(tr.dataset.bal) + 1e-9) bad = bad || 'Size ' + tr.dataset.prs + ': only ' + qtyFmt(tr.dataset.bal) + ' left at this stage.'; sizes.push({ size: tr.dataset.prs, qty: q }); });
  if (bad) { msg(esc(bad)); return; }
  if (!sizes.length) { msg('Enter the quantity produced for at least one size.'); return; }
  const o = Store.all('orders').find(x => norm(x.no) === norm(j.order_no)) || {};
  const p = Store.put('prod_reports', { id: uid(), no: nextNo('prod_reports', 'PRD'), at: nowIso(), date: todayYmd(), jc_no: j.no, order_no: j.order_no || '', category: j.category || o.category || '', brand: j.brand || '', article: j.article || '', colour: j.colour || '', stage: U.stage, sizes, total: sizes.reduce((a, x) => a + x.qty, 0), remark: String(U.remark || '').trim(), by: ME.name });
  audit('prod.report', p.no, j.no + ' · ' + U.stage + ' · ' + p.total);
  Object.assign(U, { form: false, jc: '', stage: '', qty: {}, remark: '' }); flash(esc(p.no) + ' saved — ' + qtyFmt(p.total) + ' pcs at ' + esc(p.stage) + '.'); VIEWS.prodreport.render();
};

VIEWS.prodtracker = {
  mod: 'production', render() {
    const rows = Store.all('orders').map(o => ({ o, st: orderState(o), r: resolveOrder(o) })).filter(x => x.st.open && x.r);
    const ids = ['material', 'production', 'qc'];
    setMain('<div class="tbl-wrap"><table><tr><th rowspan="2">Order</th><th rowspan="2">Brand</th><th rowspan="2" class="num">Qty</th>' + ['Material', 'Production', 'QC'].map(n => '<th colspan="4" class="c">' + n + '</th>').join('') + '<th rowspan="2">Current Step</th><th rowspan="2" class="num">Delay</th></tr><tr>' + ids.map(() => '<th>Status</th><th>Planned</th><th>Actual</th><th class="num">Delay</th>').join('') + '</tr>' +
      (rows.length ? rows.map(x => {
        const cell = id => { const s = x.r.steps[id]; if (!s || s.status === 'N/A') return '<td>N/A</td><td></td><td></td><td></td>'; return '<td><span class="st ' + stCls(s.status) + '">' + s.status + '</span></td><td>' + (s.planned ? fmtDT(s.planned) : '') + '</td><td>' + (s.actual ? fmtDT(s.actual) : '') + '</td><td class="num late-txt">' + (s.delayMinutes ? fmtDelay(s.delayMinutes) : '') + '</td>'; };
        return '<tr class="click" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td><b>' + esc(x.o.no) + '</b></td><td>' + esc(x.o.customer_name) + '</td><td class="num">' + qtyFmt(orderTotals(x.o).qty) + '</td>' + ids.map(cell).join('') + '<td>' + (x.st.cur ? esc(x.st.cur.name) : '') + '</td><td class="num late-txt">' + (x.st.cur ? fmtDelay(x.st.cur.delayMinutes) : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="17" class="empty">No open orders</td></tr>') + '</table></div>');
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
      if (noBom.length) h += '<div class="panel" style="border-left:3px solid var(--late);margin-bottom:10px">BOM missing: <b>' + noBom.map(esc).join(', ') + '</b> — create them in Development; the MRS is incomplete until then.</div>';
      h += '<div class="toolbar"><span class="muted small">' + esc(o.no) + ' · ' + esc(o.customer_name) + ' · ' + qtyFmt(orderTotals(o).qty) + ' pairs</span><span class="grow"></span><button class="btn" data-act="mrs-csv">Export CSV</button></div>';
      h += '<div class="tbl-wrap"><table><tr><th>Material</th><th>UOM</th><th class="num">Required</th><th class="num">In stock</th><th class="num">Shortfall</th></tr>' +
        (rows.length ? rows.map(x => { const st = stk[norm(x.material)] || 0; const short = Math.max(0, x.qty - st); return '<tr><td><b>' + esc(x.material) + '</b></td><td>' + esc(x.uom) + '</td><td class="num">' + qtyFmt(x.qty) + '</td><td class="num">' + qtyFmt(st) + '</td><td class="num ' + (short ? 'late-txt' : '') + '">' + (short ? qtyFmt(short) : '—') + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">No BOM found for the articles in this order</td></tr>') + '</table></div>';
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
        (edit ? '<td class="right">' + (paid ? '' : '<button class="btn sm" data-act="pay-mark" data-id="' + esc(d.id) + '">Mark received</button>') + '</td>' : '') + '</tr>'; }).join('') : '<tr><td colspan="8" class="empty">No invoices yet — invoices appear here after dispatch</td></tr>') + '</table></div>';
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
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Ticket</th><th>Subject</th><th>Detail</th><th>Dept</th><th>Priority</th><th>Raised By</th><th>Age</th><th>Escalated</th><th>Status</th><th>Last Comment</th><th>Comment By</th>' + (edit ? '<th>Comment</th><th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(t => {
        const esc48 = ticketEscalated(t); const age = Math.floor((Date.now() - new Date(t.at)) / 3600000);
        const last = (t.comments || []).slice(-1)[0];
        return '<tr><td><b>' + esc(t.no) + '</b></td><td>' + esc(t.subject) + '</td><td>' + esc(t.detail || '') + '</td><td>' + esc(t.dept) + '</td><td class="' + (t.priority === 'Critical' ? 'late-txt' : t.priority === 'High' ? '' : 'muted') + '">' + esc(t.priority) + '</td><td>' + esc(t.by) + '</td><td class="nowrap">' + (age < 48 ? age + 'h' : Math.floor(age / 24) + 'd') + '</td>' +
          '<td>' + (esc48 ? '<span class="late-txt">Yes</span>' : '') + '</td><td><span class="st ' + (t.status === 'Closed' ? 'Done' : t.status === 'In Progress' ? 'Pending' : 'Late') + '">' + t.status + '</span></td><td>' + (last ? esc(last.note) : '') + '</td><td>' + (last ? esc(last.by) : '') + '</td>' +
          (edit ? '<td>' + (t.status !== 'Closed' ? '<input data-tk-note style="width:140px">' : '') + '</td><td class="right">' + (t.status !== 'Closed' ? '<button class="btn sm" data-act="tkt-comment" data-id="' + esc(t.id) + '">Add</button> ' + (t.status === 'Open' ? '<button class="btn sm" data-act="tkt-status" data-id="' + esc(t.id) + '" data-s="In Progress">Start</button> ' : '') + '<button class="btn sm primary" data-act="tkt-status" data-id="' + esc(t.id) + '" data-s="Closed">Close</button>' : '') + '</td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="13" class="empty">No tickets</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'f') { TKT_UI.f = e.detail; VIEWS.tickets.render(); } });
  }
};
ACTIONS['tkt-new'] = () => { TKT_UI.form = !TKT_UI.form; VIEWS.tickets.render(); if (TKT_UI.form) $('#ntSub').focus(); };
ACTIONS['tkt-save'] = () => {
  if (!requirePerm('tickets', 'edit')) return;
  const sub = $('#ntSub').value.trim(); const dept = segVal($('[data-seg="ntDept"]'));
  if (!sub || !dept) { $('#ntMsg').innerHTML = '<span class="late-txt">Subject and department are required.</span>'; return; }
  const t = Store.put('tickets', { id: uid(), no: nextNo('tickets', 'TKT'), at: nowIso(), by: ME.name, dept, priority: segVal($('[data-seg="ntPri"]')) || 'Normal', subject: sub, detail: $('#ntDet').value.trim(), status: 'Open', comments: [] });
  audit('ticket.create', t.no, dept + ' · ' + sub); TKT_UI.form = false; flash(esc(t.no) + ' raised.'); VIEWS.tickets.render();
};
ACTIONS['tkt-comment'] = el => { const note = $('[data-tk-note]', el.closest('tr')).value.trim(); if (!note) return; const t = Store.get('tickets', el.dataset.id); t.comments = t.comments || []; t.comments.push({ at: nowIso(), by: ME.name, note }); Store.put('tickets', t); VIEWS.tickets.render(); };
ACTIONS['tkt-status'] = el => { const t = Store.get('tickets', el.dataset.id); t.status = el.dataset.s; if (el.dataset.s === 'Closed') { t.closed_by = ME.name; t.closed_at = nowIso(); } Store.put('tickets', t); audit('ticket.' + el.dataset.s.toLowerCase().replace(' ', ''), t.no, ''); VIEWS.tickets.render(); };

/* ================= Vendors master ================= */
VIEWS.vendors = {
  mod: 'purchase', render() {
    masterView({
      col: 'vendors', mod: 'purchase', title: 'Vendors', view: VIEWS.vendors, sort: 'name', paste: true,
      cols: [{ k: 'name', l: 'Vendor Name', ph: 'e.g. ABC Textiles' }, { k: 'address', l: 'Address' }, { k: 'state', l: 'State', w: 130 }, { k: 'gstin', l: 'GST No', w: 160, upper: true }, { k: 'email', l: 'Email ID', w: 180 }, { k: 'mobile', l: 'Mobile No.', w: 120 }, { k: 'qc_required', l: 'QC Report', w: 90, opts: () => [{ v: '', l: 'No' }, { v: 'Yes', l: 'Yes' }] }],
      validate: d => uniq('vendors', 'name', 'Vendor')(d),
      inUse: d => Store.all('purchase_orders').some(p => norm(p.vendor) === norm(d.name)) ? 'Vendor has POs — cannot delete.' : ''
    });
    $('#main').insertAdjacentHTML('beforeend', '');
  }
};


ACTIONS['rsv-open'] = el => { VIEWS.stock.rsv = VIEWS.stock.rsv === el.dataset.c ? null : el.dataset.c; VIEWS.stock.render(); };
ACTIONS['rsv-save'] = el => {
  if (!requirePerm('store', 'edit')) return;
  const code = el.dataset.c; const jc = $('#rsvJc').value.trim(); const qty = num($('#rsvQty').value);
  if (!jc || !jcBy(jc)) { $('#rsvMsg').innerHTML = '<span class="late-txt">Select a valid JC.</span>'; return; }
  if (qty <= 0 || qty > openStockOf(code)) { $('#rsvMsg').innerHTML = '<span class="late-txt">Open stock is only ' + qtyFmt(openStockOf(code)) + '.</span>'; return; }
  Store.put('rsjw', { id: uid(), jc_no: jc, material: code, qty, by: ME.name, at: nowIso() });
  audit('stock.reserve', jc, code + ' × ' + qtyFmt(qty)); VIEWS.stock.rsv = null; flash(qtyFmt(qty) + ' ' + esc(code) + ' reserved for ' + esc(jc) + '.'); VIEWS.stock.render();
};
