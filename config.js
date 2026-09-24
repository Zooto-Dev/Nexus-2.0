// Nexus 2.0 config.
// Dono blank = LOCAL mode (data sirf isi browser mein; demo PIN login).
// Dono bhare = CLOUD mode (Supabase Auth login + sab users ka data sync).
//
// SECURITY:
//  * Yahan SIRF "publishable" (anon) key aati hai — ye public hone ke liye
//    designed hai; asli suraksha database ki RLS policies se hoti hai
//    (supabase-schema.sql chalao).
//  * SERVICE_ROLE key kabhi bhi kisi file, app ya chat mein mat daalna.
//  * Supabase dashboard mein public signup band rakho — users admin banayega.
window.NEXUS_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
