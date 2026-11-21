/* Nexus 2.0 — Where the money is (Super Admin's Home).
   For every article: pairs ordered (the work), selling price − COGS per pair (the reward), and the two
   multiplied (the money). The quadrant chart answers the question the ranked bars cannot: an article can
   earn a lot because it sells in thousands at a thin margin, or because it sells a few hundred at a fat one.
   Selling price comes from the order line's rate when one is typed, else from the Articles master. */
'use strict';

const PF_UI = { per: 'fy', brand: '', sort: 'margin' };
const PF_PERIODS = [{ v: 'tm', l: 'This month' }, { v: 'q', l: 'Last 3 months' }, { v: 'h', l: 'Last 6 months' }, { v: 'fy', l: 'This FY' }, { v: 'all', l: 'All' }];
function pfRange(p) {
  const t = todayYmd(), d = new Date();
  if (p === 'tm') return { from: t.slice(0, 7) + '-01', to: t };
  if (p === 'q') return { from: ymdAdd(t, -90), to: t };
  if (p === 'h') return { from: ymdAdd(t, -182), to: t };
  if (p === 'fy') { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return { from: y + '-04-01', to: t }; }
  return { from: '0000-01-01', to: '9999-12-31' };
}
const pfArticle = (brand, code) => Store.all('items').find(i => norm(i.code) === norm(code) && (!i.brand || !brand || norm(i.brand) === norm(brand))) || Store.all('items').find(i => norm(i.code) === norm(code)) || null;
function pfSellPrice(brand, code, line) {
  if (line && num(line.rate) > 0) return num(line.rate);
  const a = pfArticle(brand, code); return a ? num(a.sell_price) : 0;
}
/* one row per brand + article inside the period */
function pfRows(per, brand) {
  const R = pfRange(per || PF_UI.per); const by = {};
  Store.all('orders').filter(o => o.priority !== 'Cancelled').forEach(o => {
    const d = o.order_date || (o.created_at || '').slice(0, 10); if (!d || d < R.from || d > R.to) return;
    const b = o.customer_name || o.brand || ''; if (brand && norm(b) !== norm(brand)) return;
    (o.lines || []).forEach(l => {
      if (!l.article) return; const k = norm(b) + '|' + norm(l.article);
      const g = by[k] || (by[k] = { brand: b, article: String(l.article).trim().toUpperCase(), qty: 0, revenue: 0, priced: 0, orders: new Set() });
      const q = num(l.qty); const rate = pfSellPrice(b, l.article, l);
      g.qty += q; g.orders.add(o.no); if (rate > 0) { g.revenue += q * rate; g.priced += q; }
    });
  });
  return Object.values(by).map(g => {
    const bom = (typeof amLatestBom === 'function' ? amLatestBom(g.brand, g.article).fin : null);
    const cogs = bom ? (typeof bomCogsOf === 'function' ? bomCogsOf(bom) : 0) : 0;
    const rate = g.priced ? g.revenue / g.priced : 0;
    const margin = rate && cogs ? r3(rate - cogs) : null;
    const noPrice = typeof bomNoPrice === 'function' ? bomNoPrice(bom) : [];
    return Object.assign(g, { orders: g.orders.size, bom, cogs, rate: r3(rate), margin, pct: margin != null && rate ? margin / rate * 100 : null,
      total: margin != null ? r3(margin * g.qty) : null, ready: margin != null && !noPrice.length, why: !rate ? 'no selling price' : !bom ? 'no approved BOM' : noPrice.length ? noPrice.length + ' item(s) without an approved price' : '' });
  }).sort((a, b) => (b.total || -1) - (a.total || -1));
}
const pfINR = v => '₹' + money(Math.round(num(v)));
function pfQuadrant(rows, medQ, medM) {
  const W = 760, H = 390, L = 64, Rp = 34, T = 30, B = 46, iw = W - L - Rp, ih = H - T - B;
  if (!rows.length) return '<div class="vz-empty">Nothing to plot yet</div>';
  const maxQ = Math.max(...rows.map(r => r.qty)) * 1.08 || 1;
  const ms = rows.map(r => r.margin); const minM = Math.min(0, ...ms), maxM = Math.max(...ms) * 1.1 || 1;
  const x = q => L + iw * (q / maxQ), y = m => T + ih - ih * ((m - minM) / (maxM - minM || 1));
  const maxT = Math.max(...rows.map(r => Math.abs(r.total))) || 1;
  const rad = t => 5 + 17 * Math.sqrt(Math.abs(t) / maxT);
  const mx = x(medQ), my = y(medM);
  let g = '<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="#fbfcfe"/>';
  // the four zones, named where the reader looks
  g += '<rect x="' + L + '" y="' + T + '" width="' + (mx - L) + '" height="' + (my - T) + '" fill="#eef6ef"/>' +
       '<rect x="' + mx + '" y="' + T + '" width="' + (L + iw - mx) + '" height="' + (my - T) + '" fill="#e8f1e9"/>' +
       '<rect x="' + mx + '" y="' + my + '" width="' + (L + iw - mx) + '" height="' + (T + ih - my) + '" fill="#fdf4ef"/>';
  const zone = (zx, zy, a, t1, t2) => '<text x="' + zx + '" y="' + zy + '" text-anchor="' + a + '" class="pf-zone">' + vzE(t1) + '</text>' + (t2 ? '<text x="' + zx + '" y="' + (zy + 11) + '" text-anchor="' + a + '" class="pf-zone2">' + vzE(t2) + '</text>' : '');
  g += zone(L + 2, T - 16, 'start', 'LESS WORK, MORE MARGIN — sell more of these', '') +
       zone(L + iw, T - 16, 'end', 'YOUR BEST — protect these', '') +
       zone(L + iw, T + ih - 7, 'end', 'MORE WORK, THIN MARGIN — raise the price, cut the cost', '') +
       zone(L + 2, T + ih - 7, 'start', 'LOW ON BOTH — drop or reprice', '');
  // median crosshair
  g += '<line x1="' + mx + '" y1="' + T + '" x2="' + mx + '" y2="' + (T + ih) + '" class="pf-med"/><line x1="' + L + '" y1="' + my + '" x2="' + (L + iw) + '" y2="' + my + '" class="pf-med"/>';
  if (minM < 0) g += '<line x1="' + L + '" y1="' + y(0) + '" x2="' + (L + iw) + '" y2="' + y(0) + '" class="pf-zero"/>';
  // axes
  const ticksY = 4; let ax = '';
  for (let i = 0; i <= ticksY; i++) { const v = minM + (maxM - minM) * i / ticksY; const yy = y(v); ax += '<line x1="' + L + '" y1="' + yy + '" x2="' + (L + iw) + '" y2="' + yy + '" class="pf-grid"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" class="vz-ax">' + vzE('₹' + Math.round(v)) + '</text>'; }
  for (let i = 0; i <= 4; i++) { const q = maxQ * i / 4; const xx = x(q); ax += '<text x="' + xx + '" y="' + (T + ih + 18) + '" text-anchor="middle" class="vz-ax">' + vzE(qtyFmt(Math.round(q))) + '</text>'; }
  ax += '<text x="' + (L + iw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="pf-axl">Pairs ordered  →  more work</text>' +
        '<text transform="translate(14,' + (T + ih / 2) + ') rotate(-90)" text-anchor="middle" class="pf-axl">Margin per pair  →  more reward</text>';
  // dots, biggest behind so the small ones stay clickable
  const dots = rows.slice().sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).map(r => {
    const cx = x(r.qty), cy = y(r.margin), rr = rad(r.total);
    const good = r.margin > medM;
    return '<g class="vz-hit" data-tip="' + vzE('<b>' + vzE(r.article) + '</b> · ' + vzE(r.brand) + '<br>' + qtyFmt(r.qty) + ' pairs · ' + r.orders + ' order(s)<br>Sells at ' + pfINR(r.rate) + ' · costs ' + pfINR(r.cogs) + '<br>Margin ' + pfINR(r.margin) + ' / pair (' + (r.pct || 0).toFixed(1) + '%)<br><b>Total ' + pfINR(r.total) + '</b>') + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="' + (r.margin < 0 ? VZ.crit : good ? VZ.s1 : '#9db4cd') + '" fill-opacity="' + (r.margin < 0 ? '.5' : '.42') + '" stroke="' + (r.margin < 0 ? VZ.crit : good ? VZ.s1 : '#7b93ad') + '" stroke-width="2"/>' +
      '<text x="' + cx + '" y="' + (cy + rr + 11 > T + ih - 4 ? cy - rr - 5 : cy + rr + 11) + '" text-anchor="middle" class="pf-dotl">' + vzE(r.article.length > 14 ? r.article.slice(0, 13) + '…' : r.article) + '</text></g>';
  }).join('');
  return '<svg class="vz pf-sc" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Margin per pair against pairs ordered, one bubble per article, bubble size is the total margin">' + g + ax + dots + '</svg>';
}
function pfHtml() {
  const all = pfRows(); const brands = Array.from(new Set(all.map(r => r.brand).filter(Boolean))).sort();
  const rows = PF_UI.brand ? all.filter(r => norm(r.brand) === norm(PF_UI.brand)) : all;
  const ok = rows.filter(r => r.margin != null && r.qty > 0), gap = rows.filter(r => r.margin == null);
  const rev = ok.reduce((s, r) => s + r.rate * r.qty, 0), cost = ok.reduce((s, r) => s + r.cogs * r.qty, 0);
  const tot = rev - cost, pairs = ok.reduce((s, r) => s + r.qty, 0);
  const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
  const medQ = med(ok.map(r => r.qty)), medM = med(ok.map(r => r.margin));
  const verdict = r => r.margin < 0 ? '<span class="st Late">Loss</span>' : r.qty >= medQ && r.margin > medM ? '<span class="st Done">Best</span>' : r.margin > medM ? '<span class="st Done">Sell more</span>' : r.qty >= medQ ? '<span class="st Pending">Thin margin</span>' : '<span class="muted">Low on both</span>';
  const tile = (l, v, s, tone) => '<div class="dt' + (tone ? ' dt-' + tone : '') + '"><span class="dt-l">' + l + '</span><b class="dt-v">' + v + '</b><span class="dt-s">' + s + '</span></div>';

  if (!ok.length) return '<div class="sa-lbl">COGS</div><div class="dcard sa-ok"><div class="dh3 sa-h"><span class="sa-hi warn">' + (typeof saIco === 'function' ? saIco('trend') : '') + '</span><b>Where the money is</b><span class="muted small">not set up yet</span><span class="grow"></span><a class="sa-open" href="#/articlemaster">Article Master ›</a></div>' +
    '<div class="sa-clear warn">Put a <b>selling price</b> on each article and get its <b>BOM approved</b> — margin per pair and money made show up here.' + (gap.length ? ' <span class="muted">' + gap.length + ' article(s) waiting: ' + esc(gap.slice(0, 4).map(r => r.article + ' (' + r.why + ')').join(', ')) + (gap.length > 4 ? ' …' : '') + '</span>' : '') + '</div></div>';
  let h = '<div class="sa-lbl">COGS</div><div class="dcard pf"><div class="dh3 sa-h"><span class="sa-hi ok">' + (typeof saIco === 'function' ? saIco('trend') : '') + '</span><b>Where the money is</b><span class="muted small">by article · selling price − COGS</span><span class="grow"></span>' +
    seg('pfPer', PF_PERIODS, PF_UI.per) +
    '<select id="pfBrand"><option value="">All brands</option>' + brands.map(b => '<option' + (b === PF_UI.brand ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select>' +
    '<button class="btn sm" data-act="pf-csv">CSV</button></div><div class="pf-b">';
  h += '<div class="pf-tiles">' + tile('Order value', pfINR(rev), qtyFmt(pairs) + ' pairs · ' + ok.length + ' articles') +
    tile('Material cost', pfINR(cost), 'from the approved BOMs') +
    tile('Gross margin', pfINR(tot), 'before overheads', tot > 0 ? 'good' : 'crit') +
    tile('Margin', (rev ? (tot / rev * 100).toFixed(1) + '%' : '—'), 'of the order value', rev && tot / rev > 0.2 ? 'good' : rev && tot / rev > 0.1 ? 'warn' : 'crit') + '</div>';

  {
    h += '<div class="pf-two"><div><div class="pf-h">Money made, by article <span class="muted small">margin per pair × pairs ordered</span></div>' +
      vzBars(ok.filter(r => r.total > 0).slice(0, 8).map(r => ({ label: r.article + ' · ' + r.brand, value: r.total, sub: qtyFmt(r.qty) + ' pairs × ' + pfINR(r.margin) + '/pair' })), pfINR, { aria: 'Total margin by article', empty: 'Nothing with a margin yet' }) + '</div>' +
      '<div><div class="pf-h">Work against reward <span class="muted small">one bubble per article · bubble size = money made</span></div>' + pfQuadrant(ok, medQ, medM) + '</div></div>';
    const srt = { margin: (a, b) => (b.total || 0) - (a.total || 0), pct: (a, b) => (b.pct || 0) - (a.pct || 0), qty: (a, b) => b.qty - a.qty }[PF_UI.sort] || null;
    h += '<div class="pf-h" style="margin-top:12px">Every article ' + seg('pfSort', [{ v: 'margin', l: 'Money made' }, { v: 'pct', l: 'Margin %' }, { v: 'qty', l: 'Pairs' }], PF_UI.sort) + '</div>' +
      '<div class="tbl-wrap"><table class="nopage"><tr><th>Article</th><th>Brand</th><th class="num">Pairs</th><th class="num">Sells at ₹</th><th class="num">COGS ₹</th><th class="num">Margin ₹/pair</th><th class="num">Margin %</th><th class="num">Money made ₹</th><th>Verdict</th></tr>' +
      ok.slice().sort(srt).map(r => '<tr><td><a href="#/articlemaster"><b>' + esc(r.article) + '</b></a></td><td>' + esc(r.brand) + '</td><td class="num">' + qtyFmt(r.qty) + '</td><td class="num">' + money(r.rate) + '</td><td class="num">' + money(r.cogs) + '</td><td class="num ' + (r.margin < 0 ? 'late-txt' : '') + '"><b>' + money(r.margin) + '</b></td><td class="num ' + (r.pct < 0 ? 'late-txt' : r.pct >= 25 ? 'ok-txt' : '') + '">' + r.pct.toFixed(1) + '%</td><td class="num"><b>' + money(r.total) + '</b></td><td>' + verdict(r) + '</td></tr>').join('') + '</table></div>';
  }
  if (gap.length) h += '<div class="pf-gap"><b>' + gap.length + ' article(s) cannot be measured</b> — ' + esc(gap.slice(0, 6).map(r => r.article + ' (' + r.why + ')').join(', ')) + (gap.length > 6 ? ' …' : '') + '. Put the selling price in <a href="#/articlemaster">Article Master</a> and get the BOM approved.</div>';
  return h + '</div></div>';
}
ACTIONS['pf-csv'] = () => downloadCsv('article-profit-' + todayYmd() + '.csv', [['Article', 'Brand', 'Pairs', 'Sells at', 'COGS', 'Margin per pair', 'Margin %', 'Money made', 'Note']]
  .concat(pfRows().filter(r => !PF_UI.brand || norm(r.brand) === norm(PF_UI.brand)).map(r => [r.article, r.brand, r.qty, r.rate, r.cogs, r.margin == null ? '' : r.margin, r.pct == null ? '' : r3(r.pct), r.total == null ? '' : r.total, r.why])));
function pfBind() {
  const b = $('#pfBrand'); if (b) b.addEventListener('change', e => { PF_UI.brand = e.target.value; VIEWS.home.render(); });
}
