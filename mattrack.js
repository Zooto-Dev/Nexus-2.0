/* Nexus 2.0 — Material tracking per job card.
   One common stock, nothing locked. For every open job card line this works out, every time the data changes:
   required · issued · reserved (booked at creation, trimmed to what is physically still there, earliest Plan date keeps it)
   · own PO and received (read live from the PO lines that name this job card) · transit (open PO quantity that will
   reach it: its own PO lines first, then whatever is left on other open lines, by Plan date) · to order · status.
   Purchase's Net Requirement is built from the same numbers, so there is one list and one truth. */
'use strict';

const MTK_UI = { f: 'all', q: '', open: null };
const MTK_TAT_H = 4;          // hours Purchase has to raise a PO before the line turns red

// the day a job card is planned on a line (Line Plan); '' when it is not planned yet
function mtPlanDate(j) {
  const ds = (typeof lpPlans === 'function' ? lpPlans() : []).filter(p => norm(p.jc_no) === norm(j.no) && p.date).map(p => p.date).sort();
  return ds[0] || '';
}
function mtOpenJcs() {
  const frozen = new Set(Store.all('orders').filter(o => o.priority === 'Cancelled' || o.priority === 'On Hold').map(o => norm(o.no)));
  return Store.all('job_cards').filter(j => j.status !== 'Closed' && j.status !== 'Cancelled' && !frozen.has(norm(j.order_no || '')));
}
// who gets material first: the earliest Plan date; no Plan date yet = after those that have one; then the job card made first
function mtOrder(a, b) {
  const pa = a.plan || '9999-99-99', pb = b.plan || '9999-99-99';
  return pa < pb ? -1 : pa > pb ? 1 : String(a.j.at || '').localeCompare(String(b.j.at || '')) || String(a.j.no).localeCompare(String(b.j.no));
}

function mtAll(excludePo) {   // excludePo: leave one PO out, to judge that PO itself at approval
  if (RES_CACHE.has('mtAll|' + (excludePo || ''))) return RES_CACHE.get('mtAll|' + (excludePo || ''));
  const jcs = mtOpenJcs().map(j => ({ j, plan: mtPlanDate(j) })).sort(mtOrder);
  // a PO that is saved but not yet approved already covers the need: it shows as 'PO awaiting approval', never as To order
  const pos = Store.all('purchase_orders').filter(p => !p.cancelled && ['Approved', 'Pending', 'Amend'].includes(p.approval) && p.id !== excludePo);
  const today = todayYmd(); const now = Date.now();
  // open PO lines per item, with how much is still to come on each
  const poByMat = {};
  pos.forEach(p => (p.lines || []).forEach((l, k) => {
    const pen = poLinePending(p, l, k); if (pen <= 1e-9) return;
    const key = norm(l.material); (poByMat[key] = poByMat[key] || []).push({ p, l, k, pen, left: pen, jc: norm(l.jc_no || ''), exp: p.expected || '', appr: p.approval === 'Approved' });
  }));
  // one row per job card + item (the same item on two sections of a job card is summed)
  const rows = []; const byMat = {};
  jcs.forEach(x => {
    const j = x.j; const g = {};
    (j.lines || []).forEach(l => {
      const k = norm(l.material);
      const r = g[k] || (g[k] = { jc: j.no, j, plan: x.plan, material: (matBy(l.material) || {}).code || l.material, uom: l.uom || (matBy(l.material) || {}).uom || '', required: 0, reserved: 0, hasRes: false });
      r.required += num(l.required); if (l.reserved != null) { r.reserved += num(l.reserved); r.hasRes = true; }
    });
    Object.values(g).forEach(r => {
      r.issued = issuedToJc(j.no, r.material);
      r.need = r3(Math.max(0, r.required - r.issued));
      r.kit = typeof kitHeldFor === 'function' ? r3(Math.min(kitHeldFor(j.no, r.material), r.need)) : 0;   // approved kit: physically set aside for this job card
      r.needRest = r3(Math.max(0, r.need - r.kit));
      r.resLeft = r3(Math.max(0, Math.min(r.reserved - r.issued - r.kit, r.needRest)));
      rows.push(r); (byMat[norm(r.material)] = byMat[norm(r.material)] || []).push(r);
    });
  });
  const free = {}, poLeft = {};
  Object.keys(byMat).forEach(k => {
    const L = poByMat[k] || [];
    // 1. stock: a reservation holds only while the material is physically there; the earliest Plan date keeps it
    let f = Math.max(0, stockOf(k) - (typeof reqHeld === 'function' ? reqHeld(k) : 0) - (typeof adjPending === 'function' ? adjPending(k) : 0) - (typeof kitHeld === 'function' ? kitHeld(k) : 0));
    byMat[k].forEach(r => { r.resEff = r3(Math.min(r.resLeft, f)); f = r3(f - r.resEff); r.borrowed = r3(r.resLeft - r.resEff); });
    free[k] = f;
    // 2. its own PO lines first, then what is left on any open line, in Plan-date order
    byMat[k].forEach(r => {
      r.poOrdered = 0; r.poReceived = 0; r.poNos = []; r.transit = 0; r.transitDue = ''; r.transitPend = 0; r.pendNos = [];
      pos.forEach(p => (p.lines || []).forEach((l, i) => {
        if (norm(l.material) !== k || norm(l.jc_no || '') !== norm(r.jc)) return;
        r.poOrdered += num(l.qty); r.poReceived += recvOf(p, l, i); if (!r.poNos.includes(p.no)) r.poNos.push(p.no);
      }));
      let gap = r3(Math.max(0, r.needRest - r.resEff));
      L.filter(x => x.jc === norm(r.jc)).forEach(x => { const t = Math.min(x.left, gap); if (t > 1e-9) { x.left = r3(x.left - t); gap = r3(gap - t); r.transit += t; if (!x.appr) { r.transitPend += t; if (!r.pendNos.includes(x.p.no)) r.pendNos.push(x.p.no); } else if (!r.transitDue || (x.exp && x.exp < r.transitDue)) r.transitDue = x.exp; } });
      r.gap = gap;
    });
    byMat[k].forEach(r => {
      let gap = r.gap;
      L.forEach(x => { if (gap <= 1e-9 || x.left <= 1e-9) return; const t = Math.min(x.left, gap); x.left = r3(x.left - t); gap = r3(gap - t); r.transit += t; if (!x.appr) { r.transitPend += t; if (!r.pendNos.includes(x.p.no)) r.pendNos.push(x.p.no); } else if (!r.transitDue || (x.exp && x.exp < r.transitDue)) r.transitDue = x.exp; });
      r.toOrder = r3(gap); r.transit = r3(r.transit); r.short = r3(Math.max(0, r.needRest - r.resEff));
      r.poOrdered = r3(r.poOrdered); r.poReceived = r3(r.poReceived);
    });
    poLeft[k] = r3(L.reduce((a, x) => a + x.left, 0));
  });
  // 3. one status per line, the worst thing wrong with it
  rows.forEach(r => {
    const ageH = (now - new Date(r.j.at || r.j.created_at || now).getTime()) / 36e5;
    if (r.need <= 1e-9) { r.st = 'Complete'; r.tone = 'ok'; }
    else if (r.needRest <= 1e-9) { r.st = 'In kit · locked'; r.tone = 'ok'; }
    else if (r.transit > 1e-9 && r.transitDue && r.transitDue < today) { r.st = 'Vendor late · due ' + fmtD(r.transitDue); r.tone = 'bad'; }
    else if (r.toOrder > 1e-9 && r.transit <= 1e-9) { r.st = ageH > MTK_TAT_H ? 'No PO yet · ' + Math.floor(ageH) + ' h past' : 'To order'; r.tone = ageH > MTK_TAT_H ? 'bad' : 'warn'; }
    else if (r.toOrder > 1e-9) { r.st = 'Transit ' + qtyFmt(r.transit) + ' · ' + qtyFmt(r.toOrder) + ' to order'; r.tone = ageH > MTK_TAT_H ? 'bad' : 'warn'; }
    else if (r.transit > 1e-9 && r.transitPend > 1e-9 && r.transit - r.transitPend <= 1e-9) { r.st = 'PO awaiting approval · ' + r.pendNos.join(', '); r.tone = 'warn'; }
    else if (r.transit > 1e-9) { r.st = 'Transit' + (r.transitDue ? ' · due ' + fmtD(r.transitDue) : '') + (r.transitPend > 1e-9 ? ' · ' + qtyFmt(r.transitPend) + ' awaiting PO approval' : ''); r.tone = 'warn'; }
    else { r.st = 'Reserved · in stock'; r.tone = 'ok'; }
  });
  // per job card
  const cards = jcs.map(x => {
    const L = rows.filter(r => r.jc === x.j.no);
    const bad = L.filter(r => r.tone === 'bad').length, warn = L.filter(r => r.tone === 'warn').length, done = L.filter(r => r.need <= 1e-9).length;
    const kits = typeof kitAll === 'function' ? kitAll().filter(k => norm(k.jc_no) === norm(x.j.no) && k.status !== 'Broken' && k.status !== 'Released') : [];
    return { j: x.j, plan: x.plan, rows: L, items: L.length, bad, warn, done, tone: bad ? 'bad' : warn ? 'warn' : 'ok', noRes: L.some(r => !r.hasRes), kits };
  });
  const out = { rows, cards, byMat, free, poLeft, poByMat };
  RES_CACHE.set('mtAll|' + (excludePo || ''), out);
  return out;
}

// Booking at job card creation: whatever is free now, after every earlier job card's reservation, up to Required.
// `lines` are the new job card's lines (not yet saved); the same item twice on the card books in order.
function mtBookLines(lines) {
  const A = mtAll(); const used = {};
  lines.forEach(l => {
    const k = norm(l.material);
    const held = (A.byMat[k] || []).reduce((a, r) => a + r.resEff, 0);
    const freeNow = Math.max(0, stockOf(k) - (typeof reqHeld === 'function' ? reqHeld(k) : 0) - held - (used[k] || 0));
    l.reserved = r3(Math.min(num(l.required), freeNow));
    used[k] = (used[k] || 0) + l.reserved;
  });
  return lines;
}
// Job card correction: each line keeps what it had (up to the new Required); any increase books from what is free now
function mtRebookLines(j, lines) {
  const A = mtAll(); const used = {};
  lines.forEach(l => {
    const k = norm(l.material);
    const keep = Math.min(num(l.required), l.reserved != null ? num(l.reserved) : 0);
    const held = (A.byMat[k] || []).filter(r => r.jc !== j.no).reduce((a, r) => a + r.resEff, 0);
    const freeNow = Math.max(0, stockOf(k) - (typeof reqHeld === 'function' ? reqHeld(k) : 0) - (typeof adjPending === 'function' ? adjPending(k) : 0) - held - (used[k] || 0));
    const extra = Math.min(Math.max(0, num(l.required) - keep), freeNow);
    l.reserved = r3(keep + extra); used[k] = (used[k] || 0) + keep + extra;
  });
  return lines;
}
// One-time booking for job cards made before this existed: in the order they were made, from what is free now.
function mtBookAll() {
  const A = mtAll(); const todo = A.cards.filter(c => c.noRes).sort((a, b) => String(a.j.at || '').localeCompare(String(b.j.at || '')));
  const used = {}; let n = 0;
  todo.forEach(c => {
    (c.j.lines || []).forEach(l => {
      if (l.reserved != null) return;
      const k = norm(l.material); const issued = issuedToJc(c.j.no, l.material);
      const held = (A.byMat[k] || []).reduce((a, r) => a + r.resEff, 0);
      const freeNow = Math.max(0, stockOf(k) - (typeof reqHeld === 'function' ? reqHeld(k) : 0) - held - (used[k] || 0));
      const take = r3(Math.min(Math.max(0, num(l.required) - issued), freeNow));
      l.reserved = r3(Math.min(num(l.required), issued + take)); used[k] = (used[k] || 0) + take;
    });
    Store.put('job_cards', c.j); n++;
  });
  if (n) audit('jc.book_reserved', String(n) + ' job cards', 'reservations booked from free stock, in the order the job cards were made');
  return n;
}

/* ---------------- screen: Merchant › Material Tracking ---------------- */
const mtChip = r => '<span class="st ' + (r.tone === 'bad' ? 'Late' : r.tone === 'warn' ? 'Pending' : 'Done') + '">' + esc(r.st) + '</span>';
function mtJcTable(c) {
  const rows = c.rows.slice().sort((a, b) => ({ bad: 0, warn: 1, ok: 2 })[a.tone] - ({ bad: 0, warn: 1, ok: 2 })[b.tone] || String(a.material).localeCompare(String(b.material)));
  return '<div class="tbl-wrap"><table class="nofilter"><tr><th>Item</th><th>Name</th><th>UOM</th><th class="num">Required</th><th class="num">Reserved</th><th class="num">In kit</th><th>PO Raised</th><th class="num">Received</th><th class="num">Issued</th><th class="num">Short</th><th class="num">Transit</th><th class="num">To order</th><th>Status</th></tr>' +
    (rows.length ? rows.map(r => { const m = matBy(r.material) || {};
      return '<tr><td><b>' + esc(r.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(r.uom) + '</td><td class="num">' + qtyFmt(r.required) + '</td>' +
        '<td class="num">' + qtyFmt(r.resEff) + (r.borrowed > 1e-9 ? '<div class="small late-txt">' + qtyFmt(r.borrowed) + ' went to another job card</div>' : '') + '</td><td class="num">' + (r.kit > 1e-9 ? qtyFmt(r.kit) : '') + '</td>' +
        '<td>' + (r.poOrdered > 0 ? qtyFmt(r.poOrdered) + ' <span class="muted small">' + esc(r.poNos.join(', ')) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (r.poOrdered > 0 ? qtyFmt(r.poReceived) : '') + '</td><td class="num">' + qtyFmt(r.issued) + '</td>' +
        '<td class="num' + (r.short > 1e-9 ? ' late-txt' : '') + '">' + (r.short > 1e-9 ? qtyFmt(r.short) : '') + '</td><td class="num">' + (r.transit > 1e-9 ? qtyFmt(r.transit) : '') + '</td><td class="num' + (r.toOrder > 1e-9 ? ' late-txt' : '') + '">' + (r.toOrder > 1e-9 ? qtyFmt(r.toOrder) : '') + '</td>' +
        '<td>' + mtChip(r) + '</td></tr>'; }).join('') : '<tr><td colspan="13" class="empty">No material lines</td></tr>') + '</table></div>';
}
VIEWS.mattrack = {
  mod: 'merchant', render() {
    const A = mtAll(); const bs = brandScope();
    const q = norm(MTK_UI.q);
    let cards = A.cards.filter(c => brandOk(c.j.brand, bs));
    if (MTK_UI.f === 'stuck') cards = cards.filter(c => c.bad); else if (MTK_UI.f === 'wait') cards = cards.filter(c => c.bad || c.warn);
    if (q) cards = cards.filter(c => [c.j.no, c.j.order_no, c.j.brand, c.j.article, c.j.colour].some(v => norm(v || '').includes(q)));
    cards.sort((a, b) => b.bad - a.bad || b.warn - a.warn || (a.plan || '9999') < (b.plan || '9999') ? -1 : 1);
    const noRes = A.cards.filter(c => c.noRes).length;
    let h = '<div class="toolbar">' + seg('mtf', [{ v: 'stuck', l: 'Stuck' }, { v: 'wait', l: 'Stuck + waiting' }, { v: 'all', l: 'All open' }], MTK_UI.f) +
      '<input id="mtQ" placeholder="Search job card, order, article" value="' + esc(MTK_UI.q) + '" style="max-width:260px"><span class="grow"></span>' +
      (noRes && isSuperAdmin() ? '<button class="btn sm primary" data-act="mt-book" data-confirm="Book reservations for ' + noRes + ' job card(s) made before this screen existed? Each takes what is free now, in the order the job cards were made.">Book reservations · ' + noRes + '</button>' : '') +
      '<span class="muted small">' + A.cards.filter(c => c.bad).length + ' stuck · ' + A.cards.filter(c => !c.bad && c.warn).length + ' waiting · ' + A.cards.length + ' open</span></div>';
    // the register: one row per job card + item, exactly like the Job Card sheet — Required, Reserved, PO Raised, Received, To order
    const tone = { bad: 0, warn: 1, ok: 2 };
    let n = 0;
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Job Card</th><th>Brand</th><th>Article</th><th>Colour</th><th class="num">Pairs</th><th>Plan date</th><th>Item</th><th>Name</th><th>UOM</th><th class="num">Required</th><th class="num">Reserved</th><th class="num">In kit</th><th class="num">PO Raised</th><th>PO No</th><th class="num">Received</th><th class="num">Issued</th><th class="num">Transit</th><th class="num">To order</th><th>Status</th></tr>' +
      (cards.length ? cards.map(c => {
        const rows = c.rows.slice().sort((a, b) => tone[a.tone] - tone[b.tone] || String(a.material).localeCompare(String(b.material)));
        if (!rows.length) return '<tr class="bomfirst"><td><b>' + esc(c.j.no) + '</b><div class="small muted">' + esc(c.j.order_no || '') + '</div></td><td>' + esc(c.j.brand || '') + '</td><td>' + esc(c.j.article || '') + '</td><td>' + esc(c.j.colour || '') + '</td><td class="num">' + qtyFmt(c.j.qty) + '</td><td class="nowrap">' + (c.plan ? fmtD(c.plan) : '<span class="muted">not planned</span>') + '</td><td colspan="13" class="muted">No material lines on this job card</td></tr>';
        return rows.map((r, k) => { const m = matBy(r.material) || {}; n++;
          return '<tr' + (k === 0 ? ' class="bomfirst"' : '') + '>' +
            (k === 0 ? '<td rowspan="' + rows.length + '"><b>' + esc(c.j.no) + '</b><div class="small muted">' + esc(c.j.order_no || '') + '</div></td><td rowspan="' + rows.length + '">' + esc(c.j.brand || '') + '</td><td rowspan="' + rows.length + '">' + esc(c.j.article || '') + '</td><td rowspan="' + rows.length + '">' + esc(c.j.colour || '') + '</td><td rowspan="' + rows.length + '" class="num">' + qtyFmt(c.j.qty) + '</td><td rowspan="' + rows.length + '" class="nowrap">' + (c.plan ? fmtD(c.plan) : '<span class="muted">not planned</span>') + '</td>' : '') +
            '<td><b>' + esc(r.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(r.uom) + '</td><td class="num">' + qtyFmt(r.required) + '</td>' +
            '<td class="num">' + qtyFmt(r.resEff) + (r.borrowed > 1e-9 ? '<div class="small late-txt">' + qtyFmt(r.borrowed) + ' to another JC</div>' : '') + '</td><td class="num">' + (r.kit > 1e-9 ? qtyFmt(r.kit) : '') + '</td>' +
            '<td class="num">' + (r.poOrdered > 0 ? qtyFmt(r.poOrdered) : '') + '</td><td class="small nowrap">' + esc((r.poNos || []).join(', ')) + '</td>' +
            '<td class="num">' + (r.poOrdered > 0 ? qtyFmt(r.poReceived) : '') + '</td><td class="num">' + (r.issued > 1e-9 ? qtyFmt(r.issued) : '') + '</td><td class="num">' + (r.transit > 1e-9 ? qtyFmt(r.transit) : '') + '</td>' +
            '<td class="num' + (r.toOrder > 1e-9 ? ' late-txt' : '') + '"><b>' + (r.toOrder > 1e-9 ? qtyFmt(r.toOrder) : '') + '</b></td><td>' + mtChip(r) + '</td></tr>'; }).join('');
      }).join('') : '<tr><td colspan="19" class="empty">' + (MTK_UI.f === 'stuck' ? 'Nothing is stuck' : 'No open job cards') + '</td></tr>') + '</table></div>';
    const m = setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'mtf') { MTK_UI.f = e.detail; VIEWS.mattrack.render(); } });
    const qi = $('#mtQ'); if (qi) qi.addEventListener('input', () => { MTK_UI.q = qi.value; const pos = qi.selectionStart; VIEWS.mattrack.render(); const q2 = $('#mtQ'); if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); } });
  }
};
ACTIONS['mt-open'] = el => { MTK_UI.open = MTK_UI.open === el.dataset.jc ? null : el.dataset.jc; VIEWS.mattrack.render(); };
ACTIONS['mt-close'] = () => { MTK_UI.open = null; VIEWS.mattrack.render(); };
ACTIONS['mt-book'] = () => { if (!isSuperAdmin()) return; const n = mtBookAll(); flash(n ? 'Reservations booked for ' + n + ' job card(s).' : 'Nothing to book.'); VIEWS.mattrack.render(); };
