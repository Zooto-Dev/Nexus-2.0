// Nexus 2.0 WhatsApp webhook (Meta calls this; it is public, so every POST must carry Meta's signature).
// Secrets: WA_VERIFY_TOKEN (any text you choose, typed again in Meta), WA_APP_SECRET (Meta app secret).
// Optional WA_FORWARD_URL: the old Apps Script web-app URL, so its vendor-reply tracking keeps working.
import { createClient } from 'npm:@supabase/supabase-js@2';

type Doc = Record<string, any>;
function adminKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); const v = k.default || Object.values(k)[0]; if (v) return String(v); } catch (_e) { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
async function signatureOk(raw: string, header: string, secret: string) {
  if (!secret || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const got = header.slice(7);
  if (got.length !== mac.length) return false;
  let diff = 0; for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
function bodyOf(m: Doc): { type: string; body: string; media_id?: string; media_mime?: string; filename?: string } {
  const t = String(m.type || '');
  if (t === 'text') return { type: t, body: String(m.text?.body || '') };
  if (t === 'button') return { type: t, body: String(m.button?.text || m.button?.payload || '') };
  if (t === 'interactive') return { type: t, body: String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '') };
  if (t === 'location') return { type: t, body: 'Location: ' + (m.location?.name || '') + ' ' + (m.location?.latitude ?? '') + ',' + (m.location?.longitude ?? '') };
  if (t === 'reaction') return { type: t, body: 'Reaction ' + String(m.reaction?.emoji || '') };
  const media = m[t];
  if (media && media.id) return { type: t, body: String(media.caption || ''), media_id: String(media.id), media_mime: String(media.mime_type || ''), filename: String(media.filename || '') };
  return { type: t || 'unknown', body: '' };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta's one-time check when the callback URL is saved
  if (req.method === 'GET') {
    const token = Deno.env.get('WA_VERIFY_TOKEN') || '';
    if (token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  if (!(await signatureOk(raw, req.headers.get('x-hub-signature-256') || '', Deno.env.get('WA_APP_SECRET') || ''))) return new Response('Bad signature', { status: 401 });

  const fwd = Deno.env.get('WA_FORWARD_URL') || '';
  if (fwd) fetch(fwd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }).catch(() => {});

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });
    const payload = JSON.parse(raw);
    const rows: Doc[] = [];
    for (const entry of payload.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names: Record<string, string> = {};
      for (const c of v.contacts || []) names[String(c.wa_id || '')] = String(c.profile?.name || '');
      for (const m of v.messages || []) {
        const from = String(m.from || '').replace(/\D/g, '');
        const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
        rows.push({ id: String(m.id), wa: from, name: names[from] || null, dir: 'in', status: 'received', at, ...bodyOf(m) });
      }
      for (const s of v.statuses || []) {
        const err = (s.errors || []).map((e: Doc) => e.error_data?.details || e.title || e.message).filter(Boolean).join('; ');
        await db.from('nx_wa_msgs').update({ status: String(s.status || ''), ...(err ? { error: err } : {}) }).eq('id', String(s.id || ''));
      }
    }
    if (rows.length) await db.from('nx_wa_msgs').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  } catch (e) {
    console.error('wa hook', (e as Error).message);
  }
  return new Response('EVENT_RECEIVED', { status: 200 });
});
