/* Nexus 2.0 — Kits: the only real lock.
   One kit per job card per process. A week before the process is due, PPC gets a task to make the digital kit
   (items and quantities from the BOM, only when the full material is in stock). The digital kit puts a task on
   the Store to build it physically. PPC then approves it, entering what was found — approved means locked:
   that material is issued to that job card's process and no other. Issue = open the kit number and submit.
   Only the Planning Head can break a kit, with a reason. A closed or cancelled job card releases its kits. */
'use strict';

const KIT_UI = { f: 'open', form: false, jc: '', proc: '', open: null };
const KIT_LEAD_DAYS = 7;
const KIT_OPEN = ['Planned', 'Built', 'Approved'];
const kitAll = () => Store.all('kits');
const kitOf = (jc, proc) => kitAll().find(k => norm(k.jc_no) === norm(jc) && norm(k.process) === norm(proc) && k.status !== 'Broken' && k.status !== 'Released');
const kitCanPlan = () => isAdminRole() || can('production', 'edit');
const kitCanBuild = () => can('store', 'edit');
function kitCanBreak() {
  if (isAdminRole()) return true;
  const d = String(ME.department || '').toUpperCase(), g = String(ME.designation || '').toUpperCase();
  return /PLANNING|PPC/.test(d) && /HEAD|MANAGER|INCHARGE/.test(g);
}
// approved, not yet issued: held out of free stock for its job card
function kitHeld(code) { return kitAll().filter(k => k.status === 'Approved').reduce((s, k) => s + (k.lines || []).filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + num(l.qty), 0), 0); }
function kitHeldFor(jc, code) { return kitAll().filter(k => k.status === 'Approved' && norm(k.jc_no) === norm(jc)).reduce((s, k) => s + (k.lines || []).filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + num(l.qty), 0), 0); }
// kitted already (any live kit), so the next kit of the same process does not take it twice
function kitTaken(jc, proc, code) { return kitAll().filter(k => KIT_OPEN.concat(['Issued']).includes(k.status) && norm(k.jc_no) === norm(jc) && norm(k.process) === norm(proc)).reduce((s, k) => s + (k.lines || []).filter(l => norm(l.material) === norm(code)).reduce((a, l) => a + num(l.qty), 0), 0); }

// the processes on a job card, in BOM order
// a line with no process on it goes into one 'GENERAL' kit
const kitProcKey = l => String(l.process || '').trim().toUpperCase() || 'GENERAL';
function kitProcesses(j) { return Array.from(new Set((j.lines || []).map(kitProcKey))); }
// when a process is due: the O2D step of that name on the order, else the job card's Plan date
function kitProdDate(j, proc) {
  try {
    const o = Store.all('orders').find(x => norm(x.no) === norm(j.order_no || ''));
    if (o && typeof resolveOrder === 'function') { const r = resolveOrder(o); if (r) { const id = r.order.find(i => norm((r.steps[i] || {}).name || '') === norm(proc)); const s = id ? r.steps[id] : null; if (s && s.planned) return ymdOf(new Date(s.planned)); } }
  } catch (e) { }
  return typeof mtPlanDate === 'function' ? mtPlanDate(j) : '';
}
// what the kit of this job card + process still has to hold
function kitNeedRows(j, proc) {
  const g = {};
  (j.lines || []).filter(l => norm(kitProcKey(l)) === norm(proc)).forEach(l => { const k = norm(l.material); const r = g[k] || (g[k] = { material: (matBy(l.material) || {}).code || l.material, uom: l.uom || (matBy(l.material) || {}).uom || '', required: 0 }); r.required += num(l.required); });
  return Object.values(g).map(r => {
    r.issued = issuedToJc(j.no, r.material); r.taken = kitTaken(j.no, proc, r.material);
    r.toKit = r3(Math.max(0, r.required - r.issued - r.taken)); r.free = r3(freeStock(r.material)); r.short = r3(Math.max(0, r.toKit - r.free));
    return r;
  }).filter(r => r.toKit > 1e-9);
}
function kitConsumables() {
  return Store.all('materials').filter(m => norm(m.group) === 'consumable item').map(m => ({ m, stock: stockOf(m.code), min: num(m.min_level) })).sort((a, b) => (a.stock < a.min) === (b.stock < b.min) ? String(a.m.name).localeCompare(String(b.m.name)) : a.stock < a.min ? -1 : 1);
}
function kitTaskClose(kind, kit, how) {
  Store.all('checklist').filter(t => t.kind === kind && ((kit.id && t.kit_id === kit.id) || (t.jc_no && norm(t.jc_no) === norm(kit.jc_no) && norm(t.process || '') === norm(kit.process))) && !(t.done && t.done.once)).forEach(t => {
    t.done = t.done || {}; t.done.once = { at: nowIso(), by: 'System', remark: how, photos: 0, files: 0, log: '' }; t.done_at = nowIso(); Store.put('checklist', t);
  });
}

// Runs on Home and on the Kits screen: PPC tasks a week before a process is due; kits of dead job cards released
function kitRun() {
  if (typeof autoTask !== 'function' || typeof mtOpenJcs !== 'function') return;
  const horizon = ymdOf(new Date(Date.now() + KIT_LEAD_DAYS * 86400000));
  mtOpenJcs().forEach(j => kitProcesses(j).forEach(proc => {
    if (kitOf(j.no, proc)) return;
    const d = kitProdDate(j, proc); if (!d || d > horizon) return;
    if (!kitNeedRows(j, proc).length) return;
    if (Store.all('checklist').some(t => t.kind === 'kit_plan' && norm(t.jc_no) === norm(j.no) && norm(t.process || '') === norm(proc))) return;
    autoTask('Make the digital kit — ' + j.no + ' · ' + proc + ' (due ' + fmtD(d) + ')', autoDoer('kit_plan', 'PPC'), 0, { kind: 'kit_plan', jc_no: j.no, process: proc, party: j.no, ref: proc }, 'Kit');
  }));
  const live = new Set(mtOpenJcs().map(j => norm(j.no)));
  kitAll().filter(k => KIT_OPEN.includes(k.status) && !live.has(norm(k.jc_no))).forEach(k => {
    const was = k.status; k.status = 'Released'; k.released_at = nowIso(); k.released_why = 'job card closed or cancelled'; Store.put('kits', k);
    kitTaskClose('kit_build', k, 'released'); kitTaskClose('kit_approve', k, 'released');
    if (was === 'Approved') autoTask('Return kit ' + k.no + ' to stock — ' + k.jc_no + ' · ' + k.process + ' (job card closed)', autoDoer('kit_return', 'STORE'), 0, { kind: 'kit_return', kit_id: k.id, party: k.jc_no, ref: k.no }, 'Kit');
    audit('kit.release', k.no, k.jc_no + ' · ' + k.process + ' · was ' + was);
  });
}

/* ---------------- actions ---------------- */
ACTIONS['kit-new'] = () => { KIT_UI.form = !KIT_UI.form; KIT_UI.jc = ''; KIT_UI.proc = ''; VIEWS.kits.render(); };
ACTIONS['kit-make'] = () => {
  if (!kitCanPlan()) { flash('Only PPC can make a digital kit.', 'err'); return; }
  const j = jcBy(KIT_UI.jc); const proc = KIT_UI.proc; const msg = t => { $('#kitMsg').innerHTML = '<span class="late-txt">' + t + '</span>'; };
  if (!j || !proc) return msg('Pick the job card and the process.');
  if (kitOf(j.no, proc)) return msg('This process already has kit ' + kitOf(j.no, proc).no + '.');
  const rows = kitNeedRows(j, proc); if (!rows.length) return msg('Nothing left to kit for this process.');
  const lines = []; let bad = '';
  rows.forEach(r => { const q = num(($('[data-kq="' + r.material + '"]') || {}).value); if (q <= 0) return; if (q > r.toKit + 1e-9) bad = bad || r.material + ': more than the job card needs (' + qtyFmt(r.toKit) + ').'; else if (q > r.free + 1e-9) bad = bad || r.material + ': only ' + qtyFmt(r.free) + ' is free.'; else lines.push({ material: r.material, uom: r.uom, qty: r3(q), need: r.toKit }); });
  if (bad) return msg(esc(bad));
  const missing = rows.filter(r => r.short > 1e-9); if (missing.length) return msg('Kit pending — not enough in stock: ' + esc(missing.map(r => r.material + ' (short ' + qtyFmt(r.short) + ')').join(', ')) + '. A kit is made only when the full material of the process is in.');
  if (!lines.length) return msg('No quantity to kit.');
  const k = Store.put('kits', { id: uid(), no: nextNo('kits', 'KIT'), jc_no: j.no, process: proc, brand: j.brand || '', article: j.article || '', colour: j.colour || '', prod_date: kitProdDate(j, proc), lines, status: 'Planned', by: ME.name, at: nowIso() });
  kitTaskClose('kit_plan', k, 'digital kit made');
  if (typeof autoTask === 'function') autoTask('Build kit ' + k.no + ' — ' + j.no + ' · ' + proc + ' (' + lines.length + ' items)', autoDoer('kit_build', 'STORE'), 1, { kind: 'kit_build', kit_id: k.id, party: j.no, ref: k.no }, 'Kit');
  audit('kit.plan', k.no, j.no + ' · ' + proc + ' · ' + lines.map(l => l.material + '×' + qtyFmt(l.qty)).join(', '));
  KIT_UI.form = false; KIT_UI.open = k.id; flash(esc(k.no) + ' made — the Store has a task to build it.'); VIEWS.kits.render();
};
ACTIONS['kit-built'] = el => {
  if (!kitCanBuild()) return; const k = Store.get('kits', el.dataset.id); if (!k || k.status !== 'Planned') return;
  k.status = 'Built'; k.built_by = ME.name; k.built_at = nowIso(); Store.put('kits', k);
  kitTaskClose('kit_build', k, 'built');
  if (typeof autoTask === 'function') autoTask('Approve kit ' + k.no + ' — ' + k.jc_no + ' · ' + k.process, autoDoer('kit_approve', 'PPC'), 0, { kind: 'kit_approve', kit_id: k.id, party: k.jc_no, ref: k.no }, 'Kit');
  audit('kit.built', k.no, k.jc_no + ' · ' + k.process); flash(esc(k.no) + ' built — waiting for PPC to approve it.'); VIEWS.kits.render();
};
ACTIONS['kit-approve'] = el => {
  if (!kitCanPlan()) { flash('Only PPC can approve a kit.', 'err'); return; }
  const k = Store.get('kits', el.dataset.id); if (!k || k.status !== 'Built') return;
  formDialog('Approve ' + k.no + ' · ' + k.jc_no + ' · ' + k.process, k.lines.map(l => ({ k: l.material, l: ((matBy(l.material) || {}).name || l.material) + ' — found (of ' + qtyFmt(l.qty) + ' ' + l.uom + ')', type: 'number', value: l.qty, req: true })), 'Approve — lock the kit', v => {
    const shorts = [];
    k.lines.forEach(l => { const f = num(v[l.material]); if (f < 0 || f > num(l.qty) + 1e-9) { shorts.length = 0; shorts.push(null); return; } if (f < num(l.qty) - 1e-9) shorts.push({ material: l.material, gap: r3(num(l.qty) - f) }); l.found = r3(f); });
    if (shorts.some(x => x === null)) return 'Found cannot be more than the kit quantity or less than 0.';
    k.lines.forEach(l => { l.planned_qty = l.qty; l.qty = l.found != null ? l.found : l.qty; });
    k.status = 'Approved'; k.approved_by = ME.name; k.approved_at = nowIso(); Store.put('kits', k);
    kitTaskClose('kit_approve', k, 'approved');
    shorts.forEach(x => { if (typeof stockAdjNew === 'function') stockAdjNew(x.material, -x.gap, 'Short in kit ' + k.no + ' · ' + k.jc_no + ' · ' + k.process, 'kit', k.no); });
    audit('kit.approve', k.no, k.jc_no + ' · ' + k.process + (shorts.length ? ' · short: ' + shorts.map(x => x.material + ' −' + qtyFmt(x.gap)).join(', ') : ''));
    flash(esc(k.no) + ' approved and locked.' + (shorts.length ? ' ' + shorts.length + ' shortfall(s) raised as stock adjustments.' : '')); VIEWS.kits.render(); return '';
  });
};
ACTIONS['kit-sendback'] = el => {
  if (!kitCanPlan()) return; const k = Store.get('kits', el.dataset.id); if (!k || k.status !== 'Built') return;
  reasonDialog('Send ' + k.no + ' back to the Store', 'Send back', why => {
    k.status = 'Planned'; k.sent_back = why; Store.put('kits', k); kitTaskClose('kit_approve', k, 'sent back');
    if (typeof autoTask === 'function') autoTask('Build kit ' + k.no + ' again — ' + k.jc_no + ' · ' + k.process + ' (' + why + ')', autoDoer('kit_build', 'STORE'), 0, { kind: 'kit_build', kit_id: k.id, party: k.jc_no, ref: k.no }, 'Kit');
    audit('kit.sendback', k.no, why); flash(esc(k.no) + ' sent back to the Store.'); VIEWS.kits.render();
  });
};
// Issue = open the kit number and submit: every line goes to the job card, already approved by PPC
ACTIONS['kit-issue'] = el => {
  if (!kitCanBuild()) return; const k = Store.get('kits', el.dataset.id); if (!k || k.status !== 'Approved') return;
  const j = jcBy(k.jc_no); if (!j) { flash('Job card not found.', 'err'); return; }
  formDialog('Issue ' + k.no + ' · ' + k.jc_no + ' · ' + k.process, [{ k: 'line', l: 'Line', type: 'select', options: [''].concat(Store.all('prod_lines').filter(x => x.active !== false).map(x => x.name).filter(Boolean)) }, { k: 'picker', l: 'Picker name', req: true },
    { k: 'what', l: 'Items', type: 'static', value: k.lines.map(l => ((matBy(l.material) || {}).name || l.material) + ' × ' + qtyFmt(l.qty) + ' ' + l.uom).join(', ') }], 'Issue the kit', v => {
    const slip = k.no;
    k.lines.forEach(l => { if (num(l.qty) <= 0) return; Store.put('issues', { id: uid(), no: nextNo('issues', 'ISS'), slip_no: slip, req_qty: num(l.qty), date: todayYmd(), material: l.material, qty: num(l.qty), source: 'KIT', to_jc: k.jc_no, to_dept: 'Production', process: k.process, line: v.line || '', picker: v.picker, issue_type: 'Kit', req_no: k.no, kit_id: k.id, status: 'Approved', approved_by: k.approved_by, approved_at: nowIso(), by: ME.name, at: nowIso() }); });
    k.status = 'Issued'; k.issued_by = ME.name; k.issued_at = nowIso(); k.line = v.line || ''; k.picker = v.picker; Store.put('kits', k);
    audit('kit.issue', k.no, k.jc_no + ' · ' + k.process + ' · ' + k.lines.length + ' items → ' + (v.line || 'line') + ' · ' + v.picker);
    flash(esc(k.no) + ' issued to ' + esc(k.jc_no) + '.'); VIEWS.kits.render(); return '';
  });
};
ACTIONS['kit-break'] = el => {
  if (!kitCanBreak()) { flash('Only the Planning Head can break a kit.', 'err'); return; }
  const k = Store.get('kits', el.dataset.id); if (!k || !KIT_OPEN.includes(k.status)) return;
  reasonDialog('Break ' + k.no + ' · ' + k.jc_no + ' · ' + k.process + ' — the material goes back to common stock', 'Break the kit', why => {
    const was = k.status; k.status = 'Broken'; k.broken_by = ME.name; k.broken_at = nowIso(); k.broken_why = why; Store.put('kits', k);
    kitTaskClose('kit_build', k, 'broken'); kitTaskClose('kit_approve', k, 'broken');
    if (was === 'Approved' && typeof autoTask === 'function') autoTask('Return kit ' + k.no + ' to stock — ' + k.jc_no + ' · ' + k.process + ' (broken: ' + why + ')', autoDoer('kit_return', 'STORE'), 0, { kind: 'kit_return', kit_id: k.id, party: k.jc_no, ref: k.no }, 'Kit');
    audit('kit.break', k.no, k.jc_no + ' · ' + k.process + ' · was ' + was + ' · ' + why); flash(esc(k.no) + ' broken — material is common stock again.'); VIEWS.kits.render();
  }, true);
};
ACTIONS['kit-open'] = el => { KIT_UI.open = KIT_UI.open === el.dataset.id ? null : el.dataset.id; VIEWS.kits.render(); };

/* ---------------- screen ---------------- */
const kitChip = k => '<span class="st ' + ({ Planned: 'Pending', Built: 'Pending', Approved: 'Done', Issued: 'Done', Broken: 'Late', Released: 'Waiting' })[k.status] + '">' + esc(k.status === 'Approved' ? 'Approved · locked' : k.status) + '</span>';
VIEWS.kits = {
  mod: 'production', render() {
    try { kitRun(); } catch (e) { console.error(e); }
    const plan = kitCanPlan(), build = kitCanBuild();
    let list = kitAll().slice().sort((a, b) => a.at < b.at ? 1 : -1);
    if (KIT_UI.f === 'open') list = list.filter(k => KIT_OPEN.includes(k.status)); else if (KIT_UI.f === 'mine') list = list.filter(k => (build && k.status === 'Planned') || (plan && k.status === 'Built') || (build && k.status === 'Approved'));
    // what is due: processes within a week with no kit yet
    const due = []; const horizon = ymdOf(new Date(Date.now() + KIT_LEAD_DAYS * 86400000));
    if (typeof mtOpenJcs === 'function') mtOpenJcs().forEach(j => kitProcesses(j).forEach(proc => { if (kitOf(j.no, proc)) return; const d = kitProdDate(j, proc); const rows = kitNeedRows(j, proc); if (!rows.length) return; due.push({ j, proc, d, rows, short: rows.filter(r => r.short > 1e-9), soon: d && d <= horizon }); }));
    due.sort((a, b) => (a.d || '9999') < (b.d || '9999') ? -1 : 1);
    let h = '<div class="toolbar">' + seg('kitf', [{ v: 'mine', l: 'With me' }, { v: 'open', l: 'Open kits' }, { v: 'all', l: 'All' }], KIT_UI.f) + '<span class="grow"></span>' +
      (plan ? '<button class="btn ' + (KIT_UI.form ? '' : 'primary') + '" data-act="kit-new">' + (KIT_UI.form ? 'Close' : '+ Digital kit') + '</button>' : '') + '</div>';
    if (KIT_UI.form && plan) {
      const jcs = (typeof mtOpenJcs === 'function' ? mtOpenJcs() : []).slice().sort((a, b) => String(a.no).localeCompare(String(b.no)));
      const j = jcBy(KIT_UI.jc); const procs = j ? kitProcesses(j) : [];
      const rows = j && KIT_UI.proc ? kitNeedRows(j, KIT_UI.proc) : [];
      const dueD = j && KIT_UI.proc ? kitProdDate(j, KIT_UI.proc) : '';
      h += '<div class="card"><div class="card-b"><div class="inwform">' + kvTable([
        ['Job card *', '<select id="kitJc"><option value="">Select…</option>' + jcs.map(x => '<option value="' + esc(x.no) + '"' + (x.no === KIT_UI.jc ? ' selected' : '') + '>' + esc(x.no + ' · ' + (x.brand || '') + ' · ' + (x.article || '') + (x.colour ? ' ' + x.colour : '')) + '</option>').join('') + '</select>'],
        ['Process *', '<select id="kitProc"' + (j ? '' : ' disabled') + '><option value="">' + (j ? 'Select…' : 'pick the job card first') + '</option>' + procs.map(p => '<option' + (p === KIT_UI.proc ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '</select>'],
        ['Production date', dueD ? fmtD(dueD) : '<span class="muted">—</span>']
      ]) + '<div></div></div>';
      if (rows.length) {
        h += '<div class="tbl-wrap" style="margin-top:10px"><table class="nofilter nopage"><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Required</th><th class="num">Issued</th><th class="num">Already kitted</th><th class="num">To kit</th><th class="num">Free stock</th><th class="num">Kit qty</th><th>Status</th></tr>' +
          rows.map(r => { const m = matBy(r.material) || {}; return '<tr><td><b>' + esc(r.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(r.uom) + '</td><td class="num">' + qtyFmt(r.required) + '</td><td class="num">' + qtyFmt(r.issued) + '</td><td class="num">' + (r.taken ? qtyFmt(r.taken) : '') + '</td><td class="num"><b>' + qtyFmt(r.toKit) + '</b></td><td class="num">' + qtyFmt(r.free) + '</td><td><input class="qty right" type="number" min="0" step="any" data-kq="' + esc(r.material) + '" value="' + Math.min(r.toKit, r.free) + '"></td><td>' + (r.short > 1e-9 ? '<span class="st Late">short ' + qtyFmt(r.short) + '</span>' : '<span class="st Done">ok</span>') + '</td></tr>'; }).join('') + '</table></div>';
        const cons = kitConsumables();
        if (cons.length) h += '<div class="small muted" style="margin:10px 0 4px">Consumables in stock (not part of the kit)</div><div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Item</th><th class="num">Stock</th><th>UOM</th><th class="num">Min level</th><th></th></tr>' +
          cons.slice(0, 12).map(c => '<tr><td>' + esc(c.m.name) + '</td><td class="num">' + qtyFmt(c.stock) + '</td><td>' + esc(c.m.uom || '') + '</td><td class="num">' + (c.min ? qtyFmt(c.min) : '') + '</td><td>' + (c.min && c.stock < c.min ? '<span class="st Pending">low</span>' : '') + '</td></tr>').join('') + '</table></div>';
      } else if (j && KIT_UI.proc) h += '<div class="small muted" style="margin-top:8px">Nothing left to kit for this process.</div>';
      h += '</div><div class="card-f"><button class="btn primary" data-act="kit-make"' + (rows.length ? '' : ' disabled') + '>Make digital kit</button><span id="kitMsg" class="small"></span></div></div>';
    }
    if (due.length && (plan || build)) h += '<div class="card" style="margin-top:12px"><div class="card-b"><div class="dh3" style="padding:0 0 6px">Kits due<span class="n' + (due.some(x => x.soon) ? ' red' : '') + '">' + due.filter(x => x.soon).length + '</span><span class="muted small" style="margin-left:8px">processes due within ' + KIT_LEAD_DAYS + ' days with no kit yet</span></div>' +
      '<div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Job Card</th><th>Article</th><th>Process</th><th>Production date</th><th class="num">Items</th><th>Material</th></tr>' +
      due.slice(0, 40).map(x => '<tr' + (x.soon ? '' : ' class="muted"') + '><td><b>' + esc(x.j.no) + '</b></td><td>' + esc((x.j.brand || '') + ' · ' + (x.j.article || '')) + '</td><td>' + esc(x.proc) + '</td><td class="nowrap">' + (x.d ? fmtD(x.d) : '<span class="muted">not planned</span>') + '</td><td class="num">' + x.rows.length + '</td><td>' + (x.short.length ? '<span class="st Late">short: ' + esc(x.short.map(r => r.material).join(', ')) + '</span>' : '<span class="st Done">all in stock</span>') + '</td></tr>').join('') + '</table></div></div></div>';
    h += '<div class="tbl-wrap" style="margin-top:12px"><table><tr><th>Kit</th><th>Job Card</th><th>Article</th><th>Process</th><th>Production date</th><th class="num">Items</th><th>Status</th><th>By</th><th>When</th><th></th></tr>' +
      (list.length ? list.map(k => '<tr class="click' + (KIT_UI.open === k.id ? ' lp-sel' : '') + '" data-act="kit-open" data-id="' + esc(k.id) + '"><td><b>' + esc(k.no) + '</b></td><td>' + esc(k.jc_no) + '</td><td>' + esc((k.brand || '') + ' · ' + (k.article || '') + (k.colour ? ' ' + k.colour : '')) + '</td><td>' + esc(k.process) + '</td><td class="nowrap">' + (k.prod_date ? fmtD(k.prod_date) : '') + '</td><td class="num">' + (k.lines || []).length + '</td><td>' + kitChip(k) + '</td><td>' + esc(k.status === 'Issued' ? k.issued_by : k.status === 'Approved' ? k.approved_by : k.status === 'Built' ? k.built_by : k.by) + '</td><td class="nowrap">' + fmtDT(k.status === 'Issued' ? k.issued_at : k.status === 'Approved' ? k.approved_at : k.status === 'Built' ? k.built_at : k.at) + '</td>' +
        '<td class="nowrap">' + (k.status === 'Planned' && build ? '<button class="btn sm primary" data-act="kit-built" data-id="' + esc(k.id) + '">Built</button> ' : '') + (k.status === 'Built' && plan ? '<button class="btn sm primary" data-act="kit-approve" data-id="' + esc(k.id) + '">Approve</button> <button class="btn sm" data-act="kit-sendback" data-id="' + esc(k.id) + '">Send back</button> ' : '') + (k.status === 'Approved' && build ? '<button class="btn sm primary" data-act="kit-issue" data-id="' + esc(k.id) + '">Issue</button> ' : '') + (KIT_OPEN.includes(k.status) && kitCanBreak() ? '<button class="btn sm danger" data-act="kit-break" data-id="' + esc(k.id) + '">Break</button>' : '') + '</td></tr>').join('')
        : '<tr><td colspan="10" class="empty">No kits</td></tr>') + '</table></div>';
    const o = KIT_UI.open ? Store.get('kits', KIT_UI.open) : null;
    if (o) h += '<div class="card" style="margin-top:12px"><div class="card-b"><h2 style="margin:0 0 8px">' + esc(o.no) + ' · ' + esc(o.jc_no) + ' · ' + esc(o.process) + ' ' + kitChip(o) + '</h2>' +
      '<div class="small muted">Made by ' + esc(o.by) + ' ' + fmtDT(o.at) + (o.built_at ? ' · built by ' + esc(o.built_by) + ' ' + fmtDT(o.built_at) : '') + (o.approved_at ? ' · approved by ' + esc(o.approved_by) + ' ' + fmtDT(o.approved_at) : '') + (o.issued_at ? ' · issued by ' + esc(o.issued_by) + ' ' + fmtDT(o.issued_at) + (o.picker ? ' to ' + esc(o.picker) : '') : '') + (o.broken_at ? ' · <span class="late-txt">broken by ' + esc(o.broken_by) + ' ' + fmtDT(o.broken_at) + ': ' + esc(o.broken_why) + '</span>' : '') + (o.sent_back ? ' · sent back: ' + esc(o.sent_back) : '') + '</div>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table class="nofilter nopage"><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Planned</th><th class="num">In kit</th></tr>' + (o.lines || []).map(l => '<tr><td><b>' + esc(l.material) + '</b></td><td>' + esc((matBy(l.material) || {}).name || '') + '</td><td>' + esc(l.uom || '') + '</td><td class="num">' + qtyFmt(l.planned_qty != null ? l.planned_qty : l.qty) + '</td><td class="num' + (l.planned_qty != null && num(l.qty) < num(l.planned_qty) - 1e-9 ? ' late-txt' : '') + '"><b>' + qtyFmt(l.qty) + '</b></td></tr>').join('') + '</table></div></div></div>';
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'kitf') { KIT_UI.f = e.detail; VIEWS.kits.render(); } });
    m.addEventListener('change', e => { if (e.target.id === 'kitJc') { KIT_UI.jc = e.target.value; KIT_UI.proc = ''; VIEWS.kits.render(); } else if (e.target.id === 'kitProc') { KIT_UI.proc = e.target.value; VIEWS.kits.render(); } });
  }
};
