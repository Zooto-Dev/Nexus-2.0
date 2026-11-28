/* Nexus 2.0 — Feedback on any feature, from any user. One button on Home; the Super Admin reads it all on the
   Feedback screen, marks each one Noted / Done / Not now, and can take the lot out as CSV. */
'use strict';

const FB_UI = { f: 'open' };
const FB_KINDS = ['Something is wrong', 'Suggestion', 'Hard to use', 'Missing feature', 'Praise'];
function fbScreens() {
  const out = [['', '']];
  NAV.forEach(g => (g.items || [g]).forEach(i => { if (i.v && i.l) out.push([i.v, (g.menu ? g.menu + ' › ' : '') + i.l]); }));
  out.push(['general', 'General / whole system']);
  return out;
}
ACTIONS['home-feedback'] = () => {
  const cur = curView().v; const scr = fbScreens();
  formDialog('Feedback', [
    { k: 'screen', l: 'Which feature / screen', type: 'select', options: scr.map(x => x[1]), value: (scr.find(x => x[0] === cur) || [])[1] || '', req: true },
    { k: 'kind', l: 'What kind', type: 'select', options: [''].concat(FB_KINDS), req: true },
    { k: 'what', l: 'Your feedback', type: 'textarea', req: true },
    { k: 'ref', l: 'Reference No, if any (JC / PO / GRN …)' }
  ], 'Send', v => {
    const s = scr.find(x => x[1] === v.screen) || ['', v.screen];
    const f = Store.put('feedback', { id: uid(), no: nextNo('feedback', 'FB'), at: nowIso(), by: ME.name, by_id: ME.id, dept: ME.department || '', screen: s[0], screen_name: s[1], kind: v.kind, what: String(v.what || '').trim(), ref: String(v.ref || '').trim().toUpperCase(), status: 'Open', build: (document.querySelector('script[src*="core.js?v="]') || { src: '' }).src.replace(/.*v=/, '') });
    audit('feedback.create', f.no, f.screen_name + ' · ' + f.kind + ' · ' + f.what.slice(0, 120));
    flash('Thank you — feedback ' + esc(f.no) + ' sent.');
    if (curView().v === 'feedback') VIEWS.feedback.render();
  });
};
ACTIONS['fb-status'] = el => {
  if (!isSuperAdmin()) return; const f = Store.get('feedback', el.dataset.id); if (!f) return;
  f.status = el.dataset.st; f.decided_by = ME.name; f.decided_at = nowIso(); Store.put('feedback', f);
  if (curView().v === 'home') { route(); return; }
  audit('feedback.' + el.dataset.st.toLowerCase().replace(/\s+/g, '_'), f.no, f.screen_name + ' · ' + f.what.slice(0, 80)); VIEWS.feedback.render();
};
ACTIONS['fb-csv'] = () => downloadCsv('feedback-' + todayYmd() + '.csv', [['No', 'Date', 'By', 'Department', 'Screen', 'Kind', 'Feedback', 'Reference', 'Status', 'Decided by', 'Build']].concat(
  Store.all('feedback').sort((a, b) => a.at < b.at ? -1 : 1).map(f => [f.no, fmtDT(f.at), f.by, f.dept || '', f.screen_name, f.kind, f.what, f.ref || '', f.status, f.decided_by || '', f.build || ''])));
VIEWS.feedback = {
  mod: 'dashboard', render() {
    const sa = isSuperAdmin();
    let list = Store.all('feedback').filter(f => sa || f.by_id === ME.id || norm(f.by) === norm(ME.name)).sort((a, b) => a.at < b.at ? 1 : -1);
    if (FB_UI.f === 'open') list = list.filter(f => f.status === 'Open'); else if (FB_UI.f === 'done') list = list.filter(f => f.status !== 'Open');
    const byScreen = {}; list.forEach(f => { byScreen[f.screen_name] = (byScreen[f.screen_name] || 0) + 1; });
    let h = '<div class="toolbar">' + seg('fbf', [{ v: 'open', l: 'Open' }, { v: 'done', l: 'Decided' }, { v: 'all', l: 'All' }], FB_UI.f) + '<span class="grow"></span>' +
      '<button class="btn sm primary" data-act="home-feedback">+ Feedback</button>' + (sa ? '<button class="btn sm" data-act="fb-csv">CSV</button>' : '') + '</div>';
    if (sa && list.length) h += '<div class="small muted" style="margin:0 0 8px">' + Object.entries(byScreen).sort((a, b) => b[1] - a[1]).map(([k, n]) => esc(k) + ' <b>' + n + '</b>').join(' · ') + '</div>';
    h += '<div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>By</th><th>Department</th><th>Screen</th><th>Kind</th><th>Feedback</th><th>Reference</th><th>Status</th>' + (sa ? '<th></th>' : '') + '</tr>' +
      (list.length ? list.map(f => '<tr><td><b>' + esc(f.no) + '</b></td><td class="nowrap">' + fmtDT(f.at) + '</td><td>' + esc(f.by) + '</td><td>' + esc(f.dept || '') + '</td><td>' + esc(f.screen_name) + '</td><td>' + esc(f.kind) + '</td><td class="wrap">' + esc(f.what) + '</td><td>' + esc(f.ref || '') + '</td><td><span class="st ' + (f.status === 'Open' ? 'Pending' : f.status === 'Done' ? 'Done' : 'Waiting') + '">' + esc(f.status) + '</span>' + (f.decided_by ? '<div class="small muted">' + esc(f.decided_by) + '</div>' : '') + '</td>' +
        (sa ? '<td class="nowrap">' + (f.status === 'Open' ? '<button class="btn sm" data-act="fb-status" data-st="Noted" data-id="' + esc(f.id) + '">Noted</button> <button class="btn sm primary" data-act="fb-status" data-st="Done" data-id="' + esc(f.id) + '">Done</button> <button class="btn sm" data-act="fb-status" data-st="Not now" data-id="' + esc(f.id) + '">Not now</button>' : '<button class="btn sm" data-act="fb-status" data-st="Open" data-id="' + esc(f.id) + '">Reopen</button>') + '</td>' : '') + '</tr>').join('')
        : '<tr><td colspan="' + (sa ? 10 : 9) + '" class="empty">' + (FB_UI.f === 'open' ? 'No open feedback' : 'No feedback') + '</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { if (e.target.dataset.seg === 'fbf') { FB_UI.f = e.detail; VIEWS.feedback.render(); } });
  }
};

// Home: the person's feedback beside My requests (the Super Admin sees everyone's open feedback and decides it here)
function feedbackCard(names) {
  const sa = isSuperAdmin();
  const mine = Store.all('feedback').filter(f => sa ? f.status === 'Open' : (f.by_id === ME.id || (names && names.has(f.by)) || norm(f.by) === norm(ME.name))).sort((a, b) => a.at < b.at ? 1 : -1);
  const cls = { Open: 'Pending', Noted: 'Waiting', Done: 'Done', 'Not now': 'Cancelled' };
  const head = '<div class="dh3 sa-h"><span class="sa-hi ' + (mine.some(f => f.status === 'Open') ? 'warn' : 'ok') + '">' + saIco('file') + '</span><b>' + (sa ? 'Feedback from everyone' : 'My feedback') + '</b>' + (mine.length ? '<span class="n">' + mine.length + '</span>' : '') + '<span class="grow"></span><button class="btn sm primary" data-act="home-feedback">+ Feedback</button> <a class="sa-open" href="#/feedback">All ›</a></div>';
  if (!mine.length) return '<div class="sa-lbl">Feedback</div><div class="dcard sa-ok">' + head + '<div class="sa-clear">' + (sa ? 'No open feedback' : 'You have not sent any feedback yet') + '</div></div>';
  return '<div class="sa-lbl">Feedback</div><div class="dcard">' + head +
    '<div class="tbl-wrap"><table data-pg="home_feedback"><tr><th>No</th><th>Date</th>' + (sa ? '<th>By</th>' : '') + '<th>Screen</th><th>Kind</th><th>Feedback</th><th>Reference</th><th>Status</th>' + (sa ? '<th></th>' : '') + '</tr>' +
    mine.slice(0, 30).map(f => '<tr><td><b>' + esc(f.no) + '</b></td><td class="nowrap">' + fmtDT(f.at) + '</td>' + (sa ? '<td>' + esc(f.by) + '</td>' : '') + '<td>' + esc(f.screen_name || '') + '</td><td>' + esc(f.kind || '') + '</td><td class="wrap">' + esc(f.what || '') + '</td><td>' + esc(f.ref || '') + '</td><td><span class="st ' + (cls[f.status] || 'Waiting') + '">' + esc(f.status) + '</span>' + (f.decided_by ? '<div class="small muted">' + esc(f.decided_by) + '</div>' : '') + '</td>' +
      (sa ? '<td class="nowrap"><button class="btn sm" data-act="fb-status" data-st="Noted" data-id="' + esc(f.id) + '">Noted</button> <button class="btn sm primary" data-act="fb-status" data-st="Done" data-id="' + esc(f.id) + '">Done</button> <button class="btn sm" data-act="fb-status" data-st="Not now" data-id="' + esc(f.id) + '">Not now</button></td>' : '') + '</tr>').join('') + '</table></div></div>';
}
