/* Nexus 2.0 — Stock adjustment. The stock figure is never typed over: it moves only through an adjustment
   entry with a reason, approved by the Store head (anyone with issue-approval rights). A pending entry is
   already held back from free stock, so a correction reaches the job cards the moment it is raised.
   After four hours a pending entry also shows up with the Super Admin. */
'use strict';

const SADJ_UI = { form: false, f: 'pending' };
const SADJ_TAT_H = 4;

const sadjAll = () => Store.all('stock_adj');
const sadjPendingList = () => sadjAll().filter(a => a.status === 'Pending');
// pending reductions are held back from free stock straight away
function adjPending(code) { return sadjPendingList().filter(a => norm(a.material) === norm(code) && num(a.qty) < 0).reduce((s, a) => s - num(a.qty), 0); }
const sadjAgeH = a => (Date.now() - new Date(a.at).getTime()) / 36e5;
const sadjCanApprove = () => typeof canApproveIssue === 'function' ? canApproveIssue() : isAdminRole();

// raise one: qty is + or −; src says where it came from (manual / issue), ref is the slip or job card
function stockAdjNew(material, qty, reason, src, ref) {
  const m = matBy(material); if (!m || !(Math.abs(num(qty)) > 0)) return null;
  const a = Store.put('stock_adj', { id: uid(), no: nextNo('stock_adj', 'ADJ'), at: nowIso(), date: todayYmd(), material: m.code, qty: r3(num(qty)), uom: m.uom || '',
    reason: String(reason || '').trim(), src: src || 'manual', ref: ref || '', status: 'Pending', by: ME.name });
  if (typeof autoTask === 'function') { try { autoTask('Approve stock adjustment ' + a.no + ' — ' + m.name + ' ' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + ' ' + a.uom, autoDoer('stock_adj', 'STORE'), 0, { kind: 'stock_adj', adj_id: a.id, party: a.ref, ref: a.no }, 'Stock'); } catch (e) { console.error(e); } }
  audit('stock_adj.create', a.no, m.code + ' ' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + ' · ' + a.reason + (a.ref ? ' · ' + a.ref : ''));
  return a;
}
function sadjTaskClose(a, how) {
  Store.all('checklist').filter(t => t.kind === 'stock_adj' && t.adj_id === a.id && !(t.done && t.done.once)).forEach(t => {
    t.done = t.done || {}; t.done.once = { at: nowIso(), by: 'System', remark: 'Adjustment ' + how, photos: 0, files: 0, log: '' }; t.done_at = nowIso(); Store.put('checklist', t);
  });
}
function sadjDecide(id, ok, why) {
  const a = Store.get('stock_adj', id); if (!a || a.status !== 'Pending' || !sadjCanApprove()) return;
  if (a.by === ME.name && !isSuperAdmin()) { flash('You raised this adjustment — someone else must approve it.', 'err'); return; }
  a.status = ok ? 'Approved' : 'Rejected'; a.decided_by = ME.name; a.decided_at = nowIso(); if (!ok) a.reject_reason = why || '';
  Store.put('stock_adj', a); sadjTaskClose(a, ok ? 'approved' : 'rejected');
  audit(ok ? 'stock_adj.approve' : 'stock_adj.reject', a.no, a.material + ' ' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + (why ? ' · ' + why : ''));
  flash(esc(a.no) + (ok ? ' approved — stock updated.' : ' rejected.'));
}

const sadjChip = a => a.status === 'Pending' ? '<span class="st ' + (sadjAgeH(a) > SADJ_TAT_H ? 'Late' : 'Pending') + '">Pending' + (sadjAgeH(a) > SADJ_TAT_H ? ' · ' + Math.floor(sadjAgeH(a)) + ' h' : '') + '</span>' : '<span class="st ' + (a.status === 'Approved' ? 'Done' : 'Cancelled') + '">' + esc(a.status) + '</span>';
function sadjTable(list, withAct) {
  return '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Item Code</th><th>Item Name</th><th class="num">Qty</th><th>UOM</th><th>Reason</th><th>From</th><th>Raised by</th><th>Status</th><th>Decided by</th>' + (withAct ? '<th></th>' : '') + '</tr>' +
    (list.length ? list.map(a => { const m = matBy(a.material) || {};
      return '<tr><td><b>' + esc(a.no) + '</b></td><td class="nowrap">' + fmtDT(a.at) + '</td><td>' + esc(a.material) + '</td><td>' + esc(m.name || '') + '</td><td class="num ' + (a.qty < 0 ? 'late-txt' : 'done-txt') + '"><b>' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + '</b></td><td>' + esc(a.uom || '') + '</td><td>' + esc(a.reason || '') + '</td><td>' + esc(a.src === 'issue' ? 'Issue · ' + (a.ref || '') : a.src === 'kit' ? 'Kit · ' + (a.ref || '') : 'Manual') + '</td><td>' + esc(a.by || '') + '</td><td>' + sadjChip(a) + (a.reject_reason ? '<div class="small muted">' + esc(a.reject_reason) + '</div>' : '') + '</td><td>' + esc(a.decided_by || '') + '</td>' +
        (withAct ? '<td class="nowrap">' + (a.status === 'Pending' && sadjCanApprove() ? '<button class="btn sm primary" data-act="sadj-ok" data-id="' + esc(a.id) + '">Approve</button> <button class="btn sm danger" data-act="sadj-no" data-id="' + esc(a.id) + '">Reject</button>' : '') + '</td>' : '') + '</tr>'; }).join('')
      : '<tr><td colspan="' + (withAct ? 12 : 11) + '" class="empty">No adjustments</td></tr>') + '</table></div>';
}
VIEWS.stockadj = {
  mod: 'store', render() {
    const edit = can('store', 'edit');
    const list = sadjAll().filter(a => SADJ_UI.f === 'all' || (SADJ_UI.f === 'pending' ? a.status === 'Pending' : a.status !== 'Pending')).sort((a, b) => a.at < b.at ? 1 : -1);
    let h = '<div class="toolbar">' + seg('sadjf', [{ v: 'pending', l: 'Pending' }, { v: 'done', l: 'Decided' }, { v: 'all', l: 'All' }], SADJ_UI.f) + '<span class="grow"></span>' +
      (edit ? '<button class="btn ' + (SADJ_UI.form ? '' : 'primary') + '" data-act="sadj-new">' + (SADJ_UI.form ? 'Close' : '+ Adjustment') + '</button>' : '') + '</div>';
    if (SADJ_UI.form && edit) {
      const items = Store.all('materials').map(m => [m.code, m.name || m.code]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      h += '<div class="card"><div class="card-b"><div class="inwform">' + kvTable([
        ['Item *', '<select id="sadjItem"><option value="">Select the item…</option>' + items.map(([c, n]) => '<option value="' + esc(c) + '">' + esc(n) + '</option>').join('') + '</select>'],
        ['Stock now', '<span id="sadjNow" class="muted">—</span>'],
        ['Change *', '<input id="sadjQty" type="number" step="any" placeholder="− to reduce, + to add" style="max-width:200px">'],
        ['Reason *', '<input id="sadjWhy" placeholder="What was found, and where">']
      ]) + '<div></div></div></div><div class="card-f"><button class="btn primary" data-act="sadj-save">Raise for approval</button><span id="sadjMsg" class="small"></span></div></div>';
    }
    h += sadjTable(list, true);
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'sadjf') { SADJ_UI.f = e.detail; VIEWS.stockadj.render(); } });
    m.addEventListener('change', e => { if (e.target.id === 'sadjItem') { const c = e.target.value; const mm = matBy(c); $('#sadjNow').textContent = c ? qtyFmt(stockOf(c)) + ' ' + ((mm || {}).uom || '') + (adjPending(c) ? ' · ' + qtyFmt(adjPending(c)) + ' already pending' : '') : '—'; } });
  }
};
ACTIONS['sadj-new'] = () => { SADJ_UI.form = !SADJ_UI.form; VIEWS.stockadj.render(); };
ACTIONS['sadj-save'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const code = $('#sadjItem').value, q = num($('#sadjQty').value), why = $('#sadjWhy').value.trim();
  const bad = t => { $('#sadjMsg').innerHTML = '<span class="late-txt">' + t + '</span>'; };
  if (!code) return bad('Select the item.'); if (!(Math.abs(q) > 0)) return bad('Type the change — minus to reduce, plus to add.'); if (!why) return bad('The reason is required.');
  if (q < 0 && stockOf(code) - adjPending(code) + q < -1e-9) return bad('That would take the stock below zero (now ' + qtyFmt(stockOf(code)) + (adjPending(code) ? ', ' + qtyFmt(adjPending(code)) + ' already pending' : '') + ').');
  const a = stockAdjNew(code, q, why, 'manual', '');
  SADJ_UI.form = false; flash(esc(a.no) + ' raised — waiting for the Store head\'s approval.'); VIEWS.stockadj.render();
};
ACTIONS['sadj-ok'] = el => { sadjDecide(el.dataset.id, true); (curView().v === 'home' ? VIEWS.home : VIEWS.stockadj).render(); };
ACTIONS['sadj-no'] = el => { const a = Store.get('stock_adj', el.dataset.id); if (!a) return; reasonDialog('Reject ' + a.no, 'Reject', why => { sadjDecide(el.dataset.id, false, why); (curView().v === 'home' ? VIEWS.home : VIEWS.stockadj).render(); }, true); };

// Super Admin Home › Approvals: pending adjustments, the ones past four hours on top
function sadjHomeCard() {
  const L = sadjPendingList().sort((a, b) => a.at < b.at ? -1 : 1); if (!L.length) return '';
  return '<div class="dcard" id="sadjCard"><div class="dh3">Stock adjustments waiting<span class="n' + (L.some(a => sadjAgeH(a) > SADJ_TAT_H) ? ' red' : '') + '">' + L.length + '</span><span class="grow"></span><a class="small" href="#/stockadj">All</a></div>' +
    L.slice(0, 8).map(a => { const m = matBy(a.material) || {}; return '<div class="dl"><div><div class="t">' + esc(m.name || a.material) + ' <span class="' + (a.qty < 0 ? 'late-txt' : 'done-txt') + '">' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + ' ' + esc(a.uom || '') + '</span></div><div class="m">' + esc(a.no) + ' · ' + esc(a.reason) + ' · ' + esc(a.by) + ' · ' + fmtDT(a.at) + (sadjAgeH(a) > SADJ_TAT_H ? ' · <span class="late-txt">' + Math.floor(sadjAgeH(a)) + ' h, with you now</span>' : '') + '</div></div>' +
      '<div class="dl-btns">' + (sadjCanApprove() ? '<button class="btn sm primary" data-act="sadj-ok" data-id="' + esc(a.id) + '">Approve</button><button class="btn sm danger" data-act="sadj-no" data-id="' + esc(a.id) + '">Reject</button>' : '') + '</div></div>'; }).join('') + '</div>';
}
