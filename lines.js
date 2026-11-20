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
const LP_DEFAULT_LINES = ['CUTTING', 'CLOSING', 'EVA', 'SLIDER', 'SHOES'];
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
function lpPlannedOn(jc, line) { return lpPlans().filter(p => norm(p.jc_no) === norm(jc) && p.line === line).reduce((a, p) => a + num(p.qty), 0); }
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
  const st = done >= num(p.qty) - 1e-9 ? 'done' : done > 0 ? 'part' : past ? 'miss' : p.kit === 'Short' ? 'short' : '';
  return '<a class="lp-chip ' + st + '" data-act="lp-open" data-id="' + esc(p.id) + '" title="' + esc(p.jc_no + ' · ' + (p.brand || '') + ' · ' + (p.article || '') + ' ' + (p.colour || '') + (p.note ? ' — ' + p.note : '')) + '">' +
    '<b>' + esc(p.jc_no) + '</b><span class="lp-art">' + esc((p.article || '') + (p.colour ? ' · ' + p.colour : '')) + '</span><span class="lp-q">' + (done ? qtyFmt(done) + ' / ' : '') + qtyFmt(p.qty) + '</span></a>';
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
    }).join('') + '<td class="num"><b>' + qtyFmt(mine.reduce((a, p) => a + num(p.qty), 0)) + '</b><div class="small muted">' + qtyFmt(mine.reduce((a, p) => a + lpDoneForPlan(p), 0)) + ' made</div></td></tr>';
  });
  h += '</table></div>';
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
    seg('lpLine', [{ v: '', l: 'All lines' }].concat(lpLines().map(l => ({ v: l, l }))), LP_UI.line) + '<span class="muted small">' + lpDayLabel(day) + '</span></div>';
  lines.forEach(line => {
    const plans = lpPlans().filter(p => p.line === line && p.date === day).sort((a, b) => a.no < b.no ? -1 : 1);
    const subs = lpActs().filter(a => a.line === line && a.date === day && a.sub);
    const planned = plans.reduce((a, p) => a + num(p.qty), 0), made = plans.reduce((a, p) => a + lpDoneForPlan(p), 0), extra = subs.reduce((a, x) => a + num(x.qty), 0);
    h += '<div class="card lp-day" data-line="' + esc(line) + '"><div class="lp-day-h"><b>' + esc(line) + '</b><span class="muted small">planned ' + qtyFmt(planned) + ' · made ' + qtyFmt(made + extra) + (extra ? ' (' + qtyFmt(extra) + ' not planned)' : '') + '</span><span class="grow"></span>' +
      (edit ? '<button class="btn sm" data-act="lp-sub" data-line="' + esc(line) + '">+ Ran something else</button> <button class="btn sm primary" data-act="lp-save-day" data-line="' + esc(line) + '">Save ' + esc(line) + '</button>' : '') + '</div>' +
      '<div class="tbl-wrap"><table><tr><th>Job Card</th><th>Article</th><th class="num">Planned</th><th class="num" style="width:120px">Made today</th><th class="num">Short</th><th>Why short / remark</th><th style="width:60px"></th></tr>' +
      (plans.length ? plans.map(p => { const a = lpActForPlan(p); const v = a ? num(a.qty) : ''; const short = a ? Math.max(0, num(p.qty) - num(a.qty)) : '';
        return '<tr data-plan="' + esc(p.id) + '"><td><b>' + esc(p.jc_no) + '</b></td><td>' + esc((p.article || '') + (p.colour ? ' · ' + p.colour : '')) + '</td><td class="num">' + qtyFmt(p.qty) + '</td><td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-made" value="' + esc(v) + '" data-planned="' + num(p.qty) + '">' : qtyFmt(v)) + '</td><td class="num lp-short ' + (short > 0 ? 'late-txt' : '') + '">' + (short === '' ? '' : qtyFmt(short)) + '</td><td>' + (edit ? '<input class="lp-why" value="' + esc(a ? a.reason || '' : '') + '" placeholder="e.g. material short, machine down">' : esc(a ? a.reason || '' : '')) + '</td><td></td></tr>'; }).join('')
        : '<tr><td colspan="7" class="empty">Nothing planned on ' + esc(line) + ' for this day</td></tr>') +
      subs.map(a => '<tr class="lp-subrow" data-sub="' + esc(a.id) + '"><td><span class="st Pending">Not planned</span> <b>' + esc(a.jc_no) + '</b></td><td>' + esc((jcBy(a.jc_no) || {}).article || '') + '</td><td class="num muted">—</td><td class="num">' + (edit ? '<input type="number" min="0" step="1" class="right lp-made" value="' + esc(a.qty) + '">' : qtyFmt(a.qty)) + '</td><td></td><td>' + (edit ? '<input class="lp-why" value="' + esc(a.reason || '') + '">' : esc(a.reason || '')) + '</td><td>' + (edit ? '<button class="btn ghost sm danger" data-act="lp-sub-del" data-id="' + esc(a.id) + '" data-confirm="Remove?">×</button>' : '') + '</td></tr>').join('') +
      '</table></div></div>';
  });
  return h;
}
ACTIONS['lp-day'] = el => { const n = +el.dataset.n; LP_UI.day = n === 0 ? todayYmd() : lpAdd(LP_UI.day || todayYmd(), n); VIEWS.lineplan.render(); };
ACTIONS['lp-save-day'] = el => {
  if (!requirePerm('production', 'edit')) return;
  const line = el.dataset.line; const card = el.closest('.lp-day'); const day = LP_UI.day; let n = 0;
  $$('tr[data-plan]', card).forEach(tr => {
    const p = Store.get('line_plans', tr.dataset.plan); const inp = $('.lp-made', tr); if (!p || !inp || inp.value === '') return;
    const qty = Math.max(0, num(inp.value)); const reason = $('.lp-why', tr).value.trim();
    if (qty < num(p.qty) && !reason) { inp.focus(); flash(p.jc_no + ': made less than planned — write why.', 'err'); n = -1; return; }
    const a = lpActForPlan(p) || { id: uid(), plan_id: p.id, sub: false, by: ME.name, at: nowIso() };
    Object.assign(a, { date: day, line, jc_no: p.jc_no, planned: num(p.qty), qty, short: Math.max(0, num(p.qty) - qty), reason }); Store.put('line_actuals', a); n++;
  });
  if (n < 0) return;
  $$('tr[data-sub]', card).forEach(tr => { const a = Store.get('line_actuals', tr.dataset.sub); if (!a) return; a.qty = Math.max(0, num($('.lp-made', tr).value)); a.reason = $('.lp-why', tr).value.trim(); Store.put('line_actuals', a); n++; });
  audit('line_actual.save', line + ' ' + day, n + ' row(s)'); flash(line + ' saved for ' + fmtD(day) + '.'); VIEWS.lineplan.render();
};
ACTIONS['lp-sub'] = el => {
  if (!requirePerm('production', 'edit')) return; const line = el.dataset.line; const day = LP_UI.day;
  const body = '<div class="small muted" style="margin-bottom:8px">Something ran on ' + esc(line) + ' on ' + esc(fmtD(day)) + ' that was not on the plan.</div><table class="jckv">' +
    '<tr><td class="k">Job Card</td><td class="v"><select id="lpSubJc"><option value="">Pick the job card…</option>' + lpOpenJcs().map(j => '<option value="' + esc(j.no) + '">' + esc(lpJcLabel(j)) + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Made (pairs)</td><td class="v"><input id="lpSubQty" type="number" min="1" step="1" style="width:140px"></td></tr>' +
    '<tr><td class="k">Why</td><td class="v"><input id="lpSubWhy" placeholder="e.g. planned card had no material"></td></tr></table>';
  lpDialog('Ran something else', body, 'Add', d => {
    const jc = $('#lpSubJc', d).value, qty = num($('#lpSubQty', d).value), why = $('#lpSubWhy', d).value.trim();
    if (!jc) return 'Pick the job card.'; if (!(qty > 0)) return 'Type the quantity.'; if (!why) return 'Write why it ran instead.';
    Store.put('line_actuals', { id: uid(), date: day, line, jc_no: jc, plan_id: '', sub: true, planned: 0, qty, short: 0, reason: why, by: ME.name, at: nowIso() });
    audit('line_actual.sub', line + ' ' + day, jc + ' × ' + qtyFmt(qty) + ' — ' + why); VIEWS.lineplan.render(); return '';
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
    const planned = P.reduce((a, p) => a + num(p.qty), 0), duePlanned = due.reduce((a, p) => a + num(p.qty), 0);
    const onPlan = A.filter(a => !a.sub).reduce((a, x) => a + num(x.qty), 0), sub = A.filter(a => a.sub).reduce((a, x) => a + num(x.qty), 0), short = Math.max(0, duePlanned - onPlan);
    return { line, planned, duePlanned, onPlan, sub, short, total: onPlan + sub, adh: duePlanned ? Math.round(onPlan / duePlanned * 100) : null }; });
  const T = rows.reduce((t, r) => ({ planned: t.planned + r.planned, duePlanned: t.duePlanned + r.duePlanned, onPlan: t.onPlan + r.onPlan, sub: t.sub + r.sub, short: t.short + r.short, total: t.total + r.total }), { planned: 0, duePlanned: 0, onPlan: 0, sub: 0, short: 0, total: 0 });
  const bar = r => r.planned ? '<div class="lp-bar"><i style="width:' + Math.min(100, r.adh) + '%" class="' + (r.adh >= 90 ? 'g' : r.adh >= 70 ? 'a' : 'r') + '"></i></div>' : '';
  h += '<div class="lp-tiles">' + [['Planned', T.planned], ['Made as planned', T.onPlan], ['Made instead', T.sub], ['Short of plan', T.short], ['Total made', T.total], ['Adherence', (T.duePlanned ? Math.round(T.onPlan / T.duePlanned * 100) + '%' : '—')]].map(x => '<div class="dt"><span class="dt-l">' + x[0] + '</span><b class="dt-v">' + (typeof x[1] === 'number' ? qtyFmt(x[1]) : x[1]) + '</b></div>').join('') + '</div>';
  h += '<div class="tbl-wrap"><table><tr><th>Line</th><th class="num">Planned</th><th class="num">Made as planned</th><th class="num">Made instead</th><th class="num">Short of plan</th><th class="num">Total made</th><th style="width:220px">Adherence <span class="muted small">(days passed)</span></th></tr>' +
    rows.map(r => '<tr><td><b>' + esc(r.line) + '</b></td><td class="num">' + qtyFmt(r.planned) + '</td><td class="num">' + qtyFmt(r.onPlan) + '</td><td class="num">' + qtyFmt(r.sub) + '</td><td class="num ' + (r.short ? 'late-txt' : '') + '">' + qtyFmt(r.short) + '</td><td class="num"><b>' + qtyFmt(r.total) + '</b></td><td>' + (r.adh == null ? '<span class="muted">nothing planned</span>' : '<b>' + r.adh + '%</b> ' + bar(r)) + '</td></tr>').join('') +
    '<tr class="tt"><td><b>Total</b></td><td class="num"><b>' + qtyFmt(T.planned) + '</b></td><td class="num"><b>' + qtyFmt(T.onPlan) + '</b></td><td class="num"><b>' + qtyFmt(T.sub) + '</b></td><td class="num"><b>' + qtyFmt(T.short) + '</b></td><td class="num"><b>' + qtyFmt(T.total) + '</b></td><td><b>' + (T.duePlanned ? Math.round(T.onPlan / T.duePlanned * 100) + '%' : '—') + '</b></td></tr></table></div>';
  // the days of this range where something fell short, with the reasons written on the floor
  const shortRows = acts.filter(a => !a.sub && num(a.short) > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  if (shortRows.length) h += '<h2 style="margin:16px 0 6px">Where it fell short</h2><div class="tbl-wrap"><table><tr><th>Date</th><th>Line</th><th>Job Card</th><th class="num">Planned</th><th class="num">Made</th><th class="num">Short</th><th>Why</th></tr>' + shortRows.map(a => '<tr><td class="nowrap">' + fmtD(a.date) + '</td><td>' + esc(a.line) + '</td><td><b>' + esc(a.jc_no) + '</b></td><td class="num">' + qtyFmt(a.planned) + '</td><td class="num">' + qtyFmt(a.qty) + '</td><td class="num late-txt">' + qtyFmt(a.short) + '</td><td>' + esc(a.reason || '') + '</td></tr>').join('') + '</table></div>';
  LP_UI.sumRows = rows; return h;
}
ACTIONS['lp-csv-sum'] = () => downloadCsv('line-summary-' + todayYmd() + '.csv', [['Line', 'Planned', 'Made as planned', 'Made instead', 'Short of plan', 'Total made', 'Adherence %']].concat((LP_UI.sumRows || []).map(r => [r.line, r.planned, r.onPlan, r.sub, r.short, r.total, r.adh == null ? '' : r.adh])));

function lpTabTracker() {
  const lines = lpLines(); const q = norm(LP_UI.q);
  const jcs = Store.all('job_cards').filter(j => j.status !== 'Closed' || lpActs().some(a => norm(a.jc_no) === norm(j.no))).filter(j => !q || norm(j.no + ' ' + (j.brand || '') + ' ' + (j.article || '') + ' ' + (j.colour || '')).includes(q)).sort((a, b) => String(b.no).localeCompare(String(a.no)));
  let h = '<div class="toolbar"><input id="lpQ" placeholder="Search job card / brand / article…" value="' + esc(LP_UI.q) + '" style="width:280px"><span class="muted small">' + jcs.length + ' job card(s)</span><span class="grow"></span><button class="btn" data-act="lp-csv-trk">Export CSV</button></div>';
  h += '<div class="tbl-wrap"><table><tr><th rowspan="2">Brand</th><th rowspan="2">Job Card</th><th rowspan="2">Article</th><th rowspan="2">Colour</th><th rowspan="2" class="num">Order Qty</th><th rowspan="2">Dispatch</th>' + lines.map(l => '<th colspan="2" class="c lp-grp">' + esc(l) + '</th>').join('') + '<th rowspan="2">Where it is</th></tr><tr>' + lines.map(() => '<th class="num">Done</th><th class="num">Left</th>').join('') + '</tr>';
  const out = [];
  jcs.forEach(j => {
    // a line this job card never touched (no plan, nothing made) shows a dash, not a balance — not every card runs on every line
    const per = lines.map(l => { const done = lpDoneOn(j.no, l); const touched = done > 0 || lpPlannedOn(j.no, l) > 0; return { l, done, touched, left: touched ? Math.max(0, num(j.qty) - done) : '' }; });
    const cur = per.filter(x => x.done > 0).slice(-1)[0]; const all = per.some(x => x.touched) && per.filter(x => x.touched).every(x => x.left <= 0);
    const where = all ? '<span class="st Done">All lines done</span>' : cur ? '<span class="st Partial">' + esc(cur.l) + (cur.left ? ' · ' + qtyFmt(cur.left) + ' left' : ' done') + '</span>' : lpPlans().some(p => norm(p.jc_no) === norm(j.no)) ? '<span class="st Pending">Planned</span>' : '<span class="muted">Not started</span>';
    out.push({ j, per, where: where.replace(/<[^>]+>/g, '') });
    h += '<tr><td>' + esc(j.brand || '') + '</td><td><b>' + esc(j.no) + '</b></td><td>' + esc(j.article || '') + '</td><td>' + esc(j.colour || '') + '</td><td class="num">' + qtyFmt(j.qty) + '</td><td class="nowrap">' + (lpDispatch(j) ? fmtD(lpDispatch(j)) : '') + '</td>' +
      per.map(x => '<td class="num">' + (x.done ? qtyFmt(x.done) : '') + '</td><td class="num ' + (!x.touched ? 'muted' : x.left <= 0 ? 'ok-txt' : x.done > 0 ? 'warn-txt' : '') + '">' + (!x.touched ? '—' : x.left <= 0 ? '✓' : qtyFmt(x.left)) + '</td>').join('') + '<td>' + where + '</td></tr>';
  });
  if (!jcs.length) h += '<tr><td colspan="' + (7 + lines.length * 2) + '" class="empty">No job cards</td></tr>';
  h += '</table></div>'; LP_UI.trk = out; return h;
}
ACTIONS['lp-csv-trk'] = () => { const lines = lpLines(); downloadCsv('line-tracker-' + todayYmd() + '.csv', [['Brand', 'Job Card', 'Article', 'Colour', 'Order Qty', 'Dispatch'].concat(lines.flatMap(l => [l + ' done', l + ' left'])).concat(['Where it is'])].concat((LP_UI.trk || []).map(r => [r.j.brand || '', r.j.no, r.j.article || '', r.j.colour || '', num(r.j.qty), lpDispatch(r.j) || ''].concat(r.per.flatMap(x => [x.done, x.left])).concat([r.where])))); };

VIEWS.lineplan = {
  mod: 'production', render(param) {
    if (param && ['plan', 'daily', 'summary', 'tracker'].includes(param)) LP_UI.tab = param;
    const edit = can('production', 'edit');
    let h = '<div class="lp-tabs">' + [['plan', 'Plan', 'the week, line by line'], ['daily', 'Daily', 'what was made today'], ['summary', 'Summary', 'plan vs made'], ['tracker', 'Tracker', 'every job card, every line']].map(t => '<a href="#/lineplan/' + t[0] + '" class="' + (LP_UI.tab === t[0] ? 'on' : '') + '"><b>' + t[1] + '</b><span>' + t[2] + '</span></a>').join('') + '</div>';
    h += LP_UI.tab === 'plan' ? lpTabPlan(edit) : LP_UI.tab === 'daily' ? lpTabDaily(edit) : LP_UI.tab === 'summary' ? lpTabSummary() : lpTabTracker();
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'lpLine') { LP_UI.line = e.detail; VIEWS.lineplan.render(); } if (e.target.dataset.seg === 'lpRange') { LP_UI.range = e.detail; VIEWS.lineplan.render(); } });
    const dayI = $('#lpDay', m); if (dayI) dayI.addEventListener('change', e => { if (e.target.value) { LP_UI.day = e.target.value; VIEWS.lineplan.render(); } });
    const monI = $('#lpMonth', m); if (monI) monI.addEventListener('change', e => { LP_UI.month = e.target.value; VIEWS.lineplan.render(); });
    const qI = $('#lpQ', m); if (qI) qI.addEventListener('input', e => { LP_UI.q = e.target.value; VIEWS.lineplan.render(); const i = $('#lpQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
    // the Short column follows the Made box as it is typed
    m.addEventListener('input', e => { if (!e.target.classList.contains('lp-made') || !e.target.dataset.planned) return; const tr = e.target.closest('tr'); const s = Math.max(0, num(e.target.dataset.planned) - num(e.target.value)); const c = $('.lp-short', tr); c.textContent = e.target.value === '' ? '' : qtyFmt(s); c.classList.toggle('late-txt', s > 0); });
  }
};

/* ---------- Settings › Production Lines ---------- */
VIEWS.prodlines = {
  mod: 'settings', render() {
    masterView({
      col: 'prod_lines', mod: 'settings', title: 'Production Lines', view: VIEWS.prodlines, sort: 'seq',
      cols: [{ k: 'seq', l: 'Order', type: 'number', w: 70 }, { k: 'name', l: 'Line', upper: true, ph: 'e.g. CUTTING' }, { k: 'capacity', l: 'Pairs / day', type: 'number', w: 110 }, { k: 'active', l: 'Active', type: 'check' }],
      defaults: { active: true },
      normalize: d => { d.name = String(d.name || '').trim().toUpperCase(); },
      validate: d => !d.name ? 'Line name is required.' : Store.all('prod_lines').some(x => x.id !== d.id && norm(x.name) === norm(d.name)) ? 'Line exists.' : '',
      inUse: d => lpPlans().some(p => p.line === String(d.name).toUpperCase()) ? 'This line has plans — untick Active instead of deleting.' : ''
    });
    if (!Store.all('prod_lines').length) $('#main').insertAdjacentHTML('beforeend', '<div class="small muted" style="margin-top:8px">No lines yet — the Line Plan is using the built-in five (' + LP_DEFAULT_LINES.join(', ') + '). ' + (can('settings', 'edit') ? '<a data-act="lp-seed-lines">Load them here</a> to edit.' : '') + '</div>');
  }
};
ACTIONS['lp-seed-lines'] = () => { if (!requirePerm('settings', 'edit')) return; LP_DEFAULT_LINES.forEach((n, i) => Store.put('prod_lines', { id: 'ln_' + n.toLowerCase(), seq: i + 1, name: n, capacity: 0, active: true })); audit('prod_lines.seed', '', LP_DEFAULT_LINES.join(', ')); VIEWS.prodlines.render(); };
