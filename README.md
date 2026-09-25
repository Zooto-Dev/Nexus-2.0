# Nexus 2.0 — Order to Dispatch ERP with an FMS Builder

The whole order journey runs in one place: order punch, verification, credit, planning, material, production, QC, packing, invoice and dispatch. Every step is tracked by the FMS engine: each step has a doer, a planned time, an actual time, a status and a delay counted in working hours.

Open `nexus/index.html`. It works straight away in **Local mode**, where data is saved in your browser.
Demo login: `admin@nexus.local` / PIN `1234`. Other demo users: `sales@`, `accounts@`, `ppc@`, `store@`, `production@`, `qc@` and `dispatch@nexus.local`, all with PIN `1234`.

## Departments (top navigation)
| Menu | Screens |
|---|---|
| Home | Company dashboard: escalations, tickets, department snapshot, late by doer, stages |
| Purchase | Purchase Dashboard · Purchase Order (approval flow) · Sourcing · Followup · Vendors |
| Merchant | Punch Order · Orders · Job Card · Swatch Approval · Job Card Correction · Brands · Articles |
| Store | Inwarding · Swatch Matching · GRN · Issuance · Stock View · Rejection Stock · RTV · Materials |
| Development | BOM · Created BOM |
| Production | Requisition Slip · Production Tracker · MRS |
| Accounts | Invoices (payment tracking) |
| Operations | Raise Ticket · Manage Users · Roles & Access · Settings · Audit Log |
| Dispatch | Ready to Dispatch · Upcoming · History |
| Task | My Tasks · Checklist · FMS Builder · FMS trackers (per live flow) |

Deep IMS logic also ported: **BOM → Job Card** material lines (`required = ceil(norms × qty × 1.02)`, supplier per material) with PO-raised/reserved/issued/pending tracking per JC line; **PO from JC requirement** — pick a vendor, all its pending JC materials load with net-to-order (pending − free stock − transit, FIFO) and sourcing rates, capped at JC pending; **PO approve updates JC "PO raised"**; **issuance approval flow** — store raises a request, stock moves only when an Admin/Manager approves (final stock check at approval), reservations (RSJW per JC) consumed first; **material returns** capped at net issued; **reserve open stock to a JC** from Stock View; **swatch-fail blocks GRN** for that PO.

Business rules (from the original Nexus IMS on Apps Script): FY numbering (`ZF/PO/2026-27/NNN`, `ZF/GRN/…`); a PO starts as **Pending Approval** and only an Admin/Manager can approve it — only approved POs appear in GRN/Followup/Inwarding; PO needs the vendor in the Vendors master with mobile/email; a duplicate PO (same vendor+lines within 60s) is blocked; GRN takes **Invoice qty vs PO pending** and auto-computes **Short** (billed but not received) and **Excess** (billed beyond PO); reject goes to Rejection Stock; short/reject auto-create **Debit Note** (Accounts) and **RTV** (Store) tasks and every GRN creates a **Tally Entry** task for the next working day; a vendor invoice can be GRN'd only once; a requisition slip pending **24h+** blocks new slips until Store acts (Manager exempt); materials carry **min level + rack** and low stock is flagged on Stock View and the Purchase dashboard.

How the chain works: PO → GRN (accept/reject) → Stock → Issuance (direct or against a Requisition) → Production; rejects go to Rejection Stock → RTV. BOM × order qty = MRS with shortfall vs stock. Tickets escalate automatically when Critical or open > 48h and show on Home.

Demo logins (PIN 1234): admin@, ops@(Manager), purchase@, merchant@, store@, development@, production@, accounts@, qc@, dispatch@ — sab `nexus.local`.

## UI rules followed
- One accent colour; colour is used only for status (red = late, amber = pending, green = done)
- No animations or transitions
- Compact tables instead of big cards
- No popups: forms open inline, confirms are two clicks on the same button, messages show in a strip at the top
- Small choices are buttons (segmented), not dropdowns. Long lists (customers, items) use type-to-search
- Keyboard: `/` search, `Alt+N` new order, `Ctrl+S` save, Enter moves to the next row

## FMS rules
- Only an **actual** (a step marked done) moves the chain. A step's planned time never triggers the next step.
- Actual = the time Done was clicked. Undo is allowed only for tracker editors (or yourself within 5 minutes), never after a later step is done, and it is written to the audit log.
- Every flow is **versioned**: an order stays on the version it started with, and new orders use the live version.
- Delay counts working time only (office hours, lunch, weekly offs, holidays).

## Security model (cloud mode)
- Login only via Supabase Auth; the publishable key alone can read/write nothing (RLS deny-by-default, authenticated-only).
- `audit` collection is INSERT-only at the database level — nobody can edit or delete history.
- `users`, `roles`, `settings`, `processes` writes need an admin/manager row in `nx_profiles` (checked in the database, not just the UI).
- Public signup must be disabled in the dashboard; admins invite users.
- Never put the service_role key in any file or app. `config.js` carries only the publishable key.

## Going multi-user (Supabase)
1. In a Supabase project, run `supabase-schema.sql` in the SQL Editor.
2. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`.
3. Under Authentication → Users, create the login for each email. The first person to log in becomes Admin; add everyone else under Users.
4. Data syncs live to every open screen.

## Files
`index.html` (shell) · `styles.css` · `engine.js` (FMS engine: planned, status, delay) · `core.js` (store, login, RBAC, router) · `seed.js` (default flow and demo data) · `ops.js` (daily work screens) · `fms.js` (builder) · `admin.js` (masters and admin)

## Known limits (next steps)
- In cloud mode, RBAC and number generation run in the browser. Database RLS only checks that the user is signed in. For strict server-side checks, the next step is RPC or Edge Functions.
- No stock or inventory yet: dispatch checks order qty, not finished-goods stock.
- WhatsApp or email alerts are not connected yet.
