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
    const pos = openPOs().filter(x => x.lines.some(y => norm(y.material) === norm(l.material) && num(y.qty) > num(y.received))).sort((a, b) => (a.expected || '9') < (b.expected || '9') ? -1 : 1);
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
// complete tracking of one job card in a full-screen panel that fits the screen — four views of the same data:
// Journey (order-tracking line), Departments (board), Summary (numbers + table), Timeline (Gantt)
const PLV = [['journey', 'Journey'], ['dept', 'Departments'], ['summary', 'Summary'], ['timeline', 'Timeline']];
function plView() { try { const v = localStorage.getItem('nx_pl_view'); if (PLV.some(x => x[0] === v)) return v; } catch (e) { } return 'journey'; }
function plSteps(s) {
  if (!s.r) return [];
  const dept = n => { const u = Store.all('users').find(x => x.doer && norm(x.doer) === norm(n)); const d = (u && u.department) || (norm(n) === 'system' ? 'Dispatch' : 'Other'); return String(d).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); };
  return s.r.order.map(id => s.r.steps[id]).filter(st => st && st.applies).map((st, i) => Object.assign({}, st, { n: i + 1, dept: dept(st.doer || '') }));
}
const plStepTxt = st => st.status === 'Done' ? '✓ ' + fmtD(st.actual) + (st.delayMinutes > 0 ? ' · ' + fmtDelay(Math.round(st.delayMinutes)) + ' late' : '') : st.status === 'Late' ? fmtDelay(Math.round(st.delayMinutes)) + ' late' : st.planned ? 'due ' + fmtD(st.planned) : 'waiting';
const plStCls = st => st.status === 'Done' ? 'd' : st.status === 'Late' ? 'l' : st.status === 'Pending' ? 'p' : 'w';
const MST = { Issued: 'Done', 'In stock': 'Done', 'PO raised': 'Pending', 'No PO': 'Late' };
function plMatRows(s, compact) {
  if (!s.items.length) return '<div class="muted small">No BOM on this job card.</div>';
  return s.items.map(x => '<div class="pv-row' + (x.state === 'No PO' ? ' lt' : '') + '"><div><b>' + esc(x.m.name || x.l.material) + '</b><i>' + (x.bal ? qtyFmt(x.bal) + ' of ' + qtyFmt(x.rq) + ' balance' : 'fully issued') + (compact ? '' : ' · stock ' + qtyFmt(x.stock)) + '</i></div>' +
    '<span class="st ' + MST[x.state] + '">' + (x.po && x.bal && x.state === 'PO raised' ? 'PO · ' + (x.po.expected ? fmtD(x.po.expected).replace(/ \d{4}$/, '') : '') : esc(x.state)) + '</span></div>').join('');
}
function plProdBars(s) {
  return s.prod.map(x => { const pct = s.qty ? Math.min(100, Math.round(x.done / s.qty * 100)) : 0; return '<div class="pv-bar"><span>' + esc(x.stage) + '</span><b>' + qtyFmt(x.done) + ' / ' + qtyFmt(s.qty) + '</b><div><i style="width:' + pct + '%"></i></div></div>'; }).join('') +
    '<div class="pv-bar"><span>Dispatched</span><b>' + qtyFmt(s.disp) + ' / ' + qtyFmt(s.qty) + '</b><div><i class="g" style="width:' + (s.qty ? Math.min(100, Math.round(s.disp / s.qty * 100)) : 0) + '%"></i></div></div>';
}
function plPlanTxt(p) {
  return '<div class="small">Dispatch <b>' + fmtD(p.dispatch_date) + '</b> · by ' + esc(p.by || '') + ' · ' + fmtDT(p.at) + (p.remark ? '<br>' + esc(p.remark) : '') + '</div>' +
    (p.history || []).slice().reverse().map(x => '<div class="plm-h"><b>' + fmtD(x.old) + ' → ' + fmtD(x.new) + '</b><span>' + esc(x.reason) + '</span><i>' + esc(x.by) + ' · ' + fmtDT(x.at) + '</i></div>').join('');
}
function plGroups(steps) { const groups = []; steps.forEach(st => { let g = groups.find(x => x.d === st.dept); if (!g) groups.push(g = { d: st.dept, list: [] }); g.list.push(st); }); return groups; }
// 1) Journey: milestones (order → each department → material → production → dispatch) + what is stuck / next
function plJourney(p, s) {
  const steps = plSteps(s); const all = plGroups(steps); const groups = all.filter(g => !/^dispatch$/i.test(g.d)); const dg = all.find(g => /^dispatch$/i.test(g.d));
  const ms = [{ t: 'Order Received', c: 'ok', sub: fmtD((s.o || {}).order_date || (s.o || {}).created_at) }];
  groups.forEach(g => {
    const late = g.list.find(x => x.status === 'Late'), cur = g.list.find(x => x.status === 'Pending'), done = g.list.filter(x => x.status === 'Done');
    ms.push(done.length === g.list.length ? { t: g.d, c: 'ok', sub: done.length + ' of ' + g.list.length + ' · ' + fmtD(done.map(x => x.actual).sort().pop()) }
      : late ? { t: g.d, c: 'late', sub: late.name + ' · ' + fmtDelay(Math.round(late.delayMinutes)) + ' late' }
      : cur ? { t: g.d, c: 'now', sub: cur.name + ' · due ' + fmtD(cur.planned) }
      : { t: g.d, c: 'wait', sub: done.length + ' of ' + g.list.length + ' done' });
  });
  const open = s.items.filter(x => x.bal > 1e-9);
  ms.push(!s.items.length ? { t: 'Material', c: 'wait', sub: 'No BOM' } : !open.length ? { t: 'Material', c: 'ok', sub: 'All issued' } : s.noPo ? { t: 'Material', c: 'late', sub: s.noPo + ' item(s) no PO' } : { t: 'Material', c: open.every(x => x.state === 'In stock') ? 'now' : 'wait', sub: open.every(x => x.state === 'In stock') ? 'In stock · to issue' : 'Awaited on PO' });
  const pk = s.prod.length ? s.prod[s.prod.length - 1].done : 0, ct = s.prod.length ? s.prod[0].done : 0;
  ms.push(pk >= s.qty && s.qty ? { t: 'Packing', c: 'ok', sub: 'Packed ' + qtyFmt(pk) } : ct > 0 ? { t: 'Packing', c: 'now', sub: 'Packed ' + qtyFmt(pk) + ' / ' + qtyFmt(s.qty) } : { t: 'Packing', c: 'wait', sub: '0 / ' + qtyFmt(s.qty) });
  const dLate = dg && dg.list.find(x => x.status === 'Late');
  ms.push(s.overall === 'Dispatched' ? { t: 'Dispatch', c: 'ok', sub: 'Dispatched' } : dLate ? { t: 'Dispatch', c: 'late', sub: dLate.name + ' · ' + fmtDelay(Math.round(dLate.delayMinutes)) + ' late' } : { t: 'Dispatch', c: s.days < 0 ? 'late' : 'wait', sub: 'Plan ' + fmtD(p.dispatch_date) + (s.days < 0 ? ' · ' + (-s.days) + 'd late' : '') });
  const lastOk = ms.reduce((a, m, i) => m.c === 'ok' ? i : a, 0);
  const late = steps.filter(x => x.status === 'Late').sort((a, b) => b.delayMinutes - a.delayMinutes);
  const next = steps.filter(x => x.status === 'Pending').sort((a, b) => a.planned - b.planned).concat(steps.filter(x => x.status === 'Waiting')).slice(0, Math.max(2, 5 - late.length));
  return '<div class="pv-trk"><div class="pv-line"><span class="pv-fill" style="width:calc((100% - 120px) * ' + (ms.length > 1 ? (lastOk / (ms.length - 1)).toFixed(3) : 0) + ')"></span>' +
    ms.map((m, i) => '<div class="pv-ms ' + m.c + '"><div class="pv-dot">' + (m.c === 'ok' ? '✓' : m.c === 'late' ? '!' : i + 1) + '</div><b>' + esc(m.t) + '</b><i>' + esc(m.sub) + '</i></div>').join('') + '</div></div>' +
    '<div class="pv-grid3"><div class="pv-card"><h4>Atka hua · ' + late.length + ' late</h4>' + (late.length ? late.map(x => '<div class="pv-row lt"><div><b>' + esc(x.name) + '</b><i>' + esc(x.doer || '') + '</i></div><span class="late-txt"><b>' + fmtDelay(Math.round(x.delayMinutes)) + ' late</b></span></div>').join('') : '<div class="pv-ok">Nothing is late</div>') +
    '<h4>Aage kya hai</h4>' + (next.length ? next.map(x => '<div class="pv-row"><div><b>' + esc(x.name) + '</b><i>' + esc(x.doer || '') + '</i></div><span class="muted small">' + (x.planned ? 'due ' + fmtD(x.planned) : 'waiting') + '</span></div>').join('') : '<div class="muted small">All steps done</div>') + '</div>' +
    '<div class="pv-card"><h4>Material · ' + s.items.filter(x => x.bal <= 1e-9).length + ' / ' + s.items.length + ' issued</h4>' + plMatRows(s) + '</div>' +
    '<div class="pv-card"><h4>Production</h4>' + plProdBars(s) + '<h4>Plan</h4>' + plPlanTxt(p) + '</div></div>';
}
// 2) Departments: one column per department, its steps as a checklist
function plDepts(p, s) {
  const groups = plGroups(plSteps(s));
  return '<div class="pv-cols" style="grid-template-columns:repeat(' + Math.max(1, groups.length) + ',minmax(0,1fr))">' + groups.map(g => {
    const done = g.list.filter(x => x.status === 'Done').length, late = g.list.filter(x => x.status === 'Late').length;
    return '<div class="pv-col"><div class="pv-ch"><b>' + esc(g.d) + '</b> <span class="muted small">' + done + ' / ' + g.list.length + (late ? ' · <span class="late-txt">' + late + ' late</span>' : '') + '</span><div class="pv-p"><span style="width:' + Math.round(done / g.list.length * 100) + '%"></span></div></div>' +
      '<div class="pv-cl">' + g.list.map(x => '<div class="pv-st ' + plStCls(x) + '" title="' + esc((x.planned ? 'Planned ' + fmtDT(x.planned) : '') + (x.actual ? ' · Done ' + fmtDT(x.actual) : '')) + '"><span class="pv-ic">' + (x.status === 'Done' ? '✓' : x.status === 'Late' ? '!' : '') + '</span><div><b>' + esc(x.name) + '</b><i>' + esc((x.doer || '') + ' · ' + plStepTxt(x)) + '</i></div></div>').join('') + '</div></div>';
  }).join('') + '</div>' +
    '<div class="pv-foot"><div class="pv-card"><h4>Material · ' + s.items.filter(x => x.bal <= 1e-9).length + ' / ' + s.items.length + ' issued</h4><div class="pv-mat2">' + plMatRows(s, true) + '</div></div><div class="pv-card"><h4>Production</h4><div class="pv-prod2">' + plProdBars(s) + '</div></div></div>';
}
// 3) Summary: progress ring, key numbers, step table (late and current first) + material + production
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
function planDetail(p, s, view) {
  const dd = s.overall === 'Dispatched' ? 'Dispatched' : s.days < 0 ? (-s.days) + ' days late' : s.days === 0 ? 'Due today' : s.days + ' days left';
  return '<div class="plm"><div class="plm-hd"><div><span class="plm-jc">' + esc(p.jc_no) + '</span><span class="plm-meta">' + esc([p.customer, p.article, p.colour].filter(Boolean).join(' · ')) + ' · ' + qtyFmt(s.qty) + ' pairs · Order ' + esc(p.order_no || '') + '</span></div>' +
    '<div class="seg plm-tabs">' + PLV.map(([k, l]) => '<button type="button" data-act="pl-view" data-v="' + k + '" class="' + (k === view ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
    '<div class="plm-r"><span class="plm-dd">Dispatch <b>' + fmtD(p.dispatch_date) + '</b> · ' + dd + '</span><span class="st ' + OVR_CLS[s.overall] + '">' + esc(s.overall) + '</span>' +
    (can('production', 'edit') && s.overall !== 'Dispatched' ? '<button class="btn sm" data-act="pl-revise" data-id="' + esc(p.id) + '">Revise date</button>' : '') + '<button class="btn sm ghost" data-act="pl-close">✕</button></div></div>' +
    '<div class="plm-body">' + (view === 'dept' ? plDepts(p, s) : view === 'summary' ? plSummary(p, s) : view === 'timeline' ? '<div class="plm-b"><div class="plm-g"></div><div class="plm-side"><div class="pl-sec">Material</div>' + plMatRows(s) + '<div class="pl-sec">Plan</div>' + plPlanTxt(p) + '</div></div>' : plJourney(p, s)) + '</div></div>';
}
function planModal() {
  const old = $('#plModal'); if (old) old.remove();
  const p = PL_UI.open && Store.get('prod_plans', PL_UI.open); if (!p || !jcBy(p.jc_no)) { PL_UI.open = null; return; }
  const s = planStatus(p), view = plView();
  const d = document.createElement('div'); d.id = 'plModal'; d.className = 'dlg-back plm-back';
  d.innerHTML = planDetail(p, s, view);
  d.addEventListener('click', e => { if (e.target === d) ACTIONS['pl-close'](); });
  document.body.appendChild(d);
  // the timeline is drawn at the panel's real size
  const g = $('.plm-g', d);
  if (g) g.innerHTML = s.r ? o2dGantt(s.o, s.r, p.dispatch_date, { w: g.clientWidth - 24, h: g.clientHeight - 20 }) : '<div class="muted">Order not found for O2D tracking.</div>';
}
ACTIONS['pl-view'] = el => { try { localStorage.setItem('nx_pl_view', el.dataset.v); } catch (e) { } planModal(); };
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

function o2dGantt(o, r, dispatchYmd, box) {
  const steps = r.order.map(id => Object.assign({ def: r.spec.steps.find(x => x.id === id) }, r.steps[id])).filter(st => st && st.applies);
  const now = new Date(), created = new Date(o.created_at || o.at || now);
  const t0 = st => { const tr = st.def && (Array.isArray(st.def.trigger) ? st.def.trigger[0] : st.def.trigger) || {};
    if (tr.type === 'afterStep' && r.steps[tr.step] && r.steps[tr.step].actual) return new Date(r.steps[tr.step].actual);
    if (tr.type === 'instanceStart') return created; return st.planned ? new Date(st.planned) : null; };
  steps.forEach(st => { st.start = t0(st); st.pl = st.planned ? new Date(st.planned) : null; st.ac = st.actual ? new Date(st.actual) : null; });
  const ds = [created, now].concat(...steps.map(st => [st.start, st.pl, st.ac].filter(Boolean)));
  if (dispatchYmd) ds.push(new Date(dispatchYmd + 'T18:00:00'));
  const day = 864e5, d0 = new Date(Math.min(...ds)); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(Math.max(...ds) + day); d1.setHours(23, 59, 0, 0);
  // drawn at the real size of the panel (box) so it fills it without scrolling; rows grow or shrink to fit
  const W = box ? Math.max(700, Math.floor(box.w)) : 1180, L = 250, R = 175, HEAD = 44;
  const RH = box ? Math.max(16, Math.min(34, Math.floor((box.h - 34 - HEAD - 10) / (steps.length || 1)))) : 22, H = HEAD + steps.length * RH + 8;
  const span = d1 - d0, x = d => L + (W - L - R) * Math.max(0, Math.min(1, (d - d0) / span));
  const days = Math.round(span / day), every = days <= 16 ? 1 : days <= 35 ? 2 : days <= 70 ? 7 : 14;
  let g = '';
  for (let d = new Date(d0), k = 0; d <= d1; d = new Date(d.getTime() + day), k++) {
    const xx = x(d), wk = d.getDay() === 0;
    if (wk) g += '<rect x="' + xx + '" y="' + HEAD + '" width="' + ((W - L - R) * day / span) + '" height="' + (H - HEAD - 8) + '" fill="#f4f6fa"/>';
    g += '<line x1="' + xx + '" x2="' + xx + '" y1="' + (HEAD - 6) + '" y2="' + (H - 8) + '" stroke="#eef1f6"/>';
    if (k % every === 0) g += '<text x="' + (xx + 3) + '" y="' + (HEAD - 10) + '" class="gt-ax">' + d.getDate() + ' ' + MON[d.getMonth()] + '</text>';
  }
  steps.forEach((st, i) => {
    const y = HEAD + i * RH, cy = y + RH / 2;
    const late = st.status === 'Late' || (st.ac && st.delayMinutes > 0);
    const col = st.status === 'Done' ? (st.delayMinutes > 0 ? '#d97706' : '#13795b') : st.status === 'Late' ? '#d03b3b' : '#2a78d6';
    const txt = st.status === 'Done' ? '✓ ' + fmtD(st.ac) + (st.delayMinutes > 0 ? ' · ' + fmtDelay(Math.round(st.delayMinutes)) + ' late' : '') : st.status === 'Late' ? fmtDelay(Math.round(st.delayMinutes)) + ' late' : st.pl ? 'due ' + fmtD(st.pl) : 'waiting';
    const tip = '<b>' + esc(st.name) + '</b><br>' + esc(st.doer || '') + (st.pl ? '<br>Planned: ' + fmtDT(st.pl) : '') + (st.ac ? '<br>Done: ' + fmtDT(st.ac) : '') + (st.delayMinutes ? '<br>Delay: ' + fmtDelay(Math.round(st.delayMinutes)) : '');
    g += '<g class="vz-hit" data-tip="' + esc(tip) + '">' + (i % 2 ? '<rect x="0" y="' + y + '" width="' + W + '" height="' + RH + '" fill="#fafbfd"/>' : '<rect x="0" y="' + y + '" width="' + W + '" height="' + RH + '" fill="transparent"/>') +
      '<text x="8" y="' + (cy + 4) + '" class="gt-name"' + (st.status === 'Waiting' ? ' fill="#98a3b6"' : '') + '>' + esc((st.name.length > 26 ? st.name.slice(0, 25) + '…' : st.name)) + '</text>' +
      '<text x="' + (L - 8) + '" y="' + (cy + 4) + '" text-anchor="end" class="gt-doer">' + esc(st.doer || '') + '</text>';
    if (st.start && st.pl) { const a = x(Math.min(st.start, st.pl)), b = x(st.pl); g += '<rect x="' + a + '" y="' + (cy - 6) + '" width="' + Math.max(3, b - a) + '" height="12" rx="3" fill="#dfe5ee"/>'; }
    const endA = st.ac || (st.status === 'Late' ? now : null);
    if (st.start && endA) { const a = x(st.start), b = x(endA); g += '<rect x="' + a + '" y="' + (cy - 3.5) + '" width="' + Math.max(4, b - a) + '" height="7" rx="3.5" fill="' + col + '"' + (!st.ac ? ' opacity=".85"' : '') + '/>'; }
    else if (st.pl && st.status !== 'Done') g += '<path d="M' + x(st.pl) + ',' + (cy - 5) + ' l5,5 l-5,5 l-5,-5 z" fill="' + col + '"/>';
    g += '<text x="' + (W - R + 10) + '" y="' + (cy + 4) + '" class="gt-st" fill="' + (st.status === 'Waiting' ? '#98a3b6' : late ? '#b42318' : st.status === 'Done' ? '#13795b' : '#33415a') + '">' + esc(txt) + '</text></g>';
  });
  // today and planned dispatch markers
  const tx = x(now); g += '<line x1="' + tx + '" x2="' + tx + '" y1="' + (HEAD - 4) + '" y2="' + (H - 8) + '" stroke="#d03b3b" stroke-width="1.5" stroke-dasharray="4 3"/><rect x="' + (tx - 20) + '" y="2" width="40" height="15" rx="7.5" fill="#d03b3b"/><text x="' + tx + '" y="13" text-anchor="middle" class="gt-tag">Today</text>';
  if (dispatchYmd) { const dx = x(new Date(dispatchYmd + 'T18:00:00')); g += '<line x1="' + dx + '" x2="' + dx + '" y1="' + (HEAD - 4) + '" y2="' + (H - 8) + '" stroke="#6d4dc4" stroke-width="1.5"/><rect x="' + (dx - 30) + '" y="2" width="60" height="15" rx="7.5" fill="#6d4dc4"/><text x="' + dx + '" y="13" text-anchor="middle" class="gt-tag">Dispatch</text>'; }
  const done = steps.filter(st => st.status === 'Done').length, lateN = steps.filter(st => st.status === 'Late').length;
  return '<div class="gt-wrap"><div class="gt-top"><span><b>' + done + '</b> / ' + steps.length + ' steps done' + (lateN ? ' · <b class="late-txt">' + lateN + ' late</b>' : '') + '</span><span class="gt-leg"><i style="background:#dfe5ee"></i>Planned<i style="background:#13795b"></i>Done on time<i style="background:#d97706"></i>Done late<i style="background:#d03b3b"></i>Late (open)<i class="gt-dia"></i>Due</span></div>' +
    '<svg class="gt"' + (box ? ' width="' + W + '" height="' + H + '"' : '') + ' viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="O2D timeline">' + g + '</svg></div>';
}
