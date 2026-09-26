# Nexus 2.0 — standing rules

## Tables (every list / report screen)
- One row per item/line. A PO with 10 items = 10 rows; BOM with 8 items = 8 rows.
- Every field in its own column. Never stack two values in one cell (no `<br>`, no `·` joins,
  no muted sub-text under a value, no "A · B" combined columns, no rowspan-merged data cells).
- Document-level values (PO No, Date, Vendor, Brand…) repeat on every row of that document.
- First row of each document gets `class="bomfirst"` (separator line; pagination keeps the document together).
- Action buttons (Print / Edit / Cancel) only on the first row of a document.
- Nothing wraps (`.tbl-wrap` tables are nowrap); dates always include the year.

## Screens
- No page titles, subtitles, hint/explanatory text, legends or generic card headers on screens —
  explanations belong in the documentation and flowcharts.
- Dropdowns instead of free text wherever a master list exists.
- Print format = screen format.

## Security
- Never expose the Supabase service_role key or any provider API key in the browser, repo or chat.
- New Supabase views: `security_invoker = true`, select granted to `authenticated` only.
