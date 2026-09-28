/* Nexus 2.0 — masters & admin: Customers, Items, Users, Roles, Settings, Audit. */
'use strict';

/* ---------- generic inline-edit master table ---------- */
const MT_UI = {};
function masterView(cfg) {
  const ui = MT_UI[cfg.col] || (MT_UI[cfg.col] = { q: '', paste: false });
  const edit = can(cfg.mod, 'edit'); const q = norm(ui.q);
  const rows = Store.all(cfg.col).filter(d => !q || norm(cfg.cols.map(c => d[c.k]).join(' ')).includes(q)).sort((a, b) => String(a[cfg.sort] || '').localeCompare(String(b[cfg.sort] || '')));
  const cell = (c, d) => {
    const v = d ? d[c.k] : (cfg.defaults || {})[c.k];
    if (!edit || (d && c.lock)) return '<td>' + esc(c.fmt ? c.fmt(v) : v) + '</td>';
    if (c.opts) return '<td><select data-c="' + c.k + '">' + c.opts().map(o => '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select></td>';
    if (c.type === 'check') return '<td><input type="checkbox" data-c="' + c.k + '"' + (v !== false ? ' checked' : '') + '></td>';
    return '<td><input data-c="' + c.k + '" value="' + esc(v) + '"' + (c.type === 'number' ? ' type="number" step="any" class="right"' : '') + (c.w ? ' style="width:' + c.w + 'px"' : '') + (!d && c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + '></td>';
  };
  let h = '<div class="toolbar"><input id="mtQ" placeholder="Search…" value="' + esc(ui.q) + '"><span class="muted small">' + rows.length + ' record(s)' + (edit ? ' · edits save automatically' : '') + '</span><span class="grow"></span>' +
    (edit && cfg.paste ? '<button class="btn" data-act="mt-paste-toggle" data-col="' + cfg.col + '">Paste from Excel</button>' : '') + '<button class="btn" data-act="mt-csv" data-col="' + cfg.col + '">Export CSV</button></div>';
  if (edit && cfg.paste && ui.paste) h += '<div class="panel" style="margin-bottom:10px"><div class="small muted">Copy rows from Excel with columns: <b>' + cfg.cols.filter(c => !c.noPaste).map(c => c.l).join(' · ') + '</b>. Existing ' + esc(cfg.cols[0].l) + ' = update, new = add.</div><textarea id="mtPaste" rows="6" class="mono"></textarea><div class="toolbar" style="margin-top:6px"><button class="btn primary" data-act="mt-paste" data-col="' + cfg.col + '">Import</button></div></div>';
  h += '<div class="tbl-wrap"><table><tr>' + cfg.cols.map(c => '<th' + (c.type === 'number' ? ' class="num"' : '') + '>' + esc(c.l) + '</th>').join('') + '<th></th></tr>';
  if (edit) h += '<tr data-new="1" style="background:#fafbfc">' + cfg.cols.map(c => cell(c, null)).join('') + '<td><button class="btn sm primary" data-act="mt-add" data-col="' + cfg.col + '">Add</button></td></tr>';
  h += rows.map(d => '<tr data-id="' + esc(d.id) + '">' + cfg.cols.map(c => cell(c, d)).join('') + '<td class="right nowrap">' + (cfg.extra ? cfg.extra(d) : '') + (edit && (!cfg.canDelete || cfg.canDelete(d) === true) ? '<button class="btn ghost sm danger" data-act="mt-del" data-col="' + cfg.col + '" data-id="' + esc(d.id) + '" data-confirm="Delete?">×</button>' : '') + '</td></tr>').join('');
  h += (rows.length ? '' : '<tr><td colspan="' + (cfg.cols.length + 1) + '" class="empty">No records</td></tr>') + '</table></div>';
  const m = setMain(h); MT_CFG[cfg.col] = cfg;
  $('#mtQ').addEventListener('input', e => { ui.q = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { cfg.view.render(); const i = $('#mtQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  m.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.dataset.c) return;
    const d = Store.get(cfg.col, tr.dataset.id); const k = e.target.dataset.c; const c = cfg.cols.find(x => x.k === k);
    let v = c.type === 'check' ? e.target.checked : c.type === 'number' ? num(e.target.value) : e.target.value.trim();
    if (c.upper) v = String(v).toUpperCase();
    const err = cfg.validate && cfg.validate(Object.assign({}, d, { [k]: v }), d);
    if (err) { flash(esc(err), 'err'); e.target.value = d[k] == null ? '' : d[k]; return; }
    const old = d[k]; d[k] = v; Store.put(cfg.col, d); if (cfg.after) cfg.after(d, k, old);
    audit(cfg.col + '.edit', d[cfg.cols[0].k], c.l + ': ' + (c.secret ? '•••' : (old == null ? '' : old) + ' → ' + v));
    flash('Saved.');
  });
}
const MT_CFG = {};
ACTIONS['mt-add'] = el => {
  const cfg = MT_CFG[el.dataset.col]; if (!requirePerm(cfg.mod, 'edit')) return; const tr = el.closest('tr');
  const d = Object.assign({ id: uid() }, cfg.defaults || {});
  cfg.cols.forEach(c => { const i = $('[data-c="' + c.k + '"]', tr); if (!i) return; let v = c.type === 'check' ? i.checked : c.type === 'number' ? num(i.value) : i.value.trim(); if (c.upper) v = String(v).toUpperCase(); d[c.k] = v; });
  const err = cfg.validate && cfg.validate(d, null); if (err) { flash(esc(err), 'err'); return; }
  if (cfg.beforeAdd) cfg.beforeAdd(d);
  Store.put(cfg.col, d); audit(cfg.col + '.create', d[cfg.cols[0].k], d[cfg.cols[1].k] || ''); flash('Added.'); cfg.view.render();
  const f = $('tr[data-new] input'); if (f) f.focus();
};
ACTIONS['mt-del'] = el => {
  const cfg = MT_CFG[el.dataset.col]; const d = Store.get(cfg.col, el.dataset.id);
  const why = cfg.inUse && cfg.inUse(d); if (why) { flash(esc(why), 'err'); return; }
  Store.del(cfg.col, d.id); audit(cfg.col + '.delete', d[cfg.cols[0].k], d[cfg.cols[1].k] || ''); cfg.view.render();
};
ACTIONS['mt-paste-toggle'] = el => { const ui = MT_UI[el.dataset.col]; ui.paste = !ui.paste; MT_CFG[el.dataset.col].view.render(); };
ACTIONS['mt-paste'] = el => {
  const cfg = MT_CFG[el.dataset.col]; const cols = cfg.cols.filter(c => !c.noPaste); let add = 0, upd = 0, bad = 0;
  $('#mtPaste').value.split(/\r?\n/).map(l => l.split('\t')).filter(r => r.join('').trim()).forEach(r => {
    const d0 = {}; cols.forEach((c, i) => { let v = (r[i] || '').replace(/\u00a0/g, ' ').trim(); if (c.type === 'number') v = num(v.replace(/,/g, '')); if (c.upper) v = String(v).toUpperCase(); d0[c.k] = v; });
    const key = cols[0].k; const ex = Store.all(cfg.col).find(x => norm(x[key]) === norm(d0[key]));
    const d = Object.assign(ex ? ex : Object.assign({ id: uid() }, cfg.defaults || {}), d0);
    if (!d[key] || (cfg.validate && cfg.validate(d, ex))) { bad++; return; }
    Store.put(cfg.col, d); ex ? upd++ : add++;
  });
  audit(cfg.col + '.import', '', add + ' added, ' + upd + ' updated'); MT_UI[cfg.col].paste = false;
  flash(add + ' added, ' + upd + ' updated' + (bad ? ', ' + bad + ' skipped (missing / invalid)' : '') + '.', bad ? 'err' : ''); cfg.view.render();
};
ACTIONS['mt-csv'] = el => { const cfg = MT_CFG[el.dataset.col]; downloadCsv(cfg.col + '-' + todayYmd() + '.csv', [cfg.cols.filter(c => !c.secret).map(c => c.l)].concat(Store.all(cfg.col).map(d => cfg.cols.filter(c => !c.secret).map(c => c.fmt ? c.fmt(d[c.k]) : d[c.k])))); };
function uniq(col, key, label) { return (d, old) => { if (!String(d[key] || '').trim()) return label + ' is required.'; if (Store.all(col).some(x => x.id !== d.id && norm(x[key]) === norm(d[key]))) return label + ' "' + d[key] + '" already exists.'; return ''; }; }

const CDB_UI = { edit: null };
VIEWS.customers = {
  mod: 'masters', render() {
    const edit = can('masters', 'edit');
    const ed = CDB_UI.edit ? Store.get('customers', CDB_UI.edit) : null;
    let h = subTitle('CDB', 'Customer / Brand Database');
    if (edit) {
      h += '<div class="card"><div class="card-h"><b>' + (ed ? 'Edit Brand — ' + esc(ed.name) : 'Add Brand') + '</b>' + (ed ? '<span class="grow"></span><a data-act="cdb-cancel">Cancel edit</a>' : '') + '</div><div class="card-b">' +
        '<div class="row">' +
        '<label>Brand Name *<input id="cdbName" value="' + esc(ed ? ed.name : '') + '"></label>' +
        '<label>Contact Person<input id="cdbPerson" value="' + esc(ed ? ed.contact_person || '' : '') + '"></label>' +
        '<label>Merchandiser<input id="cdbMerch" list="dlDoersC" value="' + esc(ed ? ed.merchandiser || '' : '') + '"><datalist id="dlDoersC">' + Array.from(new Set(Store.all('users').map(u => u.doer).filter(Boolean))).map(d => '<option>' + esc(d) + '</option>').join('') + '</datalist></label>' +
        '<label>Phone<input id="cdbPhone" value="' + esc(ed ? ed.phone || '' : '') + '"></label>' +
        '<button class="btn primary" data-act="cdb-save">' + (ed ? 'Update' : 'Add Brand') + '</button></div>' +
        '<div id="cdbMsg" class="small" style="margin-top:6px"></div></div></div>';
    }
    const rows = Store.all('customers').slice().sort((x, y) => String(x.name).localeCompare(String(y.name)));
    h += '<div class="tbl-wrap"><table><tr><th>Customer ID</th><th>Brand Name</th><th>Contact Person</th><th>Merchandiser</th><th>Phone</th><th class="num">Orders</th>' + (edit ? '<th></th>' : '') + '</tr>' +
      (rows.length ? rows.map(c => {
        const oc = Store.all('orders').filter(o => o.customer_id === c.id).length;
        return '<tr' + (CDB_UI.edit === c.id ? ' style="background:var(--accent-bg)"' : '') + '><td class="mono">' + esc(c.code || '') + '</td><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.contact_person || '') + '</td><td>' + esc(c.merchandiser || '') + '</td><td>' + esc(c.phone || '') + '</td><td class="num">' + (oc || '—') + '</td>' +
          (edit ? '<td class="right nowrap"><button class="btn sm" data-act="cdb-edit" data-id="' + esc(c.id) + '">Edit</button> ' + (oc ? '' : '<button class="btn sm ghost danger" data-act="cdb-del" data-id="' + esc(c.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="7" class="empty">No brands yet — add one above</td></tr>') + '</table></div>';
    setMain(h);
    if (edit && !ed) { const n = $('#cdbName'); if (n && !rows.length) n.focus(); }
  }
};
ACTIONS['cdb-edit'] = el => { CDB_UI.edit = el.dataset.id; VIEWS.customers.render(); $('#cdbName').focus(); };
ACTIONS['cdb-cancel'] = () => { CDB_UI.edit = null; VIEWS.customers.render(); };
ACTIONS['cdb-save'] = () => {
  if (!requirePerm('masters', 'edit')) return;
  const name = $('#cdbName').value.trim();
  if (!name) { $('#cdbMsg').innerHTML = '<span class="late-txt">Brand Name is required.</span>'; return; }
  if (Store.all('customers').some(c => c.id !== CDB_UI.edit && norm(c.name) === norm(name))) { $('#cdbMsg').innerHTML = '<span class="late-txt">This brand already exists.</span>'; return; }
  const d = CDB_UI.edit ? Store.get('customers', CDB_UI.edit) : { id: uid(), code: 'B' + String(Store.all('customers').length + 1).padStart(3, '0') };
  const oldName = d.name;
  d.name = name; d.contact_person = $('#cdbPerson').value.trim(); d.merchandiser = $('#cdbMerch').value.trim().toUpperCase(); d.phone = $('#cdbPhone').value.trim();
  Store.put('customers', d);
  if (CDB_UI.edit && oldName && norm(oldName) !== norm(name)) {
    Store.all('orders').filter(o => o.customer_id === d.id).forEach(o => { o.customer_name = name; o.brand = name; Store.put('orders', o); });
  }
  audit(CDB_UI.edit ? 'cdb.edit' : 'cdb.create', name, (d.contact_person || '') + (d.merchandiser ? ' · ' + d.merchandiser : ''));
  flash((CDB_UI.edit ? 'Updated' : 'Added') + ': <b>' + esc(name) + '</b>'); CDB_UI.edit = null; VIEWS.customers.render();
};
ACTIONS['cdb-del'] = el => {
  const c = Store.get('customers', el.dataset.id);
  if (Store.all('orders').some(o => o.customer_id === c.id)) { flash('Brand has orders — cannot delete.', 'err'); return; }
  Store.del('customers', c.id); audit('cdb.delete', c.name, ''); VIEWS.customers.render();
};
VIEWS.items = {
  mod: 'masters', render() {
    masterView({
      col: 'items', mod: 'masters', title: 'Articles', view: VIEWS.items, sort: 'code', paste: true,
      cols: [{ k: 'code', l: 'Article', w: 110, upper: true, ph: 'ZT-601' }, { k: 'name', l: 'Style name', ph: 'Style name' },
        { k: 'group', l: 'Category', opts: () => (fieldOptions('category').length ? fieldOptions('category') : ['Shoes', 'Slider', 'Clogs', 'V Shape', 'Eva Slider']).map(v => ({ v, l: v })) },
        { k: 'gender', l: 'Gender', opts: () => [''].concat(GENDERS_()).map(v => ({ v, l: v || '—' })) }],
      validate: (d, old) => uniq('items', 'code', 'Article')(d),
      inUse: d => Store.all('orders').some(o => (o.lines || []).some(l => norm(l.article) === norm(d.code))) ? 'Article is used in orders — cannot delete.' : ''
    });
  }
};

/* ---------- users ---------- */
const US_UI = { q: '' };
const roleName = id => (Store.get('roles', id) || {}).name || '';
const officialDomain = () => (settings().official_domain || 'zootofashion.com').toLowerCase();
const deptList = () => orgList().map(o => o.dept);
const desigList = dept => ((orgList().find(o => o.dept === dept) || {}).desigs || []);
VIEWS.users = {
  mod: 'users', render() {
    const edit = can('users', 'edit'); const q = norm(US_UI.q);
    const rows = Store.all('users').filter(u => !q || norm([u.name, u.email, u.department, u.designation, u.mobile, roleName(u.role_id)].join(' ')).includes(q)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const pw = u => { const p = usPwd(u); if (!p) return '<span class="muted">—</span>'; return '<span class="mono" data-pw="' + esc(u.id) + '">••••••</span> <button class="btn ghost sm" data-act="us-eye" data-id="' + esc(u.id) + '" title="Show / hide">👁</button>'; };
    let h = '<div class="toolbar"><input id="usQ" placeholder="Search…" value="' + esc(US_UI.q) + '"><span class="muted small">' + rows.length + ' user(s)</span><span class="grow"></span>' +
      (edit && CLOUD ? '<button class="btn" data-act="us-sync">Create logins</button>' : '') + (edit ? '<button class="btn primary" data-act="us-new">+ New user</button>' : '') + '</div>';
    h += '<div class="tbl-wrap"><table class="bomflat"><tr><th>Name</th><th>Email (login)</th><th>Department</th><th>Designation</th><th>Role</th><th>Password</th><th>Mobile</th><th>Status</th><th></th></tr>' +
      (rows.length ? rows.map(u => '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email || '') + '</td><td>' + esc(u.department || '') + '</td><td>' + esc(u.designation || '') + '</td><td>' + esc(roleName(u.role_id)) + '</td><td class="nowrap">' + pw(u) + '</td><td>' + esc(u.mobile || '') + '</td><td>' + (u.active === false ? '<span class="muted">Inactive</span>' : 'Active') + '</td><td class="right">' +
        (edit && usCanTouch(u) ? '<button class="btn sm ghost" data-act="us-edit" data-id="' + esc(u.id) + '">Edit</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No users</td></tr>') + '</table></div>';
    setMain(h);
    $('#usQ').addEventListener('input', e => { US_UI.q = e.target.value; clearTimeout(US_UI.t); US_UI.t = setTimeout(() => { VIEWS.users.render(); const i = $('#usQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
    if (CLOUD && !US_UI.loaded) usLoadSecrets();
  }
};
// Passwords are readable only by a Super Admin (cloud: nx_secrets, locked by row security).
const US_SECRETS = {};
function usPwd(u) { return CLOUD ? US_SECRETS[norm(u.email || '')] : (u.pwd || u.pin_seed); }
async function usLoadSecrets() {
  US_UI.loaded = true; if (!isSuperAdmin()) return;
  const { data } = await SB.from('nx_secrets').select('email,password');
  (data || []).forEach(r => { US_SECRETS[norm(r.email)] = r.password; });
  if (curView().v === 'users') VIEWS.users.render();
}
ACTIONS['us-eye'] = el => { const s = $('[data-pw="' + el.dataset.id + '"]'); const u = Store.get('users', el.dataset.id); if (!s || !u || !isSuperAdmin()) return; s.textContent = s.textContent === '••••••' ? (usPwd(u) || '') : '••••••'; };
ACTIONS['us-sync'] = async el => {
  if (!isSuperAdmin()) return; el.disabled = true;
  try { const r = await usCloud({ action: 'sync' }); US_UI.loaded = false; flash(r.created + ' login(s) created.' + (r.skipped.length ? ' No email/mobile: ' + esc(r.skipped.join(', ')) + '.' : '') + (r.failed.length ? ' Failed: ' + esc(r.failed.join('; ')) : ''), r.failed.length ? 'err' : ''); VIEWS.users.render(); }
  catch (e) { flash(esc(e.message), 'err'); el.disabled = false; }
};
// An Admin cannot touch a Super Admin account; nobody changes their own role here.
function usCanTouch(u) { const r = Store.get('roles', u.role_id); return isSuperAdmin() || !(r && r.system); }
function usRoleOpts(cur) { return Store.all('roles').filter(r => isSuperAdmin() || !r.system).sort((a, b) => (b.system ? 2 : b.admin ? 1 : 0) - (a.system ? 2 : a.admin ? 1 : 0)).map(r => '<option value="' + esc(r.id) + '"' + (r.id === cur ? ' selected' : '') + '>' + esc(r.name) + '</option>').join(''); }
async function usCloud(body) {
  const { data, error } = await SB.functions.invoke('nx-users', { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) { } throw new Error(m); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const cloudRole = id => { const r = Store.get('roles', id) || {}; return r.system ? 'superadmin' : r.admin ? 'admin' : 'user'; };
function usDialog(u) {
  const old = $('#usDlg'); if (old) old.remove();
  const isNew = !u; u = u || { role_id: 'r_user', active: true };
  const self = !isNew && ME && u.id === ME.id;
  const d = document.createElement('div'); d.id = 'usDlg'; d.className = 'dlg-back';
  const dept = u.department || '';
  d.innerHTML = '<div class="dlg"><div class="dlg-h">' + (isNew ? 'New user' : esc(u.name)) + '</div><table class="jckv">' +
    '<tr><td class="k">Name *</td><td class="v"><input data-us="name" value="' + esc(u.name || '') + '"></td></tr>' +
    '<tr><td class="k">Email (login)</td><td class="v"><input data-us="email" type="email" value="' + esc(u.email || '') + '"' + (isNew || !u.email ? '' : ' disabled') + '></td></tr>' +
    '<tr><td class="k">Department *</td><td class="v"><select data-us="department">' + selOpts(deptList(), dept) + '</select></td></tr>' +
    '<tr><td class="k">Designation *</td><td class="v"><select data-us="designation">' + selOpts(desigList(dept), u.designation) + '</select></td></tr>' +
    '<tr><td class="k">Role *</td><td class="v"><select data-us="role_id"' + (self ? ' disabled' : '') + '>' + usRoleOpts(u.role_id) + '</select></td></tr>' +
    '<tr><td class="k">Password</td><td class="v"><input data-us="pin" type="text" autocomplete="off"></td></tr>' +
    '<tr><td class="k">Mobile *</td><td class="v"><input data-us="mobile" inputmode="numeric" maxlength="10" value="' + esc(u.mobile || '') + '"></td></tr>' +
    '<tr><td class="k">Status</td><td class="v"><select data-us="active"' + (self ? ' disabled' : '') + '><option value="1">Active</option><option value="0"' + (u.active === false ? ' selected' : '') + '>Inactive</option></select></td></tr>' +
    '</table><div class="dlg-f"><span id="usMsg" class="small late-txt"></span><span class="grow"></span><button class="btn" data-us-cancel>Cancel</button><button class="btn primary" data-us-save>Save</button></div></div>';
  document.body.appendChild(d);
  $('[data-us="name"]', d).focus();
  const g = k => $('[data-us="' + k + '"]', d);
  g('department').addEventListener('change', () => { g('designation').innerHTML = selOpts(desigList(g('department').value), ''); });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') d.remove(); });
  d.addEventListener('click', async ev => {
    if (ev.target.closest('[data-us-cancel]')) { d.remove(); return; }
    const btn = ev.target.closest('[data-us-save]'); if (!btn) return;
    if (!requirePerm('users', 'edit')) return;
    const v = { name: g('name').value.trim(), email: norm(g('email').value), pin: g('pin').value.trim(), role_id: g('role_id').value, department: g('department').value, designation: g('designation').value, mobile: g('mobile').value.trim(), active: g('active').value === '1' };
    const hadLogin = !isNew && !!u.email && (!CLOUD || !!US_SECRETS[norm(u.email)] || !!Store.all('users').find(x => x.id === u.id && x.role_id === 'r_admin'));
    if (!isNew && u.email) v.email = norm(u.email);
    const newLogin = !hadLogin && !!v.email;
    if (newLogin && !v.pin) v.pin = v.mobile;
    v.doer = v.name.split(/\s+/)[0].toUpperCase();            // FMS doer name = first name
    const dom = officialDomain();
    const minPin = CLOUD ? 6 : 4;
    const bad = !v.name ? 'Enter the name.' : v.email && v.email !== norm(u.email || '') && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) && (!CLOUD || v.email.endsWith('@' + dom))) ? 'Use the official email (@' + dom + ').' :
      Store.all('users').some(x => x.id !== u.id && v.email && norm(x.email) === v.email) ? 'This email already has a user.' :
      !/^[6-9][0-9]{9}$/.test(v.mobile) ? 'Mobile must be 10 digits.' :
      v.pin && v.pin.length < minPin ? 'Password must be at least ' + minPin + ' characters.' :
      !v.department || !v.designation ? 'Choose department and designation.' :
      Store.get('roles', v.role_id) && Store.get('roles', v.role_id).system && !isSuperAdmin() ? 'Only a Super Admin can make a Super Admin.' : '';
    if (bad) { $('#usMsg', d).textContent = bad; return; }
    btn.disabled = true; $('#usMsg', d).textContent = '';
    try {
      if (CLOUD) {
        if (newLogin) await usCloud({ action: 'create', email: v.email, password: v.pin, role: cloudRole(v.role_id), name: v.name });
        else {
          if (v.role_id !== u.role_id) await usCloud({ action: 'role', email: v.email, role: cloudRole(v.role_id) });
          if (v.pin) await usCloud({ action: 'password', email: v.email, password: v.pin });
          if (v.active !== (u.active !== false)) await usCloud({ action: 'active', email: v.email, active: v.active });
        }
      }
      const doc = isNew ? { id: uid() } : Store.get('users', u.id);
      const pin = v.pin; delete v.pin;
      Object.assign(doc, v);
      if (pin) { if (CLOUD) US_SECRETS[norm(doc.email)] = pin; else { doc.pin_hash = await hashPin(doc.email, pin); doc.pwd = pin; delete doc.pin_seed; } }
      Store.put('users', doc); audit(isNew ? 'users.create' : 'users.edit', doc.email, roleName(doc.role_id) + ' · ' + doc.department + ' · ' + doc.designation);
      d.remove(); flash(esc(doc.name) + (isNew ? ' added.' : ' saved.')); VIEWS.users.render();
    } catch (e) { btn.disabled = false; $('#usMsg', d).textContent = e.message; }
  });
}
ACTIONS['us-new'] = () => { if (requirePerm('users', 'edit')) usDialog(null); };
ACTIONS['us-edit'] = el => { const u = Store.get('users', el.dataset.id); if (u && usCanTouch(u) && requirePerm('users', 'edit')) usDialog(u); };

/* ---------- access by department / designation ---------- */
const AC_UI = { dept: '', desig: '' };
VIEWS.roles = {
  mod: 'roles', render() {
    const edit = can('roles', 'edit'); const a = accessOf();
    if (!AC_UI.dept) AC_UI.dept = deptList()[0] || '';
    const key = AC_UI.dept + '|' + AC_UI.desig; const dm = (a.dept || {})[AC_UI.dept] || {}; const gm = AC_UI.desig ? ((a.desig || {})[key] || {}) : null;
    const L = { none: 'No access', view: 'View', edit: 'Edit' };
    let h = '<div class="toolbar"><label>Department<select id="acDept">' + deptList().map(x => '<option' + (x === AC_UI.dept ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '<label>Designation<select id="acDesig"><option value="">All designations</option>' + desigList(AC_UI.dept).map(x => '<option' + (x === AC_UI.desig ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label></div>';
    h += '<div class="tbl-wrap"><table class="bomflat nopage"><tr><th>Screen</th><th>Access</th><th>Users</th></tr>' + MODULES.map(m => {
      const dl = dm[m.key] || 'none';
      const cur = gm ? (gm[m.key] || '') : dl;
      const opts = (gm ? [['', 'Same as department (' + L[dl] + ')']] : []).concat(Object.entries(L));
      return '<tr><td>' + esc(m.label) + '</td><td><select data-acm="' + m.key + '"' + (edit ? '' : ' disabled') + '>' + opts.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></td><td class="num">' +
        Store.all('users').filter(u => u.active !== false && !(Store.get('roles', u.role_id) || {}).system && !(Store.get('roles', u.role_id) || {}).admin && u.department === AC_UI.dept && (!AC_UI.desig || u.designation === AC_UI.desig) && accessLevel(u.department, u.designation, m.key) !== 'none').length + '</td></tr>';
    }).join('') + '</table></div>';
    const m = setMain(h);
    $('#acDept').addEventListener('change', e => { AC_UI.dept = e.target.value; AC_UI.desig = ''; VIEWS.roles.render(); });
    $('#acDesig').addEventListener('change', e => { AC_UI.desig = e.target.value; VIEWS.roles.render(); });
    m.addEventListener('change', e => {
      const k = e.target.dataset.acm; if (!k || !requirePerm('roles', 'edit')) return;
      const st = settings(); const acc = clone(accessOf()); acc.dept = acc.dept || {}; acc.desig = acc.desig || {};
      if (AC_UI.desig) { const g = acc.desig[AC_UI.dept + '|' + AC_UI.desig] = acc.desig[AC_UI.dept + '|' + AC_UI.desig] || {}; if (e.target.value) g[k] = e.target.value; else delete g[k]; }
      else { const g = acc.dept[AC_UI.dept] = acc.dept[AC_UI.dept] || {}; g[k] = e.target.value; }
      st.access = acc; Store.setSettings(st); audit('access.edit', AC_UI.dept + (AC_UI.desig ? ' / ' + AC_UI.desig : ''), k + ' → ' + (e.target.value || 'same as department'));
      flash('Saved.'); renderNav(); VIEWS.roles.render();
    });
  }
};

/* ---------- settings ---------- */
VIEWS.settings = {
  mod: 'settings', render() {
    const s = settings(); const c = s.calendar; const edit = can('settings', 'edit'); const dis = edit ? '' : ' disabled';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let h = '<div class="grid2"><div>';
    h += '<div class="panel"><h2 style="margin-top:0">Company</h2><div class="row"><label style="flex:1">Company name<input data-s="company" value="' + esc(s.company) + '"' + dis + '></label><label>GSTIN<input data-s="gstin" value="' + esc(s.gstin) + '"' + dis + '></label></div><label style="margin-top:8px">Address<input data-s="address" value="' + esc(s.address) + '"' + dis + '></label><label style="margin-top:8px">Email<input data-s="email" value="' + esc(s.email || '') + '"' + dis + '></label></div>' +
      '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Alert emails</h2><label>MOQ over-order alert \u2014 concerned person email(s), comma separated<input data-s="alert_moq_email" value="' + esc(s.alert_moq_email || '') + '"' + dis + ' placeholder="purchase.head@company.com"></label><label style="margin-top:8px">Excess material approval \u2014 CEO email<input data-s="alert_excess_email" value="' + esc(s.alert_excess_email || '') + '"' + dis + '></label></div>' +
      '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">PO Terms and Conditions</h2><textarea data-s="po_terms" rows="4" style="width:100%"' + dis + '>' + esc(s.po_terms || PO_TERMS_DEFAULT) + '</textarea></div>' +
      '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">QC categories</h2><div class="row">' + itemCats().map(c => '<label style="flex-direction:row;align-items:center;gap:4px;min-width:0"><input type="checkbox" data-qccat="' + esc(c) + '"' + (qcCats().some(x => norm(x) === norm(c)) ? ' checked' : '') + dis + '>' + esc(c) + '</label>').join('') + '</div></div>';
    h += '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Working calendar (used for every TAT &amp; delay)</h2><div class="row">' +
      [['open', 'Office opens'], ['close', 'Office closes'], ['lunchStart', 'Lunch from'], ['lunchEnd', 'Lunch to']].map(([k, l]) => '<label>' + l + '<input type="time" data-cal="' + k + '" value="' + esc(c[k]) + '"' + dis + '></label>').join('') + '</div>' +
      '<div style="margin-top:10px"><span class="muted small">Weekly off</span><div class="row" style="margin-top:4px">' + days.map((d, i) => '<label style="flex-direction:row;align-items:center;gap:4px;min-width:0"><input type="checkbox" data-off="' + i + '"' + ((c.weeklyOff || []).includes(i) ? ' checked' : '') + dis + '>' + d + '</label>').join('') + '</div></div>' +
      '<div style="margin-top:10px"><span class="muted small">Half-day TAT (1.5 days)</span><div style="margin-top:4px">' + seg('halfDays', [{ v: 'exact', l: 'Exact — 1.5 days = 1.5 × office hours' }, { v: 'truncate', l: 'Sheet style — 1.5 → 1 day' }], c.halfDays, edit ? '' : 'data-locked') + '</div></div></div>';
    const OPT_KEYS = [['category', 'Category'], ['channel', 'Channel'], ['gender', 'Gender'], ['packing', 'Packing']];
    h += '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Dropdown Options</h2>' +
      OPT_KEYS.map(([k, l]) => '<label style="margin-bottom:8px">' + l + '<input data-opt="' + k + '" value="' + esc(optList(k).join(', ')) + '"' + (edit ? '' : ' disabled') + '></label>').join('') + '</div>';
    h += '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Data</h2><div class="toolbar"><button class="btn" data-act="backup">Download full backup (JSON)</button>' +
      (edit ? '<label class="btn" style="flex-direction:row;color:var(--text)">Restore backup<input type="file" id="restoreFile" accept=".json,application/json" class="hidden"></label>' : '') +
      (edit && !CLOUD ? '<button class="btn danger" data-act="reset-demo" data-confirm="Erase all & reload demo?">Reset to demo data</button>' : '') + '</div>' +
      '<div class="muted small">Mode: <b>' + (CLOUD ? 'Cloud (Supabase) — data shared by all users' : 'Local — data is saved in this browser only. Fill config.js to go multi-user.') + '</b> · Build ' + NEXUS_BUILD + '</div></div>';
    h += '</div><div><div class="panel"><h2 style="margin-top:0">Holidays</h2><div class="tbl-wrap"><table><tr><th>Date</th><th>Name</th><th></th></tr>' +
      (s.holidays || []).slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => '<tr><td>' + esc(fmtD(x.date)) + ' <span class="muted small">' + esc(days[new Date(x.date + 'T00:00').getDay()]) + '</span></td><td>' + esc(x.name) + '</td><td class="right">' + (edit ? '<button class="btn ghost sm danger" data-act="hol-del" data-d="' + esc(x.date) + '">×</button>' : '') + '</td></tr>').join('') + '</table></div>' +
      (edit ? '<div class="row" style="margin-top:8px"><label>Date<input id="holD" type="date"></label><label style="flex:1">Name<input id="holN" placeholder="Diwali"></label><button class="btn" data-act="hol-add">Add</button></div>' : '') + '</div></div></div>';
    const m = setMain(h);
    if (!edit) return;
    m.addEventListener('change', e => {
      const t = e.target; const st = settings();
      if (t.dataset.s) { st[t.dataset.s] = t.dataset.s === 'po_terms' ? t.value.split('\n').map(x => x.trim()).filter(Boolean).join('\n') : t.value.trim(); }
      else if (t.dataset.qccat != null) { st.qc_categories = $$('[data-qccat]').filter(x => x.checked).map(x => x.dataset.qccat); }
      else if (t.dataset.cal) { if (!/^\d\d:\d\d$/.test(t.value)) return; st.calendar[t.dataset.cal] = t.value; }
      else if (t.dataset.off != null) { st.calendar.weeklyOff = $$('[data-off]').filter(x => x.checked).map(x => +x.dataset.off); if (st.calendar.weeklyOff.length > 5) { flash('At least 2 working days needed.', 'err'); return VIEWS.settings.render(); } }
      else if (t.dataset.opt) {
        const list = t.value.split(',').map(x => x.trim()).filter(Boolean);
        if (!list.length) { flash('At least one option is required.', 'err'); return VIEWS.settings.render(); }
        st.options = st.options || {}; st.options[t.dataset.opt] = list;
        Store.setSettings(st); audit('settings.options', t.dataset.opt, list.join(', ')); flash('Options saved — all dropdowns updated.'); return;
      }
      else if (t.id === 'restoreFile') return restoreBackup(t.files[0]);
      else return;
      const cc = st.calendar; if (!(cc.open < cc.lunchStart && cc.lunchStart <= cc.lunchEnd && cc.lunchEnd < cc.close)) { flash('Timings must be: open < lunch from ≤ lunch to < close.', 'err'); return; }
      Store.setSettings(st); audit('settings.edit', '', t.dataset.s || t.dataset.cal || (t.dataset.qccat != null ? 'qc categories' : 'weekly off')); flash('Saved. Planned times recalculated.');
    });
    onSeg(e => { if (e.target.dataset.seg === 'halfDays') { const st = settings(); st.calendar.halfDays = e.detail; Store.setSettings(st); audit('settings.edit', '', 'halfDays → ' + e.detail); flash('Saved.'); } });
  }
};
ACTIONS['hol-add'] = () => {
  const d = $('#holD').value, n = $('#holN').value.trim(); if (!d) return flash('Pick a date.', 'err');
  const st = settings(); st.holidays = (st.holidays || []).filter(x => x.date !== d).concat([{ date: d, name: n || 'Holiday' }]);
  Store.setSettings(st); audit('holiday.add', d, n); VIEWS.settings.render();
};
ACTIONS['hol-del'] = el => { const st = settings(); st.holidays = st.holidays.filter(x => x.date !== el.dataset.d); Store.setSettings(st); audit('holiday.delete', el.dataset.d, ''); VIEWS.settings.render(); };
ACTIONS['backup'] = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], { type: 'application/json' })); a.download = 'nexus-backup-' + todayYmd() + '.json'; a.click(); audit('backup', '', 'downloaded'); };
ACTIONS['reset-demo'] = () => { localStorage.removeItem(DB_KEY); localStorage.removeItem('nexus2_me'); location.reload(); };
function restoreBackup(file) {
  if (!file) return; const rd = new FileReader();
  rd.onload = () => {
    let data; try { data = JSON.parse(rd.result); } catch (e) { return flash('Not a valid backup file.', 'err'); }
    if (!data.settings || !Array.isArray(data.users) || !Array.isArray(data.orders)) return flash('Not a Nexus backup.', 'err');
    if (!data.users.some(u => norm(u.email) === norm(ME.email))) return flash('Your email is not in this backup — restore refused so you do not lock yourself out.', 'err');
    COLS.forEach(c => { (data[c] || []).forEach(d => Store.put(c, d)); (DB[c] || []).filter(d => !(data[c] || []).some(x => x.id === d.id)).forEach(d => Store.del(c, d.id)); });
    Store.setSettings(data.settings); audit('restore', '', file.name); flash('Backup restored.'); route();
  };
  rd.readAsText(file);
}

/* ---------- audit ---------- */
const AUD_UI = { q: '' };
VIEWS.audit = {
  mod: 'audit', render() {
    const q = norm(AUD_UI.q);
    const list = Store.all('audit').filter(a => !q || norm(a.user + ' ' + a.action + ' ' + a.ref + ' ' + a.detail).includes(q)).sort((a, b) => a.at < b.at ? 1 : -1);
    setMain('<div class="toolbar"><input id="audQ" placeholder="Search user / action / order…" value="' + esc(AUD_UI.q) + '"><span class="muted small">' + list.length + ' event(s)' + (list.length > 500 ? ', showing latest 500' : '') + '</span></div>' +
      '<div class="tbl-wrap"><table><tr><th>When</th><th>User</th><th>Action</th><th>Ref</th><th>Detail</th></tr>' + list.slice(0, 500).map(a => '<tr><td class="nowrap">' + fmtDT(a.at) + '</td><td>' + esc(a.user) + '</td><td class="mono">' + esc(a.action) + '</td><td>' + esc(a.ref) + '</td><td>' + esc(a.detail) + '</td></tr>').join('') + '</table></div>');
    $('#audQ').addEventListener('input', e => { AUD_UI.q = e.target.value; clearTimeout(AUD_UI.t); AUD_UI.t = setTimeout(() => { VIEWS.audit.render(); const i = $('#audQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

boot();
