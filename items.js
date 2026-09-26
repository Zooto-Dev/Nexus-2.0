/* Nexus 2.0 — Development › Item Creation.
   Item names are built from attributes so the same material can never be created twice.
   Attributes (name + allowed values) and Item Types (category + type + ordered attribute list)
   are data, managed on this screen — nothing here is hardcoded except the first-run defaults. */
'use strict';

function itemCats() {
  const s = new Set(ITEM_CATS);
  Store.all('item_types').forEach(t => { if (t.category) s.add(t.category); });
  return Array.from(s).sort();
}
function attrBy(name) { return Store.all('attributes').find(a => norm(a.name) === norm(name)); }
function typesOf(cat) { return Store.all('item_types').filter(t => norm(t.category) === norm(cat)).sort((a, b) => a.name.localeCompare(b.name)); }
function itemNameOf(type, vals) { return [type.name].concat(type.attrs.map(a => vals[a] || '').filter(Boolean)).join(' ').replace(/\s+/g, ' ').trim().toUpperCase(); }
function itemKeyOf(cat, typeName, vals) {
  return norm(cat) + '|' + norm(typeName) + '|' + Object.keys(vals).filter(k => vals[k]).map(k => norm(k) + '=' + norm(vals[k])).sort().join(',');
}
const squash = s => norm(s).replace(/[^a-z0-9.]/g, '');
// an item is a duplicate when the same category + type + attribute values exist, or the generated name
// matches an existing material name ignoring spaces/punctuation (catches items created by hand earlier)
function itemDuplicate(cat, type, vals) {
  const key = itemKeyOf(cat, type.name, vals); const nm = squash(itemNameOf(type, vals));
  return Store.all('materials').find(m => (m.attr_key && m.attr_key === key) || squash(m.name) === nm) || null;
}

const IC_UI = { tab: 'create', cat: '', type: '', vals: {}, editAttr: null, editType: null };
VIEWS.itemcreate = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    let h = subTitle('Item Creation') + '<div class="toolbar">' + seg('ictab', [{ v: 'create', l: 'Create Item' }, { v: 'types', l: 'Item Types' }, { v: 'attrs', l: 'Attributes' }], IC_UI.tab) + '</div>';
    if (IC_UI.tab === 'create') h += icCreateHtml(edit);
    else if (IC_UI.tab === 'types') h += icTypesHtml(edit);
    else h += icAttrsHtml(edit);
    setMain(h);
    onSeg(e => { IC_UI.tab = e.detail; IC_UI.editAttr = null; IC_UI.editType = null; VIEWS.itemcreate.render(); });
    const m = $('#main');
    m.addEventListener('change', e => {
      if (e.target.id === 'icCat') { IC_UI.cat = e.target.value; IC_UI.type = ''; IC_UI.vals = {}; VIEWS.itemcreate.render(); }
      if (e.target.id === 'icType') { IC_UI.type = e.target.value; IC_UI.vals = {}; VIEWS.itemcreate.render(); }
      if (e.target.dataset.icAttr) { IC_UI.vals[e.target.dataset.icAttr] = e.target.value; icPreview(); }
    });
    m.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]'); if (!chip) return;
      const inp = $('#itAttrs'); const cur = inp.value.split(',').map(x => x.trim()).filter(Boolean);
      if (!cur.some(x => norm(x) === norm(chip.dataset.chip))) cur.push(chip.dataset.chip);
      inp.value = cur.join(', '); inp.focus();
    });
    if (IC_UI.tab === 'create') icPreview();
  }
};

/* ---------- Create Item ---------- */
function icCreateHtml(edit) {
  const cats = itemCats().filter(c => typesOf(c).length);
  const types = IC_UI.cat ? typesOf(IC_UI.cat) : [];
  const type = types.find(t => t.id === IC_UI.type);
  let h = '<div class="card"><div class="card-h"><b>Create Item</b><span class="muted small">pick the attributes — the name is built automatically, duplicates are blocked</span></div><div class="card-b">' +
    '<div class="row"><label>Category *<select id="icCat"><option value="">Select…</option>' + cats.map(c => '<option' + (c === IC_UI.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></label>' +
    '<label>Item Type *<select id="icType"' + (types.length ? '' : ' disabled') + '><option value="">' + (IC_UI.cat && !types.length ? 'No types — add in Item Types' : 'Select…') + '</option>' + types.map(t => '<option value="' + esc(t.id) + '"' + (t.id === IC_UI.type ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label></div>';
  if (type) {
    h += '<div class="row" style="margin-top:12px">' + type.attrs.map(an => {
      const a = attrBy(an) || { values: [] };
      return '<label>' + esc(an) + ' *<select data-ic-attr="' + esc(an) + '"><option value="">Select…</option>' + (a.values || []).map(v => '<option' + (IC_UI.vals[an] === v ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>';
    }).join('') + '</div>' +
      '<div class="row" style="margin-top:12px"><label>UOM<select id="icUom">' + UOMS.map(u => '<option' + (u === (type.uom || 'PCS') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></label>' +
      '<label>Price ₹<input id="icPrice" type="number" min="0" step="any"></label><label>GST %<input id="icGst" type="number" min="0" step="any" value="' + esc(type.gst || '') + '"></label>' +
      '<label>HSN<input id="icHsn" value="' + esc(type.hsn || '') + '"></label><label>Rack No.<input id="icRack"></label><label>Min level<input id="icMin" type="number" min="0" step="any"></label></div>' +
      '<div class="icprev" id="icPrev"></div>';
  }
  h += '</div>' + (type ? '<div class="card-f"><button class="btn primary" id="icGo" data-act="ic-create"' + (edit ? '' : ' disabled') + '>Create Item</button><span id="icMsg" class="small"></span></div>' : '') + '</div>';
  // items already created in this category / type
  const list = Store.all('materials').filter(m => (!IC_UI.cat || norm(m.group) === norm(IC_UI.cat)) && (!type || norm(m.item_type || '') === norm(type.name)))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || a.code.localeCompare(b.code));
  h += '<h2>' + (type ? esc(type.name) + ' items' : IC_UI.cat ? esc(IC_UI.cat) + ' items' : 'All items') + ' <span class="muted">(' + list.length + ')</span></h2>' +
    '<div class="tbl-wrap"><table><tr><th>Item Code</th><th>Item Name</th><th>Category</th><th>Item Type</th><th>Attributes</th><th>UOM</th><th class="num">Price</th></tr>' +
    (list.length ? list.map(m => '<tr><td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td><td>' + esc(m.group || '') + '</td><td>' + esc(m.item_type || '') + '</td><td class="small muted">' +
      (m.attrs ? Object.keys(m.attrs).map(k => esc(k) + ': ' + esc(m.attrs[k])).join(' · ') : '—') + '</td><td>' + esc(m.uom || '') + '</td><td class="num">' + (m.price ? money(m.price) : '') + '</td></tr>').join('')
      : '<tr><td colspan="7" class="empty">No items yet</td></tr>') + '</table></div>';
  return h;
}
function icCurrent() {
  const type = Store.get('item_types', IC_UI.type); if (!type) return null;
  const vals = {}; type.attrs.forEach(a => { vals[a] = IC_UI.vals[a] || ''; });
  return { type, vals, missing: type.attrs.filter(a => !vals[a]) };
}
function icPreview() {
  const box = $('#icPrev'); if (!box) return;
  const c = icCurrent(); if (!c) return;
  const name = itemNameOf(c.type, c.vals);
  const dup = c.missing.length ? null : itemDuplicate(IC_UI.cat, c.type, c.vals);
  box.innerHTML = '<div class="icname"><span class="muted small">ITEM NAME</span><b>' + esc(name) + '</b></div>' +
    '<div class="muted small">Code: <b>' + esc(itemCodeAuto(IC_UI.cat)) + '</b></div>' +
    (c.missing.length ? '<div class="small" style="color:var(--pending)">Select: ' + esc(c.missing.join(', ')) + '</div>'
      : dup ? '<div class="st Late">Already exists: ' + esc(dup.code + ' · ' + dup.name) + '</div>'
        : '<div class="st Done">New item — ready to create</div>');
  const go = $('#icGo'); if (go) go.disabled = !!(c.missing.length || dup) || !can('development', 'edit');
}
ACTIONS['ic-create'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const c = icCurrent(); if (!c) return;
  if (c.missing.length) { $('#icMsg').innerHTML = '<span class="late-txt">Select ' + esc(c.missing.join(', ')) + '.</span>'; return; }
  const dup = itemDuplicate(IC_UI.cat, c.type, c.vals);
  if (dup) { $('#icMsg').innerHTML = '<span class="late-txt">Already exists as ' + esc(dup.code) + '.</span>'; return; }
  const m = Store.put('materials', {
    id: uid(), code: itemCodeAuto(IC_UI.cat), name: itemNameOf(c.type, c.vals), group: IC_UI.cat, item_type: c.type.name,
    attrs: c.vals, attr_key: itemKeyOf(IC_UI.cat, c.type.name, c.vals), uom: $('#icUom').value,
    price: num($('#icPrice').value) || 0, gst: num($('#icGst').value) || 0, hsn: $('#icHsn').value.trim(), rack: $('#icRack').value.trim().toUpperCase(),
    min_level: num($('#icMin').value) || 0, created_at: nowIso(), created_by: ME.name
  });
  audit('item.create', m.code, m.name);
  flash('Created ' + esc(m.code) + ' · ' + esc(m.name));
  IC_UI.vals = {}; VIEWS.itemcreate.render();
};

/* ---------- Item Types (category-wise, each with its own ordered attributes) ---------- */
function icTypesHtml(edit) {
  const ed = IC_UI.editType ? Store.get('item_types', IC_UI.editType) : null;
  let h = '';
  if (edit) {
    h += '<div class="card"><div class="card-h"><b>' + (ed ? 'Edit Item Type — ' + esc(ed.name) : 'Add Item Type') + '</b>' + (ed ? '<span class="grow"></span><a data-act="it-cancel">Cancel edit</a>' : '') + '</div><div class="card-b">' +
      '<datalist id="dlItCat">' + itemCats().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<div class="row"><label>Category *<input id="itCat" list="dlItCat" value="' + esc(ed ? ed.category : '') + '"></label>' +
      '<label>Item Type Name *<input id="itName" value="' + esc(ed ? ed.name : '') + '" placeholder="e.g. EVA SHEET"></label>' +
      '<label>Default UOM<select id="itUom">' + UOMS.map(u => '<option' + (ed && ed.uom === u ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></label>' +
      '<label>HSN<input id="itHsn" value="' + esc(ed ? ed.hsn || '' : '') + '"></label><label>GST %<input id="itGst" type="number" value="' + esc(ed ? ed.gst || '' : '') + '"></label></div>' +
      '<label style="margin-top:10px">Attributes (in the order they appear in the name) *<input id="itAttrs" value="' + esc(ed ? ed.attrs.join(', ') : '') + '" placeholder="click attributes below to add"></label>' +
      '<div class="chips">' + Store.all('attributes').slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => '<a class="chip" data-chip="' + esc(a.name) + '">+ ' + esc(a.name) + '</a>').join('') + '</div>' +
      '</div><div class="card-f"><button class="btn primary" data-act="it-save">' + (ed ? 'Update' : 'Add Item Type') + '</button><span id="itMsg" class="small"></span></div></div>';
  }
  const rows = Store.all('item_types').slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  h += '<div class="tbl-wrap"><table><tr><th>Category</th><th>Item Type</th><th>Name pattern</th><th>UOM</th><th class="num">Items</th>' + (edit ? '<th></th>' : '') + '</tr>' +
    (rows.length ? rows.map(t => {
      const n = Store.all('materials').filter(m => norm(m.item_type || '') === norm(t.name) && norm(m.group) === norm(t.category)).length;
      return '<tr><td>' + esc(t.category) + '</td><td><b>' + esc(t.name) + '</b></td><td class="small">' + esc(t.name) + ' ' + t.attrs.map(a => '<span class="chip sm">' + esc(a) + '</span>').join(' ') + '</td><td>' + esc(t.uom || '') + '</td><td class="num">' + (n || '—') + '</td>' +
        (edit ? '<td class="right nowrap"><button class="btn sm" data-act="it-edit" data-id="' + esc(t.id) + '">Edit</button> ' + (n ? '' : '<button class="btn sm ghost danger" data-act="it-del" data-id="' + esc(t.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No item types</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['it-edit'] = el => { IC_UI.editType = el.dataset.id; VIEWS.itemcreate.render(); };
ACTIONS['it-cancel'] = () => { IC_UI.editType = null; VIEWS.itemcreate.render(); };
ACTIONS['it-del'] = el => { if (!requirePerm('development', 'edit')) return; const t = Store.get('item_types', el.dataset.id); Store.del('item_types', t.id); audit('itemtype.delete', t.name, t.category); VIEWS.itemcreate.render(); };
ACTIONS['it-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const cat = $('#itCat').value.trim(); const name = $('#itName').value.trim().toUpperCase();
  const attrs = $('#itAttrs').value.split(',').map(x => x.trim()).filter(Boolean).map(x => (attrBy(x) || { name: x }).name);
  const bad = attrs.filter(a => !attrBy(a));
  if (!cat || !name || !attrs.length) { $('#itMsg').innerHTML = '<span class="late-txt">Category, name and at least one attribute are required.</span>'; return; }
  if (bad.length) { $('#itMsg').innerHTML = '<span class="late-txt">Unknown attribute: ' + esc(bad.join(', ')) + ' — add it in Attributes first.</span>'; return; }
  if (Store.all('item_types').some(t => t.id !== IC_UI.editType && norm(t.category) === norm(cat) && norm(t.name) === norm(name))) { $('#itMsg').innerHTML = '<span class="late-txt">This item type already exists in ' + esc(cat) + '.</span>'; return; }
  const d = IC_UI.editType ? Store.get('item_types', IC_UI.editType) : { id: uid() };
  Object.assign(d, { category: cat, name, attrs: Array.from(new Set(attrs)), uom: $('#itUom').value, hsn: $('#itHsn').value.trim(), gst: num($('#itGst').value) || 0 });
  Store.put('item_types', d); audit('itemtype.save', name, cat + ' · ' + attrs.join(', '));
  IC_UI.editType = null; flash('Item type saved: ' + esc(name)); VIEWS.itemcreate.render();
};

/* ---------- Attributes (name + allowed values) ---------- */
function icAttrsHtml(edit) {
  const ed = IC_UI.editAttr ? Store.get('attributes', IC_UI.editAttr) : null;
  let h = '';
  if (edit) {
    h += '<div class="card"><div class="card-h"><b>' + (ed ? 'Edit Attribute — ' + esc(ed.name) : 'Add Attribute') + '</b>' + (ed ? '<span class="grow"></span><a data-act="at-cancel">Cancel edit</a>' : '') + '</div><div class="card-b">' +
      '<div class="row"><label>Attribute Name *<input id="atName" value="' + esc(ed ? ed.name : '') + '" placeholder="e.g. COLOUR"></label></div>' +
      '<label style="margin-top:10px">Values * <span class="muted">(comma or new line separated)</span><textarea id="atVals" rows="4">' + esc(ed ? ed.values.join(', ') : '') + '</textarea></label>' +
      '</div><div class="card-f"><button class="btn primary" data-act="at-save">' + (ed ? 'Update' : 'Add Attribute') + '</button><span id="atMsg" class="small"></span></div></div>';
  }
  const rows = Store.all('attributes').slice().sort((a, b) => a.name.localeCompare(b.name));
  h += '<div class="tbl-wrap"><table><tr><th>Attribute</th><th class="num">Values</th><th>Allowed values</th><th>Used in item types</th>' + (edit ? '<th></th>' : '') + '</tr>' +
    (rows.length ? rows.map(a => {
      const used = Store.all('item_types').filter(t => t.attrs.some(x => norm(x) === norm(a.name)));
      return '<tr><td><b>' + esc(a.name) + '</b></td><td class="num">' + a.values.length + '</td><td class="small wrap">' + a.values.map(esc).join(', ') + '</td><td class="small wrap">' + (used.map(t => esc(t.name)).join(', ') || '—') + '</td>' +
        (edit ? '<td class="right nowrap"><button class="btn sm" data-act="at-edit" data-id="' + esc(a.id) + '">Edit</button> ' + (used.length ? '' : '<button class="btn sm ghost danger" data-act="at-del" data-id="' + esc(a.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
    }).join('') : '<tr><td colspan="5" class="empty">No attributes</td></tr>') + '</table></div>';
  return h;
}
ACTIONS['at-edit'] = el => { IC_UI.editAttr = el.dataset.id; VIEWS.itemcreate.render(); };
ACTIONS['at-cancel'] = () => { IC_UI.editAttr = null; VIEWS.itemcreate.render(); };
ACTIONS['at-del'] = el => { if (!requirePerm('development', 'edit')) return; const a = Store.get('attributes', el.dataset.id); Store.del('attributes', a.id); audit('attribute.delete', a.name, ''); VIEWS.itemcreate.render(); };
ACTIONS['at-save'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const name = $('#atName').value.trim().toUpperCase();
  const vals = Array.from(new Set($('#atVals').value.split(/[,\n]/).map(x => x.trim().toUpperCase()).filter(Boolean)));
  if (!name || !vals.length) { $('#atMsg').innerHTML = '<span class="late-txt">Name and at least one value are required.</span>'; return; }
  if (Store.all('attributes').some(a => a.id !== IC_UI.editAttr && norm(a.name) === norm(name))) { $('#atMsg').innerHTML = '<span class="late-txt">This attribute already exists.</span>'; return; }
  const d = IC_UI.editAttr ? Store.get('attributes', IC_UI.editAttr) : { id: uid() };
  const oldName = d.name;
  Object.assign(d, { name, values: vals });
  Store.put('attributes', d);
  if (oldName && norm(oldName) !== norm(name)) Store.all('item_types').forEach(t => { if (t.attrs.some(x => norm(x) === norm(oldName))) { t.attrs = t.attrs.map(x => norm(x) === norm(oldName) ? name : x); Store.put('item_types', t); } });
  audit('attribute.save', name, vals.length + ' values');
  IC_UI.editAttr = null; flash('Attribute saved: ' + esc(name)); VIEWS.itemcreate.render();
};

/* ---------- first-run footwear defaults (fixed ids, so two browsers seeding at once converge) ---------- */
function seedItemMasters() {
  if (Store.all('attributes').length || Store.all('item_types').length) return;
  const A = {
    'COLOUR': 'BLACK, WHITE, OFF WHITE, BEIGE, CREAM, TAN, BROWN, DARK BROWN, NAVY, BLUE, SKY BLUE, GREY, DARK GREY, RED, MAROON, PINK, PEACH, LILAC, PURPLE, YELLOW, MUSTARD, ORANGE, GREEN, OLIVE, KHAKI, SILVER, GOLD, NATURAL, TRANSPARENT, MULTI',
    'THICKNESS': '0.6MM, 0.8MM, 1.0MM, 1.2MM, 1.4MM, 1.6MM, 1.8MM, 2MM, 2.5MM, 3MM, 4MM, 5MM, 6MM, 8MM, 10MM, 12MM, 15MM, 20MM',
    'HARDNESS': '20 SHORE A, 25 SHORE A, 30 SHORE A, 35 SHORE A, 40 SHORE A, 45 SHORE A, 50 SHORE A, 55 SHORE A, 60 SHORE A, 65 SHORE A, 70 SHORE A',
    'SHEET SIZE': '1X1 MTR, 1X2 MTR, 1.1X1.5 MTR, 1.2X2.4 MTR, 1.4X1.4 MTR',
    'GSM': '100GSM, 120GSM, 150GSM, 180GSM, 200GSM, 250GSM, 300GSM, 350GSM, 400GSM',
    'WIDTH': '36 INCH, 44 INCH, 54 INCH, 58 INCH, 60 INCH, 64 INCH',
    'FINISH': 'MATT, GLOSSY, PATENT, NUBUCK, SUEDE, EMBOSSED, PRINTED, METALLIC, CRINKLE, NAPPA, MILLED',
    'MATERIAL': 'EVA, PU, PVC, TPR, TPU, RUBBER, PHYLON, LATEX, MEMORY FOAM, MICROFIBRE, NYLON, POLYESTER, COTTON, JUTE, CORK',
    'SIZE RUN': '1X5, 4X8, 5X9, 6X10, 7X11, 8X12, 10X13, 11X13, 1X4',
    'THREAD TKT': 'TKT 10, TKT 20, TKT 30, TKT 40, TKT 60, TKT 80',
    'TAPE WIDTH': '10MM, 12MM, 16MM, 20MM, 25MM, 32MM, 38MM, 50MM',
    'LACE LENGTH': '80CM, 90CM, 100CM, 110CM, 120CM, 140CM, 160CM',
    'LACE SHAPE': 'FLAT, ROUND, OVAL, WAXED ROUND',
    'EYELET SIZE': '3MM, 4MM, 5MM, 6MM, 8MM, 10MM',
    'BOX SIZE': 'NO.1, NO.2, NO.3, NO.4, NO.5, NO.6, KIDS',
    'PLY': '3 PLY, 5 PLY, 7 PLY',
    'PRINT': 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT',
    'BAG SIZE': '8X10, 10X14, 12X16, 14X18, 16X20',
    'LABEL SIZE': '38X25MM, 50X25MM, 50X38MM, 75X50MM, 100X50MM',
    'PACK SIZE': '1 LTR, 5 LTR, 15 LTR, 20 LTR, 1 KG, 5 KG, 25 KG'
  };
  Object.keys(A).forEach(n => Store.put('attributes', { id: 'attr_' + n.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: n, values: A[n].split(',').map(x => x.trim()) }));
  const T = [
    ['Compound', 'EVA SHEET', 'THICKNESS, HARDNESS, COLOUR, SHEET SIZE', 'SHEET', '3921'],
    ['Compound', 'PU COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3909'],
    ['Compound', 'TPR COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3902'],
    ['Compound', 'RUBBER COMPOUND', 'HARDNESS, COLOUR', 'KGS', '4005'],
    ['Compound', 'PVC COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3904'],
    ['Fabric', 'KNIT MESH', 'GSM, COLOUR, WIDTH', 'MTR', '6006'],
    ['Fabric', 'SANDWICH MESH', 'THICKNESS, COLOUR, WIDTH', 'MTR', '6005'],
    ['Fabric', 'LINING FABRIC', 'GSM, COLOUR, WIDTH', 'MTR', '5407'],
    ['Fabric', 'CANVAS', 'GSM, COLOUR, WIDTH', 'MTR', '5209'],
    ['Synthetic', 'PU SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'],
    ['Synthetic', 'PVC SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'],
    ['Synthetic', 'MICROFIBRE', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5603'],
    ['Leather', 'LEATHER', 'THICKNESS, FINISH, COLOUR', 'SQFT', '4107'],
    ['Sole', 'OUTSOLE', 'MATERIAL, SIZE RUN, COLOUR', 'PAIR', '6406'],
    ['Sole', 'MIDSOLE', 'MATERIAL, THICKNESS, SIZE RUN, COLOUR', 'PAIR', '6406'],
    ['Sole', 'INSOLE', 'MATERIAL, THICKNESS, SIZE RUN', 'PAIR', '6406'],
    ['Grinderies', 'THREAD', 'MATERIAL, THREAD TKT, COLOUR', 'ROLL', '5401'],
    ['Grinderies', 'SHOE LACE', 'LACE SHAPE, LACE LENGTH, COLOUR', 'PAIR', '6307'],
    ['Grinderies', 'EYELET', 'EYELET SIZE, FINISH, COLOUR', 'PCS', '8308'],
    ['Grinderies', 'VELCRO TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'],
    ['Grinderies', 'ELASTIC TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'],
    ['Grinderies', 'STRAP', 'MATERIAL, SIZE RUN, COLOUR, PRINT', 'PAIR', '3926'],
    ['Packaging', 'SHOE BOX', 'BOX SIZE, PLY, PRINT', 'PCS', '4819'],
    ['Packaging', 'CARTON', 'BOX SIZE, PLY', 'PCS', '4819'],
    ['Packaging', 'POLY BAG', 'BAG SIZE', 'PCS', '3923'],
    ['Packaging', 'TISSUE PAPER', 'COLOUR', 'PCS', '4803'],
    ['Packaging', 'BARCODE LABEL', 'LABEL SIZE', 'ROLL', '4821'],
    ['Consumable Item', 'ADHESIVE', 'MATERIAL, PACK SIZE', 'LTR', '3506'],
    ['Consumable Item', 'PRIMER', 'MATERIAL, PACK SIZE', 'LTR', '3208'],
    ['Consumable Item', 'HARDENER', 'PACK SIZE', 'LTR', '3208'],
    ['Silicon', 'SILICON LABEL', 'COLOUR, PRINT', 'PCS', '3926']
  ];
  T.forEach(r => Store.put('item_types', { id: 'it_' + (r[0] + '_' + r[1]).toLowerCase().replace(/[^a-z0-9]+/g, '_'), category: r[0], name: r[1], attrs: r[2].split(',').map(x => x.trim()), uom: r[3], hsn: r[4], gst: r[0] === 'Fabric' || r[0] === 'Packaging' ? 12 : 18 }));
}
