// Nexus 2.0 config.
// Both blank = LOCAL mode (data stays in this browser; demo PIN login).
// Both filled = CLOUD mode (Supabase Auth login + data synced for all users).
//
// SECURITY:
//  * Only the "publishable" (anon) key goes here — it is designed to be
//    public; real security comes from the database RLS policies
//    (run supabase-schema.sql).
//  * Never put the SERVICE_ROLE key in any file, app or chat.
//  * Keep public signup disabled in the Supabase dashboard — an admin creates users.
window.NEXUS_CONFIG = {
  SUPABASE_URL: 'https://nvpdncpvqwcalibpttdx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_YHv5q1-Lmlrgzl2I0s_Ekw_g6Qpvwg-'
};
