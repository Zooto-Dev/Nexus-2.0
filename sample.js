/* Nexus 2.0 — Sample Development: sample entry form, sample tracker and one sample's FMS steps (process code 'sdev'). */
'use strict';

const SMP_UI = { f: 'open', q: '' };
let SMP_NEW = null;
function sdevProc() { return activeProcess('sdev'); }
function sdevField(key) { const p = sdevProc(); const f = p && p.spec.fields.find(x => x.key === key); return f && f.options ? f.options.filter(Boolean) : []; }
function sdevBrands() {
  const p = sdevProc(); const t = p ? Object.keys((p.spec.doerTables || {}).brand_merchant || {}) : [];
  const all = Store.all('customers').map(c => c.name).concat(t).concat(Store.all('samples').map(s => s.brand));
  const seen = new Map(); all.filter(Boolean).forEach(b => { if (!seen.has(norm(b))) seen.set(norm(b), b); });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
function smpBlank() { return { article: '', colour: '', size: '', image: '' }; }
function smpNewForm() { SMP_NEW = { brand: '', category: '', gender: '', lines: [smpBlank()] }; }
function smpSeq(prefix, list) { return list.reduce((m, x) => { const n = parseInt(String(x || '').replace(prefix, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0); }
function smpState(s) {
  if (s.status === 'Rejected' || s.status === 'Duplicate Entry') return { label: s.status, cls: 'Cancelled', open: false };
  if (s.status === 'Hold') return { label: 'Hold', cls: 'OnHold', open: true };
  const r = resolveOrder(s); if (!r) return { label: 'No flow', cls: 'NA', open: true };
  const open = r.order.map(id => r.steps[id]).filter(x => x.status === 'Pending' || x.status === 'Late').sort((a, b) => a.planned - b.planned);
  const cur = open.find(x => x.status === 'Late') || open[0];
  if (!cur) return { label: r.order.some(id => r.steps[id].status === 'Waiting') ? 'Waiting' : 'Completed', cls: 'Done', open: false };
  return { label: cur.name, cls: cur.status === 'Late' ? 'Late' : 'Pending', open: true, cur };
}

/* ---------------- Sample Entry (form) ---------------- */
VIEWS.samplenew = {
  mod: 'development', edit: true, render() {
    const proc = sdevProc();
    if (!proc) { setMain('<div class="panel">No active Sample Development flow. Activate one in FMS Builder first.</div>'); return; }
    if (!SMP_NEW) smpNewForm();
    const S = SMP_NEW; const L = S.lines;
    if (!L.length || L[L.length - 1].article) L.push(smpBlank());
    const sizes = sdevField('size');
    let h = '<datalist id="dlSmpArt">' + Array.from(new Set(Store.all('samples').map(x => x.article).concat(Store.all('items').map(i => i.code)).filter(Boolean))).sort().map(a => '<option value="' + esc(a) + '">').join('') + '</datalist>' +
      '<datalist id="dlSmpCol">' + Array.from(new Set(Store.all('samples').map(x => x.colour).filter(Boolean).map(c => c.toUpperCase()))).sort().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>';
    h += '<div class="panel punch"><div class="hdr">' +
      '<label>Date<input value="' + esc(fmtDT(new Date())) + '" disabled></label>' +
      '<label>Brand *<select id="smBrand">' + selOpts(sdevBrands(), S.brand) + '</select></label>' +
      '<label>Category *<select id="smCat">' + selOpts(sdevField('category'), S.category) + '</select></label>' +
      '<label>Gender *<select id="smGen">' + selOpts(sdevField('gender'), S.gender) + '</select></label>' +
      '</div>';
    h += '<table class="lines"><tr><th style="width:28px">#</th><th>Article *</th><th style="width:200px">Colour *</th><th style="width:120px">Size *</th><th style="width:170px">Image</th><th style="width:30px"></th></tr>' +
      L.map((l, i) => '<tr data-i="' + i + '"><td class="muted">' + (i + 1) + '</td>' +
        '<td><input data-sm="article" list="dlSmpArt" value="' + esc(l.article) + '" autocomplete="off"></td>' +
        '<td><input data-sm="colour" list="dlSmpCol" value="' + esc(l.colour) + '" autocomplete="off"></td>' +
        '<td><select data-sm="size">' + selOpts(sizes, l.size, '') + '</select></td>' +
        '<td>' + (l.image ? photoThumb(l.image) + ' <a class="small" data-act="sm-img-x" data-i="' + i + '">×</a>' : '<input type="file" accept="image/*" data-smimg="' + i + '">') + '</td>' +
        '<td>' + (i < L.length - 1 ? '<button class="btn ghost sm" data-act="sm-del" data-i="' + i + '">×</button>' : '') + '</td></tr>').join('') + '</table>';
    h += '<div class="toolbar"><button class="btn primary" data-act="sm-save">Save</button><a data-act="sm-clear">Clear</a><span id="smMsg" class="small"></span></div></div>';
    setMain(h);
    const m = $('#main');
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'smBrand') S.brand = t.value; if (t.id === 'smCat') S.category = t.value; if (t.id === 'smGen') S.gender = t.value;
      if (t.dataset.sm) { const l = L[+t.closest('tr').dataset.i]; l[t.dataset.sm] = t.dataset.sm === 'colour' ? t.value.trim().toUpperCase() : t.value.trim(); if (t.dataset.sm === 'article' && t.closest('tr').dataset.i == L.length - 1 && l.article) VIEWS.samplenew.render(); }
      if (t.dataset.smimg != null) readImg(t.files[0], src => { L[+t.dataset.smimg].image = src; VIEWS.samplenew.render(); });
    });
  }
};
ACTIONS['sm-del'] = el => { SMP_NEW.lines.splice(+el.dataset.i, 1); VIEWS.samplenew.render(); };
ACTIONS['sm-img-x'] = el => { SMP_NEW.lines[+el.dataset.i].image = ''; VIEWS.samplenew.render(); };
ACTIONS['sm-clear'] = () => { smpNewForm(); VIEWS.samplenew.render(); };
ACTIONS['sm-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const S = SMP_NEW; const proc = sdevProc(); const msg = t => { $('#smMsg').innerHTML = '<span class="late-txt">' + esc(t) + '</span>'; };
  const lines = S.lines.filter(l => l.article || l.colour || l.size || l.image);
  const miss = [];
  if (!S.brand) miss.push('Brand'); if (!S.category) miss.push('Category'); if (!S.gender) miss.push('Gender');
  if (!lines.length) miss.push('at least one article');
  lines.forEach((l, i) => { if (!l.article || !l.colour || !l.size) miss.push('row ' + (i + 1)); });
  if (miss.length) return msg('Missing: ' + miss.join(', '));
  const all = Store.all('samples');
  const dup = lines.find(l => all.some(x => x.status !== 'Rejected' && x.status !== 'Duplicate Entry' && norm(x.brand) === norm(S.brand) && norm(x.article) === norm(l.article) && norm(x.colour) === norm(l.colour) && norm(x.size) === norm(l.size)));
  if (dup && !ACTIONS['sm-save'].ok) { ACTIONS['sm-save'].ok = true; return msg('Already entered: ' + dup.article + ' ' + dup.colour + ' ' + dup.size + ' — press Save again to add anyway'); }
  ACTIONS['sm-save'].ok = false;
  let sn = smpSeq('SD-', all.map(x => x.no)); const batch = 'SB-' + String(smpSeq('SB-', all.map(x => x.batch_no)) + 1).padStart(4, '0');
  const now = nowIso(); const made = [];
  lines.forEach(l => {
    sn += 1;
    const s = { id: uid(), kind: 'sample', no: 'SD-' + String(sn).padStart(4, '0'), batch_no: batch, process_id: proc.id, brand: S.brand, customer_name: S.brand, category: S.category, gender: S.gender,
      article: l.article, colour: l.colour, size: l.size, image: l.image || '', status: '', priority: '', actuals: {}, done_by: {}, extra: {}, created_at: now, created_by: ME.name };
    Store.put('samples', s); made.push(s.no);
  });
  audit('sample.create', batch, S.brand + ' · ' + made.join(', '));
  const keep = { brand: S.brand, category: S.category, gender: S.gender };
  smpNewForm(); Object.assign(SMP_NEW, keep); VIEWS.samplenew.render();
  flash('Saved <b>' + esc(batch) + '</b>: ' + esc(made.join(', ')) + '. <a href="#/samples">Open Sample Tracker</a>');
};

/* ---------------- Sample Tracker (one row per sample) ---------------- */
VIEWS.samples = {
  mod: 'development', render() {
    const q = norm(SMP_UI.q);
    const rows = Store.all('samples').slice().sort((a, b) => b.created_at < a.created_at ? -1 : 1).map(s => ({ s, st: smpState(s) })).filter(x => {
      if (q && !norm([x.s.no, x.s.batch_no, x.s.brand, x.s.article, x.s.colour, x.s.category].join(' ')).includes(q)) return false;
      switch (SMP_UI.f) {
        case 'open': return x.st.open && x.s.status !== 'Hold'; case 'late': return x.st.cls === 'Late'; case 'hold': return x.s.status === 'Hold';
        case 'rej': return x.s.status === 'Rejected' || x.s.status === 'Duplicate Entry'; case 'done': return x.st.label === 'Completed'; default: return true;
      }
    });
    const cal = calInfo();
    let h = '<div class="toolbar">' + seg('smf', [{ v: 'open', l: 'Open' }, { v: 'late', l: 'Delayed' }, { v: 'hold', l: 'Hold' }, { v: 'rej', l: 'Rejected' }, { v: 'done', l: 'Completed' }, { v: 'all', l: 'All' }], SMP_UI.f) +
      '<input id="smQ" placeholder="Sample / batch / brand / article…" value="' + esc(SMP_UI.q) + '"><span class="muted small">' + rows.length + ' sample(s)</span><span class="grow"></span>' +
      '<button class="btn" data-act="sm-csv">Export CSV</button>' + (can('development', 'edit') ? '<a class="btn primary" href="#/samplenew">+ Sample Entry</a>' : '') + '</div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Time Stamp</th><th>Sample ID</th><th>Batch ID</th><th>Image</th><th>Brand</th><th>Article</th><th>Colour</th><th>Size</th><th>Gender</th><th>Category</th><th>Remarks</th><th>Current Step</th><th>Doer</th><th>Planned</th><th class="num">Delay</th></tr>' +
      (rows.length ? rows.map(x => {
        const c = x.st.cur;
        return '<tr class="click" data-act="go" data-v="sample" data-p="' + esc(x.s.id) + '"><td class="nowrap">' + fmtDT(x.s.created_at) + '</td><td><b>' + esc(x.s.no) + '</b></td><td>' + esc(x.s.batch_no || '') + '</td><td>' + photoThumb(x.s.image) + '</td><td>' + esc(x.s.brand) + '</td><td>' + esc(x.s.article) + '</td><td>' + esc(x.s.colour) + '</td><td>' + esc(x.s.size) + '</td><td>' + esc(x.s.gender) + '</td><td>' + esc(x.s.category) + '</td>' +
          '<td>' + (x.s.status ? '<span class="st ' + stCls(x.st.cls) + '">' + esc(x.s.status) + '</span>' : '') + '</td><td>' + (c ? '<span class="st ' + stCls(x.st.cls) + '">' + esc(c.name) + '</span>' : esc(x.s.status ? '' : x.st.label)) + '</td><td>' + esc(c ? c.doer || '' : '') + '</td><td class="nowrap">' + (c && c.planned ? fmtDT(c.planned) : '') + '</td><td class="num late-txt">' + (c && c.delayMinutes ? fmtDelay(c.delayMinutes) : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="15" class="empty">No samples</td></tr>') + '</table></div>';
    setMain(h); VIEWS.samples.rows = rows;
    onSeg(e => { SMP_UI.f = e.detail; VIEWS.samples.render(); });
    $('#smQ').addEventListener('input', e => { SMP_UI.q = e.target.value; clearTimeout(SMP_UI.t); SMP_UI.t = setTimeout(() => { VIEWS.samples.render(); const i = $('#smQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};
ACTIONS['sm-csv'] = () => downloadCsv('samples-' + todayYmd() + '.csv', [['Time Stamp', 'Sample ID', 'Batch ID', 'Brand', 'Article', 'Colour', 'Size', 'Gender', 'Category', 'Remarks', 'Current Step', 'Doer', 'Planned', 'Delay (min)']]
  .concat((VIEWS.samples.rows || []).map(x => { const c = x.st.cur; return [fmtDT(x.s.created_at), x.s.no, x.s.batch_no, x.s.brand, x.s.article, x.s.colour, x.s.size, x.s.gender, x.s.category, x.s.status || '', c ? c.name : x.st.label, c ? c.doer : '', c && c.planned ? fmtDT(c.planned) : '', c ? c.delayMinutes || 0 : 0]; })));

/* ---------------- One sample: details + FMS steps ---------------- */
VIEWS.sample = {
  mod: 'development', render(id) {
    const s = Store.get('samples', id); if (!s) { setMain('<div class="panel empty">Sample not found.</div>'); return; }
    const r = resolveOrder(s); const st = smpState(s); const edit = can('development', 'edit');
    let h = '<div class="toolbar"><a href="#/samples">← Sample Tracker</a><span class="grow"></span>' + (edit ? '<button class="btn" data-act="sm-edit" data-id="' + esc(s.id) + '">Edit</button>' : '') + '</div>';
    h += '<div class="panel"><table class="jckv"><tr><td class="k">Sample ID</td><td class="v"><b>' + esc(s.no) + '</b></td><td class="k">Batch ID</td><td class="v">' + esc(s.batch_no || '') + '</td><td class="k">Time Stamp</td><td class="v">' + fmtDT(s.created_at) + '</td><td rowspan="4" class="c">' + (s.image ? '<a data-act="img-view" data-src="' + esc(s.image) + '"><img src="' + esc(s.image) + '" style="max-height:120px;border-radius:4px"></a>' : '') + '</td></tr>' +
      '<tr><td class="k">Brand</td><td class="v">' + esc(s.brand) + '</td><td class="k">Article</td><td class="v"><b>' + esc(s.article) + '</b></td><td class="k">Colour</td><td class="v">' + esc(s.colour) + '</td></tr>' +
      '<tr><td class="k">Size</td><td class="v">' + esc(s.size) + '</td><td class="k">Gender</td><td class="v">' + esc(s.gender) + '</td><td class="k">Category</td><td class="v">' + esc(s.category) + '</td></tr>' +
      '<tr><td class="k">Remarks</td><td class="v">' + (edit ? '<select id="smRemark">' + ['', 'Hold', 'Rejected', 'Duplicate Entry'].map(v => '<option' + (v === (s.status || '') ? ' selected' : '') + ' value="' + esc(v) + '">' + esc(v || 'Running') + '</option>').join('') + '</select>' : esc(s.status || 'Running')) + '</td><td class="k">Status</td><td class="v"><span class="st ' + stCls(st.cls) + '">' + esc(st.label) + '</span></td><td class="k">Entered by</td><td class="v">' + esc(s.created_by || '') + '</td></tr></table></div>';
    h += '<div class="tbl-wrap"><table><tr><th>#</th><th>Step</th><th>Doer</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th>Done by</th><th>Result</th><th></th></tr>' +
      (r ? r.order.map((sid, i) => {
        const x = r.steps[sid]; const def = r.spec.steps.find(d => d.id === sid);
        const res = def && def.capture ? (s.extra || {})[def.capture.field] || '' : (s.notes || {})[sid] || '';
        const btn = (x.status === 'Pending' || x.status === 'Late') ? stepDoneBtn(s, x, def, r.spec) : (x.actual && edit ? '<a class="small" data-act="undo-step" data-o="' + esc(s.id) + '" data-s="' + esc(sid) + '">Undo</a>' : '');
        return '<tr' + (x.status === 'N/A' ? ' class="muted"' : '') + '><td class="muted">' + (i + 1) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.doer || '') + '</td><td class="nowrap">' + (x.planned ? fmtDT(x.planned) : '') + '</td><td class="nowrap">' + (x.actual ? fmtDT(x.actual) : '') + '</td><td><span class="st ' + stCls(x.status) + '">' + esc(x.status) + '</span></td><td class="num' + (x.delayMinutes ? ' late-txt' : '') + '">' + (x.delayMinutes ? fmtDelay(x.delayMinutes) : '') + '</td><td>' + esc((s.done_by || {})[sid] || '') + '</td><td>' + esc(res) + '</td><td>' + btn + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">No flow</td></tr>') + '</table></div>';
    setMain(h);
    const sel = $('#smRemark');
    if (sel) sel.addEventListener('change', () => {
      const v = sel.value; const was = s.status || '';
      const apply = why => { s.status = v; s.priority = v === 'Hold' ? 'On Hold' : v ? 'Cancelled' : ''; s.remark_note = why || ''; Store.put('samples', s); RES_CACHE.clear(); audit('sample.remarks', s.no, (was || 'Running') + ' → ' + (v || 'Running') + (why ? ' — ' + why : '')); VIEWS.sample.render(s.id); };
      if (v) reasonDialog(s.no + ' · ' + v, 'Save', apply); else apply('');
      if (v) sel.value = was;
    });
  }
};
ACTIONS['sm-edit'] = el => {
  const s = Store.get('samples', el.dataset.id); if (!s || !requirePerm('development', 'edit')) return;
  formDialog('Edit ' + s.no, [{ k: 'article', l: 'Article', value: s.article, req: true }, { k: 'colour', l: 'Colour', value: s.colour, req: true }, { k: 'size', l: 'Size', value: s.size, req: true }], 'Save', v => {
    s.article = v.article; s.colour = v.colour.toUpperCase(); s.size = v.size; Store.put('samples', s); audit('sample.edit', s.no, v.article + ' · ' + v.colour + ' · ' + v.size); VIEWS.sample.render(s.id);
  });
};
