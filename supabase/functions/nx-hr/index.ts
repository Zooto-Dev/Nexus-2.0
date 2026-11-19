// Nexus 2.0 ↔ Nexus_Payroll bridge: who is present today (for EA → MOM / Meetings attendees).
// Reads only today's attendance names from the payroll project; nothing else is exposed.
// Secrets (Supabase → Edge Functions → Secrets): PAYROLL_KEY — a key of the Nexus_Payroll project. Actions: present (EA), hierarchy (admin).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Doc = Record<string, any>;
const PAYROLL_URL = Deno.env.get('PAYROLL_URL') || 'https://fhayathwghpatsmvyvix.supabase.co';

function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function jwtUser(jwt: string): string {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
    return p.role === 'authenticated' ? String(p.sub || '') : '';
  } catch (_e) { return ''; }
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    const uid = jwtUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!uid) return out({ error: 'Not signed in' }, 401);
    const { data: me } = await db.from('nx_profiles').select('role, email').eq('user_id', uid).maybeSingle();
    if (!me) return out({ error: 'No Nexus profile for this login' }, 403);
    const isAdmin = ['superadmin', 'admin'].includes(me.role);
    // Admin, or a user whose Access settings give EA = Edit (same rule the app uses)
    const [{ data: sRow }, { data: uRows }] = await Promise.all([db.from('nx_docs').select('data').eq('collection', 'settings').eq('id', 'main').maybeSingle(), db.from('nx_docs').select('data').eq('collection', 'users')]);
    const acc = ((sRow?.data || {}) as Doc).access || {};
    const users = (uRows || []).map((r: { data: Doc }) => r.data);
    const meUser = users.find((u) => String(u.email || '').toLowerCase() === String(me.email || '').toLowerCase()) || {};
    const lv = (o: Doc | undefined) => (o && (o.ea || o['s:ea'])) || '';
    const eaLevel = lv((acc.user || {})[meUser.id]) || lv((acc.desig || {})[(meUser.department || '') + '|' + (meUser.designation || '')]) || lv((acc.dept || {})[meUser.department || '']) || lv(acc.role_user) || 'none';
    if (!isAdmin && eaLevel !== 'edit') return out({ error: 'Only Admin or a user with EA edit access can see who is present' }, 403);

    const key = Deno.env.get('PAYROLL_KEY') || '';
    if (!key) return out({ error: 'Payroll link is not set up (PAYROLL_KEY secret missing)' }, 400);

    // who reports to whom: only the employee code, name, department, designation and the manager's code
    // come across — nothing from salary, documents or attendance. Admin only.
    if (b.action === 'hierarchy') {
      if (!isAdmin) return out({ error: 'Only Admin can read the team hierarchy' }, 403);
      const hr = createClient(PAYROLL_URL, key, { auth: { persistSession: false } });
      const emps: Doc[] = []; const profs: Doc[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await hr.from('employees').select('"Employee code", Name, Status, DEPARTMENT, DESIGNATION').range(from, from + 999);
        if (error) return out({ error: 'Payroll database: ' + error.message }, 500);
        emps.push(...(data || [])); if (!data || data.length < 1000) break;
      }
      for (let from = 0; ; from += 1000) {
        const { data, error } = await hr.from('hr_profiles').select('employee_code, reporting_manager, category').range(from, from + 999);
        if (error) return out({ error: 'Payroll database: ' + error.message }, 500);
        profs.push(...(data || [])); if (!data || data.length < 1000) break;
      }
      const byCode: Record<string, Doc> = {}; const byName: Record<string, string[]> = {};
      emps.forEach((e) => { const c = String(e['Employee code'] || '').trim().toUpperCase(); if (!c) return; byCode[c] = e; const n = String(e.Name || '').trim().toUpperCase().replace(/\s+/g, ' '); if (n) (byName[n] = byName[n] || []).push(c); });
      const mgrOf: Record<string, string> = {}; const catOf: Record<string, string> = {};
      profs.forEach((p) => { const c = String(p.employee_code || '').trim().toUpperCase(); mgrOf[c] = String(p.reporting_manager || '').trim(); catOf[c] = String(p.category || '').trim().toUpperCase(); });
      // "NAME (ZM01234)" → the code; a bare name → the one active employee with that name, else unresolved
      const resolve = (raw: string): { code: string; how: string } => {
        if (!raw) return { code: '', how: '' };
        const m = raw.match(/\(([A-Z]{2}\d{3,6})\)/i); if (m && byCode[m[1].toUpperCase()]) return { code: m[1].toUpperCase(), how: 'code' };
        const n = raw.replace(/\(.*?\)/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
        const hits = (byName[n] || []).filter((c) => /active/i.test(String(byCode[c].Status || '')));
        if (hits.length === 1) return { code: hits[0], how: 'name' };
        return { code: '', how: hits.length ? 'ambiguous' : 'unknown' };
      };
      const list = Object.keys(byCode).map((c) => { const e = byCode[c]; const raw = mgrOf[c] || ''; const r = resolve(raw); return { code: c, name: String(e.Name || '').trim(), dept: String(e.DEPARTMENT || ''), desig: String(e.DESIGNATION || ''), category: catOf[c] || '', active: /active/i.test(String(e.Status || '')), mgr_raw: raw, mgr_code: r.code, mgr_how: r.how }; })
        .sort((x, y) => x.name.localeCompare(y.name));
      return out({ ok: true, count: list.length, list });
    }

    if (b.action !== 'present') return out({ error: 'Unknown action' }, 400);
    // the date as seen in India, unless one is given
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const hr = createClient(PAYROLL_URL, key, { auth: { persistSession: false } });
    const { data: att, error } = await hr.from('attendance').select('employee_code, Name, in_time, out_time').eq('date', day).not('in_time', 'is', null).limit(2000);
    if (error) return out({ error: 'Payroll database: ' + error.message }, 500);
    const codes = [...new Set((att || []).map((a: Doc) => String(a.employee_code || '')).filter(Boolean))];
    const depts: Record<string, Doc> = {};
    for (let i = 0; i < codes.length; i += 200) {
      const { data: emps } = await hr.from('employees').select('"Employee code", DEPARTMENT, DESIGNATION').in('Employee code', codes.slice(i, i + 200));
      (emps || []).forEach((e: Doc) => { depts[String(e['Employee code'])] = e; });
    }
    const seen = new Set<string>();
    const list = (att || []).map((a: Doc) => ({ code: String(a.employee_code || ''), name: String(a.Name || '').trim(), dept: String(depts[String(a.employee_code || '')]?.DEPARTMENT || ''), desig: String(depts[String(a.employee_code || '')]?.DESIGNATION || ''), in: String(a.in_time || '').slice(0, 5), out: String(a.out_time || '').slice(0, 5) }))
      .filter((x: Doc) => { const k = x.code || x.name.toUpperCase(); if (!x.name || seen.has(k)) return false; seen.add(k); return true; })
      .sort((x: Doc, y: Doc) => x.name.localeCompare(y.name));
    return out({ ok: true, date: day, count: list.length, list });
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
