-- 2026-11-18 — BOM Sections master (Settings › BOM Sections): every section belongs to one process.
-- 38 rows loaded into nx_docs (collection bom_sections) from the list given on 18 Nov 2026; the app
-- (build 184) offers them as dropdowns on the Development BOM and fills the process from the section.
-- Only admins may add or delete rows (same as users / roles / settings / processes):
alter policy "nx insert" on nx_docs with check ((collection <> all (array['users','roles','settings','processes','bom_sections'])) or nx_is_admin());
alter policy "nx delete" on nx_docs using ((collection <> 'audit') and ((collection <> all (array['users','roles','settings','processes','bom_sections'])) or nx_is_admin()));
