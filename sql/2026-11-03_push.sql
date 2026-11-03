-- Nexus 2.0 — phone notifications.
-- Both tables have RLS on with NO policy, so only the edge function (service role) can read or write them.
-- The VAPID private key therefore never reaches a browser.
create table if not exists public.nx_push_keys (
  id int primary key default 1,
  public_key text not null,
  private_key text not null,
  created_at timestamptz default now(),
  check (id = 1)
);
alter table public.nx_push_keys enable row level security;

create table if not exists public.nx_push_subs (
  id text primary key,
  user_id uuid not null,
  doer text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  agent text,
  created_at timestamptz default now(),
  last_ok timestamptz,
  fails int default 0
);
alter table public.nx_push_subs enable row level security;
create index if not exists nx_push_subs_doer on public.nx_push_subs (upper(doer));

-- what happened to each notification (RLS on, no policy: only the edge function writes and reads it)
create table if not exists public.nx_push_log (
  id bigserial primary key,
  at timestamptz default now(),
  action text,
  user_id uuid,
  doer text,
  sent int default 0,
  gone int default 0,
  recipients int default 0,
  err text
);
alter table public.nx_push_log enable row level security;
create index if not exists nx_push_log_at on public.nx_push_log (at desc);

-- the grants that were missing: the edge functions run as service_role, and without these every
-- read and write above was refused, so nothing was ever stored and no notification went out.
-- anon and authenticated are left with nothing on purpose: a browser must never touch these tables.
grant select, insert, update, delete on
  public.nx_push_keys, public.nx_push_subs, public.nx_push_log, public.nx_alarms, public.nx_cron
  to service_role;
grant usage, select on sequence public.nx_push_log_id_seq to service_role;

-- when something has to ring. A row holds only WHICH record and WHICH date; the words are read
-- from the record at ringing time, so a browser can never dictate them.
create table if not exists public.nx_alarms (
  id text primary key,
  at timestamptz not null,
  kind text not null,
  ref_id text not null,
  ref_date text,
  doer text,
  title text,
  fired_at timestamptz,
  created_at timestamptz default now()
);
alter table public.nx_alarms enable row level security;
create index if not exists nx_alarms_due on public.nx_alarms (at) where fired_at is null;

-- the key the scheduler uses to call nx-due. Made in the database, never leaves the server.
create table if not exists public.nx_cron (id int primary key default 1, token text not null, check (id = 1));
alter table public.nx_cron enable row level security;
insert into public.nx_cron (id, token)
select 1, encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from public.nx_cron where id = 1);

-- once a minute: ring whatever has come due. The key is read at run time, so it is not stored in the job.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('nexus-due', '* * * * *',
  $$select net.http_post(
      url := 'https://nvpdncpvqwcalibpttdx.supabase.co/functions/v1/nx-due',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json','x-nx-key',(select token from public.nx_cron where id = 1)),
      timeout_milliseconds := 20000)$$);

-- which records have already been announced. The browser tries at once and the minute-by-minute
-- scheduler tries again; whichever claims the row first sends, so the person gets exactly one.
create table if not exists public.nx_push_seen (
  id text primary key,
  at timestamptz default now()
);
alter table public.nx_push_seen enable row level security;
grant select, insert, update, delete on public.nx_push_seen to service_role;
create index if not exists nx_push_seen_at on public.nx_push_seen (at);

-- a reminder keeps coming back every few minutes until it is stopped or the work is finished
alter table public.nx_alarms add column if not exists last_at timestamptz;
alter table public.nx_alarms add column if not exists repeats int default 0;
-- the scheduler looks only at what changed recently
create index if not exists nx_docs_recent on public.nx_docs (collection, updated_at desc);
