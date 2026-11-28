/* Nexus 2.0 — Order drafts. A punch form can be kept aside as a draft and picked up later; saving the order
   removes the draft it came from. Each person sees their own drafts; the Super Admin sees all. */
'use strict';

const draftsMine = () => Store.all('order_drafts').filter(d => isSuperAdmin() || d.by_id === ME.id || norm(d.by) === norm(ME.name)).sort((a, b) => a.at < b.at ? 1 : -1);
// the form as it stands, with nothing that belongs to a saved order
function draftFormOf(P) {
  const f = clone(P); f.id = null; f.no = ''; delete f.actuals; delete f.done_by; delete f.process_id; delete f.created_at; delete f.created_by;
  (f.lines || []).forEach(l => { delete l.jc_no; });
  f.lines = (f.lines || []).filter(l => l.article || (l.sizes || []).some(x => num(x.qty) > 0));
  return f;
}
ACTIONS['punch-draft'] = () => {
  if (!requirePerm('orders', 'edit')) return;
  punchCollect(); const P = PUNCH; if (!P || P.id) { flash('Only a new order can be kept as a draft.', 'err'); return; }
  const f = draftFormOf(P);
  if (!f.brand && !f.lines.length) { flash('Nothing to keep — fill the brand or an article first.', 'err'); return; }
  const d = Store.put('order_drafts', { id: P.draft_id || uid(), no: P.draft_no || nextNo('order_drafts', 'DRF'), at: nowIso(), by: ME.name, by_id: ME.id, brand: f.brand, buyer_po: f.buyer_po, lines_n: f.lines.length, qty: f.lines.reduce((s, l) => s + (l.sizes || []).reduce((a, x) => a + num(x.qty), 0), 0), form: f });
  audit('order.draft', d.no, (f.brand || '') + ' · PO ' + (f.buyer_po || '') + ' · ' + f.lines.length + ' line(s)');
  newPunch(); flash(esc(d.no) + ' kept as a draft — it is in the Drafts list below.'); VIEWS.punch.render();
};
ACTIONS['draft-load'] = el => {
  const d = Store.get('order_drafts', el.dataset.id); if (!d) return;
  newPunch(Object.assign({}, d.form, { id: null })); PUNCH.id = null; PUNCH.draft_id = d.id; PUNCH.draft_no = d.no;
  if (!PUNCH.lines.length || PUNCH.lines[PUNCH.lines.length - 1].article) PUNCH.lines.push(blankLine());
  VIEWS.punch.render(); window.scrollTo(0, 0); flash('Draft ' + esc(d.no) + ' loaded — check it and Save order.');
};
ACTIONS['draft-del'] = el => {
  const d = Store.get('order_drafts', el.dataset.id); if (!d) return;
  if (!(isSuperAdmin() || d.by_id === ME.id || norm(d.by) === norm(ME.name))) return;
  Store.del('order_drafts', d.id); audit('order.draft_delete', d.no, (d.brand || '') + ' · PO ' + (d.buyer_po || '')); VIEWS.punch.render();
};
// after an order is saved from a draft, the draft goes
function draftConsumed(P) { if (P && P.draft_id && Store.get('order_drafts', P.draft_id)) { Store.del('order_drafts', P.draft_id); } }
function draftsHtml() {
  const L = draftsMine(); if (!L.length) return '';
  return '<div class="card" style="margin-top:14px"><div class="card-b"><div class="dh3" style="padding:0 0 6px">Drafts<span class="n">' + L.length + '</span></div><div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Draft</th><th>Kept on</th><th>By</th><th>Brand</th><th>Buyer PO</th><th class="num">Lines</th><th class="num">Qty</th><th></th></tr>' +
    L.map(d => '<tr><td><b>' + esc(d.no) + '</b></td><td class="nowrap">' + fmtDT(d.at) + '</td><td>' + esc(d.by) + '</td><td>' + esc(d.brand || '') + '</td><td>' + esc(d.buyer_po || '') + '</td><td class="num">' + (d.lines_n || 0) + '</td><td class="num">' + qtyFmt(d.qty || 0) + '</td><td class="nowrap"><button class="btn sm primary" data-act="draft-load" data-id="' + esc(d.id) + '">Load</button> <button class="btn sm danger" data-act="draft-del" data-id="' + esc(d.id) + '" data-confirm="Delete draft ' + esc(d.no) + '?">Delete</button></td></tr>').join('') + '</table></div></div></div>';
}
