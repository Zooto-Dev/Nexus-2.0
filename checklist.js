/* Nexus 2.0 — Checklist / Delegation (port of the old Apps Script CHECKLIST module).
   One record = one task rule (doer, task, frequency, schedule, start/end, skip Sunday/holidays, shift).
   Its dates are worked out from the rule, so nothing is copied row by row; each date's completion
   (actual time, remark, done by) lives in t.done[YYYY-MM-DD], photos in the checklist_log collection. */
'use strict';

const CL_FREQ = {
  'Daily': [['Daily', 'none'], ['Every X Days', 'numDays'], ['Weekdays Only (Mon-Fri)', 'none'], ['Weekends Only (Sat-Sun)', 'none'], ['Working Days Only', 'none'], ['Non-Working Days Only', 'none'], ['Alternate Days', 'none']],
  'Weekly': [['Weekly', 'weekday'], ['Bi-Weekly', 'weekday'], ['Every X Weeks', 'numWeeksDay'], ['Multiple Days', 'weekdays'], ['Specific Weekday', 'weekday'], ['Weekend Only', 'none'], ['Last Working Day of Week', 'none']],
  'Monthly': [['Monthly', 'monthday'], ['Every X Months', 'numMonthsDay'], ['First Day', 'none'], ['Last Day', 'none'], ['First Working Day', 'none'], ['Last Working Day', 'none'], ['Nth Weekday', 'nthWeekday'], ['Last Weekday', 'weekday']],
  'Quarterly': [['Quarterly', 'none'], ['Every Quarter Start', 'none'], ['Every Quarter End', 'none']],
  'Half-Yearly': [['Every 6 Months', 'none'], ['Financial Half Year', 'none']],
  'Yearly': [['Every Year', 'none'], ['Every X Years', 'numYears'], ['Specific Month', 'month'], ['Specific Date', 'dateMD'], ['Birthday', 'dateMD'], ['Anniversary', 'dateMD']],
  'Financial': [['Financial Year Start', 'none'], ['Financial Year End', 'none'], ['Month Closing', 'none'], ['Quarter Closing', 'none'], ['Year Closing', 'none']]
};
const CL_FREQ_MAP = {}; Object.keys(CL_FREQ).forEach(c => CL_FREQ[c].forEach(o => { CL_FREQ_MAP[o[0]] = { cat: c, detail: o[1] }; }));
const CL_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CL_SHIFTS = { G: '17:30' };
const CL_DAY = 86400000;
const CL_DAILY = ['Daily', 'Every X Days', 'Alternate Days', 'Weekdays Only (Mon-Fri)', 'Weekends Only (Sat-Sun)', 'Working Days Only', 'Non-Working Days Only'];

const clMid = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const clYmd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const clDate = s => { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const clLastDom = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
function clHolidays() { return new Set(calendar().holidays || []); }
function clWeekStart(d) { const x = clMid(d); return new Date(x.getTime() - ((x.getDay() + 6) % 7) * CL_DAY); }
function clFirstWorking(d, hol) { let x = new Date(d.getFullYear(), d.getMonth(), 1); while (x.getDay() === 0 || hol.has(clYmd(x))) x = new Date(x.getTime() + CL_DAY); return clYmd(x) === clYmd(d); }
function clLastWorking(d, hol) { let x = new Date(d.getFullYear(), d.getMonth() + 1, 0); while (x.getDay() === 0 || hol.has(clYmd(x))) x = new Date(x.getTime() - CL_DAY); return clYmd(x) === clYmd(d); }
function clLastWorkingOfWeek(d, hol) { let x = new Date(d.getTime() + ((6 - d.getDay() + 7) % 7) * CL_DAY); while (x.getDay() === 0 || hol.has(clYmd(x))) x = new Date(x.getTime() - CL_DAY); return clYmd(x) === clYmd(d); }

// old records (Once / Daily / Weekly with wday) -> same shape as new ones
function clRule(t) {
  if (t.freq === 'Once' || t.type === 'Delegation') return Object.assign({}, t, { type: 'Delegation', frequency: '', start: t.start || t.due || '' });
  if (!t.start && t.created_at) t = Object.assign({}, t, { start: String(t.created_at).slice(0, 10) });
  if (t.frequency) return t;
  if (t.freq === 'Weekly') return Object.assign({}, t, { type: 'Checklist', frequency: 'Weekly', schedule: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][num(t.wday)] || 'Monday' });
  return Object.assign({}, t, { type: 'Checklist', frequency: 'Daily', skip_sun: false });
}
// is the rule due on this date (before the Sunday / holiday adjustment)?
function clDueOn(t, d, hol) {
  const day = clMid(d); const start = clDate(t.start), end = clDate(t.end);
  if (start && day < start) return false; if (end && day > end) return false;
  const sched = t.schedule || ''; const wd = day.getDay();
  const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd];
  const n = s => { const m = String(s).match(/\d+/); return m ? +m[0] : 0; };
  const months = () => (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
  switch (t.frequency) {
    case 'Daily': return true;
    case 'Every X Days': return !!start && Math.round((day - start) / CL_DAY) % (n(sched) || 1) === 0;
    case 'Alternate Days': return !!start && Math.round((day - start) / CL_DAY) % 2 === 0;
    case 'Weekdays Only (Mon-Fri)': return wd >= 1 && wd <= 5;
    case 'Weekends Only (Sat-Sun)': case 'Weekend Only': return wd === 0 || wd === 6;
    case 'Working Days Only': return wd !== 0 && !hol.has(clYmd(day));
    case 'Non-Working Days Only': return wd === 0 || hol.has(clYmd(day));
    case 'Weekly': case 'Specific Weekday': return name === sched;
    case 'Bi-Weekly': return name === sched && !!start && Math.floor((clWeekStart(day) - clWeekStart(start)) / (7 * CL_DAY)) % 2 === 0;
    case 'Every X Weeks': { const p = sched.split(' on '); return name === (p[1] || '').trim() && !!start && Math.floor((clWeekStart(day) - clWeekStart(start)) / (7 * CL_DAY)) % (n(p[0]) || 1) === 0; }
    case 'Multiple Days': return sched.split(',').map(s => s.trim()).includes(name);
    case 'Last Working Day of Week': return clLastWorkingOfWeek(day, hol);
    case 'Monthly': return day.getDate() === n(sched);
    case 'Every X Months': { if (!start) return false; const x = +((sched.match(/Every (\d+)/) || [])[1] || 1); const dm = (sched.match(/Day (\d+)/) || [])[1]; const md = months(); return md >= 0 && md % x === 0 && day.getDate() === (dm ? +dm : start.getDate()); }
    case 'First Day': return day.getDate() === 1;
    case 'Last Day': case 'Month Closing': return day.getDate() === clLastDom(day);
    case 'First Working Day': return clFirstWorking(day, hol);
    case 'Last Working Day': return clLastWorking(day, hol);
    case 'Nth Weekday': { const p = sched.split(' '); if (name !== p[1]) return false; if (p[0] === 'Last') return day.getDate() + 7 > clLastDom(day); return Math.floor((day.getDate() - 1) / 7) + 1 === ({ First: 1, Second: 2, Third: 3, Fourth: 4 })[p[0]]; }
    case 'Last Weekday': return name === sched && day.getDate() + 7 > clLastDom(day);
    case 'Specific Date': case 'Birthday': case 'Anniversary': { const p = sched.split(' '); return day.getDate() === +p[0] && CL_MONTHS[day.getMonth()] === p.slice(1).join(' '); }
    case 'Specific Month': return CL_MONTHS[day.getMonth()] === sched && day.getDate() === 1;
    case 'Every Year': return !!start && day.getDate() === start.getDate() && day.getMonth() === start.getMonth();
    case 'Every X Years': return !!start && day.getDate() === start.getDate() && day.getMonth() === start.getMonth() && (day.getFullYear() - start.getFullYear()) % (n(sched) || 1) === 0;
    case 'Quarterly': { if (!start) return false; const md = months(); return md >= 0 && md % 3 === 0 && day.getDate() === start.getDate(); }
    case 'Every Quarter Start': return [0, 3, 6, 9].includes(day.getMonth()) && day.getDate() === 1;
    case 'Every Quarter End': case 'Quarter Closing': return [2, 5, 8, 11].includes(day.getMonth()) && day.getDate() === clLastDom(day);
    case 'Every 6 Months': { if (!start) return false; const md = months(); return md >= 0 && md % 6 === 0 && day.getDate() === start.getDate(); }
    case 'Financial Half Year': return (day.getMonth() === 2 || day.getMonth() === 8) && day.getDate() === clLastDom(day);
    case 'Financial Year Start': return day.getMonth() === 3 && day.getDate() === 1;
    case 'Financial Year End': case 'Year Closing': return day.getMonth() === 2 && day.getDate() === clLastDom(day);
    default: return false;
  }
}
// task dates between from and to (YYYY-MM-DD). Daily types drop skipped days; others move back to the previous working day.
function clDates(t, from, to) {
  const r = clRule(t);
  if (r.type === 'Delegation') { const d = r.start; return d && d >= from && d <= to ? [d] : []; }
  const hol = clHolidays(); const skip = d => (r.skip_sun !== false && d.getDay() === 0) || (r.skip_hol && hol.has(clYmd(d)));
  const daily = CL_DAILY.includes(r.frequency); const out = new Set();
  let d = clDate(from); const end = clDate(to); if (!d || !end) return [];
  if (r.start && clDate(r.start) > d) d = clDate(r.start);
  for (let g = 0; d <= end && g < 800; d = new Date(d.getTime() + CL_DAY), g++) {
    if (!clDueOn(r, d, hol)) continue;
    if (daily) { if (!skip(d)) out.add(clYmd(d)); continue; }
    let a = new Date(d); for (let k = 0; skip(a) && k < 15; k++) a = new Date(a.getTime() - CL_DAY);
    const y = clYmd(a); if (y >= from) out.add(y);
  }
  return Array.from(out).sort();
}
function clPlanned(t, ymd) {
  if (t.planned && (t.freq === 'Once' || t.type === 'Delegation')) return new Date(t.planned);
  const hm = t.time || CL_SHIFTS[t.shift || 'G'] || '17:30';
  return new Date(ymd + 'T' + hm + ':00');
}
// old records have no start date: pin one before the first save so their dates never move
function clPin(t) { if (!t.start && t.freq !== 'Once' && t.type !== 'Delegation') { const d = new Date(); t.start = t.created_at ? String(t.created_at).slice(0, 10) : ymdOf(new Date(d.getFullYear(), d.getMonth(), 1)); } return t; }
function clDoneKey(t, ymd) { return (t.freq === 'Once' || t.type === 'Delegation') ? 'once' : ymd; }
function clDoneOf(t, ymd) {
  const v = (t.done || {})[clDoneKey(t, ymd)]; if (!v) return null;
  if (typeof v === 'object') return v;
  if (clDoneKey(t, ymd) === 'once') { const p = String(v).split(' · '); return { by: p[0], at: t.done_at || (p[1] ? p[1] + 'T12:00:00' : '') }; }
  return { by: v, at: t.done_at && t.done_at.slice(0, 10) === ymd ? t.done_at : ymd + 'T12:00:00' };
}
function clDelayMin(p, a) { if (!p || !a || a <= p) return 0; try { return calInfo().workMinutesBetween(p, a); } catch (e) { return Math.round((a - p) / 60000); } }
function clUserOf(doer) { return Store.all('users').find(u => norm(u.doer) === norm(doer)) || {}; }
// flat rows: one per task date
function clRows(from, to, filter) {
  const now = new Date(); const today = todayYmd(); const out = [];
  Store.all('checklist').filter(t => t.active !== false && (!filter || filter(t))).forEach(t => {
    const r = clRule(t); const u = clUserOf(t.doer);
    clDates(t, from, to).forEach(ymd => {
      const p = clPlanned(t, ymd); const dn = clDoneOf(t, ymd); const a = dn && dn.at ? new Date(dn.at) : null;
      const status = a ? 'Done' : p < now ? 'Overdue' : ymd === today ? 'Pending' : 'Upcoming';
      out.push({ t, ymd, type: r.type, doer: t.doer, dept: t.dept || u.department || '', freq: r.type === 'Delegation' ? '' : r.frequency, sched: r.schedule || '', task: t.title, planned: p, actual: a, status,
        delay: a ? clDelayMin(p, a) : status === 'Overdue' ? clDelayMin(p, now) : 0, by: dn ? dn.by : '', remark: dn ? dn.remark || '' : '', photos: dn ? dn.photos || 0 : 0, log: dn ? dn.log || '' : '' });
    });
  });
  return out.sort((a, b) => a.planned - b.planned);
}
// kept for Home / nav counts
function checklistDueToday(t) { const today = todayYmd(); return clDates(t, ymdOf(new Date(Date.now() - 60 * CL_DAY)), today).some(y => !clDoneOf(t, y)); }
function myChecklistDue() { const today = todayYmd(); return clRows(ymdOf(new Date(Date.now() - 60 * CL_DAY)), today, t => isMyDoer(t.doer)).filter(r => r.status !== 'Done'); }
function clCanAdd() { return can('checklist', 'edit') && (isSuperAdmin() || isAdminRole() || norm(ME.department || '') === 'mis'); }
function clCanMark(t) { return isMyDoer(t.doer) || can('tracker', 'edit'); }
function clDoneBtn(t, ymd) { return clCanMark(t) ? '<button class="btn sm primary" data-act="cl-done" data-id="' + esc(t.id) + '" data-d="' + esc(ymd) + '">Done</button>' : ''; }

/* ---------- mark done: remark + photo proof (photo needed for everyone except Accounts) ---------- */
ACTIONS['cl-done'] = el => {
  const t = Store.get('checklist', el.dataset.id); if (!t) return;
  if (!clCanMark(t)) { flash('Only ' + esc(t.doer) + ' can mark this done.', 'err'); return; }
  const ymd = el.dataset.d || todayYmd();
  const isDN = t.kind === 'debit_note' || /^Debit Note/i.test(t.title || '');
  const needPhoto = !isDN && !/account/i.test(clUserOf(t.doer).department || t.dept || ''); let dnPdf = '';
  const old = $('#clDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'clDlg'; d.className = 'dlg-back'; const photos = [];
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + esc(t.title) + ' · ' + fmtD(ymd) + '</div><table class="jckv">' +
    (isDN ? '<tr><td class="k">Debit Note PDF *</td><td class="v"><input id="clDn" type="file" accept="application/pdf"></td></tr>' : '') +
    '<tr><td class="k">Photo' + (needPhoto ? ' *' : '') + '</td><td class="v"><input id="clPh" type="file" accept="image/*" multiple> <span id="clPhN" class="small muted"></span></td></tr>' +
    '<tr><td class="k">Remark</td><td class="v"><textarea id="clRem" rows="2"></textarea></td></tr></table>' +
    '<div class="dlg-f"><span id="clMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Done</button></div></div>';
  document.body.appendChild(d);
  if (isDN) $('#clDn', d).addEventListener('change', e => { const f = e.target.files[0]; if (!f) { dnPdf = ''; return; } if (f.size > 5 * 1024 * 1024) { $('#clMsg', d).textContent = 'PDF must be under 5 MB.'; e.target.value = ''; return; } const fr = new FileReader(); fr.onload = () => { dnPdf = String(fr.result).split('base64,')[1] || ''; }; fr.readAsDataURL(f); });
  $('#clPh', d).addEventListener('change', e => { Array.from(e.target.files || []).forEach(f => readImg(f, src => { if (src) photos.push(src); $('#clPhN', d).textContent = photos.length + ' photo(s)'; })); });
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-x]')) { d.remove(); return; }
    if (!ev.target.closest('[data-ok]')) return;
    if (needPhoto && !photos.length) { $('#clMsg', d).textContent = 'Attach a photo.'; return; }
    if (isDN && !dnPdf) { $('#clMsg', d).textContent = 'Attach the debit note PDF.'; return; }
    const rem = $('#clRem', d).value.trim(); const at = nowIso();
    let log = '';
    if (photos.length) { log = uid(); Store.put('checklist_log', { id: log, task_id: t.id, ymd, doer: t.doer, task: t.title, photos, remark: rem, at, by: ME.name }); }
    t.done = t.done || {}; t.done[clDoneKey(t, ymd)] = { at, by: ME.name, remark: rem, photos: photos.length, log };
    t.done_at = at; clPin(t); Store.put('checklist', t);
    audit('checklist.done', t.title, t.doer + ' · ' + ymd + (rem ? ' — ' + rem : '')); d.remove(); renderNav(); route();
    if (isDN) { waSend('debit_note', t.id + '|' + ymd, false, { pdf: dnPdf }); clDnMail(t, dnPdf); }   // the debit note goes to the vendor on WhatsApp and email
  });
};
// debit note mail to the vendor (as in the old code): PDF attached, Purchase + Store team in CC, no-reply sender
function clDnMail(t, pdf) {
  let vendor = t.vendor || '', invoice = t.invoice || '';
  if (!vendor) { const m = /Debit Note\s*[—-]\s*(.*?)\s*\((.*)\)\s*:/.exec(String(t.title || '')); if (m) { invoice = m[1]; vendor = m[2]; } }
  const v = vendorBy(vendor) || {}; const to = String(v.email || '').trim();
  const real = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@nexus\.local$/i.test(e);
  const cc = Array.from(new Set(Store.all('users').filter(u => u.active !== false && /PURCHASE|STORE/i.test(u.department || '')).map(u => String(u.email || '').trim().toLowerCase()).filter(e => real(e) && e !== to.toLowerCase()))).join(',');
  const noreply = String(settings().noreply_email || '').trim();
  const item = t.items || '';
  const body = 'Dear ' + (vendor || 'Vendor') + ',\n\n' +
    'Please find attached the Debit Note issued against your Invoice No. ' + (invoice || '-') + (item ? ' for the item "' + item + '"' : '') + '.\n\n' +
    'This Debit Note has been raised on account of shortage / rejected material observed at the time of receipt. ' +
    'Kindly adjust the said amount in your ledger and acknowledge receipt of this Debit Note by replying to this email.\n\n' +
    'In case of any query, please contact our Accounts team.\n\n' +
    'Thanks & Regards,\nAccounts Team\nZooto Fashion Pvt Ltd\nIMT Manesar, Gurugram';
  const mq = Store.put('mail_queue', { id: uid(), to, cc, subject: 'Debit Note against Invoice ' + (invoice || '-') + ' — Zooto Fashion Pvt Ltd', body, ref: invoice || t.title, name: 'Zooto Fashion Pvt Ltd (no-reply)', no_reply: true, reply_to: noreply, from: noreply, attach_pdf: true,
    status: real(to) ? 'queued' : 'no_recipient', error: real(to) ? '' : 'Vendor email is not in the vendor master', at: nowIso(), by: ME.name });
  if (real(to)) mailSend(mq.id, false, { pdf, pdf_name: 'Debit_Note_' + String(invoice || 'DN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30) + '.pdf' });
  else flash('Debit note mail not sent — add the email of ' + esc(vendor || 'the vendor') + ' in the vendor master.', 'err');
}
ACTIONS['cl-photo'] = el => { const l = Store.get('checklist_log', el.dataset.log); if (!l) return; const w = window.open(''); w.document.write(l.photos.map(p => '<img src="' + p + '" style="max-width:100%;margin:4px">').join('')); };
ACTIONS['cl-undo'] = el => {
  const t = Store.get('checklist', el.dataset.id); if (!t) return; const k = clDoneKey(t, el.dataset.d); const dn = clDoneOf(t, el.dataset.d);
  if (!can('tracker', 'edit') && !(dn && dn.by === ME.name)) { flash('Undo needs tracker edit access.', 'err'); return; }
  delete t.done[k]; clPin(t); Store.put('checklist', t); audit('checklist.undo', t.title, t.doer + ' · ' + el.dataset.d); route();
};

/* ---------- Checklist screen: All Tasks | New Task | Task List ---------- */
const CHK_UI = { tab: 'tasks', st: 'open', who: '', from: '', to: '', type: 'Checklist', freq: 'Daily' };
VIEWS.checklist = {
  mod: 'checklist', render() {
    const all = can('tracker', 'edit') || isAdminRole();
    if (!all) CHK_UI.who = ME.doer || '';
    if (!CHK_UI.from) { const d = new Date(); CHK_UI.from = ymdOf(new Date(d.getFullYear(), d.getMonth(), 1)); CHK_UI.to = ymdOf(new Date(Date.now() + 7 * CL_DAY)); }
    const tabs = [{ v: 'tasks', l: 'All Tasks' }].concat(clCanAdd() ? [{ v: 'new', l: 'New Task' }] : []).concat([{ v: 'list', l: 'Task List' }]);
    if (!tabs.some(x => x.v === CHK_UI.tab)) CHK_UI.tab = 'tasks';
    let h = '<div class="toolbar">' + seg('clTab', tabs, CHK_UI.tab) + '</div>';
    h += CHK_UI.tab === 'new' ? clNewHtml() : CHK_UI.tab === 'list' ? clListHtml(all) : clTasksHtml(all);
    setMain(h);
    onSeg(e => {
      const s = e.target.dataset.seg;
      if (s === 'clTab') CHK_UI.tab = e.detail; if (s === 'clSt') CHK_UI.st = e.detail;
      if (s === 'clType') CHK_UI.type = e.detail;
      VIEWS.checklist.render();
    });
    const m = $('#main');
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'clWho') { CHK_UI.who = t.value; VIEWS.checklist.render(); }
      if (t.id === 'clFrom' || t.id === 'clTo') { CHK_UI[t.id === 'clFrom' ? 'from' : 'to'] = t.value; VIEWS.checklist.render(); }
      if (t.id === 'clFreq') { clKeepForm(); CHK_UI.freq = t.value; VIEWS.checklist.render(); }
      if (t.id === 'clDoer') { const u = clUserOf(t.value); $('#clDept').value = u.department || ''; $('#clEmail').value = u.email || ''; }
    });
  }
};
function clDoerList() { return Array.from(new Set(Store.all('users').filter(u => u.active !== false && u.doer).map(u => u.doer.toUpperCase()))).sort(); }
function clTasksHtml(all) {
  const rows = clRows(CHK_UI.from, CHK_UI.to, t => !CHK_UI.who || norm(t.doer) === norm(CHK_UI.who)).filter(r =>
    CHK_UI.st === 'all' || (CHK_UI.st === 'open' ? r.status === 'Overdue' || r.status === 'Pending' : r.status.toLowerCase() === CHK_UI.st));
  VIEWS.checklist.rows = rows;
  let h = '<div class="toolbar">' + seg('clSt', [{ v: 'open', l: 'Open' }, { v: 'overdue', l: 'Overdue' }, { v: 'upcoming', l: 'Upcoming' }, { v: 'done', l: 'Done' }, { v: 'all', l: 'All' }], CHK_UI.st) +
    (all ? '<select id="clWho">' + selOpts(clDoerList(), CHK_UI.who, 'All doers') + '</select>' : '') +
    '<input id="clFrom" type="date" value="' + esc(CHK_UI.from) + '"><input id="clTo" type="date" value="' + esc(CHK_UI.to) + '"><span class="muted small">' + rows.length + ' task(s)</span><span class="grow"></span><button class="btn" data-act="cl-csv">Export CSV</button></div>';
  h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Type</th><th>Name</th><th>Department</th><th>Frequency</th><th>Task</th><th>Planned</th><th>Actual</th><th class="num">Time Delay</th><th>Status</th><th>Done By</th><th>Remark</th><th>Photo</th><th></th></tr>' +
    (rows.length ? rows.map(r => '<tr><td>' + esc(r.type) + '</td><td>' + esc(r.doer) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.freq) + '</td><td>' + esc(r.task) + '</td><td class="nowrap">' + fmtDT(r.planned) + '</td><td class="nowrap">' + (r.actual ? fmtDT(r.actual) : '') + '</td>' +
      '<td class="num' + (r.delay ? ' late-txt' : '') + '">' + (r.delay ? fmtDelay(r.delay) : r.actual ? 'No Delay' : '') + '</td><td><span class="st ' + (r.status === 'Done' ? 'Done' : r.status === 'Overdue' ? 'Late' : r.status === 'Pending' ? 'Pending' : 'Waiting') + '">' + r.status + '</span></td><td>' + esc(r.by) + '</td><td>' + esc(r.remark) + '</td>' +
      '<td>' + (r.log ? '<a data-act="cl-photo" data-log="' + esc(r.log) + '">' + r.photos + ' photo</a>' : '') + '</td><td class="nowrap">' + (r.status === 'Done' ? (can('tracker', 'edit') || r.by === ME.name ? '<a class="small" data-act="cl-undo" data-id="' + esc(r.t.id) + '" data-d="' + esc(r.ymd) + '">Undo</a>' : '') : r.status === 'Upcoming' ? '' : clDoneBtn(r.t, r.ymd)) + '</td></tr>').join('')
      : '<tr><td colspan="13" class="empty">No tasks</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['cl-csv'] = () => downloadCsv('checklist-' + todayYmd() + '.csv', [['Type', 'Name', 'Department', 'Frequency', 'Task', 'Planned', 'Actual', 'Time Delay (min)', 'Status', 'Done By', 'Remark']]
  .concat((VIEWS.checklist.rows || []).map(r => [r.type, r.doer, r.dept, r.freq, r.task, fmtDT(r.planned), r.actual ? fmtDT(r.actual) : '', r.delay || 0, r.status, r.by, r.remark])));

/* ---------- New Task form ---------- */
let CL_FORM = {};
function clKeepForm() { $$('#clForm [id]').forEach(e => { CL_FORM[e.id] = e.type === 'checkbox' ? e.checked : e.value; }); CL_FORM.wdays = $$('.cl-wday:checked').map(x => x.value); }
function clSchedHtml(detail) {
  const v = k => esc(CL_FORM[k] || ''); const wsel = id => '<select id="' + id + '">' + CL_WEEKDAYS.map(d => '<option' + (CL_FORM[id] === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>';
  const msel = '<select id="clMonth">' + CL_MONTHS.map(d => '<option' + (CL_FORM.clMonth === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>';
  const numIn = (id, max) => '<input id="' + id + '" type="number" min="1"' + (max ? ' max="' + max + '"' : '') + ' value="' + v(id) + '" style="width:90px">';
  switch (detail) {
    case 'numDays': return '<tr><td class="k">Every how many days *</td><td class="v">' + numIn('clNum') + '</td></tr>';
    case 'numYears': return '<tr><td class="k">Every how many years *</td><td class="v">' + numIn('clNum') + '</td></tr>';
    case 'weekday': return '<tr><td class="k">Day *</td><td class="v">' + wsel('clWeekday') + '</td></tr>';
    case 'weekdays': return '<tr><td class="k">Days *</td><td class="v">' + CL_WEEKDAYS.map(d => '<label class="chip"><input type="checkbox" class="cl-wday" value="' + d + '"' + ((CL_FORM.wdays || []).includes(d) ? ' checked' : '') + '>' + d.slice(0, 3) + '</label>').join('') + '</td></tr>';
    case 'numWeeksDay': return '<tr><td class="k">Every how many weeks *</td><td class="v">' + numIn('clNum') + ' ' + wsel('clWeekday') + '</td></tr>';
    case 'monthday': return '<tr><td class="k">Date of month *</td><td class="v">' + numIn('clMonthDay', 31) + '</td></tr>';
    case 'numMonthsDay': return '<tr><td class="k">Every how many months *</td><td class="v">' + numIn('clNum') + ' Date ' + numIn('clMonthDay', 31) + '</td></tr>';
    case 'nthWeekday': return '<tr><td class="k">Which *</td><td class="v"><select id="clNth">' + ['First', 'Second', 'Third', 'Fourth', 'Last'].map(x => '<option' + (CL_FORM.clNth === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select> ' + wsel('clWeekday') + '</td></tr>';
    case 'month': return '<tr><td class="k">Month *</td><td class="v">' + msel + '</td></tr>';
    case 'dateMD': return '<tr><td class="k">Date *</td><td class="v">' + numIn('clMonthDay', 31) + ' ' + msel + '</td></tr>';
    default: return '';
  }
}
function clNewHtml() {
  const del = CHK_UI.type === 'Delegation'; const F = CL_FORM; const info = CL_FREQ_MAP[CHK_UI.freq] || { detail: 'none' };
  const u = clUserOf(F.clDoer || '');
  const freqSel = '<select id="clFreq">' + Object.keys(CL_FREQ).map(c => '<optgroup label="' + c + '">' + CL_FREQ[c].map(o => '<option' + (o[0] === CHK_UI.freq ? ' selected' : '') + '>' + esc(o[0]) + '</option>').join('') + '</optgroup>').join('') + '</select>';
  return '<div class="panel" id="clForm" style="max-width:760px"><table class="jckv">' +
    '<tr><td class="k">Type *</td><td class="v">' + seg('clType', ['Checklist', 'Delegation'], CHK_UI.type) + '</td></tr>' +
    '<tr><td class="k">Doer *</td><td class="v"><select id="clDoer">' + selOpts(clDoerList(), F.clDoer) + '</select></td></tr>' +
    '<tr><td class="k">Department</td><td class="v"><input id="clDept" value="' + esc(u.department || '') + '" disabled></td></tr>' +
    '<tr><td class="k">Email</td><td class="v"><input id="clEmail" value="' + esc(u.email || '') + '" disabled></td></tr>' +
    '<tr><td class="k">Task *</td><td class="v"><input id="clTask" value="' + esc(F.clTask || '') + '"></td></tr>' +
    (del ? '' : '<tr><td class="k">Frequency *</td><td class="v">' + freqSel + '</td></tr>' + clSchedHtml(info.detail)) +
    '<tr><td class="k">Shift *</td><td class="v"><select id="clShift">' + Object.keys(CL_SHIFTS).map(k => '<option value="' + k + '">' + k + ' (' + CL_SHIFTS[k] + ')</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">' + (del ? 'Date *' : 'Start Date *') + '</td><td class="v"><input id="clStart" type="date" value="' + esc(F.clStart || todayYmd()) + '"></td></tr>' +
    (del ? '' : '<tr><td class="k">End Date</td><td class="v"><input id="clEnd" type="date" value="' + esc(F.clEnd || '') + '"></td></tr>' +
      '<tr><td class="k">Skip</td><td class="v"><label class="chip"><input type="checkbox" id="clSkipSun"' + (F.clSkipSun === false ? '' : ' checked') + '>Sunday</label><label class="chip"><input type="checkbox" id="clSkipHol"' + (F.clSkipHol ? ' checked' : '') + '>Holidays</label></td></tr>') +
    '</table><div class="toolbar"><button class="btn primary" data-act="cl-save">Assign Task</button><span id="clMsg2" class="small"></span></div></div>';
}
ACTIONS['cl-save'] = () => {
  if (!clCanAdd()) { flash('Only Admin or MIS can add tasks.', 'err'); return; }
  clKeepForm(); const F = CL_FORM; const del = CHK_UI.type === 'Delegation'; const msg = t => { $('#clMsg2').innerHTML = '<span class="late-txt">' + esc(t) + '</span>'; };
  if (!F.clDoer) return msg('Select the doer.'); if (!F.clTask || !F.clTask.trim()) return msg('Enter the task.'); if (!F.clStart) return msg('Select the date.');
  const u = clUserOf(F.clDoer);
  const r = { id: uid(), type: CHK_UI.type, title: F.clTask.trim(), doer: F.clDoer, dept: u.department || '', email: u.email || '', shift: F.clShift || 'G', start: F.clStart, active: true, by: ME.name, done: {} };
  if (del) Object.assign(r, { freq: 'Once', due: F.clStart, frequency: '' });
  else {
    const d = (CL_FREQ_MAP[CHK_UI.freq] || {}).detail; let s = '';
    const need = k => { if (!F[k]) throw new Error('Fill the schedule.'); return F[k]; };
    try {
      if (d === 'numDays') s = 'Every ' + need('clNum') + ' days'; else if (d === 'numYears') s = 'Every ' + need('clNum') + ' years';
      else if (d === 'weekday') s = F.clWeekday || 'Monday'; else if (d === 'weekdays') { if (!F.wdays.length) throw new Error('Tick at least one day.'); s = F.wdays.join(', '); }
      else if (d === 'numWeeksDay') s = 'Every ' + need('clNum') + ' weeks on ' + (F.clWeekday || 'Monday'); else if (d === 'monthday') s = 'Day ' + need('clMonthDay');
      else if (d === 'numMonthsDay') s = 'Every ' + need('clNum') + ' months' + (F.clMonthDay ? ', Day ' + F.clMonthDay : ''); else if (d === 'nthWeekday') s = (F.clNth || 'First') + ' ' + (F.clWeekday || 'Monday');
      else if (d === 'month') s = F.clMonth || 'January'; else if (d === 'dateMD') s = need('clMonthDay') + ' ' + (F.clMonth || 'January');
    } catch (e) { return msg(e.message); }
    Object.assign(r, { frequency: CHK_UI.freq, schedule: s, end: F.clEnd || '', skip_sun: F.clSkipSun !== false, skip_hol: !!F.clSkipHol });
    const n = clDates(r, r.start, r.end || ymdOf(new Date(new Date().getFullYear() + 1, 11, 31))).length;
    if (!n) return msg('No date comes out of this frequency / start / end.');
  }
  Store.put('checklist', r);
  audit('checklist.create', r.title, r.doer + ' · ' + (del ? 'Delegation ' + r.start : r.frequency + (r.schedule ? ' ' + r.schedule : '')));
  CL_FORM = { clDoer: F.clDoer }; CHK_UI.tab = 'list'; flash('Task assigned to ' + esc(r.doer) + '.'); renderNav(); VIEWS.checklist.render();
};

/* ---------- Task List: the rules themselves ---------- */
function clListHtml(all) {
  const rows = Store.all('checklist').filter(t => !t.demo && (all || isMyDoer(t.doer))).map(t => ({ t, r: clRule(t) })).sort((a, b) => a.t.doer < b.t.doer ? -1 : 1);
  const edit = clCanAdd();
  return '<div class="tbl-wrap"><table class="bomflat"><tr><th>Type</th><th>Name</th><th>Department</th><th>Task</th><th>Frequency</th><th>Schedule</th><th>Shift</th><th>Start Date</th><th>End Date</th><th>Skip Sunday</th><th>Skip Holidays</th><th>Created By</th><th>Status</th><th></th></tr>' +
    (rows.length ? rows.map(({ t, r }) => '<tr' + (t.active === false ? ' class="muted"' : '') + '><td>' + esc(r.type) + '</td><td>' + esc(t.doer) + '</td><td>' + esc(t.dept || clUserOf(t.doer).department || '') + '</td><td>' + esc(t.title) + '</td><td>' + esc(r.frequency || '') + '</td><td>' + esc(r.schedule || '') + '</td><td>' + esc(t.shift || 'G') + '</td>' +
      '<td class="nowrap">' + (r.start ? fmtD(r.start) : '') + '</td><td class="nowrap">' + (r.end ? fmtD(r.end) : '') + '</td><td>' + (r.type === 'Delegation' ? '' : r.skip_sun === false ? 'No' : 'Yes') + '</td><td>' + (r.type === 'Delegation' ? '' : r.skip_hol ? 'Yes' : 'No') + '</td><td>' + esc(t.by || '') + '</td><td>' + (t.active === false ? 'Paused' : 'Active') + '</td>' +
      '<td class="nowrap">' + (edit ? '<button class="btn sm" data-act="cl-pause" data-id="' + esc(t.id) + '">' + (t.active === false ? 'Resume' : 'Pause') + '</button> <button class="btn ghost sm danger" data-act="cl-del" data-id="' + esc(t.id) + '" data-confirm="Delete this task and its history?">×</button>' : '') + '</td></tr>').join('')
      : '<tr><td colspan="14" class="empty">No tasks</td></tr>') + '</table></div>';
}
ACTIONS['cl-pause'] = el => { if (!clCanAdd()) return; const t = Store.get('checklist', el.dataset.id); t.active = t.active === false; clPin(t); Store.put('checklist', t); audit(t.active ? 'checklist.resume' : 'checklist.pause', t.title, t.doer); VIEWS.checklist.render(); };
ACTIONS['cl-del'] = el => {
  if (!clCanAdd()) return; const t = Store.get('checklist', el.dataset.id); if (!t) return;
  Store.all('checklist_log').filter(l => l.task_id === t.id).forEach(l => Store.del('checklist_log', l.id));
  Store.del('checklist', t.id); audit('checklist.delete', t.title, t.doer); renderNav(); VIEWS.checklist.render();
};
