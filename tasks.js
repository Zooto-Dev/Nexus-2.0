/* Nexus 2.0 — one place for every task (FMS steps, Checklist / Delegation, Nexus activities),
   delay escalation tickets (Level 1 → new date → Level 2) and the employee scorecard (old MIS formula). */
'use strict';

/* ================= Nexus activity doers ================= */
// settings().act_doer[k] = [{ doer, field: '', value: '' }]: one doer per activity (Operations > Task Tracker > Doer Setup).
// Swatch Approval always goes to the merchant of the brand (CDB), never to a fixed person.
const ACT_LINK = { po_raise: 'po', po_approval: 'poapproval', inward: 'inward', invoice: 'invapproval', qc: 'swatchmatch', swatch: 'swatch', grn: 'grn', excess: 'excessapproval', issuance: 'issuance', issue_approval: 'issuance', rtv: 'rtv' };
const ACT_FIELD = { po_raise: 'brand', po_approval: 'vendor', inward: 'vendor', invoice: 'vendor', qc: 'vendor', swatch: 'vendor', grn: 'vendor', excess: 'vendor', issuance: '', issue_approval: '', rtv: 'vendor' };
function actRules(k) { return ((settings().act_doer || {})[k] || []).filter(r => r.doer); }
function actDoer(r) {
  if (r.amend && (r.owners || []).length && r.owners[0]) return String(r.owners[0]).toUpperCase();
  if (r.k === 'swatch' && (r.owners || []).length) return doerOfName(r.owners[0]);
  const def = actRules(r.k).find(x => !x.field);
  if (def) return def.doer;
  if ((r.owners || []).length) return String(r.owners[0]).toUpperCase();
  return '';
}
// tasks made automatically after a GRN: their doer is set in Doer Setup too
const AUTO_ACTS = [{ k: 'debit_note', l: 'Debit Note (after GRN with reject / short)', dept: 'ACCOUNTS' }, { k: 'tally_entry', l: 'Tally Entry (after every GRN)', dept: 'ACCOUNTS' }];
function autoDoer(k, fallback) { const d = actRules(k).find(x => !x.field); return d ? d.doer : fallback; }
function userByName(n) { return Store.all('users').find(u => norm(u.name) === norm(n)) || null; }
function doerOfName(n) { const u = userByName(n); return u && u.doer ? u.doer.toUpperCase() : String(n || '').toUpperCase(); }
function userOfDoer(d) { return Store.all('users').find(u => u.doer && norm(u.doer) === norm(d)) || null; }
function deptOfDoer(d) { const u = userOfDoer(d); return u ? u.department || '' : ''; }
function allDoers() { return Array.from(new Set(Store.all('users').filter(u => u.active !== false && u.doer).map(u => u.doer.toUpperCase()))).sort(); }

/* ================= all tasks, one row each ================= */
// { key, src, task, ref, party, doer, dept, planned, actual, done, late, delay, status, link, demo }
let AT_CACHE = { t: 0, rows: null };
// the PROCESS a checklist task belongs to, for the Slow processes table: an auto task names its process, not its reference
const CL_PROC = { po_inw: 'Material Inward', ppt: 'Packaging PPT upload', mom: 'MOM action', decision: 'CEO decision', kit_plan: 'Kit planning', kit_build: 'Kit build', kit_approve: 'Kit approval', kit_return: 'Kit return', issue_balance: 'Issue balance', sample_approve: 'Sample approval', stock_adj: 'Stock adjustment approval', req: 'Requisition', debit_note: 'Debit note', sample: 'Sample approval' };
function clProcOf(t, title) { if (t.src && CL_PROC[t.src]) return CL_PROC[t.src]; if (t.kind && CL_PROC[t.kind]) return CL_PROC[t.kind]; if (/^material inwarding/i.test(String(title || t.title || ''))) return 'Material Inward'; if (t.auto || t.src) return String(title || t.title || '').split(/ — | for | · |: /)[0].trim() || String(title || ''); return String(title || t.title || ''); }
function allTasks(force) {
  if (!force && AT_CACHE.rows && Date.now() - AT_CACHE.t < 15000) return AT_CACHE.rows;
  const now = new Date(); const cal = calInfo(); const out = [];
  const wm = (a, b) => { try { return cal.workMinutesBetween(a, b); } catch (e) { return Math.round((b - a) / 60000); } };
  const push = x => {
    x.src0 = x.src; x.src = x.src === 'FMS' || x.src === 'Sample' ? 'FMS' : 'NEXUS'; x.proc = x.proc || x.task;
    x.done = !!x.actual; x.dept = deptOfDoer(x.doer);
    x.delay = x.planned ? (x.actual ? (x.actual > x.planned ? wm(x.planned, x.actual) : 0) : (now > x.planned ? wm(x.planned, now) : 0)) : 0;
    x.late = x.delay > 0;
    x.status = x.done ? (x.late ? 'Done late' : 'Done on time') : !x.planned ? 'Waiting' : x.late ? 'Delayed' : ymdOf(x.planned) === todayYmd() ? 'Pending' : 'Upcoming';
    out.push(x);
  };
  // FMS steps (orders and samples)
  fmsDocs().forEach(o => {
    if (o.priority === 'Cancelled') return;
    const r = resolveOrder(o); if (!r) return;
    const label = o.kind === 'sample' ? 'Sample' : 'FMS';
    r.order.forEach(id => {
      const s = r.steps[id]; if (!s || !['Pending', 'Late', 'Done'].includes(s.status) || !stepShown(s)) return;
      push({ key: 'fms|' + o.id + '|' + id, src: label, proc: s.name, task: s.name, ref: s.per === 'order' ? (o.order_no || o.no) : o.no, party: o.customer_name || o.brand || '', doer: String(s.doer || (s.actual ? doerOfName((o.done_by || {})[id]) : '') || '').toUpperCase(), by: (o.done_by || {})[id] || '',
        owner: String(s.doer || '').toUpperCase(), planned: s.planned ? new Date(s.planned) : null, actual: s.actual ? new Date(s.actual) : null, link: '#/order/' + o.id });
    });
  });
  // Checklist / Delegation (last 90 days up to next 7)
  clRows(ymdOf(new Date(Date.now() - 90 * 86400000)), ymdOf(new Date(Date.now() + 7 * 86400000))).forEach(r => {
    push({ key: 'cl|' + r.t.id + '|' + r.ymd, src: r.t.auto ? 'Auto' + (r.t.auto_from ? ' · ' + r.t.auto_from : '') : (r.t.src ? clSrcLabel(r.t) : r.type), task: r.task, ref: r.type === 'Delegation' ? '' : r.freq, party: r.t.party || '', doer: String(r.doer || '').toUpperCase(), owner: String(r.doer || '').toUpperCase(),
      planned: r.planned, actual: r.actual, link: '#/checklist', demo: !!r.t.demo, tid: r.t.id, proc: clProcOf(r.t, r.task), dup: r.t.src === 'po_inw' });   // dup: the Material Inward activity already tracks this PO
  });
  // Nexus activities
  paRows().forEach(r => {
    if (!r.planned || r.status === 'Waiting') return;
    const owner = actDoer(r);
    push({ key: 'pa|' + r.k + '|' + r.ref, src: 'Nexus', proc: r.act, task: r.act + (r.amend ? ' — correction' + (r.amend_with ? ' by ' + r.amend_with : '') : ''), ref: r.ref, party: r.party || '', doer: owner || (r.actual ? doerOfName(r.by) : ''), owner, by: r.by || '',
      planned: r.planned, actual: r.actual || null, link: '#/' + (ACT_LINK[r.k] || 'planactual'), grp: paDef(r.k).grp, k: r.k });
  });
  AT_CACHE = { t: Date.now(), rows: out };
  return out;
}
function tasksOf(doer) { return allTasks().filter(t => norm(t.doer) === norm(doer)); }

/* ================= escalations ================= */
// after: working minutes of delay before Level 1 = 1 working day (09:00–17:30)
// after_commit_days: once a new date is given at Level 1, the ticket sits with the Level 1 owner for
// this many days past that date before it becomes a second escalation.
const ESC_DEF = { after: 510, after_commit_days: 3 };
function escCfg() { return Object.assign({}, ESC_DEF, settings().esc || {}); }
// Level 2 = every Super Admin; Level 1 = department override, else the common Level 1 owner (the PC), else the department head
const ESC_L2 = 'SUPER ADMIN';
function escL2() { return (escCfg().l2 || ESC_L2).toUpperCase(); }
function isSuperDoer(d) { const u = userOfDoer(d); const r = u && Store.get('roles', u.role_id); return !!(r && r.system); }
function escPc() { const u = Store.all('users').find(x => x.active !== false && x.doer && /^PC$/i.test(String(x.designation || '').trim())); return u ? u.doer.toUpperCase() : ''; }
// Level 1 = the PC (designation PC, e.g. ANAMIKA); her own delays go straight to Level 2 (Super Admin)
function escL1(doer) { const pc = escPc(); return pc && norm(pc) !== norm(doer) ? pc : escL2(); }
function escIsL2(t, doer) { return t.level === 2 && !!doer && (norm(t.l2 || '') === norm(doer) || isSuperDoer(doer)); }
function escHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36).toUpperCase(); }
// involved = the doer, the Level 1 owner, and the Level 2 owner once the ticket reaches Level 2
function escInvolved(t, doer) { if (!doer) return false; const d = norm(doer); return norm(t.doer || '') === d || norm(t.l1 || '') === d || (norm(t.l1 || '') === norm(ESC_L2) && isSuperDoer(doer)) || escIsL2(t, doer); }
function escCanAct(t, level) { if (isSuperAdmin()) return true; const me = ME && ME.doer; return level === 1 ? escInvolved(t, me) : escIsL2(t, me || ''); }
// who may close a ticket: the Super Admin, the Level 2 owner once it is there, and the Level 1 owner (the PC) while it is still Level 1
const escIsL1 = t => !!(ME && ME.doer && norm(t.l1 || '') === norm(ME.doer));
function escCanResolve(t) { return isSuperAdmin() || escIsL2(t, (ME && ME.doer) || '') || (t.level === 1 && escIsL1(t)); }
function escLog(t, what) { t.history = (t.history || []).concat([{ at: nowIso(), by: ME ? ME.name : 'System', what }]); }
let ESC_T = 0;
function escRun(force) {
  if (!ME || typeof Store === 'undefined') return;
  if (!force && Date.now() - ESC_T < 60000) return; ESC_T = Date.now();
  const cfg = escCfg(); const cal = calInfo(); const now = new Date();
  const wm = (a, b) => { try { return cal.workMinutesBetween(a, b); } catch (e) { return Math.round((b - a) / 60000); } };
  const tasks = allTasks(true); const byKey = new Map(tasks.map(t => [t.key, t]));
  const have = new Map(Store.all('escalations').map(t => [t.key, t]));
  // new tickets: open task delayed by more than the threshold
  tasks.forEach(t => {
    if (t.done || !t.planned || t.demo || t.delay <= cfg.after || have.has(t.key)) return;
    if (now - t.planned > (/Checklist/.test(t.src) ? 7 : 30) * 86400000) return;   // old misses are not raised again
    const id = 'esc_' + escHash(t.key); if (Store.get('escalations', id)) return;
    const e = { id, no: 'ESC-' + id.slice(4), key: t.key, src: t.src, task: t.task, ref: t.ref, party: t.party, doer: t.owner || t.doer || '', planned: t.planned.toISOString(), link: t.link,
      level: 1, l1: escL1(t.owner || t.doer), l2: escL2(), status: 'Open', raised_at: nowIso(), history: [{ at: nowIso(), by: 'System', what: 'Level 1 — delayed ' + fmtDelay(t.delay) }] };
    Store.put('escalations', e); have.set(t.key, e);
  });
  // move open tickets on
  Store.all('escalations').filter(e => e.status === 'Open').forEach(e => {
    const t = byKey.get(e.key); let ch = false;
    if (!t || t.done) {
      e.status = 'Resolved'; e.resolved_at = t && t.actual ? t.actual.toISOString() : nowIso();
      e.result = !t ? 'Task closed' : e.commit_at && t.actual <= new Date(e.commit_at) ? 'Done by new date' : 'Task done';
      e.history = (e.history || []).concat([{ at: nowIso(), by: 'System', what: 'Resolved — ' + e.result }]); ch = true;
    } else if (e.level === 1) {
      const due = e.commit_at ? new Date(e.commit_at) : null;
      const days = num(cfg.after_commit_days) || 3;
      if ((due && now - due > days * 86400000) || (!due && wm(new Date(e.raised_at), now) > cfg.after)) {
        e.level = 2; e.l2_at = nowIso();
        e.history = (e.history || []).concat([{ at: nowIso(), by: 'System', what: 'Level 2 — ' + (due ? days + ' days past the new date ' + fmtDT(due) : 'no new date given in 1 working day') }]); ch = true;
      }
    }
    if (ch) Store.put('escalations', e);
  });
}
setInterval(() => { try { escRun(); } catch (e) { console.error(e); } }, 5 * 60000);

ACTIONS['esc-date'] = el => {
  const e = Store.get('escalations', el.dataset.id); if (!e || e.status !== 'Open' || e.level !== 1) return;
  if (!escCanAct(e, 1)) { flash('Only the doer, Level 1 or Level 2 owner can give a new date.', 'err'); return; }
  if (e.commit_at) { flash('A new date was already given once.', 'err'); return; }
  formDialog(e.no + ' · New date', [{ k: 'd', l: 'New date & time', type: 'datetime-local', req: true }, { k: 'why', l: 'Reason', type: 'textarea', req: true }], 'Save', v => {
    const d = new Date(v.d); if (isNaN(d) || d <= new Date()) return 'Pick a future date and time.';
    e.commit_at = d.toISOString(); e.commit_by = ME.name; e.commit_why = v.why; escLog(e, 'New date ' + fmtDT(d) + ' — ' + v.why);
    Store.put('escalations', e); audit('escalation.new_date', e.no, fmtDT(d) + ' — ' + v.why); route();
  });
};
ACTIONS['esc-resolve'] = el => {
  const e = Store.get('escalations', el.dataset.id); if (!e || e.status !== 'Open') return;
  if (!escCanResolve(e)) { flash(e.level === 1 ? esc(e.l1 || 'The Level 1 owner') + ' or the Super Admin resolves a first escalation.' : 'Level 2 (Super Admin) resolves this.', 'err'); return; }
  formDialog(e.no + ' · Resolve', [{ k: 'why', l: 'Resolution', type: 'textarea', req: true }], 'Resolve', v => {
    e.status = 'Resolved'; e.resolved_at = nowIso(); e.result = 'Resolved by ' + ME.name; e.resolution = v.why; escLog(e, 'Resolved — ' + v.why);
    Store.put('escalations', e); audit('escalation.resolve', e.no, v.why); route();
  });
};

/* ================= scorecard (old MIS formula) ================= */
// score = -(100 - quality); quality = weighted Completion%, On-time%, Volume%, Consistency%. 0 is best.
const SCORE_W = { completion: 0.35, onTime: 0.35, volume: 0.15, consistency: 0.15 };
function scoreW() { return Object.assign({}, SCORE_W, settings().score_w || {}); }
function scoreRows(from, to, rowsIn, withDemo) {
  const f = from ? new Date(from + 'T00:00:00') : null, tt = to ? new Date(to + 'T23:59:59') : null; const now = new Date();
  const rows = (rowsIn || allTasks()).filter(t => t.planned && t.doer && t.doer !== 'SYSTEM' && (withDemo || !t.demo) && (!f || t.planned >= f) && (!tt || t.planned <= tt) && (t.done || t.planned <= now));
  const m = {};
  rows.forEach(t => {
    const k = t.doer; const s = m[k] || (m[k] = { doer: k, dept: t.dept, total: 0, completed: 0, pending: 0, overdue: 0, onTime: 0, late: 0, monthly: {}, tasks: [] });
    s.total++; s.tasks.push(t);
    if (t.done) { s.completed++; t.late ? s.late++ : s.onTime++; const mk = ymdOf(t.planned).slice(0, 7); const x = s.monthly[mk] || (s.monthly[mk] = { ok: 0, n: 0 }); x.n++; if (!t.late) x.ok++; }
    else t.late ? s.overdue++ : s.pending++;
  });
  const list = Object.values(m); const maxT = list.reduce((a, r) => Math.max(a, r.total), 0); const W = scoreW(); const ws = (W.completion + W.onTime + W.volume + W.consistency) || 1;
  const esc = Store.all('escalations');
  list.forEach(r => {
    r.completionPct = r.total ? r.completed * 100 / r.total : 0;
    r.onTimePct = r.completed ? r.onTime * 100 / r.completed : 0;
    r.volumePct = maxT ? Math.min(100, r.total * 100 / maxT) : 0;
    const mon = Object.values(r.monthly).filter(x => x.n).map(x => x.ok * 100 / x.n);
    if (mon.length >= 2) { const avg = mon.reduce((a, b) => a + b, 0) / mon.length; r.consistencyPct = Math.max(0, 100 - Math.sqrt(mon.reduce((a, b) => a + (b - avg) * (b - avg), 0) / mon.length)); }
    else r.consistencyPct = r.onTimePct;
    r.quality = (W.completion * r.completionPct + W.onTime * r.onTimePct + W.volume * r.volumePct + W.consistency * r.consistencyPct) / ws;
    r.score = -Math.round((100 - r.quality) * 100) / 100;
    r.esc1 = esc.filter(e => norm(e.doer) === norm(r.doer)).length; r.esc2 = esc.filter(e => norm(e.doer) === norm(r.doer) && e.level === 2).length;
  });
  return list.sort((a, b) => b.score - a.score);
}
function scoreOf(doer, days, withDemo) { const r = scoreRows(ymdOf(new Date(Date.now() - (days || 30) * 86400000)), todayYmd(), null, withDemo).find(x => norm(x.doer) === norm(doer)); return r || null; }
const scoreCls = s => s == null ? '' : s >= -10 ? 'done-txt' : s >= -30 ? 'pend-txt' : 'late-txt';

/* ================= Task Tracker screen ================= */
const AT_UI = { src: '', st: 'open', who: '', dept: '', from: '', to: '', q: '', tab: 'tasks' };
function atAll() { return isAdminRole() || can('tracker', 'edit'); }
VIEWS.alltasks = {
  mod: 'tasks', render(param) {
    if (param) { AT_UI.who = param; AT_UI.st = 'all'; }
    const all = atAll(); if (!all) AT_UI.who = ME.doer || '';
    if (!AT_UI.from) { AT_UI.from = ymdOf(new Date(Date.now() - 30 * 86400000)); AT_UI.to = ymdOf(new Date(Date.now() + 7 * 86400000)); }
    const tabs = [{ v: 'tasks', l: 'All Tasks' }].concat(isAdminRole() ? [{ v: 'setup', l: 'Doer Setup' }] : []);
    let h = '<div class="toolbar">' + seg('atTab', tabs, AT_UI.tab) + '</div>';
    if (AT_UI.tab === 'setup' && isAdminRole()) h += atSetupHtml();
    else {
      const f = new Date(AT_UI.from + 'T00:00:00'), t = new Date(AT_UI.to + 'T23:59:59'); const q = norm(AT_UI.q);
      const escBy = new Map(Store.all('escalations').map(e => [e.key, e]));
      const rows = allTasks().filter(x => (!x.planned || (x.planned >= f && x.planned <= t)) && (!AT_UI.src || x.src === AT_UI.src) && (!AT_UI.who || norm(x.doer) === norm(AT_UI.who) || norm(x.owner) === norm(AT_UI.who)) && (!AT_UI.dept || x.dept === AT_UI.dept) &&
        (AT_UI.st === 'all' || (AT_UI.st === 'open' ? !x.done && x.status !== 'Upcoming' : AT_UI.st === 'delayed' ? x.status === 'Delayed' : AT_UI.st === 'upcoming' ? x.status === 'Upcoming' : AT_UI.st === 'late' ? x.late : x.done)) &&
        (!q || norm([x.proc, x.task, x.ref, x.party, x.doer].join(' ')).includes(q))).sort((a, b) => (b.delay - a.delay) || ((a.planned || 0) - (b.planned || 0)));
      VIEWS.alltasks.rows = rows;
      const srcs = Array.from(new Set(allTasks().map(x => x.src))).sort(); const depts = Array.from(new Set(allTasks().map(x => x.dept).filter(Boolean))).sort();
      h += '<div class="toolbar">' + seg('atSt', [{ v: 'open', l: 'Open' }, { v: 'delayed', l: 'Delayed' }, { v: 'upcoming', l: 'Upcoming' }, { v: 'done', l: 'Done' }, { v: 'late', l: 'Late' }, { v: 'all', l: 'All' }], AT_UI.st) +
        '<select id="atSrc">' + selOpts(srcs, AT_UI.src, 'All sources') + '</select>' + (all ? '<select id="atWho">' + doerOpts(allDoers(), AT_UI.who, 'All doers') + '</select><select id="atDept">' + selOpts(depts, AT_UI.dept, 'All departments') + '</select>' : '') +
        '<input id="atFrom" type="date" value="' + esc(AT_UI.from) + '"><input id="atTo" type="date" value="' + esc(AT_UI.to) + '"><input id="atQ" placeholder="Search…" value="' + esc(AT_UI.q) + '"><span class="muted small">' + rows.length + ' task(s)</span><span class="grow"></span><button class="btn" data-act="at-csv">Export CSV</button></div>';
      // the same tasks summed up by process: how many, done, not done, late — for whatever doer / period is chosen above
      const byP = {}; rows.forEach(x => { const k = x.src + '|' + (x.proc || x.task); const p = byP[k] || (byP[k] = { src: x.src, proc: x.proc || x.task, total: 0, done: 0, pend: 0, late: 0, open: 0 }); p.total++; if (x.done) { p.done++; if (x.late) p.late++; } else { p.pend++; if (x.late) p.open++; } });
      const pRows = Object.values(byP).sort((a, b) => (b.open + b.late) - (a.open + a.late) || b.total - a.total);
      if (pRows.length) h += '<div class="dcard" style="margin-bottom:12px"><div class="dh3">By process' + (AT_UI.who ? ' · ' + esc(AT_UI.who) : '') + '<span class="n">' + pRows.length + '</span></div><div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Process</th><th>Source</th><th class="num">Total</th><th class="num">Done</th><th class="num">Not done</th><th class="num">Done late</th><th class="num">Open late</th></tr>' +
        pRows.map(p => '<tr><td><b>' + esc(p.proc) + '</b></td><td>' + esc(p.src) + '</td><td class="num">' + p.total + '</td><td class="num">' + p.done + '</td><td class="num' + (p.pend ? ' late-txt' : '') + '">' + p.pend + '</td><td class="num">' + p.late + '</td><td class="num' + (p.open ? ' late-txt' : '') + '">' + p.open + '</td></tr>').join('') + '</table></div></div>';
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Source</th><th>Process</th><th>Task</th><th>Reference</th><th>Party</th><th>Doer</th><th>Department</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th>Escalation</th><th></th></tr>' +
        (rows.length ? rows.map(x => { const e = escBy.get(x.key);
          return '<tr><td>' + esc(x.src) + '</td><td>' + esc(x.proc || '') + '</td><td>' + esc(x.task) + taskExtraHtml(x.tid) + '</td><td><b>' + esc(x.ref) + '</b></td><td>' + esc(x.party) + '</td><td>' + (x.doer ? esc(x.doer) : '<span class="late-txt">Not set</span>') + '</td><td>' + esc(x.dept) + '</td>' +
            '<td class="nowrap">' + (x.planned ? fmtDT(x.planned) : '') + '</td><td class="nowrap">' + (x.actual ? fmtDT(x.actual) : '') + '</td><td><span class="st ' + (x.status === 'Done on time' ? 'Done' : x.status === 'Done late' ? 'Pending' : x.status === 'Delayed' ? 'Late' : x.status === 'Pending' ? 'Pending' : 'Waiting') + '">' + x.status + '</span></td>' +
            '<td class="num' + (x.delay ? ' late-txt' : '') + '">' + (x.delay ? fmtDelay(x.delay) : '') + '</td><td>' + (e ? '<a href="#/escalations">' + esc(e.no) + ' · L' + e.level + (e.status === 'Open' ? '' : ' ✓') + '</a>' : '') + '</td><td><a href="' + esc(x.link) + '">Open</a></td></tr>'; }).join('')
          : '<tr><td colspan="13" class="empty">No tasks</td></tr>') + '</table></div>';
    }
    setMain(h);
    onSeg(e => { const s = e.target.dataset.seg; if (s === 'atTab') AT_UI.tab = e.detail; if (s === 'atSt') AT_UI.st = e.detail; VIEWS.alltasks.render(); });
    const m = $('#main');
    m.addEventListener('change', e => {
      const k = { atSrc: 'src', atWho: 'who', atDept: 'dept', atFrom: 'from', atTo: 'to' }[e.target.id]; if (k) { AT_UI[k] = e.target.value; VIEWS.alltasks.render(); return; }
      if (e.target.dataset.adr != null) atSaveRule(e.target);
    });
    const qi = $('#atQ'); if (qi) qi.addEventListener('input', e => { AT_UI.q = e.target.value; clearTimeout(AT_UI.t); AT_UI.t = setTimeout(() => { VIEWS.alltasks.render(); const i = $('#atQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); });
  }
};
ACTIONS['at-csv'] = () => downloadCsv('all-tasks-' + todayYmd() + '.csv', [['Source', 'Process', 'Task', 'Reference', 'Party', 'Doer', 'Department', 'Planned', 'Actual', 'Status', 'Delay (min)']]
  .concat((VIEWS.alltasks.rows || []).map(x => [x.src, x.proc || '', x.task, x.ref, x.party, x.doer, x.dept, x.planned ? fmtDT(x.planned) : '', x.actual ? fmtDT(x.actual) : '', x.status, x.delay || 0])));

// Doer Setup: one doer per activity — simple on purpose
function atSetupHtml() {
  const doers = allDoers(); const cfg = settings().act_doer || {};
  const cur = k => ((cfg[k] || []).find(r => !r.field) || {}).doer || '';
  const row = (l, start, tat, k, cell) => '<tr><td><b>' + esc(l) + '</b></td><td class="small">' + esc(start || '') + '</td><td class="nowrap">' + esc(tat || '') + '</td><td>' + cell + '</td></tr>';
  return '<div class="tbl-wrap"><table class="nopage"><tr><th>Activity</th><th>Starts when</th><th>TAT</th><th>Doer</th></tr>' +
    PA_DEFS.map(d => { const t = paTat(d.k); const tat = t ? paTatLabel(t) : '';
      return row(d.l, PA_START[d.k], tat, d.k, d.k === 'swatch' ? '<span class="small">Merchant of the brand — <a href="#/customers">CDB → Merchandiser</a></span>'
        : '<select data-adr="' + d.k + '" data-i="def">' + doerOpts(doers, cur(d.k), 'Not set') + '</select>'); }).join('') +
    AUTO_ACTS.map(a => row(a.l, 'GRN saved', '1 day', a.k, '<select data-adr="' + a.k + '" data-i="def">' + doerOpts(doers, cur(a.k), 'Not set') + '</select>')).join('') +
    '</table></div>';
}
function atSaveRule(sel) {
  if (!isAdminRole()) return; const st = settings(); st.act_doer = st.act_doer || {}; const k = sel.dataset.adr;
  st.act_doer[k] = sel.value ? [{ field: '', value: '', doer: sel.value }] : [];
  Store.setSettings(st); AT_CACHE.t = 0; const a = AUTO_ACTS.find(x => x.k === k);
  audit('settings.act_doer', a ? a.l : paDef(k).l, sel.value || 'Not set'); flash('Saved.');
}

/* ================= Escalations screen ================= */
const ESC_UI = { f: 'open', tab: 'list' };
VIEWS.escalations = {
  mod: 'tasks', render() {
    escRun(true);
    const all = isSuperAdmin() || isAdminRole(); const me = ME.doer || '';
    const tabs = [{ v: 'list', l: 'Escalations' }].concat(isSuperAdmin() ? [{ v: 'setup', l: 'Setup' }] : []);
    let h = '<div class="toolbar">' + seg('escTab', tabs, ESC_UI.tab) + '</div>';
    if (ESC_UI.tab === 'setup' && isSuperAdmin()) h += escSetupHtml();
    else {
      const list = Store.all('escalations').filter(e => all || escInvolved(e, me)).sort((a, b) => (b.raised_at || '') < (a.raised_at || '') ? -1 : 1);
      const rows = list.filter(e => ESC_UI.f === 'all' || (ESC_UI.f === 'open' ? e.status === 'Open' : ESC_UI.f === 'l1' ? e.status === 'Open' && e.level === 1 : ESC_UI.f === 'l2' ? e.status === 'Open' && e.level === 2 : e.status === 'Resolved'));
      const n = f => list.filter(e => f === 'l1' ? e.status === 'Open' && e.level === 1 : e.status === 'Open' && e.level === 2).length;
      h += '<div class="toolbar">' + seg('escF', [{ v: 'open', l: 'Open' }, { v: 'l1', l: 'Level 1 · ' + n('l1') }, { v: 'l2', l: 'Level 2 · ' + n('l2') }, { v: 'done', l: 'Resolved' }, { v: 'all', l: 'All' }], ESC_UI.f) + '<span class="muted small">' + rows.length + ' ticket(s)</span></div>';
      const now = new Date(); const cal = calInfo();
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Ticket</th><th>Raised</th><th>Source</th><th>Task</th><th>Reference</th><th>Party</th><th>Doer</th><th>Planned</th><th class="num">Delay</th><th>Level</th><th>Level 1</th><th>New Date</th><th>Reason</th><th>Level 2</th><th>Status</th><th>Result</th><th></th></tr>' +
        (rows.length ? rows.map(e => {
          const end = e.resolved_at ? new Date(e.resolved_at) : now; let dl = 0; try { dl = cal.workMinutesBetween(new Date(e.planned), end); } catch (x) {}
          const acts = e.status !== 'Open' ? '' : (e.level === 1 && !e.commit_at && escCanAct(e, 1) ? '<button class="btn sm" data-act="esc-date" data-id="' + esc(e.id) + '">New date</button> ' : '') + (escCanResolve(e) ? '<button class="btn sm primary" data-act="esc-resolve" data-id="' + esc(e.id) + '">Resolve</button>' : '');
          return '<tr><td><b>' + esc(e.no) + '</b></td><td class="nowrap">' + fmtDT(e.raised_at) + '</td><td>' + esc(e.src) + '</td><td>' + esc(e.task) + '</td><td>' + (e.link ? '<a href="' + esc(e.link) + '">' + esc(e.ref) + '</a>' : esc(e.ref)) + '</td><td>' + esc(e.party) + '</td><td>' + esc(e.doer) + '</td>' +
            '<td class="nowrap">' + fmtDT(e.planned) + '</td><td class="num late-txt">' + (dl ? fmtDelay(dl) : '') + '</td><td><span class="st ' + (e.status !== 'Open' ? 'Done' : e.level === 2 ? 'Late' : 'Pending') + '">L' + e.level + '</span></td><td>' + esc(e.l1) + '</td>' +
            '<td class="nowrap">' + (e.commit_at ? fmtDT(e.commit_at) : '') + '</td><td>' + esc(e.commit_why || '') + '</td><td>' + esc(e.l2) + '</td><td>' + esc(e.status) + '</td><td>' + esc(e.result || '') + (e.resolution ? ' — ' + esc(e.resolution) : '') + '</td><td class="nowrap">' + acts + ' <a class="small" data-act="esc-hist" data-id="' + esc(e.id) + '">Log</a></td></tr>';
        }).join('') : '<tr><td colspan="17" class="empty">No escalations</td></tr>') + '</table></div>';
    }
    setMain(h);
    onSeg(e => { const s = e.target.dataset.seg; if (s === 'escTab') ESC_UI.tab = e.detail; if (s === 'escF') ESC_UI.f = e.detail; VIEWS.escalations.render(); });
    $('#main').addEventListener('change', e => {
      const t = e.target; if (!isSuperAdmin()) return;
      const st = settings(); st.esc = Object.assign({}, st.esc || {});
      if (t.id === 'escL1all') { st.esc.l1_all = t.value; audit('settings.escalation', 'Level 1', t.value || 'PC'); }
      else if (t.dataset.l1d) { st.esc.l1 = Object.assign({}, st.esc.l1 || {}); if (t.value) st.esc.l1[t.dataset.l1d] = t.value; else delete st.esc.l1[t.dataset.l1d]; audit('settings.escalation', 'Level 1 · ' + t.dataset.l1d, t.value || 'auto'); }
      else if (t.id === 'escAfter') { st.esc.after = Math.round(num(t.value) * 510); audit('settings.escalation', 'After', t.value + ' day'); }
      else return;
      Store.setSettings(st); flash('Saved.');
    });
  }
};
ACTIONS['esc-hist'] = el => {
  const e = Store.get('escalations', el.dataset.id); if (!e) return;
  formDialog(e.no + ' · ' + e.task, [{ k: 'log', l: 'Log', type: 'static', value: '' }], 'Close', () => {});
  const d = $('#fxDlg'); if (d) $('.jckv', d).innerHTML = '<tr class="hd"><th>When</th><th>By</th><th>What</th></tr>' + (e.history || []).map(x => '<tr><td class="nowrap">' + fmtDT(x.at) + '</td><td>' + esc(x.by) + '</td><td>' + esc(x.what) + '</td></tr>').join('');
};
function escSetupHtml() {
  const c = escCfg();
  return '<div class="panel" style="max-width:760px"><table class="jckv">' +
    '<tr><td class="k">Level 1 after delay of</td><td class="v"><select id="escAfter">' + [0.5, 1, 2, 3].map(x => '<option value="' + x + '"' + (Math.abs(c.after / 510 - x) < 0.01 ? ' selected' : '') + '>' + x + ' working day' + (x > 1 ? 's' : '') + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Level 1 owner</td><td class="v">PC · ' + esc(escPc() || 'no user with designation PC') + '</td></tr>' +
    '<tr><td class="k">Level 2 owner</td><td class="v">Super Admin (' + esc(Store.all('users').filter(u => u.active !== false && u.doer && isSuperDoer(u.doer)).map(u => u.doer.toUpperCase()).join(', ')) + ')</td></tr></table></div>';
}

/* ================= Scorecard screen ================= */
const SC_UI = { from: '', to: '', dept: '', who: '' };
VIEWS.scorecard = {
  mod: 'tasks', render() {
    if (!SC_UI.from) { const d = new Date(); SC_UI.from = ymdOf(new Date(d.getFullYear(), d.getMonth(), 1)); SC_UI.to = todayYmd(); }
    const all = atAll();
    let rows = scoreRows(SC_UI.from, SC_UI.to); if (!all) rows = rows.filter(r => norm(r.doer) === norm(ME.doer || ''));
    const depts = Array.from(new Set(rows.map(r => r.dept).filter(Boolean))).sort();
    if (SC_UI.dept) rows = rows.filter(r => r.dept === SC_UI.dept);
    const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
    let h = '<div class="toolbar"><input id="scFrom" type="date" value="' + esc(SC_UI.from) + '"><input id="scTo" type="date" value="' + esc(SC_UI.to) + '">' + (all ? '<select id="scDept">' + selOpts(depts, SC_UI.dept, 'All departments') + '</select>' : '') + '<span class="muted small">' + rows.length + ' employee(s)</span><span class="grow"></span><button class="btn" data-act="sc-csv">Export CSV</button></div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>#</th><th>Doer</th><th>Department</th><th class="num">Total</th><th class="num">Done</th><th class="num">On Time</th><th class="num">Late</th><th class="num">Pending</th><th class="num">Overdue</th><th class="num">Compl %</th><th class="num">On-time %</th><th class="num">Volume</th><th class="num">Consistency</th><th class="num">Score</th><th class="num">Escalations</th><th class="num">Level 2</th></tr>' +
      (rows.length ? rows.map((r, i) => '<tr class="click" data-act="sc-open" data-d="' + esc(r.doer) + '"><td class="muted">' + (i + 1) + '</td><td><b>' + esc(r.doer) + '</b></td><td>' + esc(r.dept) + '</td><td class="num">' + r.total + '</td><td class="num">' + r.completed + '</td><td class="num">' + r.onTime + '</td><td class="num">' + r.late + '</td><td class="num">' + r.pending + '</td><td class="num' + (r.overdue ? ' late-txt' : '') + '">' + r.overdue + '</td>' +
        '<td class="num">' + f1(r.completionPct) + '</td><td class="num">' + f1(r.onTimePct) + '</td><td class="num">' + f1(r.volumePct) + '</td><td class="num">' + f1(r.consistencyPct) + '</td><td class="num"><b class="' + scoreCls(r.score) + '">' + r.score.toFixed(2) + '</b></td><td class="num">' + r.esc1 + '</td><td class="num' + (r.esc2 ? ' late-txt' : '') + '">' + r.esc2 + '</td></tr>').join('')
        : '<tr><td colspan="16" class="empty">No tasks in this period</td></tr>') + '</table></div>';
    VIEWS.scorecard.rows = rows;
    setMain(h);
    $('#main').addEventListener('change', e => { const k = { scFrom: 'from', scTo: 'to', scDept: 'dept' }[e.target.id]; if (k) { SC_UI[k] = e.target.value; VIEWS.scorecard.render(); } });
  }
};
ACTIONS['sc-open'] = el => { AT_UI.who = el.dataset.d; AT_UI.st = 'all'; AT_UI.from = curView().v === 'home' ? SA_UI.from : SC_UI.from || AT_UI.from; AT_UI.to = curView().v === 'home' ? SA_UI.to : SC_UI.to || AT_UI.to; AT_UI.tab = 'tasks'; go('alltasks'); };
ACTIONS['sc-csv'] = () => downloadCsv('scorecard-' + todayYmd() + '.csv', [['Doer', 'Department', 'Total', 'Done', 'On Time', 'Late', 'Pending', 'Overdue', 'Completion %', 'On-time %', 'Volume', 'Consistency', 'Score', 'Escalations', 'Level 2']]
  .concat((VIEWS.scorecard.rows || []).map(r => [r.doer, r.dept, r.total, r.completed, r.onTime, r.late, r.pending, r.overdue, r.completionPct.toFixed(1), r.onTimePct.toFixed(1), r.volumePct.toFixed(1), r.consistencyPct.toFixed(1), r.score.toFixed(2), r.esc1, r.esc2])));

/* ================= Super Admin Home ================= */
const SA_UI = { from: '', to: '' };
/* The Super Admin's Home is read top to bottom: what needs you now, what the money looks like,
   where the delays are. A card with nothing in it collapses to one green line instead of an empty
   table, so the page is as long as the work actually is. */
const SA_ICO = {
  check: '<path d="M20 6 9 17l-5-5"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  tag: '<path d="M3 12 12 3h8v8l-9 9z"/><circle cx="16.4" cy="7.6" r="1.3"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trend: '<path d="M3 17l6-6 4 4 7-7"/><path d="M16 8h5v5"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5"/>',
  flow: '<rect x="3" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/><path d="M6.5 9v5.5a3 3 0 0 0 3 3H14"/>',
  box: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>'
};
const saIco = k => '<svg class="sa-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (SA_ICO[k] || '') + '</svg>';
/* one card for the whole dashboard: nothing pending -> a single green line */
function saCard(o) {
  const n = num(o.n), tone = n ? (o.tone || 'warn') : 'ok';
  const head = '<div class="dh3 sa-h"><span class="sa-hi ' + tone + '">' + saIco(o.ico || 'check') + '</span><b>' + esc(o.title) + '</b>' +
    (n ? '<span class="n' + (o.tone === 'bad' ? ' red' : '') + '">' + qtyFmt(n) + '</span>' : '') +
    (o.sub ? '<span class="muted small">' + o.sub + '</span>' : '') + '<span class="grow"></span>' +
    (o.link ? '<a class="sa-open" href="' + o.link + '">' + (o.linkText || 'Open') + ' ›</a>' : '') + '</div>';
  if (!n && !o.always) return '<div class="dcard sa-ok">' + head + '<div class="sa-clear">' + esc(o.empty || 'Nothing pending') + '</div></div>';
  return '<div class="dcard">' + head + (o.note ? '<div class="sa-note">' + esc(o.note) + '</div>' : '') + (o.body || '') + '</div>';
}
/* The first escalation belongs to the Level 1 owner (the PC): it opens her Home with both actions on
   the row. Only when she lets a working day pass does it become a second escalation for the Super Admin. */
function escL1Card(who) {
  const mine = Store.all('escalations').filter(e => e.status === 'Open' && e.level === 1 && norm(e.l1 || '') === norm(who || ''))
    .sort((a, b) => (a.planned || '') < (b.planned || '') ? -1 : 1);
  const cal = calInfo(); const now = new Date();
  const body = '<div class="tbl-wrap"><table class="nofilter nopage sa-tb"><tr><th>Ticket</th><th>Task</th><th>Reference</th><th>Doer</th><th>Planned</th><th class="num">Delay</th><th>New date</th><th class="noprint"></th></tr>' +
    mine.map(e => { let dl = 0; try { dl = cal.workMinutesBetween(new Date(e.planned), now); } catch (x) { }
      return '<tr><td><b>' + esc(e.no) + '</b></td><td>' + esc(e.task) + '<div class="muted small">' + esc(e.src) + '</div></td><td>' + (e.link ? '<a href="' + esc(e.link) + '">' + esc(e.ref) + '</a>' : esc(e.ref)) + '</td><td>' + esc(e.doer || '') + '</td><td class="nowrap">' + fmtDT(e.planned) + '</td><td class="num late-txt">' + (dl ? fmtDelay(dl) : '') + '</td>' +
        '<td class="nowrap">' + (e.commit_at ? fmtDT(e.commit_at) + '<div class="muted small">' + esc(e.commit_why || '') + '</div><div class="muted small">goes up ' + fmtD(ymdOf(new Date(new Date(e.commit_at).getTime() + (num(escCfg().after_commit_days) || 3) * 86400000))) + '</div>' : '<span class="muted">not given</span>') + '</td>' +
        '<td class="noprint nowrap">' + (e.commit_at ? '' : '<button class="btn sm" data-act="esc-date" data-id="' + esc(e.id) + '">New date</button> ') + '<button class="btn sm primary" data-act="esc-resolve" data-id="' + esc(e.id) + '">Resolve</button></td></tr>'; }).join('') + '</table></div>';
  return '<div class="sa-lbl">First escalations — yours to clear</div>' + saCard({ title: 'First escalations', n: mine.length, tone: 'bad', ico: 'alert', link: '#/escalations', linkText: 'All escalations', empty: 'No first escalation is waiting with you', sub: mine.length ? 'give a new date or resolve — after one working day they go to the Super Admin' : '', body: body });
}
/* ================= The Super Admin home: one tab bar, one section per tab =================
   Every section lives in exactly one tab, so nothing mixes. SX_UI.tab says which tab is open;
   a doer row elsewhere can deep-link into the Score tab by setting it to 'score'. */
const SA_TABS = [{ v: 'apr', l: 'Approvals' }, { v: 'esc', l: 'Escalations' }, { v: 'mny', l: 'COGS' },
  { v: 'exc', l: 'Excess' }, { v: 'dly', l: 'Delay' }, { v: 'score', l: 'Score' }, { v: 'req', l: 'My requests' }];
function saTabBar(tab, n) {
  return '<div class="sa-lbl">Section</div><div class="sa-tabbar">' + SA_TABS.map(t => '<button type="button" class="sa-tb-b' + (t.v === tab ? ' on' : '') +
    '" data-act="sx-tab" data-v="' + t.v + '">' + esc(t.l) + (n[t.v] ? '<span class="sa-tb-n">' + qtyFmt(n[t.v]) + '</span>' : '') + '</button>').join('') + '</div>';
}
function saHomeHtml(names) {
  if (!SA_UI.from) { const d = new Date(); SA_UI.from = ymdOf(new Date(d.getFullYear(), d.getMonth(), 1)); SA_UI.to = todayYmd(); }
  try { escRun(); } catch (e) { console.error(e); }
  try { if (typeof poInwSyncAll === 'function') poInwSyncAll(); } catch (e) { console.error(e); }
  try { if (typeof kitRun === 'function') kitRun(); } catch (e) { console.error(e); }
  const pa = paRows(); const tasks = allTasks(); const now = new Date();
  const excAll = pa.filter(r => r.k === 'excess' && !r.actual);
  const exc = excAll.filter(r => !r.amend).sort((a, b) => b.delay - a.delay);
  const excAmend = excAll.filter(r => r.amend).sort((a, b) => b.delay - a.delay);
  const poAll = pa.filter(r => r.k === 'po_approval' && !r.actual);
  const poa = poAll.filter(r => !r.amend).sort((a, b) => b.delay - a.delay);
  const poAmend = poAll.filter(r => r.amend).sort((a, b) => b.delay - a.delay);
  const invAmend = pa.filter(r => r.k === 'invoice' && !r.actual && r.amend).sort((a, b) => b.delay - a.delay);
  const prq = Store.all('price_requests').filter(x => x.status === 'Pending').sort((a, b) => a.at < b.at ? -1 : 1);
  const smpN = typeof mySampleInwards === 'function' ? Store.all('inwards').filter(x => inwWaiting(x) && inwIsSample(x)).length : 0;
  const adjN = typeof sadjPendingList === 'function' ? sadjPendingList().length : 0;
  const escs = Store.all('escalations').filter(e => e.status === 'Open');
  const l2 = escs.filter(e => e.level === 2).sort((a, b) => a.planned < b.planned ? -1 : 1); const l1n = escs.length - l2.length;
  const me = (ME && ME.doer) || '';
  const l1mine = escs.filter(e => e.level === 1 && norm(e.l1 || '') === norm(me)).length;
  const delayed = tasks.filter(t => !t.done && !t.demo && !t.dup && t.status === 'Delayed' && t.doer !== 'SYSTEM');
  const tab = SA_TABS.some(t => t.v === SX_UI.tab) ? SX_UI.tab : 'apr';
  let exN = 0; try { exN = excessPurchaseRows().length + excessIssueRows().length; } catch (e) { }
  const h0 = saTabBar(tab, { apr: exc.length + poa.length + prq.length + smpN + adjN, esc: l2.length + l1mine, exc: exN, dly: delayed.length });
  let h = h0;

  const tbl = (pg, head, rows, cols) => '<div class="tbl-wrap"><table class="nofilter nopage sa-tb" data-pg="' + pg + '"><tr>' + head.map(x => '<th' + (/^#|Delay|Total|Done|Late|Open|Avg|Score|On|Overdue|Level|%/.test(x) ? ' class="num"' : '') + '>' + x + '</th>').join('') + '</tr>' + (rows.length ? rows.join('') : '<tr><td colspan="' + cols + '" class="empty">Nothing pending</td></tr>') + '</table></div>';
  const dl = m => m ? '<span class="late-txt">' + fmtDelay(m) + '</span>' : '';

  // ---- Approvals: only the ones the Super Admin gives ----
  if (tab === 'apr') {
    h += '<div class="sa-lbl">Approvals waiting with you</div><div class="sa-stack">';
    if (smpN && typeof sampleApprCard === 'function') h += sampleApprCard(true);
    if (adjN && typeof sadjHomeCard === 'function') h += sadjHomeCard();
    h += saCard({ title: 'Excess approvals', n: exc.length, tone: 'bad', ico: 'box', link: '#/excessapproval', empty: 'No excess material waiting', note: 'Material taken in above the purchase order.', body:
      tbl('sa_excess', ['GRN · Material', 'Vendor', 'Since', 'Planned', 'Delay'], exc.map(r => '<tr class="click" data-act="go" data-v="excessapproval"><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party) + '</td><td class="nowrap">' + fmtDT(r.start) + '</td><td class="nowrap">' + fmtDT(r.planned) + '</td><td class="num">' + dl(r.delay) + '</td></tr>'), 5) });
    h += saCard({ title: 'PO approvals', n: poa.length, ico: 'file', link: '#/poapproval', empty: 'No purchase order waiting', note: 'Purchase orders waiting for your approval.', body:
      tbl('sa_po', ['PO', 'Vendor', 'Since', 'Planned', 'Delay'], poa.map(r => '<tr class="click" data-act="go" data-v="poapproval"><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party) + '</td><td class="nowrap">' + fmtDT(r.start) + '</td><td class="nowrap">' + fmtDT(r.planned) + '</td><td class="num">' + dl(r.delay) + '</td></tr>'), 5) });
    h += '</div>';
    const back = poAmend.map(r => ({ r, what: 'PO', to: '#/po' })).concat(invAmend.map(r => ({ r, what: 'Invoice', to: '#/inward' })), excAmend.map(r => ({ r, what: 'Excess', to: '#/grn' })));
    if (back.length) h += saCard({ title: 'Sent back for correction', n: back.length, ico: 'file', link: '#/alltasks', linkText: 'Tasks',
      note: 'These are not with you — the person who raised them has to correct and send them again, so the approval screens do not show them.', body:
      tbl('sa_amend', ['What', 'Reference', 'Party', 'With', 'Since', 'Waiting'], back.map(({ r, what, to }) => '<tr class="click" data-act="go" data-v="' + to.slice(2) + '"><td>' + what + '</td><td><b>' + esc(r.ref) + '</b></td><td>' + esc(r.party || '') + '</td><td>' + esc(r.amend_with || '') + '</td><td class="nowrap">' + fmtDT(r.start) + '</td><td class="num">' + dl(r.delay) + '</td></tr>'), 6) });
    h += saCard({ title: 'Price approvals', n: prq.length, ico: 'tag', link: '#/priceapproval', empty: 'No price waiting for approval', note: 'An approved price goes straight into every BOM that uses the item.',
      sub: prq.length ? '<button class="btn sm primary" data-act="pr-sel" disabled>Approve selected (0)</button> <button class="btn sm" data-act="pr-sel-no" disabled>Reject selected</button> <button class="btn sm" data-act="pr-all" data-confirm="Approve all ' + prq.length + '?">Approve all (' + prq.length + ')</button>' : '', body:
      tbl('sa_price', ['<input type="checkbox" id="prAllCk" title="Select all">', 'Photo', 'Item', 'Current ₹', 'New ₹', 'Type', 'Asked by', 'Since', ''], prq.map(x => '<tr><td><input type="checkbox" data-prck="' + esc(x.id) + '"></td><td>' + photoThumb((matBy(x.material) || {}).photo) + '</td><td><b>' + esc(x.material) + '</b> <span class="muted">' + esc((matBy(x.material) || {}).name || '') + '</span></td><td class="num">' + (num(x.old_price) ? money(x.old_price) : '—') + '</td><td class="num"><b>' + money(x.new_price) + '</b></td><td>' + prType(x) + '</td><td>' + esc(x.by) + '</td><td class="nowrap">' + fmtDT(x.at) + '</td><td class="nowrap"><button class="btn sm primary" data-act="pr-ok" data-id="' + esc(x.id) + '">Approve</button><button class="btn sm" data-act="pr-no" data-id="' + esc(x.id) + '" data-confirm="Reject?">Reject</button></td></tr>'), 9) });
    return h;
  }

  // ---- Escalations: the first ones that are mine to clear, then the second ones ----
  if (tab === 'esc') {
    if (l1mine && typeof escL1Card === 'function') h += escL1Card(me);
    h += '<div class="sa-lbl">Second escalations — only you can close these</div>' + saCard({ title: '2nd escalations', n: l2.length, tone: 'bad', ico: 'alert', link: '#/escalations', linkText: 'All escalations', empty: 'No second escalation open', note: 'A first escalation that ran one working day past its new date lands here.', body:
      tbl('sa_esc2', ['Ticket', 'Task', 'Reference', 'Doer', 'Planned', 'New date', ''], l2.map(e => '<tr><td><b>' + esc(e.no) + '</b></td><td>' + esc(e.task) + '<div class="muted small">' + esc(e.src) + '</div></td><td>' + (e.link ? '<a href="' + esc(e.link) + '">' + esc(e.ref) + '</a>' : esc(e.ref)) + '</td><td>' + esc(e.doer) + '</td><td class="nowrap">' + fmtDT(e.planned) + '</td><td class="nowrap">' + (e.commit_at ? fmtDT(e.commit_at) : '') + '</td><td><button class="btn sm primary" data-act="esc-resolve" data-id="' + esc(e.id) + '">Resolve</button></td></tr>'), 7) });
    if (l1n && !l1mine) h += '<div class="muted small">' + l1n + ' first escalation(s) are open with their Level 1 owner — they come to you after one working day. <a href="#/escalations">See all</a></div>';
    return h;
  }

  // ---- Money, Excess, Score, My requests: each is a whole tab of its own ----
  if (tab === 'mny') return h + (typeof pfHtml === 'function' ? pfHtml() : '');
  if (tab === 'exc') return h + (typeof saExcessHtml === 'function' ? saExcessHtml() : '');
  if (tab === 'score') return h + sxHtml();
  if (tab === 'req') return h + myRequestsCard(names || new Set());

  // ---- Delay: who is holding work up, which process is slow ----
  const byDoer = {};
  delayed.forEach(t => { const k = t.doer || 'NOT SET'; const x = byDoer[k] || (byDoer[k] = { doer: k, dept: t.dept, n: 0, sum: 0, max: 0, top: '' }); x.n++; x.sum += t.delay; if (t.delay > x.max) { x.max = t.delay; x.top = t.task + (t.ref ? ' · ' + t.ref : ''); } });
  const dRows = Object.values(byDoer).sort((a, b) => b.sum - a.sum);
  const f = new Date(SA_UI.from + 'T00:00:00'), tt = new Date(SA_UI.to + 'T23:59:59'); const byProc = {};
  tasks.filter(t => !t.demo && !t.dup && t.doer !== 'SYSTEM' && t.planned && t.planned >= f && t.planned <= tt && (t.done || t.planned <= now)).forEach(t => {
    const name = t.proc || t.task; const k = t.src + '|' + name; const x = byProc[k] || (byProc[k] = { src: t.src, task: name, total: 0, done: 0, late: 0, dsum: 0, open: 0, osum: 0, pend: 0 });
    x.total++; if (t.done) { x.done++; if (t.late) { x.late++; x.dsum += t.delay; } } else { x.pend++; if (t.late) { x.open++; x.osum += t.delay; } }
  });
  const pRows = Object.values(byProc).sort((a, b) => (b.open + b.late) - (a.open + a.late) || b.pend - a.pend || b.total - a.total);
  h += '<div class="sa-lbl">Where the delay is</div><div class="sa-stack"><div>' + saCard({ title: 'Held up by person', n: dRows.length, tone: 'bad', ico: 'person', link: '#/alltasks', linkText: 'Tasks', empty: 'Nobody is holding work up', note: 'Open delayed tasks added up, longest first. Click a row for that person\'s full summary.', body:
    tbl('sa_doer', ['Doer', 'Department', 'Delayed', 'Total delay', 'Longest', 'Longest task'], dRows.map(x => '<tr class="click" data-act="sc-open" data-d="' + esc(x.doer === 'NOT SET' ? '' : x.doer) + '"><td><b>' + (x.doer === 'NOT SET' ? '<span class="late-txt">Not set</span>' : esc(x.doer)) + '</b></td><td>' + esc(x.dept || '') + '</td><td class="num">' + x.n + '</td><td class="num late-txt">' + fmtDelay(x.sum) + '</td><td class="num">' + fmtDelay(x.max) + '</td><td>' + esc(x.top) + '</td></tr>'), 6) }) + '</div>' +
    '<div>' + saCard({ title: 'By process', n: pRows.filter(x => x.open || x.late).length, ico: 'flow', sub: fmtD(SA_UI.from) + ' – ' + fmtD(SA_UI.to), always: true, empty: 'No task in this period', note: 'Every process: how many tasks it had, how many got done, how many did not. Source FMS = flow steps, NEXUS = tasks the system raises.', body:
    tbl('sa_proc', ['Process', 'Source', 'Total', 'Done', 'Not done', 'Late %', 'Avg delay (done late)', 'Open late', 'Avg delay (open)'], pRows.map(x => '<tr><td><b>' + esc(x.task) + '</b></td><td>' + esc(x.src) + '</td><td class="num">' + x.total + '</td><td class="num">' + x.done + '</td><td class="num' + (x.pend ? ' late-txt' : '') + '">' + x.pend + '</td><td class="num">' + Math.round((x.late + x.open) * 100 / x.total) + '%</td><td class="num">' + (x.late ? fmtDelay(Math.round(x.dsum / x.late)) : '') + '</td><td class="num' + (x.open ? ' late-txt' : '') + '">' + x.open + '</td><td class="num">' + (x.open ? fmtDelay(Math.round(x.osum / x.open)) : '') + '</td></tr>'), 9) }) + '</div></div>';
  return h;
}

/* ================= My requests: what I sent for approval and what happened ================= */
// one row per request: { kind, ref, party, detail, at, status, by, when, remark, hist:[{at, by, what}] }
function myRequests(names) {
  const mine = n => n && names.has(n); const out = [];
  const st = s => s === 'Approved' || s === 'Accepted' ? 'Approved' : s === 'Rejected' ? 'Rejected' : s === 'Amend' ? 'Amend' : s === 'Hold' ? 'Hold' : 'Pending';
  const push = (x, hist) => { x.hist = hist.filter(h => h.at).sort((a, b) => a.at < b.at ? -1 : 1); x.status = st(x.status); out.push(x); };
  Store.all('purchase_orders').filter(p => mine(p.created_by) && !p.cancelled).forEach(p => {
    const done = p.approval === 'Approved' || p.approval === 'Rejected'; const last = (p.amend_log || []).slice(-1)[0];
    push({ kind: 'PO Approval', ref: p.no, party: p.vendor, detail: (p.lines || []).length + ' item(s)', at: p.at || p.created_at || p.date, status: p.approval, by: done ? p.approved_by : p.approval === 'Amend' && last ? last.by : '', when: done ? p.approved_at : p.approval === 'Amend' && last ? last.at : '', remark: p.approval === 'Rejected' ? p.reject_remark : p.approval === 'Amend' && last ? last.remark : '', link: '#/poapproval' },
      [{ at: p.at || p.created_at, by: p.created_by, what: 'Sent for approval' }].concat((p.amend_log || []).map(a => ({ at: a.at, by: a.by, what: 'Amend — ' + (a.remark || '') })))
        .concat(done ? [{ at: p.approved_at, by: p.approved_by, what: p.approval + (p.reject_remark ? ' — ' + p.reject_remark : '') }] : []));
  });
  Store.all('inwards').forEach(i => {
    if (mine(i.by)) {
      const done = i.inv_status === 'Approved' || i.inv_status === 'Rejected';
      push({ kind: 'Invoice Approval', ref: i.no, party: i.vendor, detail: 'Invoice ' + (i.bill_no || ''), at: i.at, status: i.inv_status, by: done ? i.inv_by : i.inv_status === 'Hold' ? i.inv_hold_by : '', when: done ? i.inv_at : i.inv_hold_at || '', remark: i.inv_status === 'Rejected' ? i.inv_reject_reason : i.inv_status === 'Hold' ? i.inv_hold_reason : '', link: '#/invapproval' },
        [{ at: i.at, by: i.by, what: 'Gate entry sent for invoice approval' }].concat(i.inv_hold_at ? [{ at: i.inv_hold_at, by: i.inv_hold_by, what: 'Hold — ' + (i.inv_hold_reason || '') }] : [])
          .concat((i.amend_log || []).map(a => ({ at: a.at, by: a.by, what: 'Amend — ' + (a.remark || '') }))).concat(done ? [{ at: i.inv_at, by: i.inv_by, what: i.inv_status + (i.inv_reject_reason ? ' — ' + i.inv_reject_reason : '') }] : []));
    }
    (i.qc || []).filter(q => q.result === 'Mismatch' && mine(q.by)).forEach(q => {
      push({ kind: 'Swatch Approval', ref: i.no, party: i.vendor, detail: q.material, at: q.at, status: q.m_status === 'Approved' || q.m_status === 'Match' ? 'Approved' : q.m_status === 'Amend' ? 'Amend' : q.m_status ? 'Rejected' : '', by: q.m_by || '', when: q.m_at || '', remark: q.m_note || '', link: '#/swatch' },
        [{ at: q.at, by: q.by, what: 'QC mismatch sent for swatch approval' }].concat(q.m_status ? [{ at: q.m_at, by: q.m_by, what: q.m_status + (q.m_note ? ' — ' + q.m_note : '') }] : []));
    });
  });
  Store.all('grns').filter(g => mine(g.by)).forEach(g => (g.lines || []).filter(l => num(l.excess) > 0 && l.excess_status).forEach(l => {
    const done = l.excess_status === 'Approved' || l.excess_status === 'Rejected';
    push({ kind: 'Excess Approval', ref: g.no, party: g.vendor, detail: l.material + ' × ' + qtyFmt(l.excess), at: g.at || g.date, status: l.excess_status, by: done ? l.excess_by : '', when: done ? l.excess_at : '', remark: ((l.amend_log || []).slice(-1)[0] || {}).remark || '', link: '#/excessapproval' },
      [{ at: g.at, by: g.by, what: 'Excess ' + qtyFmt(l.excess) + ' sent for approval' }].concat((l.amend_log || []).map(a => ({ at: a.at, by: a.by, what: (a.stage || 'Amend') + ' — ' + (a.remark || '') })))
        .concat(done ? [{ at: l.excess_at, by: l.excess_by, what: l.excess_status }] : []));
  }));
  Store.all('issues').filter(i => i.req_no && !i.type && mine(i.by)).forEach(i => {
    const by = i.approved_by || i.decided_by || '', when = i.approved_at || i.decided_at || '';
    push({ kind: 'Issuance Approval', ref: i.no, party: i.req_no, detail: (i.material || '') + ' × ' + qtyFmt(i.qty), at: i.at || i.date, status: i.status, by, when, remark: i.decision_note || '', link: '#/issuance' },
      [{ at: i.at, by: i.by, what: 'Issue sent for approval' }].concat(when ? [{ at: when, by, what: i.status + (i.decision_note ? ' — ' + i.decision_note : '') }] : []));
  });
  Store.all('tickets').filter(t => mine(t.by)).forEach(t => {
    push({ kind: 'Ticket', ref: t.no, party: t.dept, detail: t.subject, at: t.at, status: t.status === 'Closed' ? 'Approved' : '', by: t.closed_by || '', when: t.closed_at || '', remark: ((t.comments || []).slice(-1)[0] || {}).note || '', link: '#/tickets', closed: t.status === 'Closed' },
      [{ at: t.at, by: t.by, what: 'Raised' }].concat((t.comments || []).map(c => ({ at: c.at, by: c.by, what: c.note }))).concat(t.closed_at ? [{ at: t.closed_at, by: t.closed_by, what: 'Closed' }] : []));
  });
  // every other thing a person sends for someone's decision
  const mname = c => ((matBy(c) || {}).name || c);
  Store.all('price_requests').filter(x => mine(x.by)).forEach(x => {
    const done = x.status === 'Approved' || x.status === 'Rejected';
    push({ kind: 'Price Approval', ref: x.no, party: x.source + (x.ref ? ' ' + x.ref : ''), detail: mname(x.material) + ' ₹' + money(x.old_price) + ' → ₹' + money(x.new_price), at: x.at, status: x.status, by: done ? x.approved_by : '', when: done ? x.approved_at : '', remark: '', link: '#/priceapproval' },
      [{ at: x.at, by: x.by, what: 'Price sent for approval' }].concat(done ? [{ at: x.approved_at, by: x.approved_by, what: x.status }] : []));
  });
  Store.all('boms').filter(b => mine(b.by) && b.status !== 'Superseded').forEach(b => {
    const done = b.status === 'Final' || b.status === 'Rejected';
    push({ kind: 'BOM Approval', ref: b.article + ' v' + b.version, party: b.brand || '', detail: (b.colour ? b.colour + ' · ' : '') + (b.lines || []).length + ' items', at: b.at, status: b.status === 'Final' ? 'Approved' : b.status, by: done ? (b.approved_by || b.rejected_by || '') : '', when: done ? (b.approved_at || b.rejected_at || '') : '', remark: b.reject_why || '', link: '#/boms' },
      [{ at: b.at, by: b.by, what: 'BOM sent for the Development Head\'s approval' }].concat(done ? [{ at: b.approved_at || b.rejected_at, by: b.approved_by || b.rejected_by, what: (b.status === 'Final' ? 'Approved' : 'Rejected') + (b.reject_why ? ' — ' + b.reject_why : '') }] : []));
  });
  Store.all('stock_adj').filter(a => mine(a.by)).forEach(a => {
    const done = a.status === 'Approved' || a.status === 'Rejected';
    push({ kind: 'Stock Adjustment', ref: a.no, party: a.src || '', detail: mname(a.material) + ' ' + (a.qty > 0 ? '+' : '') + qtyFmt(a.qty) + ' ' + (a.uom || '') + (a.reason ? ' · ' + a.reason : ''), at: a.at, status: a.status, by: done ? a.decided_by : '', when: done ? a.decided_at : '', remark: a.reject_reason || '', link: '#/stockadj' },
      [{ at: a.at, by: a.by, what: 'Adjustment sent for approval' }].concat(done ? [{ at: a.decided_at, by: a.decided_by, what: a.status + (a.reject_reason ? ' — ' + a.reject_reason : '') }] : []));
  });
  Store.all('opening_stock').filter(x => mine(x.by)).forEach(x => {
    const done = x.status === 'Approved' || x.status === 'Rejected';
    push({ kind: 'Opening Stock', ref: x.no, party: x.rack || '', detail: mname(x.material) + ' × ' + qtyFmt(x.qty) + ' ' + (x.uom || ''), at: x.at, status: x.status, by: done ? x.approved_by : '', when: done ? x.approved_at : '', remark: '', link: '#/openstock' },
      [{ at: x.at, by: x.by, what: 'Opening stock sent for approval' }].concat(done ? [{ at: x.approved_at, by: x.approved_by, what: x.status }] : []));
  });
  Store.all('kits').filter(k => mine(k.built_by) && ['Built', 'Approved', 'Issued', 'Planned'].includes(k.status) && k.built_at).forEach(k => {
    const ok = k.status === 'Approved' || k.status === 'Issued'; const back = k.status === 'Planned' && k.sent_back;
    push({ kind: 'Kit Approval', ref: k.no, party: k.jc_no, detail: k.process + ' · ' + (k.lines || []).length + ' items', at: k.built_at, status: ok ? 'Approved' : back ? 'Amend' : 'Pending', by: ok ? k.approved_by : '', when: ok ? k.approved_at : '', remark: back ? k.sent_back : '', link: '#/kits' },
      [{ at: k.built_at, by: k.built_by, what: 'Kit built — sent to PPC for approval' }].concat(ok ? [{ at: k.approved_at, by: k.approved_by, what: 'Approved — kit locked' }] : []).concat(back ? [{ at: k.updated_at || k.built_at, by: '', what: 'Sent back — ' + k.sent_back }] : []));
  });
  Store.all('feedback').filter(f => mine(f.by)).forEach(f => {
    const done = f.status && f.status !== 'Open';
    push({ kind: 'Feedback', ref: f.no, party: f.screen_name || '', detail: f.kind + ' · ' + String(f.what || '').slice(0, 80), at: f.at, status: done ? (f.status === 'Done' ? 'Approved' : f.status === 'Not now' ? 'Rejected' : 'Hold') : 'Pending', by: done ? f.decided_by : '', when: done ? f.decided_at : '', remark: done ? f.status : '', link: '#/feedback' },
      [{ at: f.at, by: f.by, what: 'Feedback sent' }].concat(done ? [{ at: f.decided_at, by: f.decided_by, what: f.status }] : []));
  });
  out.forEach(x => { if (x.kind === 'Ticket' && x.closed) x.status = 'Closed'; });
  return out.sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
}
const MR_UI = { f: 'Pending' };
let MR_ROWS = [];
function myRequestsCard(names) {
  const all = myRequests(names); MR_ROWS = all;
  const n = k => k === 'all' ? all.length : all.filter(x => x.status === k || (k === 'Approved' && x.status === 'Closed')).length;
  const rows = all.filter(x => MR_UI.f === 'all' || x.status === MR_UI.f || (MR_UI.f === 'Approved' && x.status === 'Closed') || (MR_UI.f === 'Pending' && (x.status === 'Hold' || x.status === 'Amend')));
  const cls = { Pending: 'Pending', Hold: 'Pending', Amend: 'Late', Approved: 'Done', Closed: 'Done', Rejected: 'Cancelled' };
  if (!all.length) return '<div class="sa-lbl">My requests</div><div class="dcard sa-ok"><div class="dh3 sa-h"><span class="sa-hi ok">' + saIco('check') + '</span><b>My requests</b><span class="grow"></span></div><div class="sa-clear">You have nothing waiting with anyone</div></div>';
  return '<div class="sa-lbl">My requests</div><div class="dcard"><div class="dh3 sa-h"><span class="sa-hi warn">' + saIco('file') + '</span><b>My requests</b><span class="grow"></span>' + seg('mrf', [{ v: 'Pending', l: 'Pending ' + (n('Pending') + n('Hold') + n('Amend')) }, { v: 'Approved', l: 'Approved ' + n('Approved') }, { v: 'Rejected', l: 'Rejected ' + n('Rejected') }, { v: 'all', l: 'All ' + n('all') }], MR_UI.f) + '</div>' +
    '<div class="tbl-wrap"><table data-pg="home_requests"><tr><th>Request</th><th>Reference</th><th>Party</th><th>Detail</th><th>Sent on</th><th>Status</th><th>By</th><th>On</th><th>Remark</th><th></th></tr>' +
    (rows.length ? rows.map(x => '<tr><td>' + esc(x.kind) + '</td><td><a href="' + esc(x.link) + '"><b>' + esc(x.ref) + '</b></a></td><td>' + esc(x.party || '') + '</td><td>' + esc(x.detail || '') + '</td><td class="nowrap">' + fmtDT(x.at) + '</td>' +
      '<td><span class="st ' + (cls[x.status] || 'Waiting') + '">' + esc(x.status) + '</span></td><td>' + esc(x.by || '') + '</td><td class="nowrap">' + (x.when ? fmtDT(x.when) : '') + '</td><td>' + esc(x.remark || '') + '</td><td><a class="small" data-act="mr-hist" data-i="' + all.indexOf(x) + '">History</a></td></tr>').join('')
      : '<tr><td colspan="10" class="empty">No requests</td></tr>') + '</table></div></div>';
}
ACTIONS['mr-hist'] = el => {
  const x = MR_ROWS[+el.dataset.i]; if (!x) return;
  const aud = Store.all('audit').filter(a => a.ref === x.ref).map(a => ({ at: a.at, by: a.user, what: a.action + (a.detail ? ' — ' + a.detail : '') }));
  const seen = new Set(); const list = x.hist.concat(aud).sort((a, b) => a.at < b.at ? -1 : 1).filter(h => { const k = String(h.at).slice(0, 16) + '|' + h.by; if (seen.has(k + h.what)) return false; seen.add(k + h.what); return true; });
  formDialog(x.kind + ' · ' + x.ref, [{ k: 'log', l: 'Log', type: 'static', value: '' }], 'Close', () => {});
  const d = $('#fxDlg'); if (d) $('.jckv', d).innerHTML = '<tr class="hd"><th>When</th><th>By</th><th>What</th></tr>' + list.map(h => '<tr><td class="nowrap">' + fmtDT(h.at) + '</td><td>' + esc(h.by || '') + '</td><td>' + esc(h.what) + '</td></tr>').join('');
};
