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
    { id: 'order_verify', name: 'Order Verification', what: 'PO, qty, size, article aur expiry date check karo', doer: { type: 'fixed', name: 'SALES' }, trigger: { type: 'instanceStart' }, tat: { value: 2, unit: 'hours' } },
    { id: 'planning', name: 'Production Planning', doer: { type: 'fixed', name: 'PPC' }, trigger: { type: 'afterStep', step: 'order_verify' }, tat: { value: 1, urgent: 0.5, unit: 'days' } },
    { id: 'material', name: 'Material Arrangement', what: 'BOM ke hisaab se material issue / purchase', doer: { type: 'fixed', name: 'STORE' }, trigger: { type: 'afterStep', step: 'planning' }, tat: { value: 2, urgent: 1, unit: 'days' } },
    { id: 'production', name: 'Production', doer: { type: 'fixed', name: 'PRODUCTION' }, trigger: { type: 'afterStep', step: 'material' }, tat: { value: 3, urgent: 2, unit: 'days' } },
    { id: 'qc', name: 'Quality Check', doer: { type: 'fixed', name: 'QC' }, trigger: { type: 'afterStep', step: 'production' }, tat: { value: 4, unit: 'hours' } },
    { id: 'labels', name: 'Labels & Barcode Ready', what: 'PO expiry se 3 din pehle ready', doer: { type: 'fixed', name: 'SALES' }, trigger: { type: 'beforeDate', field: 'po_expiry_date' }, tat: { value: 3, unit: 'days' } },
    { id: 'packing', name: 'Packing', what: 'Assortment / solid packing as per order', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'qc' }, tat: { value: 4, unit: 'hours' } },
    { id: 'invoice', name: 'Invoice', doer: { type: 'fixed', name: 'ACCOUNTS' }, trigger: { type: 'afterStep', step: 'packing' }, tat: { value: 2, unit: 'hours' } },
    { id: 'dispatch', name: 'Dispatch', what: 'Dispatch screen se entry karo — poori qty jaane par step apne aap Done', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'invoice' }, tat: { value: 4, unit: 'hours' }, status: { type: 'auto', source: 'Dispatch module', rule: 'Done when full order qty is dispatched' } }
  ]
};

const ALL_EDIT = () => Object.fromEntries(MODULES.map(m => [m.key, 'edit']));
function rolePerms(edit, view) { const p = {}; MODULES.forEach(m => p[m.key] = 'none'); view.forEach(k => p[k] = 'view'); edit.forEach(k => p[k] = 'edit'); return p; }
const WORK_VIEW = ['dashboard', 'orders', 'tracker', 'dispatch'];

function seedData(cloud) {
  const now = new Date();
  const base = {
    settings: {
      id: 'main', company: 'My Company', gstin: '', address: '',
      calendar: { open: '09:30', close: '18:30', lunchStart: '13:30', lunchEnd: '14:00', weeklyOff: [0], halfDays: 'exact' },
      holidays: [{ date: now.getFullYear() + '-10-02', name: 'Gandhi Jayanti' }]
    },
    roles: [
      { id: 'r_admin', name: 'Admin', system: true, perms: ALL_EDIT() },
      { id: 'r_manager', name: 'Manager', perms: rolePerms(['tasks', 'orders', 'dispatch', 'tracker', 'masters'], ['dashboard', 'builder', 'users', 'audit']) },
      { id: 'r_sales', name: 'Sales', perms: rolePerms(['tasks', 'orders', 'masters'], WORK_VIEW) },
      { id: 'r_accounts', name: 'Accounts', perms: rolePerms(['tasks'], WORK_VIEW.concat(['masters'])) },
      { id: 'r_ppc', name: 'PPC', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_store', name: 'Store', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_production', name: 'Production', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_qc', name: 'QC', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_dispatch', name: 'Dispatch', perms: rolePerms(['tasks', 'dispatch'], ['dashboard', 'orders', 'tracker']) },
      { id: 'r_viewer', name: 'Viewer', perms: rolePerms([], WORK_VIEW) }
    ],
    users: [], customers: [], items: [], processes: [], orders: [], dispatches: [], audit: []
  };
  const U = (name, email, role_id, doer) => ({ id: 'u_' + doer.toLowerCase(), name, email, role_id, doer, active: true, pin_seed: '1234', seed: !!cloud });
  base.users = cloud ? [U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN')] : [
    U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN'),
    U('Rahul (Sales)', 'sales@nexus.local', 'r_sales', 'SALES'),
    U('Neha (Accounts)', 'accounts@nexus.local', 'r_accounts', 'ACCOUNTS'),
    U('Amit (PPC)', 'ppc@nexus.local', 'r_ppc', 'PPC'),
    U('Suresh (Store)', 'store@nexus.local', 'r_store', 'STORE'),
    U('Vikas (Production)', 'production@nexus.local', 'r_production', 'PRODUCTION'),
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
  RES_CACHE.clear();
  base.audit.push({ id: uid(), at: now.toISOString(), user: 'system', action: 'seed', ref: '', detail: 'Demo data loaded' });
  return base;
}
