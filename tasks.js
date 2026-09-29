/* Nexus 2.0 — one place for every task (FMS steps, Checklist / Delegation, Nexus activities),
   delay escalation tickets (Level 1 → new date → Level 2) and the employee scorecard (old MIS formula). */
'use strict';

/* ================= Nexus activity doers ================= */
// settings().act_doer[k] = [{ doer, field: ''|'vendor'|'brand', value }]; the first matching rule wins, an empty field is the default.
const ACT_LINK = { po_raise: 'po', po_approval: 'poapproval', inward: 'inward', invoice: 'invapproval', qc: 'swatchmatch', swatch: 'swatch', grn: 'grn', excess: 'excessapproval', issuance: 'issuance', issue_approval: 'issuance', rtv: 'rtv' };
const ACT_FIELD = { po_raise: 'brand', po_approval: 'vendor', inward: 'vendor', invoice: 'vendor', qc: 'vendor', swatch: 'vendor', grn: 'vendor', excess: 'vendor', issuance: '', issue_approval: '', rtv: 'vendor' };
function actRules(k) { return ((settings().act_doer || {})[k] || []).filter(r => r.doer); }
function actDoer(r) {
  const rules = actRules(r.k);
  const hit = rules.find(x => x.field && x.value && norm(x.value) === norm(r.party)) || rules.find(x => !x.field);
  if (hit) return hit.doer;
  if ((r.owners || []).length) return String(r.owners[0]).toUpperCase();
  return '';
}
function userByName(n) { return Store.all('users').find(u => norm(u.name) === norm(n)) || null; }
function doerOfName(n) { const u = userByName(n); return u && u.doer ? u.doer.toUpperCase() : String(n || '').toUpperCase(); }
function userOfDoer(d) { return Store.all('users').find(u => u.doer && norm(u.doer) === norm(d)) || null; }
function deptOfDoer(d) { const u = userOfDoer(d); return u ? u.department || '' : ''; }
function allDoers() { return Array.from(new Set(Store.all('users').filter(u => u.active !== false && u.doer).map(u => u.doer.toUpperCase()))).sort(); }

/* ================= all tasks, one row each ================= */
// { key, src, task, ref, party, doer, dept, planned, actual, done, late, delay, status, link, demo }
let AT_CACHE = { t: 0, rows: null };
function allTasks(force) {
  if (!force && AT_CACHE.rows && Date.now() - AT_CACHE.t < 15000) return AT_CACHE.rows;
  const now = new Date(); const cal = calInfo(); const out = [];
  const wm = (a, b) => { try { return cal.workMinutesBetween(a, b); } catch (e) { return Math.round((b - a) / 60000); } };
  const push = x => {
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
      const s = r.steps[id]; if (!s || !['Pending', 'Late', 'Done'].includes(s.status)) return;
      push({ key: 'fms|' + o.id + '|' + id, src: label, task: s.name, ref: o.no, party: o.customer_name || o.brand || '', doer: String(s.doer || (s.actual ? doerOfName((o.done_by || {})[id]) : '') || '').toUpperCase(), by: (o.done_by || {})[id] || '',
        owner: String(s.doer || '').toUpperCase(), planned: s.planned ? new Date(s.planned) : null, actual: s.actual ? new Date(s.actual) : null, link: '#/order/' + o.id });
    });
  });
  // Checklist / Delegation (last 90 days up to next 7)
  clRows(ymdOf(new Date(Date.now() - 90 * 86400000)), ymdOf(new Date(Date.now() + 7 * 86400000))).forEach(r => {
    push({ key: 'cl|' + r.t.id + '|' + r.ymd, src: r.type, task: r.task, ref: r.type === 'Delegation' ? '' : r.freq, party: r.t.party || '', doer: String(r.doer || '').toUpperCase(), owner: String(r.doer || '').toUpperCase(),
      planned: r.planned, actual: r.actual, link: '#/checklist', demo: !!r.t.demo });
  });
  // Nexus activities
  paRows().forEach(r => {
    if (!r.planned || r.status === 'Waiting') return;
    const owner = actDoer(r);
    push({ key: 'pa|' + r.k + '|' + r.ref, src: 'Nexus', task: r.act, ref: r.ref, party: r.party || '', doer: owner || (r.actual ? doerOfName(r.by) : ''), owner, by: r.by || '',
      planned: r.planned, actual: r.actual || null, link: '#/' + (ACT_LINK[r.k] || 'planactual'), grp: paDef(r.k).grp, k: r.k });
  });
  AT_CACHE = { t: Date.now(), rows: out };
  return out;
}
function tasksOf(doer) { return allTasks().filter(t => norm(t.doer) === norm(doer)); }

/* ================= escalations ================= */
const ESC_DEF = { after: 510 };   // working minutes of delay before Level 1 = 1 working day (09:00–17:30)
function escCfg() { return Object.assign({}, ESC_DEF, settings().esc || {}); }
function escL2() { const c = escCfg(); if (c.l2) return c.l2; const u = Store.all('users').find(x => x.active !== false && x.role_id === 'r_admin' && x.doer); return u ? u.doer.toUpperCase() : ''; }
function escL1(doer) {
  const c = escCfg(); const dept = deptOfDoer(doer);
  if (dept && (c.l1 || {})[dept]) return c.l1[dept];
  const head = Store.all('users').find(u => u.active !== false && u.doer && norm(u.doer) !== norm(doer) && dept && u.department === dept && /HEAD|MANAGER|INCHARGE/i.test(u.designation || ''));
  return head ? head.doer.toUpperCase() : escL2();
}
function escHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36).toUpperCase(); }
// involved = the doer, the Level 1 owner, and the Level 2 owner once the ticket reaches Level 2
function escInvolved(t, doer) { if (!doer) return false; const d = norm(doer); return norm(t.doer || '') === d || norm(t.l1 || '') === d || (t.level === 2 && norm(t.l2 || '') === d); }
function escCanAct(t, level) { if (isSuperAdmin()) return true; const me = ME && ME.doer; return level === 1 ? escInvolved(t, me) : norm(t.l2) === norm(me || ''); }
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
      if ((due && now > due) || (!due && wm(new Date(e.raised_at), now) > cfg.after)) {
        e.level = 2; e.l2_at = nowIso();
        e.history = (e.history || []).concat([{ at: nowIso(), by: 'System', what: 'Level 2 — ' + (due ? 'not done by new date ' + fmtDT(due) : 'no new date given in 1 working day') }]); ch = true;
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
  if (!(isSuperAdmin() || (e.level === 2 && norm(e.l2) === norm(ME.doer || '')))) { flash('Level 2 owner resolves this.', 'err'); return; }
  formDialog(e.no + ' · Resolve', [{ k: 'why', l: 'Resolution', type: 'textarea', req: true }], 'Resolve', v => {
    e.status = 'Resolved'; e.resolved_at = nowIso(); e.result = 'Resolved by ' + ME.name; e.resolution = v.why; escLog(e, 'Resolved — ' + v.why);
    Store.put('escalations', e); audit('escalation.resolve', e.no, v.why); route();
  });
};

/* ================= scorecard (old MIS formula) ================= */
// score = -(100 - quality); quality = weighted Completion%, On-time%, Volume%, Consistency%. 0 is best.
const SCORE_W = { completion: 0.35, onTime: 0.35, volume: 0.15, consistency: 0.15 };
function scoreW() { return Object.assign({}, SCORE_W, settings().score_w || {}); }
function scoreRows(from, to, rowsIn) {
  const f = from ? new Date(from + 'T00:00:00') : null, tt = to ? new Date(to + 'T23:59:59') : null; const now = new Date();
  const rows = (rowsIn || allTasks()).filter(t => t.planned && t.doer && t.doer !== 'SYSTEM' && !t.demo && (!f || t.planned >= f) && (!tt || t.planned <= tt) && (t.done || t.planned <= now));
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
function scoreOf(doer, days) { const r = scoreRows(ymdOf(new Date(Date.now() - (days || 30) * 86400000)), todayYmd()).find(x => norm(x.doer) === norm(doer)); return r || null; }
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
        (!q || norm([x.task, x.ref, x.party, x.doer].join(' ')).includes(q))).sort((a, b) => (b.delay - a.delay) || ((a.planned || 0) - (b.planned || 0)));
      VIEWS.alltasks.rows = rows;
      const srcs = Array.from(new Set(allTasks().map(x => x.src))).sort(); const depts = Array.from(new Set(allTasks().map(x => x.dept).filter(Boolean))).sort();
      h += '<div class="toolbar">' + seg('atSt', [{ v: 'open', l: 'Open' }, { v: 'delayed', l: 'Delayed' }, { v: 'upcoming', l: 'Upcoming' }, { v: 'done', l: 'Done' }, { v: 'late', l: 'Late' }, { v: 'all', l: 'All' }], AT_UI.st) +
        '<select id="atSrc">' + selOpts(srcs, AT_UI.src, 'All sources') + '</select>' + (all ? '<select id="atWho">' + selOpts(allDoers(), AT_UI.who, 'All doers') + '</select><select id="atDept">' + selOpts(depts, AT_UI.dept, 'All departments') + '</select>' : '') +
        '<input id="atFrom" type="date" value="' + esc(AT_UI.from) + '"><input id="atTo" type="date" value="' + esc(AT_UI.to) + '"><input id="atQ" placeholder="Search…" value="' + esc(AT_UI.q) + '"><span class="muted small">' + rows.length + ' task(s)</span><span class="grow"></span><button class="btn" data-act="at-csv">Export CSV</button></div>';
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Source</th><th>Task</th><th>Reference</th><th>Party</th><th>Doer</th><th>Department</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th>Escalation</th><th></th></tr>' +
        (rows.length ? rows.map(x => { const e = escBy.get(x.key);
          return '<tr><td>' + esc(x.src) + '</td><td>' + esc(x.task) + '</td><td><b>' + esc(x.ref) + '</b></td><td>' + esc(x.party) + '</td><td>' + (x.doer ? esc(x.doer) : '<span class="late-txt">Not set</span>') + '</td><td>' + esc(x.dept) + '</td>' +
            '<td class="nowrap">' + (x.planned ? fmtDT(x.planned) : '') + '</td><td class="nowrap">' + (x.actual ? fmtDT(x.actual) : '') + '</td><td><span class="st ' + (x.status === 'Done on time' ? 'Done' : x.status === 'Done late' ? 'Pending' : x.status === 'Delayed' ? 'Late' : x.status === 'Pending' ? 'Pending' : 'Waiting') + '">' + x.status + '</span></td>' +
            '<td class="num' + (x.delay ? ' late-txt' : '') + '">' + (x.delay ? fmtDelay(x.delay) : '') + '</td><td>' + (e ? '<a href="#/escalations">' + esc(e.no) + ' · L' + e.level + (e.status === 'Open' ? '' : ' ✓') + '</a>' : '') + '</td><td><a href="' + esc(x.link) + '">Open</a></td></tr>'; }).join('')
          : '<tr><td colspan="12" class="empty">No tasks</td></tr>') + '</table></div>';
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
ACTIONS['at-csv'] = () => downloadCsv('all-tasks-' + todayYmd() + '.csv', [['Source', 'Task', 'Reference', 'Party', 'Doer', 'Department', 'Planned', 'Actual', 'Status', 'Delay (min)']]
  .concat((VIEWS.alltasks.rows || []).map(x => [x.src, x.task, x.ref, x.party, x.doer, x.dept, x.planned ? fmtDT(x.planned) : '', x.actual ? fmtDT(x.actual) : '', x.status, x.delay || 0])));

// Doer Setup: who does each Nexus activity (default + by vendor / brand)
function atSetupHtml() {
  const doers = allDoers(); const vend = Store.all('vendors').map(v => v.name).sort(); const brands = Store.all('customers').map(c => c.name).sort();
  const cfg = settings().act_doer || {};
  return '<div class="tbl-wrap"><table class="nopage"><tr><th>Activity</th><th>Starts when</th><th>TAT</th><th>Rule</th><th>Vendor / Brand</th><th>Doer</th><th></th></tr>' +
    PA_DEFS.map(d => {
      const rules = (cfg[d.k] || []); const fld = ACT_FIELD[d.k]; const list = fld === 'brand' ? brands : vend; const t = paTat(d.k);
      const def = rules.find(r => !r.field) || { doer: '' };
      let rows = '<tr class="bomfirst"><td rowspan="' + (rules.filter(r => r.field).length + 1 + (fld ? 1 : 0)) + '"><b>' + esc(d.l) + '</b></td><td rowspan="' + (rules.filter(r => r.field).length + 1 + (fld ? 1 : 0)) + '" class="small">' + esc(PA_START[d.k] || '') + '</td><td rowspan="' + (rules.filter(r => r.field).length + 1 + (fld ? 1 : 0)) + '" class="nowrap">' + esc(t.value + ' ' + t.unit) + '</td>' +
        '<td>Default</td><td></td><td><select data-adr="' + d.k + '" data-i="def">' + selOpts(doers, def.doer, 'Not set') + '</select></td><td></td></tr>';
      rules.forEach((r, i) => { if (!r.field) return; rows += '<tr><td>' + (r.field === 'brand' ? 'Brand' : 'Vendor') + '</td><td>' + esc(r.value) + '</td><td><select data-adr="' + d.k + '" data-i="' + i + '">' + selOpts(doers, r.doer, 'Not set') + '</select></td><td><button class="btn ghost sm danger" data-act="adr-del" data-k="' + d.k + '" data-i="' + i + '">×</button></td></tr>'; });
      if (fld) rows += '<tr><td>' + (fld === 'brand' ? 'Brand' : 'Vendor') + '</td><td><select data-adv="' + d.k + '">' + selOpts(list, '', 'Add ' + (fld === 'brand' ? 'brand' : 'vendor') + '…') + '</select></td><td><select data-adn="' + d.k + '">' + selOpts(doers, '', 'Doer…') + '</select></td><td><button class="btn sm" data-act="adr-add" data-k="' + d.k + '">Add</button></td></tr>';
      return rows;
    }).join('') + '</table></div>';
}
function atSaveRule(sel) {
  if (!isAdminRole()) return; const st = settings(); st.act_doer = st.act_doer || {}; const k = sel.dataset.adr; const list = (st.act_doer[k] = st.act_doer[k] || []);
  if (sel.dataset.i === 'def') { const d = list.find(r => !r.field); if (d) d.doer = sel.value; else list.push({ field: '', value: '', doer: sel.value }); }
  else list[+sel.dataset.i].doer = sel.value;
  Store.setSettings(st); AT_CACHE.t = 0; audit('settings.act_doer', paDef(k).l, sel.value || 'Not set'); flash('Saved.');
}
ACTIONS['adr-add'] = el => {
  if (!isAdminRole()) return; const k = el.dataset.k; const v = $('[data-adv="' + k + '"]').value, d = $('[data-adn="' + k + '"]').value;
  if (!v || !d) { flash('Pick the ' + (ACT_FIELD[k] || 'value') + ' and the doer.', 'err'); return; }
  const st = settings(); st.act_doer = st.act_doer || {}; const list = (st.act_doer[k] = st.act_doer[k] || []);
  if (list.some(r => r.field && norm(r.value) === norm(v))) { flash(esc(v) + ' already has a rule.', 'err'); return; }
  list.push({ field: ACT_FIELD[k], value: v, doer: d }); Store.setSettings(st); AT_CACHE.t = 0; audit('settings.act_doer', paDef(k).l, v + ' → ' + d); VIEWS.alltasks.render();
};
ACTIONS['adr-del'] = el => {
  if (!isAdminRole()) return; const st = settings(); const list = (st.act_doer || {})[el.dataset.k] || []; const r = list.splice(+el.dataset.i, 1)[0];
  Store.setSettings(st); AT_CACHE.t = 0; audit('settings.act_doer', paDef(el.dataset.k).l, 'removed ' + (r ? r.value : '')); VIEWS.alltasks.render();
};

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
          const acts = e.status !== 'Open' ? '' : (e.level === 1 && !e.commit_at && escCanAct(e, 1) ? '<button class="btn sm" data-act="esc-date" data-id="' + esc(e.id) + '">New date</button> ' : '') + ((isSuperAdmin() || (e.level === 2 && norm(e.l2) === norm(me))) ? '<button class="btn sm primary" data-act="esc-resolve" data-id="' + esc(e.id) + '">Resolve</button>' : '');
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
      if (t.id === 'escL2') { st.esc.l2 = t.value; audit('settings.escalation', 'Level 2', t.value || 'Super Admin'); }
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
  const c = escCfg(); const doers = allDoers();
  const depts = Array.from(new Set(Store.all('users').map(u => u.department).filter(Boolean))).sort();
  return '<div class="panel" style="max-width:760px"><table class="jckv">' +
    '<tr><td class="k">Level 1 after delay of</td><td class="v"><select id="escAfter">' + [0.5, 1, 2, 3].map(x => '<option value="' + x + '"' + (Math.abs(c.after / 510 - x) < 0.01 ? ' selected' : '') + '>' + x + ' working day' + (x > 1 ? 's' : '') + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Level 2 owner</td><td class="v"><select id="escL2">' + selOpts(doers, (settings().esc || {}).l2 || '', 'Super Admin (' + escL2() + ')') + '</select></td></tr></table></div>' +
    '<div class="tbl-wrap"><table class="nopage"><tr><th>Department</th><th>Level 1 owner</th><th>Auto (head / manager)</th></tr>' +
    depts.map(d => { const auto = (Store.all('users').find(u => u.department === d && u.active !== false && u.doer && /HEAD|MANAGER|INCHARGE/i.test(u.designation || '')) || {}).doer || escL2();
      return '<tr><td>' + esc(d) + '</td><td><select data-l1d="' + esc(d) + '">' + selOpts(doers, (c.l1 || {})[d] || '', 'Auto') + '</select></td><td class="muted">' + esc(String(auto).toUpperCase()) + '</td></tr>'; }).join('') + '</table></div>';
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
ACTIONS['sc-open'] = el => { AT_UI.who = el.dataset.d; AT_UI.st = 'all'; AT_UI.from = SC_UI.from; AT_UI.to = SC_UI.to; AT_UI.tab = 'tasks'; go('alltasks'); };
ACTIONS['sc-csv'] = () => downloadCsv('scorecard-' + todayYmd() + '.csv', [['Doer', 'Department', 'Total', 'Done', 'On Time', 'Late', 'Pending', 'Overdue', 'Completion %', 'On-time %', 'Volume', 'Consistency', 'Score', 'Escalations', 'Level 2']]
  .concat((VIEWS.scorecard.rows || []).map(r => [r.doer, r.dept, r.total, r.completed, r.onTime, r.late, r.pending, r.overdue, r.completionPct.toFixed(1), r.onTimePct.toFixed(1), r.volumePct.toFixed(1), r.consistencyPct.toFixed(1), r.score.toFixed(2), r.esc1, r.esc2])));
