/* Nexus 2.0 — Excel-style filter & sort on every list table (.tbl-wrap > table), with paging.
   Header button per column: Sort A→Z / Z→A, Sort by Color, Clear Filter, Filter by Color,
   Text / Number / Date Filters (Equals, Begins With, Between, Top 10, Above Average, Today, This Month …),
   Custom AutoFilter (two conditions with And / Or, * and ? wildcards), search box and value checklist
   (date columns as a Year › Month › Day tree). Filters and sort stay while you work on the screen.
   A table opts out with class "nofilter"; class "nopage" turns paging off. */
'use strict';

const XF_STATE = new Map();           // screen|table|headers -> { f: {col: spec}, sort: {col, dir, color} }
const XF_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const XF_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const XF_ICON = {
  caret: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  funnel: '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M1.5 2h9L7 6.2V10L5 9V6.2z" fill="currentColor"/></svg>',
  up: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M6 10V2M3 5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M6 2v8M3 7l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

/* ---------- value parsing ---------- */
function xfText(cell) {
  if (!cell) return '';
  const f = cell.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea');
  if (f) return f.tagName === 'SELECT' ? (f.selectedIndex >= 0 ? f.options[f.selectedIndex].text : '') : String(f.value || '');
  return cell.textContent.replace(/\s+/g, ' ').trim();
}
function xfNum(s) {
  const t = String(s).replace(/[₹,\s%]/g, '').replace(/^Rs\.?/i, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : null;
}
function xfDate(s) {
  s = String(s).trim(); let m;
  if ((m = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{4})(?:,? (\d{1,2}):(\d{2}))?/i.exec(s))) {
    const mo = XF_MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
    return new Date(+m[3], mo, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const xfDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const xfDayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const xfEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- table model ---------- */
function xfModel(tbl) {
  const rows = Array.from(tbl.rows);
  let hi = -1;
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (r.querySelector('th') && !r.querySelector('td')) hi = i; else break; }
  const hdr = hi >= 0 ? rows[hi] : null;
  const data = rows.slice(hi + 1);
  const cols = []; let width = 0;
  if (hdr) Array.from(hdr.cells).forEach(th => { cols.push({ th, idx: width, label: th.textContent.replace(/\s+/g, ' ').trim() }); width += th.colSpan || 1; });
  const rowWidth = r => Array.from(r.cells).reduce((a, c) => a + (c.colSpan || 1), 0);
  const hasRowspan = data.some(r => Array.from(r.cells).some(c => c.rowSpan > 1));
  const docRows = !!tbl.querySelector('tr.bomfirst');
  const units = []; let span = 0, doc = -1;
  data.forEach(r => {
    const pinned = r.hasAttribute('data-new') || r.classList.contains('xf-pin');
    const attach = !pinned && (span > 0 || r.classList.contains('szrow') || r.classList.contains('inline-form') || (hdr && rowWidth(r) < width && !hasRowspan && units.length > 0));
    if (span > 0) span -= 1;
    const rs = Math.max(1, ...Array.from(r.cells).map(c => c.rowSpan || 1)) - 1;
    if (rs > 0) span = Math.max(span, rs);
    if (attach && units.length) { units[units.length - 1].rows.push(r); return; }
    if (docRows && (r.classList.contains('bomfirst') || doc < 0)) doc++;
    units.push({ main: r, rows: [r], pinned, doc, order: units.length });
  });
  return { hdr, cols, width, units, docRows, empty: data.some(r => r.querySelector('.empty')) };
}
function xfCell(row, idx) {
  let at = 0;
  for (const c of row.cells) { const w = c.colSpan || 1; if (idx >= at && idx < at + w) return c; at += w; }
  return null;
}
function xfColType(md, col) {
  let n = 0, d = 0, t = 0;
  md.units.forEach(u => { if (u.pinned) return; const v = xfText(xfCell(u.main, col.idx)); if (!v) return; t++; if (xfDate(v)) d++; else if (xfNum(v) != null) n++; });
  if (!t) return 'text';
  if (d / t >= 0.8) return 'date';
  if (n === t) return 'number';
  return 'text';
}
function xfVal(u, col, type) {
  const s = xfText(xfCell(u.main, col.idx));
  return { s, n: type === 'number' ? xfNum(s) : null, d: type === 'date' ? xfDate(s) : null };
}
function xfColors(cell) {
  if (!cell) return { font: '', fill: '' };
  const el = cell.querySelector('.st, .late-txt, b[class], span[class]') || cell;
  const font = getComputedStyle(el).color;
  let fill = getComputedStyle(cell).backgroundColor;
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(fill)) fill = getComputedStyle(cell.parentElement).backgroundColor;
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(fill)) fill = '';
  return { font, fill };
}

/* ---------- conditions ---------- */
const XF_TEXT_OPS = [['eq', 'equals'], ['ne', 'does not equal'], ['bw', 'begins with'], ['nbw', 'does not begin with'], ['ew', 'ends with'], ['new', 'does not end with'], ['ct', 'contains'], ['nc', 'does not contain']];
const XF_NUM_OPS = [['eq', 'equals'], ['ne', 'does not equal'], ['gt', 'is greater than'], ['ge', 'is greater than or equal to'], ['lt', 'is less than'], ['le', 'is less than or equal to']];
const XF_DATE_OPS = [['eq', 'equals'], ['ne', 'does not equal'], ['gt', 'is after'], ['ge', 'is after or equal to'], ['lt', 'is before'], ['le', 'is before or equal to']];
function xfWild(p) { return new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'i'); }
function xfTest1(v, op, arg, type) {
  if (!op) return true;
  if (type === 'number' || type === 'date') {
    const a = type === 'number' ? xfNum(arg) : xfDate(arg);
    if (a == null) return op === 'ne';
    let x = type === 'number' ? v.n : v.d;
    if (x == null) return op === 'ne';
    let b = a;
    if (type === 'date') { x = xfDayStart(x).getTime(); b = xfDayStart(a).getTime(); }
    switch (op) { case 'eq': return x === b; case 'ne': return x !== b; case 'gt': return x > b; case 'ge': return x >= b; case 'lt': return x < b; case 'le': return x <= b; }
    return true;
  }
  const s = v.s.toLowerCase(), q = String(arg || '').toLowerCase();
  const wild = /[*?]/.test(q);
  switch (op) {
    case 'eq': return wild ? xfWild(q).test(s) : s === q;
    case 'ne': return wild ? !xfWild(q).test(s) : s !== q;
    case 'bw': return wild ? xfWild(q + '*').test(s) : s.startsWith(q);
    case 'nbw': return !(wild ? xfWild(q + '*').test(s) : s.startsWith(q));
    case 'ew': return wild ? xfWild('*' + q).test(s) : s.endsWith(q);
    case 'new': return !(wild ? xfWild('*' + q).test(s) : s.endsWith(q));
    case 'ct': return wild ? xfWild('*' + q + '*').test(s) : s.includes(q);
    case 'nc': return !(wild ? xfWild('*' + q + '*').test(s) : s.includes(q));
  }
  return true;
}
// dynamic date periods (weeks start on Sunday, as in Excel)
function xfPeriod(key) {
  const t = xfDayStart(new Date()), Y = t.getFullYear(), M = t.getMonth(), D = t.getDate(), W = t.getDay();
  const r = (a, b) => [a, b];
  const q = Math.floor(M / 3);
  switch (key) {
    case 'today': return r(t, new Date(Y, M, D + 1));
    case 'yesterday': return r(new Date(Y, M, D - 1), t);
    case 'tomorrow': return r(new Date(Y, M, D + 1), new Date(Y, M, D + 2));
    case 'thisweek': return r(new Date(Y, M, D - W), new Date(Y, M, D - W + 7));
    case 'lastweek': return r(new Date(Y, M, D - W - 7), new Date(Y, M, D - W));
    case 'nextweek': return r(new Date(Y, M, D - W + 7), new Date(Y, M, D - W + 14));
    case 'thismonth': return r(new Date(Y, M, 1), new Date(Y, M + 1, 1));
    case 'lastmonth': return r(new Date(Y, M - 1, 1), new Date(Y, M, 1));
    case 'nextmonth': return r(new Date(Y, M + 1, 1), new Date(Y, M + 2, 1));
    case 'thisquarter': return r(new Date(Y, q * 3, 1), new Date(Y, q * 3 + 3, 1));
    case 'lastquarter': return r(new Date(Y, q * 3 - 3, 1), new Date(Y, q * 3, 1));
    case 'nextquarter': return r(new Date(Y, q * 3 + 3, 1), new Date(Y, q * 3 + 6, 1));
    case 'thisyear': return r(new Date(Y, 0, 1), new Date(Y + 1, 0, 1));
    case 'lastyear': return r(new Date(Y - 1, 0, 1), new Date(Y, 0, 1));
    case 'nextyear': return r(new Date(Y + 1, 0, 1), new Date(Y + 2, 0, 1));
    case 'ytd': return r(new Date(Y, 0, 1), new Date(Y, M, D + 1));
  }
  return null;
}
const XF_DYN = [['tomorrow', 'Tomorrow'], ['today', 'Today'], ['yesterday', 'Yesterday'], null, ['nextweek', 'Next Week'], ['thisweek', 'This Week'], ['lastweek', 'Last Week'], null, ['nextmonth', 'Next Month'], ['thismonth', 'This Month'], ['lastmonth', 'Last Month'], null, ['nextquarter', 'Next Quarter'], ['thisquarter', 'This Quarter'], ['lastquarter', 'Last Quarter'], null, ['nextyear', 'Next Year'], ['thisyear', 'This Year'], ['lastyear', 'Last Year'], null, ['ytd', 'Year to Date']];
function xfDynPass(d, key) {
  if (!d) return false;
  let m;
  if ((m = /^q([1-4])$/.exec(key))) return Math.floor(d.getMonth() / 3) === +m[1] - 1;
  if ((m = /^m(\d{1,2})$/.exec(key))) return d.getMonth() === +m[1] - 1;
  const p = xfPeriod(key); return !!p && d >= p[0] && d < p[1];
}
function xfDynLabel(key) {
  let m;
  if ((m = /^q([1-4])$/.exec(key))) return 'Quarter ' + m[1];
  if ((m = /^m(\d{1,2})$/.exec(key))) return XF_MONTH[+m[1] - 1];
  const f = XF_DYN.find(x => x && x[0] === key); return f ? f[1] : key;
}

/* ---------- one column's filter test (pre-computed per apply) ---------- */
function xfPrepare(md, col, spec) {
  const type = spec.type || xfColType(md, col);
  if (spec.top) {
    const vals = md.units.filter(u => !u.pinned).map(u => xfVal(u, col, 'number').n).filter(x => x != null).sort((a, b) => b - a);
    const k = spec.top.unit === 'percent' ? Math.max(1, Math.ceil(vals.length * spec.top.n / 100)) : spec.top.n;
    const list = spec.top.which === 'bottom' ? vals.slice().reverse() : vals;
    const edge = list[Math.min(k, list.length) - 1];
    return u => { const n = xfVal(u, col, 'number').n; return n != null && edge != null && (spec.top.which === 'bottom' ? n <= edge : n >= edge); };
  }
  if (spec.avg) {
    const vals = md.units.filter(u => !u.pinned).map(u => xfVal(u, col, 'number').n).filter(x => x != null);
    const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    return u => { const n = xfVal(u, col, 'number').n; return n != null && (spec.avg === 'above' ? n > avg : n < avg); };
  }
  if (spec.dyn) return u => xfDynPass(xfVal(u, col, 'date').d, spec.dyn);
  if (spec.color) return u => { const c = xfColors(xfCell(u.main, col.idx)); return (spec.color.kind === 'font' ? c.font : c.fill) === spec.color.c; };
  if (spec.cond) {
    const c = spec.cond;
    return u => {
      const v = xfVal(u, col, type);
      const a = xfTest1(v, c.op1, c.v1, type);
      if (!c.op2) return a;
      const b = xfTest1(v, c.op2, c.v2, type);
      return c.join === 'or' ? a || b : a && b;
    };
  }
  if (spec.vals) {
    const set = new Set(spec.vals);
    return u => { const v = xfVal(u, col, type); return set.has(type === 'date' && v.d ? xfDay(v.d) : v.s); };
  }
  return () => true;
}
function xfSpecLabel(spec) {
  if (!spec) return '';
  if (spec.top) return (spec.top.which === 'bottom' ? 'Bottom ' : 'Top ') + spec.top.n + (spec.top.unit === 'percent' ? '%' : '');
  if (spec.avg) return spec.avg === 'above' ? 'Above Average' : 'Below Average';
  if (spec.dyn) return xfDynLabel(spec.dyn);
  if (spec.color) return 'By color';
  if (spec.cond) return 'Custom';
  if (spec.vals) return spec.vals.length + ' value(s)';
  return '';
}

/* ---------- enhance a table: header buttons, filter, sort, paging ---------- */
function xTable(tbl, ti) {
  if (tbl.classList.contains('nofilter') && tbl.classList.contains('nopage')) return;
  const md = xfModel(tbl);
  if (!md.units.length || md.empty) return;
  const key = (typeof curView === 'function' ? curView().v : '') + '|' + ti + '|' + md.cols.map(c => c.label).join('~');
  const st = XF_STATE.get(key) || { f: {}, sort: null };
  const canFilter = md.hdr && !tbl.classList.contains('nofilter') && md.units.filter(u => !u.pinned).length > 1;
  const T = { tbl, md, key, st, page: 1, ti };
  tbl._xf = T;
  if (canFilter) {
    md.cols.forEach((c, ci) => {
      if (!c.label || c.th.querySelector('input,select,button') || (c.th.colSpan || 1) > 1) return;
      c.th.classList.add('xf-th');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'xf-btn'; b.dataset.xfCol = ci;
      b.setAttribute('aria-label', 'Filter ' + c.label);
      c.th.appendChild(b);
      b.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); xfOpen(T, ci, b); });
    });
  }
  xfApply(T);
}
function xfApply(T, resetPage) {
  const { md, st, tbl } = T;
  if (resetPage) T.page = 1;
  XF_STATE.set(T.key, st);
  // filter
  const tests = Object.keys(st.f).map(ci => xfPrepare(md, md.cols[ci], st.f[ci]));
  const pass = u => u.pinned || tests.every(t => t(u));
  // sort (whole documents when rows are grouped by document)
  let units = md.units.slice();
  if (st.sort && md.cols[st.sort.col]) {
    const col = md.cols[st.sort.col], type = xfColType(md, col), dir = st.sort.dir;
    const keyOf = u => {
      if (st.sort.color) { const c = xfColors(xfCell(u.main, col.idx)); return (st.sort.color.kind === 'font' ? c.font : c.fill) === st.sort.color.c ? 0 : 1; }
      const v = xfVal(u, col, type); return type === 'number' ? v.n : type === 'date' ? (v.d ? v.d.getTime() : null) : (v.s || null);
    };
    const cmp = (a, b) => {
      if (st.sort.color) return a - b;
      if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
      return (typeof a === 'string' ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) : a - b) * dir;
    };
    if (md.docRows) {
      const docs = new Map(); units.forEach(u => { if (!docs.has(u.doc)) docs.set(u.doc, []); docs.get(u.doc).push(u); });
      const list = Array.from(docs.values()).map(g => ({ g, k: keyOf(g[0]) }));
      list.sort((a, b) => cmp(a.k, b.k) || a.g[0].order - b.g[0].order);
      units = list.flatMap(x => x.g);
    } else {
      const ks = new Map(units.map(u => [u, keyOf(u)]));
      units.sort((a, b) => (b.pinned - a.pinned) || cmp(ks.get(a), ks.get(b)) || a.order - b.order);
    }
  }
  // put rows in order (pinned "new" rows stay on top)
  const first = md.units[0].main, parent = first.parentNode;
  const anchor = md.hdr && md.hdr.parentNode === parent ? md.hdr : null;
  const frag = document.createDocumentFragment();
  units.filter(u => u.pinned).concat(units.filter(u => !u.pinned)).forEach(u => u.rows.forEach(r => frag.appendChild(r)));
  if (anchor) anchor.after(frag); else parent.prepend(frag);
  // visible units → page groups
  const vis = units.filter(pass);
  const groups = [];
  vis.forEach(u => { const g = groups[groups.length - 1]; if (md.docRows && g && g.doc === u.doc && !u.pinned) g.units.push(u); else groups.push({ doc: u.doc, units: [u] }); });
  const total = md.units.filter(u => !u.pinned).length, shown = vis.filter(u => !u.pinned).length;
  const size = typeof pageSizeOf === 'function' && !tbl.classList.contains('nopage') ? pageSizeOf(tbl) : 0;
  const pages = size ? Math.max(1, Math.ceil(groups.length / size)) : 1;
  const pk = location.hash + '|' + T.ti;
  if (!resetPage && T.page === 1 && typeof PAGER_STATE !== 'undefined' && PAGER_STATE.get(pk)) T.page = PAGER_STATE.get(pk);
  T.page = Math.min(Math.max(1, T.page), pages);
  if (typeof PAGER_STATE !== 'undefined') PAGER_STATE.set(pk, T.page);
  const onPage = new Set();
  groups.forEach((g, i) => { if (!size || (i >= (T.page - 1) * size && i < T.page * size)) g.units.forEach(u => onPage.add(u)); });
  md.units.forEach(u => { const on = onPage.has(u); u.rows.forEach(r => { r.style.display = on ? '' : 'none'; }); });
  // empty result row
  let none = tbl.querySelector('tr.xf-none');
  if (!shown && total) {
    if (!none) { none = document.createElement('tr'); none.className = 'xf-none'; none.innerHTML = '<td colspan="' + (md.width || 1) + '" class="empty">No rows match the filter</td>'; parent.appendChild(none); }
  } else if (none) none.remove();
  // header buttons
  md.cols.forEach((c, ci) => {
    const b = c.th.querySelector('.xf-btn'); if (!b) return;
    const f = st.f[ci], s = st.sort && st.sort.col == ci ? st.sort : null;
    b.className = 'xf-btn' + (f || s ? ' on' : '');
    b.innerHTML = (s ? (s.color ? '' : s.dir > 0 ? XF_ICON.up : XF_ICON.down) : '') + (f ? XF_ICON.funnel : s ? '' : XF_ICON.caret);
    b.title = (f ? 'Filtered: ' + xfSpecLabel(f) : '') + (s ? (f ? ' · ' : '') + 'Sorted' : '');
  });
  // status / pager bar
  const wrap = tbl.closest('.tbl-wrap');
  let bar = wrap && wrap.nextElementSibling && wrap.nextElementSibling.classList.contains('pager') ? wrap.nextElementSibling : null;
  const filtered = Object.keys(st.f).length > 0;
  if (!size || groups.length <= size) { if (!filtered && !st.sort) { if (bar) bar.remove(); return; } }
  if (!bar && wrap) { bar = document.createElement('div'); bar.className = 'pager noprint'; wrap.after(bar); }
  if (!bar) return;
  bar.innerHTML = '';
  const info = document.createElement('span'); info.className = 'muted small';
  const from = groups.length ? (T.page - 1) * (size || groups.length) + 1 : 0, to = size ? Math.min(T.page * size, groups.length) : groups.length;
  info.textContent = (filtered ? shown + ' of ' + total + ' records' : '') + (size && groups.length > size ? (filtered ? ' · ' : '') + from + '–' + to + ' of ' + groups.length : (filtered ? '' : total + ' records'));
  bar.appendChild(info);
  if (filtered || st.sort) {
    const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'btn sm ghost'; clr.textContent = filtered ? 'Clear filters' : 'Clear sort';
    clr.onclick = () => { st.f = {}; st.sort = null; xfApply(T, true); };
    bar.prepend(clr);
  }
  if (size && groups.length > size) {
    const mk = (t, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = t; b.disabled = dis; b.onclick = fn; return b; };
    bar.append(mk('‹ Prev', () => { T.page--; xfApply(T); }, T.page <= 1), mk('Next ›', () => { T.page++; xfApply(T); }, T.page >= pages));
  }
}

/* ---------- the dropdown ---------- */
function xfClose() { document.querySelectorAll('.xf-pop, .xf-sub').forEach(x => x.remove()); }
document.addEventListener('mousedown', e => { if (!e.target.closest('.xf-pop, .xf-sub, .xf-btn, .xf-dlg')) xfClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.xf-pop')) { xfClose(); } });
window.addEventListener('hashchange', xfClose);
window.addEventListener('resize', xfClose);

function xfOpen(T, ci, btn) {
  const was = document.querySelector('.xf-pop'); xfClose();
  if (was && was.dataset.key === T.key + '#' + ci) return;
  const { md, st } = T, col = md.cols[ci], type = xfColType(md, col), spec = st.f[ci] || null;
  // values come from rows that pass the OTHER columns' filters (as in Excel)
  const others = Object.keys(st.f).filter(k => k != ci).map(k => xfPrepare(md, md.cols[k], st.f[k]));
  const pool = md.units.filter(u => !u.pinned && others.every(t => t(u)));
  const cur = spec ? xfPrepare(md, col, spec) : null;
  const items = new Map();                       // key -> {label, checked, d}
  pool.forEach(u => {
    const v = xfVal(u, col, type);
    const k = type === 'date' && v.d ? xfDay(v.d) : v.s;
    if (!items.has(k)) items.set(k, { k, label: v.s, d: type === 'date' ? v.d : null, n: v.n, on: false });
    if (!cur || cur(u)) items.get(k).on = true;
  });
  const list = Array.from(items.values()).sort((a, b) => {
    if (a.k === '') return 1; if (b.k === '') return -1;
    if (type === 'number') return (a.n ?? Infinity) - (b.n ?? Infinity);
    if (type === 'date') return a.k < b.k ? 1 : a.k > b.k ? -1 : 0;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  });
  // colors present in the column
  const fonts = new Map(), fills = new Map();
  pool.forEach(u => { const c = xfColors(xfCell(u.main, col.idx)); if (c.font) fonts.set(c.font, 1); if (c.fill) fills.set(c.fill, 1); });
  const hasColor = fonts.size > 1 || fills.size > 0;
  const sortL = type === 'number' ? ['Sort Smallest to Largest', 'Sort Largest to Smallest'] : type === 'date' ? ['Sort Oldest to Newest', 'Sort Newest to Oldest'] : ['Sort A to Z', 'Sort Z to A'];
  const fl = type === 'number' ? 'Number Filters' : type === 'date' ? 'Date Filters' : 'Text Filters';
  const p = document.createElement('div'); p.className = 'xf-pop'; p.dataset.key = T.key + '#' + ci;
  p.innerHTML =
    '<button class="xf-it" data-x="asc">' + XF_ICON.up + '<span>' + sortL[0] + '</span></button>' +
    '<button class="xf-it" data-x="desc">' + XF_ICON.down + '<span>' + sortL[1] + '</span></button>' +
    (hasColor ? '<button class="xf-it xf-has" data-x="sortcolor"><i></i><span>Sort by Color</span><b>›</b></button>' : '') +
    '<div class="xf-sep"></div>' +
    '<button class="xf-it" data-x="clear"' + (spec ? '' : ' disabled') + '>' + XF_ICON.funnel + '<span>Clear Filter From "' + xfEsc(col.label) + '"</span></button>' +
    (hasColor ? '<button class="xf-it xf-has" data-x="filtercolor"><i></i><span>Filter by Color</span><b>›</b></button>' : '') +
    '<button class="xf-it xf-has' + (spec && (spec.cond || spec.top || spec.avg || spec.dyn) ? ' xf-chk' : '') + '" data-x="sub"><i></i><span>' + fl + '</span><b>›</b></button>' +
    '<div class="xf-search"><input type="search" placeholder="Search" autocomplete="off"></div>' +
    '<div class="xf-list"></div>' +
    '<label class="xf-add hidden"><input type="checkbox"> Add current selection to filter</label>' +
    '<div class="xf-foot"><button class="btn sm primary" data-x="ok">OK</button><button class="btn sm" data-x="cancel">Cancel</button></div>';
  document.body.appendChild(p);
  // position under the button (inside the viewport)
  const r = btn.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 8); left = Math.max(8, Math.max(left, r.left - w + r.width));
  if (r.left + w < window.innerWidth - 8) left = r.left;
  let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  p.style.left = (left + window.scrollX) + 'px'; p.style.top = (top + window.scrollY) + 'px';

  const listEl = p.querySelector('.xf-list'), search = p.querySelector('.xf-search input'), addBox = p.querySelector('.xf-add');
  const lab = it => it.k === '' ? '(Blanks)' : xfEsc(it.label);
  let q = '';
  const shownItems = () => q ? list.filter(it => (it.k === '' ? '(blanks)' : it.label.toLowerCase()).includes(q)) : list;
  const draw = () => {
    const sh = shownItems();
    if (!sh.length) { listEl.innerHTML = '<div class="xf-nomatch">No matches</div>'; return; }
    let h = '<label class="xf-all"><input type="checkbox" data-all> (Select All' + (q ? ' Search Results' : '') + ')</label>';
    if (type === 'date' && !q) {
      // Year › Month › Day tree
      const yrs = new Map();
      sh.forEach(it => { if (!it.d) return; const y = it.d.getFullYear(), m = it.d.getMonth(); if (!yrs.has(y)) yrs.set(y, new Map()); const ms = yrs.get(y); if (!ms.has(m)) ms.set(m, []); ms.get(m).push(it); });
      Array.from(yrs.keys()).sort((a, b) => b - a).forEach(y => {
        h += '<div class="xf-node"><span class="xf-tw" data-tw>+</span><label><input type="checkbox" data-y="' + y + '"> ' + y + '</label><div class="xf-kids hidden">';
        Array.from(yrs.get(y).keys()).sort((a, b) => a - b).forEach(m => {
          h += '<div class="xf-node"><span class="xf-tw" data-tw>+</span><label><input type="checkbox" data-y="' + y + '" data-m="' + m + '"> ' + XF_MONTH[m] + '</label><div class="xf-kids hidden">' +
            yrs.get(y).get(m).sort((a, b) => a.k < b.k ? -1 : 1).map(it => '<label class="xf-leaf"><input type="checkbox" data-k="' + xfEsc(it.k) + '"' + (it.on ? ' checked' : '') + '> ' + String(it.d.getDate()).padStart(2, '0') + '</label>').join('') + '</div></div>';
        });
        h += '</div></div>';
      });
      sh.filter(it => !it.d).forEach(it => { h += '<label class="xf-leaf0"><input type="checkbox" data-k="' + xfEsc(it.k) + '"' + (it.on ? ' checked' : '') + '> ' + lab(it) + '</label>'; });
    } else {
      h += sh.slice(0, 2000).map(it => '<label class="xf-leaf0"><input type="checkbox" data-k="' + xfEsc(it.k) + '"' + (q || it.on ? ' checked' : '') + '> ' + lab(it) + '</label>').join('');
      if (sh.length > 2000) h += '<div class="xf-nomatch">Showing first 2000 — use Search</div>';
    }
    listEl.innerHTML = h;
    sync();
  };
  const leaves = () => Array.from(listEl.querySelectorAll('input[data-k]'));
  const sync = () => {   // parent / Select All states from the leaves
    listEl.querySelectorAll('input[data-y]').forEach(cb => {
      const box = cb.closest('.xf-node').querySelector('.xf-kids'); const ls = Array.from(box.querySelectorAll('input[data-k]'));
      const n = ls.filter(x => x.checked).length; cb.checked = n === ls.length && n > 0; cb.indeterminate = n > 0 && n < ls.length;
    });
    const all = listEl.querySelector('[data-all]'); if (!all) return;
    const ls = leaves(), n = ls.filter(x => x.checked).length; all.checked = n === ls.length && n > 0; all.indeterminate = n > 0 && n < ls.length;
    p.querySelector('[data-x="ok"]').disabled = n === 0;
  };
  listEl.addEventListener('change', e => {
    const t = e.target;
    if (t.hasAttribute('data-all')) leaves().forEach(x => { x.checked = t.checked; });
    else if (t.dataset.y != null && !t.dataset.k) t.closest('.xf-node').querySelector('.xf-kids').querySelectorAll('input[data-k]').forEach(x => { x.checked = t.checked; });
    sync();
  });
  listEl.addEventListener('click', e => { const tw = e.target.closest('[data-tw]'); if (!tw) return; const k = tw.parentElement.querySelector('.xf-kids'); k.classList.toggle('hidden'); tw.textContent = k.classList.contains('hidden') ? '+' : '−'; });
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); addBox.classList.toggle('hidden', !q || !spec || !spec.vals); draw(); });
  draw(); setTimeout(() => search.focus(), 0);

  const done = s => { if (s === undefined) delete st.f[ci]; else st.f[ci] = s; xfClose(); xfApply(T, true); };
  p.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); p.querySelector('[data-x="ok"]').click(); } });
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-x]'); if (!b || b.disabled) return;
    const x = b.dataset.x;
    if (x === 'asc' || x === 'desc') { st.sort = { col: ci, dir: x === 'asc' ? 1 : -1 }; xfClose(); xfApply(T); return; }
    if (x === 'clear') return done(undefined);
    if (x === 'cancel') return xfClose();
    if (x === 'ok') {
      const sel = leaves().filter(i => i.checked).map(i => i.dataset.k);
      let vals = sel;
      if (q) { if (!addBox.classList.contains('hidden') && addBox.querySelector('input').checked && spec && spec.vals) vals = Array.from(new Set(spec.vals.concat(sel))); }
      else if (sel.length === list.length) return done(undefined);       // everything ticked = no filter
      return done({ vals, type });
    }
    if (x === 'sub') return xfSub(b, xfSubItems(type), k => xfPick(T, ci, type, k, spec, list));
    if (x === 'filtercolor' || x === 'sortcolor') {
      const opts = [];
      if (fills.size) opts.push({ head: 'Cell Color' }, ...Array.from(fills.keys()).map(c => ({ k: 'fill|' + c, sw: c, bg: true })), { k: 'fill|', label: 'No Fill' });
      if (fonts.size > 1) opts.push({ head: 'Font Color' }, ...Array.from(fonts.keys()).map(c => ({ k: 'font|' + c, sw: c })));
      return xfSub(b, opts, k => {
        const [kind, c] = k.split('|');
        if (x === 'sortcolor') { st.sort = { col: ci, dir: 1, color: { kind, c } }; xfClose(); xfApply(T); }
        else done({ color: { kind, c }, type });
      });
    }
  });
}
function xfSubItems(type) {
  if (type === 'number') return [['eq', 'Equals…'], ['ne', 'Does Not Equal…'], ['gt', 'Greater Than…'], ['ge', 'Greater Than Or Equal To…'], ['lt', 'Less Than…'], ['le', 'Less Than Or Equal To…'], ['between', 'Between…'], null, ['top', 'Top 10…'], ['above', 'Above Average'], ['below', 'Below Average'], null, ['custom', 'Custom Filter…']].map(x => x && { k: x[0], label: x[1] });
  if (type === 'date') return [['eq', 'Equals…'], ['lt', 'Before…'], ['gt', 'After…'], ['between', 'Between…'], null].concat(XF_DYN).concat([null, ['period', 'All Dates in the Period'], null, ['custom', 'Custom Filter…']]).map(x => x && { k: x[0], label: x[1], more: x[0] === 'period' });
  return [['eq', 'Equals…'], ['ne', 'Does Not Equal…'], null, ['bw', 'Begins With…'], ['ew', 'Ends With…'], null, ['ct', 'Contains…'], ['nc', 'Does Not Contain…'], null, ['custom', 'Custom Filter…']].map(x => x && { k: x[0], label: x[1] });
}
// a flyout next to a menu item
function xfSub(anchor, items, pick, level) {
  document.querySelectorAll('.xf-sub').forEach(x => { if (+x.dataset.lv >= (level || 1)) x.remove(); });
  const s = document.createElement('div'); s.className = 'xf-sub'; s.dataset.lv = level || 1;
  s.innerHTML = items.map((it, i) => !it ? '<div class="xf-sep"></div>' : it.head ? '<div class="xf-head">' + xfEsc(it.head) + '</div>' :
    '<button class="xf-it' + (it.more ? ' xf-has' : '') + '" data-i="' + i + '">' + (it.sw ? '<i class="xf-sw" style="' + (it.bg ? 'background:' : 'background:') + xfEsc(it.sw) + '"></i>' : '<i></i>') + '<span>' + xfEsc(it.label || (it.bg ? 'Cell color' : 'Font color')) + '</span>' + (it.more ? '<b>›</b>' : '') + '</button>').join('');
  document.body.appendChild(s);
  const r = anchor.getBoundingClientRect(), w = s.offsetWidth, h = s.offsetHeight;
  let left = r.right + 2; if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 2);
  let top = r.top; if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  s.style.left = (left + window.scrollX) + 'px'; s.style.top = (top + window.scrollY) + 'px';
  s.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i];
    if (it.more) {   // All Dates in the Period ›
      return xfSub(b, [{ k: 'q1', label: 'Quarter 1' }, { k: 'q2', label: 'Quarter 2' }, { k: 'q3', label: 'Quarter 3' }, { k: 'q4', label: 'Quarter 4' }, null].concat(XF_MONTH.map((m, i2) => ({ k: 'm' + (i2 + 1), label: m }))), pick, (level || 1) + 1);
    }
    pick(it.k);
  });
}
function xfPick(T, ci, type, k, spec, list) {
  const st = T.st;
  const done = s => { st.f[ci] = s; xfClose(); xfApply(T, true); };
  if (k === 'above' || k === 'below') return done({ avg: k, type });
  if (XF_DYN.some(x => x && x[0] === k) || /^(q[1-4]|m\d{1,2})$/.test(k)) return done({ dyn: k, type });
  if (k === 'top') return xfTopDlg(T, ci, spec);
  const c = spec && spec.cond ? spec.cond : null;
  const init = k === 'custom' ? (c || { op1: 'eq' }) : k === 'between' ? { op1: 'ge', join: 'and', op2: 'le' } : { op1: k };
  xfClose();
  xfCustomDlg(T, ci, type, init, list);
}
function xfDlg(title, body, ok) {
  const d = document.createElement('div'); d.className = 'dlg-back xf-dlg';
  d.innerHTML = '<div class="dlg" style="max-width:520px"><div class="dlg-h">' + xfEsc(title) + '</div>' + body + '<div class="dlg-f"><span class="grow"></span><button class="btn" data-c>Cancel</button><button class="btn primary" data-o>OK</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click', e => { if (e.target.closest('[data-c]') || e.target === d) d.remove(); if (e.target.closest('[data-o]')) { if (ok(d) !== false) d.remove(); } });
  d.addEventListener('keydown', e => { if (e.key === 'Escape') d.remove(); if (e.key === 'Enter') { e.preventDefault(); d.querySelector('[data-o]').click(); } });
  const f = d.querySelector('select, input'); if (f) f.focus();
  return d;
}
function xfCustomDlg(T, ci, type, init, list) {
  const col = T.md.cols[ci];
  const ops = type === 'number' ? XF_NUM_OPS : type === 'date' ? XF_DATE_OPS : XF_TEXT_OPS;
  const sel = (n, v) => '<select data-op="' + n + '"><option value=""></option>' + ops.map(o => '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
  const dl = '<datalist id="xfDl">' + list.filter(i => i.k !== '').slice(0, 500).map(i => '<option value="' + xfEsc(type === 'date' ? i.k : i.label) + '">').join('') + '</datalist>';
  const inp = (n, v) => '<input data-v="' + n + '" ' + (type === 'date' ? 'type="date"' : 'list="xfDl"') + ' value="' + xfEsc(v || '') + '">';
  const body = dl + '<div class="xf-cust"><div class="xf-cust-h">Show rows where: <b>' + xfEsc(col.label) + '</b></div>' +
    '<div class="xf-cust-r">' + sel(1, init.op1) + inp(1, init.v1) + '</div>' +
    '<div class="xf-cust-j"><label><input type="radio" name="xfj" value="and"' + (init.join !== 'or' ? ' checked' : '') + '> And</label><label><input type="radio" name="xfj" value="or"' + (init.join === 'or' ? ' checked' : '') + '> Or</label></div>' +
    '<div class="xf-cust-r">' + sel(2, init.op2) + inp(2, init.v2) + '</div></div>';
  xfDlg('Custom AutoFilter', body, d => {
    const g = s => d.querySelector(s).value;
    const c = { op1: g('[data-op="1"]'), v1: g('[data-v="1"]'), op2: g('[data-op="2"]'), v2: g('[data-v="2"]'), join: d.querySelector('input[name=xfj]:checked').value };
    if (!c.op1 && c.op2) { c.op1 = c.op2; c.v1 = c.v2; c.op2 = ''; }
    if (!c.op1) { delete T.st.f[ci]; xfApply(T, true); return; }
    if (!c.op2) { c.op2 = ''; c.v2 = ''; }
    T.st.f[ci] = { cond: c, type }; xfApply(T, true);
  });
}
function xfTopDlg(T, ci, spec) {
  xfClose();
  const t = (spec && spec.top) || { which: 'top', n: 10, unit: 'items' };
  const body = '<div class="xf-cust"><div class="xf-cust-h">Show</div><div class="xf-cust-r"><select data-w><option value="top"' + (t.which === 'top' ? ' selected' : '') + '>Top</option><option value="bottom"' + (t.which === 'bottom' ? ' selected' : '') + '>Bottom</option></select>' +
    '<input data-n type="number" min="1" max="500" value="' + t.n + '" style="width:90px"><select data-u><option value="items"' + (t.unit === 'items' ? ' selected' : '') + '>Items</option><option value="percent"' + (t.unit === 'percent' ? ' selected' : '') + '>Percent</option></select></div></div>';
  xfDlg('Top 10 AutoFilter', body, d => {
    const n = Math.max(1, Math.min(500, parseInt(d.querySelector('[data-n]').value, 10) || 10));
    T.st.f[ci] = { top: { which: d.querySelector('[data-w]').value, n, unit: d.querySelector('[data-u]').value }, type: 'number' }; xfApply(T, true);
  });
}
