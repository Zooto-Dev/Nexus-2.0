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
