/* Nexus 2.0 — Plan vs Actual for every purchase / store activity, people scoring for Home. */
'use strict';
// Each activity: start time → planned time (start + TAT in working time) → actual time. TATs live in Settings.
const PA_DEFS = [
  { k: 'po_raise', l: 'PO Raise', tat: { value: 1, unit: 'days' }, grp: 'Purchase', next: 'PO Approval', can: () => can('purchase', 'edit') },
  { k: 'po_approval', l: 'PO Approval', tat: { value: 4, unit: 'hours' }, grp: 'Approver', next: 'Material Inward', can: () => canApprove() },
  { k: 'inward', l: 'Material Inward', tat: { value: 3, unit: 'days' }, grp: 'Store', next: 'Invoice Approval', can: () => can('store', 'edit') },
  { k: 'invoice', l: 'Invoice Approval', tat: { value: 4, unit: 'hours' }, grp: 'Purchase', next: 'QC Check / GRN', can: () => can('purchase', 'edit') },
  { k: 'qc', l: 'QC Check', tat: { value: 4, unit: 'hours' }, grp: 'Store', next: 'Swatch Approval / GRN', can: () => can('store', 'edit') },
  { k: 'swatch', l: 'Swatch Approval', tat: { value: 8, unit: 'hours' }, grp: 'Merchant', next: 'GRN', can: r => isSuperAdmin() || (r && (r.owners || []).some(isMyMerchant)) || (r && !(r.owners || []).length && canApprove()) },
  { k: 'grn', l: 'GRN', tat: { value: 4, unit: 'hours' }, grp: 'Store', next: 'Stock / Excess Approval', can: () => can('store', 'edit') },
  { k: 'excess', l: 'Excess Approval', tat: { value: 8, unit: 'hours' }, grp: 'CEO', next: 'GRN report / stock', can: () => canApproveExcess() },
  { k: 'issuance', l: 'Issuance', tat: { value: 2, unit: 'hours' }, grp: 'Store', next: 'Issuance Approval', can: () => can('store', 'edit') },
  { k: 'issue_approval', l: 'Issuance Approval', tat: { value: 1, unit: 'hours' }, grp: 'Store Incharge', next: 'Production', can: () => canApproveIssue() },
  { k: 'rtv', l: 'RTV (Return to Vendor)', tat: { value: 7, unit: 'days' }, grp: 'Store', next: 'Debit note / vendor collection', can: () => can('store', 'edit') }
];
const paDef = k => PA_DEFS.find(d => d.k === k);
function paTat(k) { const t = (settings().act_tat || {})[k]; return t && t.value != null ? t : paDef(k).tat; }
const ts = x => x ? new Date(x) : null;
const latest = arr => arr.filter(Boolean).map(x => new Date(x)).sort((a, b) => b - a)[0] || null;

// All activity instances, done or pending
function paRows() {
  const R = [];
  const add = (k, o) => R.push(Object.assign({ k, act: paDef(k).l }, o));
  const jcs = Store.all('job_cards'); const pos = Store.all('purchase_orders').filter(p => !p.cancelled);
  // PO Raise: from job card creation until the first PO that carries any of its materials
  jcs.forEach(j => {
    const at = ts(j.at || j.created_at); if (!at) return;
    const mats = new Set((j.lines || []).map(l => norm(l.material)));
    const po = pos.filter(p => new Date(p.at || p.created_at || p.date) >= at && (p.lines || []).some(l => mats.has(norm(l.material)))).sort((a, b) => (a.at || a.created_at || '') < (b.at || b.created_at || '') ? -1 : 1)[0];
    const need = j.status !== 'Closed' && (j.lines || []).some(l => Math.max(0, num(l.required) - issuedToJc(j.no, l.material)) > stockOf(l.material) + 1e-9);
    if (po) add('po_raise', { ref: j.no, party: j.brand || '', start: at, actual: ts(po.at || po.created_at), by: po.created_by || '', result: po.no });
    else if (need) add('po_raise', { ref: j.no, party: j.brand || '', start: at });
  });
  pos.forEach(p => {
    const at = ts(p.at || p.created_at || p.date);
    const done = p.approval === 'Approved' || p.approval === 'Rejected';
    add('po_approval', { ref: p.no, party: p.vendor, start: at, actual: done ? ts(p.approved_at) : null, by: done ? p.approved_by : '', result: p.approval || '', owners: [] });
    if (p.approval === 'Approved') {
      const ins = Store.all('inwards').filter(i => norm(i.po_no) === norm(p.no)).sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
      const open = (p.lines || []).some(l => num(l.qty) - num(l.received) > 1e-9);
      const plan = p.expected ? new Date(p.expected + 'T18:00') : null;
      if (ins.length) add('inward', { ref: p.no, party: p.vendor, start: ts(p.approved_at), plan, actual: ts(ins[0].at), by: ins[0].by, result: ins[0].no });
      else if (open) add('inward', { ref: p.no, party: p.vendor, start: ts(p.approved_at), plan });
    }
  });
  Store.all('inwards').forEach(i => {
    const at = ts(i.at || i.date);
    const invDone = i.inv_status === 'Approved' || i.inv_status === 'Rejected';
    add('invoice', { ref: i.no, party: i.vendor, start: at, actual: invDone ? ts(i.inv_at) : null, by: invDone ? i.inv_by : '', result: i.inv_status || '' });
    if (i.inv_status !== 'Approved') return;
    (i.qc || []).forEach(q => {
      add('qc', { ref: i.no + ' · ' + q.material, party: i.vendor, start: ts(i.inv_at), actual: q.result ? ts(q.at) : null, by: q.result ? q.by : '', result: q.result || '' });
      if (q.result === 'Mismatch') add('swatch', { ref: i.no + ' · ' + q.material, party: i.vendor, start: ts(q.at), actual: q.m_status ? ts(q.m_at) : null, by: q.m_by || '', result: q.m_status || '', owners: q.merchants || [] });
    });
    const g = Store.all('grns').find(x => x.inward_id === i.id || norm(x.inward_no) === norm(i.no));
    const qcDone = (i.qc || []).every(q => q.result === 'Match' || (q.result === 'Mismatch' && q.m_status));
    if (g || (qcDone && i.status === 'Pending GRN')) {
      const ready = latest([i.inv_at].concat((i.qc || []).map(q => q.m_at || q.at)));
      add('grn', { ref: i.grn_no || i.no, party: i.vendor, start: ready, actual: g ? ts(g.at || g.date) : null, by: g ? g.by : '', result: g ? g.no : '' });
    }
  });
  Store.all('grns').forEach(g => (g.lines || []).forEach(l => {
    if (!(num(l.excess) > 0) || !l.excess_status) return;
    const done = l.excess_status === 'Approved' || l.excess_status === 'Rejected';
    add('excess', { ref: g.no + ' · ' + l.material, party: g.vendor, start: ts(g.at || g.date), actual: done ? ts(l.excess_at) : null, by: done ? l.excess_by : '', result: l.excess_status });
  }));
  Store.all('requisitions').forEach(r => {
    if (r.status === 'Rejected') return;
    const sent = Store.all('issues').filter(i => i.req_no === r.no && !i.type && i.status !== 'Amend' && i.status !== 'Rejected').sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
    const allSent = (r.lines || []).every(l => l.closed || reqSent(r.no, l.material) >= num(l.qty) - 1e-9);
    add('issuance', { ref: r.no, party: r.jc_no || r.dept || '', start: ts(r.at || r.date), actual: allSent && sent.length ? ts(sent[sent.length - 1].at) : null, by: sent.length ? sent[sent.length - 1].by : '', result: r.status });
  });
  Store.all('issues').filter(i => i.req_no && !i.type).forEach(i => {
    const done = i.status !== 'Pending';
    add('issue_approval', { ref: i.no, party: i.req_no, start: ts(i.at), actual: done ? ts(i.approved_at || i.decided_at) : null, by: i.approved_by || i.decided_by || '', result: i.status });
  });
  // RTV: rejected qty in a GRN goes back to the vendor (7-day collection); done when the returned qty covers it
  const retd = {};
  Store.all('rtvs').filter(x => !x.cancelled && (x.source || 'grn') === 'grn').sort((a, b) => (a.at || a.created_at || a.date || '') < (b.at || b.created_at || b.date || '') ? -1 : 1)
    .forEach(x => { const k = norm(x.vendor + '|' + x.material); (retd[k] = retd[k] || []).push({ qty: num(x.qty), at: x.at || x.created_at || (x.date + 'T12:00:00'), by: x.by, no: x.no }); });
  Store.all('grns').slice().sort((a, b) => (a.at || a.date || '') < (b.at || b.date || '') ? -1 : 1).forEach(g => (g.lines || []).forEach(l => {
    let need = num(l.rejected); if (!(need > 0)) return;
    const q = retd[norm(g.vendor + '|' + l.material)] || []; let last = null;
    while (need > 1e-9 && q.length) { const x = q[0]; const take = Math.min(need, x.qty); need -= take; x.qty -= take; last = x; if (x.qty <= 1e-9) q.shift(); }
    add('rtv', { ref: g.no + ' · ' + l.material, party: g.vendor, start: ts(g.at || g.date), actual: need <= 1e-9 && last ? ts(last.at) : null, by: need <= 1e-9 && last ? last.by : '', result: need <= 1e-9 && last ? last.no : '' });
  }));
  // planned / status / delay
  const cal = calInfo(); const now = new Date();
  R.forEach(r => {
    if (!r.start || isNaN(r.start)) { r.status = 'Waiting'; return; }
    r.planned = r.plan || cal.addTat(r.start, paTat(r.k));
    if (r.actual) { r.delay = r.actual > r.planned ? cal.workMinutesBetween(r.planned, r.actual) : 0; r.status = r.delay > 0 ? 'Done late' : 'Done on time'; }
    else { r.delay = now > r.planned ? cal.workMinutesBetween(r.planned, now) : 0; r.status = r.delay > 0 ? 'Late' : 'Pending'; }
  });
  return R;
}
const paOpen = r => r.status === 'Pending' || r.status === 'Late';
const paCls = s => s === 'Done on time' ? 'Done' : s === 'Done late' ? 'Pending' : s === 'Late' ? 'Late' : 'Waiting';

const PAX_UI = { tab: 'list', act: '', st: 'open', by: '' };
VIEWS.planactual = {
  mod: 'audit', render() {
    const U = PAX_UI; const all = paRows();
    const people = Array.from(new Set(all.map(r => r.by).filter(Boolean))).sort();
    let h = '<div class="tabs">' + [['list', 'Plan vs Actual'], ['sum', 'Summary'], ['tat', 'TAT']].map(([k, l]) => '<a data-act="pa-tab" data-t="' + k + '" class="' + (U.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';
    if (U.tab === 'list') {
      const rows = all.filter(r => (!U.act || r.k === U.act) && (!U.by || r.by === U.by) && (U.st === 'all' || (U.st === 'open' ? paOpen(r) : U.st === 'late' ? r.status === 'Late' || r.status === 'Done late' : r.status.startsWith('Done'))))
        .sort((a, b) => (b.delay || 0) - (a.delay || 0));
      h += '<div class="toolbar"><select id="paAct"><option value="">All activities</option>' + PA_DEFS.map(d => '<option value="' + d.k + '"' + (U.act === d.k ? ' selected' : '') + '>' + d.l + '</option>').join('') + '</select>' +
        '<select id="paSt">' + [['open', 'Open'], ['late', 'Late (open or done)'], ['done', 'Done'], ['all', 'All']].map(([v, l]) => '<option value="' + v + '"' + (U.st === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<select id="paBy"><option value="">Everyone</option>' + people.map(p => '<option' + (U.by === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '</select><span class="muted small">' + rows.length + ' record(s)</span><span class="grow"></span><button class="btn" data-act="pa-csv">Export CSV</button></div>';
      h += '<div class="tbl-wrap"><table><tr><th>Activity</th><th>Reference</th><th>Party</th><th>Responsible</th><th>Start</th><th>TAT</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th>Done By</th><th>Result</th></tr>' +
        (rows.length ? rows.map(r => '<tr><td>' + esc(r.act) + '</td><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party) + '</td><td>' + esc(paDef(r.k).grp) + '</td><td class="nowrap">' + fmtDT(r.start) + '</td><td class="nowrap">' + (r.plan ? 'PO expected date' : esc(paTat(r.k).value + ' ' + paTat(r.k).unit)) + '</td><td class="nowrap">' + fmtDT(r.planned) + '</td><td class="nowrap">' + (r.actual ? fmtDT(r.actual) : '') + '</td><td><span class="st ' + paCls(r.status) + '">' + r.status + '</span></td><td class="num' + (r.delay ? ' late-txt' : '') + '">' + (r.delay ? fmtDelay(r.delay) : '') + '</td><td>' + esc(r.by || '') + '</td><td>' + esc(r.result || '') + '</td></tr>').join('') : '<tr><td colspan="12" class="empty">Nothing here</td></tr>') + '</table></div>';
      VIEWS.planactual.rows = rows;
    } else if (U.tab === 'sum') {
      h += '<div class="tbl-wrap"><table class="nopage"><tr><th>Activity</th><th>Responsible</th><th>TAT</th><th class="num">Open</th><th class="num">Late (open)</th><th class="num">Done</th><th class="num">Done on time</th><th class="num">On-time %</th><th class="num">Avg delay</th></tr>' +
        PA_DEFS.map(d => {
          const rs = all.filter(r => r.k === d.k); const done = rs.filter(r => r.actual); const ok = done.filter(r => !r.delay); const late = rs.filter(r => r.status === 'Late');
          const avg = done.length ? done.reduce((a, r) => a + (r.delay || 0), 0) / done.length : 0;
          return '<tr><td>' + d.l + '</td><td>' + d.grp + '</td><td>' + esc(paTat(d.k).value + ' ' + paTat(d.k).unit) + '</td><td class="num">' + rs.filter(paOpen).length + '</td><td class="num' + (late.length ? ' late-txt' : '') + '">' + late.length + '</td><td class="num">' + done.length + '</td><td class="num">' + ok.length + '</td><td class="num">' + (done.length ? Math.round(ok.length * 100 / done.length) + '%' : '') + '</td><td class="num">' + (avg ? fmtDelay(Math.round(avg)) : '') + '</td></tr>';
        }).join('') + '</table></div>';
    } else {
      const edit = can('settings', 'edit');
      h += '<div class="tbl-wrap"><table class="nopage"><tr><th>Activity</th><th>Starts when</th><th class="num">TAT</th><th>Unit</th></tr>' +
        PA_DEFS.map(d => { const t = paTat(d.k); return '<tr><td>' + d.l + '</td><td>' + esc(PA_START[d.k]) + '</td><td><input class="qty right" type="number" min="0" step="any" data-pat="' + d.k + '" value="' + esc(t.value) + '"' + (edit ? '' : ' disabled') + '></td><td><select data-pau="' + d.k + '"' + (edit ? '' : ' disabled') + '><option value="hours">Working hours</option><option value="days"' + (t.unit === 'days' ? ' selected' : '') + '>Working days</option></select></td></tr>'; }).join('') + '</table></div>';
    }
    const m = setMain(h);
    m.addEventListener('change', e => {
      const t = e.target;
      const k = { paAct: 'act', paSt: 'st', paBy: 'by' }[t.id]; if (k) { U[k] = t.value; VIEWS.planactual.render(); return; }
      const key = t.dataset.pat || t.dataset.pau; if (!key || !requirePerm('settings', 'edit')) return;
      const st = settings(); st.act_tat = st.act_tat || {}; const cur = Object.assign({}, paTat(key));
      if (t.dataset.pat) cur.value = num(t.value); else cur.unit = t.value;
      st.act_tat[key] = cur; Store.setSettings(st); audit('settings.tat', paDef(key).l, cur.value + ' ' + cur.unit); flash('TAT saved.');
    });
  }
};
const PA_START = { rtv: 'GRN saved with rejected qty', po_raise: 'Job card created', po_approval: 'PO saved', inward: 'PO approved (plan = PO expected date)', invoice: 'Gate entry saved', qc: 'Invoice approved', swatch: 'QC mismatch', grn: 'Invoice, QC and swatch cleared', excess: 'GRN saved with excess', issuance: 'Requisition slip created', issue_approval: 'Items sent for issue approval' };
ACTIONS['pa-tab'] = el => { PAX_UI.tab = el.dataset.t; VIEWS.planactual.render(); };
ACTIONS['pa-csv'] = () => downloadCsv('plan-vs-actual-' + todayYmd() + '.csv', [['Activity', 'Reference', 'Party', 'Responsible', 'Start', 'Planned', 'Actual', 'Status', 'Delay (min)', 'Done By', 'Result']].concat((VIEWS.planactual.rows || []).map(r => [r.act, r.ref, r.party, paDef(r.k).grp, fmtDT(r.start), fmtDT(r.planned), r.actual ? fmtDT(r.actual) : '', r.status, r.delay || 0, r.by || '', r.result || ''])));

/* ---------- scoring: FMS steps + activities, last 30 days ---------- */
function fmsDoneRows(since) {
  const out = [];
  fmsDocs().forEach(o => {
    const r = resolveOrder(o); if (!r) return;
    r.order.forEach(id => { const s = r.steps[id]; if (!s.actual || new Date(s.actual) < since) return; out.push({ by: (o.done_by || {})[id] || '', late: (s.delayMinutes || 0) > 0, delay: s.delayMinutes || 0, what: s.name + ' · ' + o.no }); });
  });
  return out;
}
function scoreBoard() {
  const since = new Date(Date.now() - 30 * 86400000);
  const pa = paRows(); const fms = fmsDoneRows(since); const open = allOpenSteps();
  const users = Store.all('users').filter(u => u.active !== false);
  return users.map(u => {
    const mineDone = pa.filter(r => r.actual && r.actual >= since && r.by === u.name).map(r => ({ late: r.delay > 0 })).concat(fms.filter(x => x.by === u.name));
    const fOpen = open.filter(x => u.doer && norm(x.step.doer) === norm(u.doer));
    const onTime = mineDone.filter(x => !x.late).length;
    const lateOpen = fOpen.filter(x => x.step.status === 'Late').length;
    const score = mineDone.length ? Math.round(onTime * 100 / mineDone.length) : null;
    return { u, done: mineDone.length, onTime, pending: fOpen.length, lateOpen, score };
  }).filter(x => x.done || x.pending);
}
