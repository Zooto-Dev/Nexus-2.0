/* Nexus 2.0 — FMS Builder: steps editor, live flow chart, validation, simulate, versions. */
'use strict';
const B = { pid: null, draft: null, sel: null, tab: 'flow', dirty: false, pv: {}, sim: null };
const TRIG_TYPES = [{ v: 'instanceStart', l: 'Order punch' }, { v: 'afterStep', l: 'After step' }, { v: 'beforeDate', l: 'Before date' }, { v: 'afterDate', l: 'After date' }, { v: 'external', l: 'On date' }];
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'step';

function bldLoad(pid) {
  const p = Store.get('processes', pid) || activeProcess() || Store.all('processes')[0];
  B.pid = p ? p.id : null; B.draft = p ? clone(p.spec) : null; B.dirty = false;
  B.sel = B.draft && B.draft.steps[0] ? B.draft.steps[0].id : null;
}
function bldFields(types) { return (B.draft.fields || []).filter(f => !types || types.includes(f.type)); }
function fieldOpts(key) { const f = (B.draft.fields || []).find(x => x.key === key); if (!f) return []; if (f.options) return f.options.filter(o => o !== ''); if (f.optionsFrom && f.optionsFrom.startsWith('doerTables.')) return Object.keys((B.draft.doerTables || {})[f.optionsFrom.split('.')[1]] || {}); return []; }
function doerNames() { return Array.from(new Set(Store.all('users').map(u => u.doer).filter(Boolean))).sort(); }
function tatStr(t) { return t ? t.value + (t.unit === 'hours' ? 'h' : 'd') + (t.urgent != null && t.urgent !== '' ? ' / urgent ' + t.urgent + (t.unit === 'hours' ? 'h' : 'd') : '') : ''; }
function doerText(d) { if (!d) return ''; if (typeof d === 'string') return d; if (d.type === 'fixed') return d.name || ''; if (d.type === 'field') return fieldLabel(d.field); if (d.type === 'lookup') return d.table + ' (by ' + fieldLabel(d.by) + ')'; return (d.rules || []).map(r => r.name).concat(d.default ? [d.default] : []).join(' / '); }
function fieldLabel(k) { const f = (B.draft.fields || []).find(x => x.key === k); return f ? f.label : k; }
function describeTrigger(t) {
  if (!t) return '';
  const w = t.when ? ' (if ' + condText(t.when) + ')' : '';
  const step = t.step && B.draft.steps.find(s => s.id === t.step);
  const base = t.type === 'instanceStart' ? 'order punch' : t.type === 'afterStep' ? 'after "' + (step ? step.name : t.step) + '"' : t.type === 'beforeDate' ? 'before ' + fieldLabel(t.field) : t.type === 'afterDate' ? 'after ' + fieldLabel(t.field) : 'on ' + fieldLabel(t.field);
  return base + w + (t.orNext ? ', else next' : '');
}
function condText(c) {
  if (!c) return 'always';
  if (c.all) return c.all.map(condText).join(' and '); if (c.any) return c.any.map(condText).join(' or '); if (c.not) return 'not (' + condText(c.not) + ')';
  const f = fieldLabel(c.field);
  if ('in' in c) return f + ' is ' + c.in.join('/'); if ('notIn' in c) return f + ' is not ' + c.notIn.join('/');
  if ('eq' in c) return f + ' = ' + c.eq; if ('ne' in c) return f + ' ≠ ' + c.ne; if ('empty' in c) return f + (c.empty ? ' is empty' : ' is filled');
  return JSON.stringify(c);
}

/* ---------- condition <-> rows ---------- */
function isLeaf(c) { return c && c.field && ['in', 'notIn', 'eq', 'ne', 'empty'].some(k => k in c); }
function condToRows(c) {
  if (!c) return { join: 'all', rows: [] };
  if (isLeaf(c)) return { join: 'all', rows: [leafRow(c)] };
  const k = c.all ? 'all' : c.any ? 'any' : null;
  if (k && c[k].every(isLeaf)) return { join: k, rows: c[k].map(leafRow) };
  return null;                                           // complex → JSON
}
function leafRow(c) {
  if ('in' in c) return { field: c.field, op: 'in', values: c.in }; if ('eq' in c) return { field: c.field, op: 'in', values: [c.eq] };
  if ('notIn' in c) return { field: c.field, op: 'notIn', values: c.notIn }; if ('ne' in c) return { field: c.field, op: 'notIn', values: [c.ne] };
  return { field: c.field, op: 'empty', values: [] };
}
function rowsToCond(join, rows) {
  const leaves = rows.filter(r => r.field).map(r => r.op === 'empty' ? { field: r.field, empty: true } : { field: r.field, [r.op]: r.values });
  if (!leaves.length) return undefined; if (leaves.length === 1) return leaves[0]; return { [join]: leaves };
}
function condEditor(key, cond) {
  const rs = condToRows(cond);
  if (!rs) return '<div class="condbox" data-cond="' + key + '" data-json="1"><textarea rows="3" class="mono" data-cjson>' + esc(JSON.stringify(cond)) + '</textarea></div>';
  const flds = bldFields(['select', 'text', 'number']);
  return '<div class="condbox" data-cond="' + key + '">' +
    (rs.rows.length > 1 ? '<select data-cjoin class="qsel"><option value="all"' + (rs.join === 'all' ? ' selected' : '') + '>All of these</option><option value="any"' + (rs.join === 'any' ? ' selected' : '') + '>Any one of these</option></select>' : '') +
    rs.rows.map(r => {
      const opts = fieldOpts(r.field);
      return '<div class="condrow"><div class="qline"><select data-cf>' + flds.map(f => '<option value="' + esc(f.key) + '"' + (f.key === r.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select>' +
        '<select data-cop><option value="in"' + (r.op === 'in' ? ' selected' : '') + '>is</option><option value="notIn"' + (r.op === 'notIn' ? ' selected' : '') + '>is not</option><option value="empty"' + (r.op === 'empty' ? ' selected' : '') + '>is empty</option></select>' +
        '<button class="btn ghost sm" data-act="cond-del">×</button></div>' +
        (r.op === 'empty' ? '' : opts.length
          ? '<div class="chips">' + opts.map(o => '<label class="chip"><input type="checkbox" data-cvv value="' + esc(o) + '"' + (r.values.includes(o) ? ' checked' : '') + '>' + esc(o) + '</label>').join('') + '</div>'
          : '<input data-cv value="' + esc(r.values.join(', ')) + '">') + '</div>';
    }).join('') +
    '<a class="small" data-act="cond-add" data-cond="' + key + '">+ and</a></div>';
}
function readCond(box) {
  if (!box) return undefined;
  if (box.dataset.json) { try { const t = $('[data-cjson]', box).value.trim(); return t ? JSON.parse(t) : undefined; } catch (e) { return { __bad: true }; } }
  const j = $('[data-cjoin]', box); const join = j ? j.value : 'all';
  return rowsToCond(join, $$('.condrow', box).map(r => {
    const vv = $$('[data-cvv]', r); const cv = $('[data-cv]', r);
    return { field: $('[data-cf]', r).value, op: $('[data-cop]', r).value || 'in', values: vv.length ? vv.filter(x => x.checked).map(x => x.value) : (cv ? cv.value.split(',').map(s => s.trim()).filter(Boolean) : []) };
  }));
}

/* ---------- view ---------- */
VIEWS.builder = {
  mod: 'builder', render() {
    if (!B.draft || !Store.get('processes', B.pid)) bldLoad();
    if (!B.draft) { setMain('<div class="toolbar">' + (can('builder', 'edit') ? '<button class="btn primary" data-act="bld-new">+ New FMS</button>' : '') + '</div><div class="panel empty">No FMS yet.</div>'); return; }
    const edit = can('builder', 'edit'); const proc = Store.get('processes', B.pid);
    const versions = Store.all('processes').filter(p => p.code === proc.code).sort((a, b) => a.version - b.version);
    const v = validateSpec(B.draft);
    const codes = Array.from(new Set(Store.all('processes').map(p => p.code)));
    const nameOf = c => { const ps = Store.all('processes').filter(p => p.code === c); const a = ps.find(p => p.active) || ps.sort((x, y) => y.version - x.version)[0]; return (a && (a.name || (a.spec.process || {}).name)) || c; };
    let h = '<div class="bldbar"><div class="toolbar"><select id="bldCode">' + codes.map(c => '<option value="' + esc(c) + '"' + (c === proc.code ? ' selected' : '') + '>' + esc(nameOf(c)) + '</option>').join('') + '</select>' +
      (edit ? '<button class="btn sm" data-act="bld-new">+ New FMS</button>' : '') + '<span class="grow"></span>' +
      '<span class="muted small">Version</span>' + seg('ver', versions.map(p => ({ v: p.id, l: 'v' + p.version + (p.active ? ' ✓' : '') })), B.pid) + '</div>';
    h += '<div class="toolbar"><span class="small">' + (proc.active ? '<b>v' + proc.version + ' is live</b> — new orders use it.' : 'v' + proc.version + ' is not live.') + ' ' + (B.dirty ? '<span class="late-txt">Unsaved changes.</span>' : '') + '</span><span class="grow"></span>' +
      (edit ? (B.dirty ? '<button class="btn" data-act="bld-discard" data-confirm="Discard?">Discard</button><button class="btn" data-act="bld-save" data-new="1"' + (v.errors.length ? ' disabled title="Fix errors first"' : '') + '>Save as new version (v' + (versions[versions.length - 1].version + 1) + ')</button><button class="btn primary" data-save data-act="bld-save"' + (v.errors.length ? ' disabled title="Fix errors first"' : '') + '>Save v' + proc.version + '</button>' : '') +
        (!B.dirty && isSuperAdmin() ? (versions.length > 1 && !proc.active ? '<button class="btn ghost danger" data-act="bld-delver" data-confirm="Delete v' + proc.version + '?">Delete v' + proc.version + '</button>' : '') + '<button class="btn ghost danger" data-act="bld-delfms" data-confirm="Delete the whole FMS ' + esc(proc.name || proc.code) + '?">Delete FMS</button>' : '') +
        (!B.dirty && !proc.active ? '<button class="btn primary" data-act="bld-activate" data-confirm="Make live?"' + (v.errors.length ? ' disabled' : '') + '>Activate v' + proc.version + '</button>' : '') : '<span class="muted small">Read only</span>') + '</div>' +
      (B.dirty && v.errors.length ? '<ul class="val" style="margin:0 0 6px;padding-left:18px">' + v.errors.map(x => '<li class="e">' + esc(x) + '</li>').join('') + '</ul>' : '') + '</div>';
    h += '<div class="tabs">' + [['flow', 'Flow'], ['tables', 'Doer Tables'], ['sim', 'Simulate'], ['fields', 'Fields & JSON']].map(([k, l]) => '<a data-act="bld-tab" data-t="' + k + '" class="' + (B.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';
    if (B.tab === 'flow') h += '<div class="bld"><div class="panel" style="padding:0"><div id="bSteps" class="steplist"></div>' + (edit ? '<div style="padding:8px"><button class="btn sm" data-act="bld-add">+ Add step</button></div>' : '') + '</div><div class="panel ed" id="bEd"></div><div><div id="bPv" class="toolbar"></div><div id="fcWrap" class="fc-wrap"><div class="fc-bar"><span class="fc-leg"><i style="background:#1a56c8"></i>Step<i style="background:#b26a00"></i>Only for some orders (IF)<i style="background:#13795b"></i>Auto<i class="fc-dash"></i>Runs on a date</span><span class="grow"></span><button class="btn sm" data-act="fc-zoom" data-z="-">−</button><span id="fcZoom" class="fc-z">100%</span><button class="btn sm" data-act="fc-zoom" data-z="+">+</button><button class="btn sm" data-act="fc-zoom" data-z="fit">Fit</button><button class="btn sm" data-act="fc-svg">Download</button><button class="btn sm primary" data-act="fc-full">⛶ Full screen</button></div><div class="chart-wrap" id="bChart"></div></div><div id="bVal" class="panel small" style="margin-top:10px"></div></div></div>';
    else if (B.tab === 'sim') h += '<div id="bSim"></div>';
    else if (B.tab === 'tables') h += '<div id="bTables"></div>';
    else h += '<div id="bFields"></div>';
    setMain(h);
    onSeg(bldSeg);
    $('#bldCode').addEventListener('change', e => { if (B.dirty) { flash('Save or discard your changes first.', 'err'); e.target.value = proc.code; return; } const ps = Store.all('processes').filter(p => p.code === e.target.value); const p = ps.find(x => x.active) || ps.sort((a, b) => b.version - a.version)[0]; bldLoad(p.id); VIEWS.builder.render(); });
    if (B.tab === 'flow') { bldSide(); bldEditor(); const m = $('#main'); m.addEventListener('input', bldInput); m.addEventListener('change', bldInput); }
    if (B.tab === 'sim') bldSim();
    if (B.tab === 'tables') bldTables();
    if (B.tab === 'fields') bldFieldsTab();
  }
};
function bldMarkDirty() { if (!B.dirty) { B.dirty = true; VIEWS.builder.render(); return true; } return false; }
function bldSeg(e) {
  const k = e.target.dataset.seg;
  if (k === 'ver') { if (B.dirty) { flash('Save or discard your changes first.', 'err'); VIEWS.builder.render(); return; } bldLoad(e.detail); VIEWS.builder.render(); return; }
  if (k && k.startsWith('pv_')) { B.pv[k.slice(3)] = e.detail; bldSide(); return; }
  if (k && k.startsWith('sim_')) { B.sim.fields[k.slice(4)] = e.detail; bldSim(); return; }
  if (e.target.closest('#bEd')) { bldCollect(); if (!bldMarkDirty()) { bldEditor(); bldSide(); } }
}
function bldInput(e) {
  if (!e.target.closest('#bEd')) return;
  if (e.type === 'change' && e.target.value === '__new') {
    const n = (prompt('New name') || '').trim().toUpperCase();
    if (n) { const o = document.createElement('option'); o.textContent = n; e.target.insertBefore(o, e.target.lastElementChild); e.target.value = n; } else e.target.value = '';
  }
  bldCollect(); if (!bldMarkDirty()) bldSide();
  if (e.type === 'change' && e.target.matches('select')) bldEditor();
}

/* ---------- side: steplist + chart + validation ---------- */
function bldSide() {
  const d = B.draft;
  const order = (() => { try { return FMSEngine.topoOrder(d); } catch (e) { return d.steps.map(s => s.id); } })();
  $('#bSteps').innerHTML = d.steps.map(s => '<a data-act="bld-sel" data-s="' + esc(s.id) + '" class="' + (s.id === B.sel ? 'on' : '') + '">' + esc(s.name || '(unnamed)') + '<div class="muted">' + esc(doerText(s.doer)) + ' · ' + esc(tatStr(s.tat)) + '</div></a>').join('');
  // preview instance controls
  const selFields = bldFields(['select']).filter(f => f.key !== 'priority' || true);
  $('#bPv').innerHTML = '<span class="muted small">Preview for:</span>' + selFields.map(f => { const o = fieldOpts(f.key); if (!o.length || o.length > 6) return ''; if (B.pv[f.key] == null) B.pv[f.key] = f.key === 'priority' ? '' : o[0]; return seg('pv_' + f.key, (f.key === 'priority' ? [{ v: '', l: 'Normal' }] : []).concat(o.map(x => ({ v: x, l: x }))), B.pv[f.key]); }).join('');
  // chart
  let svg = '';
  try { svg = bldChart(d, order); } catch (e) { svg = '<div class="empty">Chart unavailable: ' + esc(e.message) + '</div>'; }
  const box = $('#bChart'), had = !!box.querySelector('svg'), sl = box.scrollLeft, sT = box.scrollTop;
  box.innerHTML = svg; fcApply();
  if (had) { box.scrollLeft = sl; box.scrollTop = sT; } else box.scrollLeft = Math.max(0, (box.scrollWidth - box.clientWidth) / 2);   // keep the view while editing; centre the first time
  const v = validateSpec(d);
  $('#bVal').innerHTML = (v.errors.length || v.warns.length ? '<ul class="val" style="margin:0;padding-left:16px">' + v.errors.map(x => '<li class="e">' + esc(x) + '</li>').join('') + v.warns.map(x => '<li class="w">' + esc(x) + '</li>').join('') + '</ul>' : '<span class="st Done">Flow is valid</span>') +
    '<div class="muted" style="margin-top:6px">' + d.steps.length + ' steps · Only actuals move the chain · Delay counted in working time</div>';
  const saveBtn = $('[data-act="bld-save"]'); if (saveBtn) saveBtn.disabled = !!v.errors.length;
}
function bldChart(spec, order) {
  const fields = Object.assign({ created_at: new Date().toISOString(), delivery_date: ymdOf(new Date(Date.now() + 10 * 86400000)) }, B.pv);
  let res = null; try { res = FMSEngine.resolveInstance(Object.assign({}, spec, { calendar: calendar() }), { fields, actuals: {} }); } catch (e) { }
  const W = 234, H = 78, GX = 262, GY = 124, PILL = 34, PAD = 28;
  const trig0 = st => (Array.isArray(st.trigger) ? st.trigger[0] : st.trigger) || {};
  const ids = spec.steps.map(s => s.id); const byId = Object.fromEntries(spec.steps.map(s => [s.id, s]));
  const num0 = {}; (order || ids).forEach((id, i) => { num0[id] = i + 1; });
  // one graph: step links + dashed links from the step that asks a date to the steps that run on that date
  const edges = [];
  spec.steps.forEach(s => (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).forEach((t, i) => { if (t && t.type === 'afterStep' && byId[t.step]) edges.push({ from: t.step, to: s.id, kind: i === 0 ? 'primary' : 'fallback' }); }));
  spec.steps.forEach(s => { const t = trig0(s); if (['beforeDate', 'afterDate', 'external'].includes(t.type)) { const src = spec.steps.find(x => x.capture && x.capture.field === t.field); if (src) edges.push({ from: src.id, to: s.id, kind: t.type === 'beforeDate' ? 'before' : 'date' }); } });
  const rank = {}; ids.forEach(id => rank[id] = 0);
  const relax = skip => { for (let n = 0; n < ids.length + 2; n++) { let ch = false; edges.forEach(e => { if (e.kind === 'fallback' || e.kind === 'before' || skip.has(e.to) || skip.has(e.from)) return; if (rank[e.to] < rank[e.from] + 1) { rank[e.to] = rank[e.from] + 1; ch = true; } }); if (!ch) break; } };
  const beforeRoots = edges.filter(e => e.kind === 'before').map(e => e.to);
  const late = new Set(beforeRoots); let grew = true; while (grew) { grew = false; edges.forEach(e => { if (e.kind === 'primary' && late.has(e.from) && !late.has(e.to)) { late.add(e.to); grew = true; } }); }
  relax(late);
  const M = Math.max(0, ...ids.filter(id => !late.has(id)).map(id => rank[id]));
  beforeRoots.forEach(id => { const src = edges.find(e => e.to === id && e.kind === 'before'); rank[id] = Math.max(rank[src.from] + 1, M - 2); });
  relax(new Set());
  const maxR = Math.max(...ids.map(id => rank[id]));
  const cnt = {}; ids.forEach(id => cnt[rank[id]] = (cnt[rank[id]] || 0) + 1);
  const width = Math.max(640, PAD * 2 + Math.max(...Object.values(cnt)) * GX - (GX - W)) + 40;
  const pos = {}; const pill = { x: width / 2, y: PAD + PILL / 2 }; let y = PAD + PILL + 46;
  for (let r = 0; r <= maxR; r++) {
    const cx = id => { const ps = edges.filter(e => e.to === id && pos[e.from]).map(e => pos[e.from].x); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : width / 2; };
    const row = ids.filter(id => rank[id] === r).sort((a, b) => cx(a) - cx(b)); const tw = row.length * GX - (GX - W);
    if (row.some(id => beforeRoots.includes(id))) y += 52;
    row.forEach((id, i) => { pos[id] = { x: (width - tw) / 2 + i * GX, y }; });
    if (row.length) y += GY;
  }
  // end terminal under the last row
  // "End" links only from the end of the main chain (the dispatch step and what follows it), not from every side step
  const leaves = ids.filter(id => !edges.some(e => e.from === id && e.kind !== 'fallback'));
  const endStep = spec.process && byId[spec.process.endStep] ? spec.process.endStep : null;
  const after = new Set(endStep ? [endStep] : []); let more = true; while (more) { more = false; edges.forEach(e => { if (e.kind !== 'fallback' && after.has(e.from) && !after.has(e.to)) { after.add(e.to); more = true; } }); }
  let enders = leaves.filter(id => after.has(id)); if (!enders.length) enders = leaves.filter(id => rank[id] === Math.max(...leaves.map(x => rank[x])));
  const endY = y + 6; const height = endY + PILL + PAD;
  const C = { line: '#9aa6b8', date: '#6d4dc4', blue: '#1a56c8', green: '#13795b', amber: '#b26a00', grey: '#c3cad6', txt: '#142033', sub: '#5b6880', card: '#ffffff', stroke: '#d9e0ea' };
  let s = '<svg xmlns="http://www.w3.org/2000/svg" class="fc-svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" data-w="' + width + '" data-h="' + height + '">';
  s += '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z" fill="' + C.line + '"/></marker>' +
    '<marker id="ard" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z" fill="' + C.date + '"/></marker>' +
    '<filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0b1f4d" flood-opacity=".10"/></filter>' +
    '<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="#d5dcea"/></pattern></defs>';
  s += '<rect width="' + width + '" height="' + height + '" fill="#f7f9fd"/><rect width="' + width + '" height="' + height + '" fill="url(#dots)"/>';
  // orthogonal connector with rounded corners: down, across, down
  const elbow = (x1, y1, x2, y2) => {
    if (Math.abs(x1 - x2) < 1) return 'M' + x1 + ',' + y1 + ' V' + y2;
    const my = Math.round((y1 + y2) / 2), r = Math.min(10, Math.abs(x2 - x1) / 2, Math.abs(my - y1)), dir = x2 > x1 ? 1 : -1;
    return 'M' + x1 + ',' + y1 + ' V' + (my - r) + ' Q' + x1 + ',' + my + ' ' + (x1 + dir * r) + ',' + my + ' H' + (x2 - dir * r) + ' Q' + x2 + ',' + my + ' ' + x2 + ',' + (my + r) + ' V' + y2;
  };
  // rounded polyline through points
  const poly = pts => {
    let d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const r = Math.min(10, Math.hypot(x1 - x0, y1 - y0) / 2, Math.hypot(x2 - x1, y2 - y1) / 2);
      const ax = x1 - Math.sign(x1 - x0) * r, ay = y1 - Math.sign(y1 - y0) * r, bx = x1 + Math.sign(x2 - x1) * r, by = y1 + Math.sign(y2 - y1) * r;
      d += ' L' + ax + ',' + ay + ' Q' + x1 + ',' + y1 + ' ' + bx + ',' + by;
    }
    const L = pts[pts.length - 1]; return d + ' L' + L[0] + ',' + L[1];
  };
  // a link that skips rows runs down a free lane between the cards, never through one
  const boxes = ids.map(id => pos[id]);
  const route = (a, b) => {
    const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y - 3;
    const mid = boxes.filter(q => q.y > a.y + 1 && q.y < b.y - 1);
    if (!mid.length) return elbow(x1, y1, x2, y2);
    const hit = x => mid.some(q => x > q.x - 8 && x < q.x + W + 8);
    const gap = (GX - W) / 2;
    const cands = [x1, x2].concat(...mid.map(q => [q.x - gap, q.x + W + gap]), [PAD / 2 + 4, width - PAD / 2 - 4]);
    const lane = cands.filter(x => !hit(x)).sort((p1, p2) => (Math.abs(p1 - x1) + Math.abs(p1 - x2)) - (Math.abs(p2 - x1) + Math.abs(p2 - x2)))[0];
    if (lane == null || Math.abs(lane - x1) < 1 && Math.abs(lane - x2) < 1) return elbow(x1, y1, x2, y2);
    const ya = y1 + 18, yb = y2 - 20;
    const pts = [[x1, y1]]; if (Math.abs(lane - x1) >= 1) pts.push([x1, ya], [lane, ya]); else pts.push([x1, ya]);
    if (Math.abs(lane - x2) >= 1) pts.push([lane, yb], [x2, yb]); else pts.push([lane, yb]);
    pts.push([x2, y2]);
    return poly(pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]));
  };
  const starters = ids.filter(id => !edges.some(e => e.to === id && e.kind !== 'fallback'));
  starters.forEach(id => { const b = pos[id]; s += '<path d="' + elbow(pill.x, pill.y + PILL / 2, b.x + W / 2, b.y - 3) + '" fill="none" stroke="' + C.line + '" stroke-width="1.6" marker-end="url(#ar)"/>'; });
  enders.forEach(id => { const a = pos[id]; s += '<path d="' + route(a, { x: width / 2 - W / 2, y: endY }) + '" fill="none" stroke="' + C.line + '" stroke-width="1.6" marker-end="url(#ar)"/>'; });
  const pillTxt = (x, yy, t, fill) => { const pw = Math.max(130, t.length * 7.4 + 36); return '<rect x="' + (x - pw / 2) + '" y="' + (yy - PILL / 2) + '" width="' + pw + '" height="' + PILL + '" rx="' + (PILL / 2) + '" fill="' + fill + '" filter="url(#sh)"/><text x="' + x + '" y="' + (yy + 4.5) + '" text-anchor="middle" fill="#fff" class="fc-pill">' + esc(t) + '</text>'; };
  // dates counted back: one line from the step that asks the date to a "T" pill, then short lines to each step
  Array.from(new Set(edges.filter(e => e.kind === 'before').map(e => e.from))).forEach(src => {
    const tos = edges.filter(e => e.kind === 'before' && e.from === src).map(e => e.to); const a = pos[src];
    const tx = tos.reduce((m, id) => m + pos[id].x + W / 2, 0) / tos.length, ty = Math.min(...tos.map(id => pos[id].y)) - 40;
    const f = byId[tos[0]]; const lbl = 'T = ' + fieldLabel(trig0(f).field); const tw2 = Math.max(130, lbl.length * 7 + 30);
    const left = a.x + W / 2 < width / 2; const ex = left ? a.x : a.x + W, gx = left ? 10 : width - 10, px = left ? tx - tw2 / 2 - 2 : tx + tw2 / 2 + 2;
    s += '<path d="M' + ex + ',' + (a.y + H / 2) + ' H' + gx + ' V' + ty + ' H' + px + '" fill="none" stroke="' + C.date + '" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ard)"/>';
    tos.forEach(id => { const b = pos[id]; s += '<path d="' + elbow(tx, ty + 13, b.x + W / 2, b.y - 3) + '" fill="none" stroke="' + C.date + '" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ard)"/>'; });
    s += '<rect x="' + (tx - tw2 / 2) + '" y="' + (ty - 13) + '" width="' + tw2 + '" height="26" rx="13" fill="' + C.date + '" filter="url(#sh)"/><text x="' + tx + '" y="' + (ty + 4.5) + '" text-anchor="middle" fill="#fff" class="fc-pill">' + esc(lbl) + '</text>';
  });
  edges.forEach(e => {
    if (e.kind === 'before') return;
    const a = pos[e.from], b = pos[e.to]; if (!a || !b) return;
    const dim = res && (!res.steps[e.from].applies || !res.steps[e.to].applies); const dated = e.kind === 'date';
    let d;
    if (b.y <= a.y) { const gx = Math.max(a.x, b.x) + W + 22; d = 'M' + (a.x + W) + ',' + (a.y + H / 2) + ' H' + gx + ' V' + (b.y + H / 2) + ' H' + (b.x + W + 3); }
    else d = route(a, b);
    s += '<path d="' + d + '" fill="none" stroke="' + (dated ? C.date : C.line) + '" stroke-width="1.6"' + (e.kind !== 'primary' ? ' stroke-dasharray="5 4"' : '') + (dim ? ' opacity=".28"' : '') + ' marker-end="url(#' + (dated ? 'ard' : 'ar') + ')"/>';
  });
  s += pillTxt(pill.x, pill.y, (spec.process && spec.process.startEvent) || 'Start', '#0b2a7a');
  s += pillTxt(width / 2, endY + PILL / 2, 'End', '#13795b');
  const cut = (x, k) => x.length > k ? x.slice(0, k - 1) + '…' : x;
  ids.forEach(id => {
    const st = byId[id]; const p = pos[id]; const r = res && res.steps[id];
    const on = id === B.sel; const applies = !r || r.applies; const t0 = trig0(st);
    const auto = st.status && st.status.type === 'auto';
    const bar = !applies ? C.grey : auto ? C.green : st.applies ? C.amber : C.blue;
    const who = (r && r.doer ? r.doer : doerText(st.doer)) || 'Not set';
    const time = t0.type === 'beforeDate' ? 'T − ' + ((t0.tat || st.tat || {}).value || 0) + 'd' : t0.type === 'external' ? 'on ' + fieldLabel(t0.field) : tatStr(t0.tat || st.tat).replace(' / urgent ', ' · urgent ');
    // chips along the bottom: time first, then tags — laid out left to right so nothing overlaps
    const chips = [{ t: '⏱ ' + cut(time, 22), bg: '#eef2f8', fg: C.sub }];
    if (st.applies) chips.push({ t: 'IF', bg: '#fdf3e2', fg: C.amber });
    if (auto) chips.push({ t: 'AUTO', bg: '#e6f4ee', fg: C.green });
    if (st.capture) chips.push({ t: 'ASKS DATE', bg: '#efeafb', fg: C.date });
    let cx = p.x + 14, chipSvg = '';
    chips.forEach(c => { const w = Math.round(c.t.length * 6.1 + 14); if (cx + w > p.x + W - 8) return; chipSvg += '<rect x="' + cx + '" y="' + (p.y + H - 26) + '" width="' + w + '" height="18" rx="9" fill="' + c.bg + '"/><text x="' + (cx + w / 2) + '" y="' + (p.y + H - 13.5) + '" text-anchor="middle" fill="' + c.fg + '" class="fc-chip">' + esc(c.t) + '</text>'; cx += w + 5; });
    s += '<g data-act="bld-sel" data-s="' + esc(id) + '" class="fc-node" opacity="' + (applies ? 1 : .45) + '">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="12" fill="' + (on ? '#eef4ff' : C.card) + '" stroke="' + (on ? C.blue : C.stroke) + '" stroke-width="' + (on ? 2 : 1) + '" filter="url(#sh)"/>' +
      '<path d="M' + (p.x + 12) + ',' + p.y + ' H' + (p.x + W - 12) + ' Q' + (p.x + W) + ',' + p.y + ' ' + (p.x + W) + ',' + (p.y + 12) + ' V' + (p.y + 4) + ' H' + p.x + ' V' + (p.y + 12) + ' Q' + p.x + ',' + p.y + ' ' + (p.x + 12) + ',' + p.y + ' Z" fill="' + bar + '"/>' +
      '<circle cx="' + (p.x + 22) + '" cy="' + (p.y + 24) + '" r="10" fill="' + bar + '" opacity=".14"/><text x="' + (p.x + 22) + '" y="' + (p.y + 28) + '" text-anchor="middle" fill="' + bar + '" class="fc-num">' + (num0[id] || '') + '</text>' +
      '<text x="' + (p.x + 39) + '" y="' + (p.y + 28) + '" fill="' + C.txt + '" class="fc-name">' + esc(cut(st.name || '(unnamed)', 23)) + '</text>' +
      '<text x="' + (p.x + 14) + '" y="' + (p.y + 46) + '" fill="' + C.sub + '" class="fc-who">👤 ' + esc(cut(who, 28)) + '</text>' +
      chipSvg + '<title>' + esc((st.name || '') + ' — ' + who + ' — ' + time) + '</title></g>';
  });
  return s + '</svg>';
}
// zoom / fit / full screen for the flow chart
function fcApply() {
  const box = $('#bChart'); const svg = box && box.querySelector('svg.fc-svg'); if (!svg) return;
  const w = +svg.dataset.w, h = +svg.dataset.h;
  if (B.zoom == null || B.zoom === 'fit') {
    const full = document.fullscreenElement && document.fullscreenElement.contains(box);
    const availW = box.clientWidth - 16, availH = full ? box.clientHeight - 16 : Infinity;
    B.zoomV = Math.max(full ? 0.2 : 0.7, Math.min(1.4, availW / w, availH / h));
  } else B.zoomV = B.zoom;
  svg.setAttribute('width', Math.round(w * B.zoomV)); svg.setAttribute('height', Math.round(h * B.zoomV));
  const z = $('#fcZoom'); if (z) z.textContent = Math.round(B.zoomV * 100) + '%';
}
ACTIONS['fc-zoom'] = el => { const cur = B.zoomV || 1; const d = el.dataset.z; B.zoom = d === 'fit' ? 'fit' : d === '1' ? 1 : Math.max(0.3, Math.min(2.5, cur * (d === '+' ? 1.2 : 1 / 1.2))); fcApply(); };
ACTIONS['fc-full'] = () => {
  const w = $('#fcWrap'); if (!w) return;
  if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen().catch(() => w.classList.toggle('fc-max')); else w.classList.toggle('fc-max');
};
ACTIONS['fc-svg'] = () => {
  const svg = $('#bChart svg.fc-svg'); if (!svg) return;
  const c = svg.cloneNode(true); c.setAttribute('width', svg.dataset.w); c.setAttribute('height', svg.dataset.h);
  c.insertAdjacentHTML('afterbegin', '<style>text{font-family:Segoe UI,Arial,sans-serif}.fc-name{font-size:13.5px;font-weight:700}.fc-who{font-size:12px}.fc-chip{font-size:10.5px;font-weight:700}.fc-num{font-size:11px;font-weight:800}.fc-pill{font-size:13px;font-weight:700}</style>');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c.outerHTML], { type: 'image/svg+xml' })); a.download = ((B.draft && B.draft.process && B.draft.process.name) || 'flow') + '.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
document.addEventListener('fullscreenchange', () => { const w = $('#fcWrap'); if (w) { w.classList.toggle('fc-max', !!document.fullscreenElement); const b = $('[data-act="fc-full"]'); if (b) b.textContent = document.fullscreenElement ? '✕ Exit full screen' : '⛶ Full screen'; } B.zoom = 'fit'; fcApply(); });
window.addEventListener('resize', () => { if (B && (B.zoom == null || B.zoom === 'fit')) fcApply(); });
// drag the empty canvas to move around
document.addEventListener('mousedown', e => {
  const box = e.target.closest && e.target.closest('#bChart'); if (!box || e.button !== 0 || e.target.closest('.fc-node')) return;
  const sx = e.clientX, sy = e.clientY, sl = box.scrollLeft, st = box.scrollTop; box.classList.add('fc-drag');
  const mv = ev => { box.scrollLeft = sl - (ev.clientX - sx); box.scrollTop = st - (ev.clientY - sy); };
  const up = () => { box.classList.remove('fc-drag'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); e.preventDefault();
});

/* ---------- editor ---------- */
function curStep() { return B.draft.steps.find(s => s.id === B.sel); }
const START_OPTS = [{ v: 'afterStep', l: 'When another step is done' }, { v: 'instanceStart', l: 'As soon as the order is punched' }, { v: 'beforeDate', l: 'Some days before a date' }, { v: 'external', l: 'On a date' }, { v: 'afterDate', l: 'Some days after a date' }];
const WHO_OPTS = [{ v: 'fixed', l: 'One fixed person' }, { v: 'field', l: 'Person from the order (e.g. brand merchant)' }, { v: 'lookup', l: 'Depends on brand (doer table)' }, { v: 'byCondition', l: 'Depends on category / other field' }];
const opt = (list, cur) => list.map(o => '<option value="' + esc(o.v) + '"' + (o.v === cur ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('');
function allPeople() {
  const d = B.draft; const set = new Set(doerNames());
  d.steps.forEach(s => { const x = s.doer || {}; if (x.name) set.add(x.name); if (x.default) set.add(x.default); (x.rules || []).forEach(r => r.name && set.add(r.name)); });
  Object.values(d.doerTables || {}).forEach(t => Object.values(t).forEach(v => v && set.add(v)));
  return Array.from(set).filter(Boolean).sort();
}
function personSel(k, cur, attr) {
  const ppl = allPeople(); if (cur && !ppl.includes(cur)) ppl.push(cur);
  return '<select ' + (attr || 'data-k') + '="' + k + '"><option value="">— choose —</option>' + ppl.map(p => '<option' + (p === cur ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '<option value="__new">+ New name…</option></select>';
}
function isSimpleRule(r) { return r && r.when && r.when.field && Array.isArray(r.when.in) && Object.keys(r.when).length === 2; }
function startLine(t, others, dateFields, j) {
  let h = '<select data-t="type">' + opt(START_OPTS, t.type) + '</select>';
  if (t.type === 'afterStep') h += '<select data-t="step"><option value="">— choose step —</option>' + others.map(o => '<option value="' + esc(o.id) + '"' + (o.id === t.step ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select>';
  if (['beforeDate', 'afterDate', 'external'].includes(t.type)) h += '<select data-t="field"><option value="">— choose date —</option>' + dateFields.map(f => '<option value="' + esc(f.key) + '"' + (f.key === t.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select>';
  return h;
}
function bldEditor() {
  const el = $('#bEd'); const s = curStep(); if (!el) return;
  if (!s) { el.innerHTML = ''; return; }
  const edit = can('builder', 'edit'); const others = B.draft.steps.filter(x => x.id !== s.id);
  const dateFields = bldFields(['date', 'datetime']).filter(f => f.key !== 'created_at');
  const doer = typeof s.doer === 'string' ? { type: 'fixed', name: s.doer } : (s.doer || { type: 'fixed', name: '' });
  const trig = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).filter(Boolean);
  const tat = s.tat || { value: 1, unit: 'days' };
  const multi = trig.length > 1;
  let h = '<div class="q"><div class="qh">1. Step name</div><input data-k="name" value="' + esc(s.name) + '"><textarea data-k="what" rows="2" placeholder="What the doer must do">' + esc(s.what || '') + '</textarea></div>';
  // who
  h += '<div class="q"><div class="qh">2. Who does it?</div><select data-k="doerType">' + opt(WHO_OPTS, doer.type) + '</select>';
  if (doer.type === 'fixed') h += personSel('doerName', doer.name);
  else if (doer.type === 'field') h += '<select data-k="doerField">' + bldFields().map(f => '<option value="' + esc(f.key) + '"' + (f.key === doer.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select>';
  else if (doer.type === 'lookup') h += '<select data-k="doerTable">' + Object.keys(B.draft.doerTables || {}).map(t => '<option' + (t === doer.table ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
  else {
    const rules = doer.rules || [];
    if (rules.every(isSimpleRule)) {
      const selF = bldFields(['select']);
      h += rules.map((r, i) => { const o = fieldOpts(r.when.field); return '<div class="drrow" data-i="' + i + '"><div class="qline"><span>If</span><select data-dr="field">' + selF.map(f => '<option value="' + esc(f.key) + '"' + (f.key === r.when.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select><span>→</span>' + personSel('name', r.name, 'data-dr') + '<button class="btn ghost sm" data-act="dr-del" data-i="' + i + '">×</button></div><div class="chips">' + o.map(v => '<label class="chip"><input type="checkbox" data-drv value="' + esc(v) + '"' + (r.when.in.includes(v) ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div></div>'; }).join('');
      h += '<a class="small" data-act="dr-add">+ another rule</a><div class="qline"><span>Otherwise</span>' + personSel('doerDefault', doer.default) + '</div>';
    } else h += '<textarea data-k="doerRules" rows="3" class="mono">' + esc(JSON.stringify(rules)) + '</textarea><div class="qline"><span>Otherwise</span>' + personSel('doerDefault', doer.default) + '</div>';
  }
  h += '</div>';
  // which orders
  h += '<div class="q"><div class="qh">3. For which orders?</div><select data-k="appliesMode"><option value="always">All orders</option><option value="when"' + (s.applies ? ' selected' : '') + '>Only some orders</option></select>' + (s.applies ? condEditor('applies', s.applies) : '') + '</div>';
  // start
  h += '<div class="q"><div class="qh">4. When does it start?</div><select data-k="startMode"><option value="one">Same for every order</option><option value="multi"' + (multi ? ' selected' : '') + '>Different for different orders</option></select>';
  if (!multi) h += '<div class="cand" data-j="0"><div class="qcol">' + startLine(trig[0] || { type: 'afterStep' }, others, dateFields, 0) + '</div></div>';
  else trig.forEach((t, j) => {
    h += '<div class="cand" data-j="' + j + '"><div class="qline"><b>' + (j + 1) + '.</b><span class="grow"></span><button class="btn ghost sm" data-act="cand-del" data-j="' + j + '">×</button></div>' +
      '<div class="qline"><span>Orders:</span><select data-t="useWhen"><option value="">All</option><option value="1"' + (t.when ? ' selected' : '') + '>Only some</option></select></div>' + (t.when ? condEditor('cand-' + j, t.when) : '') +
      '<div class="qcol">' + startLine(t, others, dateFields, j) + '</div>' +
      (j < trig.length - 1 && t.type === 'afterStep' ? '<label class="chip"><input type="checkbox" data-t="orNext"' + (t.orNext ? ' checked' : '') + '>If this step is not done yet, use the next line</label>' : '') + '</div>';
  });
  if (multi) h += '<a class="small" data-act="cand-add">+ another line</a>';
  h += '</div>';
  // time
  const t0 = trig[0] || {}; const before = !multi && t0.type === 'beforeDate'; const onDate = !multi && t0.type === 'external';
  if (!onDate) h += '<div class="q"><div class="qh">5. ' + (before ? 'How many days before?' : 'How much time?') + '</div><div class="qline"><input data-k="tatv" type="number" step="any" min="0" value="' + esc(tat.value) + '" style="width:80px"><select data-k="tatUnit"><option value="days">working days</option><option value="hours"' + (tat.unit === 'hours' ? ' selected' : '') + '>hours</option></select></div>' +
    (before ? '' : '<div class="qline"><span>If urgent</span><input data-k="tatu" type="number" step="any" min="0" value="' + esc(tat.urgent == null ? '' : tat.urgent) + '" style="width:80px" placeholder="same"></div>') + '</div>';
  // close
  const stt = s.status || { type: 'manual' }; const rule = FMS_RULES.find(r => r.id === stt.rule) || FMS_RULES[0];
  const capFields = bldFields(['date', 'datetime', 'text', 'number', 'select']).filter(f => f.source !== 'system');
  h += '<div class="q"><div class="qh">' + (onDate ? '5' : '6') + '. How does it finish?</div><select data-k="statusType"><option value="manual">Doer clicks Done</option><option value="auto"' + (stt.type === 'auto' ? ' selected' : '') + '>Finishes by itself</option></select>' +
    (stt.type === 'auto' ? '<div class="qline"><span>When</span><select data-k="stRule">' + FMS_RULES.map(r => '<option value="' + r.id + '"' + (r.id === rule.id ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('') + '</select>' +
      (rule.param ? '<select data-k="stField"><option value="">— choose —</option>' + bldFields().map(f => '<option value="' + esc(f.key) + '"' + (f.key === stt.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select>' : '') + '</div>'
      : '<div class="qline"><span>On Done, ask for</span><select data-k="capField"><option value="">Nothing</option>' + capFields.map(f => '<option value="' + esc(f.key) + '"' + (s.capture && s.capture.field === f.key ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select></div>') + '</div>';
  if (edit) h += '<div class="toolbar"><button class="btn sm" data-act="bld-move" data-d="-1">↑ Up</button><button class="btn sm" data-act="bld-move" data-d="1">↓ Down</button><span class="grow"></span><button class="btn sm danger" data-act="bld-del" data-confirm="Confirm delete">Delete step</button></div>';
  el.innerHTML = h;
  if (!edit) $$('input,select,textarea', el).forEach(x => { x.disabled = true; });
}
function bldCollect() {
  const s = curStep(); const el = $('#bEd'); if (!s || !el) return;
  const val = k => { const i = $('[data-k="' + k + '"]', el); return i ? i.value : undefined; };
  const person = v => (v || '').trim().toUpperCase();
  s.name = (val('name') || '').trim(); const w = (val('what') || '').trim(); if (w) s.what = w; else delete s.what;
  const old = typeof s.doer === 'string' ? { type: 'fixed', name: s.doer } : (s.doer || {}); const dt = val('doerType') || old.type || 'fixed';
  if (dt === 'fixed') s.doer = { type: 'fixed', name: dt === old.type ? person(val('doerName')) : (old.name || '') };
  else if (dt === 'field') s.doer = { type: 'field', field: val('doerField') || (old.type === 'field' && old.field) || (bldFields().find(f => f.key === 'brand_merchant') || bldFields()[0] || {}).key };
  else if (dt === 'lookup') s.doer = { type: 'lookup', table: val('doerTable') || (old.type === 'lookup' && old.table) || Object.keys(B.draft.doerTables || {})[0] || '', by: (old.type === 'lookup' && old.by) || 'brand' };
  else {
    let rules;
    if ($('[data-k="doerRules"]', el)) { try { rules = JSON.parse(val('doerRules') || '[]'); } catch (e) { rules = old.rules || []; } }
    else if (old.type === 'byCondition') rules = $$('.drrow', el).map(r => ({ when: { field: $('[data-dr="field"]', r).value, in: $$('[data-drv]', r).filter(x => x.checked).map(x => x.value) }, name: person($('[data-dr="name"]', r).value) }));
    else rules = [{ when: { field: (bldFields(['select'])[0] || {}).key, in: [] }, name: '' }];
    s.doer = { type: 'byCondition', rules, default: dt === old.type ? (person(val('doerDefault')) || undefined) : undefined };
  }
  if (val('appliesMode') === 'when') { const c = readCond($('[data-cond="applies"]', el)); s.applies = c && !c.__bad ? c : (c && c.__bad ? s.applies : { field: (bldFields(['select'])[0] || {}).key, in: [] }); }
  else delete s.applies;
  const prev = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).filter(Boolean);
  let cands = $$('.cand', el).map((c, j) => {
    const g = k => { const i = $('[data-t="' + k + '"]', c); return i ? i.value : undefined; };
    const t = { type: g('type') || 'afterStep' }; const p = prev[j] || {};
    if (t.type === 'afterStep') t.step = g('step') || ''; if (['beforeDate', 'afterDate', 'external'].includes(t.type)) t.field = g('field') || '';
    if (p.tat && p.type === t.type) t.tat = p.tat;
    if (g('useWhen')) { const cw = readCond($('[data-cond="cand-' + j + '"]', c)); t.when = cw && !cw.__bad ? cw : (p.when || { field: (bldFields(['select'])[0] || {}).key, in: [] }); }
    const on = $('[data-t="orNext"]', c); if (on && on.checked) t.orNext = true;
    return t;
  });
  const mode = val('startMode');
  if (mode === 'multi' && cands.length === 1) cands.push({ type: 'afterStep', step: '' });
  if (mode === 'one' && cands.length > 1) cands = [cands[0]];
  if (mode === 'one') delete cands[0].when;
  s.trigger = cands.length === 1 ? cands[0] : cands;
  if ($('[data-k="tatv"]', el)) { const tu = val('tatu'); s.tat = { value: num(val('tatv')), unit: val('tatUnit') || 'days' }; if (tu !== '' && tu != null) s.tat.urgent = num(tu); else if (tu == null && s.tat.urgent != null) delete s.tat.urgent; }
  if (val('statusType') === 'auto') { s.status = { type: 'auto', rule: val('stRule') || (s.status && s.status.rule) || FMS_RULES[0].id }; const sf = val('stField'); if (sf) s.status.field = sf; delete s.capture; }
  else { delete s.status; const cf = val('capField'); if (cf) s.capture = { field: cf }; else delete s.capture; }
}
ACTIONS['dr-add'] = () => { bldCollect(); const s = curStep(); s.doer.rules = (s.doer.rules || []).concat([{ when: { field: (bldFields(['select'])[0] || {}).key, in: [] }, name: '' }]); if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['dr-del'] = el => { bldCollect(); const s = curStep(); s.doer.rules.splice(+el.dataset.i, 1); if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
function bldEditAllowed() { return requirePerm('builder', 'edit'); }
ACTIONS['bld-tab'] = el => { B.tab = el.dataset.t; VIEWS.builder.render(); };
ACTIONS['bld-sel'] = el => { if ($('#bEd')) bldCollect(); B.sel = el.dataset.s; bldEditor(); bldSide(); };
ACTIONS['bld-add'] = () => {
  if (!bldEditAllowed()) return; bldCollect();
  const last = B.draft.steps[B.draft.steps.length - 1]; let id = 'step_' + (B.draft.steps.length + 1); while (B.draft.steps.some(s => s.id === id)) id += 'x';
  B.draft.steps.push({ id, name: 'New step', doer: { type: 'fixed', name: '' }, trigger: last ? { type: 'afterStep', step: last.id } : { type: 'instanceStart' }, tat: { value: 1, unit: 'days' } });
  B.sel = id; B.dirty = true; VIEWS.builder.render(); const n = $('[data-k="name"]'); if (n) { n.focus(); n.select(); }
};
ACTIONS['bld-move'] = el => { bldCollect(); const i = B.draft.steps.findIndex(s => s.id === B.sel); const j = i + num(el.dataset.d); if (j < 0 || j >= B.draft.steps.length) return; const a = B.draft.steps; [a[i], a[j]] = [a[j], a[i]]; B.dirty = true; VIEWS.builder.render(); };
ACTIONS['bld-del'] = () => {
  const i = B.draft.steps.findIndex(s => s.id === B.sel); if (i < 0) return;
  const gone = B.draft.steps[i]; const gt = (Array.isArray(gone.trigger) ? gone.trigger[0] : gone.trigger) || { type: 'instanceStart' };
  B.draft.steps.forEach(st => {
    const list = (Array.isArray(st.trigger) ? st.trigger : [st.trigger]).map(t => t && t.type === 'afterStep' && t.step === gone.id ? Object.assign(clone(gt), t.when ? { when: t.when } : {}, t.orNext ? { orNext: true } : {}) : t);
    st.trigger = list.length === 1 ? list[0] : list;
  });
  B.draft.steps.splice(i, 1); B.sel = (B.draft.steps[Math.max(0, i - 1)] || {}).id; B.dirty = true; VIEWS.builder.render();
};
ACTIONS['cand-add'] = () => { bldCollect(); const s = curStep(); const t = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).filter(Boolean); t.push({ type: 'afterStep', step: '' }); s.trigger = t; if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['cand-del'] = el => { bldCollect(); const s = curStep(); const t = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]); t.splice(+el.dataset.j, 1); s.trigger = t.length === 1 ? t[0] : t; if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['cond-add'] = el => {
  bldCollect(); const s = curStep(); const key = el.dataset.cond; const f = (bldFields(['select'])[0] || {}).key; const leaf = { field: f, in: [] };
  const add = c => { const rs = condToRows(c) || { join: 'all', rows: [] }; rs.rows.push(leafRow(leaf)); return rowsToCond(rs.join, rs.rows); };
  if (key === 'applies') s.applies = add(s.applies);
  else { const j = +key.split('-')[1]; const t = Array.isArray(s.trigger) ? s.trigger[j] : s.trigger; t.when = add(t.when); }
  if (!bldMarkDirty()) { bldEditor(); bldSide(); }
};
ACTIONS['cond-del'] = el => { el.closest('.condrow').remove(); bldCollect(); if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['bld-new'] = () => {
  if (!bldEditAllowed()) return; if (B.dirty) { flash('Save or discard your changes first.', 'err'); return; }
  const name = (prompt('Name of the new FMS') || '').trim(); if (!name) return;
  let code = slug(name); while (Store.all('processes').some(p => p.code === code)) code += '_2';
  const base = activeProcess() || Store.all('processes')[0];
  const spec = { process: { id: code, name, startEvent: 'Start', instanceLabel: 'Record', endStep: 'step_1' }, fields: clone(base ? base.spec.fields : []), priority: base ? clone(base.spec.priority) : undefined, doerTables: {}, steps: [{ id: 'step_1', name: 'First step', doer: { type: 'fixed', name: '' }, trigger: { type: 'instanceStart' }, tat: { value: 1, unit: 'days' } }] };
  const p = Store.put('processes', { id: uid(), code, version: 1, name, spec, active: false, created_at: nowIso(), created_by: ME.name });
  audit('fms.new', code, name); bldLoad(p.id); B.tab = 'flow'; VIEWS.builder.render(); flash(name + ' created. Add its steps, then Save and Activate.');
};
ACTIONS['bld-discard'] = () => { bldLoad(B.pid); VIEWS.builder.render(); };
ACTIONS['bld-save'] = el => {
  if (!bldEditAllowed()) return; if ($('#bEd')) bldCollect();
  const v = validateSpec(B.draft); if (v.errors.length) { flash('Fix ' + v.errors.length + ' error(s) first.', 'err'); return; }
  const proc = Store.get('processes', B.pid);
  if (!(el && el.dataset && el.dataset.new)) {
    // Save = update this version (live orders follow the change); a new version only when asked for
    proc.spec = clone(B.draft); proc.name = B.draft.process.name; proc.updated_at = nowIso(); proc.updated_by = ME.name; Store.put('processes', proc); RES_CACHE.clear();
    audit('fms.save', proc.code + ' v' + proc.version, 'updated in place'); B.dirty = false; flash('v' + proc.version + ' saved.' + (proc.active ? ' Running orders follow the change.' : '')); VIEWS.builder.render(); return;
  }
  const max = Math.max(...Store.all('processes').filter(p => p.code === proc.code).map(p => p.version));
  const np = Store.put('processes', { id: uid(), code: proc.code, version: max + 1, name: B.draft.process.name, spec: clone(B.draft), active: false, created_at: nowIso(), created_by: ME.name });
  audit('fms.version', proc.code + ' v' + np.version, 'Saved from v' + proc.version);
  B.pid = np.id; B.dirty = false; flash('Saved as v' + np.version + '. It is not live yet — click Activate when ready.'); VIEWS.builder.render();
};
// delete one version (not live, no orders on it) or the whole FMS (no orders on any version)
const fmsUsers = ids => fmsDocs().filter(o => ids.includes(o.process_id));
ACTIONS['bld-delver'] = () => {
  if (!isSuperAdmin()) return; const p = Store.get('processes', B.pid); if (!p || p.active) { flash('The live version cannot be deleted.', 'err'); return; }
  const n = fmsUsers([p.id]).length; if (n) { flash(n + ' order(s)/sample(s) run on v' + p.version + ' — it cannot be deleted.', 'err'); return; }
  Store.del('processes', p.id); audit('fms.delete_version', p.code + ' v' + p.version, '');
  const rest = Store.all('processes').filter(x => x.code === p.code); bldLoad((rest.find(x => x.active) || rest[0]).id); flash('v' + p.version + ' deleted.'); VIEWS.builder.render();
};
ACTIONS['bld-delfms'] = () => {
  if (!isSuperAdmin()) return; const p = Store.get('processes', B.pid); const all = Store.all('processes').filter(x => x.code === p.code);
  const n = fmsUsers(all.map(x => x.id)).length; if (n) { flash(n + ' order(s)/sample(s) run on this FMS — close or delete them first.', 'err'); return; }
  all.forEach(x => Store.del('processes', x.id)); audit('fms.delete', p.code, (p.name || p.code) + ' · ' + all.length + ' version(s)');
  const left = Store.all('processes'); if (left.length) bldLoad((left.find(x => x.active) || left[0]).id); flash((p.name || p.code) + ' deleted.'); VIEWS.builder.render();
};
ACTIONS['bld-activate'] = () => {
  if (!bldEditAllowed()) return;
  const p = Store.get('processes', B.pid);
  Store.all('processes').filter(x => x.code === p.code && x.active && x.id !== p.id).forEach(x => { x.active = false; Store.put('processes', x); });
  p.active = true; Store.put('processes', p); audit('fms.activate', p.code + ' v' + p.version, '');
  flash('v' + p.version + ' is live. New orders use it; existing orders stay on the version they started with.'); VIEWS.builder.render();
};

/* ---------- simulate ---------- */
function bldSim() {
  const d = B.draft;
  if (!B.sim) { const n = new Date(); n.setSeconds(0, 0); B.sim = { start: ymdOf(n) + 'T' + String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'), fields: { delivery_date: ymdOf(new Date(Date.now() + 10 * 86400000)) } }; }
  const S = B.sim; const spec = Object.assign({}, d, { calendar: calendar() });
  const fields = Object.assign({ created_at: new Date(S.start).toISOString() }, S.fields);
  const actuals = {}; let res;
  try {
    for (let pass = 0; pass < d.steps.length + 2; pass++) {
      res = FMSEngine.resolveInstance(spec, { fields, actuals }, new Date(S.start)); let ch = false;
      res.order.forEach(id => { const s = res.steps[id]; if (s.applies && s.planned && !actuals[id]) { actuals[id] = s.planned; ch = true; } });
      if (!ch) break;
    }
    res = FMSEngine.resolveInstance(spec, { fields, actuals }, new Date(S.start));
  } catch (e) { $('#bSim').innerHTML = '<div class="panel">Cannot simulate: ' + esc(e.message) + '</div>'; return; }
  const c = calendar();
  let h = '<div class="panel" style="margin-bottom:10px"><div class="row"><label>Order punched at<input id="simStart" type="datetime-local" value="' + esc(S.start) + '"></label>' +
    bldFields(['select']).map(f => { const o = fieldOpts(f.key); if (!o.length || o.length > 6) return ''; if (S.fields[f.key] == null) S.fields[f.key] = f.key === 'priority' ? '' : o[0]; return '<label>' + esc(f.label) + seg('sim_' + f.key, (f.key === 'priority' ? [{ v: '', l: 'Normal' }] : []).concat(o.map(x => ({ v: x, l: x }))), S.fields[f.key]) + '</label>'; }).join('') +
    bldFields(['date']).map(f => '<label>' + esc(f.label) + '<input type="date" data-simf="' + esc(f.key) + '" value="' + esc(S.fields[f.key] || '') + '"></label>').join('') + '</div>' +
    '<div class="muted small" style="margin-top:8px">Office ' + esc(c.open) + '–' + esc(c.close) + ', lunch ' + esc(c.lunchStart) + '–' + esc(c.lunchEnd) + ', off: ' + (c.weeklyOff || []).map(i => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(', ') + ', half days: ' + esc(c.halfDays) + '. Each step is assumed done at its planned time.</div></div>';
  h += '<div class="tbl-wrap"><table><tr><th>Step</th><th>Doer</th><th>Starts</th><th>TAT</th><th>Due</th></tr>' + res.order.map(id => {
    const s = res.steps[id]; const def = d.steps.find(x => x.id === id);
    if (!s.applies) return '<tr class="muted"><td>' + esc(s.name) + '</td><td colspan="4">Not applicable</td></tr>';
    const t = s.trigger; const tat = t && (t.tat || def.tat);
    return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.doer || '') + '</td><td class="small">' + esc(describeTrigger(t)) + '</td><td class="nowrap">' + esc(tat ? (fields.priority === 'Urgent' && tat.urgent != null ? tat.urgent : tat.value) + (tat.unit === 'hours' ? ' h' : ' d') : '') + '</td><td class="nowrap"><b>' + fmtDT(s.planned) + '</b></td></tr>';
  }).join('') + '</table></div>';
  $('#bSim').innerHTML = h;
  $('#simStart').addEventListener('change', e => { S.start = e.target.value; bldSim(); });
  $$('[data-simf]').forEach(i => i.addEventListener('change', e => { S.fields[e.target.dataset.simf] = e.target.value; bldSim(); }));
}

/* ---------- fields & JSON ---------- */
function bldFieldsTab() {
  const d = B.draft; const edit = can('builder', 'edit');
  let h = '<div class="grid2"><div><h2 style="margin-top:0">Order fields</h2><div class="tbl-wrap"><table><tr><th>Key</th><th>Label</th><th>Type</th><th>Options (comma)</th><th>Source</th><th></th></tr>' +
    d.fields.map((f, i) => { const sys = CORE_FIELDS.includes(f.key); return '<tr data-fi="' + i + '"><td class="mono">' + esc(f.key) + '</td><td><input data-ff="label" value="' + esc(f.label) + '"' + (edit ? '' : ' disabled') + '></td><td>' + (sys ? esc(f.type) : '<select data-ff="type"' + (edit ? '' : ' disabled') + '>' + ['text', 'number', 'date', 'select'].map(t => '<option' + (t === f.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</td>' +
      '<td>' + (f.type === 'select' ? '<input data-ff="options" value="' + esc((f.options || []).filter(o => o !== '').join(', ')) + '"' + (edit && f.key !== 'priority' ? '' : ' disabled') + '>' : '') + '</td><td>' + esc(f.source || 'form') + '</td><td>' + (!sys && edit ? '<button class="btn ghost sm danger" data-act="fld-del" data-i="' + i + '" data-confirm="Delete?">×</button>' : '') + '</td></tr>'; }).join('') + '</table></div>' +
    (edit ? '<div class="row" style="margin-top:8px"><label>New field label<input id="nfLabel" placeholder="e.g. Brand"></label><button class="btn" data-act="fld-add">Add field</button></div>' : '') + '</div>';
  h += '<div><h2 style="margin-top:0">Full flow JSON</h2><textarea id="specJson" rows="26" class="mono"' + (edit ? '' : ' readonly') + '>' + esc(JSON.stringify(d, null, 2)) + '</textarea>' +
    (edit ? '<div class="toolbar" style="margin-top:6px"><button class="btn" data-act="json-apply">Apply JSON</button><button class="btn" data-act="json-dl">Download</button><span id="jsonMsg" class="small"></span></div>' : '') + '</div></div>';
  $('#bFields').innerHTML = h;
  $('#bFields').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-fi]'); if (!tr || !e.target.dataset.ff) return;
    const f = d.fields[+tr.dataset.fi]; const k = e.target.dataset.ff;
    if (k === 'options') f.options = e.target.value.split(',').map(s => s.trim()).filter(Boolean); else f[k] = e.target.value;
    if (k === 'type' && f.type === 'select' && !f.options) f.options = [];
    if (k === 'type' && f.type !== 'select') delete f.options;
    B.dirty = true; VIEWS.builder.render();
  });
}
ACTIONS['fld-add'] = () => {
  const l = $('#nfLabel').value.trim(); if (!l) return; let key = slug(l); while (B.draft.fields.some(f => f.key === key)) key += '_2';
  B.draft.fields.push({ key, label: l, type: 'text', source: 'form' }); B.dirty = true; VIEWS.builder.render();
};
ACTIONS['fld-del'] = el => { B.draft.fields.splice(+el.dataset.i, 1); B.dirty = true; VIEWS.builder.render(); };
ACTIONS['json-apply'] = () => {
  let spec; try { spec = JSON.parse($('#specJson').value); } catch (e) { $('#jsonMsg').innerHTML = '<span class="late-txt">Invalid JSON: ' + esc(e.message) + '</span>'; return; }
  if (!spec.process || !Array.isArray(spec.steps) || !Array.isArray(spec.fields)) { $('#jsonMsg').innerHTML = '<span class="late-txt">Needs process, fields[] and steps[].</span>'; return; }
  B.draft = spec; B.dirty = true; if (!spec.steps.some(s => s.id === B.sel)) B.sel = (spec.steps[0] || {}).id;
  const v = validateSpec(spec); VIEWS.builder.render(); flash('JSON applied — ' + v.errors.length + ' error(s), ' + v.warns.length + ' warning(s). Save as new version to keep it.', v.errors.length ? 'err' : '');
};
ACTIONS['json-dl'] = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(B.draft, null, 2)], { type: 'application/json' })); a.download = B.draft.process.id + '-flow.json'; a.click(); };

/* ---------- doer tables (e.g. brand → doer) ---------- */
function bldTables() {
  const el = $('#bTables'); if (!el) return; const edit = can('builder', 'edit');
  const T = B.draft.doerTables = B.draft.doerTables || {};
  const used = t => B.draft.steps.filter(s => s.doer && s.doer.type === 'lookup' && s.doer.table === t).map(s => s.name);
  let h = '<div class="toolbar">' + (edit ? '<input id="btNew" placeholder="table name, e.g. brand_doer"><button class="btn" data-act="bt-add">Add table</button>' : '') + '</div>';
  h += '<div class="grid2">' + Object.keys(T).map(t => '<div class="panel"><div class="row" style="justify-content:space-between;align-items:center"><b>' + esc(t) + '</b>' + (edit ? '<button class="btn ghost sm danger" data-act="bt-del" data-t="' + esc(t) + '" data-confirm="Delete table?">Delete</button>' : '') + '</div>' +
    '<div class="small muted" style="margin:4px 0">' + (used(t).length ? 'Used by: ' + esc(used(t).join(', ')) : 'Not used by any step') + '</div>' +
    '<div class="tbl-wrap"><table><tr><th>Key (e.g. brand)</th><th>Doer</th><th></th></tr>' + Object.entries(T[t]).map(([k, v]) => '<tr data-bt="' + esc(t) + '" data-bk="' + esc(k) + '"><td>' + (edit ? '<input data-btk value="' + esc(k) + '">' : esc(k)) + '</td><td>' + (edit ? '<input data-btv list="dlDoers" value="' + esc(v) + '">' : esc(v)) + '</td><td>' + (edit ? '<button class="btn ghost sm danger" data-act="bt-rdel">×</button>' : '') + '</td></tr>').join('') + '</table></div>' +
    (edit ? '<a class="small" data-act="bt-radd" data-t="' + esc(t) + '">+ row</a>' : '') + '</div>').join('') + '</div>' +
    '<datalist id="dlDoers">' + doerNames().map(n => { const u = Store.all('users').find(x => x.doer && norm(x.doer) === norm(n)); return '<option value="' + esc(n) + '"' + (u ? ' label="' + esc(doerLabel(u)) + '"' : '') + '>' + (u ? esc(doerLabel(u)) : '') + '</option>'; }).join('') + '</datalist>';
  el.innerHTML = h;
  el.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-bt]'); if (!tr) return; const t = tr.dataset.bt, k0 = tr.dataset.bk; const tb = T[t];
    const k = $('[data-btk]', tr).value.trim(), v = $('[data-btv]', tr).value.trim().toUpperCase();
    const out = {}; Object.entries(tb).forEach(([kk, vv]) => { if (kk === k0) { if (k) out[k] = v; } else out[kk] = vv; }); B.draft.doerTables[t] = out; if (!bldMarkDirty()) bldTables();
  });
}
ACTIONS['bt-add'] = () => { const n = ($('#btNew').value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'); if (!n) return; B.draft.doerTables = B.draft.doerTables || {}; if (!B.draft.doerTables[n]) B.draft.doerTables[n] = {}; if (!bldMarkDirty()) bldTables(); };
ACTIONS['bt-del'] = el => { delete B.draft.doerTables[el.dataset.t]; if (!bldMarkDirty()) bldTables(); };
ACTIONS['bt-radd'] = el => { const tb = B.draft.doerTables[el.dataset.t]; let k = 'NEW'; let i = 1; while (tb[k]) k = 'NEW ' + (++i); tb[k] = ''; if (!bldMarkDirty()) bldTables(); };
ACTIONS['bt-rdel'] = el => { const tr = el.closest('tr'); delete B.draft.doerTables[tr.dataset.bt][tr.dataset.bk]; if (!bldMarkDirty()) bldTables(); };
