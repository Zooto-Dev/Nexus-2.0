/* Nexus 2.0 — daily work screens: Home, My Tasks, Punch, Orders, Order, Dispatch, Tracker. */
'use strict';

function stepDoneBtn(o, s, def, spec) {
  if (isDispatchStep(def, spec)) return can('dispatch', 'edit') ? '<a href="#/dispatch">Dispatch →</a>' : '<span class="muted small">via Dispatch</span>';
  if (!canMarkStep(def, s, spec)) return '';
  return '<button class="btn sm primary" data-act="step-done" data-o="' + esc(o.id) + '" data-s="' + esc(s.id) + '">Done</button>';
}
ACTIONS['step-done'] = el => {
  const tr = el.closest('tr'); const note = tr && tr.querySelector('input[data-note]'); const nv = note ? note.value.trim() : '';
  const o = fmsGet(el.dataset.o); const r = o && resolveOrder(o); const def = r && r.spec.steps.find(x => x.id === el.dataset.s);
  if (!def || !def.capture) { markStepDone(el.dataset.o, el.dataset.s, nv); route(); return; }
  const f = (r.spec.fields || []).find(x => x.key === def.capture.field) || { label: def.capture.field, type: 'date' };
  const old = $('#capDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'capDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + esc(o.no) + ' · ' + esc(def.name) + '</div><table class="jckv"><tr><td class="k">' + esc(f.label) + ' *</td><td class="v">' + (f.options ? '<select id="capVal"><option value=""></option>' + f.options.filter(Boolean).map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' : '<input id="capVal" type="' + (f.type === 'datetime' ? 'datetime-local' : f.type === 'date' ? 'date' : 'text') + '" value="' + esc((o.extra || {})[def.capture.field] || '') + '">') + '</td></tr></table>' +
    '<div class="dlg-f"><span id="capMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-cap-x>Cancel</button><button class="btn primary" data-cap-ok>Done</button></div></div>';
  document.body.appendChild(d); $('#capVal').focus();
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-cap-x]')) { d.remove(); return; }
    if (!ev.target.closest('[data-cap-ok]')) return;
    const v = $('#capVal').value.trim(); if (!v) { $('#capMsg').textContent = 'Enter ' + f.label + '.'; return; }
    d.remove(); markStepDone(el.dataset.o, el.dataset.s, nv, v); route();
  });
};
function dueToday(s) { const d = s.planned; return d && ymdOf(d) === todayYmd(); }

/* ---------------- Home: one person's dashboard (Admin can pick anyone) ---------------- */
const HT_UI = { who: '', f: 'all', heldAll: false };
function personTasks(doer) {
  const now = new Date(), today = todayYmd(), since = new Date(Date.now() - 30 * 86400000), cal = calInfo();
  const late = (p, a) => { if (!p || !a || a <= p) return 0; try { return cal.workMinutesBetween(p, a); } catch (e) { return Math.round((a - p) / 60000); } };
  const openSt = p => p && p < now ? 'Delayed' : p && ymdOf(p) === today ? 'Pending' : 'Upcoming';
  const out = [];
  fmsDocs().forEach(o => {
    if (o.priority === 'Cancelled') return;
    const r = resolveOrder(o); if (!r) return;
    r.order.forEach(id => {
      const s = r.steps[id]; if (!s || norm(s.doer) !== norm(doer)) return;
      const def = r.spec.steps.find(x => x.id === id);
      const base = { task: s.name, ref: o.no, party: o.customer_name, src: 'FMS', planned: s.planned || null };
      if (s.status === 'Pending' || s.status === 'Late') out.push(Object.assign(base, { status: s.status === 'Late' ? 'Delayed' : openSt(s.planned), delay: s.status === 'Late' ? s.delayMinutes : 0, btn: stepDoneBtn(o, s, def, r.spec) }));
      else if (s.actual && new Date(s.actual) >= since) out.push(Object.assign(base, { status: 'Completed', done: new Date(s.actual), delay: s.delayMinutes || 0 }));
    });
  });
  Store.all('checklist').filter(t => t.active !== false && norm(t.doer) === norm(doer)).forEach(t => {
    const base = { task: t.title, ref: t.ref || (t.freq === 'Once' ? '' : t.freq), party: t.party || '', src: t.demo ? 'Demo' : 'Checklist', id: t.id };
    const canDo = isMyDoer(t.doer) || can('tracker', 'edit');
    if (t.freq === 'Once') {
      const p = t.planned ? new Date(t.planned) : t.due ? new Date(t.due + 'T18:00:00') : null;
      const doneAt = (t.done || {}).once ? new Date(t.done_at || String(t.done.once).split(' · ')[1] + 'T18:00:00') : null;
      if (doneAt) { if (doneAt >= since) out.push(Object.assign(base, { planned: p, status: 'Completed', done: doneAt, delay: late(p, doneAt) })); }
      else out.push(Object.assign(base, { planned: p, status: openSt(p), delay: p && p < now ? late(p, now) : 0, btn: canDo ? '<button class="btn sm primary" data-act="ht-done" data-id="' + esc(t.id) + '">Done</button>' : '' }));
    } else if ((t.done || {})[today]) out.push(Object.assign(base, { planned: new Date(today + 'T18:00:00'), status: 'Completed', done: new Date(t.done_at && t.done_at.slice(0, 10) === today ? t.done_at : today + 'T12:00:00'), delay: 0 }));
    else if (checklistDueToday(t)) { const p = new Date(today + 'T18:00:00'); out.push(Object.assign(base, { planned: p, status: openSt(p), delay: p < now ? late(p, now) : 0, btn: canDo ? '<button class="btn sm primary" data-act="ht-done" data-id="' + esc(t.id) + '">Done</button>' : '' })); }
  });
  return out;
}
function homeData(who) {
  const sa = isSuperAdmin(); const self = norm(who) === norm(ME.doer);
  const since = new Date(Date.now() - 30 * 86400000);
  const tasks = personTasks(who);
  const names = new Set(Store.all('users').filter(u => u.doer && norm(u.doer) === norm(who)).map(u => u.name));
  const pa = paRows();
  const paDone = pa.filter(r => r.actual && r.actual >= since && names.has(r.by));
  const paMine = self || sa ? pa.filter(r => paOpen(r) && (sa || paDef(r.k).can(r))) : [];
  const done = tasks.filter(t => t.status === 'Completed');
  const doneN = done.length + paDone.length, onTime = done.filter(t => !t.delay).length + paDone.filter(r => !(r.delay > 0)).length;
  const fmsNext = {};
  allOpenSteps().forEach(x => { if (norm(x.step.doer) === norm(who)) fmsNext[x.order.no + '|' + x.step.name] = nextStepsOf(x); });
  const held = tasks.filter(t => t.status === 'Delayed').map(t => ({ what: t.task, ref: t.ref, party: t.party, planned: t.planned, delay: t.delay, waits: t.src === 'FMS' ? fmsNext[t.ref + '|' + t.task] || '' : '' }))
    .concat(paMine.filter(r => r.status === 'Late').map(r => ({ what: r.act, ref: r.ref, party: r.party, planned: r.planned, delay: r.delay, waits: paDef(r.k).next })))
    .sort((a, b) => b.delay - a.delay);
  const tickets = Store.all('tickets').filter(ticketEscalated);
  const esc8 = allOpenSteps().filter(x => x.step.status === 'Late' && x.step.delayMinutes > 8 * 60 && (sa && self ? true : norm(x.step.doer) === norm(who)));
  return { tasks, done, doneN, onTime, score: doneN ? Math.round(onTime * 100 / doneN) : null, held, tickets, esc8, open: paMine.filter(r => r.status === 'Pending').sort((a, b) => a.planned - b.planned) };
}
function homeTaskTable(tasks) {
  const order = { Delayed: 0, Pending: 1, Upcoming: 2, Completed: 3 };
  const list = tasks.filter(t => HT_UI.f === 'all' || t.status === HT_UI.f).sort((a, b) => order[a.status] - order[b.status] ||
    (a.status === 'Delayed' ? b.delay - a.delay : a.status === 'Completed' ? b.done - a.done : (a.planned || 0) - (b.planned || 0)));
  const cls = { Delayed: 'Late', Pending: 'Pending', Upcoming: 'Waiting', Completed: 'Done' };
  const n = k => k === 'all' ? tasks.length : tasks.filter(t => t.status === k).length;
  return '<div class="dcard"><div class="dh3">My tasks<span class="grow"></span>' +
    seg('htf', ['all', 'Delayed', 'Pending', 'Upcoming', 'Completed'].map(k => ({ v: k, l: (k === 'all' ? 'All' : k) + ' ' + n(k) })), HT_UI.f) + '</div>' +
    '<div class="tbl-wrap"><table><tr><th class="num">#</th><th>Task</th><th>Reference</th><th>Party</th><th>Planned</th><th>Completed</th><th>Status</th><th class="num">Delay</th><th></th></tr>' +
    (list.length ? list.map((t, i) => '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(t.task) + '<div class="muted small">' + esc(t.src) + '</div></td><td><b>' + esc(t.ref || '') + '</b></td><td>' + esc(t.party || '') + '</td><td class="nowrap">' + (t.planned ? fmtDT(t.planned) : '') + '</td><td class="nowrap">' + (t.done ? fmtDT(t.done) : '') + '</td>' +
      '<td><span class="st ' + cls[t.status] + '">' + t.status + '</span></td><td class="num' + (t.delay ? ' late-txt' : '') + '">' + (t.delay ? fmtDelay(t.delay) : '') + '</td><td class="right">' + (t.btn || '') + '</td></tr>').join('')
      : '<tr><td colspan="9" class="empty">No tasks</td></tr>') + '</table></div></div>';
}
VIEWS.home = {
  mod: 'dashboard', render() {
    const pick = isAdminRole() || can('tracker', 'view');
    if (!HT_UI.who || !pick) HT_UI.who = ME.doer || '';
    const who = HT_UI.who; const self = norm(who) === norm(ME.doer); const sa = isSuperAdmin();
    const doers = Array.from(new Set(Store.all('users').filter(u => u.active !== false && u.doer).map(u => u.doer).concat(who ? [who] : []))).sort();
    const D = homeData(who); const T = D.tasks;
    const cnt = k => T.filter(t => t.status === k).length;
    const person = self ? ME.name : (Store.all('users').find(u => norm(u.doer) === norm(who)) || {}).name || who;

    // header
    let h = '<div class="dhd"><div><h1>Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening') + ', ' + esc(ME.name.split(' ')[0]) + '</h1><div class="muted small">' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + esc(settings().company || '') + '</div></div><span class="grow"></span>' +
      (pick ? '<label class="small muted">Showing <select id="htWho">' + doers.map(d => '<option' + (norm(d) === norm(who) ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select></label>' : '') +
      (sa && Store.all('checklist').some(t => t.demo) ? '<button class="btn sm danger" data-act="ht-demo-del" data-confirm="Remove all demo tasks?">Remove demo tasks</button>' : '') + '</div>';

    // summary cards
    const ring = D.score == null ? '—' : D.score + '%';
    const ringCol = D.score == null ? 'var(--line)' : D.score >= 90 ? 'var(--done)' : D.score >= 70 ? 'var(--pending)' : 'var(--late)';
    const card = (f, v, l, sub, cls) => '<a class="dk-c' + (HT_UI.f === f ? ' on' : '') + '" data-act="ht-f" data-f="' + f + '"><span class="l">' + l + '</span><span class="v ' + (cls || '') + '">' + v + '</span><span class="s">' + sub + '</span></a>';
    h += '<div class="dk">' +
      '<div class="dk-c dk-score"><div class="ring" style="background:conic-gradient(' + ringCol + ' ' + (D.score || 0) + '%, var(--line2) 0)"><b>' + ring + '</b></div><div><span class="l">Score · 30 days</span><span class="s">' + D.onTime + ' of ' + D.doneN + ' done on time</span></div></div>' +
      card('Delayed', cnt('Delayed'), 'Delayed', 'past planned time', 'late-txt') +
      card('Pending', cnt('Pending'), 'Pending today', 'due before tonight', 'pend-txt') +
      card('Upcoming', cnt('Upcoming'), 'Upcoming', 'planned later', '') +
      card('Completed', cnt('Completed'), 'Completed', 'last 30 days', 'done-txt') +
      '<a class="dk-c" data-act="ht-held"><span class="l">Held up</span><span class="v ' + (D.held.length ? 'late-txt' : '') + '">' + D.held.length + '</span><span class="s">others waiting on ' + (self ? 'you' : esc(who)) + '</span></a></div>';

    // main grid: tasks | score, held up, escalations
    h += '<div class="dgrid"><div>' + homeTaskTable(T) + '</div><div>';
    const tot = T.length || 1; const seg4 = [['Delayed', 'var(--late)'], ['Pending', 'var(--pending)'], ['Upcoming', 'var(--accent)'], ['Completed', 'var(--done)']];
    h += '<div class="dcard"><div class="dh3">Task mix<span class="grow"></span><span class="muted small">' + T.length + ' tasks</span></div><div class="dbar">' +
      seg4.map(([k, c]) => cnt(k) ? '<i style="width:' + (cnt(k) * 100 / tot) + '%;background:' + c + '" title="' + k + ' ' + cnt(k) + '"></i>' : '').join('') + '</div><div class="dleg">' +
      seg4.map(([k, c]) => '<span><i style="background:' + c + '"></i>' + k + ' <b>' + cnt(k) + '</b></span>').join('') + '</div></div>';
    const heldShow = HT_UI.heldAll ? D.held : D.held.slice(0, 6);
    h += '<div class="dcard" id="heldCard"><div class="dh3">' + (self ? 'Held up because of me' : 'Held up because of ' + esc(person)) + '<span class="n">' + D.held.length + '</span></div>' +
      (D.held.length ? heldShow.map(x => '<div class="dl"><div><div class="t">' + esc(x.what) + '</div><div class="m">' + esc([x.ref, x.party].filter(Boolean).join(' · ')) + (x.waits ? ' · waiting: ' + esc(x.waits) : '') + '</div><div class="m">Planned ' + fmtDT(x.planned) + '</div></div><div class="d">' + fmtDelay(x.delay) + '</div></div>').join('') +
        (D.held.length > 6 ? '<div class="dl-more"><a data-act="ht-held-all">' + (HT_UI.heldAll ? 'Show less' : 'Show all ' + D.held.length) + '</a></div>' : '') : '<div class="dl-empty">Nothing is held up</div>') + '</div>';
    const escN = D.tickets.length + D.esc8.length;
    h += '<div class="dcard"><div class="dh3">Escalations<span class="n' + (escN ? ' red' : '') + '">' + escN + '</span></div>' +
      (escN ? D.tickets.slice(0, 5).map(t => '<a class="dl" href="#/tickets"><div><div class="t">' + esc(t.subject) + '</div><div class="m">Ticket ' + esc(t.no) + ' · ' + esc(t.dept) + ' · ' + esc(t.by) + '</div></div><div class="d">' + Math.floor((Date.now() - new Date(t.at)) / 3600000) + 'h</div></a>').join('') +
        D.esc8.slice(0, 5).map(x => '<a class="dl" href="#/order/' + esc(x.order.id) + '"><div><div class="t">' + esc(x.step.name) + '</div><div class="m">' + esc(x.order.no) + ' · ' + esc(x.order.customer_name) + ' · ' + esc(x.step.doer || '') + '</div></div><div class="d">' + fmtDelay(x.step.delayMinutes) + '</div></a>').join('') : '<div class="dl-empty">No escalations</div>') + '</div>';
    h += '</div></div>';

    // open activities (purchase / store / approvals)
    if (self || sa) h += '<div class="dcard"><div class="dh3">' + (sa ? 'Open activities (everyone)' : 'My open activities') + '<span class="n">' + D.open.length + '</span></div><div class="tbl-wrap"><table><tr><th>Activity</th><th>Reference</th><th>Party</th><th>Responsible</th><th>Planned</th><th>Status</th></tr>' +
      (D.open.length ? D.open.slice(0, 60).map(r => '<tr><td>' + esc(r.act) + '</td><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party) + '</td><td>' + esc(paDef(r.k).grp) + '</td><td class="nowrap">' + fmtDT(r.planned) + '</td><td><span class="st Pending">Pending</span></td></tr>').join('') : '<tr><td colspan="6" class="empty">Nothing open</td></tr>') + '</table></div></div>';

    // company overview for Admin
    if (isAdminRole()) {
      const orders = Store.all('orders'); const openOrders = orders.map(o => ({ o, st: orderState(o) })).filter(x => x.st.open);
      const late = allOpenSteps().filter(x => x.step.status === 'Late');
      const pos = openPOs(); const poOver = pos.filter(p => p.expected && p.expected < todayYmd());
      const reqs = Store.all('requisitions').filter(r => r.status === 'Pending');
      const swPend = Store.all('job_cards').filter(j => j.swatch_status === 'Pending' && j.status !== 'Closed');
      const jcCorr = Store.all('job_cards').filter(j => (j.corrections || []).some(c => !c.resolved));
      const smPend = Store.all('inwards').filter(i => i.status === 'Pending GRN' && i.inv_status === 'Approved' && (i.qc || []).some(q => !q.result));
      const payPend = Store.all('dispatches').filter(d => !d.cancelled && d.payment !== 'Received');
      const month = todayYmd().slice(0, 7);
      const dspQty = Store.all('dispatches').filter(d => !d.cancelled && (d.date || '').startsWith(month)).reduce((s2, d) => s2 + d.lines.reduce((a2, l) => a2 + num(l.qty), 0), 0);
      h += '<div class="dsec">Company</div><div class="dk dk-co">' +
        '<a class="dk-c" href="#/orders"><span class="l">Open orders</span><span class="v">' + openOrders.length + '</span></a>' +
        '<a class="dk-c" href="#/orders/late"><span class="l">Late steps</span><span class="v ' + (late.length ? 'late-txt' : '') + '">' + late.length + '</span></a>' +
        '<a class="dk-c" href="#/dispatch"><span class="l">Ready to dispatch</span><span class="v">' + readyForDispatch().length + '</span></a>' +
        '<div class="dk-c"><span class="l">Dispatched this month</span><span class="v">' + qtyFmt(dspQty) + '</span></div>' +
        '<a class="dk-c" href="#/tickets"><span class="l">Open tickets</span><span class="v">' + Store.all('tickets').filter(t => t.status !== 'Closed').length + '</span></a></div>';
      const dep = (name, view, items) => '<tr class="click" data-act="go" data-v="' + view + '"><td><b>' + name + '</b></td>' + [0, 1].map(k => items[k] ? '<td>' + esc(items[k][0]) + '</td><td class="num' + (items[k][2] ? ' late-txt' : '') + '">' + items[k][1] + '</td>' : '<td></td><td></td>').join('') + '</tr>';
      const byDoer = {}; late.forEach(x => { const k = x.step.doer || '—'; const b2 = byDoer[k] || (byDoer[k] = { n: 0, d: 0 }); b2.n++; b2.d += x.step.delayMinutes; });
      const lateRows = Object.entries(byDoer).sort((a2, b2) => b2[1].n - a2[1].n);
      const stage = {}; openOrders.forEach(x => { stage[x.st.label] = (stage[x.st.label] || 0) + 1; });
      h += '<div class="grid2"><div class="dcard"><div class="dh3">Departments</div><div class="tbl-wrap"><table class="nopage"><tr><th>Department</th><th>Item</th><th class="num">Count</th><th>Item</th><th class="num">Count</th></tr>' +
        dep('Purchase', 'purchasedash', [['open PO', pos.length, false], ['overdue', poOver.length, poOver.length > 0]]) +
        dep('Merchant', 'swatch', [['swatch pending', swPend.length, false], ['corrections', jcCorr.length, jcCorr.length > 0]]) +
        dep('Store', 'issuance', [['req to issue', reqs.length, false], ['QC pending', smPend.length, false]]) +
        dep('Production', 'prodtracker', [['orders in flow', openOrders.length, false], ['late steps', late.length, late.length > 0]]) +
        dep('Accounts', 'invoices', [['payment pending', payPend.length, false]]) +
        dep('Dispatch', 'dispatch', [['ready', readyForDispatch().length, false]]) + '</table></div></div>' +
        '<div class="dcard"><div class="dh3">Late by doer</div><div class="tbl-wrap"><table class="nopage"><tr><th>Doer</th><th class="num">Late</th><th class="num">Avg delay</th></tr>' +
        (lateRows.length ? lateRows.map(([k, b2]) => '<tr><td>' + esc(k) + '</td><td class="num late-txt">' + b2.n + '</td><td class="num">' + fmtDelay(Math.round(b2.d / b2.n)) + '</td></tr>').join('') : '<tr><td colspan="3" class="empty">Nothing late</td></tr>') + '</table></div>' +
        '<div class="dh3" style="border-top:1px solid var(--line2)">Open orders by stage</div><div class="tbl-wrap"><table class="nopage"><tr><th>Stage</th><th class="num">Orders</th></tr>' +
        (Object.keys(stage).length ? Object.entries(stage).sort((a2, b2) => b2[1] - a2[1]).map(([k, n2]) => '<tr><td>' + esc(k) + '</td><td class="num">' + n2 + '</td></tr>').join('') : '<tr><td colspan="2" class="empty">No open orders</td></tr>') + '</table></div></div></div>';
      if (sa) {
        const board = scoreBoard();
        h += '<div class="dcard"><div class="dh3">People score · last 30 days</div><div class="tbl-wrap"><table><tr><th>Name</th><th>Doer</th><th>Department</th><th>Designation</th><th class="num">Done</th><th class="num">On time</th><th class="num">Score</th><th class="num">Open tasks</th><th class="num">Late tasks</th></tr>' +
          (board.length ? board.sort((a2, b2) => (a2.score == null ? 101 : a2.score) - (b2.score == null ? 101 : b2.score)).map(b2 => '<tr class="click" data-act="ht-who" data-d="' + esc(b2.u.doer || '') + '"><td>' + esc(b2.u.name) + '</td><td>' + esc(b2.u.doer || '') + '</td><td>' + esc(b2.u.department || '') + '</td><td>' + esc(b2.u.designation || '') + '</td><td class="num">' + b2.done + '</td><td class="num">' + b2.onTime + '</td><td class="num' + (b2.score != null && b2.score < 80 ? ' late-txt' : '') + '"><b>' + (b2.score == null ? '—' : b2.score + '%') + '</b></td><td class="num">' + b2.pending + '</td><td class="num' + (b2.lateOpen ? ' late-txt' : '') + '">' + b2.lateOpen + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No activity yet</td></tr>') + '</table></div></div>';
      }
    }
    const m = setMain(h);
    const w = $('#htWho'); if (w) w.addEventListener('change', () => { HT_UI.who = w.value; HT_UI.heldAll = false; VIEWS.home.render(); });
    onSeg(e => { if (e.target.dataset.seg === 'htf') { HT_UI.f = e.detail; VIEWS.home.render(); } });
    return m;
  }
};
ACTIONS['ht-f'] = el => { HT_UI.f = HT_UI.f === el.dataset.f ? 'all' : el.dataset.f; VIEWS.home.render(); };
ACTIONS['ht-held'] = () => { const c = $('#heldCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
ACTIONS['ht-held-all'] = () => { HT_UI.heldAll = !HT_UI.heldAll; VIEWS.home.render(); const c = $('#heldCard'); if (c) c.scrollIntoView({ block: 'start' }); };
ACTIONS['ht-who'] = el => { if (!el.dataset.d) return; HT_UI.who = el.dataset.d; HT_UI.f = 'all'; VIEWS.home.render(); window.scrollTo(0, 0); };
ACTIONS['ht-done'] = el => {
  const t = Store.get('checklist', el.dataset.id); if (!t) return;
  if (!(isMyDoer(t.doer) || can('tracker', 'edit'))) { flash('Only ' + esc(t.doer) + ' can mark this done.', 'err'); return; }
  t.done = t.done || {};
  if (t.freq === 'Once') t.done.once = ME.name + ' · ' + todayYmd(); else t.done[todayYmd()] = ME.name;
  t.done_at = nowIso(); Store.put('checklist', t); audit('checklist.done', t.title, t.doer); renderNav(); VIEWS.home.render();
};
ACTIONS['ht-demo-del'] = () => {
  if (!isSuperAdmin()) return;
  const d = Store.all('checklist').filter(t => t.demo); d.forEach(t => Store.del('checklist', t.id));
  audit('checklist.demo_removed', String(d.length), ''); flash(d.length + ' demo tasks removed.'); VIEWS.home.render();
};

function nextStepsOf(x) {
  const deps = (x.spec.steps || []).filter(d => (Array.isArray(d.trigger) ? d.trigger : [d.trigger]).some(t => t && t.type === 'afterStep' && t.step === x.step.id));
  return deps.map(d => d.name).join(', ');
}

/* ---------------- My Tasks ---------------- */
const TASK_UI = { who: 'mine', when: 'open', q: '' };
function taskTable(list, compact) {
  if (!list.length) return '<div class="tbl-wrap"><div class="empty">No open tasks</div></div>';
  return '<div class="tbl-wrap"><table class="bomflat"><tr><th>Order</th><th>Brand</th><th>Priority</th><th>Step</th>' + (compact ? '' : '<th>Doer</th>') + '<th>Planned</th><th>Status</th><th class="num">Delay</th>' + (compact ? '' : '<th>Note</th>') + '<th></th></tr>' +
    list.map(x => '<tr><td><a href="#/order/' + esc(x.order.id) + '">' + esc(x.order.no) + '</a></td><td>' + esc(x.order.customer_name) + '</td><td>' + (x.order.priority === 'Urgent' ? '<span class="late-txt">Urgent</span>' : esc(x.order.priority || '')) + '</td>' +
      '<td>' + esc(x.step.name) + '</td>' + (compact ? '' : '<td>' + esc(x.step.doer || '') + '</td>') +
      '<td class="nowrap">' + fmtDT(x.step.planned) + '</td><td>' + stHtml(x.step.status) + '</td><td class="num late-txt">' + fmtDelay(x.step.delayMinutes) + '</td>' +
      (compact ? '' : '<td><input data-note placeholder="optional" style="min-width:120px"></td>') + '<td class="right">' + stepDoneBtn(x.order, x.step, x.def, x.spec) + '</td></tr>').join('') + '</table></div>';
}
VIEWS.tasks = {
  mod: 'tasks', render() {
    const all = can('tracker', 'view');
    if (!all) TASK_UI.who = 'mine';
    let list = allOpenSteps();
    if (TASK_UI.who === 'mine') list = list.filter(x => isMyDoer(x.step.doer));
    if (TASK_UI.when === 'late') list = list.filter(x => x.step.status === 'Late');
    if (TASK_UI.when === 'today') list = list.filter(x => dueToday(x.step) || x.step.status === 'Late');
    const q = norm(TASK_UI.q); if (q) list = list.filter(x => norm(x.order.no + ' ' + x.order.customer_name + ' ' + x.step.name + ' ' + x.step.doer).includes(q));
    setMain('<div class="toolbar">' + (all ? seg('who', [{ v: 'mine', l: 'Mine (' + esc(ME.doer || '-') + ')' }, { v: 'all', l: 'Everyone' }], TASK_UI.who) : '') +
      seg('when', [{ v: 'open', l: 'All open' }, { v: 'today', l: 'Today + late' }, { v: 'late', l: 'Late' }], TASK_UI.when) +
      '<input id="taskQ" placeholder="Filter…" value="' + esc(TASK_UI.q) + '"><span class="muted small">' + list.length + ' task(s)</span></div>' + taskTable(list, false));
    onSeg(e => { TASK_UI[e.target.dataset.seg] = e.detail; VIEWS.tasks.render(); });
    $('#taskQ').addEventListener('input', e => { TASK_UI.q = e.target.value; clearTimeout(TASK_UI.t); TASK_UI.t = setTimeout(() => { VIEWS.tasks.render(); const i = $('#taskQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

/* ---------------- Punch order ---------------- */
const CORE_FIELDS = ['created_at', 'order_no', 'order_date', 'brand', 'buyer_po', 'po_expiry_date', 'tooling_no', 'channel', 'category', 'priority', 'qty'];
function GENDERS_() { return optList('gender'); }
function PACKS_() { return optList('packing'); }
let PUNCH = null;
function blankLine() { return { article: '', style: '', colour: '', gender: '', size_run: '', sizes: [], qty: 0, pack: '', pack_qty: '' }; }
// "6-10" / "6X10" -> [6..10]; "S,M,L" -> list; single -> [value]
function parseSizeRun(str) {
  const t = String(str || '').trim().replace(/\s+/g, '');
  if (!t) return [];
  const m = t.match(/^(\d+)[xX×\-](\d+)$/);
  if (m) { const a = +m[1], b = +m[2]; if (b >= a && b - a <= 30) { const out = []; for (let k = a; k <= b; k++) out.push(String(k)); return out; } }
  if (t.includes(',')) return t.split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  return [t.toUpperCase()];
}
function jcNoBase() {
  let max = 0;
  const scan = no => { if (no && String(no).startsWith('ZF-')) max = Math.max(max, parseInt(String(no).slice(3), 10) || 0); };
  Store.all('job_cards').forEach(j => scan(j.no));
  Store.all('orders').forEach(o => (o.lines || []).forEach(l => scan(l.jc_no)));
  return max;
}
function lineQty(l) { return (l.sizes && l.sizes.length) ? l.sizes.reduce((a, x) => a + num(x.qty), 0) : num(l.qty); }
function sizeSummary(l) { return (l.sizes && l.sizes.length) ? l.sizes.filter(x => num(x.qty) > 0).map(x => x.size + ':' + qtyFmt(x.qty)).join(' · ') : (l.size || ''); }
function newPunch(order) {
  PUNCH = order ? clone(order) : { id: null, order_date: todayYmd(), brand: '', customer_id: '', buyer_po: '', po_expiry_date: '', tooling_no: '', channel: '', category: '', priority: '', remarks: '', extra: {}, lines: [] };
  if (!PUNCH.lines.length || PUNCH.lines[PUNCH.lines.length - 1].article) PUNCH.lines.push(blankLine());
}
function fieldOptions(key) { const p = activeProcess(); const f = p && p.spec.fields.find(x => x.key === key); return f && f.options ? f.options.filter(o => o !== '') : []; }
function lineSel(f, opts, val) { return '<select data-f="' + f + '"><option value=""></option>' + opts.map(o => '<option' + (norm(o) === norm(val || '') ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>'; }
VIEWS.punch = {
  mod: 'orders', edit: true, render(param) {
    if (param) { const o = Store.get('orders', param); if (!o) return go('orders'); if (dispatchedQty(o).total > 0) { flash('Dispatched orders cannot be edited.', 'err'); return go('order', o.id); } if (!PUNCH || PUNCH.id !== o.id) newPunch(o); }
    else if (!PUNCH || PUNCH.id) newPunch();
    const proc = activeProcess();
    if (!proc) { setMain('<div class="panel">No active FMS flow. Activate one in FMS Builder first.</div>'); return; }
    const extra = proc.spec.fields.filter(f => f.source === 'form' && !CORE_FIELDS.includes(f.key));
    const P = PUNCH;
    let h = (P.id ? '<h1>Edit ' + esc(P.no) + '</h1>' : '') + '<div class="panel punch">';

    h += '<datalist id="dlArt">' + Store.all('items').map(i => '<option value="' + esc(i.code) + '">' + esc(i.name + ' · ' + (i.group || '')) + '</option>').join('') + '</datalist>';
    h += '<div class="hdr">' +
      '<label>Order date<input id="pDate" type="date" value="' + esc(P.order_date) + '"></label>' +
      '<label>Brand *<select id="pBrand">' + selOpts(Store.all('customers').map(c => c.name).sort(), P.brand || P.customer_name) + '</select></label>' +
      '<label>Buyer PO no *<input id="pPo" value="' + esc(P.buyer_po) + '"></label>' +
      '<label>PO expiry date *<input id="pExp" type="date" value="' + esc(P.po_expiry_date) + '"></label>' +
      '<label>Tooling / Mould no<input id="pTool" value="' + esc(P.tooling_no) + '"></label>' +
      '<label>Category *<select id="pCat">' + selOpts(optList('category'), P.category) + '</select></label>' +
      '<label>Channel *<select id="pChan">' + selOpts(optList('channel'), P.channel) + '</select></label>' +
      '<label>Priority' + seg('priority', [{ v: '', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }], P.priority === 'Urgent' ? 'Urgent' : '') + '</label>' +
      '<label>Remarks<input id="pRem" value="' + esc(P.remarks) + '"></label>' +
      extra.map(f => '<label>' + esc(f.label) + (f.options && f.options.length <= 4 ? seg('x_' + f.key, f.options, (P.extra || {})[f.key]) :
        '<input data-extra="' + esc(f.key) + '" type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" value="' + esc((P.extra || {})[f.key]) + '"' + (f.options ? ' list="dl_' + esc(f.key) + '"' : '') + '>' + (f.options ? '<datalist id="dl_' + esc(f.key) + '">' + f.options.map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>' : '')) + '</label>').join('') +
      '</div>';
    h += '<table class="lines"><tr><th style="width:28px">#</th><th style="width:110px">Article</th><th>Style</th><th style="width:100px">Colour</th><th style="width:95px">Gender</th><th style="width:95px">Size Run</th><th class="num" style="width:80px">Total Qty</th><th style="width:115px">Packing</th><th style="width:170px">Asst/Solid Qty</th><th style="width:30px"></th></tr>' +
      P.lines.map((l, i) => {
        let row = '<tr data-i="' + i + '"><td class="muted">' + (i + 1) + '</td>' +
          '<td><input data-f="article" list="dlArt" value="' + esc(l.article) + '" autocomplete="off"></td>' +
          '<td><input data-f="style" value="' + esc(l.style) + '"></td>' +
          '<td><input data-f="colour" value="' + esc(l.colour) + '"></td>' +
          '<td>' + lineSel('gender', GENDERS_(), l.gender) + '</td>' +
          '<td><input data-f="size_run" placeholder="6-10" value="' + esc(l.size_run || l.size || '') + '" title="Enter size run (6-10 or 6X10)"></td>' +
          '<td class="num"><b data-lq>' + (lineQty(l) ? qtyFmt(lineQty(l)) : '') + '</b></td>' +
          '<td>' + lineSel('pack', PACKS_(), l.pack) + '</td>' +
          '<td class="small" data-lsum>' + (l.sizes && l.sizes.length && !l._szo
            ? '<a data-act="punch-sz-toggle" data-i="' + i + '" title="Edit size-wise qty">' + esc(sizeSummary(l) || 'sizes') + ' ✎</a>'
            : '<span class="muted">' + esc(sizeSummary(l)) + '</span>') + '</td>' +
          '<td><button class="btn ghost sm" data-act="punch-del" data-i="' + i + '" title="Remove">×</button></td></tr>';
        // size-wise entry row: open while entering; collapses once done so the next article is safe to type
        if (l.sizes && l.sizes.length && !l._szo) return row;
        row += '<tr class="szrow" data-sz-for="' + i + '"><td></td><td colspan="9">' +
          ((l.sizes && l.sizes.length) ? '<div class="szgrid"><span class="muted small" style="align-self:center">Asst/Solid Qty \u2014 size-wise:</span>' +
            l.sizes.map((sz, k) => '<span class="szbox"><input data-szl data-i="' + i + '" data-k="' + k + '" value="' + esc(sz.size) + '" title="Size"><input type="number" min="0" data-szq data-i="' + i + '" data-k="' + k + '" value="' + (sz.qty || '') + '" placeholder="qty" title="Qty for size ' + esc(sz.size) + '"></span>').join('') +
            '<a data-act="punch-size-add" data-i="' + i + '" class="small">+ size</a>' +
            '<button class="btn sm" data-act="punch-sz-done" data-i="' + i + '">Done ✓</button></div>'
            : '') + '</td></tr>';
        return row;
      }).join('') +
      '<tr><td></td><td colspan="4"><a data-act="punch-add">+ Add article</a></td><td></td><td class="num"><b id="pTq"></b></td><td></td><td></td><td></td></tr></table>';
    h += '<div class="toolbar" style="margin:12px 0 0"><button class="btn primary" data-save data-act="punch-save">' + (P.id ? 'Save changes' : 'Save order') + '</button>' +
      (P.id ? '<a href="#/order/' + esc(P.id) + '" data-act="punch-cancel">Cancel</a>' : '<a data-act="punch-clear">Clear</a>') + '<span id="pMsg" class="small"></span></div></div>';
    const m = setMain(h);
    punchTotals();
    m.addEventListener('input', e => {
      if (e.target.dataset.szq != null) { const l = PUNCH.lines[+e.target.dataset.i]; l.sizes[+e.target.dataset.k].qty = num(e.target.value); const tr = $('tr[data-i="' + e.target.dataset.i + '"]'); $('[data-lq]', tr).textContent = lineQty(l) ? qtyFmt(lineQty(l)) : ''; const sm = $('[data-lsum]', tr); if (sm) sm.textContent = sizeSummary(l); punchTotals(); }
      if (e.target.dataset.szl != null) { PUNCH.lines[+e.target.dataset.i].sizes[+e.target.dataset.k].size = e.target.value.trim().toUpperCase(); }
    });
    m.addEventListener('change', e => {
      punchLineChange(e);
      if (e.target.dataset.f === 'size_run') {
        punchCollect();
        const i = +e.target.closest('tr').dataset.i; const l = PUNCH.lines[i];
        const run = parseSizeRun(e.target.value);
        if (l._szo && l.sizes && l.sizes.length === run.length && run.every((szn, k) => norm(l.sizes[k].size) === norm(szn))) return; // same run fired again — skip re-render
        l.size_run = e.target.value.trim().toUpperCase();
        l.sizes = run.map(szn => { const ex = (l.sizes || []).find(x => norm(x.size) === norm(szn)); return { size: szn, qty: ex ? ex.qty : '' }; });
        l._szo = true;
        VIEWS.punch.render(PUNCH.id);
        const first = $('tr[data-sz-for="' + i + '"] [data-szq]'); if (first) first.focus();
      }
    });
    m.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.dataset.szq != null) {
        e.preventDefault();
        const boxes = $$('[data-szq][data-i="' + e.target.dataset.i + '"]'); const at = boxes.indexOf(e.target);
        if (at < boxes.length - 1) return boxes[at + 1].focus();
        // last size box done: close this line's size grid and move to the next article
        const i2 = +e.target.dataset.i;
        punchCollect(); PUNCH.lines[i2]._szo = false;
        if (i2 === PUNCH.lines.length - 1) PUNCH.lines.push(blankLine());
        VIEWS.punch.render(PUNCH.id);
        const nx = $('tr[data-i="' + (i2 + 1) + '"] [data-f="article"]'); if (nx) nx.focus();
        return;
      }
      if (!e.target.dataset.f) return;
      e.preventDefault(); punchCollect();
      const tr = e.target.closest('tr'); const i = +tr.dataset.i;
      if (e.target.dataset.f === 'size_run') { e.target.dispatchEvent(new Event('change', { bubbles: true })); return; }
      const flat = $$('[data-f]', tr); const at = flat.indexOf(e.target);
      if (at < flat.length - 1) return flat[at + 1].focus();
      if (i === PUNCH.lines.length - 1) { PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); }
      const next = $('tr[data-i="' + (i + 1) + '"] [data-f="article"]'); if (next) next.focus();
    });
    if (!P.brand && !P.customer_name) $('#pBrand').focus();
  }
};
function punchLineChange(e) {
  if (e.target.dataset.f !== 'article') return;
  const tr = e.target.closest('tr[data-i]'); const v = e.target.value.trim();
  const it = Store.all('items').find(x => norm(x.code) === norm(v) || norm(x.name) === norm(v));
  if (!it) return;
  e.target.value = it.code;
  const st = $('[data-f="style"]', tr); if (!st.value) st.value = it.name || '';
  const g = $('[data-f="gender"]', tr); if (!g.value && it.gender) g.value = it.gender;
  const cat = $('#pCat');
  if (cat && !cat.value && it.group && optList('category').some(x => norm(x) === norm(it.group))) cat.value = it.group;
}
function punchTotals() { const q = (PUNCH.lines || []).reduce((a, l) => a + lineQty(l), 0); if ($('#pTq')) $('#pTq').textContent = q ? qtyFmt(q) : ''; }
function punchCollect() {
  const P = PUNCH;
  P.order_date = $('#pDate').value; P.buyer_po = $('#pPo').value.trim();
  P.po_expiry_date = $('#pExp').value; P.tooling_no = $('#pTool').value.trim(); P.remarks = $('#pRem').value.trim();
  P.brand = $('#pBrand').value; P.category = $('#pCat').value; P.channel = $('#pChan').value;
  const pr = segVal($('[data-seg="priority"]')); if (!P.id || P.priority === '' || P.priority === 'Urgent') P.priority = pr;
  P.extra = P.extra || {};
  $$('[data-extra]').forEach(i => P.extra[i.dataset.extra] = i.value.trim());
  $$('[data-seg^="x_"]').forEach(sg => P.extra[sg.dataset.seg.slice(2)] = segVal(sg));
  $$('tr[data-i]').forEach(tr => {
    const l = P.lines[+tr.dataset.i]; if (!l) return;
    const g = f => { const el = $('[data-f="' + f + '"]', tr); return el ? el.value.trim() : ''; };
    l.article = g('article').toUpperCase(); l.style = g('style'); l.colour = g('colour'); l.gender = g('gender');
    l.size_run = g('size_run').toUpperCase(); l.pack = g('pack');
    l.sizes = (l.sizes || []).filter(x => String(x.size).trim() !== '');
    l.qty = lineQty(l);
  });
}
ACTIONS['punch-add'] = () => { punchCollect(); PUNCH.lines.forEach(l => { l._szo = false; }); PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); $('tr[data-i="' + (PUNCH.lines.length - 1) + '"] input').focus(); };
ACTIONS['punch-sz-done'] = el => { punchCollect(); PUNCH.lines[+el.dataset.i]._szo = false; VIEWS.punch.render(PUNCH.id); };
ACTIONS['punch-sz-toggle'] = el => { punchCollect(); const l = PUNCH.lines[+el.dataset.i]; l._szo = !l._szo; VIEWS.punch.render(PUNCH.id); const f = $('tr[data-sz-for="' + el.dataset.i + '"] [data-szq]'); if (f) f.focus(); };
ACTIONS['punch-size-add'] = el => { punchCollect(); const l = PUNCH.lines[+el.dataset.i]; l.sizes = l.sizes || []; l.sizes.push({ size: '', qty: '' }); VIEWS.punch.render(PUNCH.id); const boxes = $$('[data-szl][data-i="' + el.dataset.i + '"]'); if (boxes.length) boxes[boxes.length - 1].focus(); };
ACTIONS['punch-del'] = el => { punchCollect(); PUNCH.lines.splice(+el.dataset.i, 1); if (!PUNCH.lines.length) PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); };
ACTIONS['punch-clear'] = () => { newPunch(); VIEWS.punch.render(); };
ACTIONS['punch-cancel'] = el => { PUNCH = null; go('order', el.getAttribute('href').split('/').pop()); };
ACTIONS['punch-save'] = () => {
  if (!requirePerm('orders', 'edit')) return;
  punchCollect(); const P = PUNCH; const errs = [];
  const lines = P.lines.filter(l => l.article || lineQty(l) > 0);
  if (!P.brand) errs.push('brand');
  if (!P.buyer_po) errs.push('buyer PO no');
  if (!P.po_expiry_date) errs.push('PO expiry date');
  if (!P.category) errs.push('category');
  if (!P.channel) errs.push('channel');
  if (!lines.length) errs.push('at least one article row');
  lines.forEach((l, i) => {
    if (!l.article) errs.push('row ' + (i + 1) + ': article');
    if (!(l.sizes && l.sizes.some(x => num(x.qty) > 0))) errs.push('row ' + (i + 1) + ': enter size-wise qty (Size Run, e.g. 6-10)');
    const dupSz = (l.sizes || []).map(x => norm(x.size)).filter((c, k, a) => c && a.indexOf(c) !== k);
    if (dupSz.length) errs.push('row ' + (i + 1) + ': duplicate size "' + dupSz[0] + '"');
  });
  // Merge rows with the same article+colour+packing; size-wise qty is summed
  const key = l => norm(l.article + '|' + l.colour + '|' + l.pack);
  const merged = [];
  let mergedNote = false;
  lines.forEach(l => {
    const ex = merged.find(x => key(x) === key(l));
    if (!ex) { merged.push(Object.assign({}, l, { sizes: (l.sizes || []).map(x => ({ size: x.size, qty: num(x.qty) })) })); return; }
    mergedNote = true;
    (l.sizes || []).forEach(x => { const e2 = ex.sizes.find(y => norm(y.size) === norm(x.size)); if (e2) e2.qty += num(x.qty); else ex.sizes.push({ size: x.size, qty: num(x.qty) }); });
  });
  lines.length = 0; merged.forEach(l => { l.qty = lineQty(l); lines.push(l); });
  if (errs.length) { $('#pMsg').innerHTML = '<span class="late-txt">Missing / wrong: ' + esc(errs.join(', ')) + '</span>'; return; }
  const cu = Store.all('customers').find(c => norm(c.name) === norm(P.brand));
  if (!cu) { $('#pMsg').innerHTML = '<span class="late-txt">Brand is not in the list — add it in Merchant → Brands first.</span>'; return; }
  lines.forEach(l => { if (l.article && !Store.all('items').some(x => norm(x.code) === norm(l.article))) Store.put('items', { id: uid(), code: l.article, name: l.style, group: P.category, gender: l.gender }); });
  const o = P.id ? Store.get('orders', P.id) : { id: uid(), no: '', process_id: activeProcess().id, actuals: {}, done_by: {}, created_at: nowIso(), created_by: ME.name };
  Object.assign(o, { order_date: P.order_date, customer_id: cu.id, customer_name: cu.name, brand: cu.name, buyer_po: P.buyer_po, po_expiry_date: P.po_expiry_date, tooling_no: P.tooling_no, channel: P.channel, category: P.category, priority: P.priority, remarks: P.remarks, extra: P.extra, lines: lines.map(l => ({ article: l.article, style: l.style, colour: l.colour, gender: l.gender, size_run: l.size_run, size: l.size_run, sizes: (l.sizes || []).filter(x => num(x.qty) > 0).map(x => ({ size: x.size, qty: num(x.qty) })), qty: lineQty(l), pack: l.pack, jc_no: l.jc_no || '' })) });
  // Auto-assign a Job Card No (ZF-xxxx) to each article line that lacks one
  let jcSeq = jcNoBase();
  o.lines.forEach(l => { if (!l.jc_no) { jcSeq += 1; l.jc_no = 'ZF-' + String(jcSeq).padStart(4, '0'); } });
  o.no = o.lines[0].jc_no;   // the Job Card No is the order number
  Store.put('orders', o);
  audit(P.id ? 'order.edit' : 'order.create', o.no, cu.name + ' · PO ' + P.buyer_po + ' · ' + qtyFmt(orderTotals(o).qty) + ' qty');
  if (P.id) { PUNCH = null; flash('Saved ' + esc(o.no) + '.'); go('order', o.id); return; }
  if (mergedNote) flash('Rows with the same article/colour/packing were merged.');
  newPunch(); VIEWS.punch.render();
  flash('Saved <b>' + esc(o.no) + '</b> — FMS started. <a href="#/order/' + esc(o.id) + '">Open</a> · punch the next order below.');
};

/* ---------------- Orders list ---------------- */
const ORD_UI = { f: 'open', q: '' };
VIEWS.orders = {
  mod: 'orders', render(param) {
    if (param === 'late') ORD_UI.f = 'late'; else if (param) { ORD_UI.q = param; ORD_UI.f = 'all'; }
    const q = norm(ORD_UI.q);
    const rows = Store.all('orders').slice().sort((a, b) => b.created_at < a.created_at ? -1 : 1).map(o => ({ o, st: orderState(o), t: orderTotals(o), d: dispatchedQty(o) })).filter(x => {
      if (q && !norm(x.o.no + ' ' + x.o.customer_name + ' ' + x.o.buyer_po + ' ' + x.o.tooling_no + ' ' + (x.o.lines || []).map(l => l.article + ' ' + l.style + ' ' + l.colour).join(' ')).includes(q)) return false;
      switch (ORD_UI.f) {
        case 'open': return x.st.open; case 'late': return x.st.open && x.st.late > 0; case 'hold': return x.o.priority === 'On Hold';
        case 'done': return x.st.label === 'Dispatched'; case 'cancel': return x.o.priority === 'Cancelled'; default: return true;
      }
    });
    let h = '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open' }, { v: 'late', l: 'Late' }, { v: 'hold', l: 'On hold' }, { v: 'done', l: 'Dispatched' }, { v: 'cancel', l: 'Cancelled' }, { v: 'all', l: 'All' }], ORD_UI.f) +
      '<input id="ordQ" placeholder="Order no / brand / PO / article / JC\u2026" value="' + esc(ORD_UI.q) + '"><span class="muted small">' + rows.length + ' order(s)</span><span class="grow"></span>' +
      '<button class="btn" data-act="orders-csv">Export CSV</button>' + (can('orders', 'edit') ? '<a class="btn primary" href="#/punch">+ Punch order</a>' : '') + '</div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Time Stamp</th><th>Job Card No.</th><th>Order Date</th><th>Tooling/Mould No</th><th>Buyer PO NO</th><th>Po Expiry Date</th><th>Brand</th><th>Article</th><th>Style</th><th>Colour</th><th>Gender</th><th class="num">Qty</th><th>Channel</th><th>Size</th><th>Category</th><th>Packing Assortment/Solid</th><th>Assortment Qty /Solid Qty</th><th>Priority</th></tr>' +
      (rows.length ? rows.flatMap(x => (x.o.lines || []).map((l, li) => '<tr class="click' + (li === 0 ? ' bomfirst' : '') + '" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '">' +
        '<td>' + fmtDT(x.o.created_at) + '</td><td><b>' + esc(l.jc_no || '') + '</b></td><td>' + fmtD(x.o.order_date) + '</td><td>' + esc(x.o.tooling_no || '') + '</td><td>' + esc(x.o.buyer_po || '') + '</td><td>' + fmtD(x.o.po_expiry_date) + '</td><td>' + esc(x.o.customer_name) + '</td>' +
        '<td><b>' + esc(l.article) + '</b></td><td>' + esc(l.style || '') + '</td><td>' + esc(l.colour || '') + '</td><td>' + esc(l.gender || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td>' + esc(x.o.channel || '') + '</td><td>' + esc(l.size_run || l.size || '') + '</td><td>' + esc(x.o.category || '') + '</td>' +
        '<td>' + esc(l.pack || '') + '</td><td>' + esc(sizeSummary(l)) + '</td><td>' + esc(x.o.priority || '') + '</td></tr>')).join('') :
        '<tr><td colspan="18" class="empty">No orders</td></tr>') + '</table></div>';
    setMain(h); VIEWS.orders.rows = rows;
    onSeg(e => { ORD_UI.f = e.detail; VIEWS.orders.render(); });
    $('#ordQ').addEventListener('input', e => { ORD_UI.q = e.target.value; clearTimeout(ORD_UI.t); ORD_UI.t = setTimeout(() => { VIEWS.orders.render(); const i = $('#ordQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click();
}
ACTIONS['orders-csv'] = () => downloadCsv('orders-' + todayYmd() + '.csv',
  [['Time Stamp', 'Job Card No.', 'Order Date', 'Tooling/Mould No', 'Buyer PO No', 'PO Expiry Date', 'Brand', 'Article', 'Style', 'Colour', 'Gender', 'Qty', 'Channel', 'Size', 'Category', 'Packing Assortment/Solid', 'Assortment Qty /Solid Qty', 'Dispatched', 'Current step']]
  .concat((VIEWS.orders.rows || []).flatMap(x => (x.o.lines || []).map(l => [fmtDT(x.o.created_at), l.jc_no || '', x.o.order_date, x.o.tooling_no, x.o.buyer_po, x.o.po_expiry_date, x.o.customer_name, l.article, l.style, l.colour, l.gender, l.qty, x.o.channel, l.size_run || l.size || '', x.o.category, l.pack, sizeSummary(l), x.d.total, x.st.label]))));

/* ---------------- Order page ---------------- */
VIEWS.order = {
  mod: 'orders', render(id) {
    const o = Store.get('orders', id); if (!o && Store.get('samples', id)) return go('sample', id); if (!o) { setMain('<div class="panel empty">Order not found.</div>'); return; }
    const r = resolveOrder(o); const t = orderTotals(o); const d = dispatchedQty(o); const st = orderState(o);
    const proc = Store.get('processes', o.process_id);
    let h = '<div class="toolbar"><h1 style="margin:0">' + esc(o.no) + ' · ' + esc(o.customer_name) + '</h1>' + stHtml(st.label).replace('st ' + stCls(st.label), 'st ' + st.cls) + '<span class="grow"></span>' +
      (can('orders', 'edit') && !d.total ? '<a class="btn" href="#/punch/' + esc(o.id) + '">Edit</a>' : '') + '<button class="btn" data-act="print">Print</button></div>';
    if (can('orders', 'edit') && st.label !== 'Dispatched') h += '<div class="toolbar noprint"><span class="muted small">Priority</span>' + seg('opri', [{ v: '', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }, { v: 'On Hold', l: 'On Hold' }, { v: 'Cancelled', l: 'Cancel order' }], o.priority || '') + '</div>';
    h += '<div class="grid2"><div>';
    h += '<div class="panel"><table class="kv">' + [['Time stamp', fmtDT(o.created_at)], ['Order date', fmtD(o.order_date)], ['Buyer PO no', o.buyer_po], ['PO expiry date', fmtD(o.po_expiry_date)], ['Tooling / Mould no', o.tooling_no], ['Category', o.category], ['Channel', o.channel], ['Priority', o.priority || 'Normal'], ['Remarks', o.remarks], ['Punched by', o.created_by], ['FMS flow', proc ? proc.name + ' v' + proc.version : '—']]
      .concat(Object.entries(o.extra || {}).filter(e => e[1]).map(([k, v]) => { const f = proc && proc.spec.fields.find(x => x.key === k); return [f ? f.label : k, v]; }))
      .map(([k, v]) => '<tr><td class="muted" style="width:140px">' + esc(k) + '</td><td>' + esc(v) + '</td></tr>').join('') + '</table></div>';
    h += '<h2>Articles</h2><div class="tbl-wrap"><table class="bomflat"><tr><th>Article</th><th>Style</th><th>Colour</th><th>Gender</th><th>Size</th><th>Packing</th><th>Asst/Solid Qty</th><th>Job Card No.</th><th class="num">Ordered</th><th class="num">Dispatched</th><th class="num">Pending</th></tr>' +
      o.lines.map((l, i) => '<tr><td><b>' + esc(l.article) + '</b></td><td>' + esc(l.style) + '</td><td>' + esc(l.colour) + '</td><td>' + esc(l.gender) + '</td><td>' + esc(l.size_run || l.size || '') + '</td><td>' + esc(l.pack) + '</td><td class="small">' + esc(sizeSummary(l)) + '</td><td class="nowrap"><b>' + esc(l.jc_no || '') + '</b></td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + qtyFmt(d.per[i]) + '</td><td class="num">' + qtyFmt(Math.max(0, l.qty - d.per[i])) + '</td></tr>').join('') +
      '<tr><td><b>Total</b></td><td colspan="7"></td><td class="num"><b>' + qtyFmt(t.qty) + '</b></td><td class="num">' + qtyFmt(d.total) + '</td><td class="num">' + qtyFmt(d.pending) + '</td></tr></table></div>';
    const dsp = Store.all('dispatches').filter(x => x.order_id === o.id);
    if (dsp.length) h += '<h2>Dispatches</h2><div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th class="num">Qty</th><th>Invoice</th><th>Vehicle</th><th>Transporter</th><th>LR</th><th>Status</th></tr>' +
      dsp.map(x => '<tr' + (x.cancelled ? ' class="muted"' : '') + '><td>' + esc(x.no) + '</td><td>' + fmtD(x.date) + '</td><td class="num">' + qtyFmt(x.lines.reduce((s, l) => s + num(l.qty), 0)) + '</td><td>' + esc(x.invoice_no) + '</td><td>' + esc(x.vehicle) + '</td><td>' + esc(x.transporter) + '</td><td>' + esc(x.lr_no) + '</td><td>' + (x.cancelled ? 'Cancelled' : 'Dispatched') + '</td></tr>').join('') + '</table></div>';
    h += '</div><div><h2 style="margin-top:0">FMS timeline</h2>';
    if (!r) h += '<div class="panel">Flow not found for this order.</div>';
    else {
      h += '<div class="tbl-wrap"><table class="tl bomflat"><tr><th>Step</th><th>Doer</th><th>Done By</th><th>Note</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th></th></tr>' +
        r.order.map(sid => {
          const s = r.steps[sid]; const def = r.spec.steps.find(x => x.id === sid);
          if (s.status === 'N/A') return '<tr class="muted"><td>' + esc(s.name) + '</td><td></td><td></td><td></td><td></td><td></td><td>N/A</td><td></td><td></td></tr>';
          const act = s.status === 'Pending' || s.status === 'Late' ? stepDoneBtn(o, s, def, r.spec) :
            (s.status === 'Done' && !isDispatchStep(def, r.spec) && (can('tracker', 'edit')) ? '<button class="btn sm ghost" data-act="undo-step" data-o="' + esc(o.id) + '" data-s="' + esc(sid) + '" data-confirm="Undo?">Undo</button>' : '');
          const note = (o.notes || {})[sid]; const by = (o.done_by || {})[sid];
          return '<tr class="' + (st.cur && st.cur.id === sid ? 'cur' : '') + '"><td>' + esc(s.name) + '</td><td>' + esc(s.doer || '') + '</td><td>' + (by && by !== 'seed' ? esc(by) : '') + '</td><td>' + esc(note || '') + '</td><td class="nowrap">' + fmtDT(s.planned) + '</td><td class="nowrap">' + fmtDT(s.actual) + '</td><td>' + stHtml(s.status) + '</td><td class="num late-txt">' + fmtDelay(s.delayMinutes) + '</td><td class="right">' + act + '</td></tr>';
        }).join('') + '</table></div>';
    }
    h += '</div></div>';
    setMain(h);
    const sp = $('[data-seg="opri"]');
    if (sp) sp.addEventListener('segchange', e => {
      const old = o.priority || ''; o.priority = e.detail; Store.put('orders', o);
      audit('order.priority', o.no, (old || 'Normal') + ' → ' + (e.detail || 'Normal')); flash(esc(o.no) + ' priority: ' + esc(e.detail || 'Normal')); route();
    });
  }
};
ACTIONS['print'] = () => window.print();

/* ---------------- Dispatch ---------------- */
function readyForDispatch() {
  return Store.all('orders').filter(o => {
    if (o.priority === 'Cancelled' || o.priority === 'On Hold') return false;
    const r = resolveOrder(o); if (!r) return false; const end = r.spec.process.endStep; const s = r.steps[end];
    return s && (s.status === 'Pending' || s.status === 'Late') && dispatchedQty(o).pending > 0;
  });
}
const DSP_UI = { tab: 'ready', open: null };
VIEWS.dispatch = {
  mod: 'dispatch', render(param) {
    if (['ready', 'upcoming', 'history'].includes(param)) { DSP_UI.tab = param; DSP_UI.open = null; }
    const edit = can('dispatch', 'edit');
    let h = '<div class="tabs">' + [['ready', 'Ready (' + readyForDispatch().length + ')'], ['upcoming', 'Upcoming'], ['history', 'History']].map(([k, l]) => '<a data-act="dsp-tab" data-t="' + k + '" class="' + (DSP_UI.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';
    if (DSP_UI.tab === 'ready') {
      const list = readyForDispatch().sort((a, b) => resolveOrder(a).steps[resolveOrder(a).spec.process.endStep].planned - resolveOrder(b).steps[resolveOrder(b).spec.process.endStep].planned);
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Order</th><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th>Size</th><th class="num">Order Qty</th><th class="num">Dispatched</th><th class="num">Pending</th><th>PO Expiry</th><th>Dispatch Due</th><th>Status</th><th class="num">Delay</th><th></th></tr>' +
        (list.length ? list.map(o => {
          const r = resolveOrder(o); const s = r.steps[r.spec.process.endStep]; const d = dispatchedQty(o);
          let row = o.lines.map((l, i) => '<tr' + (i === 0 ? ' class="bomfirst"' : '') + '><td><a href="#/order/' + esc(o.id) + '">' + esc(o.no) + '</a></td><td>' + esc(l.jc_no || '') + '</td><td>' + esc(o.customer_name) + '</td><td>' + esc(l.article) + '</td><td>' + esc(l.colour || '') + '</td><td>' + esc(l.size_run || l.size || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td class="num">' + qtyFmt(d.per[i] || 0) + '</td><td class="num">' + qtyFmt(Math.max(0, l.qty - (d.per[i] || 0))) + '</td><td>' + fmtD(o.po_expiry_date) + '</td><td>' + fmtDT(s.planned) + '</td><td>' + stHtml(s.status) + '</td><td class="num late-txt">' + fmtDelay(s.delayMinutes) + '</td><td class="right">' + (i === 0 && edit ? '<button class="btn sm ' + (DSP_UI.open === o.id ? '' : 'primary') + '" data-act="dsp-open" data-o="' + esc(o.id) + '">' + (DSP_UI.open === o.id ? 'Close' : 'Dispatch') + '</button>' : '') + '</td></tr>').join('');
          if (DSP_UI.open === o.id) row += '<tr class="inline-form"><td colspan="14">' + dispatchForm(o, d) + '</td></tr>';
          return row;
        }).join('') : '<tr><td colspan="14" class="empty">No orders ready</td></tr>') + '</table></div>';
    } else if (DSP_UI.tab === 'upcoming') {
      const list = Store.all('orders').map(o => ({ o, st: orderState(o) })).filter(x => x.st.open && !readyForDispatch().includes(x.o) && x.o.priority !== 'Cancelled');
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Order</th><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th>Size</th><th class="num">Qty</th><th>PO Expiry</th><th>Current Step</th></tr>' +
        (list.length ? list.map(x => x.o.lines.map((l, i) => '<tr class="click' + (i === 0 ? ' bomfirst' : '') + '" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td>' + esc(x.o.no) + '</td><td>' + esc(l.jc_no || '') + '</td><td>' + esc(x.o.customer_name) + '</td><td>' + esc(l.article) + '</td><td>' + esc(l.colour || '') + '</td><td>' + esc(l.size_run || l.size || '') + '</td><td class="num">' + qtyFmt(l.qty) + '</td><td>' + fmtD(x.o.po_expiry_date) + '</td><td><span class="st ' + x.st.cls + '">' + esc(x.st.label) + '</span></td></tr>').join('')).join('') : '<tr><td colspan="9" class="empty">No upcoming orders</td></tr>') + '</table></div>';
    } else {
      const list = Store.all('dispatches').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
      h += '<div class="toolbar"><button class="btn" data-act="dsp-csv">Export CSV</button></div><div class="tbl-wrap"><table class="bomflat"><tr><th>Dispatch No</th><th>Date</th><th>Order</th><th>JC No</th><th>Brand</th><th>Article</th><th>Colour</th><th class="num">Qty</th><th>Invoice</th><th>Vehicle</th><th>Transporter</th><th>LR</th><th>By</th><th>Status</th><th></th></tr>' +
        (list.length ? list.map(x => { const o = Store.get('orders', x.order_id) || { lines: [] }; return x.lines.map((dl, i) => { const l = o.lines[dl.idx] || {}; return '<tr class="' + (i === 0 ? 'bomfirst' : '') + (x.cancelled ? ' muted' : '') + '"><td>' + esc(x.no) + '</td><td>' + fmtD(x.date) + '</td><td><a href="#/order/' + esc(x.order_id) + '">' + esc(o.no || '') + '</a></td><td>' + esc(l.jc_no || '') + '</td><td>' + esc(o.customer_name || '') + '</td><td>' + esc(l.article || '') + '</td><td>' + esc(l.colour || '') + '</td><td class="num">' + qtyFmt(dl.qty) + '</td><td>' + esc(x.invoice_no) + '</td><td>' + esc(x.vehicle) + '</td><td>' + esc(x.transporter) + '</td><td>' + esc(x.lr_no) + '</td><td>' + esc(x.by) + '</td><td>' + (x.cancelled ? '<span class="late-txt">Cancelled</span>' : 'Dispatched') + '</td><td>' + (i === 0 && edit && !x.cancelled ? '<button class="btn sm ghost danger" data-act="dsp-cancel" data-d="' + esc(x.id) + '" data-confirm="Confirm cancel">Cancel</button>' : '') + '</td></tr>'; }).join(''); }).join('') : '<tr><td colspan="15" class="empty">No dispatches yet</td></tr>') + '</table></div>';
      VIEWS.dispatch.hist = list;
    }
    setMain(h);
  }
};
function dispatchForm(o, d) {
  return '<div style="padding:6px 4px"><table class="bomflat" style="margin-bottom:8px"><tr><th>JC No</th><th>Article</th><th>Style</th><th>Colour</th><th>Size</th><th class="num">Pending</th><th class="num">Dispatch now</th></tr>' +
    o.lines.map((l, i) => { const p = Math.max(0, l.qty - d.per[i]); return '<tr><td>' + esc(l.jc_no || '') + '</td><td>' + esc(l.article) + '</td><td>' + esc(l.style || '') + '</td><td>' + esc(l.colour || '') + '</td><td>' + esc(l.size_run || l.size || '') + '</td><td class="num">' + qtyFmt(p) + '</td><td class="num"><input class="qty" type="number" min="0" max="' + p + '" step="any" data-dq="' + i + '" value="' + p + '"' + (p ? '' : ' disabled') + '></td></tr>'; }).join('') + '</table>' +
    '<div class="row"><label>Invoice no *<input id="dInv"></label><label>Vehicle no<input id="dVeh"></label><label>Transporter<input id="dTr" list="dlTr"></label><label>LR / Docket no<input id="dLr"></label><label>Date<input id="dDate" type="date" value="' + todayYmd() + '"></label>' +
    '<datalist id="dlTr">' + Array.from(new Set(Store.all('dispatches').map(x => x.transporter).filter(Boolean))).map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<button class="btn primary" data-save data-act="dsp-save" data-o="' + esc(o.id) + '">Save dispatch</button><span id="dMsg" class="small"></span></div></div>';
}
ACTIONS['dsp-tab'] = el => { DSP_UI.tab = el.dataset.t; DSP_UI.open = null; VIEWS.dispatch.render(); };
ACTIONS['dsp-open'] = el => { DSP_UI.open = DSP_UI.open === el.dataset.o ? null : el.dataset.o; VIEWS.dispatch.render(); const i = $('#dInv'); if (i) i.focus(); };
ACTIONS['dsp-save'] = el => {
  if (!requirePerm('dispatch', 'edit')) return;
  const o = Store.get('orders', el.dataset.o); const d = dispatchedQty(o);
  const lines = $$('[data-dq]').map(i => ({ idx: +i.dataset.dq, qty: num(i.value) })).filter(l => l.qty > 0);
  const inv = $('#dInv').value.trim();
  const over = lines.find(l => l.qty > o.lines[l.idx].qty - d.per[l.idx] + 1e-9);
  const err = !inv ? 'Invoice no is required.' : !lines.length ? 'Enter qty to dispatch.' : over ? 'Qty more than pending for ' + o.lines[over.idx].article + '.' : '';
  if (err) { $('#dMsg').innerHTML = '<span class="late-txt">' + esc(err) + '</span>'; return; }
  const rec = Store.put('dispatches', { id: uid(), no: nextNo('dispatches', 'DSP'), order_id: o.id, date: $('#dDate').value || todayYmd(), lines, invoice_no: inv, vehicle: $('#dVeh').value.trim(), transporter: $('#dTr').value.trim(), lr_no: $('#dLr').value.trim(), by: ME.name, at: nowIso() });
  const after = dispatchedQty(o); const r = resolveOrder(o); const end = r.spec.process.endStep;
  if (after.pending <= 0) { o.actuals = o.actuals || {}; o.actuals[end] = nowIso(); o.done_by = o.done_by || {}; o.done_by[end] = ME.name; Store.put('orders', o); }
  audit('dispatch.create', o.no, rec.no + ' · ' + qtyFmt(lines.reduce((s, l) => s + l.qty, 0)) + ' qty · inv ' + inv);
  DSP_UI.open = null; flash(esc(rec.no) + ' saved for ' + esc(o.no) + (after.pending > 0 ? ' — ' + qtyFmt(after.pending) + ' still pending (part dispatch).' : ' — order fully dispatched, FMS closed.'));
  VIEWS.dispatch.render();
};
ACTIONS['dsp-cancel'] = el => {
  const x = Store.get('dispatches', el.dataset.d); const o = Store.get('orders', x.order_id);
  x.cancelled = true; x.cancelled_by = ME.name; Store.put('dispatches', x);
  const r = resolveOrder(o); const end = r.spec.process.endStep;
  if (o.actuals && o.actuals[end] && dispatchedQty(o).pending > 0) { delete o.actuals[end]; Store.put('orders', o); }
  audit('dispatch.cancel', o.no, x.no); flash(esc(x.no) + ' cancelled.'); VIEWS.dispatch.render();
};
ACTIONS['dsp-csv'] = () => downloadCsv('dispatches-' + todayYmd() + '.csv', [['No', 'Date', 'Order', 'Customer', 'Qty', 'Invoice', 'Vehicle', 'Transporter', 'LR', 'By', 'Cancelled']]
  .concat((VIEWS.dispatch.hist || []).map(x => { const o = Store.get('orders', x.order_id) || {}; return [x.no, x.date, o.no, o.customer_name, x.lines.reduce((s, l) => s + num(l.qty), 0), x.invoice_no, x.vehicle, x.transporter, x.lr_no, x.by, x.cancelled ? 'Yes' : '']; })));

/* ---------------- Tracker (FMS grid) ---------------- */
const TRK_UI = { f: 'open', q: '', pid: null };
VIEWS.tracker = {
  mod: 'tracker', render(param) {
    if (param) { const pr = Store.all('processes').find(p => p.code === param && p.active); if (pr) TRK_UI.pid = pr.id; }
    const procs = Store.all('processes').filter(p => fmsDocs().some(o => o.process_id === p.id) || p.active).sort((a, b) => a.code === b.code ? b.version - a.version : a.code < b.code ? -1 : 1);
    if (!TRK_UI.pid || !procs.some(p => p.id === TRK_UI.pid)) TRK_UI.pid = (activeProcess() || procs[0] || {}).id;
    const proc = Store.get('processes', TRK_UI.pid); if (!proc) { setMain('<div class="panel empty">No flow yet.</div>'); return; }
    const q = norm(TRK_UI.q);
    const orders = fmsDocs().filter(o => o.process_id === proc.id).sort((a, b) => b.created_at < a.created_at ? -1 : 1)
      .filter(o => (TRK_UI.f === 'all' || orderState(o).open) && (!q || norm(o.no + ' ' + o.customer_name).includes(q)));
    let h = '<div class="toolbar">' + (procs.length > 1 ? seg('pid', procs.map(p => ({ v: p.id, l: p.name + ' v' + p.version + (p.active ? ' (active)' : '') })), TRK_UI.pid) : '<span class="muted small">' + esc(proc.name) + ' v' + proc.version + '</span>') +
      seg('f', [{ v: 'open', l: 'Open orders' }, { v: 'all', l: 'All' }], TRK_UI.f) + '<input id="trkQ" placeholder="Filter…" value="' + esc(TRK_UI.q) + '"><span class="muted small">' + orders.length + ' order(s)</span></div>';
    const steps = FMSEngine.topoOrder(proc.spec).map(id => proc.spec.steps.find(s => s.id === id));
    h += '<div class="tbl-wrap" style="max-height:75vh"><table class="trk"><tr><th rowspan="2">Order</th><th rowspan="2">Brand</th>' + steps.map(s => '<th colspan="3" class="c">' + esc(s.name) + '</th>').join('') + '</tr><tr>' + steps.map(() => '<th>Planned</th><th>Actual</th><th class="num">Delay</th>').join('') + '</tr>' +
      (orders.length ? orders.map(o => {
        const r = resolveOrder(o);
        return '<tr class="click" data-act="go" data-v="order" data-p="' + esc(o.id) + '"><td><b>' + esc(o.no) + '</b></td><td>' + esc(o.customer_name) + '</td>' + steps.map(sd => {
          const s = r.steps[sd.id]; const c = 'cell c-' + stCls(s.status);
          if (s.status === 'N/A') return '<td class="' + c + '">N/A</td><td class="' + c + '"></td><td class="' + c + '"></td>';
          return '<td class="' + c + '">' + (s.planned ? fmtDT(s.planned) : '') + '</td><td class="' + c + '">' + (s.actual ? fmtDT(s.actual) : '') + '</td><td class="num ' + c + (s.delayMinutes ? ' late-txt' : '') + '">' + (s.delayMinutes ? fmtDelay(s.delayMinutes) : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (steps.length * 3 + 2) + '" class="empty">No orders</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { TRK_UI[e.target.dataset.seg] = e.detail; VIEWS.tracker.render(); });
    $('#trkQ').addEventListener('input', e => { TRK_UI.q = e.target.value; clearTimeout(TRK_UI.t); TRK_UI.t = setTimeout(() => { VIEWS.tracker.render(); const i = $('#trkQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

/* ---------------- global search ---------------- */
document.addEventListener('keydown', e => {
  if (e.target.id !== 'gsearch' || e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) return;
  const hit = Store.all('orders').find(o => norm(o.no) === norm(q) || norm(o.no).endsWith('-' + norm(q).padStart(4, '0')) || (o.lines || []).some(l => norm(l.jc_no) === norm(q)));
  e.target.value = ''; e.target.blur();
  if (hit) go('order', hit.id); else { ORD_UI.q = q; ORD_UI.f = 'all'; go('orders', q); }
});
