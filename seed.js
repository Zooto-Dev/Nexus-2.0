/* Nexus 2.0 — first-run data: default O2D flow, roles, users, masters, demo orders. */
'use strict';
const DEFAULT_O2D_SPEC = {
  process: { id: 'o2d', name: 'Order to Dispatch', instanceLabel: 'Order', keyField: 'order_no', startEvent: 'Order punched', endStep: 'dispatch' },
  fields: [
    { key: 'created_at', label: 'Time Stamp', type: 'datetime', source: 'system' },
    { key: 'order_no', label: 'Order No', type: 'text', source: 'system' },
    { key: 'order_date', label: 'Order Date', type: 'date', source: 'form' },
    { key: 'brand', label: 'Brand', type: 'text', source: 'form' },
    { key: 'category', label: 'Category', type: 'select', options: ['Shoes', 'Slider', 'Clogs', 'V Shape', 'Eva Slider'], source: 'form' },
    { key: 'channel', label: 'Channel', type: 'select', options: ['Online', 'Offline', 'Export'], source: 'form' },
    { key: 'priority', label: 'Priority', type: 'select', options: ['', 'Urgent', 'On Hold', 'Cancelled'], source: 'form' },
    { key: 'po_expiry_date', label: 'PO Expiry Date', type: 'date', source: 'form' },
    { key: 'qty', label: 'Total Qty', type: 'number', source: 'system' }
  ],
  priority: { field: 'priority', urgent: ['Urgent'], hold: ['On Hold'], cancel: ['Cancelled'] },
  doerTables: {},
  steps: [
    { id: 'order_verify', name: 'Order Verification', what: 'PO, qty, size, article aur expiry date check karo', doer: { type: 'fixed', name: 'MERCHANT' }, trigger: { type: 'instanceStart' }, tat: { value: 2, unit: 'hours' } },
    { id: 'planning', name: 'Production Planning', doer: { type: 'fixed', name: 'PRODUCTION' }, trigger: { type: 'afterStep', step: 'order_verify' }, tat: { value: 1, urgent: 0.5, unit: 'days' } },
    { id: 'material', name: 'Material Arrangement', what: 'BOM ke hisaab se material issue / purchase', doer: { type: 'fixed', name: 'STORE' }, trigger: { type: 'afterStep', step: 'planning' }, tat: { value: 2, urgent: 1, unit: 'days' } },
    { id: 'production', name: 'Production', doer: { type: 'fixed', name: 'PRODUCTION' }, trigger: { type: 'afterStep', step: 'material' }, tat: { value: 3, urgent: 2, unit: 'days' } },
    { id: 'qc', name: 'Quality Check', doer: { type: 'fixed', name: 'QC' }, trigger: { type: 'afterStep', step: 'production' }, tat: { value: 4, unit: 'hours' } },
    { id: 'labels', name: 'Labels & Barcode Ready', what: 'PO expiry se 3 din pehle ready', doer: { type: 'fixed', name: 'MERCHANT' }, trigger: { type: 'beforeDate', field: 'po_expiry_date' }, tat: { value: 3, unit: 'days' } },
    { id: 'packing', name: 'Packing', what: 'Assortment / solid packing as per order', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'qc' }, tat: { value: 4, unit: 'hours' } },
    { id: 'invoice', name: 'Invoice', doer: { type: 'fixed', name: 'ACCOUNTS' }, trigger: { type: 'afterStep', step: 'packing' }, tat: { value: 2, unit: 'hours' } },
    { id: 'dispatch', name: 'Dispatch', what: 'Dispatch screen se entry karo — poori qty jaane par step apne aap Done', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'invoice' }, tat: { value: 4, unit: 'hours' }, status: { type: 'auto', source: 'Dispatch module', rule: 'Done when full order qty is dispatched' } }
  ]
};

const ALL_EDIT = () => Object.fromEntries(MODULES.map(m => [m.key, 'edit']));
function rolePerms(edit, view) { const p = {}; MODULES.forEach(m => p[m.key] = 'none'); view.forEach(k => p[k] = 'view'); edit.forEach(k => p[k] = 'edit'); return p; }
const WORK_VIEW = ['dashboard', 'orders', 'tracker', 'dispatch'];

function fyTag() { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); }
function seedData(cloud) {
  const now = new Date();
  const base = {
    settings: {
      id: 'main', company: 'My Company', gstin: '', address: '',
      calendar: { open: '09:30', close: '18:30', lunchStart: '13:30', lunchEnd: '14:00', weeklyOff: [0], halfDays: 'exact' },
      holidays: [{ date: now.getFullYear() + '-10-02', name: 'Gandhi Jayanti' }]
    },
    roles: [
      { id: 'r_admin', name: 'Super Admin', system: true, perms: ALL_EDIT() },
      { id: 'r_manager', name: 'Manager', perms: rolePerms(['tasks', 'orders', 'purchase', 'merchant', 'store', 'development', 'production', 'accounts', 'dispatch', 'tickets', 'checklist', 'tracker', 'masters'], ['dashboard', 'builder', 'users', 'audit']) },
      { id: 'r_purchase', name: 'Purchase', perms: rolePerms(['tasks', 'purchase', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'masters'])) },
      { id: 'r_merchant', name: 'Merchant', perms: rolePerms(['tasks', 'orders', 'merchant', 'masters', 'tickets', 'checklist'], WORK_VIEW.concat(['development'])) },
      { id: 'r_store', name: 'Store', perms: rolePerms(['tasks', 'store', 'tickets', 'checklist'], WORK_VIEW.concat(['purchase', 'production', 'masters'])) },
      { id: 'r_dev', name: 'Development', perms: rolePerms(['tasks', 'development', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'masters'])) },
      { id: 'r_production', name: 'Production', perms: rolePerms(['tasks', 'production', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'development'])) },
      { id: 'r_accounts', name: 'Accounts', perms: rolePerms(['tasks', 'accounts', 'tickets', 'checklist'], WORK_VIEW.concat(['masters'])) },
      { id: 'r_qc', name: 'QC', perms: rolePerms(['tasks', 'tickets', 'checklist'], WORK_VIEW) },
      { id: 'r_dispatch', name: 'Dispatch', perms: rolePerms(['tasks', 'dispatch', 'tickets', 'checklist'], ['dashboard', 'orders', 'tracker', 'accounts']) },
      { id: 'r_viewer', name: 'Viewer', perms: rolePerms([], WORK_VIEW.concat(['tickets', 'checklist'])) }
    ],
    users: [], customers: [], items: [], materials: [], vendors: [], rsjw: [], processes: [], orders: [], dispatches: [], purchase_orders: [], sourcing: [], grns: [], inwards: [], issues: [], rtvs: [], boms: [], job_cards: [], requisitions: [], tickets: [], checklist: [], audit: []
  };
  const U = (name, email, role_id, doer) => ({ id: 'u_' + doer.toLowerCase(), name, email, role_id, doer, active: true, pin_seed: '1234', seed: !!cloud });
  base.users = cloud ? [U('Super Admin', 'admin@nexus.local', 'r_admin', 'ADMIN')] : [
    U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN'),
    U('Pankaj (Manager)', 'ops@nexus.local', 'r_manager', 'OPS'),
    U('Ashish (Purchase)', 'purchase@nexus.local', 'r_purchase', 'PURCHASE'),
    U('Pooja (Merchant)', 'merchant@nexus.local', 'r_merchant', 'MERCHANT'),
    U('Suresh (Store)', 'store@nexus.local', 'r_store', 'STORE'),
    U('Manoj (Development)', 'development@nexus.local', 'r_dev', 'DEVELOPMENT'),
    U('Vikas (Production)', 'production@nexus.local', 'r_production', 'PRODUCTION'),
    U('Neha (Accounts)', 'accounts@nexus.local', 'r_accounts', 'ACCOUNTS'),
    U('Kavita (QC)', 'qc@nexus.local', 'r_qc', 'QC'),
    U('Pintu (Dispatch)', 'dispatch@nexus.local', 'r_dispatch', 'DISPATCH')
  ];
  base.processes = [{ id: 'p_o2d_1', code: 'o2d', version: 1, name: DEFAULT_O2D_SPEC.process.name, spec: clone(DEFAULT_O2D_SPEC), active: true, created_at: now.toISOString(), created_by: 'system', note: 'Default flow' }];
  if (cloud) return base;

  base.customers = [
    { id: 'c1', code: 'B001', name: 'Max', merchandiser: 'POOJA', phone: '9820000001' },
    { id: 'c2', code: 'B002', name: 'Kappa', merchandiser: 'POOJA', phone: '9810000002' },
    { id: 'c3', code: 'B003', name: 'Pepe Jeans', merchandiser: 'TANUJ', phone: '9829000003' },
    { id: 'c4', code: 'B004', name: 'Campus', merchandiser: 'RASHMI', phone: '9839000004' },
    { id: 'c5', code: 'B005', name: 'Gas', merchandiser: 'RASHMI', phone: '9890000005' }
  ];
  base.items = [
    ['ZT-101', 'Ranger Runner', 'Shoes', 'Gents'], ['ZT-102', 'City Walk', 'Shoes', 'Ladies'],
    ['ZT-201', 'Cloud Slide', 'Slider', 'Gents'], ['ZT-202', 'Bliss Slide', 'Slider', 'Ladies'],
    ['ZT-301', 'Bubble Clog', 'Clogs', 'Kids'], ['ZT-302', 'Garden Clog', 'Clogs', 'Unisex'],
    ['ZT-401', 'Wave V', 'V Shape', 'Gents'], ['ZT-501', 'Feather Eva', 'Eva Slider', 'Ladies']
  ].map((r, i) => ({ id: 'i' + (i + 1), code: r[0], name: r[1], group: r[2], gender: r[3] }));

  // Demo orders at different stages, built with the real engine so planned/actual are consistent.
  DB = base;
  const hoursAgo = h => new Date(now.getTime() - h * 3600000);
  const L = (art, colour, size, qty, pack, pq) => { const it = base.items.find(i => i.code === art); return { article: art, style: it.name, colour, gender: it.gender, size, qty, pack, pack_qty: pq }; };
  const plan = [
    { c: 'c1', cat: 'Shoes', ch: 'Offline', ago: 190, done: 5, lines: [L('ZT-101', 'Black', '6X10', 600, 'Assortment', 50), L('ZT-102', 'White', '4X8', 400, 'Assortment', 40)], dd: 8 },
    { c: 'c2', cat: 'Slider', ch: 'Online', ago: 30, done: 4, lines: [L('ZT-201', 'Navy', '6X10', 300, 'Solid', 300)], dd: 4, dispatched: true },
    { c: 'c3', cat: 'Shoes', ch: 'Export', ago: 96, done: 2, lines: [L('ZT-101', 'Grey', '7X11', 250, 'Assortment', 25), L('ZT-501', 'Pink', '4X8', 500, 'Solid', 500)], dd: 12, late: 1 },
    { c: 'c4', cat: 'Clogs', ch: 'Online', ago: 20, done: 1, lines: [L('ZT-301', 'Blue', '10X13', 200, 'Assortment', 20), L('ZT-302', 'Yellow', '6X9', 200, 'Assortment', 20)], dd: 6 },
    { c: 'c5', cat: 'Slider', ch: 'Offline', ago: 50, done: 1, lines: [L('ZT-202', 'Black', '4X8', 800, 'Solid', 800)], dd: 15, pri: 'Urgent' },
    { c: 'c1', cat: 'Shoes', ch: 'Online', ago: 3, done: 0, lines: [L('ZT-102', 'Beige', '4X8', 120, 'Solid', 120)], dd: 10 },
    { c: 'c3', cat: 'Eva Slider', ch: 'Online', ago: 40, done: 4, lines: [L('ZT-501', 'Lilac', '4X8', 1000, 'Assortment', 100)], dd: 5 }
  ];
  plan.forEach((p, n) => {
    const cu = base.customers.find(c => c.id === p.c);
    const created = hoursAgo(p.ago);
    const o = {
      id: 'o' + (n + 1), no: 'ORD-' + now.getFullYear() + '-' + String(n + 1).padStart(4, '0'), order_date: ymdOf(created),
      customer_id: cu.id, customer_name: cu.name, brand: cu.name, buyer_po: 'PO/' + (4400 + n), tooling_no: 'TM-' + (110 + n),
      po_expiry_date: ymdOf(new Date(now.getTime() + p.dd * 86400000)), channel: p.ch, category: p.cat,
      priority: p.pri || '', remarks: '', lines: p.lines,
      process_id: 'p_o2d_1', actuals: {}, done_by: {}, created_at: created.toISOString(), created_by: 'Rahul (Sales)', updated_at: created.toISOString()
    };
    DB.orders.push(o);
    for (let k = 0; k < p.done; k++) {
      o.updated_at = uid(); RES_CACHE.clear();
      const r = resolveOrder(o);
      const next = r.order.map(id => r.steps[id]).filter(s => (s.status === 'Pending' || s.status === 'Late') && s.id !== 'dispatch' && s.id !== 'labels').sort((a, b) => a.planned - b.planned)[0];
      if (!next) break;
      let at = new Date(next.planned.getTime() + (p.late && k === p.done - 1 ? 26 : ((n + k) % 3)) * 3600000 * 0.4);
      at = calInfo().normalize(at);
      if (at > now) at = new Date(now.getTime() - 20 * 60000);
      o.actuals[next.id] = at.toISOString(); o.done_by[next.id] = 'seed';
    }
    if (p.dispatched) {
      ['packing', 'invoice'].forEach((id, j) => { if (!o.actuals[id]) o.actuals[id] = hoursAgo(4 - j).toISOString(); });
      o.actuals.dispatch = hoursAgo(1).toISOString();
      DB.dispatches.push({ id: 'd1', no: 'DSP-' + now.getFullYear() + '-0001', order_id: o.id, date: todayYmd(), lines: o.lines.map((l, idx) => ({ idx, qty: l.qty })), invoice_no: 'INV/1021', vehicle: 'DL01AB1234', transporter: 'VRL Logistics', lr_no: 'LR5521', by: 'Pintu (Dispatch)', at: hoursAgo(1).toISOString() });
    }
    o.updated_at = created.toISOString();
  });
  // --- department demo data ---
  base.materials = [
    ['EVA-10', 'EVA Sheet 10mm', 'Compound', 'SHEET'], ['EVA-06', 'EVA Sheet 6mm', 'Compound', 'SHEET'],
    ['STRAP-P', 'PVC Strap Printed', 'Grinderies', 'PAIR'], ['SOLE-TPR', 'TPR Outsole', 'Sole', 'PAIR'],
    ['BOX-K3', 'Kraft Box No.3', 'Packaging', 'PCS'], ['LBL-BAR', 'Barcode Label Roll', 'Packaging', 'ROLL']
  ].map((r, i) => ({ id: 'm' + (i + 1), code: r[0], name: r[1], group: r[2], uom: r[3], min_level: [20, 20, 200, 300, 100, 5][i], rack: ['R1', 'R1', 'R2', 'R3', 'R4', 'R4'][i], price: [420, 310, 22, 38, 12, 180][i], gst: [18, 18, 12, 18, 12, 18][i], hsn: ['3921', '3921', '3926', '6406', '4819', '4821'][i] }));
  base.vendors = [
    { id: 'v1', name: 'Shree Polymers', gstin: '08AABCS1111A1Z5', address: 'Jaipur, RJ', mobile: '9829011111', email: 'sales@shreepolymers.in' },
    { id: 'v2', name: 'Jain Traders', gstin: '08AAFPJ2222B1Z2', address: 'Jaipur, RJ', mobile: '9829022222', email: 'jaintraders@gmail.com' },
    { id: 'v3', name: 'Balaji Soles', gstin: '09AACCB3333C1Z8', address: 'Agra, UP', mobile: '9839033333', email: 'balajisoles@gmail.com' }
  ];
  base.sourcing = [
    { id: 'src1', material: 'EVA-10', vendor: 'Shree Polymers', rate: 420, moq: 50, lead_days: 7, remark: '' },
    { id: 'src2', material: 'EVA-10', vendor: 'Jain Traders', rate: 445, moq: 20, lead_days: 4, remark: 'costly, fast' },
    { id: 'src3', material: 'SOLE-TPR', vendor: 'Balaji Soles', rate: 38, moq: 500, lead_days: 10, remark: '' }
  ];
  base.purchase_orders = [
    { id: 'po1', no: 'ZF/PO/FY/001'.replace('FY', fyTag()), approval: 'Approved', approved_by: 'Pankaj (Manager)', date: ymdOf(hoursAgo(120)), vendor: 'Shree Polymers', expected: ymdOf(new Date(now.getTime() - 86400000)), remarks: '', created_by: 'Ashish (Purchase)', at: hoursAgo(120).toISOString(),
      lines: [{ material: 'EVA-10', uom: 'SHEET', qty: 31, rate: 420, received: 25, rejected: 1, jc_no: 'ZF-0001' }], followups: [{ at: ymdOf(hoursAgo(24)), by: 'Ashish (Purchase)', note: 'Vendor bola kal tak bhej dega', next: todayYmd() }] },
    { id: 'po2', no: 'ZF/PO/FY/002'.replace('FY', fyTag()), approval: 'Approved', approved_by: 'Pankaj (Manager)', date: ymdOf(hoursAgo(48)), vendor: 'Balaji Soles', expected: ymdOf(new Date(now.getTime() + 5 * 86400000)), remarks: '', created_by: 'Ashish (Purchase)', at: hoursAgo(48).toISOString(),
      lines: [{ material: 'SOLE-TPR', uom: 'PAIR', qty: 1000, rate: 38, received: 0, rejected: 0 }, { material: 'BOX-K3', uom: 'PCS', qty: 500, rate: 12, received: 0, rejected: 0 }], followups: [] }
  ];
  base.grns = [{ id: 'g1', no: 'ZF/GRN/FY/0001'.replace('FY', fyTag()), inv_qty: 120, date: ymdOf(hoursAgo(30)), po_id: 'po1', po_no: base.purchase_orders[0].no, vendor: 'Shree Polymers', invoice: 'SP/221', lines: [{ material: 'EVA-10', inv_qty: 26, accepted: 25, rejected: 1, short: 0, excess: 0 }], by: 'Suresh (Store)' }];
  base.inwards = [{ id: 'in1', no: 'INW-' + now.getFullYear() + '-0001', date: ymdOf(hoursAgo(30)), vendor: 'Shree Polymers', po_no: base.purchase_orders[0].no, material: 'EVA-10', uom: 'SHEET', qty: 26, remark: '', swatch_match: '', by: 'Suresh (Store)' }];
  base.issues = [{ id: 'is1', no: 'ISS-' + now.getFullYear() + '-0001', date: todayYmd(), material: 'EVA-10', qty: 10, source: 'AUTO', to_jc: 'ZF-0001', to_dept: 'Production', status: 'Approved', by: 'Suresh (Store)', approved_by: 'Pankaj (Manager)', at: hoursAgo(5).toISOString() }];
  base.rsjw = [{ id: 'rs1', jc_no: 'ZF-0001', material: 'EVA-10', qty: 5, by: 'Suresh (Store)', at: hoursAgo(4).toISOString() }];
  base.boms = [{ id: 'b1', brand: 'Max', article: 'ZT-101', style: 'Ranger Runner', colour: '', version: 1, lines: [{ material: 'EVA-10', uom: 'SHEET', qty: 0.05, supplier: 'Shree Polymers' }, { material: 'SOLE-TPR', uom: 'PAIR', qty: 1, supplier: 'Balaji Soles' }, { material: 'BOX-K3', uom: 'PCS', qty: 0.5, supplier: 'Jain Traders' }], status: 'Final', by: 'Manoj (Development)', at: hoursAgo(80).toISOString() },
    { id: 'b2', brand: 'Gas', article: 'ZT-201', style: 'Cloud Slide', colour: '', version: 1, lines: [{ material: 'EVA-06', uom: 'SHEET', qty: 0.04, supplier: 'Shree Polymers' }, { material: 'STRAP-P', uom: 'PAIR', qty: 1, supplier: 'Jain Traders' }], status: 'Final', by: 'Manoj (Development)', at: hoursAgo(60).toISOString() }];
  const jcL = (art, qty) => { const b = base.boms.find(x => x.article === art); return b.lines.map(l => ({ material: l.material, uom: l.uom, norms: l.qty, supplier: l.supplier, required: Math.ceil(l.qty * qty * 1.02 * 1000) / 1000, po_raised: 0 })); };
  base.job_cards = [
    { id: 'jc1', no: 'ZF-0001', order_no: 'ORD-' + now.getFullYear() + '-0001', brand: 'Max', article: 'ZT-101', colour: 'Black', qty: 600, lines: jcL('ZT-101', 600), swatch_status: 'Approved', swatch_note: '', status: 'Open', corrections: [], by: 'Pooja (Merchant)', at: hoursAgo(100).toISOString() },
    { id: 'jc2', no: 'ZF-0002', order_no: 'ORD-' + now.getFullYear() + '-0004', brand: 'Campus', article: 'ZT-301', colour: 'Blue', qty: 200, swatch_status: 'Pending', status: 'Open', corrections: [{ at: hoursAgo(6).toISOString(), by: 'Vikas (Production)', note: 'Colour shade dark chahiye', resolved: false }], by: 'Pooja (Merchant)', at: hoursAgo(18).toISOString() }
  ];
  base.job_cards[0].lines[0].po_raised = 31; // approved PO-001 ka EVA-10
  base.requisitions = [{ id: 'rq1', no: 'REQ-0001', date: todayYmd(), jc_no: base.job_cards[0].no, dept: 'Production', lines: [{ material: 'SOLE-TPR', qty: 300 }], status: 'Pending', by: 'Vikas (Production)' }];
  base.tickets = [
    { id: 't1', no: 'TKT-' + now.getFullYear() + '-0001', at: hoursAgo(60).toISOString(), by: 'Vikas (Production)', dept: 'Store', priority: 'Critical', subject: 'EVA sheet shortage line 2 par', detail: 'Production ruk jayega agar aaj issue nahi hua', status: 'Open', comments: [{ at: hoursAgo(3).toISOString(), by: 'Suresh (Store)', note: 'GRN ho gaya, aaj issue karenge' }] },
    { id: 't2', no: 'TKT-' + now.getFullYear() + '-0002', at: hoursAgo(8).toISOString(), by: 'Pooja (Merchant)', dept: 'IT', priority: 'Normal', subject: 'Printer chal nahi raha', detail: '', status: 'In Progress', comments: [] }
  ];
  base.checklist = [
    { id: 'ck1', title: 'Stock register update karo', doer: 'STORE', freq: 'Daily', done: {}, active: true, by: 'Admin' },
    { id: 'ck2', title: 'Pending PO followup calls', doer: 'PURCHASE', freq: 'Daily', done: {}, active: true, by: 'Admin' },
    { id: 'ck3', title: 'Weekly production plan review', doer: 'PRODUCTION', freq: 'Weekly', wday: 1, done: {}, active: true, by: 'Admin' }
  ];
  RES_CACHE.clear();
  base.audit.push({ id: uid(), at: now.toISOString(), user: 'system', action: 'seed', ref: '', detail: 'Demo data loaded' });
  return base;
}
