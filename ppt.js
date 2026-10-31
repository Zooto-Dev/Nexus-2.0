/* Nexus 2.0 — Packaging PPT: one file for every brand + article, kept in the private 'article-ppt' bucket.
   Punching an order raises an upload task on the brand merchant for every article that has no PPT yet;
   a job card cannot be made until the PPT is there, and the job card then carries it with its PDF. */
'use strict';

const PPT_UI = { tab: 'have', q: '', form: false };
const pptKey = (brand, article) => norm(brand) + '|' + norm(article);
const pptAll = () => Store.all('art_ppt');
const pptOf = (brand, article) => pptAll().find(p => pptKey(p.brand, p.article) === pptKey(brand, article) && p.path);
// the brand's merchant does it; with none in the CDB it goes to a senior merchant
function pptDoer(brand) {
  const m = brandPeople(brand).merchant;
  const u = Store.all('users').find(x => x.doer && x.active !== false && (norm(x.doer) === norm(m) || norm(String(x.name || '').split(/[\s(]/)[0]) === norm(m)));
  if (u) return u.doer;
  const sr = Store.all('users').find(x => x.doer && x.active !== false && /MERCHAND/i.test(x.department || '') && /SR|HEAD|MANAGER/i.test(x.designation || ''));
  return (sr && sr.doer) || m || '';
}
const pptTaskFor = (brand, article) => Store.all('checklist').find(t => t.src === 'ppt' && t.ref === pptKey(brand, article) && t.active !== false && !clDoneOf(t, t.start));
// order punched: one task per new article that has no packaging PPT
function pptRaise(o) {
  const brand = o.customer_name || o.brand || ''; if (!brand) return 0;
  const doer = pptDoer(brand); if (!doer) return 0;
  const due = ymdOf(new Date(Date.now() + 3 * 86400000));
  let n = 0;
  (o.lines || []).forEach(l => {
    const art = String(l.article || '').trim(); if (!art) return;
    if (pptOf(brand, art) || pptTaskFor(brand, art)) return;
    const t = eaDelegate('Upload the packaging PPT for article ' + art + ' (' + brand + ')', doer, due, 'ppt', o.no, { attach: true });
    t.ref = pptKey(brand, art); t.brand = brand; t.article = art; Store.put('checklist', t); n++;
  });
  if (n) { renderNav(); flash(n + ' packaging PPT task(s) raised on ' + esc(doer) + '.'); }
  return n;
}
/* ---------- upload / open ---------- */
const PPT_OK = /\.(pptx?|pdf)$/i;
async function pptUpload(brand, article, file) {
  if (DEMO) return { err: 'Uploads are off in the demo' };
  if (!CLOUD || !SB) return { err: 'Uploads work in cloud mode' };
  if (!PPT_OK.test(file.name || '')) return { err: 'Only a PPT, PPTX or PDF file' };
  if (file.size > 30 * 1024 * 1024) return { err: 'File is over 30 MB' };
  const safe = x => String(x).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'NA';
  const name = String(file.name).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const path = safe(brand) + '/' + safe(article) + '/' + Date.now() + '_' + name;
  const { error } = await SB.storage.from('article-ppt').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  return error ? { err: 'Upload failed: ' + error.message } : { path, name, size: file.size };
}
async function pptLink(path, secs) {
  if (!CLOUD || !SB) return '';
  const { data, error } = await SB.storage.from('article-ppt').createSignedUrl(path, secs || 180);
  if (error) { flash('Could not open the PPT: ' + esc(error.message), 'err'); return ''; }
  return data.signedUrl;
}
ACTIONS['ppt-open'] = async el => { const u = await pptLink(el.dataset.p); if (u) window.open(u, '_blank', 'noopener'); };
function pptSave(brand, article, up) {
  const old = pptAll().find(p => pptKey(p.brand, p.article) === pptKey(brand, article));
  const rec = old || { id: uid(), brand, article: String(article).trim(), versions: [] };
  if (old && old.path) rec.versions = (rec.versions || []).concat([{ path: old.path, name: old.name, by: old.by, at: old.at }]);
  Object.assign(rec, { brand, article: String(article).trim(), path: up.path, name: up.name, size: up.size, by: ME.name, at: nowIso() });
  Store.put('art_ppt', rec);
  // the upload task closes itself
  const t = pptTaskFor(brand, article);
  if (t) { t.done = t.done || {}; t.done[clDoneKey(t, t.start)] = { at: nowIso(), by: ME.name, remark: 'Packaging PPT uploaded', photos: 0, files: 0, log: '' }; t.done_at = nowIso(); clPin(t); Store.put('checklist', t); }
  audit(old && old.versions && old.versions.length ? 'ppt.replace' : 'ppt.upload', brand + ' · ' + article, up.name + (t ? ' · task closed' : ''));
  return rec;
}
/* ---------- Merchant → Packaging PPT ---------- */
// every article of an open order that still has no PPT
function pptMissing() {
  const out = []; const seen = new Set();
  Store.all('orders').filter(o => o.priority !== 'Cancelled' && orderState(o).open).forEach(o => {
    const brand = o.customer_name || o.brand || '';
    (o.lines || []).forEach(l => {
      const art = String(l.article || '').trim(); if (!art) return;
      const k = pptKey(brand, art); if (seen.has(k) || pptOf(brand, art)) return; seen.add(k);
      out.push({ brand, article: art, order: o, task: pptTaskFor(brand, art), doer: pptDoer(brand) });
    });
  });
  return out.sort((a, b) => (a.brand + a.article).localeCompare(b.brand + b.article));
}
VIEWS.packaging = {
  mod: 'merchant', render() {
    const edit = can('merchant', 'edit'); const q = norm(PPT_UI.q);
    const miss = pptMissing();
    let h = '<div class="toolbar">' + seg('pptTab', [{ v: 'have', l: 'Uploaded (' + pptAll().filter(p => p.path).length + ')' }, { v: 'miss', l: 'Missing (' + miss.length + ')' }], PPT_UI.tab) +
      '<input id="pptQ" placeholder="Search brand or article…" value="' + esc(PPT_UI.q) + '"><span class="grow"></span><button class="btn" data-act="print">Print</button>' + (edit ? '<button class="btn primary" data-act="ppt-new">+ Upload PPT</button>' : '') + '</div>';
    if (PPT_UI.form && edit) {
      const F = PPT_UI.form === true ? {} : PPT_UI.form;
      const arts = Array.from(new Set(Store.all('orders').flatMap(o => (o.lines || []).map(l => l.article)).concat(Store.all('items').map(i => i.code)).filter(Boolean))).sort();
      h += '<div class="panel" style="max-width:720px"><table class="jckv">' +
        '<tr><td class="k">Brand *</td><td class="v"><select id="ppBrand">' + selOpts(Store.all('customers').map(c => c.name).sort(), F.brand || '') + '</select></td></tr>' +
        '<tr><td class="k">Article *</td><td class="v"><input id="ppArt" list="ppArts" value="' + esc(F.article || '') + '"><datalist id="ppArts">' + arts.map(a => '<option value="' + esc(a) + '">').join('') + '</datalist></td></tr>' +
        '<tr><td class="k">File *</td><td class="v"><input id="ppFile" type="file" accept=".ppt,.pptx,.pdf"><div class="small muted">PPT, PPTX or PDF, up to 30 MB</div></td></tr></table>' +
        '<div class="toolbar"><button class="btn primary" data-act="ppt-save">Upload</button><button class="btn" data-act="ppt-cancel">Cancel</button><span id="ppMsg" class="small late-txt"></span></div></div>';
    }
    if (PPT_UI.tab === 'miss') {
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Brand</th><th>Article</th><th>Order</th><th>Merchant</th><th>Upload task</th><th class="noprint"></th></tr>' +
        (miss.length ? miss.filter(m => !q || norm(m.brand + ' ' + m.article).includes(q)).map(m => '<tr><td>' + esc(m.brand) + '</td><td><b>' + esc(m.article) + '</b></td><td>' + esc(m.order.no) + '</td><td>' + esc(m.doer) + '</td><td>' + (m.task ? '<span class="st ' + (clPlanned(m.task, m.task.start) < new Date() ? 'Late' : 'Pending') + '">' + (clPlanned(m.task, m.task.start) < new Date() ? 'Late' : 'Pending') + '</span> <span class="small muted">due ' + fmtD(m.task.start) + '</span>' : '<span class="muted small">no task</span>') + '</td>' +
          '<td class="noprint">' + (edit ? '<button class="btn sm primary" data-act="ppt-new" data-b="' + esc(m.brand) + '" data-a="' + esc(m.article) + '">Upload</button>' + (m.task ? '' : ' <button class="btn sm" data-act="ppt-task" data-b="' + esc(m.brand) + '" data-a="' + esc(m.article) + '">Raise task</button>') : '') + '</td></tr>').join('')
          : '<tr><td colspan="6" class="empty">Every article of the open orders has its packaging PPT</td></tr>') + '</table></div>';
    } else {
      const list = pptAll().filter(p => p.path && (!q || norm(p.brand + ' ' + p.article).includes(q))).sort((a, b) => (a.brand + a.article).localeCompare(b.brand + b.article));
      h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Brand</th><th>Article</th><th>File</th><th>Uploaded by</th><th>Date</th><th class="num">Versions</th><th class="noprint"></th></tr>' +
        (list.length ? list.map(p => '<tr><td>' + esc(p.brand) + '</td><td><b>' + esc(p.article) + '</b></td><td><a data-act="ppt-open" data-p="' + esc(p.path) + '">📎 ' + esc(p.name) + '</a></td><td>' + esc(p.by || '') + '</td><td class="nowrap">' + fmtDT(p.at) + '</td><td class="num">' + (1 + (p.versions || []).length) + '</td>' +
          '<td class="noprint">' + (edit ? '<button class="btn sm" data-act="ppt-new" data-b="' + esc(p.brand) + '" data-a="' + esc(p.article) + '">Replace</button>' : '') + ((p.versions || []).length ? ' <a class="small" data-act="ppt-hist" data-id="' + esc(p.id) + '">History</a>' : '') + '</td></tr>').join('')
          : '<tr><td colspan="7" class="empty">No packaging PPT uploaded yet</td></tr>') + '</table></div>';
    }
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'pptTab') { PPT_UI.tab = e.detail; VIEWS.packaging.render(); } });
    const sq = $('#pptQ'); if (sq) sq.addEventListener('input', () => { PPT_UI.q = sq.value; clearTimeout(PPT_UI.t); PPT_UI.t = setTimeout(() => { const c = sq.selectionStart; VIEWS.packaging.render(); const n = $('#pptQ'); if (n) { n.focus(); n.setSelectionRange(c, c); } }, 250); });
  }
};
ACTIONS['ppt-new'] = el => { PPT_UI.form = el && el.dataset.b ? { brand: el.dataset.b, article: el.dataset.a } : true; VIEWS.packaging.render(); };
ACTIONS['ppt-cancel'] = () => { PPT_UI.form = false; VIEWS.packaging.render(); };
ACTIONS['ppt-task'] = el => {
  if (!requirePerm('merchant', 'edit')) return;
  const brand = el.dataset.b, art = el.dataset.a; if (pptTaskFor(brand, art)) return;
  const doer = pptDoer(brand); if (!doer) { flash('No merchant is set for ' + esc(brand) + ' in the CDB.', 'err'); return; }
  const t = eaDelegate('Upload the packaging PPT for article ' + art + ' (' + brand + ')', doer, ymdOf(new Date(Date.now() + 3 * 86400000)), 'ppt', '', { attach: true });
  t.ref = pptKey(brand, art); t.brand = brand; t.article = art; Store.put('checklist', t);
  flash('Task raised on ' + esc(doer) + '.'); renderNav(); VIEWS.packaging.render();
};
ACTIONS['ppt-save'] = async el => {
  if (!requirePerm('merchant', 'edit')) return;
  const brand = $('#ppBrand').value, art = $('#ppArt').value.trim().toUpperCase(), f = ($('#ppFile').files || [])[0];
  const msg = t => { $('#ppMsg').textContent = t; };
  if (!brand) return msg('Select the brand.'); if (!art) return msg('Enter the article.'); if (!f) return msg('Choose the file.');
  el.disabled = true; msg('Uploading…');
  const up = await pptUpload(brand, art, f);
  el.disabled = false;
  if (up.err) return msg(up.err);
  pptSave(brand, art, up); PPT_UI.form = false; flash('Packaging PPT saved for ' + esc(art) + '.'); renderNav(); VIEWS.packaging.render();
};
ACTIONS['ppt-hist'] = el => {
  const p = Store.get('art_ppt', el.dataset.id); if (!p) return;
  const rows = [{ path: p.path, name: p.name, by: p.by, at: p.at }].concat((p.versions || []).slice().reverse());
  formDialog('Packaging PPT · ' + p.brand + ' · ' + p.article, [{ k: 'x', l: 'Versions', type: 'static', value: '' }], 'Close', () => {});
  const d = $('#fxDlg'); if (d) $('.jckv', d).innerHTML = '<tr class="hd"><th>File</th><th>By</th><th>When</th></tr>' + rows.map((v, i) => '<tr><td><a data-act="ppt-open" data-p="' + esc(v.path) + '">' + esc(v.name || 'file') + '</a>' + (i ? '' : ' <b>(current)</b>') + '</td><td>' + esc(v.by || '') + '</td><td>' + fmtDT(v.at) + '</td></tr>').join('');
};
/* ---------- job card: the PPT goes with it ---------- */
// mail to the brand merchant: job card PDF attached, packaging PPT as a 7-day link
async function pptJcMail(j) {
  if (!CLOUD || !SB || DEMO) return;
  const bp = brandPeople(j.brand); const want = [bp.merchant, bp.junior].filter(Boolean);
  const to = Array.from(new Set(Store.all('users').filter(u => u.active !== false && u.email && want.some(w => norm(u.doer) === norm(w))).map(u => String(u.email).trim().toLowerCase()))).join(',');
  if (!to) return;
  const p = pptOf(j.brand, j.article);
  const link = p ? await pptLink(p.path, 7 * 24 * 3600) : '';
  const body = 'Dear ' + (bp.merchant || 'Merchant') + ',\n\nJob card ' + j.no + ' has been created.\n\nOrder: ' + (j.order_no || '-') + '\nBrand: ' + j.brand + '\nArticle: ' + j.article + (j.colour ? ' · ' + j.colour : '') + '\nQty: ' + qtyFmt(j.qty) +
    '\n\nThe job card is attached as a PDF.' + (link ? '\nPackaging PPT (' + (p.name || 'file') + '), open within 7 days:\n' + link : '\nPackaging PPT: not uploaded.') + '\n\nNexus 2.0';
  const mq = Store.put('mail_queue', { id: uid(), to, subject: 'Job Card ' + j.no + ' — ' + j.article + ' (' + j.brand + ')', body, ref: j.no, name: 'Nexus 2.0', no_reply: true, status: 'queued', at: nowIso(), by: ME.name });
  try { const pdf = await waPdf('jc', j.id); mailSend(mq.id, false, { pdf, pdf_name: 'JobCard_' + String(j.no).replace(/[^\w.-]+/g, '_') + '.pdf' }); } catch (e) { mailSend(mq.id); }
}
