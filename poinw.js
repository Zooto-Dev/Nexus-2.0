/* Nexus 2.0 — Material inwarding task: every PO raises one task on the person who raised it,
   planned for the PO's expected delivery date. The task shows which items of that PO are still pending,
   closes itself when everything is received, and goes away if the PO is cancelled. */
'use strict';

const poInwTaskOf = no => Store.all('checklist').find(x => x.src === 'po_inw' && norm(x.ref) === norm(no));
const poInwOf = t => t && t.src === 'po_inw' && t.ref ? Store.all('purchase_orders').find(p => norm(p.no) === norm(t.ref)) : null;
const poInwPending = p => (p.lines || []).map((l, k) => ({ l, k, pen: poLinePending(p, l, k) })).filter(x => x.pen > 0);
// the doer is the person who raised the PO
function poInwDoer(p) {
  const u = Store.all('users').find(x => x.doer && norm(x.name) === norm(p.created_by));
  if (u) return u.doer;
  return norm(p.created_by) === norm(ME.name) ? (ME.doer || '') : '';
}
// make / update / close the task of one PO
function poInwSync(p) {
  if (!p || typeof eaDelegate !== 'function') return;
  const t = poInwTaskOf(p.no); const done = t ? clDoneOf(t, t.start) : null;
  if (p.cancelled) {   // a cancelled PO takes its task with it
    if (t && !done) { Store.del('checklist', t.id); audit('po.inw_task', p.no, 'task removed — PO cancelled'); renderNav(); }
    return;
  }
  const pend = poPending(p);
  if (t) {
    if (done) return;
    if (pend <= 1e-9) {   // everything received: the task closes itself
      t.done = t.done || {}; t.done[clDoneKey(t, t.start)] = { at: nowIso(), by: 'System', remark: 'All material received', photos: 0, files: 0, log: '' };
      t.done_at = nowIso(); clPin(t); Store.put('checklist', t);
      audit('po.inw_task', p.no, 'closed — all material received'); renderNav();
    } else if (p.expected && t.start !== p.expected) {   // the expected date moved
      t.start = p.expected; t.due = p.expected; clPin(t); Store.put('checklist', t);
    }
    return;
  }
  if (pend <= 1e-9 || !p.expected) return;
  const doer = poInwDoer(p); if (!doer) return;
  const nt = eaDelegate('Material inwarding for PO ' + p.no + ' (' + p.vendor + ')', doer, p.expected, 'po_inw', p.no, { remark: true });
  nt.po_no = p.no; nt.party = p.vendor; Store.put('checklist', nt);
  renderNav();
}
// run it for every PO that has a task, plus this one (used after a GRN)
function poInwSyncAll() { Store.all('purchase_orders').forEach(p => { if (poInwTaskOf(p.no)) poInwSync(p); }); }

/* ---------- what is still pending on that PO, from the task itself ---------- */
function taskExtraHtml(taskId) {
  const t = taskId && Store.get('checklist', taskId); const p = poInwOf(t); if (!p) return '';
  const pend = poInwPending(p);
  return '<div class="small"><a data-act="po-inw-view" data-no="' + esc(p.no) + '">' + (pend.length ? pend.length + ' item(s) pending' : 'Nothing pending') + ' · see PO</a></div>';
}
ACTIONS['po-inw-view'] = el => {
  const p = Store.all('purchase_orders').find(x => norm(x.no) === norm(el.dataset.no)); if (!p) { flash('PO not found.', 'err'); return; }
  const gate = typeof pendingInwardOf === 'function' ? pendingInwardOf(p.no) : null;
  const rows = (p.lines || []).map((l, k) => ({ l, k, rec: recvOf(p, l, k), pen: poLinePending(p, l, k) }));
  const old = $('#piDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'piDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg hx-dlg"><div class="dlg-h">' + esc(p.no) + ' · ' + esc(p.vendor) + '</div>' +
    '<table class="kv"><tr><td class="muted" style="width:150px">Expected delivery</td><td><b>' + fmtD(p.expected) + '</b></td></tr>' +
    '<tr><td class="muted">PO status</td><td>' + esc(poStatus(p)) + ' · raised by ' + esc(p.created_by || '') + '</td></tr>' +
    (gate ? '<tr><td class="muted">Gate entry</td><td><b>' + esc(gate.no) + '</b> · ' + esc(gate.bill_no || '') + ' waiting for GRN</td></tr>' : '') + '</table>' +
    '<div class="tbl-wrap hx-wrap"><table class="nopage nofilter"><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">PO Qty</th><th class="num">Received</th><th class="num">Pending</th><th>Status</th></tr>' +
    (rows.length ? rows.map(x => '<tr' + (x.pen > 0 ? '' : ' class="muted"') + '><td><b>' + esc(x.l.material) + '</b></td><td>' + esc((matBy(x.l.material) || {}).name || '') + '</td><td>' + esc(x.l.uom || '') + '</td><td class="num">' + qtyFmt(x.l.qty) + '</td><td class="num">' + qtyFmt(x.rec) + '</td><td class="num"><b>' + qtyFmt(x.pen) + '</b></td>' +
      '<td>' + (x.l.closed ? '<span class="st Cancelled">Short closed</span>' : x.pen > 0 ? '<span class="st ' + (p.expected && p.expected < todayYmd() ? 'Late' : 'Pending') + '">' + (p.expected && p.expected < todayYmd() ? 'Overdue' : 'Awaited') + '</span>' : '<span class="st Done">Received</span>') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">No items</td></tr>') + '</table></div>' +
    '<div class="dlg-f"><span class="small muted">Pending total ' + qtyFmt(poPending(p)) + '</span><span class="grow"></span><a class="btn" href="#/po">Open Purchase Orders</a><button class="btn primary" data-pi-x>Close</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click', ev => { if (ev.target.closest('[data-pi-x]') || ev.target === d || ev.target.closest('a[href]')) d.remove(); });
};
