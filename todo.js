/* Nexus 2.0 — To-do list.
   A person's own running list, next to the tasks the system gives them. Every item has a date and a
   time, so it can remind: the phone rings at the chosen moment whether the app is open or shut.
   Everything is picked from a dropdown, nothing is typed free-hand except the item itself and the note. */
'use strict';
const TD_CAT = ['Call', 'Meeting', 'Follow-up', 'Approval', 'Payment', 'Document', 'Review', 'Visit', 'Personal', 'Other'];
const TD_PRI = ['High', 'Medium', 'Low'];
// how long before the time it should remind
const TD_REM = [['0', 'At the time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['180', '3 hours before'], ['1440', '1 day before'], ['', 'No reminder']];
const TD_HOURS = (() => { const o = []; for (let h = 6; h <= 22; h++) for (const m of ['00', '30']) o.push(String(h).padStart(2, '0') + ':' + m); return o; })();
const TD_UI = { tab: 'today', who: '', q: '' };

const tdAll = () => Store.all('todos').filter(t => t.active !== false);
const tdMine = who => tdAll().filter(t => norm(t.doer) === norm(who || ME.doer));
const tdDue = t => t.due_date ? new Date(t.due_date + 'T' + (t.due_time || '18:00') + ':00') : null;
// the moment it has to ring: the due time, less the chosen warning
function tdRemindAt(t) {
  if (t.status === 'Done' || t.remind === '' || t.remind == null) return null;
  const d = tdDue(t); if (!d || isNaN(d)) return null;
  return new Date(d.getTime() - num(t.remind) * 60000);
}
const tdRemLabel = v => (TD_REM.find(r => r[0] === String(v == null ? '' : v)) || ['', 'No reminder'])[1];
function tdStatus(t) {
  if (t.status === 'Done') return 'Done';
  const d = tdDue(t); if (!d) return 'Open';
  const today = todayYmd();
  if (t.due_date < today) return 'Overdue';
  if (t.due_date === today) return d < new Date() ? 'Overdue' : 'Today';
  return 'Upcoming';
}
const TD_CLS = { Overdue: 'Late', Today: 'Pending', Upcoming: 'Waiting', Done: 'Done', Open: 'Waiting' };
const tdPriCls = p => p === 'High' ? 'Late' : p === 'Low' ? 'Waiting' : 'Pending';
// a to-do can be given to someone else only by whoever may assign tasks; otherwise it is one's own list
const tdCanAssign = () => typeof clCanAdd === 'function' ? clCanAdd() : false;

/* ---------- the dialog ---------- */
function tdDialog(t) {
  const isNew = !t;
  const v = t || { doer: ME.doer || '', category: 'Follow-up', priority: 'Medium', due_date: todayYmd(), due_time: '18:00', remind: '30', status: 'Open' };
  const fields = [
    { k: 'title', l: 'To-do', value: v.title || '', req: true },
    { k: 'category', l: 'Category', type: 'select', options: TD_CAT, value: v.category || 'Follow-up' },
    { k: 'priority', l: 'Priority', type: 'select', options: TD_PRI, value: v.priority || 'Medium' },
    { k: 'due_date', l: 'Date', type: 'date', value: v.due_date || todayYmd(), req: true },
    { k: 'due_time', l: 'Time', type: 'select', options: TD_HOURS, value: v.due_time || '18:00' },
    { k: 'remind', l: 'Remind me', type: 'select', options: TD_REM.map(r => r[1]), value: tdRemLabel(v.remind) },
    { k: 'note', l: 'Note', type: 'textarea', value: v.note || '' }
  ];
  if (tdCanAssign()) fields.splice(1, 0, { k: 'doer', l: 'For', type: 'select', options: clDoerList(), value: v.doer || ME.doer || '' });
  formDialog(isNew ? 'New to-do' : 'Edit to-do', fields, isNew ? 'Add' : 'Save', f => {
    const rem = (TD_REM.find(r => r[1] === f.remind) || ['30'])[0];
    const doer = tdCanAssign() ? (f.doer || ME.doer) : (v.doer || ME.doer);
    const r = Object.assign({}, v, { title: f.title.trim(), category: f.category, priority: f.priority, due_date: f.due_date, due_time: f.due_time, remind: rem, note: f.note.trim(), doer, active: true, status: v.status || 'Open' });
    if (!r.title) return 'Enter the to-do.';
    Store.put('todos', r);
    audit(isNew ? 'todo.create' : 'todo.edit', r.title, r.doer + ' · ' + fmtD(r.due_date) + ' ' + r.due_time + ' · ' + r.priority + ' · ' + tdRemLabel(r.remind));
    if (typeof alarmFor === 'function') alarmFor('todo', r);
    flash(isNew ? 'To-do added.' : 'To-do saved.');
    VIEWS.todo.render();
  });
}
ACTIONS['td-new'] = () => tdDialog(null);
ACTIONS['td-edit'] = el => { const t = Store.get('todos', el.dataset.id); if (t) tdDialog(t); };
ACTIONS['td-done'] = el => {
  const t = Store.get('todos', el.dataset.id); if (!t) return;
  t.status = 'Done'; t.done_at = nowIso(); t.done_by = ME.name;
  Store.put('todos', t); audit('todo.done', t.title, t.doer);
  if (typeof alarmFor === 'function') alarmFor('todo', t);
  flash('Done.'); VIEWS.todo.render();
};
ACTIONS['td-reopen'] = el => {
  const t = Store.get('todos', el.dataset.id); if (!t) return;
  t.status = 'Open'; delete t.done_at; delete t.done_by;
  Store.put('todos', t); audit('todo.reopen', t.title, t.doer);
  if (typeof alarmFor === 'function') alarmFor('todo', t);
  flash('Reopened.'); VIEWS.todo.render();
};
ACTIONS['td-del'] = el => {
  const t = Store.get('todos', el.dataset.id); if (!t) return;
  reasonDialog('Remove "' + t.title + '"', 'Remove', why => {
    t.active = false; t.removed_why = why; Store.put('todos', t);
    audit('todo.remove', t.title, t.doer + ' — ' + why);
    if (typeof alarmFor === 'function') alarmFor('todo', t);
    flash('Removed.'); VIEWS.todo.render();
  }, true);
};
// push the date on without opening the dialog
ACTIONS['td-push'] = el => {
  const t = Store.get('todos', el.dataset.id); if (!t) return;
  const d = new Date((t.due_date || todayYmd()) + 'T12:00:00'); d.setDate(d.getDate() + num(el.dataset.d || 1));
  t.due_date = ymdOf(d); Store.put('todos', t);
  audit('todo.move', t.title, t.doer + ' → ' + fmtD(t.due_date));
  if (typeof alarmFor === 'function') alarmFor('todo', t);
  flash('Moved to ' + fmtD(t.due_date) + '.'); VIEWS.todo.render();
};

/* ---------- the screen ---------- */
function tdRowsFor(who) {
  const all = tdMine(who).map(t => Object.assign({}, t, { st: tdStatus(t), at: tdDue(t) }));
  const q = norm(TD_UI.q);
  const pick = all.filter(t => !q || norm(t.title).includes(q) || norm(t.category).includes(q) || norm(t.note).includes(q));
  const tab = TD_UI.tab;
  const list = tab === 'all' ? pick : tab === 'done' ? pick.filter(t => t.st === 'Done')
    : tab === 'overdue' ? pick.filter(t => t.st === 'Overdue') : tab === 'upcoming' ? pick.filter(t => t.st === 'Upcoming')
      : pick.filter(t => t.st === 'Today' || t.st === 'Overdue');
  const ord = { Overdue: 0, Today: 1, Upcoming: 2, Open: 3, Done: 4 };
  const pr = { High: 0, Medium: 1, Low: 2 };
  return list.sort((a, b) => (ord[a.st] - ord[b.st]) || (a.due_date || '').localeCompare(b.due_date || '') || (a.due_time || '').localeCompare(b.due_time || '') || (pr[a.priority] - pr[b.priority]));
}
function tdCount(who, st) { return tdMine(who).filter(t => tdStatus(t) === st).length; }
function tdTable(rows, compact) {
  if (!rows.length) return '<div class="muted small pad">Nothing here.</div>';
  return '<div class="tbl-wrap"><table class="bomflat"><tr><th>To-do</th><th>Category</th><th>Priority</th><th>Date</th><th>Time</th><th>Remind</th><th>Status</th>' + (compact ? '' : '<th>Note</th><th>Done by</th>') + '<th></th></tr>' +
    rows.map(t => '<tr><td>' + esc(t.title) + '</td><td>' + esc(t.category || '') + '</td>' +
      '<td><span class="st ' + tdPriCls(t.priority) + '">' + esc(t.priority || '') + '</span></td>' +
      '<td class="nowrap">' + fmtD(t.due_date) + '</td><td class="nowrap">' + esc(t.due_time || '') + '</td>' +
      '<td class="small">' + esc(tdRemLabel(t.remind)) + '</td>' +
      '<td><span class="st ' + (TD_CLS[t.st] || 'Waiting') + '">' + esc(t.st) + '</span></td>' +
      (compact ? '' : '<td class="small">' + esc(t.note || '') + '</td><td class="small">' + esc(t.done_by ? t.done_by + ' · ' + fmtDT(t.done_at) : '') + '</td>') +
      '<td class="nowrap">' + (t.st === 'Done'
        ? '<button class="btn ghost sm" data-act="td-reopen" data-id="' + esc(t.id) + '">Reopen</button>'
        : '<button class="btn sm" data-act="td-done" data-id="' + esc(t.id) + '">Done</button>' +
        '<button class="btn ghost sm" data-act="td-push" data-id="' + esc(t.id) + '" data-d="1">+1 day</button>' +
        '<button class="btn ghost sm" data-act="td-edit" data-id="' + esc(t.id) + '">Edit</button>') +
      '<button class="btn ghost sm danger" data-act="td-del" data-id="' + esc(t.id) + '">Remove</button></td></tr>').join('') + '</table></div>';
}
VIEWS.todo = {
  mod: 'tasks', render() {
    const who = TD_UI.who || ME.doer || '';
    const tabs = [{ v: 'today', l: 'Today (' + (tdCount(who, 'Today') + tdCount(who, 'Overdue')) + ')' }, { v: 'overdue', l: 'Overdue (' + tdCount(who, 'Overdue') + ')' },
      { v: 'upcoming', l: 'Upcoming (' + tdCount(who, 'Upcoming') + ')' }, { v: 'done', l: 'Done' }, { v: 'all', l: 'All' }];
    let h = '<div class="toolbar noprint">' + seg('tdTab', tabs, TD_UI.tab) +
      (tdCanAssign() ? '<select id="tdWho">' + doerOpts(clDoerList(), who, 'My list') + '</select>' : '') +
      '<input id="tdQ" placeholder="Search" value="' + esc(TD_UI.q) + '"><span class="grow"></span>' +
      '<button class="btn primary" data-act="td-new">New to-do</button></div>';
    h += tdTable(tdRowsFor(who));
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'tdTab') { TD_UI.tab = e.detail; VIEWS.todo.render(); } });
    const w = $('#tdWho'); if (w) w.addEventListener('change', e => { TD_UI.who = e.target.value; VIEWS.todo.render(); });
    const q = $('#tdQ'); if (q) q.addEventListener('change', e => { TD_UI.q = e.target.value; VIEWS.todo.render(); });
  }
};
