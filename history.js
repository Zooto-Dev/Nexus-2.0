/* ---------- Change history: every add / change / delete is recorded by the database (table nx_history) ----------
   The app cannot skip it: a trigger on nx_docs writes the full old and new copy, the login and the time.
   Only a Super Admin can read it; nobody can edit or delete it. */

/* ---- FMS: what changed between two specs, one row per change, by step name ---- */
function hxFieldLabel(sp, k) { const f = ((sp && sp.fields) || []).find(x => x.key === k) || (typeof FMS_SYS_FIELDS !== 'undefined' ? FMS_SYS_FIELDS : []).find(x => x.key === k); return f ? f.label : (k || '—'); }
function hxStepName(sp, id) { const s = ((sp && sp.steps) || []).find(x => x.id === id); return s ? s.name : (id || '—'); }
function hxTat(t) { return t ? t.value + (t.unit === 'hours' ? ' h' : ' d') + (t.urgent != null && t.urgent !== '' ? ' (urgent ' + t.urgent + ')' : '') : '—'; }
function hxDoer(sp, d) {
  if (!d) return '—'; if (typeof d === 'string') return d;
  if (d.type === 'fixed') return d.name || '—';
  if (d.type === 'field') return hxFieldLabel(sp, d.field);
  if (d.type === 'lookup') return 'Doer table ' + d.table;
  return (d.rules || []).map(r => r.name + ' if ' + hxFieldLabel(sp, (r.when || {}).field) + ' = ' + ((r.when || {}).in || []).join('/')).concat(d.default ? ['else ' + d.default] : []).join('; ');
}
function hxCond(sp, c) {
  if (!c) return ''; if (c.all || c.any) return (c.all || c.any).map(x => hxCond(sp, x)).join(c.all ? ' and ' : ' or ');
  const f = hxFieldLabel(sp, c.field);
  if (c.in) return f + ' = ' + c.in.join('/'); if (c.notIn) return f + ' ≠ ' + c.notIn.join('/');
  if ('eq' in c) return f + ' = ' + c.eq; if ('ne' in c) return f + ' ≠ ' + c.ne; if ('empty' in c) return f + (c.empty ? ' empty' : ' filled');
  return JSON.stringify(c);
}
function hxTrig(sp, tr) {
  const one = t => {
    if (!t) return '—'; let s;
    if (t.type === 'instanceStart') s = 'Order punch';
    else if (t.type === 'afterStep') s = 'After ' + hxStepName(sp, t.step);
    else if (t.type === 'external') s = 'On ' + hxFieldLabel(sp, t.field);
    else if (t.type === 'beforeDate') s = 'Before ' + hxFieldLabel(sp, t.field);
    else if (t.type === 'afterDate') s = 'After ' + hxFieldLabel(sp, t.field);
    else s = t.type;
    return s + (t.when ? ' (if ' + hxCond(sp, t.when) + ')' : '') + (t.tat ? ' +' + hxTat(t.tat) : '');
  };
  return Array.isArray(tr) ? tr.map(one).join(' or ') : one(tr);
}
function hxStatus(sp, s) {
  if (!s.status || s.status.type !== 'auto') return 'Manual' + (s.capture ? ', asks ' + hxFieldLabel(sp, s.capture.field) : '');
  const r = (typeof FMS_RULES !== 'undefined' ? FMS_RULES : []).find(x => x.id === s.status.rule);
  return 'Auto: ' + (r ? r.label : s.status.rule) + (s.status.field ? ' (' + hxFieldLabel(sp, s.status.field) + ')' : '');
}
function specDiff(a, b) {
  a = a || {}; b = b || {}; const rows = [];
  const add = (step, what, from, to) => rows.push({ step, what, from: from == null || from === '' ? '—' : String(from), to: to == null || to === '' ? '—' : String(to) });
  const pa = a.process || {}, pb = b.process || {};
  if ((pa.name || '') !== (pb.name || '')) add('FMS', 'Name', pa.name, pb.name);
  const sa = a.steps || [], sb = b.steps || []; const ia = new Map(sa.map((s, i) => [s.id, i])), ib = new Map(sb.map((s, i) => [s.id, i]));
  sa.forEach(s => { if (!ib.has(s.id)) add(s.name, 'Step removed', s.name, ''); });
  sb.forEach((s, i) => {
    if (!ia.has(s.id)) { add(s.name, 'Step added', '', 'Position ' + (i + 1) + ' · ' + hxDoer(b, s.doer) + ' · ' + hxTrig(b, s.trigger)); return; }
    const o = sa[ia.get(s.id)]; const nm = s.name || o.name;
    const cmp = (what, x, y) => { if (x !== y) add(nm, what, x, y); };
    cmp('Name', o.name || '', s.name || '');
    cmp('Doer', hxDoer(a, o.doer), hxDoer(b, s.doer));
    cmp('Starts', hxTrig(a, o.trigger), hxTrig(b, s.trigger));
    cmp('TAT', hxTat(o.tat), hxTat(s.tat));
    cmp('Closes', hxStatus(a, o), hxStatus(b, s));
    cmp('Only for', hxCond(a, o.applies) || 'All orders', hxCond(b, s.applies) || 'All orders');
    cmp('Work', o.what || '', s.what || '');
  });
  // order of steps (only when no step was added / removed, else every position shifts)
  if (sa.length === sb.length && sa.every(s => ib.has(s.id))) sb.forEach((s, i) => { const j = ia.get(s.id); if (j !== i) add(s.name, 'Position', j + 1, i + 1); });
  const fa = new Map((a.fields || []).map(f => [f.key, f])), fb = new Map((b.fields || []).map(f => [f.key, f]));
  fa.forEach((f, k) => { if (!fb.has(k)) add('Fields', 'Field removed', f.label, ''); });
  fb.forEach((f, k) => { if (!fa.has(k)) add('Fields', 'Field added', '', f.label); else if (JSON.stringify(fa.get(k)) !== JSON.stringify(f)) add('Fields', f.label, JSON.stringify(fa.get(k)), JSON.stringify(f)); });
  const ta = a.doerTables || {}, tb = b.doerTables || {};
  new Set(Object.keys(ta).concat(Object.keys(tb))).forEach(t => {
    const x = ta[t], y = tb[t]; if (!x) { add('Doer table ' + t, 'Table added', '', Object.keys(y).length + ' rows'); return; } if (!y) { add('Doer table ' + t, 'Table removed', Object.keys(x).length + ' rows', ''); return; }
    new Set(Object.keys(x).concat(Object.keys(y))).forEach(k => { if ((x[k] || '') !== (y[k] || '')) add('Doer table ' + t, k, x[k], y[k]); });
  });
  if (JSON.stringify(a.priority || {}) !== JSON.stringify(b.priority || {})) add('FMS', 'Priority rules', JSON.stringify(a.priority || {}), JSON.stringify(b.priority || {}));
  return rows;
}
const specDiffText = rows => rows.map(r => r.step + ' · ' + r.what + ': ' + r.from + ' → ' + r.to).join('\n');
// Problems a save would cause: steps that would wait forever
function specWarnings(sp) {
  const out = []; const steps = (sp && sp.steps) || []; const ids = new Set(steps.map(s => s.id));
  const asked = new Set(steps.filter(s => s.capture && s.capture.field).map(s => s.capture.field));
  steps.forEach(s => (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).forEach(t => {
    if (!t) return;
    if (t.type === 'afterStep' && t.step && !ids.has(t.step)) out.push(s.name + ' waits for a step that no longer exists (' + t.step + ').');
    if (['external', 'beforeDate', 'afterDate'].includes(t.type) && t.field) {
      const f = ((sp.fields) || []).find(x => x.key === t.field);
      if (f && f.source === 'step' && !asked.has(t.field)) out.push(s.name + ' starts from ' + f.label + ', but no step asks for ' + f.label + ' — it will stay Waiting.');
    }
  }));
  return out;
}

/* ---- generic record diff: every changed value, by path ---- */
function hxFlat(v, p, out) {
  if (v && typeof v === 'object') {
    const ks = Object.keys(v); if (!ks.length) out[p] = Array.isArray(v) ? '[]' : '{}';
    ks.forEach(k => hxFlat(v[k], p ? p + (Array.isArray(v) ? '[' + (+k + 1) + ']' : '.' + k) : (Array.isArray(v) ? '[' + (+k + 1) + ']' : k), out));
  } else out[p] = v;
  return out;
}
function hxDiff(a, b) {
  const fa = hxFlat(a || {}, '', {}), fb = hxFlat(b || {}, '', {}); const rows = [];
  new Set(Object.keys(fa).concat(Object.keys(fb))).forEach(k => {
    if (SKIP_KEYS.has(k.split(/[.[]/)[0])) return;
    const x = fa[k], y = fb[k]; if (JSON.stringify(x) === JSON.stringify(y)) return;
    const mask = v => SECRET_KEY.test(k) ? '•••' : (v == null || v === '' ? '—' : String(v));
    rows.push({ step: k, what: '', from: mask(x), to: mask(y) });
  });
  return rows;
}

/* ---- confirm before saving an FMS: show every change and every problem ---- */
function hxTable(rows, withStep) {
  return '<div class="tbl-wrap hx-wrap"><table class="hx-t nopage nofilter"><tr>' + (withStep ? '<th>Step</th><th>Change</th>' : '<th>Field</th>') + '<th>Before</th><th>After</th></tr>' +
    rows.map(r => '<tr>' + (withStep ? '<td>' + esc(r.step) + '</td><td>' + esc(r.what) + '</td>' : '<td class="mono">' + esc(r.step) + '</td>') + '<td class="hx-old">' + esc(r.from) + '</td><td class="hx-new">' + esc(r.to) + '</td></tr>').join('') + '</table></div>';
}
function hxConfirm(title, rows, warns, onOk) {
  const old = $('#hxDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'hxDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg hx-dlg"><div class="dlg-h">' + esc(title) + ' · ' + rows.length + ' change(s)</div>' +
    (warns.length ? '<ul class="val hx-warn">' + warns.map(w => '<li class="e">' + esc(w) + '</li>').join('') + '</ul>' : '') +
    (rows.length ? hxTable(rows, true) : '') +
    '<div class="dlg-f"><span class="grow"></span><button class="btn" data-hx-x>Cancel</button><button class="btn primary" data-hx-ok>' + (warns.length ? 'Save anyway' : 'Save') + '</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click', ev => { if (ev.target.closest('[data-hx-x]') || ev.target === d) { d.remove(); return; } if (ev.target.closest('[data-hx-ok]')) { d.remove(); onOk(); } });
}

/* ---- History screen (Super Admin) ---- */
const HX_UI = { col: '', who: '', from: '', to: '', doc: '', rows: null, busy: false, err: '' };
const HX_OPS = { insert: 'Added', update: 'Changed', delete: 'Deleted', snapshot: 'Snapshot' };
function hxWho(r) {
  if (r.via === 'baseline' || /^backup/.test(r.via || '')) return 'Snapshot (' + r.via + ')';
  if (!r.user_email) return r.via === 'service_role' ? 'Server' : 'Database (direct, ' + (r.via || '?') + ')';
  const u = Store.all('users').find(x => norm(x.email) === norm(r.user_email)); return u ? u.name : r.user_email;
}
function hxRecord(r) { const d = r.new_data || r.old_data || {}; return docRef(r.collection, d); }
function hxChanges(r) { return r.op === 'update' ? (r.collection === 'processes' ? specDiff((r.old_data || {}).spec, (r.new_data || {}).spec) : hxDiff(r.old_data, r.new_data)) : []; }
async function hxLoad() {
  if (!SB || DEMO) { HX_UI.rows = []; HX_UI.err = 'live'; return; }
  HX_UI.busy = true; HX_UI.err = '';
  try {
    let q = SB.from('nx_history').select('hid,at,op,collection,doc_id,old_data,new_data,user_email,via').order('at', { ascending: false }).order('hid', { ascending: false }).limit(HX_UI.doc ? 200 : 300);
    if (HX_UI.col) q = q.eq('collection', HX_UI.col);
    if (HX_UI.doc) q = q.eq('doc_id', HX_UI.doc);
    if (HX_UI.who) q = q.eq('user_email', HX_UI.who);
    if (HX_UI.from) q = q.gte('at', HX_UI.from + 'T00:00:00+05:30');
    if (HX_UI.to) q = q.lte('at', HX_UI.to + 'T23:59:59+05:30');
    if (!HX_UI.doc) q = q.neq('op', 'snapshot');
    const { data, error } = await q; if (error) throw error;
    HX_UI.rows = data || [];
  } catch (e) { HX_UI.rows = []; HX_UI.err = e.message || String(e); }
  HX_UI.busy = false;
}
VIEWS.history = {
  mod: 'audit', render() {
    if (!isSuperAdmin()) { setMain('<div class="panel empty">Super Admin only.</div>'); return; }
    if (HX_UI.rows === null) { setMain('<div class="panel empty">Loading…</div>'); hxLoad().then(() => { if (curView().v === 'history') VIEWS.history.render(); }); return; }
    const users = Store.all('users').filter(u => u.email).sort((a, b) => a.name < b.name ? -1 : 1);
    const cols = COLS.filter(c => c !== 'audit').concat(['settings']);
    const docName = HX_UI.doc && HX_UI.rows.length ? hxRecord(HX_UI.rows[0]) : HX_UI.doc;
    let h = '<div class="toolbar">' +
      '<select id="hxCol"><option value="">All areas</option>' + cols.map(c => '<option' + (c === HX_UI.col ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<select id="hxWho"><option value="">Everyone</option>' + users.map(u => '<option value="' + esc(u.email) + '"' + (norm(u.email) === norm(HX_UI.who) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
      '<input type="date" id="hxFrom" value="' + esc(HX_UI.from) + '"><input type="date" id="hxTo" value="' + esc(HX_UI.to) + '">' +
      (HX_UI.doc ? '<span class="chip">' + esc(docName) + ' <a data-act="hx-alldocs">✕</a></span>' : '') +
      '<span class="grow"></span><span class="muted small">' + HX_UI.rows.length + '</span><button class="btn sm" data-act="hx-reload">Refresh</button></div>';
    if (HX_UI.err === 'live') h += '<div class="panel empty">Live mode only.</div>';
    else if (HX_UI.err) h += '<div class="panel empty late-txt">' + esc(HX_UI.err) + '</div>';
    else h += '<div class="tbl-wrap"><table class="hx-list"><tr><th>Date &amp; Time</th><th>Who</th><th>Action</th><th>Area</th><th>Record</th><th class="num">Changes</th><th>What changed</th></tr>' +
      HX_UI.rows.map((r, i) => { const ch = hxChanges(r); return '<tr class="clk" data-act="hx-open" data-i="' + i + '"><td class="nowrap">' + fmtDT(r.at) + '</td><td>' + esc(hxWho(r)) + '</td><td>' + esc(HX_OPS[r.op] || r.op) + '</td><td>' + esc(r.collection) + '</td><td>' + esc(hxRecord(r)) + '</td><td class="num">' + (r.op === 'update' ? ch.length : '') + '</td><td class="hx-sum">' + esc(ch.slice(0, 2).map(c => (c.what ? c.step + ' · ' + c.what : c.step) + ': ' + c.from + ' → ' + c.to).join(' | ')) + (ch.length > 2 ? ' …' : '') + '</td></tr>'; }).join('') + '</table></div>';
    setMain(h);
    const re = () => { HX_UI.rows = null; VIEWS.history.render(); };
    $('#hxCol').addEventListener('change', e => { HX_UI.col = e.target.value; HX_UI.doc = ''; re(); });
    $('#hxWho').addEventListener('change', e => { HX_UI.who = e.target.value; re(); });
    $('#hxFrom').addEventListener('change', e => { HX_UI.from = e.target.value; re(); });
    $('#hxTo').addEventListener('change', e => { HX_UI.to = e.target.value; re(); });
  }
};
ACTIONS['hx-reload'] = () => { HX_UI.rows = null; VIEWS.history.render(); };
ACTIONS['hx-alldocs'] = () => { HX_UI.doc = ''; HX_UI.rows = null; VIEWS.history.render(); };
ACTIONS['hx-doc'] = el => { HX_UI.col = el.dataset.col; HX_UI.doc = el.dataset.id; HX_UI.who = ''; HX_UI.from = ''; HX_UI.to = ''; HX_UI.rows = null; go('history'); };
ACTIONS['hx-open'] = el => {
  const r = HX_UI.rows[+el.dataset.i]; if (!r) return; const isP = r.collection === 'processes';
  let rows = hxChanges(r); if (r.op !== 'update') rows = hxDiff(r.op === 'delete' ? r.old_data : {}, r.op === 'delete' ? {} : r.new_data);
  const canRestore = r.op !== 'insert' && (r.op === 'delete' ? r.old_data : (r.op === 'update' ? r.old_data : r.new_data)) && (COLS.includes(r.collection) || r.collection === 'settings') && !SANDBOX;
  const old = $('#hxDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'hxDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg hx-dlg"><div class="dlg-h">' + esc(r.collection) + ' · ' + esc(hxRecord(r)) + ' · ' + esc(HX_OPS[r.op] || r.op) + '</div>' +
    '<table class="jckv"><tr><td class="k">Date &amp; Time</td><td class="v">' + fmtDT(r.at) + '</td><td class="k">Who</td><td class="v">' + esc(hxWho(r)) + (r.user_email ? ' (' + esc(r.user_email) + ')' : '') + '</td></tr></table>' +
    (rows.length ? hxTable(rows, isP && r.op === 'update') : '<div class="panel empty">—</div>') +
    '<div class="dlg-f">' + (!HX_UI.doc ? '<button class="btn" data-hx-doc>All changes of this record</button>' : '') + '<span class="grow"></span>' +
    (canRestore ? '<button class="btn danger" data-hx-restore>' + (r.op === 'update' ? 'Restore the "Before" copy' : 'Restore this copy') + '</button>' : '') + '<button class="btn primary" data-hx-x>Close</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-hx-x]') || ev.target === d) { d.remove(); return; }
    if (ev.target.closest('[data-hx-doc]')) { d.remove(); ACTIONS['hx-doc']({ dataset: { col: r.collection, id: r.doc_id } }); return; }
    if (ev.target.closest('[data-hx-restore]')) {
      const copy = clone(r.op === 'snapshot' ? r.new_data : r.old_data); if (!copy) return;
      const cur = r.collection === 'settings' ? DB.settings : Store.get(r.collection, r.doc_id);
      const back = r.collection === 'processes' && cur ? specDiff(cur.spec, copy.spec) : hxDiff(cur || {}, copy);
      d.remove();
      hxConfirm('Restore ' + r.collection + ' · ' + hxRecord(r) + ' to ' + fmtDT(r.at), back, [], () => {
        if (r.collection === 'settings') Store.setSettings(copy);
        else { if (cur && cur.active != null && r.collection === 'processes') copy.active = cur.active; Store.put(r.collection, copy); }
        RES_CACHE.clear(); audit('history.restore', r.collection + ' ' + hxRecord(r), 'Restored the copy of ' + fmtDT(r.at) + '\n' + specDiffText(back));
        flash('Restored.'); HX_UI.rows = null; setTimeout(() => VIEWS.history.render(), 1500);
      });
    }
  });
};
