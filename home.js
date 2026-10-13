/* Nexus 2.0 — Home score: "My score" card for everyone, and the Super Admin score explorer
   (department / doer / time) with a full summary of any department or person. */
'use strict';

/* ---------- periods and buckets ---------- */
const SX_PERIODS = [{ v: 'tw', l: 'This week' }, { v: 'lw', l: 'Last week' }, { v: 'tm', l: 'This month' }, { v: 'lm', l: 'Last month' }, { v: '3m', l: 'Last 3 months' }, { v: '6m', l: 'Last 6 months' }, { v: 'fy', l: 'This financial year' }, { v: 'cu', l: 'Custom' }];
function sxRange(p) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth(), t = todayYmd();
  const mon = new Date(y, m, d.getDate() - ((d.getDay() + 6) % 7));
  switch (p) {
    case 'tw': return [ymdOf(mon), t];
    case 'lw': return [ymdOf(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7)), ymdOf(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 1))];
    case 'lm': return [ymdOf(new Date(y, m - 1, 1)), ymdOf(new Date(y, m, 0))];
    case '3m': return [ymdOf(new Date(y, m - 2, 1)), t];
    case '6m': return [ymdOf(new Date(y, m - 5, 1)), t];
    case 'fy': return [ymdOf(new Date(m >= 3 ? y : y - 1, 3, 1)), t];
    default: return [ymdOf(new Date(y, m, 1)), t];
  }
}
const ymdAdd = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymdOf(d); };
function sxGran(from, to, g) { if (g && g !== 'auto') return g; const n = daysBetween(from, to); return n <= 14 ? 'day' : n <= 70 ? 'week' : 'month'; }
function sxBuckets(from, to, gran) {
  const out = [];
  if (gran === 'day') { for (let k = from; k <= to; k = ymdAdd(k, 1)) { const d = new Date(k + 'T00:00:00'); out.push({ from: k, to: k, l: d.getDate() + ' ' + MON[d.getMonth()], ll: fmtD(d) }); } return out; }
  if (gran === 'week') {
    const s = new Date(from + 'T00:00:00'); let k = ymdOf(new Date(s.getFullYear(), s.getMonth(), s.getDate() - ((s.getDay() + 6) % 7)));
    for (; k <= to; k = ymdAdd(k, 7)) { const a = k < from ? from : k, b = ymdAdd(k, 6) > to ? to : ymdAdd(k, 6); const d = new Date(a + 'T00:00:00'); out.push({ from: a, to: b, l: d.getDate() + ' ' + MON[d.getMonth()], ll: fmtD(a) + ' – ' + fmtD(b) }); }
    return out;
  }
  const s = new Date(from + 'T00:00:00');
  for (let d = new Date(s.getFullYear(), s.getMonth(), 1); ymdOf(d) <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const a = ymdOf(d) < from ? from : ymdOf(d), e = ymdOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)), b = e > to ? to : e;
    out.push({ from: a, to: b, l: MON[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2), ll: MON[d.getMonth()] + ' ' + d.getFullYear() });
  }
  return out;
}

/* ---------- numbers ---------- */
const SX_UI = { tab: 'today', view: 'dept', per: 'tm', from: '', to: '', dept: '', src: '', gran: 'auto', mx: 'dept', open: null };
function sxRows(from, to) { const src = SX_UI.src; return scoreRows(from, to, src ? allTasks().filter(t => t.src === src) : null); }
const sxDeptOf = r => r.dept || 'No department';
function sxAgg(list) {   // a group of score rows → one row
  const a = { people: list.length, total: 0, completed: 0, onTime: 0, late: 0, overdue: 0, pending: 0, esc1: 0, esc2: 0, score: null };
  list.forEach(r => { ['total', 'completed', 'onTime', 'late', 'overdue', 'pending', 'esc1', 'esc2'].forEach(k => { a[k] += r[k] || 0; }); });
  a.completionPct = a.total ? a.completed * 100 / a.total : 0; a.onTimePct = a.completed ? a.onTime * 100 / a.completed : 0;
  if (list.length) a.score = list.reduce((s, r) => s + r.score, 0) / list.length;
  return a;
}
function sxEsc(doers, from, to) {
  const set = new Set(doers.map(norm)); const f = from + 'T00:00:00', t = to + 'T23:59:59';
  const es = Store.all('escalations').filter(e => set.has(norm(e.doer || '')) && (e.raised_at || e.planned || '') >= f && (e.raised_at || e.planned || '') <= t);
  return { l1: es.length, l2: es.filter(e => e.level === 2).length, open: es.filter(e => e.status === 'Open').length };
}
function sxDeptRows(rows) {
  const m = {}; rows.forEach(r => { (m[sxDeptOf(r)] = m[sxDeptOf(r)] || []).push(r); });
  return Object.entries(m).map(([d, l]) => Object.assign(sxAgg(l), { dept: d, list: l })).sort((a, b) => b.score - a.score);
}
const sxQ = s => s == null ? 0 : Math.max(0, 100 + s);   // score (−100 … 0) → bar length
const sxS = s => s == null ? '—' : s.toFixed(2);
const sxHeat = s => s == null ? '' : s >= -10 ? 'hx-g' : s >= -30 ? 'hx-a' : 'hx-r';
const sxCol = s => s >= -10 ? VZ.good : s >= -30 ? VZ.warn : VZ.crit;
const pct = v => Math.round(v) + '%';

/* ---------- small line chart: score per period (0 at the top) ---------- */
function vzLine(labels, values, opt) {
  opt = opt || {};
  const pts = values.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (!pts.length) return vzEmpty(opt.empty || 'No tasks in this period');
  const W = 560, H = opt.h || 200, L = 44, R = 14, T = 16, B = 28, iw = W - L - R, ih = H - T - B;
  const lo = Math.min(-20, Math.floor(Math.min(...pts.map(p => p.v)) / 20) * 20);
  const step = iw / Math.max(1, labels.length), x = i => L + step * i + step / 2, y = v => T + ih * (v / lo);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = lo * k / 4, yy = y(v); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + VZ.grid + '"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" class="vz-ax">' + Math.round(v) + '</text>'; }
  const every = Math.ceil(labels.length / 12);
  labels.forEach((lb, i) => { if (i % every === 0 || i === labels.length - 1) g += '<text x="' + x(i) + '" y="' + (H - 9) + '" text-anchor="middle" class="vz-ax">' + vzE(lb) + '</text>'; });
  g += '<polyline fill="none" stroke="' + VZ.s1 + '" stroke-width="2.2" stroke-linejoin="round" points="' + pts.map(p => x(p.i) + ',' + y(p.v)).join(' ') + '"/>';
  pts.forEach(p => {
    const tip = '<b>' + vzE((opt.tips || labels)[p.i]) + '</b><br>Score: ' + p.v.toFixed(2) + (opt.sub ? '<br>' + vzE(opt.sub[p.i] || '') : '');
    g += '<g class="vz-hit" data-tip="' + vzE(tip) + '"><rect x="' + (x(p.i) - step / 2) + '" y="' + T + '" width="' + step + '" height="' + ih + '" fill="transparent"/><circle cx="' + x(p.i) + '" cy="' + y(p.v) + '" r="4" fill="#fff" stroke="' + sxCol(p.v) + '" stroke-width="2.5"/></g>';
  });
  const last = pts[pts.length - 1]; g += '<text x="' + x(last.i) + '" y="' + (y(last.v) < T + 14 ? y(last.v) + 18 : y(last.v) - 9) + '" text-anchor="middle" class="vz-lb">' + last.v.toFixed(1) + '</text>';
  return '<svg class="vz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + vzE(opt.aria || 'Score trend') + '">' + g + '</svg>';
}
function sxSpark(vals) {
  const p = vals.map((v, i) => ({ v, i })).filter(x => x.v != null); if (p.length < 2) return '';
  const W = 84, H = 22, lo = Math.min(-20, ...p.map(x => x.v)), x = i => 2 + (W - 4) * i / Math.max(1, vals.length - 1), y = v => 2 + (H - 4) * v / lo;
  return '<svg class="sx-spark" viewBox="0 0 ' + W + ' ' + H + '"><polyline fill="none" stroke="' + VZ.s1 + '" stroke-width="1.6" points="' + p.map(z => x(z.i) + ',' + y(z.v)).join(' ') + '"/><circle cx="' + x(p[p.length - 1].i) + '" cy="' + y(p[p.length - 1].v) + '" r="2.4" fill="' + sxCol(p[p.length - 1].v) + '"/></svg>';
}
// score of every bucket for a doer / department / everyone
function sxTrend(buckets, pick) {
  return buckets.map(b => { const rs = pick(sxRows(b.from, b.to)); return rs.length ? sxAgg(rs) : null; });
}
const sxPickDoer = d => rs => rs.filter(r => norm(r.doer) === norm(d));
const sxPickDept = d => rs => rs.filter(r => sxDeptOf(r) === d);
const sxPickAll = () => rs => rs.filter(r => !SX_UI.dept || sxDeptOf(r) === SX_UI.dept);

/* ---------- "My score" card (everyone's Home) ---------- */
function myScoreCard(who) {
  const to = todayYmd(), from = ymdAdd(to, -55);
  const bk = sxBuckets(from, to, 'week'); const tr = bk.map(b => { const r = scoreRows(b.from, b.to, null, true).find(x => norm(x.doer) === norm(who)); return r ? r.score : null; });
  const sc = scoreOf(who, 30, true); const W = scoreW();
  const bar = (l, v, w) => '<div class="pv-bar"><span>' + l + ' <small class="muted">×' + Math.round(w * 100) + '%</small></span><b>' + pct(v) + '</b><div><i' + (v >= 90 ? ' class="g"' : '') + ' style="width:' + Math.max(0, Math.min(100, v)) + '%"></i></div></div>';
  return '<div class="dcard"><div class="dh3">My score<span class="grow"></span><span class="muted small">last 30 days</span></div><div class="ms-b">' +
    (sc ? '<div class="ms-k"><div><b class="' + scoreCls(sc.score) + '">' + sc.score.toFixed(2) + '</b><i>Score</i></div><div><b>' + sc.completed + '/' + sc.total + '</b><i>Done</i></div><div><b>' + pct(sc.onTimePct) + '</b><i>On time</i></div><div><b class="' + (sc.overdue ? 'late-txt' : '') + '">' + sc.overdue + '</b><i>Overdue</i></div></div>' +
      bar('Completion', sc.completionPct, W.completion) + bar('On time', sc.onTimePct, W.onTime) + bar('Volume', sc.volumePct, W.volume) + bar('Consistency', sc.consistencyPct, W.consistency)
      : '<div class="dl-empty">No tasks in the last 30 days</div>') +
    '<div class="ms-t">' + vzLine(bk.map(b => b.l), tr, { h: 150, tips: bk.map(b => b.ll), empty: 'No weekly score yet' }) + '</div></div></div>';
}

/* ---------- Super Admin: score explorer ---------- */
function sxHtml() {
  if (SX_UI.per !== 'cu' || !SX_UI.from) { const r = sxRange(SX_UI.per); SX_UI.from = r[0]; SX_UI.to = r[1]; }
  const from = SX_UI.from, to = SX_UI.to, gran = sxGran(from, to, SX_UI.gran);
  if (SX_UI.open) return sxDetail(SX_UI.open);
  const all = sxRows(from, to); const rows = all.filter(r => !SX_UI.dept || sxDeptOf(r) === SX_UI.dept);
  const depts = Array.from(new Set(all.map(sxDeptOf).concat(Store.all('users').map(u => u.department).filter(Boolean)))).sort();
  const srcs = Array.from(new Set(allTasks().map(t => t.src))).sort();
  const A = sxAgg(rows); const E = sxEsc(rows.map(r => r.doer), from, to);
  let h = '<div class="toolbar sx-bar">' + seg('sxView', [{ v: 'dept', l: 'Department' }, { v: 'doer', l: 'Doer' }, { v: 'time', l: 'Time' }], SX_UI.view) +
    '<select id="sxPer">' + SX_PERIODS.map(p => '<option value="' + p.v + '"' + (p.v === SX_UI.per ? ' selected' : '') + '>' + p.l + '</option>').join('') + '</select>' +
    (SX_UI.per === 'cu' ? '<input id="sxFrom" type="date" value="' + esc(from) + '"><input id="sxTo" type="date" value="' + esc(to) + '">' : '<span class="muted small">' + fmtD(from) + ' – ' + fmtD(to) + '</span>') +
    '<select id="sxDept">' + selOpts(depts, SX_UI.dept, 'All departments') + '</select><select id="sxSrc">' + selOpts(srcs, SX_UI.src, 'All sources') + '</select>' +
    '<span class="grow"></span>' + sxWhoSel(null) + '<a class="btn sm" href="#/scorecard">Scorecard</a></div>';
  const tile = (l, v, s, c) => '<div class="dt ' + (c || '') + '"><span class="dt-l">' + l + '</span><span class="dt-v">' + v + '</span><span class="dt-s">' + (s || '&nbsp;') + '</span></div>';
  h += '<div class="dtiles sx-tiles">' + tile('Team score', sxS(A.score), A.people + ' people', A.score == null ? '' : A.score >= -10 ? 'dt-good' : A.score >= -30 ? 'dt-warn' : 'dt-crit') +
    tile('Tasks', A.total, A.completed + ' done') + tile('Done', pct(A.completionPct), A.pending + ' pending', A.completionPct >= 90 ? 'dt-good' : '') +
    tile('On time', pct(A.onTimePct), A.onTime + ' on time · ' + A.late + ' late', A.onTimePct >= 90 ? 'dt-good' : A.onTimePct < 70 && A.completed ? 'dt-warn' : '') +
    tile('Overdue', A.overdue, 'not done, past planned', A.overdue ? 'dt-crit' : 'dt-good') + tile('Escalations', E.l1, E.l2 + ' reached Level 2', E.l2 ? 'dt-crit' : '') + '</div>';
  const bk = sxBuckets(from, to, gran);
  if (SX_UI.view === 'dept') h += sxDeptView(rows, bk);
  else if (SX_UI.view === 'doer') h += sxDoerView(rows, bk);
  else h += sxTimeView(rows, bk, gran);
  return h;
}
function sxTable(head, body, cols) {
  return '<div class="tbl-wrap"><table class="nopage sx-t"><tr>' + head.map(x => '<th' + (/^(#|Tasks|Done|On time|Late|Overdue|Pending|Score|L1|L2|People|Done %|On-time %)$/.test(x) ? ' class="num"' : '') + '>' + x + '</th>').join('') + '</tr>' +
    (body.length ? body.join('') : '<tr><td colspan="' + cols + '" class="empty">No tasks in this period</td></tr>') + '</table></div>';
}
function sxScoreCell(s) { return '<td class="num"><span class="sx-sc ' + sxHeat(s) + '">' + sxS(s) + '</span></td>'; }
function sxDeptView(rows, bk) {
  const D = sxDeptRows(rows);
  const tr = new Map(D.map(d => [d.dept, sxTrend(bk, sxPickDept(d.dept)).map(x => x ? x.score : null)]));
  return '<div class="dgrid sx-g"><div class="dcard"><div class="dh3">Score by department</div><div class="dcard-b">' +
    vzBars(D.map(d => ({ label: d.dept, value: sxQ(d.score), color: sxCol(d.score), sub: 'Score ' + sxS(d.score) + ' · ' + d.people + ' people · ' + d.total + ' tasks' })), v => (v - 100).toFixed(1), { empty: 'No tasks in this period' }) + '</div></div>' +
    '<div class="dcard"><div class="dh3">Team score trend</div><div class="dcard-b">' + sxTrendChart(bk, sxPickAll()) + '</div></div></div>' +
    '<div class="dcard"><div class="dh3">Departments<span class="n">' + D.length + '</span></div>' +
    sxTable(['#', 'Department', 'People', 'Tasks', 'Done', 'On time', 'Late', 'Overdue', 'Done %', 'On-time %', 'Score', 'Trend', 'L2'], D.map((d, i) =>
      '<tr class="click" data-act="sx-open" data-t="dept" data-k="' + esc(d.dept) + '"><td class="num muted">' + (i + 1) + '</td><td><b>' + esc(d.dept) + '</b></td><td class="num">' + d.people + '</td><td class="num">' + d.total + '</td><td class="num">' + d.completed + '</td><td class="num">' + d.onTime + '</td><td class="num">' + d.late + '</td><td class="num' + (d.overdue ? ' late-txt' : '') + '">' + d.overdue + '</td>' +
      '<td class="num">' + pct(d.completionPct) + '</td><td class="num">' + pct(d.onTimePct) + '</td>' + sxScoreCell(d.score) + '<td>' + sxSpark(tr.get(d.dept)) + '</td><td class="num' + (d.esc2 ? ' late-txt' : '') + '">' + d.esc2 + '</td></tr>'), 13) + '</div>';
}
function sxDoerView(rows, bk) {
  const tr = new Map(); bk.forEach((b, i) => { sxRows(b.from, b.to).forEach(r => { const k = norm(r.doer); if (!tr.has(k)) tr.set(k, bk.map(() => null)); tr.get(k)[i] = r.score; }); });
  const best = rows.slice(0, 5), worst = rows.slice().reverse().slice(0, 5);
  const bars = l => vzBars(l.map(r => ({ label: r.doer, value: sxQ(r.score), color: sxCol(r.score), sub: 'Score ' + sxS(r.score) + ' · ' + sxDeptOf(r) })), v => (v - 100).toFixed(1), { empty: 'No tasks in this period' });
  return '<div class="dgrid sx-g"><div class="dcard"><div class="dh3">Top 5</div><div class="dcard-b">' + bars(best) + '</div></div><div class="dcard"><div class="dh3">Bottom 5</div><div class="dcard-b">' + bars(worst) + '</div></div></div>' +
    '<div class="dcard"><div class="dh3">Doers<span class="n">' + rows.length + '</span></div>' +
    sxTable(['#', 'Doer', 'Department', 'Tasks', 'Done', 'On time', 'Late', 'Overdue', 'Done %', 'On-time %', 'Score', 'Trend', 'L1', 'L2'], rows.map((r, i) =>
      '<tr class="click" data-act="sx-open" data-t="doer" data-k="' + esc(r.doer) + '"><td class="num muted">' + (i + 1) + '</td><td><b>' + esc(r.doer) + '</b></td><td>' + esc(sxDeptOf(r)) + '</td><td class="num">' + r.total + '</td><td class="num">' + r.completed + '</td><td class="num">' + r.onTime + '</td><td class="num">' + r.late + '</td><td class="num' + (r.overdue ? ' late-txt' : '') + '">' + r.overdue + '</td>' +
      '<td class="num">' + pct(r.completionPct) + '</td><td class="num">' + pct(r.onTimePct) + '</td>' + sxScoreCell(r.score) + '<td>' + sxSpark(tr.get(norm(r.doer)) || []) + '</td><td class="num">' + r.esc1 + '</td><td class="num' + (r.esc2 ? ' late-txt' : '') + '">' + r.esc2 + '</td></tr>'), 14) + '</div>';
}
function sxTrendChart(bk, pick, h) {
  const t = sxTrend(bk, pick);
  return vzLine(bk.map(b => b.l), t.map(x => x ? x.score : null), { h, tips: bk.map(b => b.ll), sub: t.map(x => x ? x.completed + '/' + x.total + ' done · ' + pct(x.onTimePct) + ' on time' : '') });
}
function sxTimeView(rows, bk, gran) {
  const per = bk.map(b => ({ b, rows: sxPickAll()(sxRows(b.from, b.to)) }));
  const ag = per.map(p => p.rows.length ? sxAgg(p.rows) : null);
  let h = '<div class="toolbar">' + seg('sxGran', [{ v: 'auto', l: 'Auto' }, { v: 'day', l: 'Day' }, { v: 'week', l: 'Week' }, { v: 'month', l: 'Month' }], SX_UI.gran) +
    '<span class="grow"></span>' + seg('sxMx', [{ v: 'dept', l: 'By department' }, { v: 'doer', l: 'By doer' }], SX_UI.mx) + '</div>';
  h += '<div class="dgrid sx-g"><div class="dcard"><div class="dh3">Score trend · ' + gran + '</div><div class="dcard-b">' + vzLine(bk.map(b => b.l), ag.map(x => x ? x.score : null), { tips: bk.map(b => b.ll), sub: ag.map(x => x ? x.completed + '/' + x.total + ' done · ' + pct(x.onTimePct) + ' on time' : '') }) + '</div></div>' +
    '<div class="dcard"><div class="dh3">Tasks · ' + gran + '</div><div class="dcard-b">' + vzColumns(bk.map(b => b.l), [{ name: 'On time', color: VZ.good, values: ag.map(x => x ? x.onTime : 0) }, { name: 'Late', color: VZ.warn, values: ag.map(x => x ? x.late : 0) }, { name: 'Overdue', color: VZ.crit, values: ag.map(x => x ? x.overdue : 0) }], v => String(Math.round(v)), { int: true, empty: 'No tasks in this period' }) + '</div></div></div>';
  // heat map: rows = department or doer, columns = periods
  const keys = SX_UI.mx === 'doer' ? rows.map(r => r.doer) : sxDeptRows(rows).map(d => d.dept);
  const cell = (p, k) => { const l = SX_UI.mx === 'doer' ? p.rows.filter(r => norm(r.doer) === norm(k)) : p.rows.filter(r => sxDeptOf(r) === k); return l.length ? sxAgg(l) : null; };
  const t = SX_UI.mx === 'doer' ? 'doer' : 'dept';
  h += '<div class="dcard"><div class="dh3">' + (t === 'doer' ? 'Doer' : 'Department') + ' × ' + gran + '</div><div class="tbl-wrap"><table class="nopage sx-hm"><tr><th>' + (t === 'doer' ? 'Doer' : 'Department') + '</th>' + bk.map(b => '<th class="num" title="' + esc(b.ll) + '">' + esc(b.l) + '</th>').join('') + '<th class="num">Period</th></tr>' +
    (keys.length ? keys.map(k => { const tot = t === 'doer' ? rows.find(r => norm(r.doer) === norm(k)) : sxDeptRows(rows).find(d => d.dept === k);
      return '<tr><td class="click" data-act="sx-open" data-t="' + t + '" data-k="' + esc(k) + '"><b>' + esc(k) + '</b></td>' + per.map(p => { const c = cell(p, k);
        return c ? '<td class="num click ' + sxHeat(c.score) + '" data-act="sx-open" data-t="' + t + '" data-k="' + esc(k) + '" data-f="' + p.b.from + '" data-to="' + p.b.to + '" title="' + esc(p.b.ll + ' · ' + c.completed + '/' + c.total + ' done · ' + pct(c.onTimePct) + ' on time') + '">' + sxS(c.score) + '</td>' : '<td class="num hx-n">·</td>'; }).join('') + sxScoreCell(tot ? tot.score : null) + '</tr>'; }).join('')
      : '<tr><td colspan="' + (bk.length + 2) + '" class="empty">No tasks in this period</td></tr>') + '</table></div></div>';
  return h;
}

/* ---------- detailed summary page of one person or one department ---------- */
function sxWhoSel(o) {
  const doers = Array.from(new Set(allDoers().concat(allTasks().filter(t => t.doer && t.doer !== 'SYSTEM' && !t.demo).map(t => t.doer.toUpperCase())))).sort(); const depts = Array.from(new Set(Store.all('users').map(u => u.department).filter(Boolean))).sort();
  const cur = o ? o.t + '|' + o.k : '';
  return '<select id="sxWho" class="sx-who"><option value="">Summary of…</option><optgroup label="Doer">' + doers.map(d => { const u = userOfDoer(d); return '<option value="doer|' + esc(d) + '"' + (cur === 'doer|' + d ? ' selected' : '') + '>' + esc(d) + (u && u.name && norm(u.name) !== norm(d) ? ' · ' + esc(u.name) : '') + '</option>'; }).join('') + '</optgroup>' +
    '<optgroup label="Department">' + depts.concat(['No department']).map(d => '<option value="dept|' + esc(d) + '"' + (cur === 'dept|' + d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</optgroup></select>';
}
function sxDetail(o) {
  const from = o.from || SX_UI.from, to = o.to || SX_UI.to, gran = sxGran(from, to, SX_UI.gran), bk = sxBuckets(from, to, gran);
  const allR = sxRows(from, to); const isD = o.t === 'dept';
  const inMe = r => isD ? sxDeptOf(r) === o.k : norm(r.doer) === norm(o.k);
  const mine = allR.filter(inMe);
  const A = sxAgg(mine); const R = mine[0];
  const scored = [].concat(...mine.map(r => r.tasks));
  const f = new Date(from + 'T00:00:00'), tt = new Date(to + 'T23:59:59');
  const doerSet = new Set(isD ? Store.all('users').filter(u => u.doer && (u.department || 'No department') === o.k).map(u => norm(u.doer)).concat(mine.map(r => norm(r.doer))) : [norm(o.k)]);
  const list = allTasks().filter(t => doerSet.has(norm(t.doer || '')) && (!SX_UI.src || t.src === SX_UI.src) && !t.demo && t.planned && t.planned >= f && t.planned <= tt).sort((a, b) => b.planned - a.planned);
  const escs = Store.all('escalations').filter(e => doerSet.has(norm(e.doer || '')) && (e.raised_at || e.planned || '') >= from + 'T00:00:00' && (e.raised_at || e.planned || '') <= to + 'T23:59:59').sort((a, b) => (b.raised_at || '') < (a.raised_at || '') ? -1 : 1);
  const u = !isD && userOfDoer(o.k); const role = u && Store.get('roles', u.role_id);
  const dRows = sxDeptRows(allR);
  const rank = isD ? dRows.findIndex(d => d.dept === o.k) + 1 : allR.findIndex(r => norm(r.doer) === norm(o.k)) + 1, of = isD ? dRows.length : allR.length;
  const dept = isD ? o.k : R ? sxDeptOf(R) : (deptOfDoer(o.k) || 'No department');
  const inDept = isD ? [] : allR.filter(r => sxDeptOf(r) === dept); const dRank = inDept.findIndex(r => norm(r.doer) === norm(o.k)) + 1;
  const ringC = A.score == null ? 'var(--line)' : sxCol(A.score);
  const kpi = (l, v, c, s2) => '<div class="sxk"><b class="' + (c || '') + '">' + v + '</b><i>' + l + '</i>' + (s2 ? '<span>' + s2 + '</span>' : '') + '</div>';
  // toolbar
  let h = '<div class="toolbar sx-bar"><button class="btn sm" data-act="sx-close">← Back</button>' + sxWhoSel(o) +
    '<select id="sxPer">' + SX_PERIODS.map(p => '<option value="' + p.v + '"' + (p.v === SX_UI.per && !o.from ? ' selected' : '') + '>' + p.l + '</option>').join('') + (o.from ? '<option selected>' + fmtD(from) + ' – ' + fmtD(to) + '</option>' : '') + '</select>' +
    (SX_UI.per === 'cu' && !o.from ? '<input id="sxFrom" type="date" value="' + esc(from) + '"><input id="sxTo" type="date" value="' + esc(to) + '">' : '<span class="muted small">' + fmtD(from) + ' – ' + fmtD(to) + '</span>') +
    '<select id="sxSrc">' + selOpts(Array.from(new Set(allTasks().map(t => t.src))).sort(), SX_UI.src, 'All sources') + '</select><span class="grow"></span>' +
    (isD ? '' : '<button class="btn sm" data-act="ht-who" data-d="' + esc(o.k) + '">Home</button>') + '</div>';
  // profile + numbers
  h += '<div class="sxp"><div class="sxp-id"><div class="ring" style="background:conic-gradient(' + ringC + ' ' + sxQ(A.score) + '%, var(--line2) 0)"><b>' + sxS(A.score) + '</b></div><div><div class="sxp-n">' + esc(o.k) + '</div>' +
    '<div class="sxp-m">' + (isD ? A.people + ' people with tasks · ' + doerSet.size + ' people' : esc([u && u.name, dept, u && u.designation, role && role.name].filter(Boolean).join(' · '))) + '</div>' +
    '<div class="sxp-m">' + (rank ? 'Rank <b>' + rank + '</b> of ' + of + (isD ? ' departments' : ' in company') : 'No scored tasks') + (dRank ? ' · Rank <b>' + dRank + '</b> of ' + inDept.length + ' in ' + esc(dept) : '') + '</div></div></div>' +
    '<div class="sxp-k">' + kpi('Tasks', A.total) + kpi('Done', A.completed, '', pct(A.completionPct)) + kpi('On time', A.onTime, A.onTimePct >= 90 ? 'done-txt' : '', pct(A.onTimePct)) + kpi('Done late', A.late, A.late ? 'pend-txt' : '') +
    kpi('Overdue', A.overdue, A.overdue ? 'late-txt' : '') + kpi('Pending', A.pending) + kpi('Escalations', escs.length, escs.length ? 'pend-txt' : '', 'Level 2: ' + escs.filter(e => e.level === 2).length) + '</div></div>';
  // breakdown / people · trends
  let c1;
  if (isD) c1 = '<div class="dcard"><div class="dh3">People<span class="n">' + mine.length + '</span></div><div class="tbl-wrap"><table class="nopage nofilter"><tr><th>Doer</th><th class="num">Tasks</th><th class="num">Done %</th><th class="num">On-time %</th><th class="num">Overdue</th><th class="num">Score</th></tr>' +
    (mine.length ? mine.map(r => '<tr class="click" data-act="sx-open" data-t="doer" data-k="' + esc(r.doer) + '"><td><b>' + esc(r.doer) + '</b></td><td class="num">' + r.total + '</td><td class="num">' + pct(r.completionPct) + '</td><td class="num">' + pct(r.onTimePct) + '</td><td class="num' + (r.overdue ? ' late-txt' : '') + '">' + r.overdue + '</td>' + sxScoreCell(r.score) + '</tr>').join('') : '<tr><td colspan="6" class="empty">No tasks</td></tr>') + '</table></div></div>';
  else { const W = scoreW(); const bar = (l, v, w, hint) => '<div class="pv-bar"><span>' + l + ' <small class="muted">×' + Math.round(w * 100) + '% · ' + hint + '</small></span><b>' + pct(v) + '</b><div><i' + (v >= 90 ? ' class="g"' : '') + ' style="width:' + Math.max(0, Math.min(100, v)) + '%"></i></div></div>';
    c1 = '<div class="dcard"><div class="dh3">Score breakdown</div><div class="ms-b">' + (R ? bar('Completion', R.completionPct, W.completion, R.completed + ' of ' + R.total + ' done') + bar('On time', R.onTimePct, W.onTime, R.onTime + ' of ' + R.completed + ' on time') + bar('Volume', R.volumePct, W.volume, R.total + ' tasks vs highest') + bar('Consistency', R.consistencyPct, W.consistency, 'month to month') +
      '<div class="small muted">Score = ' + sxS(R.score) + ' (0 is best)</div>' : '<div class="dl-empty">No scored tasks</div>') + '</div></div>'; }
  const tr = sxTrend(bk, isD ? sxPickDept(o.k) : sxPickDoer(o.k));
  h += '<div class="sxp-g3">' + c1 +
    '<div class="dcard"><div class="dh3">Score · ' + gran + '</div><div class="dcard-b">' + vzLine(bk.map(b => b.l), tr.map(x => x ? x.score : null), { h: 210, tips: bk.map(b => b.ll), sub: tr.map(x => x ? x.completed + '/' + x.total + ' done · ' + pct(x.onTimePct) + ' on time' : '') }) + '</div></div>' +
    '<div class="dcard"><div class="dh3">Tasks · ' + gran + '</div><div class="dcard-b">' + vzColumns(bk.map(b => b.l), [{ name: 'On time', color: VZ.good, values: tr.map(x => x ? x.onTime : 0) }, { name: 'Late', color: VZ.warn, values: tr.map(x => x ? x.late : 0) }, { name: 'Overdue', color: VZ.crit, values: tr.map(x => x ? x.overdue : 0) }], v => String(Math.round(v)), { int: true, empty: 'No tasks' }) + '</div></div></div>';
  // by source · by process
  const grp = key => { const m = {}; scored.forEach(t => { const k = key(t); const x = m[k] || (m[k] = { k, n: 0, d: 0, ok: 0, late: 0, od: 0, sum: 0 }); x.n++; if (t.done) { x.d++; t.late ? x.late++ : x.ok++; } else if (t.late) x.od++; if (t.late) x.sum += t.delay; }); return Object.values(m).sort((a, b) => b.n - a.n); };
  const gTbl = (title, head, rows) => '<div class="dcard"><div class="dh3">' + title + '<span class="n">' + rows.length + '</span></div><div class="tbl-wrap"><table class="nopage"><tr><th>' + head + '</th><th class="num">Tasks</th><th class="num">Done</th><th class="num">On time</th><th class="num">Late</th><th class="num">Overdue</th><th class="num">On-time %</th><th class="num">Avg delay</th></tr>' +
    (rows.length ? rows.map(x => '<tr><td><b>' + esc(x.k) + '</b></td><td class="num">' + x.n + '</td><td class="num">' + x.d + '</td><td class="num">' + x.ok + '</td><td class="num' + (x.late ? ' pend-txt' : '') + '">' + x.late + '</td><td class="num' + (x.od ? ' late-txt' : '') + '">' + x.od + '</td><td class="num">' + (x.d ? pct(x.ok * 100 / x.d) : '') + '</td><td class="num">' + (x.late + x.od ? fmtDelay(Math.round(x.sum / (x.late + x.od))) : '') + '</td></tr>').join('') : '<tr><td colspan="8" class="empty">No tasks</td></tr>') + '</table></div></div>';
  h += '<div class="sxp-g2">' + gTbl('By source', 'Source', grp(t => t.src)) + gTbl('By process', 'Process', grp(t => t.task)) + '</div>';
  // every task in the period
  const escBy = new Map(Store.all('escalations').map(e => [e.key, e]));
  const stc = x => x.status === 'Done on time' ? 'Done' : x.status === 'Done late' ? 'Pending' : x.status === 'Delayed' ? 'Late' : x.status === 'Pending' ? 'Pending' : 'Waiting';
  const od = list.filter(t => !t.done && t.late).length;
  h += '<div class="dcard"><div class="dh3">All tasks<span class="n">' + list.length + '</span>' + (od ? '<span class="n red">' + od + ' overdue</span>' : '') + '</div><div class="tbl-wrap"><table><tr><th>Source</th><th>Task</th><th>Reference</th><th>Party</th>' + (isD ? '<th>Doer</th>' : '') + '<th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th>Escalation</th><th></th></tr>' +
    (list.length ? list.map(x => { const e = escBy.get(x.key); return '<tr><td>' + esc(x.src) + '</td><td>' + esc(x.task) + '</td><td><b>' + esc(x.ref || '') + '</b></td><td>' + esc(x.party || '') + '</td>' + (isD ? '<td>' + esc(x.doer) + '</td>' : '') +
      '<td class="nowrap">' + fmtDT(x.planned) + '</td><td class="nowrap">' + (x.actual ? fmtDT(x.actual) : '') + '</td><td><span class="st ' + stc(x) + '">' + x.status + '</span></td><td class="num' + (x.delay ? ' late-txt' : '') + '">' + (x.delay ? fmtDelay(x.delay) : '') + '</td>' +
      '<td>' + (e ? esc(e.no) + ' · L' + e.level : '') + '</td><td><a href="' + esc(x.link) + '">Open</a></td></tr>'; }).join('') : '<tr><td colspan="11" class="empty">No tasks in this period</td></tr>') + '</table></div></div>';
  // escalations
  h += '<div class="dcard"><div class="dh3">Escalations<span class="n' + (escs.length ? ' red' : '') + '">' + escs.length + '</span></div><div class="tbl-wrap"><table><tr><th>Ticket</th><th>Raised</th><th>Task</th><th>Reference</th>' + (isD ? '<th>Doer</th>' : '') + '<th>Planned</th><th>Level</th><th>New date</th><th>Reason</th><th>Status</th><th>Result</th></tr>' +
    (escs.length ? escs.map(e => '<tr><td><b>' + esc(e.no) + '</b></td><td class="nowrap">' + fmtDT(e.raised_at) + '</td><td>' + esc(e.task) + '</td><td>' + esc(e.ref || '') + '</td>' + (isD ? '<td>' + esc(e.doer) + '</td>' : '') + '<td class="nowrap">' + fmtDT(e.planned) + '</td><td><span class="st ' + (e.status !== 'Open' ? 'Done' : e.level === 2 ? 'Late' : 'Pending') + '">L' + e.level + '</span></td>' +
      '<td class="nowrap">' + (e.commit_at ? fmtDT(e.commit_at) : '') + '</td><td>' + esc(e.commit_why || '') + '</td><td>' + esc(e.status) + '</td><td>' + esc(e.resolution || e.result || '') + '</td></tr>').join('') : '<tr><td colspan="11" class="empty">No escalations</td></tr>') + '</table></div></div>';
  return h;
}
ACTIONS['sx-open'] = el => {
  if (!isSuperAdmin()) return;
  SX_UI.open = { t: el.dataset.t, k: el.dataset.k, from: el.dataset.f || '', to: el.dataset.to || '' }; SX_UI.tab = 'score'; HT_UI.who = ME.doer || '';
  audit('home.score_view', (el.dataset.t === 'dept' ? 'Department ' : 'Doer ') + el.dataset.k, (el.dataset.f || SX_UI.from) + ' – ' + (el.dataset.to || SX_UI.to));
  if (curView().v !== 'home') go('home'); else VIEWS.home.render(); window.scrollTo(0, 0);
};
ACTIONS['sx-close'] = () => { SX_UI.open = null; VIEWS.home.render(); window.scrollTo(0, 0); };
ACTIONS['sx-tasks'] = el => { Object.assign(AT_UI, { who: el.dataset.d || '', dept: el.dataset.dept || '', st: el.dataset.dept != null ? 'delayed' : 'all', from: el.dataset.f, to: el.dataset.to, tab: 'tasks' }); go('alltasks'); };
ACTIONS['sx-tab'] = el => { SX_UI.tab = el.dataset.v; VIEWS.home.render(); };
function sxBind() {
  $('#main').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'sxWho') { const v = e.target.value; if (!v) return; const k = v.indexOf('|'); ACTIONS['sx-open']({ dataset: { t: v.slice(0, k), k: v.slice(k + 1) } }); return; }
    if (id === 'sxPer') { if (!SX_PERIODS.some(p => p.v === e.target.value)) return; SX_UI.per = e.target.value; if (SX_UI.per !== 'cu') SX_UI.from = ''; if (SX_UI.open) { SX_UI.open.from = ''; SX_UI.open.to = ''; } }
    else if (id === 'sxFrom' || id === 'sxTo') { if (SX_UI.open) { SX_UI.open.from = ''; SX_UI.open.to = ''; } const v = e.target.value; if (!v) return; SX_UI[id === 'sxFrom' ? 'from' : 'to'] = v; if (SX_UI.from > SX_UI.to) { const t = SX_UI.from; SX_UI.from = SX_UI.to; SX_UI.to = t; } }
    else if (id === 'sxDept') SX_UI.dept = e.target.value;
    else if (id === 'sxSrc') SX_UI.src = e.target.value;
    else return;
    VIEWS.home.render();
  });
}
