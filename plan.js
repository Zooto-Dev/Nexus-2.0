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
// complete tracking of one job card in a full-screen panel that fits the screen (no scrolling):
// left the O2D timeline, right the material and the plan
function planDetail(p, s) {
  const stCls = { Issued: 'Done', 'In stock': 'Done', 'PO raised': 'Pending', 'No PO': 'Late' };
  const mat = s.items.length ? '<table class="plm-t"><tr><th>Item</th><th class="num">Balance / Req</th><th>Status</th></tr>' +
    s.items.map(x => '<tr><td><b>' + esc(x.m.name || x.l.material) + '</b><div class="small muted">' + esc(x.l.material) + ' · stock ' + qtyFmt(x.stock) + ' ' + esc(x.l.uom || x.m.uom || '') + '</div></td><td class="num nowrap">' + (x.bal ? '<b>' + qtyFmt(x.bal) + '</b>' : '<b class="ok-txt">0</b>') + ' / ' + qtyFmt(x.rq) + '</td><td><span class="st ' + stCls[x.state] + '">' + esc(x.state) + '</span>' + (x.po && x.bal ? '<div class="small nowrap">' + esc(x.po.no.split('/').pop()) + ' · <span class="' + (x.po.expected && x.po.expected < todayYmd() ? 'late-txt' : 'muted') + '">' + (x.po.expected ? fmtD(x.po.expected) : '') + '</span></div>' : '') + '</td></tr>').join('') + '</table>' : '<div class="muted small">No BOM on this job card.</div>';
  const hist = (p.history || []).slice().reverse().map(x => '<div class="plm-h"><b>' + fmtD(x.old) + ' → ' + fmtD(x.new) + '</b><span>' + esc(x.reason) + '</span><i>' + esc(x.by) + ' · ' + fmtDT(x.at) + '</i></div>').join('');
  const dd = s.overall === 'Dispatched' ? 'Dispatched' : s.days < 0 ? (-s.days) + ' days late' : s.days === 0 ? 'Due today' : s.days + ' days left';
  return '<div class="plm"><div class="plm-hd"><div><span class="plm-jc">' + esc(p.jc_no) + '</span><span class="plm-meta">' + esc([p.customer, p.article, p.colour].filter(Boolean).join(' · ')) + ' · ' + qtyFmt(s.qty) + ' pairs · Order ' + esc(p.order_no || '') + '</span></div>' +
    '<div class="plm-r"><span class="plm-dd">Dispatch <b>' + fmtD(p.dispatch_date) + '</b> · ' + dd + '</span><span class="st ' + OVR_CLS[s.overall] + '">' + esc(s.overall) + '</span>' +
    (can('production', 'edit') && s.overall !== 'Dispatched' ? '<button class="btn sm" data-act="pl-revise" data-id="' + esc(p.id) + '">Revise date</button>' : '') + '<button class="btn sm ghost" data-act="pl-close">✕</button></div></div>' +
    '<div class="plm-b"><div class="plm-g">' + (s.r ? o2dGantt(s.o, s.r, p.dispatch_date) : '<div class="muted">Order not found for O2D tracking.</div>') + '</div>' +
    '<div class="plm-side"><div class="pl-sec">Material · ' + s.items.filter(x => x.bal <= 1e-9).length + ' / ' + s.items.length + ' issued</div>' + mat +
    '<div class="pl-sec">Plan</div><div class="small">By ' + esc(p.by || '') + ' · ' + fmtDT(p.at) + (p.remark ? '<br>' + esc(p.remark) : '') + '</div>' + hist + '</div></div></div>';
}
function planModal() {
  const old = $('#plModal'); if (old) old.remove();
  const p = PL_UI.open && Store.get('prod_plans', PL_UI.open); if (!p || !jcBy(p.jc_no)) { PL_UI.open = null; return; }
  const d = document.createElement('div'); d.id = 'plModal'; d.className = 'dlg-back plm-back';
  d.innerHTML = planDetail(p, planStatus(p));
  d.addEventListener('click', e => { if (e.target === d) ACTIONS['pl-close'](); });
  document.body.appendChild(d);
  // redraw the timeline at the panel's real size
  const g = $('.plm-g', d), s = planStatus(p);
  if (g && s.r) g.innerHTML = o2dGantt(s.o, s.r, p.dispatch_date, { w: g.clientWidth - 24, h: g.clientHeight - 20 });
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
