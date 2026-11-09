-- ════════════════════════════════════════════════════════════════
--  Admin system tables + image / repeating notifications
--  Run in the Supabase SQL editor. Safe to run more than once.
--  (The first four tables were used by the admin code but had no migration in the repo.)
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Releases (what the app's update popup reads) ───────────────
create table if not exists app_releases (
  id                     uuid primary key default gen_random_uuid(),
  version                text not null,
  build                  integer,
  title                  text not null,
  message                text,
  notes                  text,
  update_type            text not null default 'optional',
  update_url             text,
  min_supported_version  text,
  platform               text not null default 'all',
  status                 text not null default 'draft',
  published_at           timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists idx_app_releases_status on app_releases(status, published_at desc);

-- ── Audit log ──────────────────────────────────────────────────
create table if not exists admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  admin_email  text not null,
  action       text not null,
  target_type  text,
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_admin_audit_created on admin_audit_log(created_at desc);

-- ── Feature flags ──────────────────────────────────────────────
create table if not exists feature_flags (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  name           text not null,
  description    text,
  enabled        boolean not null default false,
  rollout_type   text not null default 'everyone',
  rollout_value  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── Admin notifications ────────────────────────────────────────
create table if not exists admin_notifications (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  message      text not null,
  type         text not null default 'announcement',
  audience     text not null default 'all',
  release_id   uuid,
  status       text not null default 'draft',
  sent_at      timestamptz,
  result       jsonb,
  created_at   timestamptz not null default now()
);

-- NEW: picture, and repeating pushes ("every N hours until a date")
alter table admin_notifications add column if not exists image_url           text;
alter table admin_notifications add column if not exists start_at            timestamptz;
alter table admin_notifications add column if not exists repeat_every_hours  numeric;
alter table admin_notifications add column if not exists repeat_until        timestamptz;
alter table admin_notifications add column if not exists next_run_at         timestamptz;
alter table admin_notifications add column if not exists last_run_at         timestamptz;
alter table admin_notifications add column if not exists run_count           integer not null default 0;
alter table admin_notifications add column if not exists last_error          text;
create index if not exists idx_admin_notif_due on admin_notifications(next_run_at) where status = 'scheduled';

-- Status / audience now have more values (scheduled, paused, completed, cancelled, android, web):
-- drop any old CHECK constraints that would reject them.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'admin_notifications'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) ilike '%status%' or pg_get_constraintdef(oid) ilike '%audience%'
                  or pg_get_constraintdef(oid) ilike '%type%')
  loop
    execute format('alter table admin_notifications drop constraint %I', c.conname);
  end loop;
end $$;

-- Only the server (service role) touches these tables.
do $$
declare t text;
begin
  foreach t in array array['app_releases','admin_audit_log','feature_flags','admin_notifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "no_direct_access_%s" on %I', t, t);
    execute format('create policy "no_direct_access_%s" on %I for all to anon, authenticated using (false) with check (false)', t, t);
  end loop;
end $$;
