/* Nexus 2.0 — Production Planning + DPR (Daily Production Report).
   Planning: pick a Job Card → order details fill themselves → enter the Planned Dispatch Date → Submit.
   When every job card of an order is planned, the O2D step that asks the Planned Dispatch Date closes itself
   with the latest of those dates. A plan can be revised with a reason; every change is logged.
   DPR: one line per planned job card — where it is in O2D, has its material arrived / been issued,
   production by stage, dispatch, and an overall status. Click a line for the complete tracking. */
'use strict';

const PL_UI = { form: false, jc: '', date: '', rem: '', open: null, f: 'open', edit: null };
const planOf = no => Store.all('prod_plans').find(p => norm(p.jc_no) === norm(no) && !p.cancelled);
function planOrderOf(j) { return Store.all('orders').find(o => norm(o.no) === norm(j.order_no)) || (Store.all('orders').find(o => (o.lines || []).some(l => norm(l.jc_no) === norm(j.no)))) || null; }
function planInfo(j) {
  const o = planOrderOf(j) || {};
  const c = Store.all('customers').find(x => norm(x.name) === norm(j.brand || o.customer_name)) || {};
  return { order_no: o.no || j.order_no || '', order_date: o.order_date || '', merchant: c.merchandiser || '', customer: j.brand || o.customer_name || '', category: j.category || o.category || '', article: j.article || '', colour: j.colour || '', qty: (j.sizes || []).reduce((a, z) => a + num(z.act), 0) || num(j.qty) };
}
const planJcs = () => Store.all('job_cards').filter(j => j.status !== 'Closed' && !planOf(j.no)).sort((a, b) => String(a.no).localeCompare(String(b.no)));

// O2D: when all job cards of the order are planned, close "Planned Dispatch Date" with the latest planned date
function planSyncO2D(j) {
  const o = planOrderOf(j); if (!o) return '';
  const r = resolveOrder(o); if (!r) return '';
  const def = r.spec.steps.find(s => s.capture && s.capture.field === 'planned_dispatch_date'); if (!def) return '';
  const jcNos = (o.lines || []).map(l => l.jc_no).filter(Boolean);
  const plans = jcNos.map(planOf);
  if (!jcNos.length || plans.some(p => !p)) return 'waiting';
  const date = plans.map(p => p.dispatch_date).sort().pop();
  const s = r.steps[def.id]; o.extra = o.extra || {};
  if (s && (s.status === 'Pending' || s.status === 'Late')) {
    o.extra.planned_dispatch_date = date; o.actuals = o.actuals || {}; o.actuals[def.id] = nowIso();
    o.done_by = o.done_by || {}; o.done_by[def.id] = ME.name; o.notes = o.notes || {}; o.notes[def.id] = 'From Production Planning';
    fmsPut(o); audit('step.done', o.no, def.name + ' = ' + fmtD(date) + ' (from Production Planning)'); return 'closed';
  }
  if (s && s.actual && o.extra.planned_dispatch_date !== date) {
    const old = o.extra.planned_dispatch_date; o.extra.planned_dispatch_date = date; fmsPut(o);
    audit('order.planned_dispatch', o.no, (old ? fmtD(old) : '—') + ' → ' + fmtD(date) + ' (plan revised)'); return 'updated';
  }
  return '';
}

/* ---------- one job card's complete status ---------- */
function planStatus(p) {
  const j = jcBy(p.jc_no); const o = j ? planOrderOf(j) : null;
  const qty = num(p.qty);
  // O2D position
  const st = o ? orderState(o) : null;
  const r = o ? resolveOrder(o) : null;
  // material
  const L = (j && j.lines) || [];
  let req = 0, iss = 0; const items = [];
  L.forEach(l => {
    const rq = num(l.required), is = Math.max(0, issuedToJc(j.no, l.material)); const bal = Math.max(0, rq - is);
    const stock = Math.max(0, stockOf(l.material)); const transit = transitOf(l.material);
    const pos = openPOs().filter(x => x.lines.some((y, k) => norm(y.material) === norm(l.material) && poLinePending(x, y, k) > 0)).sort((a, b) => (a.expected || '9') < (b.expected || '9') ? -1 : 1);
    req += rq; iss += Math.min(rq, is);
    items.push({ l, m: matBy(l.material) || {}, rq, is, bal, stock, transit, po: pos[0] || null, state: bal <= 1e-9 ? 'Issued' : stock + 1e-9 >= bal ? 'In stock' : transit > 0 ? 'PO raised' : 'No PO' });
  });
  const open = items.filter(x => x.bal > 1e-9);
  const noPo = open.filter(x => x.state === 'No PO').length, awaited = open.filter(x => x.state === 'PO raised').length;
  const matArr = !L.length ? 'No BOM' : !open.length ? 'Issued' : (noPo || awaited) ? 'Awaited' : 'Arrived';
  const issPct = req ? Math.round(iss / req * 100) : 0;
  // production by stage
  const reps = Store.all('prod_reports').filter(x => norm(x.jc_no) === norm(p.jc_no));
  const stages = optList('prod_stage');
  const prod = stages.map(sname => ({ stage: sname, done: reps.filter(x => x.stage === sname).reduce((a, x) => a + num(x.total || (x.sizes || []).reduce((b, z) => b + num(z.qty), 0)), 0) }));
  // dispatch of this job card's order line
  let disp = 0;
  if (o) { const idx = (o.lines || []).findIndex(l => norm(l.jc_no) === norm(p.jc_no)); if (idx >= 0) disp = dispatchedQty(o).per[idx] || 0; }
  // overall
  const today = todayYmd(); const days = Math.round((new Date(p.dispatch_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5);
  const last = prod.length ? prod[prod.length - 1].done : 0;
  let overall = 'On Track';
  if (disp >= qty && qty > 0) overall = 'Dispatched';
  else if (days < 0) overall = 'Late';
  else if ((days <= 3 && last < qty) || noPo || (days <= 7 && matArr === 'Awaited')) overall = 'At Risk';
  return { j, o, st, r, qty, items, noPo, awaited, matArr, issPct, req, iss, prod, disp, days, overall };
}

/* ---------- view ---------- */
VIEWS.planning = {
  mod: 'production', render() {
    const edit = can('production', 'edit'); const U = PL_UI;
    let h = '';
    if (edit && U.form) {
      const j = U.jc ? planJcs().find(x => norm(x.no) === norm(U.jc)) : null; const inf = j ? planInfo(j) : {};
      const ro = (l, v) => '<label>' + l + '<input value="' + esc(v || '') + '" readonly></label>';
      h += '<div class="card"><div class="card-h"><b>Production Plan</b></div><div class="card-b"><div class="row">' +
        '<label>Job Card *<input id="plJc" list="dlPlJc" autocomplete="off" value="' + esc(U.jc || '') + '"><datalist id="dlPlJc">' + planJcs().map(x => '<option value="' + esc(x.no) + '">' + esc((x.brand || '') + ' · ' + (x.article || '') + (x.colour ? ' · ' + x.colour : '')) + '</option>').join('') + '</datalist></label>' +
        ro('Order No', inf.order_no) + ro('Order Date', inf.order_date ? fmtD(inf.order_date) : '') + ro('Merchant', inf.merchant) + ro('Customer', inf.customer) + ro('Category', inf.category) + ro('Article', inf.article) + ro('Colour', inf.colour) + ro('Qty', j ? qtyFmt(inf.qty) : '') +
        '<label>Planned Dispatch Date *<input id="plDate" type="date" min="' + todayYmd() + '" value="' + esc(U.date || '') + '"' + (j ? '' : ' disabled') + '></label>' +
        '<label style="grid-column:span 2">Remark<input id="plRem" maxlength="200" value="' + esc(U.rem || '') + '"' + (j ? '' : ' disabled') + '></label></div></div>' +
        '<div class="card-f"><button class="btn primary" data-act="pl-save"' + (j ? '' : ' disabled') + '>Submit</button><button class="btn" data-act="pl-new">Close</button><span id="plMsg" class="small"></span></div></div>';
    }
    // DPR
    const plans = Store.all('prod_plans').filter(p => !p.cancelled && jcBy(p.jc_no));
    const rows = plans.map(p => ({ p, s: planStatus(p) }));
    const cnt = f => rows.filter(x => planFilter(x, f)).length;
    const shown = rows.filter(x => planFilter(x, U.f)).sort((a, b) => (a.p.dispatch_date || '') < (b.p.dispatch_date || '') ? -1 : 1);
    const tile = (label, value, sub, tone) => '<div class="dt' + (tone ? ' dt-' + tone : '') + '"><span class="dt-l">' + esc(label) + '</span><b class="dt-v">' + value + '</b><span class="dt-s">' + sub + '</span></div>';
    const open = rows.filter(x => x.s.overall !== 'Dispatched');
    h += '<div class="dtiles dt5" style="margin-bottom:14px">' +
      tile('Planned job cards', open.length, qtyFmt(open.reduce((a, x) => a + x.s.qty, 0)) + ' pairs to dispatch') +
      tile('Dispatch this week', open.filter(x => x.s.days >= 0 && x.s.days <= 7).length, 'next 7 days', '') +
      tile('Late', open.filter(x => x.s.overall === 'Late').length, 'past planned dispatch', open.some(x => x.s.overall === 'Late') ? 'crit' : 'good') +
      tile('At risk', open.filter(x => x.s.overall === 'At Risk').length, 'material / production behind', open.some(x => x.s.overall === 'At Risk') ? 'warn' : 'good') +
      tile('Material awaited', open.filter(x => x.s.matArr === 'Awaited').length, open.reduce((a, x) => a + x.s.noPo, 0) + ' item(s) with no PO', open.some(x => x.s.noPo) ? 'crit' : open.some(x => x.s.matArr === 'Awaited') ? 'warn' : 'good') + '</div>';
    h += '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open (' + cnt('open') + ')' }, { v: 'risk', l: 'Late / At risk (' + cnt('risk') + ')' }, { v: 'done', l: 'Dispatched' }, { v: 'all', l: 'All' }], U.f) + '<span class="grow"></span>' +
      '<button class="btn" data-act="pl-print">Print DPR</button>' + (edit ? '<button class="btn primary" data-act="pl-new">+ Production Plan</button>' : '') + '</div>';
    h += '<div class="tbl-wrap">' + dprTable(shown, true) + '</div>';
    const m = setMain(h);
    onSeg(e => { PL_UI.f = e.detail; VIEWS.planning.render(); });
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'plJc') { const ok = planJcs().find(x => norm(x.no) === norm(t.value)); U.jc = ok ? ok.no : ''; if (!ok && t.value.trim()) flash(esc(t.value) + ' is not an open job card without a plan — select one from the list.', 'err'); VIEWS.planning.render(); }
      if (t.id === 'plDate') U.date = t.value;
    });
    m.addEventListener('input', e => { if (e.target.id === 'plRem') U.rem = e.target.value; });
  }
};
function planFilter(x, f) {
  if (f === 'open') return x.s.overall !== 'Dispatched';
  if (f === 'risk') return x.s.overall === 'Late' || x.s.overall === 'At Risk';
  if (f === 'done') return x.s.overall === 'Dispatched';
  return true;
}
const OVR_CLS = { 'On Track': 'Done', 'At Risk': 'Pending', 'Late': 'Late', 'Dispatched': 'Done' };
const MAT_CLS = { Issued: 'Done', Arrived: 'Done', Awaited: 'Pending', 'No BOM': 'Late' };
function dprTable(list, interactive) {
  const stages = optList('prod_stage');
  const pa = (act, pl) => { const pct = pl ? Math.min(100, Math.round(act / pl * 100)) : 0; const cls = act <= 0 ? 'pa-0' : act >= pl ? 'pa-done' : 'pa-part'; return '<div class="pa ' + cls + '"><span class="pa-v"><b>' + qtyFmt(act) + '</b><i>/</i>' + qtyFmt(pl) + '</span><span class="pa-bar"><span style="width:' + pct + '%"></span></span></div>'; };
  const cols = 15 + stages.length;
  return '<table class="prgrid dpr"><tr><th>Job Card</th><th>Order No</th><th>Order Date</th><th>Merchant</th><th>Customer</th><th>Category</th><th>Article</th><th>Colour</th><th class="num">Qty</th><th>Planned Dispatch</th><th>O2D Stage</th><th>Material</th><th class="c">Issued<span class="pa-h">items fully issued</span></th>' + stages.map(s => '<th class="c">' + esc(s) + '<span class="pa-h">Actual / Plan</span></th>').join('') + '<th class="c">Dispatched</th><th>Status</th></tr>' +
    (list.length ? list.map(({ p, s }) => {
      const cur = s.st && s.st.cur;
      const dd = s.overall === 'Dispatched' ? '' : s.days < 0 ? '<span class="late-txt">' + (-s.days) + 'd late</span>' : s.days === 0 ? '<span class="warn-txt">today</span>' : '<span class="muted">' + s.days + 'd left</span>';
      let row = '<tr' + (interactive ? ' class="click' + '' + '" data-act="pl-toggle" data-id="' + esc(p.id) + '"' : '') + '><td><b>' + esc(p.jc_no) + '</b></td><td>' + esc(p.order_no || '') + '</td><td class="nowrap">' + fmtD(p.order_date) + '</td><td>' + esc(p.merchant || '') + '</td><td>' + esc(p.customer || '') + '</td><td>' + esc(p.category || '') + '</td><td>' + esc(p.article || '') + '</td><td>' + esc(p.colour || '') + '</td><td class="num">' + qtyFmt(s.qty) + '</td>' +
        '<td class="nowrap"><b>' + fmtD(p.dispatch_date) + '</b>' + ((p.history || []).length ? ' <span class="pr-cnt" title="Revised">R' + p.history.length + '</span>' : '') + '<div class="small">' + dd + '</div></td>' +
        '<td>' + (cur ? '<span class="st ' + (cur.status === 'Late' ? 'Late' : 'Pending') + '">' + esc(cur.name) + '</span>' : esc(s.st ? s.st.label : '—')) + '</td>' +
        '<td><span class="st ' + (MAT_CLS[s.matArr] || 'NA') + '">' + esc(s.matArr) + '</span>' + (s.matArr === 'Awaited' ? '<div class="small muted">' + s.awaited + ' on PO' + (s.noPo ? ' · <span class="late-txt">' + s.noPo + ' no PO</span>' : '') + '</div>' : '') + '</td>' +
        '<td>' + (s.items.length ? '<div class="pa ' + (s.issPct >= 100 ? 'pa-done' : s.issPct > 0 ? 'pa-part' : 'pa-0') + '"><span class="pa-v"><b>' + s.items.filter(x => x.bal <= 1e-9).length + '</b><i>/</i>' + s.items.length + ' items · ' + s.issPct + '%</span><span class="pa-bar"><span style="width:' + s.issPct + '%"></span></span></div>' : '<span class="muted">—</span>') + '</td>' + s.prod.map(x => '<td>' + pa(x.done, s.qty) + '</td>').join('') + '<td>' + pa(s.disp, s.qty) + '</td>' +
        '<td><span class="st ' + OVR_CLS[s.overall] + '">' + esc(s.overall) + '</span></td></tr>';
      return row;
    }).join('') : '<tr><td colspan="' + cols + '" class="empty">No plans yet</td></tr>') + '</table>';
}
// complete tracking of one job card in a full-screen panel that fits the screen (Summary format)
function plSteps(s) {
  if (!s.r) return [];
  const dept = n => { const u = Store.all('users').find(x => x.doer && norm(x.doer) === norm(n)); const d = (u && u.department) || (norm(n) === 'system' ? 'Dispatch' : 'Other'); return String(d).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); };
  return s.r.order.map(id => s.r.steps[id]).filter(st => st && st.applies).map((st, i) => Object.assign({}, st, { n: i + 1, dept: dept(st.doer || '') }));
}
const plStepTxt = st => st.status === 'Done' ? '✓ ' + fmtD(st.actual) + (st.delayMinutes > 0 ? ' · ' + fmtDelay(Math.round(st.delayMinutes)) + ' late' : '') : st.status === 'Late' ? fmtDelay(Math.round(st.delayMinutes)) + ' late' : st.planned ? 'due ' + fmtD(st.planned) : 'waiting';
const plStCls = st => st.status === 'Done' ? 'd' : st.status === 'Late' ? 'l' : st.status === 'Pending' ? 'p' : 'w';
const MST = { Issued: 'Done', 'In stock': 'Done', 'PO raised': 'Pending', 'No PO': 'Late' };
function plPlanTxt(p) {
  return '<div class="small">Dispatch <b>' + fmtD(p.dispatch_date) + '</b> · by ' + esc(p.by || '') + ' · ' + fmtDT(p.at) + (p.remark ? '<br>' + esc(p.remark) : '') + '</div>' +
    (p.history || []).slice().reverse().map(x => '<div class="plm-h"><b>' + fmtD(x.old) + ' → ' + fmtD(x.new) + '</b><span>' + esc(x.reason) + '</span><i>' + esc(x.by) + ' · ' + fmtDT(x.at) + '</i></div>').join('');
}
// Summary: progress ring, key numbers, step table (late and current first) + material + production
function plSummary(p, s) {
  const steps = plSteps(s); const done = steps.filter(x => x.status === 'Done').length; const pct = steps.length ? Math.round(done / steps.length * 100) : 0;
  const late = steps.filter(x => x.status === 'Late').length, aw = s.items.filter(x => x.bal > 1e-9 && x.state !== 'In stock').length;
  const pk = s.prod.length ? s.prod[s.prod.length - 1].done : 0;
  const rank = { l: 0, p: 1, d: 2, w: 3 };
  const order = steps.slice().sort((a, b) => (rank[plStCls(a)] - rank[plStCls(b)]) || a.n - b.n);
  const ring = '<svg width="110" height="110" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#e3e8f1" stroke-width="3.2"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="#13795b" stroke-width="3.2" stroke-dasharray="' + pct + ' ' + (100 - pct) + '" stroke-dashoffset="25" stroke-linecap="round"/><text x="18" y="18" text-anchor="middle" font-size="7.5" font-weight="800" fill="#142033">' + pct + '%</text><text x="18" y="23.5" text-anchor="middle" font-size="3.2" fill="#6b7482">' + done + ' of ' + steps.length + ' steps</text></svg>';
  const kp = (v, l, t) => '<div class="pv-k ' + t + '"><b>' + v + '</b><span>' + l + '</span></div>';
  return '<div class="pv-top"><div class="pv-ring">' + ring + '<div><b class="pv-big">' + (s.overall === 'Dispatched' ? 'Dispatched' : s.days < 0 ? (-s.days) + ' days late' : s.days + ' days left') + '</b><div class="small muted">to planned dispatch</div><div class="pv-mini">' + steps.map(x => '<span class="' + plStCls(x) + '" title="' + esc(x.name) + '"></span>').join('') + '</div></div></div>' +
    '<div class="pv-kps">' + kp(late, 'steps late now', late ? 'r' : 'g') + kp(aw, 'materials awaited' + (s.noPo ? ' (' + s.noPo + ' no PO)' : ''), s.noPo ? 'r' : aw ? 'a' : 'g') + kp(s.items.filter(x => x.bal <= 1e-9).length + ' / ' + s.items.length, 'materials issued', 'b') + kp(qtyFmt(pk) + ' / ' + qtyFmt(s.qty), 'packed', pk >= s.qty && s.qty ? 'g' : 'b') + '</div></div>' +
    '<div class="pv-grid2"><div class="pv-card"><h4>O2D steps</h4><table class="plm-t"><tr><th>#</th><th>Step</th><th>Doer</th><th>Planned</th><th>Status</th></tr>' +
    order.map(x => '<tr><td>' + x.n + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.doer || '') + '</td><td class="nowrap">' + (x.planned ? fmtD(x.planned) : '—') + '</td><td><span class="st ' + { d: 'Done', l: 'Late', p: 'Pending', w: 'NA' }[plStCls(x)] + '">' + esc(plStepTxt(x)) + '</span></td></tr>').join('') + '</table></div>' +
    '<div class="pv-card"><h4>Material</h4><table class="plm-t"><tr><th>Item</th><th class="num">Balance</th><th class="num">Stock</th><th>Status</th></tr>' + s.items.map(x => '<tr><td>' + esc(x.m.name || x.l.material) + '</td><td class="num"><b>' + qtyFmt(x.bal) + '</b> / ' + qtyFmt(x.rq) + '</td><td class="num">' + qtyFmt(x.stock) + '</td><td><span class="st ' + MST[x.state] + '">' + (x.po && x.bal && x.state === 'PO raised' ? esc(x.po.no.split('/').pop()) + ' · ' + (x.po.expected ? fmtD(x.po.expected) : '') : esc(x.state)) + '</span></td></tr>').join('') + '</table>' +
    '<h4>Production</h4><table class="plm-t"><tr>' + s.prod.map(x => '<th>' + esc(x.stage) + '</th>').join('') + '<th>Dispatched</th></tr><tr>' + s.prod.map(x => '<td>' + qtyFmt(x.done) + ' / ' + qtyFmt(s.qty) + '</td>').join('') + '<td>' + qtyFmt(s.disp) + ' / ' + qtyFmt(s.qty) + '</td></tr></table>' +
    '<h4>Plan</h4>' + plPlanTxt(p) + '</div></div>';
}
function planDetail(p, s) {
  const dd = s.overall === 'Dispatched' ? 'Dispatched' : s.days < 0 ? (-s.days) + ' days late' : s.days === 0 ? 'Due today' : s.days + ' days left';
  return '<div class="plm"><div class="plm-hd"><div><span class="plm-jc">' + esc(p.jc_no) + '</span><span class="plm-meta">' + esc([p.customer, p.article, p.colour].filter(Boolean).join(' · ')) + ' · ' + qtyFmt(s.qty) + ' pairs · Order ' + esc(p.order_no || '') + '</span></div>' +
    '<div class="plm-r"><span class="plm-dd">Dispatch <b>' + fmtD(p.dispatch_date) + '</b> · ' + dd + '</span><span class="st ' + OVR_CLS[s.overall] + '">' + esc(s.overall) + '</span>' +
    (can('production', 'edit') && s.overall !== 'Dispatched' ? '<button class="btn sm" data-act="pl-revise" data-id="' + esc(p.id) + '">Revise date</button>' : '') + '<button class="btn sm ghost" data-act="pl-close">✕</button></div></div>' +
    '<div class="plm-body">' + plSummary(p, s) + '</div></div>';
}
function planModal() {
  const old = $('#plModal'); if (old) old.remove();
  const p = PL_UI.open && Store.get('prod_plans', PL_UI.open); if (!p || !jcBy(p.jc_no)) { PL_UI.open = null; return; }
  const s = planStatus(p);
  const d = document.createElement('div'); d.id = 'plModal'; d.className = 'dlg-back plm-back';
  d.innerHTML = planDetail(p, s);
  d.addEventListener('click', e => { if (e.target === d) ACTIONS['pl-close'](); });
  document.body.appendChild(d);
}
ACTIONS['pl-close'] = () => { PL_UI.open = null; const m = $('#plModal'); if (m) m.remove(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#plModal') && !$('#fxDlg')) ACTIONS['pl-close'](); });
window.addEventListener('hashchange', () => { const m = $('#plModal'); if (m) { m.remove(); PL_UI.open = null; } });
ACTIONS['pl-new'] = () => { Object.assign(PL_UI, { form: !PL_UI.form, jc: '', date: '', rem: '' }); VIEWS.planning.render(); };
ACTIONS['pl-toggle'] = (el, ev) => { if (ev && ev.target.closest('button,a,input,select')) return; PL_UI.open = el.dataset.id; planModal(); };
ACTIONS['pl-save'] = el => {
  if (!requirePerm('production', 'edit')) return;
  const msg = t => { $('#plMsg').innerHTML = '<span class="late-txt">' + esc(t) + '</span>'; };
  const j = planJcs().find(x => norm(x.no) === norm(PL_UI.jc || ($('#plJc') || {}).value || ''));
  if (!j) return msg('Select a Job Card from the list.');
  const date = $('#plDate').value; if (!date) return msg('Enter the Planned Dispatch Date.');
  if (date < todayYmd()) return msg('Planned Dispatch Date cannot be in the past.');
  el.disabled = true;
  const inf = planInfo(j);
  const p = Store.put('prod_plans', Object.assign({ id: uid(), jc_no: j.no, dispatch_date: date, remark: ($('#plRem').value || '').trim(), history: [], by: ME.name, at: nowIso() }, inf));
  audit('plan.create', j.no, 'dispatch ' + fmtD(date) + (p.remark ? ' · ' + p.remark : ''));
  const r = planSyncO2D(j);
  Object.assign(PL_UI, { form: false, jc: '', date: '', rem: '', open: null });
  flash(esc(j.no) + ' planned for ' + fmtD(date) + '.' + (r === 'closed' ? ' O2D "Planned Dispatch Date" marked done for ' + esc(p.order_no) + '.' : r === 'waiting' ? ' O2D step closes when every job card of ' + esc(p.order_no) + ' is planned.' : ''));
  VIEWS.planning.render();
};
ACTIONS['pl-revise'] = el => {
  const p = Store.get('prod_plans', el.dataset.id); if (!p) return;
  formDialog('Revise dispatch date · ' + p.jc_no, [{ k: 'date', l: 'New Planned Dispatch Date', type: 'date', value: p.dispatch_date, req: true }, { k: 'why', l: 'Reason', type: 'textarea', req: true }], 'Save', v => {
    if (!v.date || v.date < todayYmd()) return 'Enter a date from today onward.';
    if (v.date === p.dispatch_date) return 'The date is the same.';
    p.history = (p.history || []).concat([{ at: nowIso(), by: ME.name, old: p.dispatch_date, new: v.date, reason: v.why }]);
    const old = p.dispatch_date; p.dispatch_date = v.date; Store.put('prod_plans', p);
    audit('plan.revise', p.jc_no, fmtD(old) + ' → ' + fmtD(v.date) + ' · ' + v.why);
    const j = jcBy(p.jc_no); const r = j ? planSyncO2D(j) : '';
    flash(esc(p.jc_no) + ' dispatch date revised to ' + fmtD(v.date) + '.' + (r === 'updated' ? ' O2D planned dispatch updated.' : '')); VIEWS.planning.render(); if (PL_UI.open) planModal();
  });
};
ACTIONS['pl-print'] = () => {
  const plans = Store.all('prod_plans').filter(p => !p.cancelled && jcBy(p.jc_no)).map(p => ({ p, s: planStatus(p) })).filter(x => planFilter(x, PL_UI.f)).sort((a, b) => (a.p.dispatch_date || '') < (b.p.dispatch_date || '') ? -1 : 1);
  const w = window.open('');
  w.document.write('<html><head><title>DPR ' + fmtD(todayYmd()) + '</title><style>body{font:11px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;margin:18px}h1{font-size:16px;margin:0}small{color:#555}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #c9d1dc;padding:4px 6px;text-align:left;vertical-align:middle}th{background:#eef3fb;font-size:10.5px}.num{text-align:right}.c{text-align:center}.pa-bar,.pa-h{display:none}.pa-v i{margin:0 2px;font-style:normal;color:#888}.st{font-weight:600}.st.Late,.late-txt{color:#b42318}.st.Pending,.warn-txt{color:#a35d00}.st.Done{color:#13795b}.muted{color:#777}.small{font-size:10px}.pr-cnt{font-size:9px;color:#1a56c8}@page{size:A4 landscape;margin:10mm}</style></head><body>' +
    '<h1>' + esc(settings().company || 'Nexus 2.0') + ' — Daily Production Report</h1><small>' + fmtDT(nowIso()) + ' · ' + plans.length + ' job card(s)</small>' + dprTable(plans, false) + '</body></html>');
  w.document.close(); setTimeout(() => w.print(), 300);
};

