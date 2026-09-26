/* Nexus 2.0 — Development › Item Creation.
   Every category owns its attributes, each with a fixed sequence number. An item's name is always
   ITEM TYPE + attribute values in that category sequence, so the same material cannot be named two
   ways and cannot be created twice. Attributes, values and item types are data managed in
   Category Setup; only the first-run footwear defaults live in code. */
'use strict';

const IC_UI = { tab: 'create', cat: '', type: '', vals: {}, extra: {}, scat: '', editAttr: null, editType: null, newCats: [] };
const icSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const squash = s => norm(s).replace(/[^a-z0-9.]/g, '');

function itemCats() {
  const s = new Set(ITEM_CATS);
  Store.all('item_types').forEach(t => { if (t.category) s.add(t.category); });
  Store.all('attributes').forEach(a => { if (a.category) s.add(a.category); });
  IC_UI.newCats.forEach(c => s.add(c));
  return Array.from(s).sort();
}
function catAttrs(cat) { return Store.all('attributes').filter(a => norm(a.category || '') === norm(cat)).sort((a, b) => (a.seq || 0) - (b.seq || 0)); }
function typesOf(cat) { return Store.all('item_types').filter(t => norm(t.category) === norm(cat)).sort((a, b) => a.name.localeCompare(b.name)); }
function usesAttr(t, name) { return (t.attrs || []).some(x => norm(x) === norm(name)); }
// the attributes a type uses, always in the category sequence (never in the order they were ticked)
function typeAttrs(t) { return catAttrs(t.category).filter(a => usesAttr(t, a.name)); }
function itemNameOf(t, vals) { return [t.name].concat(typeAttrs(t).map(a => vals[a.name] || '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toUpperCase(); }
function itemKeyOf(cat, typeName, vals) {
  return norm(cat) + '|' + norm(typeName) + '|' + Object.keys(vals).filter(k => vals[k]).map(k => norm(k) + '=' + norm(vals[k])).sort().join(',');
}
// duplicate = same category + type + attribute values, or the same name ignoring spaces/punctuation
function itemDuplicate(cat, t, vals) {
  const key = itemKeyOf(cat, t.name, vals); const nm = squash(itemNameOf(t, vals));
  return Store.all('materials').find(m => (m.attr_key && m.attr_key === key) || squash(m.name) === nm) || null;
}
function renumber(cat) { catAttrs(cat).forEach((a, i) => { if (a.seq !== i + 1) { a.seq = i + 1; Store.put('attributes', a); } }); }

VIEWS.itemcreate = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    let h = subTitle('Item Creation') + '<div class="toolbar">' + seg('ictab', [{ v: 'create', l: 'Create Item' }, { v: 'setup', l: 'Category Setup' }], IC_UI.tab) + '</div>';
    h += IC_UI.tab === 'create' ? icCreateHtml(edit) : icSetupHtml(edit);
    setMain(h);
    onSeg(e => {
      const s = e.target.dataset.seg;
      if (s === 'ictab') { IC_UI.tab = e.detail; IC_UI.editAttr = IC_UI.editType = null; }
      if (s === 'iccat') { IC_UI.scat = e.detail; IC_UI.editAttr = IC_UI.editType = null; }
      VIEWS.itemcreate.render();
    });
    const m = $('#main');
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'icCat') { IC_UI.cat = t.value; IC_UI.type = ''; IC_UI.vals = {}; IC_UI.extra = {}; IC_UI.photo = ''; VIEWS.itemcreate.render(); }
      if (t.id === 'icType') { IC_UI.type = t.value; IC_UI.vals = {}; IC_UI.extra = {}; VIEWS.itemcreate.render(); }
      if (t.id === 'icPhoto') readImg(t.files[0], src => { IC_UI.photo = src; VIEWS.itemcreate.render(); });
      if (t.dataset.icAttr) { IC_UI.vals[t.dataset.icAttr] = t.value; VIEWS.itemcreate.render(); const nx = $$('select[data-ic-attr]').find(s => !s.value && !s.disabled); if (nx) nx.focus(); }
    });
    m.addEventListener('input', e => { if (e.target.dataset.icx) IC_UI.extra[e.target.dataset.icx] = e.target.value; });
  }
};

/* ================= Create Item (document layout) ================= */
function icCreateHtml(edit) {
  const cats = itemCats().filter(c => typesOf(c).length);
  const types = IC_UI.cat ? typesOf(IC_UI.cat) : [];
  const t = types.find(x => x.id === IC_UI.type);
  const attrs = t ? typeAttrs(t) : [];
  const X = IC_UI.extra;
  let rows = '<tr><td class="k">Category *</td><td><select id="icCat"><option value="">Select category…</option>' + cats.map(c => '<option' + (c === IC_UI.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Item Type *</td><td><select id="icType"' + (types.length ? '' : ' disabled') + '><option value="">' + (IC_UI.cat ? 'Select item type…' : '—') + '</option>' + types.map(x => '<option value="' + esc(x.id) + '"' + (x.id === IC_UI.type ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></td></tr>';
  // attributes open one by one, strictly in the category sequence
  let open = true;
  attrs.forEach((a, i) => {
    const v = IC_UI.vals[a.name] || '';
    rows += '<tr><td class="k"><span class="seqn">' + (i + 1) + '</span>' + esc(a.name) + ' *</td><td><select data-ic-attr="' + esc(a.name) + '"' + (open ? '' : ' disabled') + '><option value="">' + (open ? 'Select…' : 'select step ' + i + ' first') + '</option>' +
      (a.values || []).map(x => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></td></tr>';
    if (!v) open = false;
  });
  if (t) {
    const inp = (k, label, def, type) => '<tr><td class="k">' + label + '</td><td><input data-icx="' + k + '"' + (type ? ' type="' + type + '" min="0" step="any"' : '') + ' value="' + esc(X[k] != null ? X[k] : def) + '"></td></tr>';
    rows += '<tr><td class="k">Photo</td><td><label class="icphoto">' + (IC_UI.photo ? '<img src="' + IC_UI.photo + '">' : '<span class="muted">Add photo (optional)</span>') + '<input type="file" id="icPhoto" accept="image/*" style="display:none"></label>' + (IC_UI.photo ? ' <a class="small" data-act="ic-photo-clear">Remove</a>' : '') + '</td></tr>' +
      '<tr><td class="k">UOM</td><td><select data-icx="uom">' + UOMS.map(u => '<option' + (u === (X.uom || t.uom || 'PCS') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></td></tr>' +
      inp('price', 'Price ₹', '', 'number') + inp('gst', 'GST %', t.gst || '', 'number') + inp('hsn', 'HSN', t.hsn || '') + inp('rack', 'Rack No.', '') + inp('min', 'Min Level', '', 'number');
  }
  const missing = attrs.filter(a => !IC_UI.vals[a.name]);
  const dup = t && !missing.length ? itemDuplicate(IC_UI.cat, t, IC_UI.vals) : null;
  const name = t ? itemNameOf(t, IC_UI.vals) : '';
  let right = '<div class="icres"><div class="icres-h">GENERATED ITEM NAME</div><div class="icres-name">' + (name ? esc(name) : '<span class="muted">Select category and item type</span>') + '</div>';
  if (t) {
    right += '<table class="jcbom"><tr class="hd"><th style="width:60px">Seq</th><th>Name Part</th><th>Value</th></tr>' +
      '<tr><td class="c">—</td><td>ITEM TYPE</td><td><b>' + esc(t.name) + '</b></td></tr>' +
      attrs.map((a, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(a.name) + '</td><td>' + (IC_UI.vals[a.name] ? '<b>' + esc(IC_UI.vals[a.name]) + '</b>' : '<span class="muted">pending</span>') + '</td></tr>').join('') + '</table>' +
      '<div class="icres-f"><span>Item Code <b>' + esc(itemCodeAuto(IC_UI.cat)) + '</b></span>' +
      (missing.length ? '<span class="st Pending">Next: select ' + esc(missing[0].name) + '</span>'
        : dup ? '<span class="st Late">Already exists: ' + esc(dup.code) + '</span>' : '<span class="st Done">New item — ready</span>') +
      '<span class="grow"></span><button class="btn primary" data-act="ic-create"' + (!edit || missing.length || dup ? ' disabled' : '') + '>Create Item</button></div>';
  }
  right += '</div>';
  let h = '<div class="jcdoc"><div class="jcban">ITEM CREATION</div><div class="jcmid"><div class="jcl icl"><table class="jckv">' + rows + '</table></div>' + right + '</div></div>';

  // existing items: one column per attribute so values line up
  if (t) {
    const list = Store.all('materials').filter(m => norm(m.group) === norm(IC_UI.cat) && norm(m.item_type || '') === norm(t.name)).sort((a, b) => a.code.localeCompare(b.code));
    h += '<h2>' + esc(t.name) + ' — existing items (' + list.length + ')</h2><div class="tbl-wrap"><table><tr><th>Photo</th><th>Item Code</th><th>Item Name</th>' + attrs.map((a, i) => '<th>' + (i + 1) + '. ' + esc(a.name) + '</th>').join('') + '<th>UOM</th><th class="num">Price</th></tr>' +
      (list.length ? list.map(m => '<tr><td>' + photoThumb(m.photo) + '</td><td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td>' + attrs.map(a => '<td>' + esc((m.attrs || {})[a.name] || '') + '</td>').join('') + '<td>' + esc(m.uom || '') + '</td><td class="num">' + (m.price ? money(m.price) : '') + '</td></tr>').join('')
        : '<tr><td colspan="' + (attrs.length + 5) + '" class="empty">No items of this type yet</td></tr>') + '</table></div>';
  } else if (IC_UI.cat) {
    h += '<h2>' + esc(IC_UI.cat) + ' — item types</h2>' + icTypeMatrix(IC_UI.cat, false);
  }
  return h;
}
ACTIONS['ic-create'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', IC_UI.type); if (!t) return;
  const attrs = typeAttrs(t); const vals = {};
  attrs.forEach(a => { vals[a.name] = IC_UI.vals[a.name] || ''; });
  if (attrs.some(a => !vals[a.name])) { flash('Select every attribute first.', 'err'); return; }
  const dup = itemDuplicate(IC_UI.cat, t, vals);
  if (dup) { flash('Already exists as ' + esc(dup.code) + ' · ' + esc(dup.name), 'err'); return; }
  const X = IC_UI.extra;
  const m = Store.put('materials', {
    id: uid(), code: itemCodeAuto(IC_UI.cat), name: itemNameOf(t, vals), group: IC_UI.cat, item_type: t.name,
    attrs: vals, attr_key: itemKeyOf(IC_UI.cat, t.name, vals), uom: X.uom || t.uom || 'PCS',
    price: num(X.price) || 0, gst: num(X.gst != null ? X.gst : t.gst) || 0, hsn: String(X.hsn != null ? X.hsn : t.hsn || '').trim(),
    rack: String(X.rack || '').trim().toUpperCase(), min_level: num(X.min) || 0, photo: IC_UI.photo || '', created_at: nowIso(), created_by: ME.name
  });
  audit('item.create', m.code, m.name);
  flash('Created ' + esc(m.code) + ' · ' + esc(m.name));
  IC_UI.vals = {}; IC_UI.extra = {}; IC_UI.photo = ''; VIEWS.itemcreate.render();
};
ACTIONS['ic-photo-clear'] = () => { IC_UI.photo = ''; VIEWS.itemcreate.render(); };

/* ================= Category Setup ================= */
function icSetupHtml(edit) {
  const cats = itemCats();
  if (!IC_UI.scat || !cats.includes(IC_UI.scat)) IC_UI.scat = cats[0];
  const cat = IC_UI.scat;
  const A = catAttrs(cat);
  let h = '<div class="toolbar">' + seg('iccat', cats, cat) + (edit ? '<span class="grow"></span><input id="icNewCat" placeholder="New category" style="width:160px"><button class="btn sm" data-act="ic-addcat">Add Category</button>' : '') + '</div>';

  // attributes of this category, in name sequence
  h += '<div class="card"><div class="card-h"><b>' + esc(cat) + ' — Attributes</b></div><div class="card-b">' +
    '<table class="jcbom icgrid"><tr class="hd"><th style="width:56px">Seq</th><th style="width:180px">Attribute</th><th>Allowed Values</th><th style="width:220px">Used in Item Types</th>' + (edit ? '<th style="width:190px">Actions</th>' : '') + '</tr>';
  A.forEach((a, i) => {
    const used = typesOf(cat).filter(t => usesAttr(t, a.name));
    if (edit && IC_UI.editAttr === a.id) {
      h += '<tr data-arow="' + esc(a.id) + '"><td class="c">' + (i + 1) + '</td><td><input data-af="name" value="' + esc(a.name) + '"></td><td><textarea data-af="vals" rows="3">' + esc(a.values.join(', ')) + '</textarea></td><td class="wrap small">' + used.map(t => esc(t.name)).join(', ') + '</td>' +
        '<td class="c"><button class="btn sm primary" data-act="at-save" data-id="' + esc(a.id) + '">Save</button> <button class="btn sm" data-act="at-cancel">Cancel</button></td></tr>';
    } else {
      h += '<tr><td class="c"><span class="seqn">' + (i + 1) + '</span></td><td><b>' + esc(a.name) + '</b></td><td class="wrap small">' + a.values.map(esc).join(', ') + ' <span class="muted">(' + a.values.length + ')</span></td><td class="wrap small">' + (used.map(t => esc(t.name)).join(', ') || '—') + '</td>' +
        (edit ? '<td class="c nowrap"><button class="btn sm" data-act="at-move" data-id="' + esc(a.id) + '" data-dir="-1" title="Move up"' + (i ? '' : ' disabled') + '>↑</button> <button class="btn sm" data-act="at-move" data-id="' + esc(a.id) + '" data-dir="1" title="Move down"' + (i < A.length - 1 ? '' : ' disabled') + '>↓</button> ' +
          '<button class="btn sm" data-act="at-edit" data-id="' + esc(a.id) + '">Edit</button> ' + (used.length ? '' : '<button class="btn sm ghost danger" data-act="at-del" data-id="' + esc(a.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
    }
  });
  if (!A.length) h += '<tr><td colspan="5" class="empty">No attributes for ' + esc(cat) + ' yet</td></tr>';
  if (edit) h += '<tr class="addrow" data-arow="new"><td class="c">' + (A.length + 1) + '</td><td><input data-af="name" placeholder="e.g. COLOUR"></td><td><textarea data-af="vals" rows="2" placeholder="Values, comma separated: BLACK, WHITE, NAVY"></textarea></td><td></td><td class="c"><button class="btn sm primary" data-act="at-add">Add Attribute</button></td></tr>';
  h += '</table></div></div>';

  // item types of this category: one tick column per attribute, in sequence
  h += '<div class="card"><div class="card-h"><b>' + esc(cat) + ' — Item Types</b></div><div class="card-b">' + icTypeMatrix(cat, edit) + '</div></div>';
  return h;
}
function icTypeMatrix(cat, edit) {
  const A = catAttrs(cat); const T = typesOf(cat);
  const uomSel = v => '<select data-tf="uom">' + UOMS.map(u => '<option' + (u === (v || 'PCS') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>';
  let h = '<div style="overflow-x:auto"><table class="jcbom icgrid"><tr class="hd"><th style="width:170px">Item Type</th>' + A.map((a, i) => '<th class="c">' + (i + 1) + '. ' + esc(a.name) + '</th>').join('') +
    '<th style="width:90px">UOM</th><th style="width:80px">HSN</th><th style="width:60px">GST %</th><th style="width:60px">Items</th>' + (edit ? '<th style="width:130px">Actions</th>' : '') + '</tr>';
  T.forEach(t => {
    const n = Store.all('materials').filter(m => norm(m.item_type || '') === norm(t.name) && norm(m.group) === norm(cat)).length;
    if (edit && IC_UI.editType === t.id) {
      h += '<tr data-trow="' + esc(t.id) + '"><td><input data-tf="name" value="' + esc(t.name) + '"></td>' + A.map(a => '<td class="c"><input type="checkbox" data-tatt="' + esc(a.name) + '"' + (usesAttr(t, a.name) ? ' checked' : '') + '></td>').join('') +
        '<td>' + uomSel(t.uom) + '</td><td><input data-tf="hsn" value="' + esc(t.hsn || '') + '"></td><td><input data-tf="gst" type="number" value="' + esc(t.gst || '') + '"></td><td class="c">' + (n || '—') + '</td>' +
        '<td class="c nowrap"><button class="btn sm primary" data-act="it-save" data-id="' + esc(t.id) + '">Save</button> <button class="btn sm" data-act="it-cancel">Cancel</button></td></tr>';
    } else {
      h += '<tr><td><b>' + esc(t.name) + '</b></td>' + A.map(a => '<td class="c">' + (usesAttr(t, a.name) ? '<span class="tick">✓</span>' : '') + '</td>').join('') +
        '<td>' + esc(t.uom || '') + '</td><td>' + esc(t.hsn || '') + '</td><td class="c">' + (t.gst || '') + '</td><td class="c">' + (n || '—') + '</td>' +
        (edit ? '<td class="c nowrap"><button class="btn sm" data-act="it-edit" data-id="' + esc(t.id) + '">Edit</button> ' + (n ? '' : '<button class="btn sm ghost danger" data-act="it-del" data-id="' + esc(t.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
    }
  });
  if (!T.length) h += '<tr><td colspan="' + (A.length + 6) + '" class="empty">No item types for ' + esc(cat) + ' yet</td></tr>';
  if (edit) h += '<tr class="addrow" data-trow="new"><td><input data-tf="name" placeholder="New item type"></td>' + A.map(a => '<td class="c"><input type="checkbox" data-tatt="' + esc(a.name) + '"></td>').join('') +
    '<td>' + uomSel('') + '</td><td><input data-tf="hsn"></td><td><input data-tf="gst" type="number"></td><td></td><td class="c"><button class="btn sm primary" data-act="it-add">Add Type</button></td></tr>';
  return h + '</table></div>';
}

/* ---- category / attribute / type actions ---- */
ACTIONS['ic-addcat'] = () => {
  const c = ($('#icNewCat').value || '').trim().replace(/\s+/g, ' ');
  if (!c) return;
  const ex = itemCats().find(x => norm(x) === norm(c));
  if (!ex) IC_UI.newCats.push(c);
  IC_UI.scat = ex || c; VIEWS.itemcreate.render();
};
function atRead(tr) {
  const name = $('[data-af="name"]', tr).value.trim().toUpperCase().replace(/\s+/g, ' ');
  const values = Array.from(new Set($('[data-af="vals"]', tr).value.split(/[,\n]/).map(x => x.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean)));
  return { name, values };
}
ACTIONS['at-add'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const cat = IC_UI.scat; const r = atRead(el.closest('tr'));
  if (!r.name || !r.values.length) { flash('Attribute name and at least one value are required.', 'err'); return; }
  if (catAttrs(cat).some(a => norm(a.name) === norm(r.name))) { flash(esc(r.name) + ' already exists in ' + esc(cat) + '.', 'err'); return; }
  Store.put('attributes', { id: uid(), category: cat, name: r.name, seq: catAttrs(cat).length + 1, values: r.values });
  audit('attribute.add', cat + ' · ' + r.name, r.values.length + ' values'); VIEWS.itemcreate.render();
};
ACTIONS['at-edit'] = el => { IC_UI.editAttr = el.dataset.id; VIEWS.itemcreate.render(); };
ACTIONS['at-cancel'] = () => { IC_UI.editAttr = null; VIEWS.itemcreate.render(); };
ACTIONS['at-save'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id); const r = atRead(el.closest('tr'));
  if (!r.name || !r.values.length) { flash('Attribute name and at least one value are required.', 'err'); return; }
  if (catAttrs(a.category).some(x => x.id !== a.id && norm(x.name) === norm(r.name))) { flash(esc(r.name) + ' already exists in ' + esc(a.category) + '.', 'err'); return; }
  const old = a.name; a.name = r.name; a.values = r.values; Store.put('attributes', a);
  if (norm(old) !== norm(r.name)) typesOf(a.category).forEach(t => { if (usesAttr(t, old)) { t.attrs = t.attrs.map(x => norm(x) === norm(old) ? r.name : x); Store.put('item_types', t); } });
  audit('attribute.edit', a.category + ' · ' + r.name, r.values.length + ' values');
  IC_UI.editAttr = null; VIEWS.itemcreate.render();
};
ACTIONS['at-move'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id); const list = catAttrs(a.category);
  const i = list.findIndex(x => x.id === a.id); const j = i + num(el.dataset.dir);
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { if (x.seq !== k + 1) { x.seq = k + 1; Store.put('attributes', x); } });
  audit('attribute.sequence', a.category, list.map(x => x.name).join(' > ')); VIEWS.itemcreate.render();
};
ACTIONS['at-del'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id);
  Store.del('attributes', a.id); renumber(a.category); audit('attribute.delete', a.category + ' · ' + a.name, ''); VIEWS.itemcreate.render();
};
function itRead(tr) {
  return {
    name: $('[data-tf="name"]', tr).value.trim().toUpperCase().replace(/\s+/g, ' '),
    attrs: $$('[data-tatt]', tr).filter(c => c.checked).map(c => c.dataset.tatt),
    uom: $('[data-tf="uom"]', tr).value, hsn: $('[data-tf="hsn"]', tr).value.trim(), gst: num($('[data-tf="gst"]', tr).value) || 0
  };
}
function itCheck(r, cat, selfId) {
  if (!r.name) return 'Item type name is required.';
  if (!r.attrs.length) return 'Tick at least one attribute.';
  if (typesOf(cat).some(t => t.id !== selfId && norm(t.name) === norm(r.name))) return r.name + ' already exists in ' + cat + '.';
  return '';
}
ACTIONS['it-add'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const cat = IC_UI.scat; const r = itRead(el.closest('tr')); const err = itCheck(r, cat);
  if (err) { flash(esc(err), 'err'); return; }
  Store.put('item_types', Object.assign({ id: uid(), category: cat }, r));
  audit('itemtype.add', cat + ' · ' + r.name, r.attrs.join(', ')); VIEWS.itemcreate.render();
};
ACTIONS['it-edit'] = el => { IC_UI.editType = el.dataset.id; VIEWS.itemcreate.render(); };
ACTIONS['it-cancel'] = () => { IC_UI.editType = null; VIEWS.itemcreate.render(); };
ACTIONS['it-save'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', el.dataset.id); const r = itRead(el.closest('tr')); const err = itCheck(r, t.category, t.id);
  if (err) { flash(esc(err), 'err'); return; }
  Object.assign(t, r); Store.put('item_types', t);
  audit('itemtype.edit', t.category + ' · ' + t.name, r.attrs.join(', ')); IC_UI.editType = null; VIEWS.itemcreate.render();
};
ACTIONS['it-del'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', el.dataset.id); Store.del('item_types', t.id); audit('itemtype.delete', t.category + ' · ' + t.name, ''); VIEWS.itemcreate.render();
};

/* ================= first-run footwear defaults ================= */
const COLOURS = 'BLACK, WHITE, OFF WHITE, BEIGE, CREAM, TAN, BROWN, DARK BROWN, NAVY, BLUE, SKY BLUE, GREY, DARK GREY, RED, MAROON, PINK, PEACH, LILAC, PURPLE, YELLOW, MUSTARD, ORANGE, GREEN, OLIVE, KHAKI, SILVER, GOLD, NATURAL, TRANSPARENT, MULTI';
const SIZE_RUNS = '1X5, 1X4, 4X8, 5X9, 6X10, 7X11, 8X12, 10X13, 11X13';
// category -> attributes in name sequence [name, values]
const IC_DEFAULT_ATTRS = {
  'Compound': [['THICKNESS', '1MM, 2MM, 3MM, 4MM, 5MM, 6MM, 8MM, 10MM, 12MM, 15MM, 20MM'], ['HARDNESS', '20 SHORE A, 25 SHORE A, 30 SHORE A, 35 SHORE A, 40 SHORE A, 45 SHORE A, 50 SHORE A, 55 SHORE A, 60 SHORE A, 65 SHORE A, 70 SHORE A'], ['COLOUR', COLOURS], ['SHEET SIZE', '1X1 MTR, 1X2 MTR, 1.1X1.5 MTR, 1.2X2.4 MTR, 1.4X1.4 MTR']],
  'Fabric': [['GSM', '100GSM, 120GSM, 150GSM, 180GSM, 200GSM, 250GSM, 300GSM, 350GSM, 400GSM'], ['THICKNESS', '1MM, 2MM, 3MM, 4MM, 5MM'], ['COLOUR', COLOURS], ['WIDTH', '36 INCH, 44 INCH, 54 INCH, 58 INCH, 60 INCH, 64 INCH']],
  'Synthetic': [['THICKNESS', '0.6MM, 0.8MM, 1.0MM, 1.2MM, 1.4MM, 1.6MM, 1.8MM, 2MM'], ['FINISH', 'MATT, GLOSSY, PATENT, NUBUCK, SUEDE, EMBOSSED, PRINTED, METALLIC, CRINKLE, NAPPA, MILLED'], ['COLOUR', COLOURS], ['WIDTH', '44 INCH, 54 INCH, 58 INCH, 60 INCH']],
  'Leather': [['THICKNESS', '0.8MM, 1.0MM, 1.2MM, 1.4MM, 1.6MM, 1.8MM, 2MM, 2.5MM'], ['FINISH', 'MATT, GLOSSY, PATENT, NUBUCK, SUEDE, NAPPA, MILLED, CRUNCH'], ['COLOUR', COLOURS]],
  'Sole': [['MATERIAL', 'EVA, PU, PVC, TPR, TPU, RUBBER, PHYLON, LATEX, MEMORY FOAM'], ['THICKNESS', '3MM, 4MM, 5MM, 6MM, 8MM, 10MM, 12MM, 15MM, 20MM, 25MM'], ['SIZE RUN', SIZE_RUNS], ['COLOUR', COLOURS]],
  'Upper': [['MATERIAL', 'CHEMICAL SHEET, TPU, LEATHERBOARD, NONWOVEN'], ['THICKNESS', '0.6MM, 0.8MM, 1.0MM, 1.2MM, 1.5MM, 2MM'], ['SIZE RUN', SIZE_RUNS], ['COLOUR', COLOURS]],
  'Grinderies': [['MATERIAL', 'NYLON, POLYESTER, COTTON, PVC, TPU, METAL'], ['THREAD TKT', 'TKT 10, TKT 20, TKT 30, TKT 40, TKT 60, TKT 80'], ['LACE SHAPE', 'FLAT, ROUND, OVAL, WAXED ROUND'], ['LACE LENGTH', '80CM, 90CM, 100CM, 110CM, 120CM, 140CM, 160CM'], ['EYELET SIZE', '3MM, 4MM, 5MM, 6MM, 8MM, 10MM'], ['TAPE WIDTH', '10MM, 12MM, 16MM, 20MM, 25MM, 32MM, 38MM, 50MM'], ['SIZE RUN', SIZE_RUNS], ['FINISH', 'MATT, GLOSSY, ANTIQUE, NICKEL, BLACK OXIDE'], ['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']],
  'Packaging': [['BOX SIZE', 'NO.1, NO.2, NO.3, NO.4, NO.5, NO.6, KIDS'], ['BAG SIZE', '8X10, 10X14, 12X16, 14X18, 16X20'], ['LABEL SIZE', '38X25MM, 50X25MM, 50X38MM, 75X50MM, 100X50MM'], ['PLY', '3 PLY, 5 PLY, 7 PLY'], ['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']],
  'Consumable Item': [['MATERIAL', 'PU, NEOPRENE, LATEX, WATER BASED, SOLVENT BASED'], ['PACK SIZE', '1 LTR, 5 LTR, 15 LTR, 20 LTR, 1 KG, 5 KG, 25 KG']],
  'Silicon': [['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']]
};
const IC_DEFAULT_TYPES = [
  ['Compound', 'EVA SHEET', 'THICKNESS, HARDNESS, COLOUR, SHEET SIZE', 'SHEET', '3921'], ['Compound', 'PU COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3909'],
  ['Compound', 'TPR COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3902'], ['Compound', 'RUBBER COMPOUND', 'HARDNESS, COLOUR', 'KGS', '4005'], ['Compound', 'PVC COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3904'],
  ['Fabric', 'KNIT MESH', 'GSM, COLOUR, WIDTH', 'MTR', '6006'], ['Fabric', 'SANDWICH MESH', 'THICKNESS, COLOUR, WIDTH', 'MTR', '6005'],
  ['Fabric', 'LINING FABRIC', 'GSM, COLOUR, WIDTH', 'MTR', '5407'], ['Fabric', 'CANVAS', 'GSM, COLOUR, WIDTH', 'MTR', '5209'],
  ['Synthetic', 'PU SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'], ['Synthetic', 'PVC SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'], ['Synthetic', 'MICROFIBRE', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5603'],
  ['Leather', 'LEATHER', 'THICKNESS, FINISH, COLOUR', 'SQFT', '4107'],
  ['Sole', 'OUTSOLE', 'MATERIAL, SIZE RUN, COLOUR', 'PAIR', '6406'], ['Sole', 'MIDSOLE', 'MATERIAL, THICKNESS, SIZE RUN, COLOUR', 'PAIR', '6406'], ['Sole', 'INSOLE', 'MATERIAL, THICKNESS, SIZE RUN', 'PAIR', '6406'],
  ['Upper', 'TOE PUFF', 'MATERIAL, THICKNESS', 'SHEET', '5603'], ['Upper', 'COUNTER STIFFENER', 'MATERIAL, THICKNESS', 'SHEET', '5603'],
  ['Grinderies', 'THREAD', 'MATERIAL, THREAD TKT, COLOUR', 'ROLL', '5401'], ['Grinderies', 'SHOE LACE', 'LACE SHAPE, LACE LENGTH, COLOUR', 'PAIR', '6307'],
  ['Grinderies', 'EYELET', 'EYELET SIZE, FINISH, COLOUR', 'PCS', '8308'], ['Grinderies', 'VELCRO TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'],
  ['Grinderies', 'ELASTIC TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'], ['Grinderies', 'STRAP', 'MATERIAL, SIZE RUN, COLOUR, PRINT', 'PAIR', '3926'],
  ['Packaging', 'SHOE BOX', 'BOX SIZE, PLY, PRINT', 'PCS', '4819'], ['Packaging', 'CARTON', 'BOX SIZE, PLY', 'PCS', '4819'], ['Packaging', 'POLY BAG', 'BAG SIZE', 'PCS', '3923'],
  ['Packaging', 'TISSUE PAPER', 'COLOUR', 'PCS', '4803'], ['Packaging', 'BARCODE LABEL', 'LABEL SIZE', 'ROLL', '4821'],
  ['Consumable Item', 'ADHESIVE', 'MATERIAL, PACK SIZE', 'LTR', '3506'], ['Consumable Item', 'PRIMER', 'MATERIAL, PACK SIZE', 'LTR', '3208'], ['Consumable Item', 'HARDENER', 'PACK SIZE', 'LTR', '3208'],
  ['Silicon', 'SILICON LABEL', 'COLOUR, PRINT', 'PCS', '3926']
];
function icSeedDefaults() {
  Object.keys(IC_DEFAULT_ATTRS).forEach(cat => IC_DEFAULT_ATTRS[cat].forEach(([n, v], i) =>
    Store.put('attributes', { id: 'ca_' + icSlug(cat) + '_' + icSlug(n), category: cat, name: n, seq: i + 1, values: v.split(',').map(x => x.trim()) })));
  IC_DEFAULT_TYPES.forEach(r => Store.put('item_types', { id: 'it_' + icSlug(r[0] + '_' + r[1]), category: r[0], name: r[1], attrs: r[2].split(',').map(x => x.trim()), uom: r[3], hsn: r[4], gst: r[0] === 'Fabric' || r[0] === 'Packaging' ? 12 : 18 }));
}
// called from migrateDb on every login; fixed ids keep two browsers seeding at once consistent
function seedItemMasters() {
  // build 35 stored attributes globally (no category): move them under categories with a sequence
  const legacy = Store.all('attributes').filter(a => !a.category);
  if (legacy.length) {
    const byName = {}; legacy.forEach(a => { byName[norm(a.name)] = a; });
    legacy.forEach(a => Store.del('attributes', a.id));
    icSeedDefaults();
    Store.all('item_types').forEach(t => (t.attrs || []).forEach(n => {
      if (catAttrs(t.category).some(a => norm(a.name) === norm(n))) return;
      const src = byName[norm(n)];
      Store.put('attributes', { id: uid(), category: t.category, name: n, seq: catAttrs(t.category).length + 1, values: src ? src.values : [] });
    }));
    return;
  }
  if (!Store.all('attributes').length && !Store.all('item_types').length) icSeedDefaults();
}
