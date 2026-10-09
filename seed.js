/* Nexus 2.0 — first-run data: default O2D flow, roles, users, masters, demo orders. */
'use strict';
// Starter O2D flow for an empty project; edit it in Operations › FMS Builder (it is data, not code).
const DEFAULT_SDEV_SPEC = {"process": {"id": "sdev", "name": "Sample Development", "endStep": "r_showroom", "keyField": "sample_no", "startEvent": "Sample entered", "instanceLabel": "Sample"}, "fields": [{"key": "created_at", "type": "datetime", "label": "Time Stamp", "source": "system"}, {"key": "sample_no", "type": "text", "label": "Sample ID", "source": "system"}, {"key": "batch_no", "type": "text", "label": "Batch ID", "source": "system"}, {"key": "follows", "type": "text", "label": "Starts after sample", "source": "system"}, {"key": "lead_cleared_at", "type": "datetime", "label": "Lead sample cleared", "source": "system"}, {"key": "brand", "type": "text", "label": "Brand", "source": "form"}, {"key": "article", "type": "text", "label": "Article", "source": "form"}, {"key": "colour", "type": "text", "label": "Colour", "source": "form"}, {"key": "size", "type": "select", "label": "Size", "source": "form", "options": ["6-11", "6-10", "6-12", "40-45", "36-41", "3-8", "4-9", "24-35", "5", "8", "38"]}, {"key": "gender", "type": "select", "label": "Gender", "source": "form", "options": ["Men", "Women", "Boys Kids", "Girls Kids", "Unisex"]}, {"key": "category", "type": "select", "label": "Category", "source": "form", "options": ["Slider", "Shoes", "Sandals", "Eva Slider", "Clogs", "V Shape"]}, {"key": "status", "type": "select", "label": "Remarks", "source": "form", "options": ["", "Hold", "Rejected", "Duplicate Entry"]}, {"key": "changes_required", "type": "select", "label": "Changes Required", "source": "step", "options": ["Yes", "No"]}], "priority": {"field": "status", "urgent": [], "hold": ["Hold"], "cancel": ["Rejected", "Duplicate Entry"]}, "doerTables": {"brand_merchant": {"Max": "AJEET", "Kappa": "AJEET", "Pantaloon": "AJEET", "Firstcry": "AJEET", "Yellow": "AJEET", "Soleplay": "AJEET", "Tata": "AJEET", "Lifestyle": "AJEET", "Metro": "AJEET", "Forca": "AJEET", "Red Chief": "AJEET", "Luna Blue(Tata)": "AJEET", "Hummel": "AJEET", "FRIDO": "AJEET", "Chupps": "RASHMI", "Campus": "RASHMI", "Gas": "RASHMI", "Growkik": "RASHMI", "Omizoo": "RASHMI", "Spykar": "RASHMI", "Steve Madden": "RASHMI", "Yoho": "RASHMI", "Trase": "RASHMI", "One8 Hyper Fit": "RASHMI", "Loqo": "RASHMI", "Refoam": "RASHMI", "Duke": "RASHMI", "Diadora": "RASHMI", "Pepe Jeans": "TANUJ", "Hamster London": "TANUJ", "Rare Rabbit": "TANUJ", "Boldfit": "TANUJ", "Tigc": "TANUJ", "CL": "TANUJ", "Snitch": "TANUJ", "Fizzy Goblet": "TANUJ", "Alzado": "TANUJ"}}, "steps": [{"id": "decode", "name": "Sample Decode Sheet", "doer": {"type": "lookup", "table": "brand_merchant", "by": "brand"}, "trigger": [{"type": "instanceStart", "when": {"field": "follows", "empty": true}}, {"type": "afterDate", "field": "lead_cleared_at", "when": {"field": "follows", "empty": false}}], "tat": {"value": 1, "unit": "days"}, "what": "Other colours of the same article start only after the first colour passes without changes (or after its rework submission)."}, {"id": "material", "name": "Arrange Material", "doer": {"type": "lookup", "table": "brand_merchant", "by": "brand"}, "trigger": {"type": "afterStep", "step": "decode"}, "tat": {"value": 5, "unit": "days"}}, {"id": "pattern", "name": "Pattern Designing", "doer": {"type": "fixed", "name": "MANOJ"}, "trigger": {"type": "afterStep", "step": "material"}, "tat": {"value": 1, "unit": "days"}}, {"id": "set_design", "name": "Set Design", "doer": {"type": "fixed", "name": "JITESH"}, "trigger": {"type": "afterStep", "step": "pattern"}, "tat": {"value": 1, "unit": "days"}}, {"id": "dye", "name": "Sample Dye & +Ve", "doer": {"type": "fixed", "name": "JITESH"}, "trigger": {"type": "afterStep", "step": "set_design"}, "tat": {"value": 1, "unit": "days"}}, {"id": "submission", "name": "Sample Submission", "doer": {"type": "fixed", "name": "SACHIN"}, "trigger": {"type": "afterStep", "step": "dye"}, "tat": {"value": 1, "unit": "days"}}, {"id": "showroom", "name": "Keep One Right Odd Sample in Showroom & Upload Photo", "doer": {"type": "fixed", "name": "SACHIN"}, "trigger": {"type": "afterStep", "step": "submission"}, "tat": {"value": 4, "unit": "hours"}}, {"id": "changes", "name": "Changes Required?", "what": "Brand feedback on the submitted sample: Yes starts the rework round.", "doer": {"type": "lookup", "table": "brand_merchant", "by": "brand"}, "trigger": {"type": "afterStep", "step": "submission"}, "tat": {"value": 3, "unit": "days"}, "capture": {"field": "changes_required"}}, {"id": "r_decode", "name": "Sample Decode Sheet (Rework)", "doer": {"type": "lookup", "table": "brand_merchant", "by": "brand"}, "trigger": {"type": "afterStep", "step": "changes"}, "tat": {"value": 1, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_material", "name": "Arrange Material (Rework)", "doer": {"type": "lookup", "table": "brand_merchant", "by": "brand"}, "trigger": {"type": "afterStep", "step": "r_decode"}, "tat": {"value": 5, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_pattern", "name": "Pattern Designing (Rework)", "doer": {"type": "fixed", "name": "MANOJ"}, "trigger": {"type": "afterStep", "step": "r_material"}, "tat": {"value": 1, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_set_design", "name": "Set Design (Rework)", "doer": {"type": "fixed", "name": "JITESH"}, "trigger": {"type": "afterStep", "step": "r_pattern"}, "tat": {"value": 1, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_dye", "name": "Sample Dye & +Ve (Rework)", "doer": {"type": "fixed", "name": "JITESH"}, "trigger": {"type": "afterStep", "step": "r_set_design"}, "tat": {"value": 1, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_submission", "name": "Sample Submission (Rework)", "doer": {"type": "fixed", "name": "SACHIN"}, "trigger": {"type": "afterStep", "step": "r_dye"}, "tat": {"value": 1, "unit": "days"}, "applies": {"field": "changes_required", "eq": "Yes"}}, {"id": "r_showroom", "name": "Keep One Right Odd Sample in Showroom & Upload Photo (Rework)", "doer": {"type": "fixed", "name": "SACHIN"}, "trigger": {"type": "afterStep", "step": "r_submission"}, "tat": {"value": 4, "unit": "hours"}, "applies": {"field": "changes_required", "eq": "Yes"}}]};
const DEFAULT_O2D_SPEC = {"process": {"id": "o2d", "name": "Order to Dispatch", "endStep": "dispatch", "keyField": "order_no", "startEvent": "Order punched", "instanceLabel": "Order"}, "fields": [{"key": "created_at", "type": "datetime", "label": "Time Stamp", "source": "system"}, {"key": "order_no", "type": "text", "label": "Order No", "source": "system"}, {"key": "order_date", "type": "date", "label": "Order Date", "source": "form"}, {"key": "brand", "type": "text", "label": "Brand", "source": "form"}, {"key": "brand_merchant", "type": "text", "label": "Brand Merchandiser (CDB)", "source": "system"}, {"key": "category", "type": "select", "label": "Category", "source": "form", "options": ["Shoes", "Slider", "Clogs", "V Shape", "Eva Slider"]}, {"key": "channel", "type": "select", "label": "Channel", "source": "form", "options": ["Online", "Offline", "Export"]}, {"key": "priority", "type": "select", "label": "Priority", "source": "form", "options": ["", "Urgent", "On Hold", "Cancelled"]}, {"key": "po_expiry_date", "type": "date", "label": "PO Expiry Date", "source": "form"}, {"key": "qty", "type": "number", "label": "Total Qty", "source": "system"}, {"key": "planned_dispatch_date", "type": "date", "label": "Planned Dispatch Date", "source": "step"}, {"key": "material_due_date", "type": "date", "label": "Material Due Date", "source": "step"}], "priority": {"field": "priority", "urgent": ["Urgent"], "hold": ["On Hold"], "cancel": ["Cancelled"]}, "doerTables": {"brand_doer": {"Max": "POOJA", "Kappa": "POOJA", "Pantaloon": "POOJA", "Pepe Jeans": "TANUJ", "Firstcry": "POOJA", "Yellow": "POOJA", "Soleplay": "POOJA", "Hamster London": "TANUJ", "Tata": "POOJA", "Lifestyle": "POOJA", "Metro": "POOJA", "Forca": "POOJA", "Red Chief": "POOJA", "Chupps": "RASHMI", "Campus": "RASHMI", "Gas": "RASHMI", "Growkik": "RASHMI", "Omizoo": "RASHMI", "Rare Rabbit": "TANUJ", "Spykar": "RASHMI", "Steve Madden": "RASHMI", "Yoho": "RASHMI", "Trase": "RASHMI", "Boldfit": "TANUJ", "One8 Hyper Fit": "RASHMI", "Loqo": "TANUJ", "Refoam": "TANUJ", "Tigc": "TANUJ", "Duke": "RASHMI", "CL": "TANUJ", "Diadora": "RASHMI", "Addiox": "POOJA", "Snitch": "TANUJ", "Luna Blue(Tata)": "POOJA", "Fizzy Goblet": "TANUJ", "Alzado": "TANUJ", "FRIDO": "POOJA"}, "brand_jc": {"Max": "AJIT", "Kappa": "AJIT", "Pantaloon": "AJIT", "Pepe Jeans": "TANUJ", "Firstcry": "AJIT", "Yellow": "AJIT", "Soleplay": "AJIT", "Hamster London": "TANUJ", "Tata": "AJIT", "Lifestyle": "AJIT", "Metro": "AJIT", "Forca": "AJIT", "Red Chief": "AJIT", "Chupps": "RASHMI", "Campus": "RASHMI", "Gas": "RASHMI", "Growkik": "RASHMI", "Omizoo": "RASHMI", "Rare Rabbit": "TANUJ", "Spykar": "RASHMI", "Steve Madden": "RASHMI", "Yoho": "RASHMI", "Trase": "RASHMI", "Boldfit": "TANUJ", "One8 Hyper Fit": "RASHMI", "Loqo": "RASHMI", "Refoam": "RASHMI", "Tigc": "TANUJ", "Duke": "RASHMI", "CL": "TANUJ", "Diadora": "RASHMI", "Addiox": "AJIT", "Snitch": "TANUJ", "Luna Blue(Tata)": "AJIT", "Fizzy Goblet": "TANUJ", "Alzado": "TANUJ", "FRIDO": "POOJA"}}, "steps": [{"id": "planned_dispatch", "name": "Planned Dispatch Date", "what": "Enter the planned dispatch date from the production plan.", "doer": {"type": "fixed", "name": "ARYAN"}, "trigger": {"type": "instanceStart"}, "tat": {"value": 1, "unit": "days"}, "capture": {"field": "planned_dispatch_date"}}, {"id": "internal_green_seal", "name": "Internal Green Seal", "what": "Gate: no later step opens until this is done.", "doer": {"type": "field", "field": "brand_merchant"}, "trigger": {"type": "instanceStart"}, "tat": {"value": 1, "unit": "days"}}, {"id": "swatch_file", "name": "Swatch File", "doer": {"type": "lookup", "table": "brand_doer", "by": "brand"}, "trigger": {"type": "afterStep", "step": "internal_green_seal"}, "tat": {"value": 1, "unit": "days", "urgent": 1}}, {"id": "green_seal", "name": "Green Seal", "doer": {"type": "lookup", "table": "brand_doer", "by": "brand"}, "trigger": {"type": "afterStep", "step": "internal_green_seal"}, "tat": {"value": 3, "unit": "days", "urgent": 2}, "applies": {"field": "category", "in": ["Clogs", "V Shape", "Eva Slider"]}}, {"id": "give_norms", "name": "Give Norms", "doer": {"type": "byCondition", "rules": [{"when": {"field": "category", "in": ["Shoes", "Slider"]}, "name": "MANOJ"}], "default": "HADMAT"}, "trigger": {"type": "afterStep", "step": "internal_green_seal"}, "tat": {"value": 3, "unit": "days"}}, {"id": "size_set", "name": "Size Set Approval", "doer": {"type": "fixed", "name": "SANTOSH"}, "trigger": {"type": "afterStep", "step": "internal_green_seal"}, "tat": {"value": 5, "unit": "days", "urgent": 2}}, {"id": "bom_spec", "name": "BOM & Spec Sheet", "doer": {"type": "fixed", "name": "ASHISH"}, "trigger": {"type": "afterStep", "step": "give_norms"}, "tat": {"value": 1, "unit": "days"}}, {"id": "job_card", "name": "Job Card", "what": "Make the job card and enter the material due date.", "doer": {"type": "lookup", "table": "brand_jc", "by": "brand"}, "trigger": {"type": "afterStep", "step": "bom_spec"}, "tat": {"value": 2, "unit": "days", "urgent": 1}, "capture": {"field": "material_due_date"}}, {"id": "purchase_head_sign", "name": "Purchase Head Sign", "doer": {"type": "fixed", "name": "ASHISH"}, "trigger": [{"type": "afterStep", "step": "swatch_file", "when": {"field": "category", "in": ["Shoes", "Slider"]}, "orNext": true}, {"type": "afterStep", "step": "job_card"}], "tat": {"value": 2, "unit": "hours"}}, {"id": "rack_no", "name": "Rack No.", "doer": {"type": "fixed", "name": "VISHNU"}, "trigger": {"type": "afterStep", "step": "purchase_head_sign"}, "tat": {"value": 1, "unit": "hours"}}, {"id": "tooling", "name": "Tooling", "doer": {"type": "fixed", "name": "SANTOSH"}, "trigger": {"type": "afterStep", "step": "size_set"}, "tat": {"value": 1, "unit": "days", "urgent": 1}}, {"id": "tooling_trial", "name": "Tooling Trial", "doer": {"type": "byCondition", "rules": [{"when": {"field": "category", "in": ["Clogs", "V Shape", "Eva Slider"]}, "name": "HADMAT"}], "default": "PURNANDU"}, "trigger": {"type": "afterStep", "step": "tooling"}, "tat": {"value": 1, "unit": "days"}}, {"id": "dye_design", "name": "Dye Design Approval", "doer": {"type": "fixed", "name": "JITESH"}, "trigger": {"type": "afterStep", "step": "tooling"}, "tat": {"value": 3, "unit": "days", "urgent": 1}}, {"id": "printing_dyes", "name": "Order Printing Dyes", "doer": {"type": "fixed", "name": "ASHISH"}, "trigger": {"type": "afterStep", "step": "dye_design"}, "tat": {"value": 1, "unit": "days"}}, {"id": "barcode", "name": "Barcode Approval", "doer": {"type": "field", "field": "brand_merchant"}, "trigger": {"type": "beforeDate", "field": "planned_dispatch_date"}, "tat": {"value": 3, "unit": "days"}}, {"id": "size_label", "name": "Size Label", "doer": {"type": "fixed", "name": "PRIYANKA"}, "trigger": {"type": "afterStep", "step": "barcode"}, "tat": {"value": 2, "unit": "days"}, "applies": {"field": "category", "notIn": ["Clogs", "V Shape"]}}, {"id": "photoshoot", "name": "Photoshoot Sample", "doer": {"type": "lookup", "table": "brand_doer", "by": "brand"}, "trigger": {"type": "beforeDate", "field": "planned_dispatch_date"}, "tat": {"value": 3, "unit": "days"}}, {"id": "testing_report", "name": "Testing Report", "doer": {"type": "field", "field": "brand_merchant"}, "trigger": {"type": "beforeDate", "field": "planned_dispatch_date"}, "tat": {"value": 2, "unit": "days"}}, {"id": "pictogram", "name": "Pictogram", "doer": {"type": "field", "field": "brand_merchant"}, "trigger": {"type": "beforeDate", "field": "planned_dispatch_date"}, "tat": {"value": 3, "unit": "days"}, "applies": {"field": "brand", "in": ["Gas", "Pepe Jeans"]}}, {"id": "production", "name": "Production", "doer": {"type": "fixed", "name": "VIKASH"}, "trigger": {"type": "external", "field": "material_due_date"}, "tat": {"value": 1, "unit": "days"}}, {"id": "dispatch", "name": "Dispatch", "doer": {"type": "fixed", "name": "PINTU"}, "trigger": {"type": "afterStep", "step": "production"}, "tat": {"value": 1, "unit": "days"}}, {"id": "order_close", "name": "Order Close", "what": "Actual dispatch date recorded; status becomes Dispatch.", "doer": {"type": "fixed", "name": "SYSTEM"}, "trigger": {"type": "afterStep", "step": "dispatch"}, "tat": {"value": 0, "unit": "days"}, "status": {"type": "auto", "rule": "order_dispatched"}}]};

const ALL_EDIT = () => Object.fromEntries(MODULES.map(m => [m.key, 'edit']));
function rolePerms(edit, view) { const p = {}; MODULES.forEach(m => p[m.key] = 'none'); view.forEach(k => p[k] = 'view'); edit.forEach(k => p[k] = 'edit'); return p; }
const WORK_VIEW = ['dashboard', 'orders', 'tracker', 'dispatch'];
// Starting access per department (changed later in Operations › Access); managers and heads can approve.
function defaultAccess() {
  const T = {
    ops: rolePerms(['tasks', 'orders', 'purchase', 'merchant', 'store', 'development', 'production', 'accounts', 'dispatch', 'tickets', 'checklist', 'tracker', 'masters'], ['dashboard', 'builder', 'users', 'audit']),
    purchase: rolePerms(['tasks', 'purchase', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'masters'])),
    merchant: rolePerms(['tasks', 'orders', 'merchant', 'masters', 'tickets', 'checklist'], WORK_VIEW.concat(['development'])),
    store: rolePerms(['tasks', 'store', 'tickets', 'checklist'], WORK_VIEW.concat(['purchase', 'production', 'masters'])),
    dev: rolePerms(['tasks', 'development', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'masters'])),
    production: rolePerms(['tasks', 'production', 'tickets', 'checklist'], WORK_VIEW.concat(['store', 'development'])),
    accounts: rolePerms(['tasks', 'accounts', 'tickets', 'checklist'], WORK_VIEW.concat(['masters'])),
    qc: rolePerms(['tasks', 'tickets', 'checklist'], WORK_VIEW),
    dispatch: rolePerms(['tasks', 'dispatch', 'tickets', 'checklist'], ['dashboard', 'orders', 'tracker', 'accounts']),
    view: rolePerms(['tasks', 'tickets', 'checklist'], WORK_VIEW)
  };
  const map = { 'OPERATIONS': 'ops', 'MANAGEMENT': 'ops', 'MIS': 'ops', 'PURCHASE': 'purchase', 'MERCHANDISING': 'merchant', 'STORE': 'store', 'DEVELOPMENT': 'dev', 'PRODUCTION': 'production', 'PPC': 'production', 'PLANNING': 'production', 'ACCOUNTS': 'accounts', 'ACCOUNTS AND FINANCE': 'accounts', 'QUALITY': 'qc', 'DISPATCH': 'dispatch' };
  const dept = {}; const desig = {};
  orgList().forEach(o => { dept[o.dept] = clone(T[map[o.dept] || 'view']); o.desigs.forEach(g => { if (/MANAGER|HEAD/.test(g)) desig[o.dept + '|' + g] = Object.assign({ approve: 'edit' }, o.dept === 'STORE' ? { issue_approve: 'edit' } : {}); }); });
  return { dept, desig };
}

function fyTag() { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); }
function seedData(cloud) {
  const now = new Date();
  const base = {
    settings: {
      id: 'main', company: 'My Company', gstin: '', address: '',
      options: { category: ['Shoes', 'Slider', 'Clogs', 'V Shape', 'Eva Slider'], channel: ['Online', 'Offline', 'Export'], gender: ['Gents', 'Ladies', 'Kids', 'Unisex'], packing: ['Assortment', 'Solid'] },
      calendar: { open: '09:30', close: '18:30', lunchStart: '13:30', lunchEnd: '14:00', weeklyOff: [0], halfDays: 'exact' },
      holidays: [{ date: now.getFullYear() + '-10-02', name: 'Gandhi Jayanti' }]
    },
    roles: [
      { id: 'r_admin', name: 'Super Admin', system: true },
      { id: 'r_adm', name: 'Admin', admin: true },
      { id: 'r_user', name: 'User' }
    ],
    users: [], customers: [], items: [], materials: [], vendors: [], rsjw: [], processes: [], orders: [], dispatches: [], purchase_orders: [], sourcing: [], grns: [], inwards: [], issues: [], rtvs: [], boms: [], job_cards: [], requisitions: [], tickets: [], checklist: [], audit: []
  };
  const U = (name, email, role_id, doer, department, designation) => ({ id: 'u_' + doer.toLowerCase(), name, email, role_id, doer, department: department || '', designation: designation || '', active: true, pin_seed: '1234', seed: !!cloud });
  base.users = cloud ? [U('Super Admin', 'admin@nexus.local', 'r_admin', 'ADMIN')] : [
    U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN'),
    U('Pankaj (Operations)', 'ops@nexus.local', 'r_user', 'OPS', 'OPERATIONS', 'HEAD OF OPERATIONS'),
    U('Ashish (Purchase)', 'purchase@nexus.local', 'r_user', 'PURCHASE', 'PURCHASE', 'EXECUTIVE'),
    U('Pooja (Merchant)', 'merchant@nexus.local', 'r_user', 'MERCHANT', 'MERCHANDISING', 'SR MERCHANT'),
    U('Suresh (Store)', 'store@nexus.local', 'r_user', 'STORE', 'STORE', 'EXECUTIVE'),
    U('Manoj (Development)', 'development@nexus.local', 'r_user', 'DEVELOPMENT', 'DEVELOPMENT', 'EXECUTIVE'),
    U('Vikas (Production)', 'production@nexus.local', 'r_user', 'PRODUCTION', 'PRODUCTION', 'SUPERVISOR'),
    U('Neha (Accounts)', 'accounts@nexus.local', 'r_user', 'ACCOUNTS', 'ACCOUNTS AND FINANCE', 'EXECUTIVE'),
    U('Kavita (QC)', 'qc@nexus.local', 'r_user', 'QC', 'QUALITY', 'EXECUTIVE'),
    U('Pintu (Dispatch)', 'dispatch@nexus.local', 'r_user', 'DISPATCH', 'DISPATCH', 'EXECUTIVE')
  ];
  base.processes = [{ id: 'p_o2d_v1', code: 'o2d', version: 1, name: DEFAULT_O2D_SPEC.process.name, spec: clone(DEFAULT_O2D_SPEC), active: true, created_at: now.toISOString(), created_by: 'system', note: 'Built from Nexus O2D flow chart' },
    { id: 'p_sdev_v1', code: 'sdev', version: 1, name: DEFAULT_SDEV_SPEC.process.name, spec: clone(DEFAULT_SDEV_SPEC), active: true, created_at: now.toISOString(), created_by: 'system', note: 'From Sample Development Tracker FMS (Shoes_slider_fms)' }];
  if (cloud) return base;

  base.customers = [
    { id: 'c1', code: 'B001', name: 'Max', contact_person: 'Rohit Mehra', merchandiser: 'POOJA', phone: '9820000001' },
    { id: 'c2', code: 'B002', name: 'Kappa', contact_person: 'Sanya Arora', merchandiser: 'POOJA', phone: '9810000002' },
    { id: 'c3', code: 'B003', name: 'Pepe Jeans', contact_person: 'Vipul Jain', merchandiser: 'TANUJ', phone: '9829000003' },
    { id: 'c4', code: 'B004', name: 'Campus', contact_person: 'Neeraj Gupta', merchandiser: 'RASHMI', phone: '9839000004' },
    { id: 'c5', code: 'B005', name: 'Gas', contact_person: 'Anita Rao', merchandiser: 'RASHMI', phone: '9890000005' }
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
  let jcSeed = 2;   // continue after job cards ZF-0001/0002
  plan.forEach((p, n) => {
    const cu = base.customers.find(c => c.id === p.c);
    const created = hoursAgo(p.ago);
    const o = {
      id: 'o' + (n + 1), no: '', order_date: ymdOf(created),
      customer_id: cu.id, customer_name: cu.name, brand: cu.name, buyer_po: 'PO/' + (4400 + n), tooling_no: 'TM-' + (110 + n),
      po_expiry_date: ymdOf(new Date(now.getTime() + p.dd * 86400000)), channel: p.ch, category: p.cat,
      priority: p.pri || '', remarks: '', lines: p.lines,
      process_id: 'p_o2d_v1', actuals: {}, done_by: {}, created_at: created.toISOString(), created_by: 'Rahul (Sales)', updated_at: created.toISOString()
    };
    o.lines.forEach((l, li) => {
      if (n === 0 && li === 0) l.jc_no = 'ZF-0001';
      else if (n === 3 && li === 0) l.jc_no = 'ZF-0002';
      else { jcSeed += 1; l.jc_no = 'ZF-' + String(jcSeed).padStart(4, '0'); }
    });
    o.no = o.lines[0].jc_no;   // the Job Card No is the order number
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
      lines: [{ material: 'EVA-10', uom: 'SHEET', qty: 31, rate: 420, received: 25, rejected: 1, jc_no: 'ZF-0001' }], followups: [{ at: ymdOf(hoursAgo(24)), by: 'Ashish (Purchase)', note: 'Vendor promised delivery by tomorrow', next: todayYmd() }] },
    { id: 'po2', no: 'ZF/PO/FY/002'.replace('FY', fyTag()), approval: 'Approved', approved_by: 'Pankaj (Manager)', date: ymdOf(hoursAgo(48)), vendor: 'Balaji Soles', expected: ymdOf(new Date(now.getTime() + 5 * 86400000)), remarks: '', created_by: 'Ashish (Purchase)', at: hoursAgo(48).toISOString(),
      lines: [{ material: 'SOLE-TPR', uom: 'PAIR', qty: 1000, rate: 38, received: 0, rejected: 0 }, { material: 'BOX-K3', uom: 'PCS', qty: 500, rate: 12, received: 0, rejected: 0 }], followups: [] }
  ];
  base.grns = [{ id: 'g1', no: 'ZF/GRN/FY/0001'.replace('FY', fyTag()), inv_qty: 120, date: ymdOf(hoursAgo(30)), po_id: 'po1', po_no: base.purchase_orders[0].no, vendor: 'Shree Polymers', invoice: 'SP/221', lines: [{ material: 'EVA-10', inv_qty: 26, accepted: 25, rejected: 1, short: 0, excess: 0 }], by: 'Suresh (Store)' }];
  base.inwards = [{ id: 'in1', no: 'INW-' + now.getFullYear() + '-0001', date: ymdOf(hoursAgo(30)), vendor: 'Shree Polymers', po_no: base.purchase_orders[0].no, material: 'EVA-10', uom: 'SHEET', qty: 26, remark: '', status: 'GRN Done', by: 'Suresh (Store)' }];
  base.issues = [{ id: 'is1', no: 'ISS-' + now.getFullYear() + '-0001', date: todayYmd(), material: 'EVA-10', qty: 10, source: 'AUTO', to_jc: 'ZF-0001', to_dept: 'Production', status: 'Approved', by: 'Suresh (Store)', approved_by: 'Pankaj (Manager)', at: hoursAgo(5).toISOString() }];
  base.rsjw = [{ id: 'rs1', jc_no: 'ZF-0001', material: 'EVA-10', qty: 5, by: 'Suresh (Store)', at: hoursAgo(4).toISOString() }];
  base.boms = [{ id: 'b1', brand: 'Max', article: 'ZT-101', style: 'Ranger Runner', colour: '', version: 1, lines: [{ material: 'EVA-10', uom: 'SHEET', qty: 0.05, supplier: 'Shree Polymers' }, { material: 'SOLE-TPR', uom: 'PAIR', qty: 1, supplier: 'Balaji Soles' }, { material: 'BOX-K3', uom: 'PCS', qty: 0.5, supplier: 'Jain Traders' }], status: 'Final', by: 'Manoj (Development)', at: hoursAgo(80).toISOString() },
    { id: 'b2', brand: 'Gas', article: 'ZT-201', style: 'Cloud Slide', colour: '', version: 1, lines: [{ material: 'EVA-06', uom: 'SHEET', qty: 0.04, supplier: 'Shree Polymers' }, { material: 'STRAP-P', uom: 'PAIR', qty: 1, supplier: 'Jain Traders' }], status: 'Final', by: 'Manoj (Development)', at: hoursAgo(60).toISOString() }];
  const jcL = (art, qty) => { const b = base.boms.find(x => x.article === art); return b.lines.map(l => ({ material: l.material, uom: l.uom, norms: l.qty, supplier: l.supplier, required: Math.ceil(l.qty * qty * 1.02 * 1000) / 1000, po_raised: 0 })); };
  base.job_cards = [
    { id: 'jc1', no: 'ZF-0001', order_no: 'ZF-0001', brand: 'Max', article: 'ZT-101', colour: 'Black', qty: 600, lines: jcL('ZT-101', 600), swatch_status: 'Approved', swatch_note: '', status: 'Open', corrections: [], by: 'Pooja (Merchant)', at: hoursAgo(100).toISOString() },
    { id: 'jc2', no: 'ZF-0002', order_no: 'ZF-0002', brand: 'Campus', article: 'ZT-301', colour: 'Blue', qty: 200, swatch_status: 'Pending', status: 'Open', corrections: [{ at: hoursAgo(6).toISOString(), by: 'Vikas (Production)', note: 'Colour shade should be darker', resolved: false }], by: 'Pooja (Merchant)', at: hoursAgo(18).toISOString() }
  ];
  base.job_cards[0].lines[0].po_raised = 31; // EVA-10 from approved PO-001
  base.requisitions = [{ id: 'rq1', no: 'REQ-0001', date: todayYmd(), jc_no: base.job_cards[0].no, dept: 'Production', lines: [{ material: 'SOLE-TPR', qty: 300 }], status: 'Pending', by: 'Vikas (Production)' }];
  base.tickets = [
    { id: 't1', no: 'TKT-' + now.getFullYear() + '-0001', at: hoursAgo(60).toISOString(), by: 'Vikas (Production)', dept: 'Store', priority: 'Critical', subject: 'EVA sheet shortage on line 2', detail: 'Production will stop if the material is not issued today', status: 'Open', comments: [{ at: hoursAgo(3).toISOString(), by: 'Suresh (Store)', note: 'GRN done, issuing today' }] },
    { id: 't2', no: 'TKT-' + now.getFullYear() + '-0002', at: hoursAgo(8).toISOString(), by: 'Pooja (Merchant)', dept: 'IT', priority: 'Normal', subject: 'Printer not working', detail: '', status: 'In Progress', comments: [] }
  ];
  base.checklist = [
    { id: 'ck1', title: 'Update stock register', doer: 'STORE', freq: 'Daily', done: {}, active: true, by: 'Admin' },
    { id: 'ck2', title: 'Pending PO followup calls', doer: 'PURCHASE', freq: 'Daily', done: {}, active: true, by: 'Admin' },
    { id: 'ck3', title: 'Weekly production plan review', doer: 'PRODUCTION', freq: 'Weekly', wday: 1, done: {}, active: true, by: 'Admin' }
  ];
  RES_CACHE.clear();
  base.audit.push({ id: uid(), at: now.toISOString(), user: 'system', action: 'seed', ref: '', detail: 'Demo data loaded' });
  return base;
}
