/* Nexus 2.0 — Purchase Dashboard: headline numbers, charts (inline SVG with hover tooltips) and insight tables. */
'use strict';

/* ---------- small chart kit ---------- */
const VZ = { s1: '#2a78d6', s2: '#eb6834', good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b', grid: '#e8ecf1', axis: '#6b7482', ink: '#1c2430' };
function inr(v) {   // ₹ in lakh / crore
  v = num(v); const a = Math.abs(v);
  if (a >= 1e7) return '₹' + (v / 1e7).toFixed(a >= 1e8 ? 1 : 2) + ' Cr';
  if (a >= 1e5) return '₹' + (v / 1e5).toFixed(a >= 1e6 ? 1 : 2) + ' L';
  if (a >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(v);
}
function vzNice(max) { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const vzE = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// rounded top only (4px data-end), flat on the baseline
function vzBarPath(x, y, w, h, r) { r = Math.min(r, w / 2, h); if (h <= 0) return ''; return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }
function vzHBarPath(x, y, w, h, r) { r = Math.min(r, h / 2, w); if (w <= 0) return ''; return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z'; }
function vzEmpty(t) { return '<div class="vz-empty">' + esc(t || 'No data yet') + '</div>'; }
// vertical bars; series = [{name, color, values[]}] stacked when more than one
function vzColumns(labels, series, fmt, opt) {
  opt = opt || {};
  const W = 560, H = 230, L = 52, R = 10, T = 14, B = 30, iw = W - L - R, ih = H - T - B;
  const tot = labels.map((_, i) => series.reduce((a, s) => a + num(s.values[i]), 0));
  if (!tot.some(v => v > 0)) return vzEmpty(opt.empty);
  const mx = Math.max(...tot), max = opt.int ? Math.max(4, Math.ceil(mx / 4) * 4) : vzNice(mx), step = iw / labels.length, bw = Math.min(46, step * 0.62);
  let g = '';
  for (let k = 0; k <= 4; k++) { const y = T + ih - ih * k / 4; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + VZ.grid + '"/><text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="vz-ax">' + vzE(fmt(max * k / 4)) + '</text>'; }
  labels.forEach((lb, i) => {
    const x = L + step * i + (step - bw) / 2; let base = T + ih;
    const tip = '<b>' + vzE(lb) + '</b>' + series.map(s => '<br><i style="background:' + s.color + '"></i>' + vzE(s.name) + ': ' + vzE(fmt(num(s.values[i])))).join('') + (series.length > 1 ? '<br>Total: ' + vzE(fmt(tot[i])) : '');
    g += '<g class="vz-hit" data-tip="' + vzE(tip) + '"><rect x="' + (L + step * i) + '" y="' + T + '" width="' + step + '" height="' + ih + '" fill="transparent"/>';
    series.forEach((s, si) => {
      const h = ih * num(s.values[i]) / max; if (h <= 0) return;
      const top = si === series.length - 1 || series.slice(si + 1).every(z => !num(z.values[i]));
      const y = base - h;
      g += top ? '<path d="' + vzBarPath(x, y, bw, h - (si ? 0 : 0), 4) + '" fill="' + s.color + '"/>' : '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h - 2) + '" fill="' + s.color + '"/>';
      base = y;
    });
    g += '</g><text x="' + (L + step * i + step / 2) + '" y="' + (H - 10) + '" text-anchor="middle" class="vz-ax">' + vzE(lb) + '</text>';
  });
  // selective direct label: the latest period
  const li = labels.length - 1; if (tot[li] > 0) g += '<text x="' + (L + step * li + step / 2) + '" y="' + (T + ih - ih * tot[li] / max - 6) + '" text-anchor="middle" class="vz-lb">' + vzE(fmt(tot[li])) + '</text>';
  const legend = series.length > 1 ? '<div class="vz-leg">' + series.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') + '</div>' : '';
  return legend + '<svg class="vz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + vzE(opt.aria || '') + '">' + g + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '" stroke="#c7cdd5"/></svg>';
}
// horizontal ranking bars; rows = [{label, value, color?, sub?}]
function vzBars(rows, fmt, opt) {
  opt = opt || {};
  if (!rows.length || !rows.some(r => r.value > 0)) return vzEmpty(opt.empty);
  const W = 560, rowH = 30, L = 170, R = 74, H = rows.length * rowH + 6, iw = W - L - R;
  const max = Math.max(...rows.map(r => r.value));
  let g = '';
  rows.forEach((r, i) => {
    const y = 4 + i * rowH, w = iw * r.value / max, bh = 16;
    const name = r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label;
    g += '<g class="vz-hit" data-tip="' + vzE('<b>' + vzE(r.label) + '</b><br>' + vzE(fmt(r.value)) + (r.sub ? '<br>' + vzE(r.sub) : '')) + '">' +
      '<rect x="0" y="' + y + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>' +
      '<text x="' + (L - 10) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end" class="vz-cat">' + vzE(name) + '</text>' +
      '<rect x="' + L + '" y="' + (y + (rowH - bh) / 2) + '" width="' + iw + '" height="' + bh + '" rx="4" fill="#f1f4f8"/>' +
      (r.value > 0 ? '<path d="' + vzHBarPath(L, y + (rowH - bh) / 2, Math.max(3, w), bh, 4) + '" fill="' + (r.color || VZ.s1) + '"/>' : '') +
      '<text x="' + (L + iw + 8) + '" y="' + (y + rowH / 2 + 4) + '" class="vz-val">' + vzE(fmt(r.value)) + '</text></g>';
  });
  return '<svg class="vz" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + vzE(opt.aria || '') + '">' + g + '</svg>';
}
// one floating tooltip for every chart
(function () {
  let tip = null;
  window.addEventListener('hashchange', () => { if (tip) tip.style.display = 'none'; });
  document.addEventListener('mousemove', e => {
    const h = e.target.closest && e.target.closest('.vz-hit');
    if (!h) { if (tip) tip.style.display = 'none'; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'vz-tip'; document.body.appendChild(tip); }
    tip.innerHTML = h.dataset.tip; tip.style.display = 'block';
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + ht > window.innerHeight - 8) y = e.clientY - ht - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
})();

/* ---------- purchase numbers ---------- */
function poLineVal(l) { return num(l.qty) * num(l.rate) * (1 + num(l.gst) / 100); }
function poVal(p) { return (p.lines || []).reduce((a, l) => a + poLineVal(l), 0); }
function poPendVal(p) { return (p.lines || []).reduce((a, l) => a + Math.max(0, num(l.qty) - num(l.received)) * num(l.rate) * (1 + num(l.gst) / 100), 0); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
function monthKeys(n) { const d = new Date(); const out = []; for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push({ k: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'), l: MON[x.getMonth()] + ' ' + String(x.getFullYear()).slice(2) }); } return out; }

VIEWS.purchasedash = {
  mod: 'purchase', render() {
    const today = todayYmd();
    const all = Store.all('purchase_orders');
    const live = all.filter(p => !p.cancelled && p.approval !== 'Rejected');
    const open = live.filter(p => poPending(p) > 0 && (poStatus(p) === 'Open' || poStatus(p) === 'Partial'));
    const apprPend = live.filter(p => !p.approval || p.approval === 'Pending');
    const overdue = open.filter(p => p.expected && p.expected < today);
    const fuDue = open.filter(p => { const f = (p.followups || []).slice(-1)[0]; return !f || !f.next || f.next <= today; });
    const net = netReqRows().filter(r => r.net > 0.0001);
    const reqOpen = typeof activeReqs === 'function' ? activeReqs().filter(r => !reqPo(r)) : [];
    const grns = Store.all('grns');
    const month = today.slice(0, 7);
    const lineRate = (po, mat) => { const l = (po && po.lines || []).find(x => norm(x.material) === norm(mat)); return l ? num(l.rate) * (1 + num(l.gst) / 100) : 0; };
    const grnVal = g => { const po = Store.get('purchase_orders', g.po_id); return (g.lines || []).reduce((a, l) => a + num(l.accepted) * lineRate(po, l.material), 0); };
    const recvMonth = grns.filter(g => (g.date || '').startsWith(month)).reduce((a, g) => a + grnVal(g), 0);
    // on-time = received on or before the PO expected date (last 90 days)
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const deliv = grns.filter(g => g.date && g.date >= since).map(g => { const po = Store.get('purchase_orders', g.po_id); return po && po.expected ? { g, po, late: g.date > po.expected, days: daysBetween(po.expected, g.date) } : null; }).filter(Boolean);
    const onTime = deliv.length ? Math.round(100 * deliv.filter(d => !d.late).length / deliv.length) : null;
    const openVal = open.reduce((a, p) => a + poPendVal(p), 0);

    // average hours from PO raised to approved (last 90 days)
    const apprList = live.filter(p => p.approved_at && p.at && p.approved_at >= since);
    const apprH = apprList.length ? apprList.reduce((a, p) => a + (new Date(p.approved_at) - new Date(p.at)) / 36e5, 0) / apprList.length : null;
    // job cards whose material is not in stock yet: which item, and is a PO on the way
    const openPoOf = mat => open.map(p => ({ p, l: (p.lines || []).find(l => norm(l.material) === norm(mat) && num(l.qty) > num(l.received)) })).filter(x => x.l).sort((a, b) => (a.p.expected || '9') < (b.p.expected || '9') ? -1 : 1);
    const jcShort = [];
    netReqRows().filter(r => r.stock + 1e-9 < r.demand).forEach(r => {
      let left = r.stock; const pos = openPoOf(r.material);
      r.jcs.filter(x => !x.req).forEach(x => {
        const short = Math.max(0, x.bal - Math.max(0, left)); left -= x.bal;
        if (short > 1e-9) jcShort.push({ jc: x.jc, brand: x.brand, mat: r.material, name: r.name, uom: r.uom, short, po: pos[0] || null });
      });
    });
    // price changes: the latest PO rate of an item against its previous PO rate
    const priceRows = [];
    const byMat = {}; live.slice().sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1).forEach(p => (p.lines || []).forEach(l => { if (num(l.rate) > 0) (byMat[norm(l.material)] = byMat[norm(l.material)] || []).push({ p, rate: num(l.rate), mat: l.material }); }));
    Object.values(byMat).forEach(list => { if (list.length < 2) return; const a = list[list.length - 2], b = list[list.length - 1]; if (a.rate === b.rate) return; priceRows.push({ mat: b.mat, name: (matBy(b.mat) || {}).name || '', oldV: a.p.vendor, newV: b.p.vendor, old: a.rate, now: b.rate, pct: (b.rate - a.rate) / a.rate * 100, date: b.p.date, po: b.p.no }); });
    priceRows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    const tile = (label, value, sub, href, tone) => '<a class="dt' + (tone ? ' dt-' + tone : '') + '"' + (href ? ' href="' + href + '"' : '') + '><span class="dt-l">' + esc(label) + '</span><b class="dt-v">' + value + '</b><span class="dt-s">' + sub + '</span></a>';
    let h = '<div class="dash">';
    h += '<div class="dtiles dt4">' +
      tile('Open PO value', esc(inr(openVal)), open.length + ' open PO' + (open.length === 1 ? '' : 's'), '#/po') +
      tile('Waiting for approval', apprPend.length, (apprPend.length ? esc(inr(apprPend.reduce((a, p) => a + poVal(p), 0))) + ' · ' : '') + 'avg approval ' + (apprH == null ? '—' : apprH < 24 ? apprH.toFixed(1) + ' h' : (apprH / 24).toFixed(1) + ' days'), '#/poapproval', apprPend.length ? 'warn' : 'good') +
      tile('Overdue POs', overdue.length, overdue.length ? esc(inr(overdue.reduce((a, p) => a + poPendVal(p), 0))) + ' pending' : 'Nothing late', '#/followup', overdue.length ? 'crit' : 'good') +
      tile('Followups due', fuDue.length, 'today or earlier', '#/followup', fuDue.length ? 'warn' : '') +
      tile('Items to order', net.length, reqOpen.length + ' requirement' + (reqOpen.length === 1 ? '' : 's') + ' open', '#/netreq', net.length ? 'warn' : '') +
      tile('Received this month', esc(inr(recvMonth)), grns.filter(g => (g.date || '').startsWith(month)).length + ' GRN(s)', '#/grnlist') +
      tile('On-time delivery', onTime == null ? '—' : onTime + '%', 'last 90 days · ' + deliv.length + ' GRN(s)', '', onTime == null ? '' : onTime >= 90 ? 'good' : onTime >= 70 ? 'warn' : 'crit') +
      tile('Job cards short of material', jcShort.length ? new Set(jcShort.map(x => x.jc)).size : 0, jcShort.filter(x => !x.po).length + ' item line(s) with no PO', '#/netreq', jcShort.some(x => !x.po) ? 'crit' : jcShort.length ? 'warn' : 'good') +
      '</div>';

    // charts
    const ms = monthKeys(6);
    const poByMonth = ms.map(m => live.filter(p => (p.date || '').startsWith(m.k)).reduce((a, p) => a + poVal(p), 0));
    const venOpen = {}; open.forEach(p => { venOpen[p.vendor] = (venOpen[p.vendor] || 0) + poPendVal(p); });
    const topVen = Object.keys(venOpen).map(v => ({ label: v, value: venOpen[v], sub: open.filter(p => p.vendor === v).length + ' open PO(s)' })).sort((a, b) => b.value - a.value).slice(0, 8);
    const age = [['Not due yet', VZ.good], ['1–7 days late', VZ.warn], ['8–15 days late', VZ.serious], ['16–30 days late', VZ.crit], ['30+ days late', '#9f1d1d']].map(([label, color]) => ({ label, color, value: 0, n: 0 }));
    open.forEach(p => { const d = p.expected ? daysBetween(p.expected, today) : 0; const i = d <= 0 ? 0 : d <= 7 ? 1 : d <= 15 ? 2 : d <= 30 ? 3 : 4; age[i].value += poPendVal(p); age[i].n++; });
    age.forEach(a => { a.sub = a.n + ' PO(s)'; });
    const allDeliv = grns.map(g => { const po = Store.get('purchase_orders', g.po_id); return po && po.expected && g.date ? { g, late: g.date > po.expected } : null; }).filter(Boolean);
    const onT6 = ms.map(m => allDeliv.filter(d => d.g.date.startsWith(m.k) && !d.late).length), late6 = ms.map(m => allDeliv.filter(d => d.g.date.startsWith(m.k) && d.late).length);
    const card = (title, sub, body) => '<div class="card dcard"><div class="dcard-h"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div><div class="dcard-b">' + body + '</div></div>';
    const chartsH = '<div class="dsec">Spend & delivery</div><div class="dgrid">' +
      card('PO value by month', 'incl. GST · last 6 months', vzColumns(ms.map(m => m.l), [{ name: 'PO value', color: VZ.s1, values: poByMonth }], inr, { aria: 'PO value by month', empty: 'No POs in the last 6 months' })) +
      card('Open PO value by vendor', 'top 8 · pending qty × rate', vzBars(topVen, inr, { aria: 'Open PO value by vendor', empty: 'No open POs' })) +
      card('Open POs by delay', 'pending value · days past expected date', vzBars(age, inr, { aria: 'Open POs by delay', empty: 'No open POs' })) +
      card('Deliveries: on time vs late', 'GRNs per month', vzColumns(ms.map(m => m.l), [{ name: 'On time', color: VZ.s1, values: onT6 }, { name: 'Late', color: VZ.s2, values: late6 }], v => String(Math.round(v)), { int: true, aria: 'Deliveries on time versus late', empty: 'No GRNs in the last 6 months' })) +
      '</div>';

    // insight tables
    const od = overdue.map(p => ({ p, d: daysBetween(p.expected, today), v: poPendVal(p), f: (p.followups || []).slice(-1)[0] })).sort((a, b) => b.d - a.d).slice(0, 10);
    const t1 = od.length ? '<div class="tbl-wrap"><table class="nofilter nopage"><tr><th>PO No</th><th>Vendor</th><th>Expected</th><th class="num">Days Late</th><th class="num">Pending Value</th><th>Last Followup</th></tr>' +
      od.map(x => '<tr class="click" data-act="go" data-v="po" data-p="' + esc(x.p.id) + '"><td><b>' + esc(x.p.no) + '</b></td><td>' + esc(x.p.vendor) + '</td><td>' + fmtD(x.p.expected) + '</td><td class="num"><span class="late-txt"><b>' + x.d + '</b></span></td><td class="num">' + esc(inr(x.v)) + '</td><td>' + (x.f ? esc(x.f.note) + ' <span class="muted">· ' + fmtD(x.f.at) + '</span>' : '<span class="muted">None</span>') + '</td></tr>').join('') + '</table></div>' : vzEmpty('No overdue POs');
    const tn = net.slice().sort((a, b) => b.net - a.net).slice(0, 10);
    const t2 = tn.length ? '<div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Item Code</th><th>Item Name</th><th>Supplier</th><th class="num">Net Req.</th><th>UOM</th><th class="num">Stock</th></tr>' +
      tn.map(r => '<tr class="click" data-act="go" data-v="netreq"><td><b>' + esc(r.material) + '</b></td><td>' + esc(r.name) + '</td><td>' + (Array.from(r.suppliers).map(esc).join(', ') || '<span class="late-txt">Select vendor</span>') + '</td><td class="num"><b>' + qtyFmt(r.net) + '</b></td><td>' + esc(r.uom) + '</td><td class="num">' + qtyFmt(r.stock) + '</td></tr>').join('') + '</table></div>' : vzEmpty('Nothing to order');
    const t3 = jcShort.length ? '<div class="tbl-wrap"><table class="nofilter nopage"><tr><th>JC No</th><th>Brand</th><th>Item</th><th class="num">Short</th><th>UOM</th><th>Material Coming</th></tr>' +
      jcShort.sort((a, b) => (!!a.po - !!b.po) || b.short - a.short).slice(0, 12).map(x => '<tr><td><b>' + esc(x.jc) + '</b></td><td>' + esc(x.brand || '') + '</td><td>' + esc(x.name) + ' <span class="muted">' + esc(x.mat) + '</span></td><td class="num"><b>' + qtyFmt(x.short) + '</b></td><td>' + esc(x.uom) + '</td><td>' +
        (!x.po ? '<span class="st Late">No PO</span>' : '<span class="st ' + (x.po.p.expected && x.po.p.expected < today ? 'Late' : 'Pending') + '">' + esc(x.po.p.no) + ' · ' + (x.po.p.expected ? fmtD(x.po.p.expected) : '') + '</span>') + '</td></tr>').join('') + '</table></div>' : vzEmpty('Every job card has its material in stock');
    const t4 = priceRows.length ? '<div class="tbl-wrap"><table class="nofilter nopage"><tr><th>Item</th><th>Vendor</th><th class="num">Last Rate</th><th class="num">New Rate</th><th class="num">Change</th><th>PO</th></tr>' +
      priceRows.slice(0, 10).map(x => '<tr><td>' + esc(x.name) + ' <span class="muted">' + esc(x.mat) + '</span></td><td>' + esc(x.newV) + (norm(x.oldV) !== norm(x.newV) ? ' <span class="muted">(was ' + esc(x.oldV) + ')</span>' : '') + '</td><td class="num">' + money(x.old) + '</td><td class="num">' + money(x.now) + '</td><td class="num"><b class="' + (x.pct > 0 ? 'late-txt' : 'ok-txt') + '">' + (x.pct > 0 ? '▲ +' : '▼ ') + x.pct.toFixed(1) + '%</b></td><td class="nowrap">' + esc(x.po) + ' · ' + fmtD(x.date) + '</td></tr>').join('') + '</table></div>' : vzEmpty('No rate changes between POs');
    h += '<div class="dsec">Needs attention</div>';
    h += '<div class="dgrid">' + card('Job cards waiting for material', 'stock short · is a PO on the way?', t3) + card('Overdue POs', 'most late first', t1) + '</div>';
    h += '<div class="dgrid">' + card('Items to order', 'highest net requirement', t2) + card('Price changes', 'latest PO rate vs the PO before it', t4) + '</div>';
    h += chartsH;

    // vendor performance
    const vp = {};
    live.forEach(p => { const v = vp[p.vendor] = vp[p.vendor] || { pos: 0, val: 0, open: 0, grn: 0, late: 0, delay: 0 }; v.pos++; v.val += poVal(p); v.open += poPendVal(p); });
    allDeliv.forEach(d => { const v = vp[d.g.vendor]; if (!v) return; v.grn++; if (d.late) { v.late++; v.delay += daysBetween(Store.get('purchase_orders', d.g.po_id).expected, d.g.date); } });
    const vrows = Object.keys(vp).map(n => Object.assign({ n }, vp[n])).sort((a, b) => b.val - a.val);
    h += '<div class="dsec">Vendors</div>';
    h += card('Vendor performance', 'all POs', vrows.length ? '<div class="tbl-wrap"><table><tr><th>Vendor</th><th class="num">POs</th><th class="num">PO Value</th><th class="num">Open Value</th><th class="num">GRNs</th><th class="num">On-time %</th><th class="num">Avg Days Late</th></tr>' +
      vrows.map(v => { const ot = v.grn ? Math.round(100 * (v.grn - v.late) / v.grn) : null; return '<tr><td><b>' + esc(v.n) + '</b></td><td class="num">' + v.pos + '</td><td class="num">' + money(Math.round(v.val)) + '</td><td class="num">' + money(Math.round(v.open)) + '</td><td class="num">' + v.grn + '</td><td class="num">' + (ot == null ? '' : '<span class="' + (ot >= 90 ? 'ok-txt' : ot >= 70 ? 'warn-txt' : 'late-txt') + '">' + ot + '%</span>') + '</td><td class="num">' + (v.late ? (v.delay / v.late).toFixed(1) : '') + '</td></tr>'; }).join('') + '</table></div>' : vzEmpty('No POs yet'));
    h += '</div>';
    setMain(h);
  }
};

/* ================= Merchant Dashboard: where each order is stuck, which step is the bottleneck, which doer holds work.
   A merchant sees the brands mapped to them in CDB (Merchandiser); Admin / Super Admin see all brands. ================= */
const MD_UI = { brand: '' };
function myBrandNames() { return Store.all('customers').filter(c => c.merchandiser && isMyMerchant(c.merchandiser)).map(c => c.name); }
VIEWS.merchantdash = {
  mod: 'merchant', render() {
    const admin = isAdminRole();
    const allowed = admin ? Store.all('customers').map(c => c.name).sort() : myBrandNames().sort();
    if (!admin && !allowed.length) { setMain('<div class="panel empty">No brand is mapped to you. Ask Admin to set you as Merchandiser in CDB.</div>'); return; }
    if (MD_UI.brand && !allowed.some(b => norm(b) === norm(MD_UI.brand))) MD_UI.brand = '';
    const inScope = o => MD_UI.brand ? norm(o.customer_name) === norm(MD_UI.brand) : (admin || allowed.some(b => norm(b) === norm(o.customer_name)));
    const now = new Date(), since30 = new Date(Date.now() - 30 * 864e5), in7 = new Date(Date.now() + 7 * 864e5);
    const orders = Store.all('orders').filter(o => o.priority !== 'Cancelled' && inScope(o));
    const live = [];          // open orders with their FMS state
    const stepAgg = {}, doerAgg = {}, brandAgg = {};
    let doneN = 0, doneLate = 0, dueSoon = 0;
    orders.forEach(o => {
      const r = resolveOrder(o); const st = orderState(o);
      const brand = o.customer_name || '—';
      if (r) r.order.forEach(id => {
        const s = r.steps[id]; if (!s || !s.applies) return;
        if (s.actual && new Date(s.actual) >= since30) { doneN++; if (s.delayMinutes > 0) doneLate++; }
        const late = s.status === 'Late' || (s.actual && new Date(s.actual) >= since30 && s.delayMinutes > 0);
        if (!late) return;
        const a = stepAgg[s.name] = stepAgg[s.name] || { min: 0, open: 0, done: 0 }; a.min += s.delayMinutes; s.status === 'Late' ? a.open++ : a.done++;
        const dn = s.doer || 'Not set'; const d = doerAgg[dn] = doerAgg[dn] || { min: 0, open: 0, done: 0 }; d.min += s.delayMinutes; s.status === 'Late' ? d.open++ : d.done++;
      });
      if (!st.open) return;
      const pend = dispatchedQty(o).pending;
      const lateSteps = r ? r.order.map(id => r.steps[id]).filter(s => s.status === 'Late') : [];
      const delay = lateSteps.reduce((m, s) => Math.max(m, s.delayMinutes), 0);
      const end = r && r.spec && r.spec.process ? r.steps[r.spec.process.endStep] : null;
      if (end && !end.actual && end.planned && end.planned <= in7) dueSoon++;
      live.push({ o, st, r, pend, lateSteps, delay, brand, end });
      const b = brandAgg[brand] = brandAgg[brand] || { open: 0, late: 0, qty: 0 }; b.open++; b.qty += pend; if (lateSteps.length) b.late++;
    });
    const delayed = live.filter(x => x.lateSteps.length);
    const onTime = doneN ? Math.round(100 * (doneN - doneLate) / doneN) : null;
    const tile = (label, value, sub, tone) => '<div class="dt' + (tone ? ' dt-' + tone : '') + '"><span class="dt-l">' + esc(label) + '</span><b class="dt-v">' + value + '</b><span class="dt-s">' + sub + '</span></div>';
    let h = '<div class="dash"><div class="toolbar" style="margin:0"><label style="flex-direction:row;align-items:center;gap:8px">Brand<select id="mdBrand" style="min-width:200px"><option value="">' + (admin ? 'All brands' : 'All my brands') + '</option>' + allowed.map(b => '<option' + (norm(b) === norm(MD_UI.brand) ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select></label></div>';
    h += '<div class="dtiles dt5">' +
      tile('Open orders', live.length, qtyFmt(live.reduce((a, x) => a + x.pend, 0)) + ' pairs pending') +
      tile('Delayed orders', delayed.length, live.length ? Math.round(100 * delayed.length / live.length) + '% of open orders' : 'No open orders', delayed.length ? 'crit' : 'good') +
      tile('Late steps now', delayed.reduce((a, x) => a + x.lateSteps.length, 0), 'across all open orders', delayed.length ? 'warn' : 'good') +
      tile('Dispatch due in 7 days', dueSoon, 'planned dispatch date', dueSoon ? 'warn' : '') +
      tile('Steps on time', onTime == null ? '—' : onTime + '%', 'last 30 days · ' + doneN + ' step(s) done', onTime == null ? '' : onTime >= 90 ? 'good' : onTime >= 70 ? 'warn' : 'crit') +
      '</div>';
    // where open orders are right now (current step), late vs on time, in flow order
    const flowOrder = []; live.forEach(x => { if (x.r) x.r.order.forEach(id => { const n = x.r.steps[id].name; if (!flowOrder.includes(n)) flowOrder.push(n); }); });
    const cur = {}; live.forEach(x => { const n = x.st.cur ? x.st.cur.name : x.st.label; const c = cur[n] = cur[n] || { late: 0, ok: 0 }; x.lateSteps.length ? c.late++ : c.ok++; });
    const curNames = Object.keys(cur).sort((a, b) => (flowOrder.indexOf(a) + 1 || 999) - (flowOrder.indexOf(b) + 1 || 999));
    const short = n => n.length > 14 ? n.slice(0, 13) + '…' : n;
    const card = (title, sub, body, wide) => '<div class="card dcard' + (wide ? ' dwide' : '') + '"><div class="dcard-h"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div><div class="dcard-b">' + body + '</div></div>';
    const dfmt = m => m ? fmtDelay(Math.round(m)) : '0';
    const stepRows = Object.keys(stepAgg).map(n => ({ label: n, value: stepAgg[n].min, sub: stepAgg[n].open + ' late now · ' + stepAgg[n].done + ' done late (30 days)' })).sort((a, b) => b.value - a.value).slice(0, 8);
    const doerRows = Object.keys(doerAgg).map(n => ({ label: n, value: doerAgg[n].min, sub: doerAgg[n].open + ' late now · ' + doerAgg[n].done + ' done late (30 days)', color: VZ.s2 })).sort((a, b) => b.value - a.value).slice(0, 8);
    h += '<div class="dgrid">' +
      card('Where orders are now', 'current step of each open order', vzColumns(curNames.map(short), [{ name: 'On time', color: VZ.s1, values: curNames.map(n => cur[n].ok) }, { name: 'Delayed', color: VZ.s2, values: curNames.map(n => cur[n].late) }], v => String(Math.round(v)), { int: true, aria: 'Open orders by current step', empty: 'No open orders' })) +
      card('Bottleneck steps', 'total delay · late now + done late in 30 days', vzBars(stepRows, dfmt, { aria: 'Delay by step', empty: 'No delays' })) +
      card('Delay by doer', 'who is holding the work', vzBars(doerRows, dfmt, { aria: 'Delay by doer', empty: 'No delays' })) +
      card('Delayed orders by brand', 'delayed / open orders', vzBars(Object.keys(brandAgg).map(n => ({ label: n, value: brandAgg[n].late, sub: brandAgg[n].late + ' of ' + brandAgg[n].open + ' open orders delayed · ' + qtyFmt(brandAgg[n].qty) + ' pairs pending', color: VZ.s2 })).sort((a, b) => b.value - a.value).slice(0, 8), v => String(Math.round(v)), { aria: 'Delayed orders by brand', empty: 'No delayed orders' })) +
      '</div>';
    // every open order with where it stands; most delayed first
    const rows = live.slice().sort((a, b) => b.delay - a.delay || (a.st.cur && b.st.cur ? a.st.cur.planned - b.st.cur.planned : 0));
    h += card('Open orders — where each one is', 'most delayed first', '<div class="tbl-wrap"><table><tr><th>Order No</th><th>Brand</th><th>Article</th><th class="num">Pending Qty</th><th>Current Step</th><th>Doer</th><th>Planned</th><th>Delay</th><th class="num">Late Steps</th><th>Late Step Names</th><th>Dispatch Planned</th></tr>' +
      (rows.length ? rows.map(x => { const c = x.st.cur; return '<tr class="click" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td><b>' + esc(x.o.no) + '</b></td><td>' + esc(x.brand) + '</td><td>' + esc(Array.from(new Set((x.o.lines || []).map(l => l.article).filter(Boolean))).join(', ')) + '</td><td class="num">' + qtyFmt(x.pend) + '</td>' +
        '<td>' + (c ? stHtml(c.status === 'Late' ? 'Late' : 'Pending').replace(/>(Late|Pending)</, '>' + esc(c.name) + '<') : esc(x.st.label)) + '</td><td>' + esc(c ? c.doer || '' : '') + '</td><td class="nowrap">' + (c && c.planned ? fmtDT(c.planned) : '') + '</td><td class="nowrap">' + (x.delay ? '<span class="late-txt">' + fmtDelay(Math.round(x.delay)) + '</span>' : '') + '</td>' +
        '<td class="num">' + (x.lateSteps.length || '') + '</td><td>' + esc(x.lateSteps.map(s => s.name).join(', ')) + '</td><td class="nowrap">' + (x.end && x.end.planned ? fmtD(x.end.planned) : '') + '</td></tr>'; }).join('') : '<tr><td colspan="11" class="empty">No open orders</td></tr>') + '</table></div>', true);
    h += '</div>';
    const m = setMain(h);
    $('#mdBrand', m).addEventListener('change', e => { MD_UI.brand = e.target.value; VIEWS.merchantdash.render(); });
  }
};
