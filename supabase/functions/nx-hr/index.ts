// Nexus 2.0 ↔ Nexus_Payroll bridge: who is present today (for EA → MOM / Meetings attendees).
// Reads only today's attendance names from the payroll project; nothing else is exposed.
// Secrets (Supabase → Edge Functions → Secrets): PAYROLL_KEY (publishable / anon key of the Nexus_Payroll project).
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

    if (b.action !== 'present') return out({ error: 'Unknown action' }, 400);
    const key = Deno.env.get('PAYROLL_KEY') || '';
    if (!key) return out({ error: 'Payroll link is not set up (PAYROLL_KEY secret missing)' }, 400);
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
