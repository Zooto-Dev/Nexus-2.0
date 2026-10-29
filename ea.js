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
    const tabs = [{ v: 'delegation', l: 'Delegation' }, { v: 'mom', l: 'MOM' }, { v: 'decision', l: 'CEO Decision' }, { v: 'meetings', l: 'Meetings' }, { v: 'followups', l: 'Follow-ups' }, { v: 'travel', l: 'Travel' }, { v: 'contacts', l: 'Contacts' }];
    let h = '<div class="toolbar noprint">' + seg('eaTab', tabs, EA_UI.tab) + '</div>';
    h += EA_UI.tab === 'mom' ? eaMomHtml() : EA_UI.tab === 'decision' ? eaDecHtml() : EA_UI.tab === 'meetings' ? eaMtgHtml() : EA_UI.tab === 'followups' ? eaFuHtml() : EA_UI.tab === 'travel' ? eaTrvHtml() : EA_UI.tab === 'contacts' ? eaCtHtml() : eaDelHtml();
    setMain(h);
    onSeg(e => { const s = e.target.dataset.seg; if (s === 'eaTab') { EA_UI.tab = e.detail; EA_UI.form = false; EA_UI.open = null; EA_UI.f = 'open'; } if (s === 'eaF') EA_UI.f = e.detail; if (s === 'fuCh') EA_UI.fuCh = e.detail; if (s === 'mgWhere') { eaKeepMtg(); EA_UI.mtg.where = e.detail; } if (['eaTab', 'eaF', 'mgWhere'].includes(s)) VIEWS.ea.render(); });
    const cq = $('#ctQ'); if (cq) cq.addEventListener('input', () => { EA_UI.cq = cq.value; clearTimeout(EA_UI.cqT); EA_UI.cqT = setTimeout(() => { const pos = cq.selectionStart; VIEWS.ea.render(); const n = $('#ctQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); });
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
/* ---- compact people picker: chosen ones as chips, a search box, a short list to pick from ---- */
EA_UI.pick = {};   // id → { options:[{v,l,sub}], sel:[v…], q }
function eaPicker(id, options, selected) {
  const P = EA_UI.pick[id] = EA_UI.pick[id] || { sel: [], q: '' }; P.options = options; if (selected) P.sel = selected.slice();
  const q = norm(P.q); const byV = new Map(options.map(o => [o.v, o]));
  // the list is today's present people (punched in at the gate, from the payroll attendance); everyone else is still found by search
  if (CLOUD && !EA_PRESENT.list && !EA_PRESENT.msg) eaLoadPresent();
  const present = EA_PRESENT.list ? eaPresentOptions(options) : [];
  const pool = q ? options : (present.length ? present : options);
  const list = pool.filter(o => !P.sel.includes(o.v) && (!q || norm(o.l + ' ' + (o.sub || '')).includes(q))).slice(0, 12);
  const presentBar = !CLOUD ? '' : '<div class="ea-pm small muted">' + (EA_PRESENT.list ? (present.length ? '<b>' + present.length + ' present today</b> (' + EA_PRESENT.count + ' punched in on ' + fmtD(EA_PRESENT.date) + ') <a data-act="ea-pick-all" data-pick="' + esc(id) + '">Add all present</a> · search for anyone else' : 'Nobody from this list has punched in today (' + EA_PRESENT.count + ' punched in) · showing everyone') : esc(EA_PRESENT.msg || 'Checking today\'s attendance…')) + '</div>';
  return '<div class="ea-pick" data-pick="' + esc(id) + '">' + presentBar + '<div class="ea-sel">' + (P.sel.length ? P.sel.map(v => { const o = byV.get(v) || { l: v }; return '<span class="chip on">' + esc(o.l) + ' <a data-act="ea-pick-rm" data-pick="' + esc(id) + '" data-v="' + esc(v) + '" title="Remove">×</a></span>'; }).join('') : '<span class="muted small">Nobody picked yet</span>') + '</div>' +
    '<input class="ea-pq" data-pick="' + esc(id) + '" placeholder="Type a name to search…" value="' + esc(P.q) + '">' +
    '<div class="ea-pl">' + (list.length ? list.map(o => '<a data-act="ea-pick-add" data-pick="' + esc(id) + '" data-v="' + esc(o.v) + '">' + esc(o.l) + (o.sub ? ' <span class="muted small">' + esc(o.sub) + '</span>' : '') + '</a>').join('') : '<span class="muted small">' + (q ? 'No match' : 'All picked') + '</span>') + '</div></div>';
}
const eaPicked = id => ((EA_UI.pick[id] || {}).sel || []).slice();
// today's attendance from the payroll database (names only), fetched once per screen visit
const EA_PRESENT = { list: null, date: '', count: 0, unmatched: 0, msg: '', at: 0 };
async function eaLoadPresent() {
  if (EA_PRESENT.list && Date.now() - EA_PRESENT.at < 10 * 60000) return;
  EA_PRESENT.msg = 'Checking today\'s attendance…';
  try {
    const { data, error } = await SB.functions.invoke('nx-hr', { body: { action: 'present' } });
    let msg = data && data.error; if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } }
    if (msg) { EA_PRESENT.msg = msg; EA_PRESENT.list = null; }
    else { EA_PRESENT.list = data.list || []; EA_PRESENT.date = data.date; EA_PRESENT.count = data.count || 0; EA_PRESENT.at = Date.now(); EA_PRESENT.msg = ''; }
  } catch (e) { EA_PRESENT.msg = e.message; EA_PRESENT.list = null; }
  eaRefreshPickers();
}
// picker options limited to the people present: matched by employee code (users.emp_code) or by name
function eaPresentOptions(options) {
  const users = Store.all('users'); const byCode = new Map(users.filter(u => u.emp_code).map(u => [norm(u.emp_code), u]));
  const nameOf = o => norm(o.l.replace(/\s*\(.*\)$/, ''));
  const out = []; let un = 0;
  (EA_PRESENT.list || []).forEach(e => {
    const u = byCode.get(norm(e.code)) || users.find(x => norm(x.name) === norm(e.name));
    const hit = options.find(o => (u && (o.v === u.name || o.v === String(u.email || '').toLowerCase() || nameOf(o) === norm(u.name))) || nameOf(o) === norm(e.name));
    if (hit) { if (!out.includes(hit)) out.push(Object.assign({}, hit, { sub: (e.dept || hit.sub || '') + ' · in ' + e.in })); } else un++;
  });
  EA_PRESENT.unmatched = un;
  return out;
}
ACTIONS['ea-pick-all'] = el => { const P = EA_UI.pick[el.dataset.pick]; if (!P) return; eaPresentOptions(P.options).forEach(o => { if (!P.sel.includes(o.v)) P.sel.push(o.v); }); eaRefreshPickers(); };
ACTIONS['ea-pick-add'] = el => { const P = EA_UI.pick[el.dataset.pick]; if (!P || P.sel.includes(el.dataset.v)) return; P.sel.push(el.dataset.v); P.q = ''; eaRefreshPickers(); };
ACTIONS['ea-pick-rm'] = el => { const P = EA_UI.pick[el.dataset.pick]; if (!P) return; P.sel = P.sel.filter(v => v !== el.dataset.v); eaRefreshPickers(); };
// redraw only the pickers, so the rest of the form keeps what was typed
function eaRefreshPickers() { $$('.ea-pick').forEach(el => { const id = el.dataset.pick; const P = EA_UI.pick[id]; if (!P) return; const tmp = document.createElement('div'); tmp.innerHTML = eaPicker(id, P.options); el.replaceWith(tmp.firstElementChild); }); }
document.addEventListener('input', e => { const t = e.target; if (!t.classList || !t.classList.contains('ea-pq')) return; const P = EA_UI.pick[t.dataset.pick]; if (!P) return; P.q = t.value; const box = t.closest('.ea-pick'); const tmp = document.createElement('div'); tmp.innerHTML = eaPicker(t.dataset.pick, P.options); const nw = tmp.firstElementChild; box.replaceWith(nw); const i = $('.ea-pq', nw); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
function eaMomHtml() {
  const moms = Store.all('moms').sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
  let h = '<div class="toolbar noprint"><span class="grow"></span><button class="btn" data-act="print">Print</button>' + (eaEdit() ? '<button class="btn primary" data-act="ea-mom-new">+ MOM</button>' : '') + '</div>';
  if (EA_UI.form === 'mom') {
    const pts = EA_UI.pts.length ? EA_UI.pts : (EA_UI.pts = [{ task: '', doer: '', due: '' }]);
    h += '<div class="panel" id="momForm"><table class="jckv">' +
      '<tr><td class="k">Meeting *</td><td class="v"><input id="mmTitle" value="' + esc(EA_UI.title || '') + '"></td></tr>' +
      '<tr><td class="k">Date *</td><td class="v"><input id="mmDate" type="date" value="' + esc(EA_UI.date || todayYmd()) + '"></td></tr>' +
      '<tr><td class="k">Time *</td><td class="v"><input id="mmTime" type="time" value="' + esc(EA_UI.time || nowIso().slice(11, 16)) + '"></td></tr>' +
      '<tr><td class="k">Attendees *</td><td class="v">' + eaPicker('mmAtt', Store.all('users').filter(u => u.active !== false).map(u => ({ v: u.name, l: u.name, sub: u.department || '' })).sort((a, b) => a.l.localeCompare(b.l)), EA_UI.attInit) + '</td></tr>' +
      '<tr><td class="k">Agenda *</td><td class="v"><textarea id="mmAgenda" rows="3">' + esc(EA_UI.agenda || '') + '</textarea></td></tr>' +
      '<tr><td class="k">KDP (Key Discussion Points) *</td><td class="v"><textarea id="mmKdp" rows="6">' + esc(EA_UI.kdp || '') + '</textarea></td></tr></table>' +
      '<h2>Action Items</h2><div class="tbl-wrap"><table class="nopage nofilter"><tr><th class="num">Sr</th><th>Action item</th><th>Doer</th><th>Due date</th><th></th></tr>' +
      pts.map((p, i) => '<tr data-pt="' + i + '"><td class="num">' + (i + 1) + '</td><td><input data-pk="task" value="' + esc(p.task) + '"></td><td><select data-pk="doer">' + doerOpts(clDoerList(), p.doer) + '</select></td><td><input data-pk="due" type="date" value="' + esc(p.due) + '"></td><td><button class="btn ghost sm" data-act="ea-pt-rm" data-i="' + i + '">×</button></td></tr>').join('') +
      '</table></div><div class="toolbar"><button class="btn sm" data-act="ea-pt-add">+ Action item</button></div>' +
      '<table class="jckv"><tr><td class="k">Conclusion *</td><td class="v"><textarea id="mmConc" rows="3">' + esc(EA_UI.conc || '') + '</textarea></td></tr></table>' +
      '<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="ea-mom-save">Save MOM</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Time</th><th>Meeting</th><th>Attendees</th><th>Action items</th><th>Prepared by</th><th class="noprint"></th></tr>' +
    (moms.length ? moms.map(m => { const st = (m.points || []).map(p => eaPointStatus(Store.get('checklist', p.cl_id))); const done = st.filter(x => x.status === 'Done').length, late = st.filter(x => x.status === 'Overdue').length;
      return '<tr' + (EA_UI.open === m.id ? ' class="cur"' : '') + '><td class="nowrap"><b>' + esc(m.no) + '</b></td><td class="nowrap">' + fmtD(m.at) + '</td><td class="nowrap">' + String(fmtDT(m.at)).slice(-5) + '</td><td>' + esc(m.title) + '</td><td>' + esc((m.attendees || []).join(', ')) + '</td><td>' + done + ' / ' + st.length + ' done' + (late ? ' · <span class="late-txt">' + late + ' late</span>' : '') + '</td><td>' + esc(m.by) + '</td><td class="noprint nowrap"><button class="btn sm" data-act="ea-mom-open" data-id="' + esc(m.id) + '">' + (EA_UI.open === m.id ? 'Close' : 'Open') + '</button></td></tr>' +
        (EA_UI.open === m.id ? '<tr class="inline-form"><td colspan="8">' + eaMomDetail(m, st) + '</td></tr>' : ''); }).join('')
      : '<tr><td colspan="8" class="empty">No MOM yet</td></tr>') + '</table></div>';
  return h;
}
function eaMomDetail(m, st) {
  const kv = (k, v, pre) => '<tr><td class="muted" style="width:150px;vertical-align:top">' + k + '</td><td' + (pre ? ' style="white-space:pre-wrap"' : '') + '>' + v + '</td></tr>';
  return '<div class="panel mom-doc"><table class="kv">' +
    kv('Meeting', '<b>' + esc(m.title) + '</b>') + kv('Date', fmtD(m.at)) + kv('Time', String(fmtDT(m.at)).slice(-5)) +
    kv('Attendees', esc((m.attendees || []).join(', '))) + kv('Agenda', esc(m.agenda || m.notes || ''), true) + kv('KDP', esc(m.kdp || ''), true) + '</table>' +
    '<h2>Action Items</h2><div class="tbl-wrap"><table class="nopage nofilter"><tr><th class="num">Sr</th><th>Action item</th><th>Doer</th><th>Due date</th><th>Status</th><th>Done on</th><th>By</th></tr>' +
    ((m.points || []).length ? (m.points || []).map((p, i) => { const s = st[i] || eaPointStatus(Store.get('checklist', p.cl_id)); return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(p.task) + '</td><td>' + esc(p.doer) + '</td><td class="nowrap">' + fmtD(p.due) + '</td><td><span class="st ' + (s.status === 'Done' ? 'Done' : s.status === 'Overdue' ? 'Late' : 'Pending') + '">' + (s.status === 'Overdue' ? 'Late' : s.status) + '</span></td><td class="nowrap">' + (s.at ? fmtDT(s.at) : '') + '</td><td>' + esc(s.by || '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">No action items</td></tr>') + '</table></div>' +
    '<table class="kv" style="margin-top:8px">' + kv('Conclusion', esc(m.conclusion || ''), true) + kv('Prepared by', esc(m.by) + ' · ' + fmtDT(m.created_at)) + '</table></div>';
}
function eaKeepMom() { EA_UI.title = ($('#mmTitle') || {}).value; EA_UI.date = ($('#mmDate') || {}).value; EA_UI.time = ($('#mmTime') || {}).value; EA_UI.agenda = ($('#mmAgenda') || {}).value; EA_UI.kdp = ($('#mmKdp') || {}).value; EA_UI.conc = ($('#mmConc') || {}).value; EA_UI.att = eaPicked('mmAtt'); EA_UI.attInit = null; EA_UI.pts = $$('tr[data-pt]').map(tr => ({ task: $('[data-pk="task"]', tr).value, doer: $('[data-pk="doer"]', tr).value, due: $('[data-pk="due"]', tr).value })); }
ACTIONS['ea-mom-new'] = () => { EA_UI.form = 'mom'; EA_UI.pts = []; EA_UI.title = ''; EA_UI.agenda = ''; EA_UI.kdp = ''; EA_UI.conc = ''; EA_UI.att = []; EA_UI.attInit = []; EA_UI.date = ''; EA_UI.time = ''; EA_UI.momMtg = null; VIEWS.ea.render(); };
ACTIONS['ea-mom-open'] = el => { EA_UI.open = EA_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.ea.render(); };
ACTIONS['ea-pt-add'] = () => { eaKeepMom(); EA_UI.pts.push({ task: '', doer: '', due: '' }); VIEWS.ea.render(); };
ACTIONS['ea-pt-rm'] = el => { eaKeepMom(); EA_UI.pts.splice(+el.dataset.i, 1); VIEWS.ea.render(); };
ACTIONS['ea-mom-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  eaKeepMom(); const U = EA_UI; const msg = t => { $('#eaMsg').textContent = t; };
  if (!U.title.trim()) return msg('Enter the meeting name.'); if (!U.date || !U.time) return msg('Enter date and time.'); if (!U.att.length) return msg('Tick the attendees.');
  if (!U.agenda.trim()) return msg('Enter the agenda.'); if (!U.kdp.trim()) return msg('Enter the key discussion points.'); if (!U.conc.trim()) return msg('Enter the conclusion.');
  const pts = U.pts.filter(p => p.task.trim() || p.doer || p.due);
  const bad = pts.find(p => !p.task.trim() || !p.doer || !p.due); if (bad) return msg('Every action point needs the point, a doer and a due date.');
  const past = pts.find(p => p.due < todayYmd()); if (past) return msg('A due date cannot be in the past.');
  const m = { id: uid(), no: nextNo('moms', 'MOM'), title: U.title.trim(), at: new Date(U.date + 'T' + U.time + ':00').toISOString(), attendees: U.att, agenda: U.agenda.trim(), kdp: U.kdp.trim(), conclusion: U.conc.trim(), points: [], by: ME.name, created_at: nowIso() };
  pts.forEach(p => { const cl = eaDelegate(p.task, p.doer, p.due, 'mom', m.no); m.points.push({ task: p.task.trim(), doer: p.doer, due: p.due, cl_id: cl.id }); });
  if (U.momMtg) { const mt = Store.get('meetings', U.momMtg); if (mt) { mt.mom_id = m.id; mt.status = 'Held'; Store.put('meetings', mt); m.meeting_no = mt.no; } U.momMtg = null; }
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

/* ---------- Meetings: scheduled from here, kept in the company Google Calendar (invites to every attendee) ---------- */
const eaMail = async body => { try { const { data, error } = await SB.functions.invoke('nx-mail', { body }); let msg = data && data.error; if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } } return { err: msg || '', data: data || {} }; } catch (e) { return { err: e.message, data: {} }; } };
// people with an email: users, vendors, contacts
function eaPeople() {
  const out = [];
  Store.all('users').filter(u => u.active !== false && u.email).forEach(u => out.push({ name: u.name, email: String(u.email).toLowerCase(), kind: 'User' }));
  Store.all('vendors').filter(v => v.email).forEach(v => out.push({ name: v.name, email: String(v.email).toLowerCase().split(/[,;\s]+/)[0], kind: 'Vendor' }));
  Store.all('contacts').filter(c => c.email).forEach(c => out.push({ name: c.name + (c.org ? ' (' + c.org + ')' : ''), email: String(c.email).toLowerCase(), kind: 'Contact' }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const eaMtgStatus = m => m.status === 'Cancelled' ? 'Cancelled' : m.mom_id ? 'MOM done' : new Date(m.end) < new Date() ? 'Held' : 'Scheduled';
function eaMtgHtml() {
  const edit = eaEdit(); const now = Date.now();
  const list = Store.all('meetings').filter(m => EA_UI.f === 'all' || (EA_UI.f === 'open' ? m.status !== 'Cancelled' && new Date(m.end) >= new Date(now - 864e5) : m.status === 'Cancelled' || new Date(m.end) < new Date(now - 864e5))).sort((a, b) => (a.start || '') < (b.start || '') ? (EA_UI.f === 'open' ? -1 : 1) : (EA_UI.f === 'open' ? 1 : -1));
  let h = '<div class="toolbar noprint">' + seg('eaF', [{ v: 'open', l: 'Upcoming' }, { v: 'done', l: 'Past / Cancelled' }, { v: 'all', l: 'All' }], EA_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button>' + (edit && CLOUD ? '<button class="btn" data-act="ea-mtg-sync">Refresh from Google Calendar</button>' : '') + (edit ? '<button class="btn primary" data-act="ea-mtg-new">+ Meeting</button>' : '') + '</div>';
  if (EA_UI.form === 'mtg') {
    const M = EA_UI.mtg || {}; const sel = new Set(M.emails || []);
    h += '<div class="panel" id="mtgForm"><table class="jckv">' +
      '<tr><td class="k">Title *</td><td class="v"><input id="mgTitle" value="' + esc(M.title || '') + '"></td></tr>' +
      '<tr><td class="k">Date *</td><td class="v"><input id="mgDate" type="date" value="' + esc(M.date || todayYmd()) + '"></td></tr>' +
      '<tr><td class="k">Time *</td><td class="v"><input id="mgFrom" type="time" value="' + esc(M.from || '11:00') + '"> to <input id="mgTo" type="time" value="' + esc(M.to || '12:00') + '"></td></tr>' +
      '<tr><td class="k">Attendees *</td><td class="v">' + eaPicker('mgAtt', eaPeople().map(p => ({ v: p.email, l: p.name, sub: p.kind + ' · ' + p.email })), M.emailsInit) + 
      '<input id="mgExtra" placeholder="Other email IDs, comma separated" value="' + esc(M.extra || '') + '" style="margin-top:6px"></td></tr>' +
      '<tr><td class="k">Where</td><td class="v">' + seg('mgWhere', [{ v: 'office', l: 'Office / place' }, { v: 'meet', l: 'Google Meet' }], M.where || 'office') + ' <input id="mgLoc" placeholder="Room / address" value="' + esc(M.location || '') + '"' + ((M.where || 'office') === 'meet' ? ' disabled' : '') + '></td></tr>' +
      '<tr><td class="k">Agenda</td><td class="v"><textarea id="mgAgenda" rows="4">' + esc(M.agenda || '') + '</textarea></td></tr></table>' +
      '<div class="toolbar"><button class="btn primary" data-act="ea-mtg-save">' + (M.id ? 'Save changes' : 'Schedule & send invites') + '</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Date</th><th>Time</th><th>Title</th><th>Attendees</th><th>Where</th><th>Agenda</th><th>Status</th><th>Calendar</th><th>By</th>' + (edit ? '<th class="noprint"></th>' : '') + '</tr>' +
    (list.length ? list.map(m => { const st = eaMtgStatus(m); return '<tr><td class="nowrap"><b>' + esc(m.no) + '</b></td><td class="nowrap">' + fmtD(m.start) + '</td><td class="nowrap">' + String(fmtDT(m.start)).slice(-5) + ' – ' + String(fmtDT(m.end)).slice(-5) + '</td><td>' + esc(m.title) + '</td><td>' + esc((m.attendees || []).map(a => a.name || a.email).join(', ')) + '</td><td>' + (m.meet_link ? '<a href="' + esc(m.meet_link) + '" target="_blank" rel="noopener">Google Meet</a>' : esc(m.location || '')) + '</td><td style="white-space:pre-wrap;max-width:260px">' + esc(m.agenda || '') + '</td>' +
      '<td><span class="st ' + (st === 'Cancelled' ? 'Cancelled' : st === 'Scheduled' ? 'Pending' : 'Done') + '">' + st + '</span></td><td>' + (m.cal_id ? '<span class="ok-txt">Synced</span>' + (m.src === 'google' ? '<div class="small muted">from Google</div>' : '') : '<span class="late-txt">' + esc(m.cal_error || 'Not in calendar') + '</span>') + '</td><td>' + esc(m.by || '') + '</td>' +
      (edit ? '<td class="noprint nowrap">' + (st === 'Scheduled' ? '<button class="btn sm" data-act="ea-mtg-edit" data-id="' + esc(m.id) + '">Reschedule</button> <button class="btn sm ghost danger" data-act="ea-mtg-cancel" data-id="' + esc(m.id) + '" data-confirm="Cancel this meeting for everyone?">Cancel</button>' : '') + (st === 'Held' ? '<button class="btn sm primary" data-act="ea-mtg-mom" data-id="' + esc(m.id) + '">Make MOM</button>' : st === 'MOM done' ? '<a class="small" data-act="ea-mtg-mom-open" data-id="' + esc(m.mom_id) + '">Open MOM</a>' : '') + '</td>' : '') + '</tr>'; }).join('')
      : '<tr><td colspan="11" class="empty">No meetings</td></tr>') + '</table></div>';
  return h;
}
function eaKeepMtg() { const M = EA_UI.mtg = EA_UI.mtg || {}; M.title = ($('#mgTitle') || {}).value || ''; M.date = ($('#mgDate') || {}).value || ''; M.from = ($('#mgFrom') || {}).value || ''; M.to = ($('#mgTo') || {}).value || ''; M.emails = eaPicked('mgAtt'); M.emailsInit = null; M.extra = ($('#mgExtra') || {}).value || ''; M.location = ($('#mgLoc') || {}).value || ''; M.agenda = ($('#mgAgenda') || {}).value || ''; }
ACTIONS['ea-mtg-new'] = () => { EA_UI.form = 'mtg'; EA_UI.mtg = { where: 'office', emailsInit: [] }; VIEWS.ea.render(); };
ACTIONS['ea-mtg-edit'] = el => { const m = Store.get('meetings', el.dataset.id); if (!m) return; EA_UI.form = 'mtg'; EA_UI.mtg = { id: m.id, title: m.title, date: ymdOf(new Date(m.start)), from: String(fmtDT(m.start)).slice(-5), to: String(fmtDT(m.end)).slice(-5), emails: (m.attendees || []).map(a => a.email), emailsInit: (m.attendees || []).map(a => a.email), extra: '', where: m.meet_link || m.meet ? 'meet' : 'office', location: m.location || '', agenda: m.agenda || '' }; VIEWS.ea.render(); };
ACTIONS['ea-mtg-save'] = async el => {
  if (!requirePerm('ea', 'edit')) return;
  eaKeepMtg(); const M = EA_UI.mtg; const msg = t => { const e = $('#eaMsg'); if (e) e.textContent = t; };
  if (!M.title.trim()) return msg('Enter the title.'); if (!M.date || !M.from || !M.to) return msg('Enter date and time.');
  const start = new Date(M.date + 'T' + M.from + ':00'), end = new Date(M.date + 'T' + M.to + ':00');
  if (!(end > start)) return msg('End time must be after the start time.'); if (!M.id && start < new Date()) return msg('The meeting time is already past.');
  const extra = M.extra.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const badE = extra.find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)); if (badE) return msg(badE + ' is not an email ID.');
  const emails = Array.from(new Set(M.emails.concat(extra))); if (!emails.length) return msg('Tick at least one attendee.');
  const people = eaPeople(); const attendees = emails.map(e => ({ email: e, name: (people.find(p => p.email === e) || {}).name || e }));
  const meet = M.where === 'meet';
  el.disabled = true; msg(M.id ? 'Updating Google Calendar…' : 'Creating the calendar event and sending invites…');
  const m = M.id ? Store.get('meetings', M.id) : { id: uid(), no: nextNo('meetings', 'MTG'), by: ME.name, created_at: nowIso(), status: 'Scheduled' };
  Object.assign(m, { title: M.title.trim(), start: start.toISOString(), end: end.toISOString(), attendees, location: meet ? '' : M.location.trim(), meet, agenda: M.agenda.trim() });
  if (CLOUD && SB) {
    const r = await eaMail({ action: 'calendar', op: m.cal_id ? 'update' : 'create', id: m.cal_id || '', title: m.title, start: m.start, end: m.end, guests: emails, location: m.location, description: (m.agenda ? 'Agenda:\n' + m.agenda + '\n\n' : '') + 'Scheduled from Nexus 2.0 by ' + ME.name + ' (' + m.no + ')', meet });
    if (r.err) { m.cal_error = r.err; flash('Saved in Nexus, but Google Calendar said: ' + esc(r.err), 'err'); }
    else { m.cal_id = r.data.id || m.cal_id; m.cal_error = ''; if (r.data.meet) m.meet_link = r.data.meet; if (r.data.link) m.cal_link = r.data.link; if (meet && !m.meet_link && /no Meet link/.test(r.data.via || '')) flash('Meeting made without a Meet link — turn on the Google Calendar API service in Apps Script.', 'err'); }
  } else m.cal_error = 'local mode';
  Store.put('meetings', m); audit(M.id ? 'meeting.update' : 'meeting.create', m.no, m.title + ' · ' + fmtDT(m.start) + ' · ' + attendees.length + ' attendee(s)' + (m.cal_id ? ' · calendar' : ''));
  EA_UI.form = false; EA_UI.mtg = null; if (!m.cal_error) flash(esc(m.no) + (M.id ? ' updated, attendees notified.' : ' scheduled, invites sent.')); VIEWS.ea.render();
};
ACTIONS['ea-mtg-cancel'] = async el => {
  if (!requirePerm('ea', 'edit')) return; const m = Store.get('meetings', el.dataset.id); if (!m) return;
  if (m.cal_id && CLOUD && SB) { const r = await eaMail({ action: 'calendar', op: 'cancel', id: m.cal_id }); if (r.err && !/not found/i.test(r.err)) { flash('Google Calendar said: ' + esc(r.err), 'err'); return; } }
  m.status = 'Cancelled'; m.cancelled_by = ME.name; m.cancelled_at = nowIso(); Store.put('meetings', m); audit('meeting.cancel', m.no, m.title); flash(esc(m.no) + ' cancelled, attendees notified.'); VIEWS.ea.render();
};
ACTIONS['ea-mtg-mom'] = el => { const m = Store.get('meetings', el.dataset.id); if (!m) return; EA_UI.tab = 'mom'; EA_UI.form = 'mom'; EA_UI.pts = []; EA_UI.title = m.title; EA_UI.date = ymdOf(new Date(m.start)); EA_UI.time = String(fmtDT(m.start)).slice(-5); EA_UI.agenda = m.agenda || ''; EA_UI.kdp = ''; EA_UI.conc = ''; EA_UI.att = (m.attendees || []).map(a => a.name).filter(n => eaUsers().includes(n)); EA_UI.attInit = EA_UI.att.slice(); EA_UI.momMtg = m.id; VIEWS.ea.render(); };
ACTIONS['ea-mtg-mom-open'] = el => { EA_UI.tab = 'mom'; EA_UI.open = el.dataset.id; VIEWS.ea.render(); };
// events made straight in Google Calendar (next 30 days) come in as meetings too
ACTIONS['ea-mtg-sync'] = async el => {
  if (!requirePerm('ea', 'edit')) return; el.disabled = true;
  const r = await eaMail({ action: 'calendar', op: 'list', from: new Date(Date.now() - 864e5).toISOString(), to: new Date(Date.now() + 30 * 864e5).toISOString() });
  if (r.err) { flash('Google Calendar: ' + esc(r.err), 'err'); el.disabled = false; return; }
  const have = new Set(Store.all('meetings').map(m => m.cal_id).filter(Boolean)); const people = eaPeople(); let n = 0;
  (r.data.events || []).forEach(ev => {
    if (have.has(ev.id) || ev.all_day) return;
    const attendees = (ev.guests || []).map(e => ({ email: e, name: (people.find(p => p.email === e) || {}).name || e }));
    const meetM = /https:\/\/meet\.google\.com\/[a-z-]+/.exec(ev.description || '');
    Store.put('meetings', { id: uid(), no: nextNo('meetings', 'MTG'), title: ev.title || 'Meeting', start: ev.start, end: ev.end, attendees, location: ev.location || '', meet: !!meetM, meet_link: meetM ? meetM[0] : '', agenda: String(ev.description || '').replace(/Scheduled from Nexus.*$/s, '').trim(), status: 'Scheduled', cal_id: ev.id, src: 'google', by: 'Google Calendar', created_at: nowIso() }); n++;
  });
  if (n) audit('meeting.sync', 'Google Calendar', n + ' meeting(s) imported');
  flash(n ? n + ' meeting(s) brought in from Google Calendar.' : 'Nothing new in Google Calendar.'); VIEWS.ea.render();
};

/* ---------- Follow-ups: a reminder to one person at a set time, by WhatsApp and / or mail ---------- */
function eaFuPeople() {
  const d10 = m => String(m || '').replace(/\D/g, '').slice(-10);
  const out = [];
  Store.all('users').filter(u => u.active !== false).forEach(u => out.push({ name: u.name, mobile: d10(u.mobile), email: String(u.email || '').toLowerCase(), kind: 'User' }));
  Store.all('vendors').forEach(v => out.push({ name: v.name, mobile: d10(v.mobile), email: String(v.email || '').toLowerCase().split(/[,;\s]+/)[0], kind: 'Vendor' }));
  Store.all('contacts').forEach(c => out.push({ name: c.name, mobile: d10(c.mobile), email: String(c.email || '').toLowerCase(), kind: 'Contact' }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function eaFuHtml() {
  const edit = eaEdit();
  const list = Store.all('followups').filter(f => EA_UI.f === 'all' || (EA_UI.f === 'open' ? f.status === 'Scheduled' : f.status !== 'Scheduled')).sort((a, b) => (a.at || '') < (b.at || '') ? (EA_UI.f === 'open' ? -1 : 1) : (EA_UI.f === 'open' ? 1 : -1));
  let h = '<div class="toolbar noprint">' + seg('eaF', [{ v: 'open', l: 'Scheduled' }, { v: 'done', l: 'Sent / Cancelled' }, { v: 'all', l: 'All' }], EA_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button>' + (edit ? '<button class="btn primary" data-act="ea-fu-new">+ Follow-up</button>' : '') + '</div>';
  if (EA_UI.form === 'fu') {
    const P = eaFuPeople(); const labels = P.map(p => p.name + ' · ' + p.kind + (p.mobile ? ' · ' + p.mobile : '') + (p.email ? ' · ' + p.email : ''));
    h += '<div class="panel" style="max-width:860px"><table class="jckv">' +
      '<tr><td class="k">To *</td><td class="v"><select id="fuWho">' + selOpts(labels, '') + '</select></td></tr>' +
      '<tr><td class="k">Send by *</td><td class="v">' + seg('fuCh', [{ v: 'WhatsApp', l: 'WhatsApp' }, { v: 'Mail', l: 'Mail' }, { v: 'Both', l: 'Both' }], EA_UI.fuCh || 'WhatsApp') + '</td></tr>' +
      '<tr><td class="k">When *</td><td class="v"><input id="fuDate" type="date" value="' + todayYmd() + '"> <input id="fuTime" type="time" value="10:00"></td></tr>' +
      '<tr><td class="k">Reference</td><td class="v"><input id="fuRef" placeholder="PO / invoice / order no. (blank = follow-up no.)" maxlength="60"></td></tr>' +
      '<tr><td class="k">Message *</td><td class="v"><textarea id="fuText" rows="3" maxlength="500"></textarea></td></tr></table>' +
      '<div class="toolbar"><button class="btn primary" data-act="ea-fu-save">Schedule</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>When</th><th>To</th><th>Type</th><th>By</th><th>Reference</th><th>Message</th><th>Status</th><th>Sent on</th><th>Result</th><th>Set by</th>' + (edit ? '<th class="noprint"></th>' : '') + '</tr>' +
    (list.length ? list.map(f => '<tr><td class="nowrap"><b>' + esc(f.no) + '</b></td><td class="nowrap">' + fmtDT(f.at) + '</td><td>' + esc(f.to_name) + '</td><td>' + esc(f.to_kind) + '</td><td>' + esc(f.channel) + '</td><td>' + esc(f.ref || '') + '</td><td style="white-space:pre-wrap;max-width:320px">' + esc(f.text) + '</td><td><span class="st ' + (f.status === 'Sent' ? 'Done' : f.status === 'Cancelled' ? 'Cancelled' : f.status === 'Failed' ? 'Late' : 'Pending') + '">' + esc(f.status) + '</span></td><td class="nowrap">' + (f.sent_at ? fmtDT(f.sent_at) : '') + '</td><td class="small">' + esc(f.result || '') + '</td><td>' + esc(f.by) + '</td>' +
      (edit ? '<td class="noprint">' + (f.status === 'Scheduled' ? '<button class="btn sm ghost danger" data-act="ea-fu-cancel" data-id="' + esc(f.id) + '" data-confirm="Cancel this follow-up?">Cancel</button>' : f.status === 'Failed' ? '<button class="btn sm" data-act="ea-fu-retry" data-id="' + esc(f.id) + '">Send again</button>' : '') + '</td>' : '') + '</tr>').join('')
      : '<tr><td colspan="12" class="empty">No follow-ups</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['ea-fu-new'] = () => { EA_UI.form = 'fu'; VIEWS.ea.render(); };
ACTIONS['ea-fu-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  const P = eaFuPeople(); const labels = P.map(p => p.name + ' · ' + p.kind + (p.mobile ? ' · ' + p.mobile : '') + (p.email ? ' · ' + p.email : ''));
  const who = P[labels.indexOf($('#fuWho').value)]; const ch = EA_UI.fuCh || 'WhatsApp'; const date = $('#fuDate').value, time = $('#fuTime').value, text = $('#fuText').value.trim(), ref = $('#fuRef').value.trim();
  const msg = t => { $('#eaMsg').textContent = t; };
  if (!who) return msg('Pick who to follow up.'); if (!date || !time) return msg('Enter date and time.'); if (!text) return msg('Write the message.');
  if ((ch === 'WhatsApp' || ch === 'Both') && !/^[6-9]\d{9}$/.test(who.mobile)) return msg(who.name + ' has no mobile number for WhatsApp.');
  if ((ch === 'Mail' || ch === 'Both') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who.email)) return msg(who.name + ' has no email ID.');
  const at = new Date(date + 'T' + time + ':00'); if (at < new Date(Date.now() - 60000)) return msg('The time is already past.');
  const f = Store.put('followups', { id: uid(), no: nextNo('followups', 'FU'), to_name: who.name, to_kind: who.kind, mobile: who.mobile, email: who.email, channel: ch, at: at.toISOString(), text, ref, status: 'Scheduled', by: ME.name, created_at: nowIso() });
  audit('followup.create', f.no, who.name + ' · ' + ch + ' · ' + fmtDT(f.at) + ' · ' + text.slice(0, 60));
  EA_UI.form = false; flash(esc(f.no) + ' scheduled for ' + fmtDT(f.at) + '.'); VIEWS.ea.render(); eaFuRun();
};
ACTIONS['ea-fu-cancel'] = el => { if (!requirePerm('ea', 'edit')) return; const f = Store.get('followups', el.dataset.id); if (!f || f.status !== 'Scheduled') return; f.status = 'Cancelled'; f.cancelled_by = ME.name; Store.put('followups', f); audit('followup.cancel', f.no, f.to_name); VIEWS.ea.render(); };
ACTIONS['ea-fu-retry'] = el => { if (!requirePerm('ea', 'edit')) return; const f = Store.get('followups', el.dataset.id); if (!f || f.status !== 'Failed') return; f.status = 'Scheduled'; f.result = ''; Store.put('followups', f); eaFuRun(true); };
// sends what is due: runs every minute in the browser of anyone with EA edit access (or Admin)
let EA_FU_BUSY = false;
async function eaFuRun(force) {
  if (!CLOUD || !SB || !ME || EA_FU_BUSY) return; if (!(isAdminRole() || can('ea', 'edit'))) return;
  const due = Store.all('followups').filter(f => f.status === 'Scheduled' && new Date(f.at) <= new Date()); if (!due.length) return;
  EA_FU_BUSY = true;
  try {
    try { await jcFresh(); } catch (e) { }
    for (const f0 of due) {
      const f = Store.get('followups', f0.id); if (!f || f.status !== 'Scheduled') continue;
      f.status = 'Sending'; f.sender = ME.name; Store.put('followups', f);   // claimed by this browser; another one sees it and leaves it
      const res = [];
      if (f.channel === 'Mail' || f.channel === 'Both') {
        const mq = Store.put('mail_queue', { id: uid(), to: f.email, subject: 'Follow-up from ' + (settings().company || 'Zooto Fashion') + ' — ' + (f.ref || f.no), body: 'Dear ' + f.to_name + ',\n\nReference: ' + (f.ref || f.no) + '\n' + f.text + '\n\nRegards,\n' + f.by + '\n' + (settings().company || 'Zooto Fashion'), ref: f.no, name: 'Nexus EA', status: 'queued', at: nowIso(), by: f.by });
        await mailSend(mq.id); const m2 = Store.get('mail_queue', mq.id); res.push('Mail: ' + ((m2 && m2.status) || 'queued') + (m2 && m2.error ? ' — ' + m2.error : ''));
      }
      if (f.channel === 'WhatsApp' || f.channel === 'Both') {
        try { await waSynced(); const { data, error } = await SB.functions.invoke('nx-wa', { body: { event: 'followup', id: f.id, resend: true } }); let msg = data && data.error; if (error) { msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { } } res.push('WhatsApp: ' + (msg ? 'failed — ' + msg : data && data.failed ? 'failed' : 'sent')); } catch (e) { res.push('WhatsApp: failed — ' + e.message); }
      }
      f.result = res.join(' | '); f.status = res.some(x => /failed|no_recipient/.test(x)) ? 'Failed' : 'Sent'; f.sent_at = nowIso(); Store.put('followups', f);
      audit('followup.' + (f.status === 'Sent' ? 'sent' : 'failed'), f.no, f.to_name + ' · ' + f.result);
    }
  } finally { EA_FU_BUSY = false; if (curView().v === 'ea') VIEWS.ea.render(); }
}
setInterval(() => { try { eaFuRun(); } catch (e) { } }, 60000);

/* ---------- Daily brief: every morning the Super Admins (and the EA) get today's meetings, late tasks, pending decisions and follow-ups ---------- */
function eaBriefText() {
  const today = todayYmd(); const parts = [];
  const mtgs = Store.all('meetings').filter(m => m.status !== 'Cancelled' && ymdOf(new Date(m.start)) === today).sort((a, b) => a.start < b.start ? -1 : 1);
  parts.push('Meetings today: ' + (mtgs.length ? mtgs.map(m => String(fmtDT(m.start)).slice(-5) + ' ' + m.title).join('; ') : 'none'));
  const late = allTasks().filter(t => !t.done && t.status === 'Delayed'); parts.push('Late tasks: ' + late.length + (late.length ? ' (' + Array.from(new Set(late.map(t => t.owner || t.doer))).slice(0, 5).join(', ') + ')' : ''));
  parts.push('Decisions pending: ' + Store.all('decisions').filter(d => d.status === 'Decided').length);
  const fu = Store.all('followups').filter(f => f.status === 'Scheduled' && ymdOf(new Date(f.at)) === today); parts.push('Follow-ups today: ' + fu.length);
  const pos = Store.all('purchase_orders').filter(p => p.approval === 'Pending' && !p.cancelled).length; if (pos) parts.push('PO approvals waiting: ' + pos);
  return parts.join(' | ');
}
function eaDailyBrief() {
  if (!CLOUD || !SB || !ME || new Date().getHours() < 8) return;
  if (!(isAdminRole() || can('ea', 'edit'))) return;
  const day = todayYmd(); try { if (localStorage.getItem('nx_ea_brief') === day) return; localStorage.setItem('nx_ea_brief', day); } catch (e) { return; }
  try {
    const text = eaBriefText();
    waSend('daily_brief', day, false, { text });
    const to = Store.all('users').filter(u => u.active !== false && (u.role_id === 'r_admin' || /EXECUTIVE ASSISTANT/i.test(u.designation || '')) && u.email).map(u => u.email).join(',');
    if (to) { const mq = Store.put('mail_queue', { id: uid(), to, subject: 'Daily brief — ' + fmtD(day), body: text.split(' | ').join('\n'), ref: 'Daily brief ' + day, name: 'Nexus EA', no_reply: true, status: 'queued', at: nowIso(), by: ME.name }); mailSend(mq.id); }
    audit('ea.daily_brief', day, text.slice(0, 200));
  } catch (e) { console.error(e); }
}
setInterval(() => { try { eaDailyBrief(); } catch (e) { } }, 15 * 60000);

/* ---------- Travel / visit log ---------- */
const TRV_ST = ['Planned', 'Done', 'Cancelled'];
function eaTrvHtml() {
  const edit = eaEdit();
  const list = Store.all('travels').filter(t => EA_UI.f === 'all' || (EA_UI.f === 'open' ? t.status === 'Planned' : t.status !== 'Planned')).sort((a, b) => (b.from || '') < (a.from || '') ? -1 : 1);
  let h = '<div class="toolbar noprint">' + seg('eaF', [{ v: 'open', l: 'Planned' }, { v: 'done', l: 'Done / Cancelled' }, { v: 'all', l: 'All' }], EA_UI.f) + '<span class="grow"></span><button class="btn" data-act="print">Print</button>' + (edit ? '<button class="btn primary" data-act="ea-trv-new">+ Travel</button>' : '') + '</div>';
  if (EA_UI.form === 'trv') {
    const T = EA_UI.trv || {};
    h += '<div class="panel" style="max-width:860px"><table class="jckv">' +
      '<tr><td class="k">Who *</td><td class="v"><select id="tvWho">' + selOpts(eaUsers(), T.person || '') + '</select></td></tr>' +
      '<tr><td class="k">Purpose *</td><td class="v"><input id="tvWhy" value="' + esc(T.purpose || '') + '"></td></tr>' +
      '<tr><td class="k">From *</td><td class="v"><input id="tvFrom" type="date" value="' + esc(T.from || todayYmd()) + '"> to <input id="tvTo" type="date" value="' + esc(T.to || todayYmd()) + '"></td></tr>' +
      '<tr><td class="k">Places *</td><td class="v"><input id="tvPlaces" value="' + esc(T.places || '') + '"></td></tr>' +
      '<tr><td class="k">Travel by</td><td class="v"><select id="tvMode">' + selOpts(['Flight', 'Train', 'Car', 'Bus', 'Other'], T.mode || '') + '</select></td></tr>' +
      '<tr><td class="k">Ticket / PNR</td><td class="v"><input id="tvTicket" value="' + esc(T.ticket || '') + '"></td></tr>' +
      '<tr><td class="k">Hotel</td><td class="v"><input id="tvHotel" value="' + esc(T.hotel || '') + '"></td></tr>' +
      '<tr><td class="k">Estimated cost ₹</td><td class="v"><input id="tvCost" type="number" min="0" step="any" value="' + esc(T.cost || '') + '"></td></tr>' +
      '<tr><td class="k">Notes</td><td class="v"><textarea id="tvNotes" rows="3">' + esc(T.notes || '') + '</textarea></td></tr></table>' +
      '<div class="toolbar"><button class="btn primary" data-act="ea-trv-save">' + (T.id ? 'Save' : 'Add') + '</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>No</th><th>Who</th><th>Purpose</th><th>From</th><th>To</th><th>Places</th><th>By</th><th>Ticket / PNR</th><th>Hotel</th><th class="num">Cost ₹</th><th>Notes</th><th>Status</th><th>Added by</th>' + (edit ? '<th class="noprint"></th>' : '') + '</tr>' +
    (list.length ? list.map(t => '<tr><td class="nowrap"><b>' + esc(t.no) + '</b></td><td>' + esc(t.person) + '</td><td>' + esc(t.purpose) + '</td><td class="nowrap">' + fmtD(t.from) + '</td><td class="nowrap">' + fmtD(t.to) + '</td><td>' + esc(t.places) + '</td><td>' + esc(t.mode || '') + '</td><td>' + esc(t.ticket || '') + '</td><td>' + esc(t.hotel || '') + '</td><td class="num">' + (t.cost ? money(t.cost) : '') + '</td><td style="white-space:pre-wrap">' + esc(t.notes || '') + '</td><td><span class="st ' + (t.status === 'Done' ? 'Done' : t.status === 'Cancelled' ? 'Cancelled' : 'Pending') + '">' + esc(t.status) + '</span></td><td>' + esc(t.by) + '</td>' +
      (edit ? '<td class="noprint nowrap"><button class="btn sm" data-act="ea-trv-edit" data-id="' + esc(t.id) + '">Edit</button> ' + (t.status === 'Planned' ? '<button class="btn sm primary" data-act="ea-trv-st" data-id="' + esc(t.id) + '" data-st="Done">Done</button> <button class="btn sm ghost danger" data-act="ea-trv-st" data-id="' + esc(t.id) + '" data-st="Cancelled" data-confirm="Cancel this travel?">Cancel</button>' : '') + '</td>' : '') + '</tr>').join('')
      : '<tr><td colspan="14" class="empty">No travel</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['ea-trv-new'] = () => { EA_UI.form = 'trv'; EA_UI.trv = {}; VIEWS.ea.render(); };
ACTIONS['ea-trv-edit'] = el => { const t = Store.get('travels', el.dataset.id); if (!t) return; EA_UI.form = 'trv'; EA_UI.trv = Object.assign({}, t); VIEWS.ea.render(); };
ACTIONS['ea-trv-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  const g = id => ($('#' + id) || {}).value || ''; const msg = t => { $('#eaMsg').textContent = t; };
  const v = { person: g('tvWho'), purpose: g('tvWhy').trim(), from: g('tvFrom'), to: g('tvTo'), places: g('tvPlaces').trim(), mode: g('tvMode'), ticket: g('tvTicket').trim(), hotel: g('tvHotel').trim(), cost: num(g('tvCost')), notes: g('tvNotes').trim() };
  if (!v.person) return msg('Select who is travelling.'); if (!v.purpose) return msg('Enter the purpose.'); if (!v.from || !v.to) return msg('Enter the dates.'); if (v.to < v.from) return msg('The return date is before the start.'); if (!v.places) return msg('Enter the places.');
  const T = EA_UI.trv || {}; const t = T.id ? Object.assign(Store.get('travels', T.id), v) : Object.assign({ id: uid(), no: nextNo('travels', 'TRV'), status: 'Planned', by: ME.name, created_at: nowIso() }, v);
  Store.put('travels', t); audit(T.id ? 'travel.update' : 'travel.create', t.no, t.person + ' · ' + t.places + ' · ' + fmtD(t.from) + ' to ' + fmtD(t.to));
  EA_UI.form = false; EA_UI.trv = null; flash(esc(t.no) + ' saved.'); VIEWS.ea.render();
};
ACTIONS['ea-trv-st'] = el => { if (!requirePerm('ea', 'edit')) return; const t = Store.get('travels', el.dataset.id); const st = el.dataset.st; if (!t || !TRV_ST.includes(st)) return; const old = t.status; t.status = st; t.status_by = ME.name; t.status_at = nowIso(); Store.put('travels', t); audit('travel.status', t.no, old + ' → ' + st); VIEWS.ea.render(); };

/* ---------- Contacts book: people outside Nexus (bank, CA, buyers, government…) ---------- */
const CT_KINDS = ['Buyer', 'Bank', 'CA / Auditor', 'Government', 'Transporter', 'Service', 'Other'];
function eaCtHtml() {
  const edit = eaEdit(); const q = norm(EA_UI.cq || '');
  const list = Store.all('contacts').filter(c => !q || norm([c.name, c.org, c.kind, c.mobile, c.email, c.notes].join(' ')).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  let h = '<div class="toolbar noprint"><input id="ctQ" placeholder="Search name, company, number…" value="' + esc(EA_UI.cq || '') + '"><span class="muted small">' + list.length + ' contact(s)</span><span class="grow"></span><button class="btn" data-act="print">Print</button>' + (edit ? '<button class="btn primary" data-act="ea-ct-new">+ Contact</button>' : '') + '</div>';
  if (EA_UI.form === 'ct') {
    const C = EA_UI.ct || {};
    h += '<div class="panel" style="max-width:760px"><table class="jckv">' +
      '<tr><td class="k">Name *</td><td class="v"><input id="ctName" value="' + esc(C.name || '') + '"></td></tr>' +
      '<tr><td class="k">Company</td><td class="v"><input id="ctOrg" value="' + esc(C.org || '') + '"></td></tr>' +
      '<tr><td class="k">Type *</td><td class="v"><select id="ctKind">' + selOpts(CT_KINDS, C.kind || '') + '</select></td></tr>' +
      '<tr><td class="k">Mobile</td><td class="v"><input id="ctMob" value="' + esc(C.mobile || '') + '"></td></tr>' +
      '<tr><td class="k">Email</td><td class="v"><input id="ctMail" value="' + esc(C.email || '') + '"></td></tr>' +
      '<tr><td class="k">Address</td><td class="v"><input id="ctAddr" value="' + esc(C.address || '') + '"></td></tr>' +
      '<tr><td class="k">Notes</td><td class="v"><textarea id="ctNotes" rows="2">' + esc(C.notes || '') + '</textarea></td></tr></table>' +
      '<div class="toolbar"><button class="btn primary" data-act="ea-ct-save">' + (C.id ? 'Save' : 'Add') + '</button><button class="btn" data-act="ea-cancel">Cancel</button><span id="eaMsg" class="small late-txt"></span></div></div>';
  }
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Name</th><th>Company</th><th>Type</th><th>Mobile</th><th>Email</th><th>Address</th><th>Notes</th><th>Added by</th>' + (edit ? '<th class="noprint"></th>' : '') + '</tr>' +
    (list.length ? list.map(c => '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.org || '') + '</td><td>' + esc(c.kind || '') + '</td><td class="nowrap">' + (c.mobile ? '<a href="https://wa.me/91' + esc(c.mobile) + '" target="_blank" rel="noopener">' + esc(c.mobile) + '</a>' : '') + '</td><td>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '') + '</td><td>' + esc(c.address || '') + '</td><td>' + esc(c.notes || '') + '</td><td>' + esc(c.by || '') + '</td>' +
      (edit ? '<td class="noprint nowrap"><button class="btn sm" data-act="ea-ct-edit" data-id="' + esc(c.id) + '">Edit</button> <button class="btn sm ghost danger" data-act="ea-ct-del" data-id="' + esc(c.id) + '" data-confirm="Remove this contact?">Remove</button></td>' : '') + '</tr>').join('')
      : '<tr><td colspan="9" class="empty">No contacts</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['ea-ct-new'] = () => { EA_UI.form = 'ct'; EA_UI.ct = {}; VIEWS.ea.render(); };
ACTIONS['ea-ct-edit'] = el => { const c = Store.get('contacts', el.dataset.id); if (!c) return; EA_UI.form = 'ct'; EA_UI.ct = Object.assign({}, c); VIEWS.ea.render(); };
ACTIONS['ea-ct-save'] = () => {
  if (!requirePerm('ea', 'edit')) return;
  const g = id => ($('#' + id) || {}).value || ''; const msg = t => { $('#eaMsg').textContent = t; };
  const v = { name: g('ctName').trim(), org: g('ctOrg').trim(), kind: g('ctKind'), mobile: g('ctMob').replace(/\D/g, '').slice(-10), email: g('ctMail').trim().toLowerCase(), address: g('ctAddr').trim(), notes: g('ctNotes').trim() };
  if (!v.name) return msg('Enter the name.'); if (!v.kind) return msg('Select the type.');
  if (v.mobile && !/^[6-9]\d{9}$/.test(v.mobile)) return msg('Mobile must be 10 digits.'); if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return msg('Email ID is not valid.');
  if (!v.mobile && !v.email) return msg('Enter a mobile number or an email ID.');
  const C = EA_UI.ct || {}; if (Store.all('contacts').some(c => c.id !== C.id && norm(c.name) === norm(v.name) && norm(c.org || '') === norm(v.org))) return msg('This contact already exists.');
  const c = C.id ? Object.assign(Store.get('contacts', C.id), v) : Object.assign({ id: uid(), by: ME.name, created_at: nowIso() }, v);
  Store.put('contacts', c); audit(C.id ? 'contact.update' : 'contact.create', c.name, (c.org ? c.org + ' · ' : '') + c.kind + (c.mobile ? ' · ' + c.mobile : '') + (c.email ? ' · ' + c.email : ''));
  EA_UI.form = false; EA_UI.ct = null; flash(esc(c.name) + ' saved.'); VIEWS.ea.render();
};
ACTIONS['ea-ct-del'] = el => { if (!requirePerm('ea', 'edit')) return; const c = Store.get('contacts', el.dataset.id); if (!c) return; Store.del('contacts', c.id); audit('contact.delete', c.name, c.org || ''); VIEWS.ea.render(); };
