/* Nexus 2.0 — Mock run: vendors carry the real contact details in a locked-away field while every
   mail and WhatsApp goes to one test address. When the mock run is over, one button puts the real
   details back. Nothing is ever lost: real_email / real_mobile are only written, never cleared by the
   mock, and every swap goes to the audit log with who did it and when.

   The same screen takes the vendor sheet as it is, checks it for free (GST No format and checksum,
   repeats, numbers Excel has mangled, addresses, emails) and only then spends a GST lookup on the
   rows that are worth one. Super Admin only. */
'use strict';

const VM_UI = { rows: [], busy: false, msg: '', limit: 50, only: 'all' };
const vmMockOn = () => Store.all('vendors').some(v => v.real_email || v.real_mobile);
const vmContact = () => (settings().mock_contact || { email: '', mobile: '' });

function vmSetContact(email, mobile) { const s = settings(); s.mock_contact = { email, mobile }; Store.setSettings(s); }
// the real details move into real_* the first time, so the mock can never eat them
function vmHide(v, email, mobile) {
  if (!v.real_email && v.email && norm(v.email) !== norm(email)) v.real_email = v.email;
  if (!v.real_mobile && v.mobile && String(v.mobile) !== String(mobile)) v.real_mobile = v.mobile;
  v.email = email; v.mobile = mobile; v.mock_at = nowIso(); v.mock_by = ME.name;
  Store.put('vendors', v);
}
function vmRestore(v) {
  if (v.real_email) v.email = v.real_email;
  if (v.real_mobile) v.mobile = v.real_mobile;
  delete v.real_email; delete v.real_mobile; delete v.mock_at; delete v.mock_by;
  Store.put('vendors', v);
}

/* ---------- reading the sheet as Excel hands it over ---------- */
// a cell may hold line breaks inside double quotes, so the text is walked character by character
function vmTsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* ignore */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.filter(r => r.join('').trim());
}
const VM_HEAD = [
  { k: 'name', m: /vendor.*name|^name$|party/i }, { k: 'address', m: /addr|adress/i }, { k: 'state', m: /^state/i },
  { k: 'gstin', m: /gst/i }, { k: 'email', m: /e.?mail/i }, { k: 'mobile', m: /mobile|phone|contact no/i },
  { k: 'msme', m: /msme|udyam/i }, { k: 'kyc', m: /kyc/i }
];
function vmMap(first) {
  const looksHeader = first.some(c => /gst/i.test(c)) && first.some(c => /name|addr|adress/i.test(c));
  if (!looksHeader) return null;
  const map = {};
  first.forEach((c, i) => { const h = VM_HEAD.find(x => x.m.test(String(c).trim())); if (h && map[h.k] == null) map[h.k] = i; });
  return map;
}
// Excel turns a long number into 9.19811E+11 and the digits are gone for good — that has to be said, not guessed
function vmMobile(raw) {
  const t = String(raw || '').trim();
  if (!t) return { v: '', why: '' };
  if (/e\+/i.test(t) || (/^\d\.\d+$/.test(t))) return { v: '', why: 'Mobile is broken (Excel wrote ' + t + ') — re-export that column as Text' };
  const digits = t.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (ten.length !== 10) return { v: '', why: 'Mobile is not 10 digits (' + t + ')' };
  if (!/^[6-9]/.test(ten)) return { v: '', why: 'Not a mobile number (' + t + ') — looks like a landline' };
  return { v: ten, why: '' };
}
function vmEmail(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t || t === 'na' || t === 'n/a') return { v: '', why: '' };
  return emailSyntaxError(t) ? { v: '', why: 'Email is not valid (' + t + ')' } : { v: t, why: '' };
}
const vmGstClean = raw => String(raw || '').toUpperCase().replace(/\s| /g, '').replace(/^GST[-:]?/, '');

/* ---------- the free check: nothing leaves Nexus ---------- */
function vmCheckRows() {
  const text = ($('#vmPaste') || { value: '' }).value;
  if (!text.trim()) { VM_UI.msg = 'Paste the sheet first.'; return; }
  const raw = vmTsv(text); const map = vmMap(raw[0]); const body = map ? raw.slice(1) : raw;
  const cols = map || { gstin: 0, email: 1, mobile: 2 };
  const seen = {}; const rows = [];
  body.forEach((cells, i) => {
    const get = k => cols[k] == null ? '' : String(cells[cols[k]] || '').replace(/\s+/g, ' ').trim();
    const r = { line: i + 1, name: get('name'), address: get('address'), sheet_state: get('state'), gstin: vmGstClean(get('gstin')), flags: [], state: '' };
    const em = vmEmail(get('email')); const mo = vmMobile(get('mobile'));
    r.email = em.v; r.mobile = mo.v;
    if (em.why) r.flags.push(em.why);
    if (mo.why) r.flags.push(mo.why);
    if (!r.name && !r.gstin) return;                       // a blank line
    if (!r.name) r.flags.push('No vendor name');
    if (!r.gstin) { r.status = 'no_gst'; r.flags.push('No GST No'); }
    else if (/^URP$/i.test(r.gstin)) { r.status = 'no_gst'; r.flags.push('URP — unregistered, no GST lookup'); }
    else {
      const bad = gstinError(r.gstin);
      if (bad) { r.status = 'bad_gst'; r.flags.push(bad); }
      else {
        r.state = gstState(r.gstin); r.pan = gstPan(r.gstin);
        if (r.sheet_state && norm(r.sheet_state) !== norm(r.state)) r.flags.push('Sheet says ' + r.sheet_state + ', GST No says ' + r.state);
        const first = seen[r.gstin];
        if (first) { r.status = 'dup'; r.flags.push('Same GST No as “' + first + '” higher up'); }
        else {
          seen[r.gstin] = r.name || r.gstin;
          const inDb = Store.all('vendors').find(v => norm(v.gstin) === norm(r.gstin));
          const byName = Store.all('vendors').find(v => norm(v.name) === norm(r.name));
          if (inDb) { r.status = 'exists'; r.flags.push('Already a vendor: ' + inDb.name); }
          else if (byName) { r.status = 'exists'; r.flags.push('A vendor named ' + byName.name + ' already exists'); }
          else r.status = 'ready';
        }
      }
    }
    rows.push(r);
  });
  VM_UI.rows = rows;
  const n = k => rows.filter(r => r.status === k).length;
  VM_UI.msg = rows.length + ' row(s): ' + n('ready') + ' ready · ' + n('exists') + ' already here · ' + n('dup') + ' repeated GST No · ' +
    n('bad_gst') + ' wrong GST No · ' + n('no_gst') + ' without a GST No · ' + rows.filter(r => r.flags.length).length + ' with something to look at.';
}
ACTIONS['vm-check'] = () => { if (!isSuperAdmin()) return; vmCheckRows(); audit('mock.list_check', '', VM_UI.msg); VIEWS.vendormock.render(); };
ACTIONS['vm-only'] = el => { VM_UI.only = el.dataset.v; VIEWS.vendormock.render(); };
ACTIONS['vm-csv'] = () => {
  downloadCsv('vendor-list-check-' + todayYmd() + '.csv', [['Line', 'Vendor Name', 'GST No', 'State from GST', 'State in sheet', 'PAN', 'Email', 'Mobile', 'Verdict', 'What to look at']]
    .concat(VM_UI.rows.map(r => [r.line, r.name, r.gstin, r.state, r.sheet_state, r.pan || '', r.email, r.mobile, r.status, r.flags.join(' · ')])));
};

/* ---------- the paid step: one GST lookup for each row that earned it ---------- */
ACTIONS['vm-lookup'] = async () => {
  if (!isSuperAdmin()) return;
  const ready = VM_UI.rows.filter(r => r.status === 'ready' && !r.gst_done);
  if (!ready.length) { flash('Nothing is ready for a lookup. Press “Check the list” first.', 'err'); return; }
  const take = Math.max(1, Math.min(num(VM_UI.limit) || 50, ready.length));
  reasonDialog('Look up ' + take + ' GST No(s)? Each one costs a credit. ' + (ready.length > take ? (ready.length - take) + ' will be left for later.' : ''), 'Yes, look them up', async why => {
    VM_UI.busy = true; VIEWS.vendormock.render();
    let ok = 0, fail = 0;
    for (const r of ready.slice(0, take)) {
      const { err, d } = await gstLookup(r.gstin);
      if (err) { r.gst_err = err; r.flags.push('GST service: ' + err); fail++; }
      else {
        r.gst_done = true; r.gst_name = d.name || ''; r.gst_address = d.address || ''; r.gst_status = d.status || ''; r.cancelled = !!d.cancelled;
        if (d.state) r.state = d.state;
        if (r.gst_name && r.name && norm(r.gst_name) !== norm(r.name)) r.flags.push('GST record says “' + r.gst_name + '”');
        if (r.cancelled) r.flags.push('GST No is ' + r.gst_status);
        ok++;
      }
      VM_UI.msg = 'Looked up ' + (ok + fail) + ' of ' + take + '…'; VIEWS.vendormock.render();
      await new Promise(res => setTimeout(res, 250));      // easy on the service
    }
    VM_UI.busy = false;
    VM_UI.msg = ok + ' looked up' + (fail ? ', ' + fail + ' failed' : '') + '. ' + VM_UI.rows.filter(r => r.gst_done).length + ' row(s) ready to save.';
    audit('mock.gst_lookup', '', take + ' GST No(s) · ' + ok + ' ok · ' + fail + ' failed' + (why ? ' — ' + why : ''));
    VIEWS.vendormock.render();
  });
};

ACTIONS['vm-save'] = () => {
  if (!isSuperAdmin()) return;
  const c = vmContact(); const rows = VM_UI.rows.filter(r => r.gst_done);
  if (!rows.length) { flash('Look the rows up first — nothing is verified yet.', 'err'); return; }
  if (!c.email || !c.mobile) { flash('Set the test contact first — the mock run needs somewhere to write.', 'err'); return; }
  reasonDialog('Add ' + rows.length + ' vendor(s)? Their own email and mobile go into the Real columns and ' + c.email + ' is used until the mock run is over.', 'Add them', why => {
    let n = 0;
    rows.forEach(r => {
      const doc = { id: uid(), name: r.name || r.gst_name, gst_name: r.gst_name || '', address: r.gst_address || r.address || '', gstin: r.gstin,
        pan: r.pan || gstPan(r.gstin), state: r.state || '', email: c.email, mobile: c.mobile,
        real_email: r.email || '', real_mobile: r.mobile || '', mock_at: nowIso(), mock_by: ME.name, qc_required: '' };
      if (uniq('vendors', 'name', 'Vendor')(doc)) return;
      Store.put('vendors', doc); n++;
      audit('vendors.create', doc.name, r.gstin + ' · from the vendor sheet · mock contact ' + c.email + (r.cancelled ? ' · GST ' + r.gst_status : ''));
    });
    audit('mock.list_import', '', n + ' vendor(s) added' + (why ? ' — ' + why : ''));
    VM_UI.rows = VM_UI.rows.filter(r => !r.gst_done); VM_UI.msg = n + ' vendor(s) added.';
    flash(n + ' vendor(s) added with the test contact. Their own details sit in the Real columns until the mock run is over.');
    VIEWS.vendormock.render();
  });
};

/* ---------- the screen ---------- */
VIEWS.vendormock = {
  mod: 'purchase', render() {
    if (!isSuperAdmin()) { setMain('<div class="panel empty">Only the Super Admin can open the mock run screen.</div>'); return; }
    const vens = Store.all('vendors').slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const c = vmContact(); const on = vmMockOn(); const R = VM_UI.rows;
    const n = k => R.filter(r => r.status === k).length;
    let h = '<div class="toolbar"><b>Mock run — vendor contacts</b><span class="grow"></span>' +
      '<button class="btn" data-act="vm-contact">' + (c.email || c.mobile ? 'Change the test contact' : 'Set the test contact') + '</button>' +
      '<button class="btn primary" data-act="vm-mock">Put the test contact on every vendor</button>' +
      '<button class="btn danger" data-act="vm-live" data-confirm="Put every vendor\'s real email and mobile back? Do this only after the mock run is finished.">Mock over — real contacts back</button></div>';
    h += '<div class="panel" style="margin-bottom:10px"><b>How this works.</b> A vendor\'s own email and mobile sit in the two “Real” columns and Nexus does not use them while the mock run is on. ' +
      'Every vendor mail and WhatsApp goes to the test contact instead' + (c.email || c.mobile ? ' — <b>' + esc(c.email || '') + (c.mobile ? ' · ' + esc(c.mobile) : '') + '</b>' : ' (not set yet)') + '. ' +
      'When the mock run is finished, press “Mock over” once and the real details go back in.' +
      (on ? ' <span class="st Pending">Mock run is ON for ' + Store.all('vendors').filter(v => v.real_email || v.real_mobile).length + ' vendor(s)</span>' : ' <span class="st Done">Mock run is off</span>') + '</div>';

    // 1) paste the sheet, 2) free check, 3) paid lookup, 4) save
    h += '<h2>Add vendors from your sheet</h2><div class="panel" style="margin-bottom:10px">' +
      '<div class="small muted">Copy the rows straight out of Excel, heading row and all. The headings are read by name — <b>Vendor Name · Address · State · GST No. · Email ID · Mobile No.</b> — so the column order does not matter and extra columns are ignored. ' +
      '<b>Check the list</b> costs nothing and finds wrong GST numbers, repeats and mangled phone numbers. Only then does <b>Look up on GST</b> spend a credit, and only on the rows worth one.</div>' +
      '<textarea id="vmPaste" rows="6" class="mono"></textarea>' +
      '<div class="toolbar" style="margin-top:6px"><button class="btn primary" data-act="vm-check"' + (VM_UI.busy ? ' disabled' : '') + '>1 · Check the list (free)</button>' +
      (R.length ? '<label class="small muted">Look up <input id="vmLimit" type="number" min="1" max="500" value="' + esc(VM_UI.limit) + '" style="width:70px"> at a time</label>' +
        '<button class="btn" data-act="vm-lookup"' + (VM_UI.busy ? ' disabled' : '') + '>2 · Look up on GST (' + n('ready') + ' ready)</button>' +
        '<button class="btn primary" data-act="vm-save"' + (VM_UI.busy ? ' disabled' : '') + '>3 · Save ' + R.filter(r => r.gst_done).length + ' verified vendor(s)</button>' +
        '<button class="btn" data-act="vm-csv">Export this check</button>' : '') +
      '<span class="small muted" id="vmMsg">' + esc(VM_UI.msg) + '</span></div>';
    if (R.length) {
      const tabs = [{ v: 'all', l: 'All ' + R.length }, { v: 'ready', l: 'Ready ' + n('ready') }, { v: 'flag', l: 'Look at these ' + R.filter(r => r.flags.length).length },
        { v: 'exists', l: 'Already here ' + n('exists') }, { v: 'dup', l: 'Repeated ' + n('dup') }, { v: 'bad_gst', l: 'Wrong GST No ' + n('bad_gst') }, { v: 'no_gst', l: 'No GST No ' + n('no_gst') }];
      h += '<div class="sa-tabbar" style="margin:8px 0">' + tabs.map(t => '<button type="button" class="sa-tb-b' + (VM_UI.only === t.v ? ' on' : '') + '" data-act="vm-only" data-v="' + t.v + '">' + esc(t.l) + '</button>').join('') + '</div>';
      const show = R.filter(r => VM_UI.only === 'all' || (VM_UI.only === 'flag' ? r.flags.length : r.status === VM_UI.only));
      const st = r => r.gst_done ? '<span class="st ' + (r.cancelled ? 'Late' : 'Done') + '">Verified' + (r.cancelled ? ' · ' + esc(r.gst_status) : '') + '</span>'
        : { ready: '<span class="st Pending">Ready</span>', exists: '<span class="st Waiting">Already here</span>', dup: '<span class="st Waiting">Repeated</span>', bad_gst: '<span class="st Late">Wrong GST No</span>', no_gst: '<span class="st Late">No GST No</span>' }[r.status] || '';
      h += '<div class="tbl-wrap"><table class="nopage nofilter"><tr><th class="num">#</th><th>Vendor</th><th>GST No</th><th>PAN</th><th>State</th><th>Address</th><th>Email</th><th>Mobile</th><th>Verdict</th><th>What to look at</th></tr>' +
        (show.length ? show.map(r => '<tr><td class="num muted">' + r.line + '</td><td><b>' + esc(r.name) + '</b>' + (r.gst_name && norm(r.gst_name) !== norm(r.name) ? '<div class="muted small">GST: ' + esc(r.gst_name) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + esc(r.gstin) + '</td><td class="nowrap">' + esc(r.pan || '') + '</td><td>' + esc(r.state || r.sheet_state) + '</td>' +
          '<td class="small">' + esc(r.gst_address || r.address || '') + '</td><td class="small">' + esc(r.email) + '</td><td class="nowrap">' + esc(r.mobile) + '</td>' +
          '<td class="nowrap">' + st(r) + '</td><td class="small' + (r.flags.length ? ' late-txt' : '') + '">' + esc(r.flags.join(' · ')) + '</td></tr>').join('')
          : '<tr><td colspan="10" class="empty">Nothing in this list</td></tr>') + '</table></div>';
    }
    h += '</div>';

    h += '<h2>Vendors in Nexus</h2><div class="tbl-wrap"><table><tr><th>Vendor</th><th>GST No</th><th>State</th><th>In use now — Email</th><th>In use now — Mobile</th><th>Real Email</th><th>Real Mobile</th><th>Since</th></tr>' +
      (vens.length ? vens.map(v => '<tr><td><b>' + esc(v.name) + '</b></td><td>' + esc(v.gstin || '') + '</td><td>' + esc(v.state || '') + '</td>' +
        '<td>' + esc(v.email || '') + '</td><td>' + esc(v.mobile || '') + '</td>' +
        '<td><input data-vm="real_email" data-id="' + esc(v.id) + '" value="' + esc(v.real_email || '') + '" style="min-width:190px"></td>' +
        '<td><input data-vm="real_mobile" data-id="' + esc(v.id) + '" value="' + esc(v.real_mobile || '') + '" style="width:120px"></td>' +
        '<td class="nowrap small muted">' + (v.mock_at ? fmtDT(v.mock_at) + '<br>' + esc(v.mock_by || '') : '') + '</td></tr>').join('')
        : '<tr><td colspan="8" class="empty">No vendors</td></tr>') + '</table></div>';
    const m = setMain(h);
    const lim = $('#vmLimit'); if (lim) lim.addEventListener('change', e => { VM_UI.limit = num(e.target.value) || 50; });
    m.addEventListener('change', e => {
      const k = e.target.dataset.vm; if (!k) return;
      const v = Store.get('vendors', e.target.dataset.id); if (!v) return;
      const val = e.target.value.trim(); const was = v[k] || '';
      const err = k === 'real_email' ? emailSyntaxError(val) : (val ? mobileError(String(val).replace(/\D/g, '')) : '');
      if (err) { flash(esc(err), 'err'); e.target.value = was; return; }
      v[k] = k === 'real_mobile' ? String(val).replace(/\D/g, '') : val.toLowerCase();
      Store.put('vendors', v); audit('vendors.real_contact', v.name, (k === 'real_email' ? 'Real email' : 'Real mobile') + ': ' + (was || '—') + ' → ' + (v[k] || '—'));
      flash('Saved.');
    });
  }
};

ACTIONS['vm-contact'] = () => {
  if (!isSuperAdmin()) return;
  const c = vmContact();
  formDialog('Test contact for the mock run', [
    { k: 'email', l: 'Email ID', value: c.email || '', req: true },
    { k: 'mobile', l: 'Mobile No.', value: c.mobile || '', req: true }
  ], 'Save', v => {
    const mob = String(v.mobile).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const err = emailSyntaxError(v.email) || mobileError(mob); if (err) return err;
    vmSetContact(String(v.email).trim().toLowerCase(), mob);
    audit('mock.contact', '', v.email + ' · ' + mob);
    flash('Test contact saved.'); VIEWS.vendormock.render();
    return '';
  });
};
ACTIONS['vm-mock'] = () => {
  if (!isSuperAdmin()) return;
  const c = vmContact();
  if (!c.email || !c.mobile) { flash('Set the test contact first.', 'err'); return; }
  const vens = Store.all('vendors');
  reasonDialog('Put ' + c.email + ' · ' + c.mobile + ' on all ' + vens.length + ' vendor(s)?', 'Yes, start the mock run', why => {
    let n = 0; vens.forEach(v => { if (norm(v.email) === norm(c.email) && String(v.mobile) === String(c.mobile)) return; vmHide(v, c.email, c.mobile); n++; });
    audit('mock.on', '', n + ' vendor(s) → ' + c.email + ' · ' + c.mobile + (why ? ' — ' + why : ''));
    flash('Mock run on: ' + n + ' vendor(s) now write to <b>' + esc(c.email) + '</b>. Their real details are kept in the Real columns.');
    VIEWS.vendormock.render();
  });
};
ACTIONS['vm-live'] = () => {
  if (!isSuperAdmin()) return;
  const mine = Store.all('vendors').filter(v => v.real_email || v.real_mobile);
  if (!mine.length) { flash('No vendor is on the test contact.', 'err'); return; }
  const miss = Store.all('vendors').filter(v => !v.real_email && !v.real_mobile).map(v => v.name);
  reasonDialog('Put the real email and mobile back on ' + mine.length + ' vendor(s)?', 'Yes, mock run is over', why => {
    mine.forEach(vmRestore);
    audit('mock.off', '', mine.length + ' vendor(s) back on their real contact' + (why ? ' — ' + why : ''));
    flash(mine.length + ' vendor(s) are back on their real email and mobile.' + (miss.length ? ' These ' + miss.length + ' have no real contact at all, fill them in: ' + esc(miss.slice(0, 12).join(', ')) + (miss.length > 12 ? '…' : '') : ''));
    VIEWS.vendormock.render();
  }, true);
};
