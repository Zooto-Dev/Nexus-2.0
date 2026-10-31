/* Nexus 2.0 — what a task needs before it can be marked Done: an attachment, a remark, a date.
   Set it on a Checklist / Delegation task or on an FMS step; it is then asked for and checked at Done.
   Photos are kept small in the record; any other file goes to the private 'task-files' bucket. */
'use strict';

const NEED_KEYS = [['attach', 'Attachment'], ['remark', 'Remark'], ['date', 'Date']];
const needOn = (need, k) => !!(need && need[k]);
const needAny = need => NEED_KEYS.some(([k]) => needOn(need, k));
const needText = need => NEED_KEYS.filter(([k]) => needOn(need, k)).map(([k, l]) => k === 'date' && need.date_label ? need.date_label : l).join(' + ');
// the same chips in every form that sets the requirements
function needChips(id, need) {
  return '<div class="need-set" data-need="' + esc(id) + '">' + NEED_KEYS.map(([k, l]) =>
    '<label class="chip"><input type="checkbox" class="nd-' + esc(id) + '" value="' + k + '"' + (needOn(need, k) ? ' checked' : '') + '> ' + l + '</label>').join('') +
    '<input class="nd-lbl nd-lbl-' + esc(id) + '" maxlength="40" placeholder="Date label, e.g. Payment date" value="' + esc((need && need.date_label) || '') + '"' + (needOn(need, 'date') ? '' : ' style="display:none"') + '></div>';
}
function needRead(id) {
  const out = {};
  $$('.nd-' + id).forEach(c => { if (c.checked) out[c.value] = true; });
  const l = $('.nd-lbl-' + id); if (out.date && l && l.value.trim()) out.date_label = l.value.trim();
  return needAny(out) ? out : null;
}
// the date label box shows only while Date is ticked
document.addEventListener('change', e => {
  const box = e.target.closest && e.target.closest('.need-set'); if (!box || e.target.type !== 'checkbox') return;
  const lbl = $('.nd-lbl', box); if (lbl) lbl.style.display = $$('input[type=checkbox]', box).some(c => c.value === 'date' && c.checked) ? '' : 'none';
});

/* ---------- Done dialog: the rows this task needs, and what the doer filled in ---------- */
function needRows(need, attachReq, remarkReq) {
  const dl = (need && need.date_label) || 'Date';
  return '<tr><td class="k">Attachment' + (attachReq ? ' *' : '') + '</td><td class="v"><input id="ndFile" type="file" multiple> <span id="ndFileN" class="small muted"></span></td></tr>' +
    '<tr><td class="k">Remark' + (remarkReq ? ' *' : '') + '</td><td class="v"><textarea id="ndRem" rows="2"></textarea></td></tr>' +
    (needOn(need, 'date') ? '<tr><td class="k">' + esc(dl) + ' *</td><td class="v"><input id="ndDate" type="date"></td></tr>' : '');
}
// reads the files as they are picked: pictures are shrunk and kept inline, other files go to the bucket
function needWire(d, bag) {
  const inp = $('#ndFile', d); if (!inp) return;
  inp.addEventListener('change', async () => {
    const n = $('#ndFileN', d); const list = Array.from(inp.files || []); inp.value = '';
    for (const f of list) {
      if (f.size > 15 * 1024 * 1024) { n.textContent = f.name + ' is over 15 MB'; continue; }
      n.textContent = 'Reading ' + f.name + '…';
      if (/^image\//.test(f.type)) await new Promise(r => readImg(f, src => { if (src) bag.photos.push(src); r(); }));
      else { const up = await taskUpload(f); if (up.err) { n.textContent = up.err; continue; } bag.files.push(up); }
      n.textContent = (bag.photos.length + bag.files.length) + ' file(s) attached';
    }
  });
}
function needCheck(d, need, bag, attachReq, remarkReq) {
  if (attachReq && !(bag.photos.length + bag.files.length)) return 'Attach the file.';
  const rem = (($('#ndRem', d) || {}).value || '').trim(); if (remarkReq && !rem) return 'Write the remark.';
  const dt = ($('#ndDate', d) || {}).value || ''; if (needOn(need, 'date') && !dt) return 'Enter the ' + ((need && need.date_label) || 'date') + '.';
  bag.remark = rem; bag.date = dt; return '';
}
async function taskUpload(file) {
  if (!CLOUD || !SB) return { err: 'Files other than pictures can be attached in cloud mode only' };
  const name = String(file.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const path = todayYmd() + '/' + uid() + '_' + name;
  const { error } = await SB.storage.from('task-files').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  return error ? { err: 'Upload failed: ' + error.message } : { name, path, size: file.size };
}
async function taskFileOpen(path) {
  if (!CLOUD || !SB) { flash('Files open in cloud mode.', 'err'); return; }
  const { data, error } = await SB.storage.from('task-files').createSignedUrl(path, 180);
  if (error) { flash('Could not open the file: ' + esc(error.message), 'err'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}
ACTIONS['nd-file'] = el => taskFileOpen(el.dataset.p);
// what was attached, as links (pictures in a new tab, files through a signed link)
function proofHtml(p) {
  if (!p) return '';
  const imgs = (p.photos || []).length ? '<a data-act="nd-imgs" data-id="' + esc(p.id || '') + '">📷 ' + p.photos.length + ' photo(s)</a> ' : '';
  const fls = (p.files || []).map(f => '<a data-act="nd-file" data-p="' + esc(f.path) + '">📎 ' + esc(f.name) + '</a>').join(' ');
  return imgs + fls;
}
ACTIONS['nd-imgs'] = el => { const p = Store.get('task_proof', el.dataset.id) || Store.get('checklist_log', el.dataset.id); if (!p) return; const w = window.open(''); if (w) w.document.write((p.photos || []).map(x => '<img src="' + x + '" style="max-width:100%;margin:4px">').join('')); };

/* ---------- set the requirements on a task that already exists ---------- */
function needEditDialog(title, need, onOk) {
  const old = $('#ndDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'ndDlg'; d.className = 'dlg-back';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + esc(title) + '</div><table class="jckv"><tr><td class="k">To mark it done, ask for</td><td class="v">' + needChips('edit', need) + '<div class="small muted" style="margin-top:4px">Tick nothing to keep it open (a picture is still asked for, as before).</div></td></tr></table>' +
    '<div class="dlg-f"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-x]') || ev.target === d) { d.remove(); return; }
    if (!ev.target.closest('[data-ok]')) return;
    const need = needRead('edit'); d.remove(); onOk(need);
  });
}
