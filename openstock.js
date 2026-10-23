/* ---------- Opening Stock: stock that was already in the godown before Nexus ----------
   One entry per item. Store enters it (one by one or CSV upload); it counts in stock only after approval. */
const OS_UI = { q: '', msg: '' };
const osAll = () => Store.all('opening_stock');
const osLive = code => osAll().find(x => norm(x.material) === norm(code) && x.status !== 'Rejected');   // one opening per item
const osCanApprove = () => isSuperAdmin() || canApprove();
function osMat(code) { return Store.all('materials').find(m => norm(m.code) === norm(code)) || null; }
function osNo() { return nextNo('opening_stock', 'OPS'); }
// check one row; returns an error text or ''
function osCheck(r, seen) {
  const m = osMat(r.material); if (!m) return 'Item code ' + (r.material || '—') + ' is not in Items';
  if (!(num(r.qty) > 0)) return 'Qty must be more than 0';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return 'Date must be YYYY-MM-DD';
  const live = osLive(m.code); if (live) return m.code + ' already has opening stock (' + live.no + ', ' + live.status + ')';
  if (seen && seen.has(norm(m.code))) return m.code + ' is twice in this file';
  return '';
}
function osSave(rows) {
  rows.forEach(r => {
    const m = osMat(r.material);
    const d = Store.put('opening_stock', { id: uid(), no: osNo(), date: r.date, material: m.code, uom: m.uom, qty: num(r.qty), rate: num(m.price), rack: r.rack || m.rack || '', status: 'Pending', by: ME.name, at: nowIso() });
    audit('opening_stock.add', d.no, m.code + ' × ' + qtyFmt(d.qty) + ' ' + (m.uom || '') + ' @ ' + money(d.rate) + ' · ' + d.date);
  });
}
VIEWS.openstock = {
  mod: 'store', render() {
    const edit = can('store', 'edit'); const appr = osCanApprove();
    const q = norm(OS_UI.q); const msg = OS_UI.msg; OS_UI.msg = '';   // an error shows once
    const list = osAll().map(x => ({ x, m: osMat(x.material) || {} })).filter(r => !q || norm(r.x.no + ' ' + r.x.material + ' ' + (r.m.name || '') + ' ' + r.x.status).includes(q)).sort((a, b) => (a.x.no < b.x.no ? 1 : -1));
    const pend = osAll().filter(x => x.status === 'Pending');
    const mats = Store.all('materials').filter(m => !osLive(m.code)).sort((a, b) => a.code.localeCompare(b.code));
    let h = '<div class="toolbar"><input id="osQ" placeholder="Search item / no…" value="' + esc(OS_UI.q) + '"><span class="grow"></span>' +
      (appr && pend.length ? '<button class="btn primary" data-act="os-approve-all" data-confirm="Approve all ' + pend.length + ' pending?">Approve all (' + pend.length + ')</button>' : '') +
      '<button class="btn" data-act="os-template">CSV template</button>' +
      (edit ? '<label class="btn">Upload CSV<input type="file" id="osFile" accept=".csv,text/csv" class="hidden"></label>' : '') +
      '<button class="btn" data-act="os-csv">Export CSV</button></div>';
    if (edit) h += '<div class="panel os-add"><table class="nopage nofilter"><tr><th>Item</th><th>UOM</th><th class="num">Qty</th><th class="num">Rate</th><th>Rack</th><th>Date</th><th></th></tr><tr>' +
      '<td><select id="osMat"><option value=""></option>' + mats.map(m => '<option value="' + esc(m.code) + '">' + esc(m.code + ' — ' + m.name) + '</option>').join('') + '</select></td>' +
      '<td id="osUom"></td><td><input id="osQty" type="number" min="0" step="any" class="num"></td><td id="osRate" class="num"></td>' +
      '<td><input id="osRack"></td><td><input id="osDate" type="date" value="' + todayYmd() + '"></td><td><button class="btn primary" data-act="os-add">Add</button></td></tr></table>' +
      (msg ? '<div class="late-txt small">' + esc(msg) + '</div>' : '') + '</div>';
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Value</th><th>Rack</th><th>Entered by</th><th>Status</th><th>Approved by</th><th></th></tr>' +
      list.map(({ x, m }) => '<tr' + (x.status === 'Rejected' ? ' class="muted"' : '') + '><td class="nowrap">' + esc(x.no) + '</td><td class="nowrap">' + fmtD(x.date) + '</td><td><b>' + esc(x.material) + '</b></td><td>' + esc(m.name || '') + '</td><td>' + esc(x.uom || m.uom || '') + '</td>' +
        '<td class="num">' + qtyFmt(x.qty) + '</td><td class="num">' + money(x.rate) + '</td><td class="num">' + money(num(x.qty) * num(x.rate)) + '</td><td>' + esc(x.rack || '') + '</td><td>' + esc(x.by) + '<div class="small muted">' + fmtDT(x.at) + '</div></td>' +
        '<td>' + (x.status === 'Approved' ? '<span class="ok-txt">Approved</span>' : x.status === 'Rejected' ? '<span class="late-txt">Rejected</span>' : 'Pending') + '</td><td>' + esc(x.approved_by || '') + (x.approved_at ? '<div class="small muted">' + fmtDT(x.approved_at) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + (x.status === 'Pending' && appr ? '<button class="btn sm primary" data-act="os-approve" data-id="' + esc(x.id) + '">Approve</button><button class="btn sm" data-act="os-reject" data-id="' + esc(x.id) + '" data-confirm="Reject ' + esc(x.no) + '?">Reject</button>' : '') +
        (x.status === 'Pending' && edit && x.by === ME.name ? '<button class="btn sm ghost danger" data-act="os-del" data-id="' + esc(x.id) + '" data-confirm="Delete ' + esc(x.no) + '?">Delete</button>' : '') + '</td></tr>').join('') + '</table></div>';
    setMain(h);
    $('#osQ').addEventListener('input', e => { OS_UI.q = e.target.value; clearTimeout(OS_UI.t); OS_UI.t = setTimeout(() => { VIEWS.openstock.render(); const i = $('#osQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
    const sel = $('#osMat'); if (sel) sel.addEventListener('change', () => { const m = osMat(sel.value) || {}; $('#osUom').textContent = m.uom || ''; $('#osRate').innerHTML = m.code ? poRateCell(m.code) : ''; $('#osRack').value = m.rack || ''; });
    const f = $('#osFile'); if (f) f.addEventListener('change', e => { const file = e.target.files[0]; if (file) osUpload(file); e.target.value = ''; });
  }
};
ACTIONS['os-add'] = () => {
  if (!requirePerm('store', 'edit')) return;
  const r = { material: $('#osMat').value, qty: $('#osQty').value, rack: $('#osRack').value.trim(), date: $('#osDate').value };
  const err = osCheck(r); if (err) { OS_UI.msg = err; VIEWS.openstock.render(); return; }
  OS_UI.msg = ''; osSave([r]); flash('Opening stock added — waiting for approval.'); VIEWS.openstock.render();
};
function osSetStatus(x, st) {
  x.status = st; x.approved_by = ME.name; x.approved_at = nowIso(); Store.put('opening_stock', x);
  audit('opening_stock.' + (st === 'Approved' ? 'approve' : 'reject'), x.no, x.material + ' × ' + qtyFmt(x.qty));
}
ACTIONS['os-approve'] = el => { if (!osCanApprove()) return; const x = Store.get('opening_stock', el.dataset.id); if (!x || x.status !== 'Pending') return; osSetStatus(x, 'Approved'); flash(esc(x.no) + ' approved — added to stock.'); VIEWS.openstock.render(); };
ACTIONS['os-reject'] = el => { if (!osCanApprove()) return; const x = Store.get('opening_stock', el.dataset.id); if (!x || x.status !== 'Pending') return; osSetStatus(x, 'Rejected'); VIEWS.openstock.render(); };
ACTIONS['os-approve-all'] = () => { if (!osCanApprove()) return; const p = osAll().filter(x => x.status === 'Pending'); p.forEach(x => osSetStatus(x, 'Approved')); flash(p.length + ' approved — added to stock.'); VIEWS.openstock.render(); };
ACTIONS['os-del'] = el => { const x = Store.get('opening_stock', el.dataset.id); if (!x || x.status !== 'Pending' || x.by !== ME.name) return; Store.del('opening_stock', x.id); audit('opening_stock.delete', x.no, x.material); VIEWS.openstock.render(); };
ACTIONS['os-template'] = () => downloadCsv('opening-stock-template.csv', [['Item Code', 'Qty', 'Rack', 'Date (YYYY-MM-DD)']].concat(Store.all('materials').filter(m => !osLive(m.code)).sort((a, b) => a.code.localeCompare(b.code)).map(m => [m.code, '', m.rack || '', todayYmd()])));
ACTIONS['os-csv'] = () => downloadCsv('opening-stock-' + todayYmd() + '.csv', [['No', 'Date', 'Item Code', 'Item Name', 'UOM', 'Qty', 'Rate', 'Value', 'Rack', 'Entered by', 'Status', 'Approved by']].concat(osAll().map(x => { const m = osMat(x.material) || {}; return [x.no, x.date, x.material, m.name || '', x.uom || m.uom || '', x.qty, x.rate, num(x.qty) * num(x.rate), x.rack || '', x.by, x.status, x.approved_by || '']; })));
// CSV: Item Code, Qty, Rack, Date (rate is always the approved item price) — rows with no Qty are skipped (the template lists every item)
function osParseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(s => s.trim())).filter(r => r.some(Boolean));
}
function osUpload(file) {
  if (!requirePerm('store', 'edit')) return;
  const rd = new FileReader();
  rd.onload = () => {
    const all = osParseCsv(String(rd.result || '').replace(/^﻿/, ''));
    if (all.length && /item|code/i.test(all[0][0] || '')) all.shift();
    const seen = new Set(); const good = [], bad = [];
    all.forEach((c, i) => {
      if (!c[1]) return;   // no qty → not counted
      const old = c.length >= 5;   // an older file with a Rate column: the rate is ignored
      const d = (c[old ? 4 : 3] || '').trim(); const dm = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      const r = { line: i + 2, material: c[0], qty: c[1], rack: c[old ? 3 : 2] || '', date: dm ? dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0') : (d || todayYmd()) };
      const err = osCheck(r, seen); if (err) bad.push({ r, err }); else { good.push(r); seen.add(norm(r.material)); }
    });
    const old = $('#osDlg'); if (old) old.remove();
    const dlg = document.createElement('div'); dlg.id = 'osDlg'; dlg.className = 'dlg-back';
    dlg.innerHTML = '<div class="dlg hx-dlg"><div class="dlg-h">' + esc(file.name) + ' · ' + good.length + ' OK · ' + bad.length + ' with errors</div>' +
      (bad.length ? '<div class="tbl-wrap hx-wrap"><table class="nopage nofilter"><tr><th class="num">Line</th><th>Item Code</th><th class="num">Qty</th><th>Error</th></tr>' + bad.map(b => '<tr><td class="num">' + b.r.line + '</td><td>' + esc(b.r.material) + '</td><td class="num">' + esc(b.r.qty) + '</td><td class="late-txt">' + esc(b.err) + '</td></tr>').join('') + '</table></div>' : '') +
      (good.length ? '<div class="tbl-wrap hx-wrap"><table class="nopage nofilter"><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Qty</th><th class="num">Rate</th><th>Rack</th><th>Date</th></tr>' + good.map(r => { const m = osMat(r.material); return '<tr><td>' + esc(m.code) + '</td><td>' + esc(m.name) + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + qtyFmt(r.qty) + '</td><td class="num">' + poRateCell(m.code) + '</td><td>' + esc(r.rack || m.rack || '') + '</td><td>' + fmtD(r.date) + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<div class="dlg-f"><span class="grow"></span><button class="btn" data-os-x>Cancel</button>' + (good.length ? '<button class="btn primary" data-os-ok>Save ' + good.length + ' row(s)</button>' : '') + '</div></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', ev => {
      if (ev.target.closest('[data-os-x]') || ev.target === dlg) { dlg.remove(); return; }
      if (ev.target.closest('[data-os-ok]')) { dlg.remove(); osSave(good); flash(good.length + ' opening stock row(s) added — waiting for approval.'); VIEWS.openstock.render(); }
    });
  };
  rd.readAsText(file);
}
