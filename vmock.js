/* Nexus 2.0 — Mock run: vendors carry the real contact details in a locked-away field while every
   mail and WhatsApp goes to one test address. When the mock run is over, one button puts the real
   details back. Nothing is ever lost: real_email / real_mobile are only written, never cleared by the
   mock, and every swap goes to the audit log with who did it and when. Super Admin only. */
'use strict';

const VM_UI = { rows: [], busy: false, msg: '' };
const vmMockOn = () => Store.all('vendors').some(v => v.real_email || v.real_mobile);
const vmContact = () => (settings().mock_contact || { email: '', mobile: '' });

function vmSetContact(email, mobile) {
  const s = settings(); s.mock_contact = { email, mobile }; Store.setSettings(s);
}
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

VIEWS.vendormock = {
  mod: 'purchase', render() {
    if (!isSuperAdmin()) { setMain('<div class="panel empty">Only the Super Admin can open the mock run screen.</div>'); return; }
    const vens = Store.all('vendors').slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const c = vmContact(); const on = vmMockOn();
    let h = '<div class="toolbar"><b>Mock run — vendor contacts</b><span class="grow"></span>' +
      '<button class="btn" data-act="vm-contact">' + (c.email || c.mobile ? 'Change the test contact' : 'Set the test contact') + '</button>' +
      '<button class="btn primary" data-act="vm-mock">Put the test contact on every vendor</button>' +
      '<button class="btn danger" data-act="vm-live" data-confirm="Put every vendor\'s real email and mobile back? Do this only after the mock run is finished.">Mock over — real contacts back</button></div>';
    h += '<div class="panel" style="margin-bottom:10px"><b>How this works.</b> The real email and mobile sit in the two “Real” columns and are never used by Nexus while the mock run is on. ' +
      'Every vendor mail and WhatsApp goes to the test contact instead' + (c.email || c.mobile ? ' — <b>' + esc(c.email || '') + (c.mobile ? ' · ' + esc(c.mobile) : '') + '</b>' : ' (not set yet)') + '. ' +
      'When the mock run is finished, press “Mock over” once and the real details go back in.' +
      (on ? ' <span class="st Pending">Mock run is ON for ' + Store.all('vendors').filter(v => v.real_email || v.real_mobile).length + ' vendor(s)</span>' : ' <span class="st Done">Mock run is off — vendors carry their real contacts</span>') + '</div>';

    // add vendors from a pasted list: GST No, real email, real mobile
    h += '<h2>Add vendors from a list</h2><div class="panel" style="margin-bottom:10px">' +
      '<div class="small muted">One vendor per line, tab or | separated, in this order: <b>GST No · Real Email · Real Mobile</b> (email and mobile may be left out). ' +
      'The name, address and state come from the GST record itself. Press Check first — nothing is saved until you press Save.</div>' +
      '<textarea id="vmPaste" rows="6" class="mono" placeholder="07AABCG8086G1ZF\taccounts@abc.com\t9876543210"></textarea>' +
      '<div class="toolbar" style="margin-top:6px"><button class="btn" data-act="vm-check"' + (VM_UI.busy ? ' disabled' : '') + '>Check against GST</button>' +
      (VM_UI.rows.length ? '<button class="btn primary" data-act="vm-save">Save ' + VM_UI.rows.filter(r => r.ok).length + ' vendor(s)</button>' : '') +
      '<span class="small' + (/not|error|wrong|already/i.test(VM_UI.msg) ? ' late-txt' : ' muted') + '" id="vmMsg">' + VM_UI.msg + '</span></div>';
    if (VM_UI.rows.length) h += '<div class="tbl-wrap"><table class="nopage nofilter"><tr><th>GST No</th><th>Name from GST</th><th>Address</th><th>State</th><th>Status</th><th>Real Email</th><th>Real Mobile</th><th>Will be</th></tr>' +
      VM_UI.rows.map(r => '<tr><td><b>' + esc(r.gstin) + '</b></td><td>' + esc(r.name || '') + '</td><td class="small">' + esc(r.address || '') + '</td><td>' + esc(r.state || '') + '</td>' +
        '<td>' + (r.cancelled ? '<span class="st Late">' + esc(r.status) + '</span>' : esc(r.status || '')) + '</td><td>' + esc(r.real_email || '') + '</td><td>' + esc(r.real_mobile || '') + '</td>' +
        '<td>' + (r.ok ? '<span class="st Done">Added</span>' : '<span class="st Late">' + esc(r.why) + '</span>') + '</td></tr>').join('') + '</table></div>';
    h += '</div>';

    h += '<h2>Vendors</h2><div class="tbl-wrap"><table><tr><th>Vendor</th><th>GST No</th><th>State</th><th>In use now — Email</th><th>In use now — Mobile</th><th>Real Email</th><th>Real Mobile</th><th>Since</th></tr>' +
      (vens.length ? vens.map(v => '<tr><td><b>' + esc(v.name) + '</b></td><td>' + esc(v.gstin || '') + '</td><td>' + esc(v.state || '') + '</td>' +
        '<td>' + esc(v.email || '') + '</td><td>' + esc(v.mobile || '') + '</td>' +
        '<td><input data-vm="real_email" data-id="' + esc(v.id) + '" value="' + esc(v.real_email || '') + '" style="min-width:190px"></td>' +
        '<td><input data-vm="real_mobile" data-id="' + esc(v.id) + '" value="' + esc(v.real_mobile || '') + '" style="width:120px"></td>' +
        '<td class="nowrap small muted">' + (v.mock_at ? fmtDT(v.mock_at) + '<br>' + esc(v.mock_by || '') : '') + '</td></tr>').join('')
        : '<tr><td colspan="8" class="empty">No vendors</td></tr>') + '</table></div>';
    const m = setMain(h);
    m.addEventListener('change', e => {
      const k = e.target.dataset.vm; if (!k) return;
      const v = Store.get('vendors', e.target.dataset.id); if (!v) return;
      const val = e.target.value.trim(); const was = v[k] || '';
      const err = k === 'real_email' ? emailSyntaxError(val) : mobileError(String(val).replace(/\D/g, ''));
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
    flash('Test contact saved. Now press “Put the test contact on every vendor”.'); VIEWS.vendormock.render();
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
  const miss = mine.filter(v => !v.real_email || !v.real_mobile).map(v => v.name);
  reasonDialog('Put the real email and mobile back on ' + mine.length + ' vendor(s)?' + (miss.length ? ' ' + miss.length + ' of them have only one of the two filled in.' : ''), 'Yes, mock run is over', why => {
    mine.forEach(vmRestore);
    audit('mock.off', '', mine.length + ' vendor(s) back on their real contact' + (why ? ' — ' + why : ''));
    flash(mine.length + ' vendor(s) are back on their real email and mobile.' + (miss.length ? ' Check these, one field was blank: ' + esc(miss.join(', ')) : ''));
    VIEWS.vendormock.render();
  }, true);
};

// paste a list of GST numbers, look each one up, show what would be added
ACTIONS['vm-check'] = async () => {
  if (!isSuperAdmin()) return;
  const lines = ($('#vmPaste') || { value: '' }).value.split(/\r?\n/).map(l => l.split(/\t|\s*\|\s*/).map(x => x.trim())).filter(r => r.join('').trim());
  if (!lines.length) { VM_UI.msg = 'Paste the list first.'; VIEWS.vendormock.render(); return; }
  VM_UI.busy = true; VM_UI.rows = []; VM_UI.msg = 'Checking ' + lines.length + ' GST No(s)…'; VIEWS.vendormock.render();
  const seen = new Set();
  for (const cells of lines) {
    const gstin = String(cells[0] || '').toUpperCase().replace(/\s/g, '');
    const row = { gstin, real_email: (cells[1] || '').toLowerCase(), real_mobile: String(cells[2] || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''), ok: false, why: '' };
    const bad = gstinError(gstin);
    if (bad) row.why = bad;
    else if (seen.has(gstin)) row.why = 'Same GST No twice in the list';
    else if (Store.all('vendors').some(x => norm(x.gstin) === norm(gstin))) row.why = 'Already a vendor';
    else if (row.real_email && emailSyntaxError(row.real_email)) row.why = 'Email is not valid';
    else if (row.real_mobile && mobileError(row.real_mobile)) row.why = 'Mobile is not valid';
    if (!row.why) {
      seen.add(gstin);
      const { err, d } = await gstLookup(gstin);
      if (err) row.why = err;
      else {
        Object.assign(row, { name: d.name, address: d.address, state: d.state, status: d.status, cancelled: d.cancelled, pan: d.pan });
        if (!row.name) row.why = 'GST record has no name';
        else if (Store.all('vendors').some(x => norm(x.name) === norm(row.name))) row.why = 'A vendor with the name ' + row.name + ' already exists';
        else row.ok = true;
      }
    }
    VM_UI.rows.push(row); VM_UI.msg = 'Checked ' + VM_UI.rows.length + ' of ' + lines.length + '…'; VIEWS.vendormock.render();
  }
  VM_UI.busy = false;
  const good = VM_UI.rows.filter(r => r.ok).length;
  VM_UI.msg = good + ' of ' + lines.length + ' ready to save' + (good < lines.length ? ' — read the last column for the rest.' : '.');
  audit('mock.gst_check', '', lines.length + ' GST No(s) looked up, ' + good + ' ready');
  VIEWS.vendormock.render();
};
ACTIONS['vm-save'] = () => {
  if (!isSuperAdmin()) return;
  const c = vmContact(); const rows = VM_UI.rows.filter(r => r.ok);
  if (!rows.length) { flash('Nothing to save.', 'err'); return; }
  if (!c.email || !c.mobile) { flash('Set the test contact first — the mock run needs somewhere to write.', 'err'); return; }
  let n = 0;
  rows.forEach(r => {
    const doc = { id: uid(), name: r.name, address: r.address || '', gstin: r.gstin, pan: r.pan || gstPan(r.gstin), state: r.state || '',
      email: c.email, mobile: c.mobile, real_email: r.real_email || '', real_mobile: r.real_mobile || '', mock_at: nowIso(), mock_by: ME.name, qc_required: '' };
    if (uniq('vendors', 'name', 'Vendor')(doc)) return;
    Store.put('vendors', doc); n++;
    audit('vendors.create', doc.name, r.gstin + ' · from the GST list · mock contact ' + c.email + (r.cancelled ? ' · GST ' + r.status : ''));
  });
  VM_UI.rows = []; VM_UI.msg = n + ' vendor(s) added.'; $('#vmPaste') && ($('#vmPaste').value = '');
  flash(n + ' vendor(s) added with the test contact. Their real details sit in the Real columns until the mock run is over.');
  VIEWS.vendormock.render();
};
