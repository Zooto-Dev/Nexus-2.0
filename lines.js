/* Nexus 2.0 — Line Plan: what each production line runs, day by day.
   Four tabs, in the order the floor works:
     Plan      — the week on a board: one row per line, one column per day; a card per job card planned there.
     Daily     — at the end of the day, how much of each planned card was actually made, and anything else that ran.
     Summary   — per line, for the week or month: planned, made as planned, made instead, short, adherence.
     Tracker   — per job card: how much every line has done and what is still left.
   Lines come from Settings › Production Lines. Everything is a flat row: line_plans (one job card on one line on
   one day) and line_actuals (what was made against that plan, or without a plan). */
'use strict';

const LP_UI = { tab: 'plan', week: '', line: '', day: '', q: '', range: 'week', month: '' };
const LP_DEFAULT_LINES = ['CUTTING', 'CLOSING', 'EVA', 'SLIDER', 'SHOES', 'PACKING'];   // PACKING is the last stage: an order closes there
const LP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- dates ---------- */
function lpYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function lpAdd(ymd, n) { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return lpYmd(d); }
function lpMonday(ymd) { const d = new Date((ymd || todayYmd()) + 'T00:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return lpYmd(d); }
function lpWeekDays(mon) { return LP_DAYS.map((_, i) => lpAdd(mon, i)); }
function lpDayLabel(ymd) { const d = new Date(ymd + 'T00:00:00'); return LP_DAYS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
function lpWeekLabel(mon) { const a = new Date(mon + 'T00:00:00'), b = new Date(lpAdd(mon, 6) + 'T00:00:00'); return a.getDate() + ' ' + MON[a.getMonth()] + ' – ' + b.getDate() + ' ' + MON[b.getMonth()] + ' ' + b.getFullYear(); }

/* ---------- lines, plans, actuals ---------- */
function lpLines() {
  const rows = Store.all('prod_lines').filter(l => l.active !== false).sort((a, b) => num(a.seq) - num(b.seq) || String(a.name).localeCompare(String(b.name)));
  return rows.length ? rows.map(l => String(l.name).toUpperCase()) : LP_DEFAULT_LINES.slice();
}
const lpPlans = () => Store.all('line_plans').filter(p => !p.cancelled);
const lpActs = () => Store.all('line_actuals');
// what is already spoken for on a line: plans (less the pairs moved out of them) plus anything that ran without a plan
function lpPlannedOn(jc, line) { return lpPlans().filter(p => norm(p.jc_no) === norm(jc) && p.line === line).reduce((a, p) => a + num(p.qty) - num(p.carried_qty), 0) + lpActs().filter(a => a.sub && norm(a.jc_no) === norm(jc) && a.line === line).reduce((s, a) => s + num(a.qty) + num(a.rej), 0); }
// the pairs of a plan that did not run and were not yet moved to another day
function lpShortOf(p) { const a = lpActForPlan(p); return a ? Math.max(0, num(p.qty) - num(a.qty) - num(a.rej) - num(p.carried_qty)) : 0; }
function lpRejOn(jc, line) { return lpActs().filter(a => norm(a.jc_no) === norm(jc) && a.line === line).reduce((s, a) => s + num(a.rej), 0); }
// the last stage: the line ticked "Last stage" in Settings, else the last line in order
function lpFinalLine() { const f = Store.all('prod_lines').find(l => l.active !== false && l.final); return f ? String(f.name).toUpperCase() : lpLines().slice(-1)[0]; }
/* One job card's journey through the lines, in line order:
   the first line it touched starts with the order quantity; every later line starts with the good pairs the
   line before it made. On each line: In, Good, Rejected, Left (= In − Good − Rejected).
   Pending to close = order qty − good at the last stage − every rejection anywhere. Zero = the order is closed. */
function lpFlow(j) {
  const lines = lpLines(); const fin = lpFinalLine();
  const touched = lines.filter(l => lpDoneOn(j.no, l) > 0 || lpRejOn(j.no, l) > 0 || lpPlannedOn(j.no, l) > 0);
  let feed = num(j.qty); const stages = [];
  touched.forEach(l => { const good = lpDoneOn(j.no, l), rej = lpRejOn(j.no, l); stages.push({ line: l, inQty: feed, good, rej, left: Math.max(0, feed - good - rej) }); feed = good; });
  const totalRej = stages.reduce((a, x) => a + x.rej, 0);
  const finStage = stages.find(x => x.line === fin); const packed = finStage ? finStage.good : 0;
  const pending = Math.max(0, num(j.qty) - packed - totalRej);
  const acts = lpActs().filter(a => norm(a.jc_no) === norm(j.no)).sort((a, b) => a.date < b.date ? -1 : 1);
  const closed = !!finStage && pending <= 0 && stages.every(x => x.left <= 0);
  return { stages, totalRej, packed, pending, closed, fin, first: acts.length ? acts[0].date : '', last: acts.length ? acts[acts.length - 1].date : '', current: stages.filter(x => x.good > 0 || x.rej > 0).slice(-1)[0] || null };
}
function lpDoneOn(jc, line) { return lpActs().filter(a => norm(a.jc_no) === norm(jc) && a.line === line).reduce((s, a) => s + num(a.qty), 0); }
function lpDoneForPlan(plan) { return lpActs().filter(a => a.plan_id === plan.id && !a.sub).reduce((s, a) => s + num(a.qty), 0); }
function lpActForPlan(plan) { return lpActs().find(a => a.plan_id === plan.id && !a.sub) || null; }
// job cards a line can still take: open, with order qty not yet fully planned on that line
function lpOpenJcs() { return Store.all('job_cards').filter(j => j.status !== 'Closed').sort((a, b) => String(b.no).localeCompare(String(a.no))); }
function lpJcLabel(j) { return j.no + ' · ' + (j.brand || '') + ' · ' + (j.article || '') + (j.colour ? ' ' + j.colour : '') + ' · ' + qtyFmt(j.qty); }
function lpMerchant(j) { const o = Store.all('orders').find(x => norm(x.no) === norm(j.order_no)); const c = Store.all('customers').find(x => norm(x.name) === norm(j.brand || (o || {}).customer_name)); return (c || {}).merchandiser || ''; }
function lpDispatch(j) { const p = typeof planOf === 'function' ? planOf(j.no) : null; return p ? p.dispatch_date : ''; }

/* ---------- small dialog ---------- */
function lpDialog(title, body, okLabel, onOk, extraBtn) {
  const old = $('#lpDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'lpDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg" style="width:min(640px,94vw)"><div class="dlg-h">' + esc(title) + '</div>' + body +
    '<div class="dlg-f"><span id="lpMsg" class="small late-txt"></span><span class="grow"></span>' + (extraBtn || '') + '<button class="btn" data-lp-cancel>Cancel</button><button class="btn primary" data-lp-ok>' + esc(okLabel) + '</button></div></div>';
  document.body.appendChild(d); const f = $('select, input', d); if (f) f.focus();
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') d.remove(); });
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-lp-cancel]')) { d.remove(); return; }
    if (!ev.target.closest('[data-lp-ok]')) return;
    const err = onOk(d); if (err) { $('#lpMsg', d).textContent = err; return; }
    d.remove();
  });
  return d;
}

/* ---------- Plan: add / edit one card ---------- */
function lpPlanDialog(plan, pre) {
  const edit = !!plan; const P = plan || Object.assign({ line: lpLines()[0], date: todayYmd(), qty: '', note: '', kit: '' }, pre || {});
  const jcs = lpOpenJcs();
  const left = j => Math.max(0, num(j.qty) - lpPlannedOn(j.no, P.line) + (edit && norm(plan.jc_no) === norm(j.no) ? num(plan.qty) : 0));
  const jcOpts = jcs.map(j => '<option value="' + esc(j.no) + '"' + (norm(j.no) === norm(P.jc_no) ? ' selected' : '') + '>' + esc(lpJcLabel(j)) + (left(j) < num(j.qty) ? ' · left ' + qtyFmt(left(j)) : '') + '</option>').join('');
  const body = '<table class="jckv">' +
    '<tr><td class="k">Line</td><td class="v"><select id="lpLine">' + lpLines().map(l => '<option' + (l === P.line ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Date</td><td class="v"><input id="lpDate" type="date" value="' + esc(P.date) + '"></td></tr>' +
    '<tr><td class="k">Job Card</td><td class="v"><select id="lpJc"><option value="">Pick the job card…</option>' + jcOpts + '</select></td></tr>' +
    '<tr><td class="k">Quantity (pairs)</td><td class="v"><input id="lpQty" type="number" min="1" step="1" value="' + esc(P.qty || '') + '" style="width:140px"> <span id="lpLeft" class="small muted"></span></td></tr>' +
    '<tr><td class="k">Material</td><td class="v"><select id="lpKit"><option value=""' + (!P.kit ? ' selected' : '') + '>Not checked</option><option' + (P.kit === 'Ready' ? ' selected' : '') + '>Ready</option><option' + (P.kit === 'Short' ? ' selected' : '') + '>Short</option></select></td></tr>' +
    '<tr><td class="k">Note</td><td class="v"><input id="lpNote" value="' + esc(P.note || '') + '" placeholder="anything the line should know"></td></tr></table>';
  const d = lpDialog(edit ? 'Change plan ' + (plan.no || '') : 'Plan a job card', body, edit ? 'Save' : 'Add to plan', dd => {
    const line = $('#lpLine', dd).value, date = $('#lpDate', dd).value, jc = $('#lpJc', dd).value, qty = num($('#lpQty', dd).value);
    if (!date) return 'Pick the date.'; if (!jc) return 'Pick the job card.'; if (!(qty > 0)) return 'Type the quantity.';
    const j = jcBy(jc); if (!j) return 'Job card not found.';
    const lf = Math.max(0, num(j.qty) - lpPlannedOn(j.no, line) + (edit && plan.line === line && norm(plan.jc_no) === norm(jc) ? num(plan.qty) : 0));
    if (qty > lf + 1e-9) return 'Only ' + qtyFmt(lf) + ' of ' + jc + ' is left to plan on ' + line + '.';
    if (edit && qty < num(plan.carried_qty) + lpDoneForPlan(plan) - 1e-9) return 'At least ' + qtyFmt(num(plan.carried_qty) + lpDoneForPlan(plan)) + ' — that much already ran or was moved.';
    const rec = edit ? plan : { id: uid(), no: nextNo('line_plans', 'PL'), by: ME.name, at: nowIso() };
    const was = edit ? plan.line + ' ' + fmtD(plan.date) + ' ' + plan.jc_no + ' × ' + qtyFmt(plan.qty) : '';
    Object.assign(rec, { line, date, week: lpMonday(date), jc_no: j.no, brand: j.brand || '', article: j.article || '', colour: j.colour || '', qty, kit: $('#lpKit', dd).value, note: $('#lpNote', dd).value.trim() });
    Store.put('line_plans', rec);
    audit(edit ? 'line_plan.edit' : 'line_plan.add', rec.no, line + ' · ' + fmtD(date) + ' · ' + j.no + ' × ' + qtyFmt(qty) + (was ? ' (was ' + was + ')' : ''));
    flash(edit ? 'Plan changed.' : j.no + ' planned on ' + line + ' for ' + fmtD(date) + '.');
    LP_UI.week = lpMonday(date); VIEWS.lineplan.render(); return '';
  }, edit ? '<button class="btn ghost danger" data-act="lp-del" data-id="' + esc(plan.id) + '" data-confirm="Remove from plan?">Remove</button>' : '');
  const paintLeft = () => { const j = jcBy($('#lpJc', d).value); const line = $('#lpLine', d).value; if (!j) { $('#lpLeft', d).textContent = ''; return; } const lf = Math.max(0, num(j.qty) - lpPlannedOn(j.no, line) + (edit && plan.line === line && norm(plan.jc_no) === norm(j.no) ? num(plan.qty) : 0)); $('#lpLeft', d).textContent = 'order ' + qtyFmt(j.qty) + ' · left to plan on ' + line + ': ' + qtyFmt(lf); if (!$('#lpQty', d).value) $('#lpQty', d).value = lf || ''; };
  $('#lpJc', d).addEventListener('change', () => { $('#lpQty', d).value = ''; paintLeft(); }); $('#lpLine', d).addEventListener('change', paintLeft); paintLeft();
}
ACTIONS['lp-add'] = el => { if (!requirePerm('production', 'edit')) return; lpPlanDialog(null, { line: el.dataset.line || lpLines()[0], date: el.dataset.date || todayYmd() }); };
ACTIONS['lp-open'] = el => { const p = Store.get('line_plans', el.dataset.id); if (!p) return; if (!can('production', 'edit')) { flash(p.jc_no + ' · ' + qtyFmt(p.qty) + ' on ' + p.line + ', ' + fmtD(p.date) + (p.note ? ' — ' + p.note : '')); return; } lpPlanDialog(p); };
ACTIONS['lp-del'] = el => {
  const p = Store.get('line_plans', el.dataset.id); if (!p || !requirePerm('production', 'edit')) return;
  if (lpDoneForPlan(p) > 0) { flash('Production is already entered against this plan — change the quantity instead.', 'err'); return; }
  p.cancelled = true; p.cancelled_by = ME.name; p.cancelled_at = nowIso(); Store.put('line_plans', p);
  audit('line_plan.remove', p.no, p.line + ' · ' + fmtD(p.date) + ' · ' + p.jc_no + ' × ' + qtyFmt(p.qty));
  const d = $('#lpDlg'); if (d) d.remove(); flash('Removed from plan.'); VIEWS.lineplan.render();
};

/* ---------- the four tabs ---------- */
function lpChip(p) {
  const done = lpDoneForPlan(p); const past = p.date < todayYmd();
  const left = num(p.qty) - num(p.carried_qty);   // the pairs this card still stands for after any move
  const st = num(p.carried_qty) && done + num(p.carried_qty) >= num(p.qty) - 1e-9 ? 'moved' : done >= left - 1e-9 && left > 0 ? 'done' : done > 0 ? 'part' : past ? 'miss' : p.kit === 'Short' ? 'short' : '';
  return '<a class="lp-chip ' + st + '" data-act="lp-open" data-id="' + esc(p.id) + '" title="' + esc(p.jc_no + ' · ' + (p.brand || '') + ' · ' + (p.article || '') + ' ' + (p.colour || '') + (p.note ? ' — ' + p.note : '')) + '">' +
    '<b>' + esc(p.jc_no) + '</b><span class="lp-art">' + esc((p.article || '') + (p.colour ? ' · ' + p.colour : '')) + '</span><span class="lp-q">' + (done ? qtyFmt(done) + ' / ' : '') + qtyFmt(p.qty) + '</span>' +
    (num(p.carried_qty) ? '<span class="lp-art">↪ ' + qtyFmt(p.carried_qty) + ' moved to ' + esc(fmtD(p.carried_to_date)) + '</span>' : '') + (p.carried_from ? '<span class="lp-art">↩ from ' + esc(fmtD(p.carried_from_date)) + '</span>' : '') + '</a>';
}
function lpTabPlan(edit) {
  const mon = LP_UI.week || (LP_UI.week = lpMonday()); const days = lpWeekDays(mon); const today = todayYmd();
  const lines = lpLines().filter(l => !LP_UI.line || l === LP_UI.line);
  const plans = lpPlans().filter(p => p.week === mon || (p.date >= mon && p.date <= days[6]));
  let h = '<div class="toolbar"><button class="btn" data-act="lp-week" data-n="-1">‹</button><b style="min-width:220px;text-align:center">' + lpWeekLabel(mon) + '</b><button class="btn" data-act="lp-week" data-n="1">›</button><button class="btn ghost" data-act="lp-week" data-n="0">This week</button>' +
    seg('lpLine', [{ v: '', l: 'All lines' }].concat(lpLines().map(l => ({ v: l, l }))), LP_UI.line) + '<span class="grow"></span>' +
    (edit ? '<button class="btn primary" data-act="lp-add">+ Plan a job card</button>' : '') + '<button class="btn" onclick="window.print()">Print</button></div>';
  h += '<div class="tbl-wrap lp-wrap"><table class="lp-board"><tr><th class="lp-line">Line</th>' + days.map(d => '<th class="' + (d === today ? 'today' : '') + (d.endsWith && new Date(d + 'T00:00:00').getDay() === 0 ? ' sun' : '') + '">' + lpDayLabel(d) + '</th>').join('') + '<th class="num">Week</th></tr>';
  lines.forEach(line => {
    const mine = plans.filter(p => p.line === line);
    h += '<tr><td class="lp-line"><b>' + esc(line) + '</b></td>' + days.map(d => {
      const cell = mine.filter(p => p.date === d).sort((a, b) => a.no < b.no ? -1 : 1);
      return '<td class="lp-cell' + (d === today ? ' today' : '') + '">' + cell.map(lpChip).join('') + (edit ? '<a class="lp-plus" data-act="lp-add" data-line="' + esc(line) + '" data-date="' + d + '" title="Plan here">+</a>' : '') + '</td>';
    }).join('') + '<td class="num"><b>' + qtyFmt(mine.reduce((a, p) => a + num(p.qty) - num(p.carried_qty), 0)) + '</b><div class="small muted">' + qtyFmt(mine.reduce((a, p) => a + lpDoneForPlan(p), 0)) + ' made</div></td></tr>';
  });
  h += '</table></div>';
  h += '<div class="lp-legend"><span><i class="lp-chip done"></i> made in full</span><span><i class="lp-chip part"></i> partly made</span><span><i class="lp-chip miss"></i> day passed, nothing entered</span><span><i class="lp-chip short"></i> material short</span><span><i class="lp-chip"></i> coming up</span><span><i class="lp-chip moved"></i> moved to another day</span> · click a card to change or remove it · <b>+</b> plans a job card on that line and day · ↪ pairs that did not run were moved to another day (from the Daily tab)</div>';
  // what is still to be planned, for the line in view (or all)
  const rows = []; lpOpenJcs().forEach(j => lines.forEach(line => { const left = num(j.qty) - lpPlannedOn(j.no, line); if (left > 1e-9) rows.push({ j, line, left }); }));
  h += '<h2 style="margin:16px 0 6px">Still to plan <span class="muted small">— open job cards with quantity not yet on the board</span></h2>' +
    '<div class="tbl-wrap"><table><tr><th>Job Card</th><th>Brand</th><th>Merchant</th><th>Article</th><th>Colour</th><th class="num">Order Qty</th><th>Dispatch</th><th>Line</th><th class="num">Planned</th><th class="num">Left</th><th></th></tr>' +
    (rows.length ? rows.sort((a, b) => (lpDispatch(a.j) || '9') < (lpDispatch(b.j) || '9') ? -1 : 1).slice(0, 200).map(r => '<tr><td><b>' + esc(r.j.no) + '</b></td><td>' + esc(r.j.brand || '') + '</td><td>' + esc(lpMerchant(r.j)) + '</td><td>' + esc(r.j.article || '') + '</td><td>' + esc(r.j.colour || '') + '</td><td class="num">' + qtyFmt(r.j.qty) + '</td><td class="nowrap">' + (lpDispatch(r.j) ? fmtD(lpDispatch(r.j)) : '<span class="muted">—</span>') + '</td><td>' + esc(r.line) + '</td><td class="num">' + qtyFmt(num(r.j.qty) - r.left) + '</td><td class="num"><b>' + qtyFmt(r.left) + '</b></td><td>' + (edit ? '<button class="btn sm" data-act="lp-add-jc" data-jc="' + esc(r.j.no) + '" data-line="' + esc(r.line) + '">Plan</button>' : '') + '</td></tr>').join('')
      : '<tr><td colspan="11" class="empty">Everything open is on the board</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['lp-add-jc'] = el => { if (!requirePerm('production', 'edit')) return; lpPlanDialog(null, { line: el.dataset.line, date: todayYmd(), jc_no: el.dataset.jc }); };
ACTIONS['lp-week'] = el => { const n = +el.dataset.n; LP_UI.week = n === 0 ? lpMonday() : lpAdd(LP_UI.week || lpMonday(), 7 * n); VIEWS.lineplan.render(); };

function lpTabDaily(edit) {
  const day = LP_UI.day || (LP_UI.day = todayYmd());
  const lines = lpLines().filter(l => !LP_UI.line || l === LP_UI.line);
  let h = '<div class="toolbar"><button class="btn" data-act="lp-day" data-n="-1">‹</button><input id="lpDay" type="date" value="' + day + '" style="width:160px"><button class="btn" data-act="lp-day" data-n="1">›</button><button class="btn ghost" data-act="lp-day" data-n="0">Today</button>' +
    seg('lpLine', [{ v: '', l: 'All lines' }].concat(lpLines().map(l => ({ v: l, l }))), LP_UI.line) + '<b>' + lpDayLabel(day) + '</b></div>';
  h += '<div class="lp-help">For each line: type the <b>good pairs made</b> and the <b>rejected pairs</b> against every planned job card, then press Save. If something ran that was not planned, add it with <b>Ran something else</b>.</div>';
  lines.forEach(line => {
    const plans = lpPlans().filter(p => p.line === line && p.date === day).sort((a, b) => a.no < b.no ? -1 : 1);
    const subs = lpActs().filter(a => a.line === line && a.date === day && a.sub);
    const planned = plans.reduce((a, p) => a + num(p.qty), 0), made = plans.reduce((a, p) => a + lpDoneForPlan(p), 0) + subs.reduce((a, x) => a + num(x.qty), 0);
    const rej = plans.reduce((a, p) => { const x = lpActForPlan(p); return a + (x ? num(x.rej) : 0); }, 0) + subs.reduce((a, x) => a + num(x.rej), 0);
    const saved = plans.length && plans.every(p => lpActForPlan(p));
    h += '<div class="card lp-day" data-line="' + esc(line) + '"><div class="lp-day-h"><b>' + esc(line) + '</b>' +
      '<span class="lp-pill">Planned <b>' + qtyFmt(planned) + '</b></span><span class="lp-pill ok">Good <b>' + qtyFmt(made) + '</b></span><span class="lp-pill bad">Rejected <b>' + qtyFmt(rej) + '</b></span>' + (saved ? '<span class="st Done">Saved</span>' : plans.length ? '<span class="st Pending">Not saved</span>' : '') + '<span class="grow"></span>' +
      (edit ? '<button class="btn sm" data-act="lp-sub" data-line="' + esc(line) + '">+ Ran something else</button> <button class="btn sm primary" data-act="lp-save-day" data-line="' + esc(line) + '">Save ' + esc(line) + '</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table class="lp-dtab"><tr><th>Job Card</th><th>Article</th><th class="num">Planned</th><th class="num">Good made</th><th class="num">Rejected</th><th class="num">Short</th><th>Reason (needed when short or rejected)</th><th style="width:150px"></th></tr>' +
      (plans.length ? plans.map(p => { const a = lpActForPlan(p); const v = a ? num(a.qty) : '', r = a ? num(a.rej) : ''; const short = a ? Math.max(0, num(p.qty) - num(a.qty) - num(a.rej)) : '';
        return '<tr data-plan="' + esc(p.id) + '"><td><b>' + esc(p.jc_no) + '</b></td><td>' + esc((p.article || '') + (p.colour ? ' · ' + p.colour : '')) + '</td><td class="num">' + qtyFmt(p.qty) + '</td>' +
          '<td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-made" value="' + esc(v) + '" data-planned="' + num(p.qty) + '">' : qtyFmt(v)) + '</td>' +
          '<td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-rej" value="' + esc(r) + '">' : qtyFmt(r)) + '</td>' +
          '<td class="num lp-short ' + (short > 0 ? 'late-txt' : '') + '">' + (short === '' ? '' : qtyFmt(short)) + '</td><td>' + (edit ? '<input class="lp-why" value="' + esc(a ? a.reason || '' : '') + '" placeholder="e.g. material short, machine down, stitching fault">' : esc(a ? a.reason || '' : '')) + '</td>' +
          '<td class="nowrap">' + (num(p.carried_qty) ? '<span class="small muted">↪ ' + qtyFmt(p.carried_qty) + ' moved to ' + esc(fmtD(p.carried_to_date)) + '</span>' : (edit && a && lpShortOf(p) > 0 ? '<button class="btn sm" data-act="lp-carry" data-id="' + esc(p.id) + '" title="Plan the pairs that did not run on another day">Move ' + qtyFmt(lpShortOf(p)) + ' →</button>' : '')) + '</td></tr>'; }).join('')
        : '<tr><td colspan="8" class="empty">Nothing planned on ' + esc(line) + ' for this day</td></tr>') +
      subs.map(a => '<tr class="lp-subrow" data-sub="' + esc(a.id) + '"><td><span class="st Pending">Not planned</span> <b>' + esc(a.jc_no) + '</b></td><td>' + esc((jcBy(a.jc_no) || {}).article || '') + '</td><td class="num muted">—</td><td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-made" value="' + esc(a.qty) + '">' : qtyFmt(a.qty)) + '</td><td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-rej" value="' + esc(a.rej || '') + '">' : qtyFmt(a.rej)) + '</td><td></td><td>' + (edit ? '<input class="lp-why" value="' + esc(a.reason || '') + '">' : esc(a.reason || '')) + '</td><td>' + (edit ? '<button class="btn ghost sm danger" data-act="lp-sub-del" data-id="' + esc(a.id) + '" data-confirm="Remove?">×</button>' : '') + '</td></tr>').join('') +
      '</table></div></div>';
  });
  return h;
}
ACTIONS['lp-day'] = el => { const n = +el.dataset.n; LP_UI.day = n === 0 ? todayYmd() : lpAdd(LP_UI.day || todayYmd(), n); VIEWS.lineplan.render(); };
ACTIONS['lp-save-day'] = el => {
  if (!requirePerm('production', 'edit')) return;
  const line = el.dataset.line; const card = el.closest('.lp-day'); const day = LP_UI.day; let n = 0;
  for (const tr of $$('tr[data-plan]', card)) {
    const p = Store.get('line_plans', tr.dataset.plan); const inp = $('.lp-made', tr); if (!p || !inp || (inp.value === '' && $('.lp-rej', tr).value === '')) continue;
    const qty = Math.max(0, num(inp.value)), rej = Math.max(0, num($('.lp-rej', tr).value)); const reason = $('.lp-why', tr).value.trim();
    if (qty + rej < num(p.qty) - 1e-9 && !reason) { inp.focus(); flash(p.jc_no + ': made less than planned — write the reason.', 'err'); return; }
    if (rej > 0 && !reason) { $('.lp-why', tr).focus(); flash(p.jc_no + ': ' + qtyFmt(rej) + ' rejected — write the reason.', 'err'); return; }
    const a = lpActForPlan(p) || { id: uid(), plan_id: p.id, sub: false, by: ME.name, at: nowIso() };
    Object.assign(a, { date: day, line, jc_no: p.jc_no, planned: num(p.qty), qty, rej, short: Math.max(0, num(p.qty) - qty - rej), reason, saved_by: ME.name, saved_at: nowIso() }); Store.put('line_actuals', a); n++;
  }
  $$('tr[data-sub]', card).forEach(tr => { const a = Store.get('line_actuals', tr.dataset.sub); if (!a) return; a.qty = Math.max(0, num($('.lp-made', tr).value)); a.rej = Math.max(0, num($('.lp-rej', tr).value)); a.reason = $('.lp-why', tr).value.trim(); Store.put('line_actuals', a); n++; });
  audit('line_actual.save', line + ' ' + day, n + ' row(s)'); flash(line + ' saved for ' + fmtD(day) + '.'); VIEWS.lineplan.render();
};
ACTIONS['lp-carry'] = el => {
  if (!requirePerm('production', 'edit')) return; const p = Store.get('line_plans', el.dataset.id); if (!p) return;
  const left = lpShortOf(p); if (left <= 0) { flash('Nothing left to move.', 'err'); return; }
  const body = '<div class="small muted" style="margin-bottom:8px"><b>' + esc(p.jc_no) + '</b> on ' + esc(p.line) + ', ' + esc(fmtD(p.date)) + ': planned ' + qtyFmt(p.qty) + ', ' + qtyFmt(left) + ' did not run. Plan those pairs again:</div><table class="jckv">' +
    '<tr><td class="k">Pairs to move</td><td class="v"><input id="lpCqty" type="number" min="1" max="' + left + '" step="1" value="' + left + '" style="width:140px"></td></tr>' +
    '<tr><td class="k">To date</td><td class="v"><input id="lpCdate" type="date" value="' + lpAdd(p.date, 1) + '"></td></tr>' +
    '<tr><td class="k">On line</td><td class="v"><select id="lpCline">' + lpLines().map(l => '<option' + (l === p.line ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></td></tr></table>';
  lpDialog('Move to another day', body, 'Move', d => {
    const qty = num($('#lpCqty', d).value), date = $('#lpCdate', d).value, line = $('#lpCline', d).value;
    if (!(qty > 0) || qty > left + 1e-9) return 'Between 1 and ' + qtyFmt(left) + '.'; if (!date) return 'Pick the date.';
    const n = Store.put('line_plans', { id: uid(), no: nextNo('line_plans', 'PL'), line, date, week: lpMonday(date), jc_no: p.jc_no, brand: p.brand, article: p.article, colour: p.colour, qty, kit: p.kit || '', note: p.note || '', carried_from: p.no, carried_from_date: p.date, by: ME.name, at: nowIso() });
    p.carried_qty = num(p.carried_qty) + qty; p.carried_to = n.no; p.carried_to_date = date; Store.put('line_plans', p);
    audit('line_plan.carry', p.no, qtyFmt(qty) + ' of ' + p.jc_no + ' moved from ' + p.line + ' ' + fmtD(p.date) + ' to ' + line + ' ' + fmtD(date) + ' (' + n.no + ')');
    flash(qtyFmt(qty) + ' pairs of ' + p.jc_no + ' moved to ' + fmtD(date) + '.'); VIEWS.lineplan.render(); return '';
  });
};
ACTIONS['lp-sub'] = el => {
  if (!requirePerm('production', 'edit')) return; const line = el.dataset.line; const day = LP_UI.day;
  const body = '<div class="small muted" style="margin-bottom:8px">Something ran on ' + esc(line) + ' on ' + esc(fmtD(day)) + ' that was not on the plan.</div><table class="jckv">' +
    '<tr><td class="k">Job Card</td><td class="v"><select id="lpSubJc"><option value="">Pick the job card…</option>' + lpOpenJcs().map(j => '<option value="' + esc(j.no) + '">' + esc(lpJcLabel(j)) + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Good made (pairs)</td><td class="v"><input id="lpSubQty" type="number" min="0" step="1" style="width:140px"></td></tr>' +
    '<tr><td class="k">Rejected (pairs)</td><td class="v"><input id="lpSubRej" type="number" min="0" step="1" style="width:140px" value="0"></td></tr>' +
    '<tr><td class="k">Why</td><td class="v"><input id="lpSubWhy" placeholder="e.g. planned card had no material"></td></tr>' +
    '<tr><td class="k">Its own plan</td><td class="v"><select id="lpSubCut"><option value="">— pick the job card first —</option></select><div class="small muted">These pairs come out of that plan, so it is not run twice.</div></td></tr></table>';
  const d = lpDialog('Ran something else', body, 'Add', dd => {
    const jc = $('#lpSubJc', dd).value, qty = num($('#lpSubQty', dd).value), rej = num($('#lpSubRej', dd).value), why = $('#lpSubWhy', dd).value.trim(), cutId = $('#lpSubCut', dd).value;
    if (!jc) return 'Pick the job card.'; if (!(qty > 0 || rej > 0)) return 'Type the quantity.'; if (!why) return 'Write why it ran instead.';
    Store.put('line_actuals', { id: uid(), date: day, line, jc_no: jc, plan_id: '', sub: true, planned: 0, qty, rej, short: 0, reason: why, cut_plan: cutId || '', by: ME.name, at: nowIso() });
    let note = '';
    if (cutId) { const cp = Store.get('line_plans', cutId); if (cp) { const take = Math.min(num(cp.qty) - num(cp.carried_qty), qty + rej); const was = cp.qty; cp.qty = Math.max(0, num(cp.qty) - take);
      if (cp.qty <= 0) { cp.cancelled = true; cp.cancelled_by = ME.name; cp.cancelled_at = nowIso(); cp.cancel_note = 'Ran early on ' + fmtD(day); }
      cp.note = ((cp.note || '') + ' · ' + qtyFmt(take) + ' ran early on ' + fmtD(day)).replace(/^ · /, ''); Store.put('line_plans', cp);
      note = ' — ' + qtyFmt(take) + ' taken out of ' + cp.no + ' (' + fmtD(cp.date) + ': ' + qtyFmt(was) + ' → ' + qtyFmt(cp.qty) + (cp.cancelled ? ', removed' : '') + ')'; } }
    audit('line_actual.sub', line + ' ' + day, jc + ' × ' + qtyFmt(qty) + (rej ? ' / rej ' + qtyFmt(rej) : '') + ' — ' + why + note); VIEWS.lineplan.render(); return '';
  });
  // the job card's other plans on this line: the next one is picked by default
  $('#lpSubJc', d).addEventListener('change', () => {
    const jc = $('#lpSubJc', d).value; const sel = $('#lpSubCut', d);
    const others = lpPlans().filter(p => norm(p.jc_no) === norm(jc) && p.line === line && p.date !== day && num(p.qty) - num(p.carried_qty) > 0 && lpDoneForPlan(p) <= 0).sort((a, b) => a.date < b.date ? -1 : 1);
    sel.innerHTML = '<option value="">No — it has no plan on ' + esc(line) + ' / keep its plan as it is</option>' + others.map((p, i) => '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(fmtD(p.date) + ' · planned ' + qtyFmt(num(p.qty) - num(p.carried_qty)) + ' (' + p.no + ')') + '</option>').join('');
  });
};
ACTIONS['lp-sub-del'] = el => { const a = Store.get('line_actuals', el.dataset.id); if (!a || !requirePerm('production', 'edit')) return; Store.del('line_actuals', a.id); audit('line_actual.remove', a.line + ' ' + a.date, a.jc_no + ' × ' + qtyFmt(a.qty)); VIEWS.lineplan.render(); };

function lpRange() {
  if (LP_UI.range === 'month') { const m = LP_UI.month || todayYmd().slice(0, 7); const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return { from: m + '-01', to: lpYmd(d), label: MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) }; }
  const mon = LP_UI.week || lpMonday(); return { from: mon, to: lpAdd(mon, 6), label: lpWeekLabel(mon) };
}
function lpTabSummary() {
  const R = lpRange();
  let h = '<div class="toolbar">' + seg('lpRange', [{ v: 'week', l: 'Week' }, { v: 'month', l: 'Month' }], LP_UI.range) +
    (LP_UI.range === 'month' ? '<input id="lpMonth" type="month" value="' + (LP_UI.month || todayYmd().slice(0, 7)) + '">' : '<button class="btn" data-act="lp-week" data-n="-1">‹</button><b>' + R.label + '</b><button class="btn" data-act="lp-week" data-n="1">›</button>') +
    '<span class="grow"></span><button class="btn" data-act="lp-csv-sum">Export CSV</button></div>';
  const plans = lpPlans().filter(p => p.date >= R.from && p.date <= R.to), acts = lpActs().filter(a => a.date >= R.from && a.date <= R.to);
  // a plan counts as due once its day has passed or production was entered against it; tomorrow's plan is not "short"
  const today = todayYmd();
  const rows = lpLines().map(line => { const P = plans.filter(p => p.line === line), A = acts.filter(a => a.line === line);
    const due = P.filter(p => p.date <= today || lpActForPlan(p));
    const planned = P.reduce((a, p) => a + num(p.qty) - num(p.carried_qty), 0), duePlanned = due.reduce((a, p) => a + num(p.qty) - num(p.carried_qty), 0);
    const onPlan = A.filter(a => !a.sub).reduce((a, x) => a + num(x.qty), 0), sub = A.filter(a => a.sub).reduce((a, x) => a + num(x.qty), 0), rej = A.reduce((a, x) => a + num(x.rej), 0), short = Math.max(0, duePlanned - onPlan - A.filter(a => !a.sub).reduce((a, x) => a + num(x.rej), 0));
    return { line, planned, duePlanned, onPlan, sub, rej, short, total: onPlan + sub, adh: duePlanned ? Math.round(onPlan / duePlanned * 100) : null }; });
  const T = rows.reduce((t, r) => ({ planned: t.planned + r.planned, duePlanned: t.duePlanned + r.duePlanned, onPlan: t.onPlan + r.onPlan, sub: t.sub + r.sub, rej: t.rej + r.rej, short: t.short + r.short, total: t.total + r.total }), { planned: 0, duePlanned: 0, onPlan: 0, sub: 0, rej: 0, short: 0, total: 0 });
  const bar = r => r.planned ? '<div class="lp-bar"><i style="width:' + Math.min(100, r.adh) + '%" class="' + (r.adh >= 90 ? 'g' : r.adh >= 70 ? 'a' : 'r') + '"></i></div>' : '';
  h += '<div class="lp-tiles">' + [['Planned', T.planned], ['Good made', T.total], ['Rejected', T.rej], ['Short of plan', T.short], ['Made instead', T.sub], ['Adherence', (T.duePlanned ? Math.round(T.onPlan / T.duePlanned * 100) + '%' : '—')]].map(x => '<div class="dt"><span class="dt-l">' + x[0] + '</span><b class="dt-v">' + (typeof x[1] === 'number' ? qtyFmt(x[1]) : x[1]) + '</b></div>').join('') + '</div>';
  h += '<div class="tbl-wrap"><table><tr><th>Line</th><th class="num">Planned</th><th class="num">Made as planned</th><th class="num">Made instead</th><th class="num">Rejected</th><th class="num">Short of plan</th><th class="num">Good made</th><th style="width:220px">Adherence <span class="muted small">(days passed)</span></th></tr>' +
    rows.map(r => '<tr><td><b>' + esc(r.line) + '</b></td><td class="num">' + qtyFmt(r.planned) + '</td><td class="num">' + qtyFmt(r.onPlan) + '</td><td class="num">' + qtyFmt(r.sub) + '</td><td class="num ' + (r.rej ? 'late-txt' : '') + '">' + qtyFmt(r.rej) + '</td><td class="num ' + (r.short ? 'warn-txt' : '') + '">' + qtyFmt(r.short) + '</td><td class="num"><b>' + qtyFmt(r.total) + '</b></td><td>' + (r.adh == null ? '<span class="muted">nothing planned</span>' : '<b>' + r.adh + '%</b> ' + bar(r)) + '</td></tr>').join('') +
    '<tr class="tt"><td><b>Total</b></td><td class="num"><b>' + qtyFmt(T.planned) + '</b></td><td class="num"><b>' + qtyFmt(T.onPlan) + '</b></td><td class="num"><b>' + qtyFmt(T.sub) + '</b></td><td class="num"><b>' + qtyFmt(T.rej) + '</b></td><td class="num"><b>' + qtyFmt(T.short) + '</b></td><td class="num"><b>' + qtyFmt(T.total) + '</b></td><td><b>' + (T.duePlanned ? Math.round(T.onPlan / T.duePlanned * 100) + '%' : '—') + '</b></td></tr></table></div>';
  // the days of this range where something fell short, with the reasons written on the floor
  const shortRows = acts.filter(a => num(a.short) > 0 || num(a.rej) > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  if (shortRows.length) h += '<h2 style="margin:16px 0 6px">Short and rejected — with the reasons</h2><div class="tbl-wrap"><table><tr><th>Date</th><th>Line</th><th>Job Card</th><th class="num">Planned</th><th class="num">Good made</th><th class="num">Rejected</th><th class="num">Short</th><th>Reason</th></tr>' + shortRows.map(a => '<tr><td class="nowrap">' + fmtD(a.date) + '</td><td>' + esc(a.line) + '</td><td><b>' + esc(a.jc_no) + '</b></td><td class="num">' + (a.sub ? '—' : qtyFmt(a.planned)) + '</td><td class="num">' + qtyFmt(a.qty) + '</td><td class="num ' + (num(a.rej) ? 'late-txt' : '') + '">' + qtyFmt(a.rej) + '</td><td class="num ' + (num(a.short) ? 'warn-txt' : '') + '">' + qtyFmt(a.short) + '</td><td>' + esc(a.reason || '') + '</td></tr>').join('') + '</table></div>';
  LP_UI.sumRows = rows; return h;
}
ACTIONS['lp-csv-sum'] = () => downloadCsv('line-summary-' + todayYmd() + '.csv', [['Line', 'Planned', 'Made as planned', 'Made instead', 'Rejected', 'Short of plan', 'Good made', 'Adherence %']].concat((LP_UI.sumRows || []).map(r => [r.line, r.planned, r.onPlan, r.sub, r.rej, r.short, r.total, r.adh == null ? '' : r.adh])));

function lpTrackerJcs() { const q = norm(LP_UI.q); return Store.all('job_cards').filter(j => j.status !== 'Closed' || lpActs().some(a => norm(a.jc_no) === norm(j.no))).filter(j => !q || norm(j.no + ' ' + (j.brand || '') + ' ' + (j.article || '') + ' ' + (j.colour || '')).includes(q)).sort((a, b) => String(b.no).localeCompare(String(a.no))); }
function lpStatusHtml(j, F) {
  if (F.closed) return '<span class="st Done">Closed</span>';
  if (F.current) return '<span class="st Partial">On ' + esc(F.current.line) + '</span>';
  return lpPlans().some(p => norm(p.jc_no) === norm(j.no)) ? '<span class="st Pending">Planned</span>' : '<span class="muted">Not started</span>';
}
function lpTabTracker() {
  const lines = lpLines(); const jcs = lpTrackerJcs();
  let h = '<div class="toolbar"><input id="lpQ" placeholder="Search job card / brand / article…" value="' + esc(LP_UI.q) + '" style="width:280px"><span class="muted small">' + jcs.length + ' job card(s)</span><span class="grow"></span><button class="btn" data-act="lp-csv-trk">Export CSV</button></div>';
  h += '<div class="lp-help">Every job card, line by line: <b>Good</b> = pairs passed on, <b>Rej</b> = pairs rejected on that line, <b>Left</b> = pairs still to do there. <b>Pending to close</b> = order quantity − good at ' + esc(lpFinalLine()) + ' − all rejections. When it reaches 0 the order is closed and its report is in the Order Closing tab.</div>';
  h += '<div class="tbl-wrap"><table class="lp-trk"><tr><th rowspan="2">Job Card</th><th rowspan="2">Brand · Article · Colour</th><th rowspan="2" class="num">Order Qty</th>' + lines.map(l => '<th colspan="3" class="c lp-grp">' + esc(l) + '</th>').join('') + '<th rowspan="2" class="num">Total Rejected</th><th rowspan="2" class="num">Pending to close</th><th rowspan="2">Status</th></tr><tr>' + lines.map(() => '<th class="num">Good</th><th class="num">Rej</th><th class="num">Left</th>').join('') + '</tr>';
  const out = [];
  jcs.forEach(j => {
    const F = lpFlow(j); const by = {}; F.stages.forEach(x => { by[x.line] = x; });
    out.push({ j, F });
    h += '<tr' + (F.closed ? ' class="lp-closedrow"' : '') + '><td><b>' + esc(j.no) + '</b></td><td>' + esc([j.brand, j.article, j.colour].filter(Boolean).join(' · ')) + '</td><td class="num">' + qtyFmt(j.qty) + '</td>' +
      lines.map(l => { const x = by[l]; return x ? '<td class="num">' + (x.good ? qtyFmt(x.good) : '') + '</td><td class="num ' + (x.rej ? 'late-txt' : '') + '">' + (x.rej ? qtyFmt(x.rej) : '') + '</td><td class="num ' + (x.left <= 0 ? 'ok-txt' : 'warn-txt') + '">' + (x.left <= 0 ? '✓' : qtyFmt(x.left)) + '</td>' : '<td class="num muted">—</td><td class="num muted"></td><td class="num muted"></td>'; }).join('') +
      '<td class="num ' + (F.totalRej ? 'late-txt' : '') + '">' + qtyFmt(F.totalRej) + '</td><td class="num"><b>' + qtyFmt(F.pending) + '</b></td><td>' + lpStatusHtml(j, F) + (F.closed ? ' <a class="small" href="#/lineplan/closing" data-jc="' + esc(j.no) + '" data-act="lp-close-open">report</a>' : '') + '</td></tr>';
  });
  if (!jcs.length) h += '<tr><td colspan="' + (6 + lines.length * 3) + '" class="empty">No job cards</td></tr>';
  h += '</table></div>'; LP_UI.trk = out; return h;
}
ACTIONS['lp-csv-trk'] = () => { const lines = lpLines(); downloadCsv('line-tracker-' + todayYmd() + '.csv', [['Job Card', 'Brand', 'Article', 'Colour', 'Order Qty'].concat(lines.flatMap(l => [l + ' good', l + ' rejected', l + ' left'])).concat(['Total rejected', 'Pending to close', 'Status'])].concat((LP_UI.trk || []).map(r => { const by = {}; r.F.stages.forEach(x => { by[x.line] = x; }); return [r.j.no, r.j.brand || '', r.j.article || '', r.j.colour || '', num(r.j.qty)].concat(lines.flatMap(l => by[l] ? [by[l].good, by[l].rej, by[l].left] : ['', '', ''])).concat([r.F.totalRej, r.F.pending, r.F.closed ? 'Closed' : r.F.current ? 'On ' + r.F.current.line : 'Not started']); }))); };

/* ---------- Order Closing: the job cards whose pending is zero, and the full report of each ---------- */
ACTIONS['lp-close-open'] = el => { LP_UI.tab = 'closing'; LP_UI.closeJc = el.dataset.jc; VIEWS.lineplan.render(); };
function lpClosingReport(j) {
  const F = lpFlow(j); const acts = lpActs().filter(a => norm(a.jc_no) === norm(j.no)).sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : lpLines().indexOf(a.line) - lpLines().indexOf(b.line)));
  const o = Store.all('orders').find(x => norm(x.no) === norm(j.order_no)) || {};
  const kv = (k, v) => '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>';
  let h = '<div class="card lp-report" id="lpReport"><div class="lp-rep-h"><div><div class="lp-rep-t">ORDER CLOSING REPORT</div><div class="muted">' + esc(j.no) + ' · ' + esc([j.brand, j.article, j.colour].filter(Boolean).join(' · ')) + '</div></div>' +
    '<span class="grow"></span>' + (F.closed ? '<span class="st Done" style="font-size:14px">CLOSED</span>' : '<span class="st Pending" style="font-size:14px">OPEN · ' + qtyFmt(F.pending) + ' pending</span>') + ' <button class="btn sm noprint" data-act="lp-print-report">Print</button></div>' +
    '<div class="lp-rep-grid"><table class="jckv">' + kv('Job Card', '<b>' + esc(j.no) + '</b>') + kv('Order No', esc(j.order_no || '')) + kv('Brand', esc(j.brand || '')) + kv('Merchant', esc(lpMerchant(j))) + '</table>' +
    '<table class="jckv">' + kv('Article', esc(j.article || '')) + kv('Colour', esc(j.colour || '')) + kv('Order Qty', '<b>' + qtyFmt(j.qty) + ' pairs</b>') + kv('Planned dispatch', lpDispatch(j) ? fmtD(lpDispatch(j)) : '—') + '</table>' +
    '<table class="jckv">' + kv('First production', F.first ? fmtD(F.first) : '—') + kv('Last production', F.last ? fmtD(F.last) : '—') + kv('Days on floor', F.first && F.last ? (daysBetween(F.first, F.last) + 1) : '—') + kv('Report date', fmtD(todayYmd())) + '</table></div>';
  // the journey
  h += '<h3>Line by line</h3><div class="tbl-wrap"><table><tr><th>Line</th><th class="num">Came in</th><th class="num">Good made</th><th class="num">Rejected</th><th class="num">Left on this line</th><th class="num">Rejection %</th></tr>' +
    (F.stages.length ? F.stages.map(x => '<tr><td><b>' + esc(x.line) + '</b>' + (x.line === F.fin ? ' <span class="muted small">(last stage)</span>' : '') + '</td><td class="num">' + qtyFmt(x.inQty) + '</td><td class="num">' + qtyFmt(x.good) + '</td><td class="num ' + (x.rej ? 'late-txt' : '') + '">' + qtyFmt(x.rej) + '</td><td class="num ' + (x.left > 0 ? 'warn-txt' : 'ok-txt') + '">' + (x.left > 0 ? qtyFmt(x.left) : '0 ✓') + '</td><td class="num">' + (x.inQty ? Math.round(x.rej / x.inQty * 1000) / 10 + '%' : '') + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">No production entered yet</td></tr>') + '</table></div>';
  // the sum
  h += '<div class="lp-sum"><div class="dt"><span class="dt-l">Order quantity</span><b class="dt-v">' + qtyFmt(j.qty) + '</b></div><div class="lp-op">−</div><div class="dt"><span class="dt-l">Good at ' + esc(F.fin) + '</span><b class="dt-v">' + qtyFmt(F.packed) + '</b></div><div class="lp-op">−</div><div class="dt"><span class="dt-l">Rejected (all lines)</span><b class="dt-v late-txt">' + qtyFmt(F.totalRej) + '</b></div><div class="lp-op">=</div><div class="dt ' + (F.pending ? 'dt-crit' : 'dt-good') + '"><span class="dt-l">Pending to close</span><b class="dt-v">' + qtyFmt(F.pending) + '</b></div></div>';
  // every entry
  h += '<h3>Every production entry</h3><div class="tbl-wrap"><table><tr><th>Date</th><th>Line</th><th class="num">Planned</th><th class="num">Good made</th><th class="num">Rejected</th><th>Reason / remark</th><th>Entered by</th></tr>' +
    (acts.length ? acts.map(a => '<tr><td class="nowrap">' + fmtD(a.date) + '</td><td>' + esc(a.line) + (a.sub ? ' <span class="muted small">(not planned)</span>' : '') + '</td><td class="num">' + (a.sub ? '—' : qtyFmt(a.planned)) + '</td><td class="num">' + qtyFmt(a.qty) + '</td><td class="num ' + (num(a.rej) ? 'late-txt' : '') + '">' + qtyFmt(a.rej) + '</td><td>' + esc(a.reason || '') + '</td><td>' + esc(a.saved_by || a.by || '') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nothing yet</td></tr>') + '</table></div></div>';
  return h;
}
ACTIONS['lp-print-report'] = () => { const r = $('#lpReport'); if (!r) return; const w = window.open(''); if (!w) { flash('Allow pop-ups to print.', 'err'); return; } w.document.write('<html><head><title>Order Closing Report</title><link rel="stylesheet" href="styles.css"><style>body{padding:16px;background:#fff}.noprint{display:none}</style></head><body>' + r.outerHTML + '</body></html>'); w.document.close(); setTimeout(() => w.print(), 400); };
function lpTabClosing() {
  const rows = lpTrackerJcs().map(j => ({ j, F: lpFlow(j) })).filter(r => r.F.stages.length);
  const closed = rows.filter(r => r.F.closed), open = rows.filter(r => !r.F.closed);
  let h = '<div class="toolbar"><input id="lpQ" placeholder="Search job card / brand / article…" value="' + esc(LP_UI.q) + '" style="width:280px">' + seg('lpCls', [{ v: 'closed', l: 'Closed (' + closed.length + ')' }, { v: 'open', l: 'Still open (' + open.length + ')' }], LP_UI.cls || 'closed') + '</div>';
  h += '<div class="lp-help">An order is <b>closed</b> when nothing is pending: order quantity − good pairs at ' + esc(lpFinalLine()) + ' − every rejection on the way = 0. Click a job card to see its full report.</div>';
  const list = (LP_UI.cls || 'closed') === 'closed' ? closed : open;
  h += '<div class="tbl-wrap"><table><tr><th>Job Card</th><th>Brand · Article · Colour</th><th class="num">Order Qty</th><th class="num">Good at ' + esc(lpFinalLine()) + '</th><th class="num">Rejected</th><th class="num">Pending</th><th>First day</th><th>Last day</th><th>Status</th></tr>' +
    (list.length ? list.map(r => '<tr class="' + (LP_UI.closeJc === r.j.no ? 'lp-sel' : '') + '" style="cursor:pointer" data-act="lp-close-open" data-jc="' + esc(r.j.no) + '"><td><b>' + esc(r.j.no) + '</b></td><td>' + esc([r.j.brand, r.j.article, r.j.colour].filter(Boolean).join(' · ')) + '</td><td class="num">' + qtyFmt(r.j.qty) + '</td><td class="num">' + qtyFmt(r.F.packed) + '</td><td class="num ' + (r.F.totalRej ? 'late-txt' : '') + '">' + qtyFmt(r.F.totalRej) + '</td><td class="num"><b>' + qtyFmt(r.F.pending) + '</b></td><td class="nowrap">' + (r.F.first ? fmtD(r.F.first) : '') + '</td><td class="nowrap">' + (r.F.last ? fmtD(r.F.last) : '') + '</td><td>' + lpStatusHtml(r.j, r.F) + '</td></tr>').join('')
      : '<tr><td colspan="9" class="empty">' + ((LP_UI.cls || 'closed') === 'closed' ? 'No order has closed yet' : 'Nothing open') + '</td></tr>') + '</table></div>';
  const sel = LP_UI.closeJc ? jcBy(LP_UI.closeJc) : null;
  if (sel) h += '<div style="margin-top:14px">' + lpClosingReport(sel) + '</div>';
  return h;
}

VIEWS.lineplan = {
  mod: 'production', render(param) {
    if (param && ['plan', 'daily', 'summary', 'tracker', 'closing'].includes(param)) LP_UI.tab = param;
    const edit = can('production', 'edit');
    let h = '<div class="lp-tabs">' + [['plan', '1 · Plan', 'put job cards on the lines for the week'], ['daily', '2 · Daily', 'enter good and rejected pairs each day'], ['summary', '3 · Summary', 'plan vs made, per line'], ['tracker', '4 · Tracker', 'every job card, every line'], ['closing', '5 · Order Closing', 'closed orders and their reports']].map(t => '<a href="#/lineplan/' + t[0] + '" class="' + (LP_UI.tab === t[0] ? 'on' : '') + '"><b>' + t[1] + '</b><span>' + t[2] + '</span></a>').join('') + '</div>';
    h += LP_UI.tab === 'plan' ? lpTabPlan(edit) : LP_UI.tab === 'daily' ? lpTabDaily(edit) : LP_UI.tab === 'summary' ? lpTabSummary() : LP_UI.tab === 'closing' ? lpTabClosing() : lpTabTracker();
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'lpLine') { LP_UI.line = e.detail; VIEWS.lineplan.render(); } if (e.target.dataset.seg === 'lpRange') { LP_UI.range = e.detail; VIEWS.lineplan.render(); } if (e.target.dataset.seg === 'lpCls') { LP_UI.cls = e.detail; VIEWS.lineplan.render(); } });
    const dayI = $('#lpDay', m); if (dayI) dayI.addEventListener('change', e => { if (e.target.value) { LP_UI.day = e.target.value; VIEWS.lineplan.render(); } });
    const monI = $('#lpMonth', m); if (monI) monI.addEventListener('change', e => { LP_UI.month = e.target.value; VIEWS.lineplan.render(); });
    const qI = $('#lpQ', m); if (qI) qI.addEventListener('input', e => { LP_UI.q = e.target.value; VIEWS.lineplan.render(); const i = $('#lpQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
    // the Short column follows the Made box as it is typed
    m.addEventListener('input', e => { if (!e.target.classList.contains('lp-made') && !e.target.classList.contains('lp-rej')) return; const tr = e.target.closest('tr'); const made = $('.lp-made', tr); if (!made || !made.dataset.planned) return; const s = Math.max(0, num(made.dataset.planned) - num(made.value) - num(($('.lp-rej', tr) || {}).value)); const c = $('.lp-short', tr); c.textContent = made.value === '' ? '' : qtyFmt(s); c.classList.toggle('late-txt', s > 0); });
  }
};

/* ---------- Settings › Production Lines ---------- */
VIEWS.prodlines = {
  mod: 'settings', render() {
    masterView({
      col: 'prod_lines', mod: 'settings', title: 'Production Lines', view: VIEWS.prodlines, sort: 'seq',
      cols: [{ k: 'seq', l: 'Order', type: 'number', w: 70 }, { k: 'name', l: 'Line', upper: true, ph: 'e.g. CUTTING' }, { k: 'capacity', l: 'Pairs / day', type: 'number', w: 110 }, { k: 'final', l: 'Last stage (orders close here)', type: 'check' }, { k: 'active', l: 'Active', type: 'check' }],
      defaults: { active: true, final: false },
      normalize: d => { d.name = String(d.name || '').trim().toUpperCase(); },
      validate: d => !d.name ? 'Line name is required.' : Store.all('prod_lines').some(x => x.id !== d.id && norm(x.name) === norm(d.name)) ? 'Line exists.' : '',
      inUse: d => lpPlans().some(p => p.line === String(d.name).toUpperCase()) ? 'This line has plans — untick Active instead of deleting.' : ''
    });
    if (!Store.all('prod_lines').length) $('#main').insertAdjacentHTML('beforeend', '<div class="small muted" style="margin-top:8px">No lines yet — the Line Plan is using the built-in list (' + LP_DEFAULT_LINES.join(', ') + '). ' + (can('settings', 'edit') ? '<a data-act="lp-seed-lines">Load them here</a> to edit.' : '') + '</div>');
  }
};
ACTIONS['lp-seed-lines'] = () => { if (!requirePerm('settings', 'edit')) return; LP_DEFAULT_LINES.forEach((n, i) => Store.put('prod_lines', { id: 'ln_' + n.toLowerCase(), seq: i + 1, name: n, capacity: 0, final: n === 'PACKING', active: true })); audit('prod_lines.seed', '', LP_DEFAULT_LINES.join(', ')); VIEWS.prodlines.render(); };
