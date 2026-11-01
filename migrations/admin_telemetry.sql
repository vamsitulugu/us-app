-- ════════════════════════════════════════════════════════════════
--  Admin telemetry — Android vs Web activity, versions, health
--  Run in the Supabase SQL editor BEFORE deploying. Safe to run twice.
-- ════════════════════════════════════════════════════════════════

-- Which app a user last used, and which version.
alter table users add column if not exists signup_platform   text;
alter table users add column if not exists last_platform     text;
alter table users add column if not exists last_app_version  text;
alter table users add column if not exists last_seen_at      timestamptz;
create index if not exists idx_users_last_seen on users(last_seen_at desc);

-- One row per (day, user, platform): a user on phone + browser counts on both.
create table if not exists app_activity (
  day           date        not null,
  user_id       text        not null,
  platform      text        not null check (platform in ('android','web')),
  kind          text,
  app_version   text,
  last_seen_at  timestamptz not null default now(),
  primary key (day, user_id, platform)
);
create index if not exists idx_app_activity_day on app_activity(day desc);
alter table app_activity enable row level security;
drop policy if exists "no_direct_access_app_activity" on app_activity;
create policy "no_direct_access_app_activity" on app_activity
  for all to anon, authenticated using (false) with check (false);

-- Health page: error log already exists in your database; make sure it has
-- the columns the code writes, and add platform + version.
create table if not exists app_error_log (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  message     text not null,
  severity    text not null default 'warning' check (severity in ('info','warning','critical')),
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table app_error_log add column if not exists platform    text not null default 'server';
alter table app_error_log add column if not exists app_version text;
create index if not exists idx_app_error_log_created on app_error_log(created_at desc);

-- Active users per platform: today / last 7 days / last 30 days.
create or replace function admin_active_stats()
returns table (platform text, dau bigint, wau bigint, mau bigint)
language sql stable as $$
  select p.platform,
    count(distinct a.user_id) filter (where a.day = current_date),
    count(distinct a.user_id) filter (where a.day > current_date - 7),
    count(distinct a.user_id) filter (where a.day > current_date - 30)
  from (values ('android'),('web')) as p(platform)
  left join app_activity a on a.platform = p.platform
  group by p.platform
  union all
  select 'all',
    count(distinct user_id) filter (where day = current_date),
    count(distinct user_id) filter (where day > current_date - 7),
    count(distinct user_id) filter (where day > current_date - 30)
  from app_activity;
$$;

-- Daily active users per platform for the last n days (missing days = 0).
create or replace function admin_dau_trend(n integer default 14)
returns table (day date, android bigint, web bigint)
language sql stable as $$
  select d::date,
    count(distinct a.user_id) filter (where a.platform = 'android'),
    count(distinct a.user_id) filter (where a.platform = 'web')
  from generate_series(current_date - (greatest(n,1) - 1), current_date, interval '1 day') d
  left join app_activity a on a.day = d::date
  group by d order by d;
$$;

-- Version spread among people active in the last 30 days.
create or replace function admin_version_spread()
returns table (platform text, app_version text, users bigint)
language sql stable as $$
  select platform, coalesce(app_version,'unknown'), count(distinct user_id)
  from app_activity where day > current_date - 30
  group by 1,2 order by 1, 3 desc;
$$;

revoke all on function admin_active_stats(), admin_dau_trend(integer), admin_version_spread() from anon, authenticated;

-- Notifications can now target "android" or "web" users. If your admin_notifications.audience
-- column has a CHECK constraint limiting it to all/user1/user2, remove it so the new values save.
do $$
declare c record;
begin
  if to_regclass('admin_notifications') is not null then
    for c in select conname from pg_constraint
             where conrelid = 'admin_notifications'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%audience%'
    loop
      execute format('alter table admin_notifications drop constraint %I', c.conname);
    end loop;
  end if;
end $$;
