/* ---------- Item price: the only way a material price is set or changed ----------
   Asked from Stock View (Price) or from the PO popup when an item has no price;
   only the Super Admin approves; the approved price goes on the item and every PO / BOM / opening stock uses it. */
const prAll = () => Store.all('price_requests');
const prPending = code => prAll().find(x => x.status === 'Pending' && norm(x.material) === norm(code));
const prCanAsk = () => can('store', 'edit') || can('purchase', 'edit') || isSuperAdmin();
const matPrice = code => num((matBy(code) || {}).price);
// one dialog for one or many items; items that already wait for approval show their asked price
function prDialog(codes, source, ref, title) {
  if (!prCanAsk()) { flash('No access to ask for a price.', 'err'); return; }
  const ms = codes.map(c => matBy(c)).filter(Boolean); if (!ms.length) return;
  const old = $('#prDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'prDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg hx-dlg"><div class="dlg-h">' + esc(title || 'Item price') + '</div><div class="tbl-wrap"><table class="nopage nofilter"><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Current Price ₹</th><th class="num">New Price ₹</th></tr>' +
    ms.map(m => { const p = prPending(m.code); return '<tr data-prc="' + esc(m.code) + '"><td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + (num(m.price) ? money(m.price) : '<span class="late-txt">—</span>') + '</td>' +
      '<td class="num">' + (p ? '<span class="pend-txt">' + money(p.new_price) + ' · pending</span>' : '<input data-prn type="number" min="0" step="any" class="right" style="width:110px">') + '</td></tr>'; }).join('') + '</table></div>' +
    '<div class="dlg-f"><span id="prMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-pr-x>Cancel</button><button class="btn primary" data-pr-ok>Send for approval</button></div></div>';
  document.body.appendChild(d); const f = $('[data-prn]', d); if (f) f.focus();
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-pr-x]') || ev.target === d) { d.remove(); return; }
    if (!ev.target.closest('[data-pr-ok]')) return;
    const rows = $$('tr[data-prc]', d).map(tr => ({ code: tr.dataset.prc, inp: $('[data-prn]', tr) })).filter(r => r.inp);
    const bad = rows.find(r => !(num(r.inp.value) > 0)); if (bad) { $('#prMsg', d).textContent = 'Enter a price above 0 for ' + bad.code + '.'; bad.inp.focus(); return; }
    const same = rows.find(r => num(r.inp.value) === matPrice(r.code)); if (same) { $('#prMsg', d).textContent = same.code + ': same as the current price.'; return; }
    rows.forEach(r => prAsk(r.code, num(r.inp.value), source, ref));
    d.remove(); flash(rows.length ? rows.length + ' price(s) sent to the Super Admin for approval.' : 'Already waiting for approval.'); route();
  });
}
function prAsk(code, price, source, ref) {
  const m = matBy(code); if (!m || prPending(code)) return null;
  const x = Store.put('price_requests', { id: uid(), no: nextNo('price_requests', 'PRC'), material: m.code, uom: m.uom || '', old_price: num(m.price), new_price: num(price), source, ref: ref || '', status: 'Pending', by: ME.name, at: nowIso() });
  audit('price.request', x.no, m.code + ' ₹' + money(x.old_price) + ' → ₹' + money(x.new_price) + ' · ' + source + (ref ? ' ' + ref : ''));
  return x;
}
function prDecide(x, ok) {
  if (!isSuperAdmin()) { flash('Only the Super Admin approves a price.', 'err'); return; }
  if (!x || x.status !== 'Pending') return;
  if (ok) {
    const m = matBy(x.material); if (!m) { flash('Item ' + esc(x.material) + ' no longer exists.', 'err'); return; }
    const was = num(m.price); m.price = num(x.new_price); Store.put('materials', m);
    x.applied_over = was;
    x.boms = prPushToBoms(m.code, num(x.new_price), x.no);
  }
  x.status = ok ? 'Approved' : 'Rejected'; x.approved_by = ME.name; x.approved_at = nowIso(); Store.put('price_requests', x);
  audit('price.' + (ok ? 'approve' : 'reject'), x.no, x.material + ' ₹' + money(x.old_price) + ' → ₹' + money(x.new_price));
}
/* A BOM line keeps the price of the day it was written, so its COGS can go stale. When a price is approved
   the new price goes onto every BOM line of that item and the BOM's cost is written again; the old cost is
   kept in the BOM's price_log. Purchase orders are NOT touched: a PO rate is what the vendor was told. */
function prPushToBoms(code, price, reqNo) {
  const hit = [];
  Store.all('boms').forEach(b => {
    const mine = (b.lines || []).filter(l => norm(l.material) === norm(code) && num(l.price) !== price);
    if (!mine.length) return;
    const was = (b.lines || []).reduce((s, l) => s + num(l.qty) * num(l.price), 0);
    mine.forEach(l => { l.price = price; });
    const now = (b.lines || []).reduce((s, l) => s + num(l.qty) * num(l.price), 0);
    b.price_log = (b.price_log || []).concat([{ material: code, price, was_cogs: r3(was), cogs: r3(now), req: reqNo || '', by: ME ? ME.name : 'System', at: nowIso() }]);
    b.cogs = r3(now); Store.put('boms', b);
    hit.push(b.article + ' v' + b.version);
  });
  return hit;
}
// the COGS of a BOM, always from its own lines
const bomCogsOf = b => r3((b && b.lines || []).reduce((s, l) => s + num(l.qty) * num(l.price || matPrice(l.material)), 0));
// items on a BOM with no approved price yet — their cost is missing from the COGS
const bomNoPrice = b => Array.from(new Set((b && b.lines || []).filter(l => !(num(l.price) > 0) && !(matPrice(l.material) > 0)).map(l => l.material)));
// New = the item had no price yet; Update = it had one
const prType = x => num(x.old_price) ? '<span class="pend-txt">Update</span>' : '<span class="ok-txt">New</span>';
const PRICE_UI = { st: 'Pending' };
VIEWS.priceapproval = {
  mod: 'purchase', render() {
    const sa = isSuperAdmin();
    const list = prAll().filter(x => !PRICE_UI.st || x.status === PRICE_UI.st).sort((a, b) => a.at < b.at ? 1 : -1);
    const pend = prAll().filter(x => x.status === 'Pending');
    setMain('<div class="toolbar">' + seg('prst', [{ v: 'Pending', l: 'Pending (' + pend.length + ')' }, { v: 'Approved', l: 'Approved' }, { v: 'Rejected', l: 'Rejected' }, { v: '', l: 'All' }], PRICE_UI.st) + '<span class="grow"></span>' +
      (sa && pend.length && PRICE_UI.st === 'Pending' ? '<button class="btn primary" data-act="pr-sel" disabled>Approve selected (0)</button><button class="btn" data-act="pr-sel-no" disabled>Reject selected</button><button class="btn" data-act="pr-all" data-confirm="Approve all ' + pend.length + '?">Approve all (' + pend.length + ')</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr>' + (sa && PRICE_UI.st === 'Pending' ? '<th style="width:28px"><input type="checkbox" id="prAllCk" title="Select all"></th>' : '') + '<th>No</th><th>Date &amp; Time</th><th>Photo</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Current ₹</th><th class="num">New ₹</th><th class="num">Change</th><th>Type</th><th>Asked by</th><th>Status</th><th>Approved by</th><th></th></tr>' +
      list.map(x => { const m = matBy(x.material) || {}; const pct = num(x.old_price) ? (num(x.new_price) - num(x.old_price)) / num(x.old_price) * 100 : null;
        return '<tr>' + (sa && PRICE_UI.st === 'Pending' ? '<td>' + (x.status === 'Pending' ? '<input type="checkbox" data-prck="' + esc(x.id) + '">' : '') + '</td>' : '') + '<td class="nowrap">' + esc(x.no) + '</td><td class="nowrap">' + fmtDT(x.at) + '</td><td>' + photoThumb(m.photo) + '</td><td><b>' + esc(x.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(x.uom || m.uom || '') + '</td>' +
          '<td class="num">' + (num(x.old_price) ? money(x.old_price) : '—') + '</td><td class="num"><b>' + money(x.new_price) + '</b></td><td class="num">' + (pct == null ? 'New' : '<span class="' + (pct > 0 ? 'late-txt' : 'ok-txt') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</td>' +
          '<td>' + prType(x) + '</td><td>' + esc(x.by) + '</td>' +
          '<td>' + (x.status === 'Approved' ? '<span class="ok-txt">Approved</span>' : x.status === 'Rejected' ? '<span class="late-txt">Rejected</span>' : '<span class="pend-txt">Pending</span>') + '</td><td>' + esc(x.approved_by || '') + ((x.boms || []).length ? '<div class="small ok-txt">COGS: ' + esc(x.boms.join(', ')) + '</div>' : '') + (x.approved_at ? '<div class="small muted">' + fmtDT(x.approved_at) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + (sa && x.status === 'Pending' ? '<button class="btn sm primary" data-act="pr-ok" data-id="' + esc(x.id) + '">Approve</button><button class="btn sm" data-act="pr-no" data-id="' + esc(x.id) + '" data-confirm="Reject ' + esc(x.no) + '?">Reject</button>' : '') + '</td></tr>'; }).join('') + '</table></div>');
    onSeg(e => { if (e.target.dataset.seg === 'prst') { PRICE_UI.st = e.detail; VIEWS.priceapproval.render(); } });
  }
};
// tick the prices to approve together, on the Price Approval screen or the Home approvals card; the buttons show how many are ticked
function prSelSync() { const n = $$('[data-prck]:checked').length; $$('[data-act="pr-sel"]').forEach(b => { b.disabled = !n; b.textContent = 'Approve selected (' + n + ')'; }); $$('[data-act="pr-sel-no"]').forEach(b => { b.disabled = !n; }); }
document.addEventListener('change', e => { if (e.target.id === 'prAllCk') { $$('[data-prck]').forEach(c => { c.checked = e.target.checked; }); prSelSync(); } else if (e.target.dataset && e.target.dataset.prck !== undefined) prSelSync(); });
const prSelected = () => $$('[data-prck]:checked').map(c => Store.get('price_requests', c.dataset.prck)).filter(x => x && x.status === 'Pending');
ACTIONS['pr-sel'] = () => { const p = prSelected(); if (!p.length) return; p.forEach(x => prDecide(x, true)); const nb = new Set(p.flatMap(x => x.boms || [])); flash(p.length + ' price(s) approved' + (nb.size ? ' · COGS updated on ' + nb.size + ' BOM(s)' : '') + '.'); route(); };
ACTIONS['pr-sel-no'] = () => { const p = prSelected(); if (!p.length) return; reasonDialog('Reject ' + p.length + ' price request(s)', 'Reject', why => { p.forEach(x => { x.reject_reason = why; prDecide(x, false); }); flash(p.length + ' price(s) rejected.'); route(); return ''; }, true); };
ACTIONS['pr-ok'] = el => { const x = Store.get('price_requests', el.dataset.id); prDecide(x, true); flash('Price approved — new POs use it' + ((x.boms || []).length ? ' · COGS updated on ' + x.boms.length + ' BOM(s): ' + esc(x.boms.slice(0, 4).join(', ')) + (x.boms.length > 4 ? '…' : '') : '') + '.'); route(); };
ACTIONS['pr-no'] = el => { prDecide(Store.get('price_requests', el.dataset.id), false); route(); };
ACTIONS['pr-all'] = () => { const p = prAll().filter(x => x.status === 'Pending'); p.forEach(x => prDecide(x, true)); const nb = new Set(p.flatMap(x => x.boms || [])); flash(p.length + ' price(s) approved' + (nb.size ? ' · COGS updated on ' + nb.size + ' BOM(s)' : '') + '.'); route(); };
ACTIONS['pr-ask'] = el => prDialog([el.dataset.c], 'Stock View', '', 'Price update');
// PO price revision is retired: a price changes only through the price approval above
ACTIONS['po-revise'] = () => flash('Price changes only from Stock View → Price (the Super Admin approves).', 'err');
