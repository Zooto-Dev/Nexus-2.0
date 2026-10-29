/* Nexus 2.0 — EA (Executive Assistant): Delegation, MOM (minutes of meeting), CEO Decision register.
   A delegation is a one-time task for one person: it lives in the checklist collection (type Delegation) so it
   shows in the doer's My Tasks / Home and escalates like every other task. MOM action points and decision
   implementation become delegations automatically. CEO decisions are written by the Super Admin only. */
'use strict';

const EA_UI = { tab: 'delegation', f: 'open', form: false, open: null, pts: [] };
const eaEdit = () => can('ea', 'edit');
const eaDoerSel = (id, val) => '<select id="' + id + '">' + doerOpts(clDoerList(), val) + '</select>';
// every delegation (one-time task) with its live status, newest first
function eaDelegations() {
  const from = ymdOf(new Date(Date.now() - 400 * CL_DAY)), to = ymdOf(new Date(Date.now() + 400 * CL_DAY));
  return clRows(from, to, t => clRule(t).type === 'Delegation' && !t.demo).sort((a, b) => b.planned - a.planned);
}
function eaStatusHtml(r) { return '<span class="st ' + (r.status === 'Done' ? 'Done' : r.status === 'Overdue' ? 'Late' : 'Pending') + '">' + (r.status === 'Overdue' ? 'Late' : r.status) + '</span>'; }
// make one delegation task; returns the checklist record
function eaDelegate(task, doer, date, src, ref) {
  const u = clUserOf(doer);
  const r = { id: uid(), type: 'Delegation', title: task.trim(), doer, dept: u.department || '', email: u.email || '', shift: 'G', start: date, due: date, freq: 'Once', frequency: '', active: true, by: ME.name, done: {}, src: src || 'ea', ref: ref || '' };
  Store.put('checklist', r);
  audit('delegation.create', r.title, r.doer + ' · ' + fmtD(date) + (ref ? ' · ' + ref : ''));
  return r;
}
const eaPointStatus = cl => { if (!cl) return { status: 'Pending', by: '', at: '' }; const dn = clDoneOf(cl, cl.start); if (dn && dn.at) return { status: 'Done', by: dn.by, at: dn.at }; return { status: clPlanned(cl, cl.start) < new Date() ? 'Overdue' : 'Pending' }; };

VIEWS.ea = {
  mod: 'ea', render() {
    const tabs = [{ v: 'delegation', l: 'Delegation' }, { v: 'mom', l: 'MOM' }, { v: 'decision', l: 'CEO Decision' }];
    let h = '<div class="toolbar noprint">' + seg('eaTab', tabs, EA_UI.tab) + '</div>';
    h += EA_UI.tab === 'mom' ? eaMomHtml() : EA_UI.tab === 'decision' ? eaDecHtml() : eaDelHtml();
    setMain(h);
    onSeg(e => { const s = e.target.dataset.seg; if (s === 'eaTab') { EA_UI.tab = e.detail; EA_UI.form = false; EA_UI.open = null; } if (s === 'eaF') EA_UI.f = e.detail; if (s === 'eaTab' || s === 'eaF') VIEWS.ea.render(); });
  }
};

/* ---------- Delegation ---------- */
function eaDelHtml() {
  const rows = eaDelegations().filter(r => EA_UI.f === 'all' || (EA_UI.f === 'open' ? r.status !== 'Done' : r.status === 'Done'));
  let h = '<div class="toolbar noprint">' + seg('eaF', [{ v: 'open', l: 'Open' }, { v: 'done', l: 'Done' }, { v: 'all', l: 'All' }], EA_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button>' + (eaEdit() ? '<button class="btn primary" data-act="ea-del-new">+ Delegation</button>' : '') + '</div>';
  if (EA_UI.form === 'del') h += '<div class="panel" style="max-width:760px"><table class="jckv">' +
    '<tr><td class="k">Doer *</td><td class="v">' + eaDoerSel('edDoer', EA_UI.doer) + '</td></tr>' +
    '<tr><td class="k">Task *</td><td class="v"><input id="edTask" value="' + esc(EA_UI.task || '') + '"></td></tr>' +
    '<tr><td class="k">Date *</td><td class="v"><input id="edDate" type="date" value="' + esc(EA_UI.date || todayYmd()) + '"></td></tr></table>' +
    '<div class="toolbar"><button class="btn primary" data-act="ea-del-save">Assign</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Date</th><th>Task</th><th>Doer</th><th>Department</th><th>From</th><th>Delegated by</th><th>Status</th><th>Done on</th><th class="num">Delay</th><th>Remark</th>' + (eaEdit() ? '<th class="noprint"></th>' : '') + '</tr>' +
    (rows.length ? rows.map(r => '<tr><td class="nowrap">' + fmtD(r.ymd) + '</td><td>' + esc(r.task) + '</td><td>' + esc(r.doer) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.t.ref || '') + '</td><td>' + esc(r.t.by || '') + '</td><td>' + eaStatusHtml(r) + '</td><td class="nowrap">' + (r.actual ? fmtDT(r.actual) : '') + '</td><td class="num' + (r.delay ? ' late-txt' : '') + '">' + (r.delay ? fmtDelay(r.delay) : '') + '</td><td>' + esc(r.remark || '') + '</td>' +
      (eaEdit() ? '<td class="noprint nowrap">' + (r.status === 'Done' || r.t.src === 'mom' || r.t.src === 'decision' ? '' : '<button class="btn ghost sm danger" data-act="ea-del-rm" data-id="' + esc(r.t.id) + '" data-confirm="Remove this delegation?">Remove</button>') + '</td>' : '') + '</tr>').join('')
      : '<tr><td colspan="11" class="empty">No delegations</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['ea-del-new'] = () => { EA_UI.form = 'del'; VIEWS.ea.render(); };
ACTIONS['ea-cancel'] = () => { EA_UI.form = false; EA_UI.open = null; EA_UI.pts = []; VIEWS.ea.render(); };
ACTIONS['ea-del-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  const doer = $('#edDoer').value, task = $('#edTask').value.trim(), date = $('#edDate').value;
  const msg = t => { $('#eaMsg').textContent = t; };
  if (!doer) return msg('Select the doer.'); if (!task) return msg('Enter the task.'); if (!date) return msg('Select the date.');
  if (date < todayYmd()) return msg('The date cannot be in the past.');
  eaDelegate(task, doer, date, 'ea', ''); EA_UI.form = false; EA_UI.task = ''; flash('Task delegated to ' + esc(doer) + '.'); renderNav(); VIEWS.ea.render();
};
ACTIONS['ea-del-rm'] = el => { if (!requirePerm('ea', 'edit')) return; const t = Store.get('checklist', el.dataset.id); if (!t) return; Store.del('checklist', t.id); audit('delegation.remove', t.title, t.doer); renderNav(); VIEWS.ea.render(); };

/* ---------- MOM: minutes of meeting; every action point is a delegation ---------- */
const eaUsers = () => Store.all('users').filter(u => u.active !== false).map(u => u.name).sort();
function eaMomHtml() {
  const moms = Store.all('moms').sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
  let h = '<div class="toolbar noprint"><span class="grow"></span><button class="btn" data-act="print">Print</button>' + (eaEdit() ? '<button class="btn primary" data-act="ea-mom-new">+ MOM</button>' : '') + '</div>';
  if (EA_UI.form === 'mom') {
    const pts = EA_UI.pts.length ? EA_UI.pts : (EA_UI.pts = [{ task: '', doer: '', due: '' }]);
    h += '<div class="panel" id="momForm"><table class="jckv">' +
      '<tr><td class="k">Meeting *</td><td class="v"><input id="mmTitle" value="' + esc(EA_UI.title || '') + '"></td></tr>' +
      '<tr><td class="k">Date &amp; time *</td><td class="v"><input id="mmAt" type="datetime-local" value="' + esc(EA_UI.at || nowIso().slice(0, 16)) + '"></td></tr>' +
      '<tr><td class="k">Attendees *</td><td class="v"><div class="chips">' + eaUsers().map(n => '<label class="chip"><input type="checkbox" class="mmAtt" value="' + esc(n) + '"' + ((EA_UI.att || []).includes(n) ? ' checked' : '') + '>' + esc(n) + '</label>').join('') + '</div></td></tr>' +
      '<tr><td class="k">Notes</td><td class="v"><textarea id="mmNotes" rows="5">' + esc(EA_UI.notes || '') + '</textarea></td></tr></table>' +
      '<h2>Action points</h2><div class="tbl-wrap"><table class="nopage nofilter"><tr><th class="num">Sr</th><th>Action point</th><th>Doer</th><th>Due date</th><th></th></tr>' +
      pts.map((p, i) => '<tr data-pt="' + i + '"><td class="num">' + (i + 1) + '</td><td><input data-pk="task" value="' + esc(p.task) + '"></td><td><select data-pk="doer">' + doerOpts(clDoerList(), p.doer) + '</select></td><td><input data-pk="due" type="date" value="' + esc(p.due) + '"></td><td><button class="btn ghost sm" data-act="ea-pt-rm" data-i="' + i + '">×</button></td></tr>').join('') +
      '</table></div><div class="toolbar"><button class="btn sm" data-act="ea-pt-add">+ Action point</button><span class="grow"></span><button class="btn primary" data-act="ea-mom-save">Save MOM</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date &amp; time</th><th>Meeting</th><th>Attendees</th><th>Action points</th><th>Prepared by</th><th class="noprint"></th></tr>' +
    (moms.length ? moms.map(m => { const st = (m.points || []).map(p => eaPointStatus(Store.get('checklist', p.cl_id))); const done = st.filter(x => x.status === 'Done').length, late = st.filter(x => x.status === 'Overdue').length;
      return '<tr' + (EA_UI.open === m.id ? ' class="cur"' : '') + '><td class="nowrap"><b>' + esc(m.no) + '</b></td><td class="nowrap">' + fmtDT(m.at) + '</td><td>' + esc(m.title) + '</td><td>' + esc((m.attendees || []).join(', ')) + '</td><td>' + done + ' / ' + st.length + ' done' + (late ? ' · <span class="late-txt">' + late + ' late</span>' : '') + '</td><td>' + esc(m.by) + '</td><td class="noprint nowrap"><button class="btn sm" data-act="ea-mom-open" data-id="' + esc(m.id) + '">' + (EA_UI.open === m.id ? 'Close' : 'Open') + '</button></td></tr>' +
        (EA_UI.open === m.id ? '<tr class="inline-form"><td colspan="7">' + eaMomDetail(m, st) + '</td></tr>' : ''); }).join('')
      : '<tr><td colspan="7" class="empty">No MOM yet</td></tr>') + '</table></div>';
  return h;
}
function eaMomDetail(m, st) {
  return '<div class="panel"><table class="kv"><tr><td class="muted" style="width:120px">Meeting</td><td><b>' + esc(m.title) + '</b> · ' + fmtDT(m.at) + '</td></tr><tr><td class="muted">Attendees</td><td>' + esc((m.attendees || []).join(', ')) + '</td></tr><tr><td class="muted">Notes</td><td style="white-space:pre-wrap">' + esc(m.notes || '') + '</td></tr></table>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="nopage nofilter"><tr><th class="num">Sr</th><th>Action point</th><th>Doer</th><th>Due date</th><th>Status</th><th>Done on</th><th>By</th></tr>' +
    (m.points || []).map((p, i) => { const s = st[i] || eaPointStatus(Store.get('checklist', p.cl_id)); return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(p.task) + '</td><td>' + esc(p.doer) + '</td><td class="nowrap">' + fmtD(p.due) + '</td><td><span class="st ' + (s.status === 'Done' ? 'Done' : s.status === 'Overdue' ? 'Late' : 'Pending') + '">' + (s.status === 'Overdue' ? 'Late' : s.status) + '</span></td><td class="nowrap">' + (s.at ? fmtDT(s.at) : '') + '</td><td>' + esc(s.by || '') + '</td></tr>'; }).join('') + '</table></div></div>';
}
function eaKeepMom() { EA_UI.title = ($('#mmTitle') || {}).value; EA_UI.at = ($('#mmAt') || {}).value; EA_UI.notes = ($('#mmNotes') || {}).value; EA_UI.att = $$('.mmAtt:checked').map(x => x.value); EA_UI.pts = $$('tr[data-pt]').map(tr => ({ task: $('[data-pk="task"]', tr).value, doer: $('[data-pk="doer"]', tr).value, due: $('[data-pk="due"]', tr).value })); }
ACTIONS['ea-mom-new'] = () => { EA_UI.form = 'mom'; EA_UI.pts = []; EA_UI.title = ''; EA_UI.notes = ''; EA_UI.att = []; EA_UI.at = ''; VIEWS.ea.render(); };
ACTIONS['ea-mom-open'] = el => { EA_UI.open = EA_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.ea.render(); };
ACTIONS['ea-pt-add'] = () => { eaKeepMom(); EA_UI.pts.push({ task: '', doer: '', due: '' }); VIEWS.ea.render(); };
ACTIONS['ea-pt-rm'] = el => { eaKeepMom(); EA_UI.pts.splice(+el.dataset.i, 1); VIEWS.ea.render(); };
ACTIONS['ea-mom-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  eaKeepMom(); const U = EA_UI; const msg = t => { $('#eaMsg').textContent = t; };
  if (!U.title.trim()) return msg('Enter the meeting name.'); if (!U.at) return msg('Enter date and time.'); if (!U.att.length) return msg('Tick the attendees.');
  const pts = U.pts.filter(p => p.task.trim() || p.doer || p.due);
  const bad = pts.find(p => !p.task.trim() || !p.doer || !p.due); if (bad) return msg('Every action point needs the point, a doer and a due date.');
  const past = pts.find(p => p.due < todayYmd()); if (past) return msg('A due date cannot be in the past.');
  const m = { id: uid(), no: nextNo('moms', 'MOM'), title: U.title.trim(), at: new Date(U.at).toISOString(), attendees: U.att, notes: U.notes.trim(), points: [], by: ME.name, created_at: nowIso() };
  pts.forEach(p => { const cl = eaDelegate(p.task, p.doer, p.due, 'mom', m.no); m.points.push({ task: p.task.trim(), doer: p.doer, due: p.due, cl_id: cl.id }); });
  Store.put('moms', m); audit('mom.create', m.no, m.title + ' · ' + m.attendees.length + ' attendee(s) · ' + m.points.length + ' action point(s)');
  U.form = false; U.pts = []; U.open = m.id; flash(esc(m.no) + ' saved' + (m.points.length ? ', ' + m.points.length + ' action point(s) delegated.' : '.')); renderNav(); VIEWS.ea.render();
};

/* ---------- CEO Decision register: the Super Admin writes; EA access reads ---------- */
const DEC_ST = ['Decided', 'Implemented', 'Dropped'];
const eaDepts = () => Array.from(new Set(Store.all('users').map(u => u.department).filter(Boolean))).sort();
const eaSaNames = () => Store.all('users').filter(u => u.role_id === 'r_admin' && u.active !== false).map(u => u.name).sort();
function eaDecHtml() {
  const sa = isSuperAdmin();
  const list = Store.all('decisions').filter(d => EA_UI.f === 'all' || (EA_UI.f === 'open' ? d.status === 'Decided' : d.status !== 'Decided')).sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);
  let h = '<div class="toolbar noprint">' + seg('eaF', [{ v: 'open', l: 'Decided' }, { v: 'done', l: 'Implemented / Dropped' }, { v: 'all', l: 'All' }], EA_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button>' + (sa ? '<button class="btn primary" data-act="ea-dec-new">+ Decision</button>' : '') + '</div>';
  if (EA_UI.form === 'dec' && sa) h += '<div class="panel" style="max-width:860px"><table class="jckv">' +
    '<tr><td class="k">Date *</td><td class="v"><input id="dcDate" type="date" value="' + todayYmd() + '"></td></tr>' +
    '<tr><td class="k">Subject *</td><td class="v"><input id="dcSub"></td></tr>' +
    '<tr><td class="k">Department *</td><td class="v"><select id="dcDept">' + selOpts(eaDepts(), '') + '</select></td></tr>' +
    '<tr><td class="k">Asked by</td><td class="v"><select id="dcAsk">' + selOpts(eaUsers(), '', '—') + '</select></td></tr>' +
    '<tr><td class="k">Decision *</td><td class="v"><textarea id="dcText" rows="4"></textarea></td></tr>' +
    '<tr><td class="k">Decided by *</td><td class="v"><select id="dcBy">' + selOpts(eaSaNames(), ME.name) + '</select></td></tr>' +
    '<tr><td class="k">Implementation owner</td><td class="v">' + eaDoerSel('dcOwner', '') + '</td></tr>' +
    '<tr><td class="k">Target date</td><td class="v"><input id="dcTarget" type="date"></td></tr></table>' +
    '<div class="toolbar"><button class="btn primary" data-act="ea-dec-save">Save decision</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Subject</th><th>Department</th><th>Asked by</th><th>Decision</th><th>Decided by</th><th>Owner</th><th>Target</th><th>Task</th><th>Status</th><th>Status on</th>' + (sa ? '<th class="noprint"></th>' : '') + '</tr>' +
    (list.length ? list.map(d => { const cl = d.cl_id ? Store.get('checklist', d.cl_id) : null; const s = cl ? eaPointStatus(cl) : null;
      return '<tr><td class="nowrap"><b>' + esc(d.no) + '</b></td><td class="nowrap">' + fmtD(d.date) + '</td><td>' + esc(d.subject) + '</td><td>' + esc(d.dept) + '</td><td>' + esc(d.asked_by || '') + '</td><td style="white-space:pre-wrap;min-width:260px">' + esc(d.decision) + '</td><td>' + esc(d.decided_by) + '</td><td>' + esc(d.owner || '') + '</td><td class="nowrap">' + (d.target ? fmtD(d.target) : '') + '</td>' +
        '<td>' + (s ? '<span class="st ' + (s.status === 'Done' ? 'Done' : s.status === 'Overdue' ? 'Late' : 'Pending') + '">' + (s.status === 'Overdue' ? 'Late' : s.status) + '</span>' : '') + '</td><td><span class="st ' + (d.status === 'Implemented' ? 'Done' : d.status === 'Dropped' ? 'Cancelled' : 'Pending') + '">' + esc(d.status) + '</span></td><td class="nowrap">' + (d.status_at ? fmtDT(d.status_at) + '<div class="small muted">' + esc(d.status_by || '') + '</div>' : '') + '</td>' +
        (sa ? '<td class="noprint nowrap">' + (d.status === 'Decided' ? '<button class="btn sm primary" data-act="ea-dec-st" data-id="' + esc(d.id) + '" data-st="Implemented">Implemented</button> <button class="btn sm" data-act="ea-dec-st" data-id="' + esc(d.id) + '" data-st="Dropped" data-confirm="Mark as dropped?">Dropped</button>' : '<button class="btn sm ghost" data-act="ea-dec-st" data-id="' + esc(d.id) + '" data-st="Decided">Reopen</button>') + '</td>' : '') + '</tr>'; }).join('')
      : '<tr><td colspan="13" class="empty">No decisions</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['ea-dec-new'] = () => { if (!isSuperAdmin()) { flash('Only the Super Admin records a CEO decision.', 'err'); return; } EA_UI.form = 'dec'; VIEWS.ea.render(); };
ACTIONS['ea-dec-save'] = () => {
  if (!isSuperAdmin()) { flash('Only the Super Admin records a CEO decision.', 'err'); return; }
  const g = id => ($('#' + id) || {}).value || ''; const msg = t => { $('#eaMsg').textContent = t; };
  const d = { id: uid(), no: nextNo('decisions', 'DEC'), date: g('dcDate'), subject: g('dcSub').trim(), dept: g('dcDept'), asked_by: g('dcAsk'), decision: g('dcText').trim(), decided_by: g('dcBy'), owner: g('dcOwner'), target: g('dcTarget'), status: 'Decided', by: ME.name, created_at: nowIso(), log: [] };
  if (!d.date) return msg('Enter the date.'); if (!d.subject) return msg('Enter the subject.'); if (!d.dept) return msg('Select the department.'); if (!d.decision) return msg('Write the decision.'); if (!d.decided_by) return msg('Select who decided.');
  if ((d.owner && !d.target) || (!d.owner && d.target)) return msg('Owner and target date go together.');
  if (d.target && d.target < todayYmd()) return msg('The target date cannot be in the past.');
  if (d.owner) { const cl = eaDelegate(d.subject + ' — ' + d.decision.slice(0, 120), d.owner, d.target, 'decision', d.no); d.cl_id = cl.id; }
  Store.put('decisions', d); audit('decision.create', d.no, d.subject + ' · ' + d.dept + ' · ' + d.decided_by + (d.owner ? ' · owner ' + d.owner + ' by ' + fmtD(d.target) : ''));
  EA_UI.form = false; flash(esc(d.no) + ' recorded.'); renderNav(); VIEWS.ea.render();
};
ACTIONS['ea-dec-st'] = el => {
  if (!isSuperAdmin()) { flash('Only the Super Admin changes a decision status.', 'err'); return; }
  const d = Store.get('decisions', el.dataset.id); const st = el.dataset.st; if (!d || !DEC_ST.includes(st) || d.status === st) return;
  const old = d.status; d.status = st; d.status_by = ME.name; d.status_at = nowIso(); d.log = (d.log || []).concat([{ at: d.status_at, by: ME.name, what: old + ' → ' + st }]);
  Store.put('decisions', d); audit('decision.status', d.no, old + ' → ' + st); VIEWS.ea.render();
};
