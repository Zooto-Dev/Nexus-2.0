// Nexus 2.0 user admin: create logins, change role, set password, activate/deactivate.
// Runs server-side only; the server key never leaves Supabase. Only a Super Admin may call it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const ROLES = ['superadmin', 'admin', 'user'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Server key: the new secret key (sb_secret_…) when the project has one, else the legacy service_role key.
function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
// The caller's own profile, read with their own login (row-level security lets a user read their own row).
async function myProfile(jwt: string) {
  let pub = '';
  try { const k = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'); pub = String(k.default || Object.values(k)[0] || ''); } catch (_e) { /* not set */ }
  pub = pub || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const u = createClient(Deno.env.get('SUPABASE_URL')!, pub, { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + jwt } } });
  const { data: who } = await u.auth.getUser(jwt);
  if (!who?.user) return { user: null, profile: null };
  const { data: profile } = await u.from('nx_profiles').select('role, email').eq('user_id', who.user.id).maybeSingle();
  return { user: who.user, profile: profile as { role: string; email: string } | null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { user, profile: me } = await myProfile(jwt);
    if (!user) return out({ error: 'Not signed in' }, 401);
    if (me?.role !== 'superadmin') return out({ error: 'Only a Super Admin can manage users (' + (user.email || '') + ' is ' + (me?.role || 'not set up') + ')' }, 403);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
    { const { error: kErr } = await admin.from('nx_profiles').select('user_id').limit(1); if (kErr) return out({ error: 'Server key problem: ' + kErr.message }, 500); }

    const b = await req.json();
    const saveSecret = (email: string, password: string) => admin.from('nx_secrets').upsert({ email, password, updated_at: new Date().toISOString() });
    const makeLogin = async (email: string, password: string, role: string, name: string) => {
      const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (ce || !cu?.user) return ce?.message || 'Could not create login';
      const { error: pe } = await admin.from('nx_profiles').insert({ user_id: cu.user.id, email, role });
      if (pe) { await admin.auth.admin.deleteUser(cu.user.id); return pe.message; }
      await saveSecret(email, password);
      return '';
    };
    const roleOf = (roleId: string) => roleId === 'r_admin' ? 'superadmin' : roleId === 'r_adm' ? 'admin' : 'user';

    // Create every missing login from the Users list: password = mobile number.
    if (b.action === 'sync') {
      const { data: docs } = await admin.from('nx_docs').select('data').eq('collection', 'users');
      const { data: profs } = await admin.from('nx_profiles').select('email');
      const have = new Set((profs || []).map((p: { email: string }) => String(p.email || '').toLowerCase()));
      let created = 0; const skipped: string[] = []; const failed: string[] = [];
      for (const r of docs || []) {
        const u = r.data || {};
        const email = String(u.email || '').trim().toLowerCase();
        if (u.active === false || have.has(email)) continue;
        const mob = String(u.mobile || '').trim();
        if (!EMAIL.test(email) || !/^[6-9][0-9]{9}$/.test(mob)) { skipped.push(String(u.name || '')); continue; }
        const err = await makeLogin(email, mob, roleOf(String(u.role_id || '')), String(u.name || ''));
        if (err) failed.push(u.name + ': ' + err); else { created++; have.add(email); }
      }
      return out({ ok: true, created, skipped, failed });
    }

    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return out({ error: 'Invalid email' }, 400);
    const { data: target } = await admin.from('nx_profiles').select('user_id, role').eq('email', email).maybeSingle();
    if (target && target.user_id === user.id && b.action !== 'password') return out({ error: 'You cannot change your own role or status' }, 403);

    if (b.action === 'create') {
      const role = String(b.role || 'user');
      if (!ROLES.includes(role)) return out({ error: 'Invalid role' }, 400);
      const pw = String(b.password || '');
      if (pw.length < 6) return out({ error: 'Password must be at least 6 characters' }, 400);
      if (target) return out({ error: 'This email already has a login' }, 409);
      const err = await makeLogin(email, pw, role, String(b.name || ''));
      return err ? out({ error: err }, 400) : out({ ok: true });
    }
    if (!target) return out({ error: 'No login found for this email' }, 404);
    if (b.action === 'role') {
      const role = String(b.role || '');
      if (!ROLES.includes(role)) return out({ error: 'Invalid role' }, 400);
      const { error } = await admin.from('nx_profiles').update({ role }).eq('user_id', target.user_id);
      return error ? out({ error: error.message }, 400) : out({ ok: true });
    }
    if (b.action === 'password') {
      const pw = String(b.password || '');
      if (pw.length < 6) return out({ error: 'Password must be at least 6 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: pw });
      if (error) return out({ error: error.message }, 400);
      await saveSecret(email, pw);
      return out({ ok: true });
    }
    if (b.action === 'active') {
      const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: b.active ? 'none' : '876000h' });
      return error ? out({ error: error.message }, 400) : out({ ok: true });
    }
    return out({ error: 'Unknown action' }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
