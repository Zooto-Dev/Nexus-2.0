/* Nexus 2.0 — Article Master (Merchant) and the Super Admin's Excess view.
   One row per brand + article: its BOM (version, status, COGS per pair), orders, job cards, what was issued
   against what the BOM asked for (excess issuance), and whether its packaging PPT is in.
   Excess = more than the requirement — on a PO (ordered above the net requirement, MOQ or extra) or on
   issuance (issued to a job card above what its BOM lines ask for). */
'use strict';

const AM_UI = { q: '', brand: '', open: '' };
const amKey = (brand, article) => norm(brand) + '|' + norm(article);
function amLatestBom(brand, article) {
  const all = Store.all('boms').filter(b => norm(b.article) === norm(article) && (!b.brand || norm(b.brand) === norm(brand)));
  const fin = all.filter(b => typeof bomFinal === 'function' ? bomFinal(b) : true).sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  const any = all.sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  return { fin: fin || null, any: any || null };
}
const bomCogs = b => (typeof bomCogsOf === 'function' ? bomCogsOf(b) : (b && b.lines || []).reduce((s, l) => s + num(l.qty) * num(l.price || (matBy(l.material) || {}).price), 0));
// one job card's lines against what was issued: required, issued, excess (issued above required), by item
function jcIssueRows(j) {
  const byMat = {}; (j.lines || []).forEach(l => { const k = norm(l.material); const g = byMat[k] || (byMat[k] = { material: l.material, required: 0 }); g.required += num(l.required); });
  return Object.values(byMat).map(g => { const issued = issuedToJc(j.no, g.material); const price = matPrice(g.material); return { material: g.material, name: (matBy(g.material) || {}).name || g.material, uom: (matBy(g.material) || {}).uom || '', required: g.required, issued, excess: Math.max(0, issued - g.required), price, excessValue: Math.max(0, issued - g.required) * price }; });
}
function amRows() {
  const map = {};
  const row = (brand, article) => { const k = amKey(brand, article); return map[k] || (map[k] = { brand: String(brand || '').trim(), article: String(article || '').trim().toUpperCase(), style: '', category: '', gender: '', orders: [], jcs: [] }); };
  // an article with no brand on it takes the brand of the orders / BOMs that use it, so it is one row, not two
  const brandOfArt = {}; Store.all('orders').forEach(o => (o.lines || []).forEach(l => { if (l.article && !brandOfArt[norm(l.article)]) brandOfArt[norm(l.article)] = o.customer_name || o.brand || ''; }));
  Store.all('boms').forEach(b => { if (b.article && b.brand && !brandOfArt[norm(b.article)]) brandOfArt[norm(b.article)] = b.brand; });
  Store.all('items').forEach(i => { if (!i.code) return; const r = row(i.brand || brandOfArt[norm(i.code)] || '', i.code); r.style = r.style || i.name || ''; r.category = r.category || i.group || ''; r.gender = r.gender || i.gender || ''; r.inMaster = true; });
  Store.all('orders').filter(o => o.priority !== 'Cancelled').forEach(o => (o.lines || []).forEach(l => { if (!l.article) return; const r = row(o.customer_name || o.brand || '', l.article); if (!r.orders.includes(o)) r.orders.push(o); r.style = r.style || l.style || ''; r.gender = r.gender || l.gender || ''; r.category = r.category || o.category || ''; r.qty = (r.qty || 0) + num(l.qty); }));
  Store.all('job_cards').forEach(j => { if (!j.article) return; const r = row(j.brand || '', j.article); r.jcs.push(j); });
  Store.all('boms').forEach(b => { if (!b.article) return; const r = row(b.brand || '', b.article); r.style = r.style || b.style || ''; r.category = r.category || b.category || ''; r.gender = r.gender || b.gender || ''; });
  return Object.values(map).map(r => {
    const { fin, any } = amLatestBom(r.brand, r.article); r.bom = fin; r.bomAny = any; r.cogs = bomCogs(fin); r.noPrice = typeof bomNoPrice === 'function' ? bomNoPrice(fin) : [];
    const it = Store.all('items').find(i => norm(i.code) === norm(r.article) && (!i.brand || !r.brand || norm(i.brand) === norm(r.brand))) || Store.all('items').find(i => norm(i.code) === norm(r.article));
    r.item = it || null; r.sell = it ? num(it.sell_price) : 0; r.margin = r.sell && r.cogs ? r3(r.sell - r.cogs) : null;
    const rows = r.jcs.flatMap(jcIssueRows);
    r.issuedValue = rows.reduce((s, x) => s + x.issued * x.price, 0); r.requiredValue = rows.reduce((s, x) => s + x.required * x.price, 0);
    r.excessQty = rows.reduce((s, x) => s + x.excess, 0); r.excessValue = rows.reduce((s, x) => s + x.excessValue, 0);
    r.jcQty = r.jcs.reduce((s, j) => s + num(j.qty), 0);
    r.ppt = typeof pptOf === 'function' ? !!pptOf(r.brand, r.article) : false;
    return r;
  }).sort((a, b) => a.brand.localeCompare(b.brand) || a.article.localeCompare(b.article));
}
function amDetail(r) {
  const b = r.bom; const kv = (k, v) => '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>';
  let h = '<div class="card" style="margin-top:14px;padding:14px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">' + esc(r.brand) + ' · ' + esc(r.article) + '</h2>' + (b ? '<span class="st Done">BOM v' + b.version + '</span>' : r.bomAny ? '<span class="st Pending">BOM v' + r.bomAny.version + ' ' + esc(r.bomAny.status || '') + '</span>' : '<span class="st Late">No BOM</span>') + (r.ppt ? '<span class="st Done">PPT</span>' : '<span class="st Late">No PPT</span>') + '<span class="grow"></span><button class="btn sm" data-act="am-close">Close</button></div>' +
    '<div class="lp-rep-grid" style="margin-top:10px"><table class="jckv">' + kv('Style', esc(r.style || '—')) + kv('Category', esc(r.category || '—')) + kv('Gender', esc(r.gender || '—')) + kv('Photo', b && b.photo ? photoThumb(b.photo) : '—') + '</table>' +
    '<table class="jckv">' + kv('Selling price / pair', (can('merchant', 'edit') ? '<input type="number" min="0" step="any" id="amSell" value="' + esc(r.sell || '') + '" style="width:120px"> <button class="btn sm" data-act="am-sell" data-k="' + esc(amKey(r.brand, r.article)) + '">Save</button>' : (r.sell ? '₹' + money(r.sell) : '—'))) +
    kv('Margin / pair', r.margin == null ? '<span class="muted">needs a selling price and an approved BOM</span>' : '<b class="' + (r.margin < 0 ? 'late-txt' : 'ok-txt') + '">₹' + money(r.margin) + '</b>' + (r.sell ? ' <span class="muted small">' + (r.margin / r.sell * 100).toFixed(1) + '% of the price</span>' : '')) +
    kv('COGS / pair (BOM)', '<b>₹' + money(r.cogs) + '</b>' + (r.noPrice && r.noPrice.length ? ' <span class="late-txt small">' + r.noPrice.length + ' item(s) without an approved price</span>' : '')) + kv('Orders', r.orders.length + ' · ' + qtyFmt(r.qty || 0) + ' pairs') + kv('Job cards', r.jcs.length + ' · ' + qtyFmt(r.jcQty) + ' pairs') + kv('BOM value of job cards', '₹' + money(r.requiredValue)) + '</table>' +
    '<table class="jckv">' + kv('Issued value', '₹' + money(r.issuedValue)) + kv('Excess issuance', (r.excessQty ? '<b class="late-txt">' + qtyFmt(r.excessQty) + ' units · ₹' + money(r.excessValue) + '</b>' : '<span class="ok-txt">none</span>')) + kv('Issued vs BOM', r.requiredValue ? Math.round(r.issuedValue / r.requiredValue * 100) + '%' : '—') + '</table></div>';
  if (b) h += '<h3 style="margin:14px 0 6px">BOM v' + b.version + (b.colour ? ' · ' + esc(b.colour) : '') + ' <span class="muted small">' + esc(b.status || 'Final') + (b.approved_by ? ' · approved by ' + esc(b.approved_by) : '') + '</span></h3><div class="tbl-wrap"><table><tr><th>Process</th><th>Section</th><th>Item</th><th>UOM</th><th class="num">Norms</th><th class="num">Price</th><th class="num">Cost / pair</th><th>Supplier</th></tr>' +
    b.lines.map(l => '<tr><td>' + esc(l.process || '') + '</td><td>' + esc(l.section || '') + '</td><td>' + esc((matBy(l.material) || {}).name || l.material) + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + money(l.price || matPrice(l.material)) + '</td><td class="num">' + money(num(l.qty) * num(l.price || matPrice(l.material))) + '</td><td>' + esc(l.supplier || '') + '</td></tr>').join('') +
    '<tr class="tt"><td colspan="6"><b>COGS per pair</b></td><td class="num"><b>₹' + money(r.cogs) + '</b></td><td></td></tr></table></div>';
  if (r.jcs.length) h += '<h3 style="margin:14px 0 6px">Job cards — required vs issued</h3><div class="tbl-wrap"><table><tr><th>Job Card</th><th>Order</th><th class="num">Pairs</th><th>Item</th><th class="num">Required</th><th class="num">Issued</th><th class="num">Excess</th><th class="num">Excess ₹</th><th>Status</th></tr>' +
    r.jcs.sort((a, c) => String(c.no).localeCompare(String(a.no))).map(j => { const rows = jcIssueRows(j); return rows.length ? rows.map((x, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '>' + (i === 0 ? '<td rowspan="' + rows.length + '"><b>' + esc(j.no) + '</b></td><td rowspan="' + rows.length + '">' + esc(j.order_no || '') + '</td><td rowspan="' + rows.length + '" class="num">' + qtyFmt(j.qty) + '</td>' : '') + '<td>' + esc(x.name) + '</td><td class="num">' + qtyFmt(x.required) + '</td><td class="num">' + qtyFmt(x.issued) + '</td><td class="num ' + (x.excess ? 'late-txt' : '') + '">' + (x.excess ? qtyFmt(x.excess) : '') + '</td><td class="num ' + (x.excess ? 'late-txt' : '') + '">' + (x.excess ? money(x.excessValue) : '') + '</td>' + (i === 0 ? '<td rowspan="' + rows.length + '">' + esc(j.status || '') + '</td>' : '') + '</tr>').join('') : '<tr class="bomfirst"><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.order_no || '') + '</td><td class="num">' + qtyFmt(j.qty) + '</td><td colspan="5" class="muted">No material lines</td><td>' + esc(j.status || '') + '</td></tr>'; }).join('') + '</table></div>';
  if (r.orders.length) h += '<h3 style="margin:14px 0 6px">Orders</h3><div class="tbl-wrap"><table><tr><th>Order</th><th>Date</th><th class="num">Pairs</th><th>Buyer PO</th><th>Status</th></tr>' + r.orders.map(o => '<tr><td><a href="#/order/' + esc(o.id) + '"><b>' + esc(o.no) + '</b></a></td><td class="nowrap">' + fmtD(o.order_date) + '</td><td class="num">' + qtyFmt((o.lines || []).filter(l => norm(l.article) === norm(r.article)).reduce((s, l) => s + num(l.qty), 0)) + '</td><td>' + esc(o.buyer_po || '') + '</td><td>' + esc((orderState(o) || {}).label || '') + '</td></tr>').join('') + '</table></div>';
  return h + '</div>';
}
VIEWS.articlemaster = {
  mod: 'merchant', render(param) {
    if (param) AM_UI.open = decodeURIComponent(param);
    const bs = brandScope(); let rows = amRows().filter(r => brandOk(r.brand, bs));
    const brands = Array.from(new Set(rows.map(r => r.brand).filter(Boolean))).sort(); const q = norm(AM_UI.q);
    rows = rows.filter(r => (!AM_UI.brand || r.brand === AM_UI.brand) && (!q || norm(r.brand + ' ' + r.article + ' ' + r.style + ' ' + r.category).includes(q)));
    let h = '<div class="toolbar"><input id="amQ" placeholder="Search article / style / brand…" value="' + esc(AM_UI.q) + '" style="width:260px"><select id="amBrand"><option value="">All brands</option>' + brands.map(b => '<option' + (b === AM_UI.brand ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select><span class="muted small">' + rows.length + ' article(s)</span><span class="grow"></span><button class="btn" data-act="am-csv">Export CSV</button></div>';
    h += '<div class="tbl-wrap"><table><tr><th>Brand</th><th>Article</th><th>Style</th><th>Category</th><th>BOM</th><th class="num">Sells at ₹</th><th class="num">COGS / pair ₹</th><th class="num">Margin ₹/pair</th><th class="num">Orders</th><th class="num">Order pairs</th><th class="num">Job cards</th><th class="num">BOM value ₹</th><th class="num">Issued ₹</th><th class="num">Excess issue</th><th class="num">Excess ₹</th><th>PPT</th></tr>' +
      (rows.length ? rows.map(r => '<tr class="click' + (AM_UI.open === amKey(r.brand, r.article) ? ' lp-sel' : '') + '" data-act="am-open" data-k="' + esc(amKey(r.brand, r.article)) + '"><td>' + esc(r.brand) + '</td><td><b>' + esc(r.article) + '</b></td><td>' + esc(r.style) + '</td><td>' + esc(r.category) + '</td><td>' + (r.bom ? '<span class="st Done">v' + r.bom.version + '</span>' : r.bomAny ? '<span class="st Pending">v' + r.bomAny.version + ' ' + esc(r.bomAny.status || '') + '</span>' : '<span class="st Late">none</span>') + '</td><td class="num">' + (r.sell ? money(r.sell) : '<span class="muted">—</span>') + '</td><td class="num">' + (r.cogs ? money(r.cogs) : '') + (r.noPrice && r.noPrice.length ? '<div class="small late-txt">' + r.noPrice.length + ' no price</div>' : '') + '</td><td class="num ' + (r.margin != null && r.margin < 0 ? 'late-txt' : '') + '">' + (r.margin == null ? '' : '<b>' + money(r.margin) + '</b>') + '</td><td class="num">' + (r.orders.length || '') + '</td><td class="num">' + (r.qty ? qtyFmt(r.qty) : '') + '</td><td class="num">' + (r.jcs.length || '') + '</td><td class="num">' + (r.requiredValue ? money(r.requiredValue) : '') + '</td><td class="num">' + (r.issuedValue ? money(r.issuedValue) : '') + '</td><td class="num ' + (r.excessQty ? 'late-txt' : '') + '">' + (r.excessQty ? qtyFmt(r.excessQty) : '') + '</td><td class="num ' + (r.excessValue ? 'late-txt' : '') + '">' + (r.excessValue ? money(r.excessValue) : '') + '</td><td>' + (r.ppt ? '<span class="ok-txt">✓</span>' : '<span class="late-txt">✗</span>') + '</td></tr>').join('') : '<tr><td colspan="14" class="empty">No articles</td></tr>') + '</table></div>';
    const open = AM_UI.open && rows.find(r => amKey(r.brand, r.article) === AM_UI.open);
    if (open) h += amDetail(open);
    const m = setMain(h); AM_UI.rows = rows;
    $('#amQ', m).addEventListener('input', e => { AM_UI.q = e.target.value; VIEWS.articlemaster.render(); const i = $('#amQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
    $('#amBrand', m).addEventListener('change', e => { AM_UI.brand = e.target.value; VIEWS.articlemaster.render(); });
  }
};
ACTIONS['am-open'] = el => { AM_UI.open = AM_UI.open === el.dataset.k ? '' : el.dataset.k; VIEWS.articlemaster.render(); if (AM_UI.open) { const d = $('#main .card'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
ACTIONS['am-close'] = () => { AM_UI.open = ''; VIEWS.articlemaster.render(); };
ACTIONS['am-sell'] = el => {
  if (!requirePerm('merchant', 'edit')) return;
  const r = (AM_UI.rows || []).find(x => amKey(x.brand, x.article) === el.dataset.k); if (!r) return;
  const v = num(($('#amSell') || {}).value); if (!(v >= 0)) { flash('Type the selling price.', 'err'); return; }
  const it = r.item || Store.put('items', { id: uid(), code: r.article, name: r.style || '', group: r.category || '', gender: r.gender || '', brand: r.brand });
  const was = num(it.sell_price); it.sell_price = v; Store.put('items', it);
  audit('article.price', r.brand + ' · ' + r.article, '₹' + money(was) + ' → ₹' + money(v) + (r.cogs ? ' · COGS ₹' + money(r.cogs) + ' · margin ₹' + money(v - r.cogs) : ''));
  flash('Selling price saved' + (r.cogs ? ' — margin ₹' + money(v - r.cogs) + ' per pair.' : '.')); VIEWS.articlemaster.render();
};
ACTIONS['am-csv'] = () => downloadCsv('article-master-' + todayYmd() + '.csv', [['Brand', 'Article', 'Style', 'Category', 'BOM', 'Selling price', 'COGS per pair', 'Margin per pair', 'Orders', 'Order pairs', 'Job cards', 'BOM value', 'Issued value', 'Excess issue qty', 'Excess issue value', 'PPT']].concat((AM_UI.rows || []).map(r => [r.brand, r.article, r.style, r.category, r.bom ? 'v' + r.bom.version : r.bomAny ? 'v' + r.bomAny.version + ' ' + (r.bomAny.status || '') : '', r.sell || '', r3(r.cogs), r.margin == null ? '' : r.margin, r.orders.length, r.qty || 0, r.jcs.length, r3(r.requiredValue), r3(r.issuedValue), r3(r.excessQty), r3(r.excessValue), r.ppt ? 'yes' : 'no'])));

/* ---------- Super Admin: excess purchase and excess issuance, on Home ---------- */
function excessPurchaseRows() {
  const out = [];
  Store.all('purchase_orders').filter(p => !p.cancelled && p.approval !== 'Rejected').forEach(p => (p.lines || []).forEach(l => {
    const moq = (p.moq_log || []).find(x => norm(x.material) === norm(l.material));
    const net = moq ? num(moq.net) : (l.net != null ? num(l.net) : null); if (net == null) return;
    const extra = r3(num(l.qty) - Math.ceil(net - 1e-9)); if (extra <= 1e-6) return;   // rounding a need up to a whole unit is not excess
    out.push({ p, l, net, extra, value: extra * num(l.rate) * (1 + num(l.gst) / 100), why: moq ? 'MOQ · ' + (moq.reason || '') : 'above requirement', m: matBy(l.material) || {} });
  }));
  return out.sort((a, b) => b.value - a.value);
}
function excessIssueRows() {
  const out = [];
  Store.all('job_cards').forEach(j => jcIssueRows(j).forEach(x => { if (x.excess > 1e-6) out.push(Object.assign({ j }, x)); }));
  return out.sort((a, b) => b.excessValue - a.excessValue);
}
function saExcessHtml() {
  const P = excessPurchaseRows(), I = excessIssueRows();
  const pv = P.reduce((s, x) => s + x.value, 0), iv = I.reduce((s, x) => s + x.excessValue, 0);
  let h = '<div class="sa-lbl">Spent above the requirement</div><div class="sa-stack">' + saCard({ title: 'Excess purchase', n: P.length, tone: 'bad', ico: 'box', sub: 'ordered above the net requirement · ₹' + money(pv), empty: 'No PO above the requirement', body: '<div class="tbl-wrap"><table class="nopage nofilter sa-tb"><tr><th>PO</th><th>Vendor</th><th>Item</th><th class="num">Required</th><th class="num">Ordered</th><th class="num">Excess</th><th class="num">₹</th><th>Why</th><th>Status</th></tr>' +
    (P.length ? P.slice(0, 12).map(x => '<tr><td><a href="#/po/' + esc(x.p.id) + '"><b>' + esc(x.p.no) + '</b></a></td><td>' + esc(x.p.vendor) + '</td><td>' + esc(x.m.name || x.l.material) + '</td><td class="num">' + qtyFmt(x.net) + '</td><td class="num">' + qtyFmt(x.l.qty) + '</td><td class="num late-txt"><b>' + qtyFmt(x.extra) + '</b></td><td class="num">' + money(x.value) + '</td><td class="small">' + esc(x.why) + '</td><td>' + esc(poStatus(x.p)) + '</td></tr>').join('') + (P.length > 12 ? '<tr><td colspan="9" class="muted small">+ ' + (P.length - 12) + ' more</td></tr>' : '') : '') + '</table></div>' }) +
    saCard({ title: 'Excess issuance', n: I.length, tone: 'bad', ico: 'person', link: '#/articlemaster', linkText: 'Article Master', sub: 'issued to a job card above its BOM · ₹' + money(iv), empty: 'Nothing issued above the BOM', body: '<div class="tbl-wrap"><table class="nopage nofilter sa-tb"><tr><th>Job Card</th><th>Article</th><th>Item</th><th class="num">Required</th><th class="num">Issued</th><th class="num">Excess</th><th class="num">₹</th></tr>' +
    (I.length ? I.slice(0, 12).map(x => '<tr><td><b>' + esc(x.j.no) + '</b></td><td>' + esc((x.j.brand || '') + ' · ' + (x.j.article || '')) + '</td><td>' + esc(x.name) + '</td><td class="num">' + qtyFmt(x.required) + '</td><td class="num">' + qtyFmt(x.issued) + '</td><td class="num late-txt"><b>' + qtyFmt(x.excess) + '</b></td><td class="num">' + money(x.excessValue) + '</td></tr>').join('') + (I.length > 12 ? '<tr><td colspan="7" class="muted small">+ ' + (I.length - 12) + ' more — see <a href="#/articlemaster">Article Master</a></td></tr>' : '') : '') + '</table></div>' }) + '</div>';
  return h;
}
