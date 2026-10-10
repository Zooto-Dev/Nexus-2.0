/* Nexus 2.0 — Requirements: items to buy that no job card needs (consumables, maintenance, stock …).
   Anyone with Purchase or Store edit raises one; Purchase picks the vendor; it then counts in the Net Requirement
   and shows up in that vendor's PO. It closes by itself when the PO line for it is fully received. */
'use strict';

const PRQ_PURPOSE = ['Consumable', 'Maintenance', 'Packing', 'Sample', 'Stock', 'Office', 'Other'];
const PRQ_UI = { f: 'open', form: false };
function canRaiseReq() { return can('purchase', 'edit') || can('store', 'edit'); }

// status: Open (no vendor yet) → Vendor Assigned → PO Raised → Received; or Cancelled
function reqPo(r) {
  const p = r.po_id ? Store.get('purchase_orders', r.po_id) : null;
  return p && !p.cancelled && p.approval !== 'Rejected' ? p : null;
}
function reqStatus(r) {
  if (r.cancelled) return 'Cancelled';
  const p = reqPo(r);
  if (p) {
    const ls = (p.lines || []).filter(l => norm(l.material) === norm(r.material));
    return ls.length && ls.every(l => num(l.received) >= num(l.qty) - 1e-9) ? 'Received' : 'PO Raised';
  }
  return r.vendor ? 'Vendor Assigned' : 'Open';
}
function reqActive(r) { const s = reqStatus(r); return s !== 'Received' && s !== 'Cancelled'; }
function activeReqs() { return Store.all('requirements').filter(reqActive); }

// after a PO is saved: link the active requirements of that vendor for the items on it
function reqLinkPo(po) {
  const mats = new Set((po.lines || []).map(l => norm(l.material)));
  Store.all('requirements').filter(r => reqActive(r) && !reqPo(r) && r.vendor && norm(r.vendor) === norm(po.vendor) && mats.has(norm(r.material))).forEach(r => {
    r.po_id = po.id; r.po_no = po.no; Store.put('requirements', r); audit('requirement.po', r.no, po.no);
  });
}

VIEWS.requirements = {
  mod: 'purchase', render() {
    const edit = canRaiseReq(), pur = can('purchase', 'edit');
    const all = Store.all('requirements').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
    const cnt = f => all.filter(r => reqFilter(r, f)).length;
    const rows = all.filter(r => reqFilter(r, PRQ_UI.f));
    let h = '<div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open (' + cnt('open') + ')' }, { v: 'po', l: 'PO Raised (' + cnt('po') + ')' }, { v: 'done', l: 'Received' }, { v: 'cancel', l: 'Cancelled' }, { v: 'all', l: 'All' }], PRQ_UI.f) +
      '<span class="grow"></span>' + (edit ? '<button class="btn primary" data-act="prq-new">+ Create Requirement</button>' : '') + '</div>';
    if (PRQ_UI.form && edit) h += reqForm();
    h += '<div class="tbl-wrap"><table><tr><th>Req No</th><th>Date</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th class="num">Qty</th><th>Brand</th><th>Purpose</th><th>Required By</th><th>Remark</th><th>Raised By</th><th>Vendor</th><th>PO No</th><th>Status</th><th></th></tr>' +
      (rows.length ? rows.map(r => {
        const st = reqStatus(r), m = matBy(r.material) || {};
        const venCell = pur && (st === 'Open' || st === 'Vendor Assigned') ? '<select data-req-ven="' + esc(r.id) + '"><option value="">— select —</option>' + vendorNames().map(n => '<option' + (norm(n) === norm(r.vendor || '') ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : esc(r.vendor || '');
        const mine = r.by_id ? r.by_id === ME.id : r.by === ME.name;
        return '<tr><td><b>' + esc(r.no) + '</b></td><td class="nowrap">' + fmtD(r.at) + '</td><td>' + esc(r.material) + '</td><td>' + esc(m.name || '') + '</td><td>' + esc(m.uom || r.uom || '') + '</td><td class="num">' + qtyFmt(r.qty) + '</td><td>' + esc(r.brand || '') + '</td><td>' + esc(r.purpose || '') + '</td>' +
          '<td class="nowrap' + (reqActive(r) && r.need_by && r.need_by < todayYmd() ? ' late-txt' : '') + '">' + fmtD(r.need_by) + '</td><td>' + esc(r.remark || '') + '</td><td>' + esc(r.by || '') + '</td><td style="min-width:170px">' + venCell + '</td><td>' + esc(r.po_no && reqPo(r) ? r.po_no : '') + '</td><td>' + stHtml(st) + '</td>' +
          '<td class="right nowrap">' + ((st === 'Open' || st === 'Vendor Assigned') && (pur || mine) ? '<button class="btn ghost sm danger" data-act="prq-cancel" data-id="' + esc(r.id) + '" data-confirm="Cancel ' + esc(r.no) + '?">Cancel</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="15" class="empty">No requirements</td></tr>') + '</table></div>';
    const m = setMain(h);
    onSeg(e => { PRQ_UI.f = e.detail; VIEWS.requirements.render(); });
    m.addEventListener('change', e => {
      const id = e.target.dataset.reqVen; if (!id) return;
      if (!requirePerm('purchase', 'edit')) return;
      const r = Store.get('requirements', id); const old = r.vendor || '';
      r.vendor = e.target.value; r.vendor_by = ME.name; r.vendor_at = nowIso(); Store.put('requirements', r);
      audit('requirement.vendor', r.no, (old || '—') + ' → ' + (r.vendor || '—'));
      flash(esc(r.no) + (r.vendor ? ': vendor ' + esc(r.vendor) + ' — now in the Net Requirement for this vendor.' : ': vendor removed.')); VIEWS.requirements.render();
    });
    if (PRQ_UI.form && edit) reqFormSetup();
  }
};
function reqFilter(r, f) {
  const s = reqStatus(r);
  switch (f) {
    case 'open': return s === 'Open' || s === 'Vendor Assigned';
    case 'po': return s === 'PO Raised';
    case 'done': return s === 'Received';
    case 'cancel': return s === 'Cancelled';
    default: return true;
  }
}
function reqForm() {
  const brands = Store.all('customers').map(c => c.name).sort();
  return '<div class="card"><div class="card-h"><b>Create Requirement</b></div><div class="card-b">' + dlMat('dlMatReq') +
    '<div class="row"><label>Item *<input id="rqMat" list="dlMatReq" autocomplete="off"></label><label>Item Code<input id="rqCode" readonly></label><label>UOM<input id="rqUom" readonly></label>' +
    '<label>Qty *<input id="rqQty" type="number" min="0" step="any" class="right"></label><label>Brand *<select id="rqBrand">' + selOpts(brands, '') + '</select></label>' +
    '<label>Purpose *<select id="rqPur">' + selOpts(PRQ_PURPOSE, '') + '</select></label><label>Required By *<input id="rqBy" type="date" min="' + todayYmd() + '"></label>' +
    (can('purchase', 'edit') ? '<label>Vendor<select id="rqVen">' + selOpts(vendorNames(), '', '— Purchase decides —') + '</select></label>' : '') +
    '<label style="grid-column:span 2">Remark<input id="rqRem" maxlength="200"></label></div>' +
    '<div id="rqStock" class="small muted" style="margin-top:8px"></div></div>' +
    '<div class="card-f"><button class="btn primary" data-act="prq-save">Save</button><button class="btn" data-act="prq-new">Close</button><span id="rqMsg" class="small"></span></div></div>';
}
function reqFormSetup() {
  const fill = () => {
    const m = matBy($('#rqMat').value);
    $('#rqCode').value = m ? m.code : ''; $('#rqUom').value = m ? m.uom || '' : '';
    if (!m) { $('#rqStock').textContent = ''; return; }
    const nr = netReqRows().find(r => norm(r.material) === norm(m.code));
    $('#rqStock').innerHTML = 'Stock <b>' + qtyFmt(Math.max(0, stockOf(m.code))) + '</b> · Open PO <b>' + qtyFmt(nr ? nr.openPo : 0) + '</b> · Already required <b>' + qtyFmt(nr ? nr.demand : 0) + '</b>';
  };
  $('#rqMat').addEventListener('input', fill); $('#rqMat').addEventListener('change', fill); $('#rqMat').focus();
}
ACTIONS['prq-new'] = () => { PRQ_UI.form = !PRQ_UI.form; if (curView().v !== 'requirements') go('requirements'); else VIEWS.requirements.render(); };
ACTIONS['prq-save'] = el => {
  if (!canRaiseReq()) { flash('You do not have access to raise a requirement.', 'err'); return; }
  const m = matBy($('#rqMat').value), qty = num($('#rqQty').value), brand = $('#rqBrand').value, purpose = $('#rqPur').value, need = $('#rqBy').value;
  const msg = t => { $('#rqMsg').innerHTML = '<span class="late-txt">' + esc(t) + '</span>'; };
  if (!m) return msg('Select an item from the list (Item master).');
  if (!(qty > 0)) return msg('Qty must be more than 0.');
  if (!brand) return msg('Select the Brand.');
  if (!purpose) return msg('Select the Purpose.');
  if (!need) return msg('Select the Required By date.');
  if (need < todayYmd()) return msg('Required By date cannot be in the past.');
  const ven = ($('#rqVen') || { value: '' }).value;
  el.disabled = true;
  const r = Store.put('requirements', { id: uid(), no: fyNo('requirements', 'REQ', 3), material: m.code, uom: m.uom || '', qty, brand, purpose, need_by: need, remark: $('#rqRem').value.trim(), vendor: ven, vendor_by: ven ? ME.name : '', vendor_at: ven ? nowIso() : '', by: ME.name, by_id: ME.id, at: nowIso() });
  audit('requirement.create', r.no, m.code + ' · ' + qtyFmt(qty) + ' ' + (m.uom || '') + ' · ' + purpose + (ven ? ' · ' + ven : ''));
  PRQ_UI.form = false; PRQ_UI.f = 'open'; flash(esc(r.no) + ' created.' + (ven ? '' : ' Purchase will select the vendor.')); VIEWS.requirements.render();
};
ACTIONS['prq-cancel'] = el => {
  const r = Store.get('requirements', el.dataset.id); if (!r) return;
  const mine = r.by_id ? r.by_id === ME.id : r.by === ME.name;
  if (!can('purchase', 'edit') && !mine) { flash('Only Purchase or the person who raised it can cancel.', 'err'); return; }
  if (reqPo(r)) { flash('A PO is already raised for ' + esc(r.no) + '.', 'err'); return; }
  r.cancelled = true; r.cancelled_by = ME.name; r.cancelled_at = nowIso(); Store.put('requirements', r); audit('requirement.cancel', r.no, '');
  flash(esc(r.no) + ' cancelled.'); VIEWS.requirements.render();
};
