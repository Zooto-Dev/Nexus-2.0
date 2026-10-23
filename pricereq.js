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
  }
  x.status = ok ? 'Approved' : 'Rejected'; x.approved_by = ME.name; x.approved_at = nowIso(); Store.put('price_requests', x);
  audit('price.' + (ok ? 'approve' : 'reject'), x.no, x.material + ' ₹' + money(x.old_price) + ' → ₹' + money(x.new_price));
}
const PRICE_UI = { st: 'Pending' };
VIEWS.priceapproval = {
  mod: 'purchase', render() {
    const sa = isSuperAdmin();
    const list = prAll().filter(x => !PRICE_UI.st || x.status === PRICE_UI.st).sort((a, b) => a.at < b.at ? 1 : -1);
    const pend = prAll().filter(x => x.status === 'Pending');
    setMain('<div class="toolbar">' + seg('prst', [{ v: 'Pending', l: 'Pending (' + pend.length + ')' }, { v: 'Approved', l: 'Approved' }, { v: 'Rejected', l: 'Rejected' }, { v: '', l: 'All' }], PRICE_UI.st) + '<span class="grow"></span>' +
      (sa && pend.length && PRICE_UI.st === 'Pending' ? '<button class="btn primary" data-act="pr-all" data-confirm="Approve all ' + pend.length + '?">Approve all (' + pend.length + ')</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>No</th><th>Date &amp; Time</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Current ₹</th><th class="num">New ₹</th><th class="num">Change</th><th>From</th><th>Asked by</th><th>Status</th><th>Approved by</th><th></th></tr>' +
      list.map(x => { const m = matBy(x.material) || {}; const pct = num(x.old_price) ? (num(x.new_price) - num(x.old_price)) / num(x.old_price) * 100 : null;
        return '<tr><td class="nowrap">' + esc(x.no) + '</td><td class="nowrap">' + fmtDT(x.at) + '</td><td><b>' + esc(x.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(x.uom || m.uom || '') + '</td>' +
          '<td class="num">' + (num(x.old_price) ? money(x.old_price) : '—') + '</td><td class="num"><b>' + money(x.new_price) + '</b></td><td class="num">' + (pct == null ? 'New' : '<span class="' + (pct > 0 ? 'late-txt' : 'ok-txt') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</td>' +
          '<td>' + esc(x.source) + (x.ref ? '<div class="small muted">' + esc(x.ref) + '</div>' : '') + '</td><td>' + esc(x.by) + '</td>' +
          '<td>' + (x.status === 'Approved' ? '<span class="ok-txt">Approved</span>' : x.status === 'Rejected' ? '<span class="late-txt">Rejected</span>' : '<span class="pend-txt">Pending</span>') + '</td><td>' + esc(x.approved_by || '') + (x.approved_at ? '<div class="small muted">' + fmtDT(x.approved_at) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + (sa && x.status === 'Pending' ? '<button class="btn sm primary" data-act="pr-ok" data-id="' + esc(x.id) + '">Approve</button><button class="btn sm" data-act="pr-no" data-id="' + esc(x.id) + '" data-confirm="Reject ' + esc(x.no) + '?">Reject</button>' : '') + '</td></tr>'; }).join('') + '</table></div>');
    onSeg(e => { if (e.target.dataset.seg === 'prst') { PRICE_UI.st = e.detail; VIEWS.priceapproval.render(); } });
  }
};
ACTIONS['pr-ok'] = el => { prDecide(Store.get('price_requests', el.dataset.id), true); flash('Price approved — new POs use it.'); route(); };
ACTIONS['pr-no'] = el => { prDecide(Store.get('price_requests', el.dataset.id), false); route(); };
ACTIONS['pr-all'] = () => { const p = prAll().filter(x => x.status === 'Pending'); p.forEach(x => prDecide(x, true)); flash(p.length + ' price(s) approved.'); route(); };
ACTIONS['pr-ask'] = el => prDialog([el.dataset.c], 'Stock View', '', 'Price update');
// PO price revision is retired: a price changes only through the price approval above
ACTIONS['po-revise'] = () => flash('Price changes only from Stock View → Price (the Super Admin approves).', 'err');
