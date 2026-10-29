-- 2026-10-29: a logged-in user could download every nx_docs row (the app loads all collections and filtered on screen only).
-- WhatsApp log, mail queue and the audit trail are now readable by Admin / Super Admin only (applied live with ALTER POLICY).
alter policy "nx read" on public.nx_docs using (collection not in ('wa_log', 'mail_queue', 'audit') or nx_is_admin());
