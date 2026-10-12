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
      let row = '<tr' + (interactive ? ' class="click' + (PL_UI.open === p.id ? ' pr-open' : '') + '" data-act="pl-toggle" data-id="' + esc(p.id) + '"' : '') + '><td><b>' + esc(p.jc_no) + '</b></td><td>' + esc(p.order_no || '') + '</td><td class="nowrap">' + fmtD(p.order_date) + '</td><td>' + esc(p.merchant || '') + '</td><td>' + esc(p.customer || '') + '</td><td>' + esc(p.category || '') + '</td><td>' + esc(p.article || '') + '</td><td>' + esc(p.colour || '') + '</td><td class="num">' + qtyFmt(s.qty) + '</td>' +
        '<td class="nowrap"><b>' + fmtD(p.dispatch_date) + '</b>' + ((p.history || []).length ? ' <span class="pr-cnt" title="Revised">R' + p.history.length + '</span>' : '') + '<div class="small">' + dd + '</div></td>' +
        '<td>' + (cur ? '<span class="st ' + (cur.status === 'Late' ? 'Late' : 'Pending') + '">' + esc(cur.name) + '</span>' : esc(s.st ? s.st.label : '—')) + '</td>' +
        '<td><span class="st ' + (MAT_CLS[s.matArr] || 'NA') + '">' + esc(s.matArr) + '</span>' + (s.matArr === 'Awaited' ? '<div class="small muted">' + s.awaited + ' on PO' + (s.noPo ? ' · <span class="late-txt">' + s.noPo + ' no PO</span>' : '') + '</div>' : '') + '</td>' +
        '<td>' + (s.items.length ? '<div class="pa ' + (s.issPct >= 100 ? 'pa-done' : s.issPct > 0 ? 'pa-part' : 'pa-0') + '"><span class="pa-v"><b>' + s.items.filter(x => x.bal <= 1e-9).length + '</b><i>/</i>' + s.items.length + ' items · ' + s.issPct + '%</span><span class="pa-bar"><span style="width:' + s.issPct + '%"></span></span></div>' : '<span class="muted">—</span>') + '</td>' + s.prod.map(x => '<td>' + pa(x.done, s.qty) + '</td>').join('') + '<td>' + pa(s.disp, s.qty) + '</td>' +
        '<td><span class="st ' + OVR_CLS[s.overall] + '">' + esc(s.overall) + '</span></td></tr>';
      if (interactive && PL_UI.open === p.id) row += '<tr class="inline-form"><td colspan="' + cols + '">' + planDetail(p, s) + '</td></tr>';
      return row;
    }).join('') : '<tr><td colspan="' + cols + '" class="empty">No plans yet</td></tr>') + '</table>';
}
function planDetail(p, s) {
  let h = '<div class="pr-detail pl-detail">';
  // O2D steps
  if (s.r) {
    h += '<div class="pl-sec">O2D tracking · ' + esc(s.o.no) + '</div><table class="pr-sz"><tr><th>#</th><th>Step</th><th>Doer</th><th>Planned</th><th>Actual</th><th>Delay</th><th>Status</th></tr>' +
      s.r.order.map((id, i) => { const st = s.r.steps[id]; if (!st || !st.applies) return ''; return '<tr><td>' + (i + 1) + '</td><td>' + esc(st.name) + '</td><td>' + esc(st.doer || '') + '</td><td class="nowrap">' + (st.planned ? fmtDT(st.planned) : '') + '</td><td class="nowrap">' + (st.actual ? fmtDT(st.actual) : '') + '</td><td class="nowrap">' + (st.delayMinutes ? '<span class="late-txt">' + fmtDelay(Math.round(st.delayMinutes)) + '</span>' : '') + '</td><td>' + stHtml(st.status === 'Done' ? 'Done' : st.status === 'Late' ? 'Late' : st.status === 'Pending' ? 'Pending' : st.status) + '</td></tr>'; }).join('') + '</table>';
  } else h += '<div class="muted small">Order not found for O2D tracking.</div>';
  // material
  h += '<div class="pl-sec">Material</div>' + (s.items.length ? '<table class="pr-sz"><tr><th>Item</th><th>Code</th><th>UOM</th><th class="num">Required</th><th class="num">Issued</th><th class="num">Balance</th><th class="num">Stock</th><th>PO (expected)</th><th>Status</th></tr>' +
    s.items.map(x => '<tr><td>' + esc(x.m.name || x.l.material) + '</td><td>' + esc(x.l.material) + '</td><td>' + esc(x.l.uom || x.m.uom || '') + '</td><td class="num">' + qtyFmt(x.rq) + '</td><td class="num">' + qtyFmt(x.is) + '</td><td class="num">' + (x.bal ? '<b>' + qtyFmt(x.bal) + '</b>' : '—') + '</td><td class="num">' + qtyFmt(x.stock) + '</td><td class="nowrap">' + (x.po ? esc(x.po.no) + (x.po.expected ? ' · <span class="' + (x.po.expected < todayYmd() ? 'late-txt' : '') + '">' + fmtD(x.po.expected) + '</span>' : '') : '') + '</td><td><span class="st ' + ({ Issued: 'Done', 'In stock': 'Done', 'PO raised': 'Pending', 'No PO': 'Late' }[x.state]) + '">' + esc(x.state) + '</span></td></tr>').join('') + '</table>' : '<div class="muted small">No BOM on this job card.</div>');
  // plan + history
  h += '<div class="pl-sec">Plan</div><div class="small">Planned dispatch <b>' + fmtD(p.dispatch_date) + '</b> · by ' + esc(p.by || '') + ' · ' + fmtDT(p.at) + (p.remark ? ' · ' + esc(p.remark) : '') + '</div>' +
    ((p.history || []).length ? '<table class="pr-sz" style="margin-top:6px"><tr><th>Changed</th><th>By</th><th>Old Date</th><th>New Date</th><th>Reason</th></tr>' + p.history.slice().reverse().map(x => '<tr><td class="nowrap">' + fmtDT(x.at) + '</td><td>' + esc(x.by) + '</td><td>' + fmtD(x.old) + '</td><td>' + fmtD(x.new) + '</td><td>' + esc(x.reason) + '</td></tr>').join('') + '</table>' : '') +
    (can('production', 'edit') && s.overall !== 'Dispatched' ? '<div class="toolbar" style="margin-top:8px"><button class="btn sm" data-act="pl-revise" data-id="' + esc(p.id) + '">Revise dispatch date</button></div>' : '');
  return h + '</div>';
}
ACTIONS['pl-new'] = () => { Object.assign(PL_UI, { form: !PL_UI.form, jc: '', date: '', rem: '' }); VIEWS.planning.render(); };
ACTIONS['pl-toggle'] = (el, ev) => { if (ev && ev.target.closest('button,a,input,select')) return; PL_UI.open = PL_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.planning.render(); };
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
  Object.assign(PL_UI, { form: false, jc: '', date: '', rem: '', open: p.id });
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
    flash(esc(p.jc_no) + ' dispatch date revised to ' + fmtD(v.date) + '.' + (r === 'updated' ? ' O2D planned dispatch updated.' : '')); VIEWS.planning.render();
  });
};
ACTIONS['pl-print'] = () => {
  const plans = Store.all('prod_plans').filter(p => !p.cancelled && jcBy(p.jc_no)).map(p => ({ p, s: planStatus(p) })).filter(x => planFilter(x, PL_UI.f)).sort((a, b) => (a.p.dispatch_date || '') < (b.p.dispatch_date || '') ? -1 : 1);
  const w = window.open('');
  w.document.write('<html><head><title>DPR ' + fmtD(todayYmd()) + '</title><style>body{font:11px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;margin:18px}h1{font-size:16px;margin:0}small{color:#555}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #c9d1dc;padding:4px 6px;text-align:left;vertical-align:middle}th{background:#eef3fb;font-size:10.5px}.num{text-align:right}.c{text-align:center}.pa-bar,.pa-h{display:none}.pa-v i{margin:0 2px;font-style:normal;color:#888}.st{font-weight:600}.st.Late,.late-txt{color:#b42318}.st.Pending,.warn-txt{color:#a35d00}.st.Done{color:#13795b}.muted{color:#777}.small{font-size:10px}.pr-cnt{font-size:9px;color:#1a56c8}@page{size:A4 landscape;margin:10mm}</style></head><body>' +
    '<h1>' + esc(settings().company || 'Nexus 2.0') + ' — Daily Production Report</h1><small>' + fmtDT(nowIso()) + ' · ' + plans.length + ' job card(s)</small>' + dprTable(plans, false) + '</body></html>');
  w.document.close(); setTimeout(() => w.print(), 300);
};
