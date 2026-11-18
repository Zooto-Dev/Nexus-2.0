-- 2026-11-18 — item photos load only when somebody taps the photo icon.
--
-- materials.photo (base64, 13 MB of the 14 MB of materials) was downloaded by every user on every
-- app load. From build 183 the app bulk-loads from nx_docs_lite, which hands out a material WITHOUT
-- its photo and with has_photo = true/false instead; the photo itself is fetched from nx_docs for
-- one item at a time, when its icon is tapped (or when a PO is printed).
--
-- A material saved by the app may now arrive without the photo key at all (the browser never had
-- it). The trigger below keeps the stored photo in that case. A write that carries photo: '' still
-- removes it — that is an intentional removal, the key is present.

create or replace view public.nx_docs_lite with (security_invoker = true) as
select collection, id,
  case when collection = 'materials' and data ? 'photo'
       then (data - 'photo') || jsonb_build_object('has_photo', coalesce(data->>'photo', '') <> '')
       else data end as data,
  updated_at
from public.nx_docs;
grant select on public.nx_docs_lite to authenticated;

create or replace view public.nx_demo_lite with (security_invoker = true) as
select collection, id,
  case when collection = 'materials' and data ? 'photo'
       then (data - 'photo') || jsonb_build_object('has_photo', coalesce(data->>'photo', '') <> '')
       else data end as data,
  updated_at
from public.nx_demo;
grant select on public.nx_demo_lite to authenticated, anon;

create or replace function public.nx_keep_photo() returns trigger language plpgsql as $$
begin
  if new.collection = 'materials' then
    new.data := new.data - 'has_photo';
    if tg_op = 'UPDATE' and not (new.data ? 'photo') and (old.data ? 'photo') then
      new.data := new.data || jsonb_build_object('photo', old.data->'photo');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists nx_keep_photo on public.nx_docs;
create trigger nx_keep_photo before insert or update on public.nx_docs for each row execute function public.nx_keep_photo();
drop trigger if exists nx_keep_photo on public.nx_demo;
create trigger nx_keep_photo before insert or update on public.nx_demo for each row execute function public.nx_keep_photo();
