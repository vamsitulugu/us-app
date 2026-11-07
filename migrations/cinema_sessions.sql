-- ═══════════════════════════════════════════════════════════════
--  cinema_sessions.sql — Twin Cinema movie-night invites
--  Run once in Supabase → SQL Editor. Safe to run twice.
--  One row = one movie night: lobby → invited → accepted → started → ended
--  (also: declined, expired). All access goes through routes/cinema.js
--  (service-role key); direct anon access is blocked.
-- ═══════════════════════════════════════════════════════════════
create table if not exists cinema_sessions (
  id          uuid primary key default gen_random_uuid(),
  couple_id   text not null,
  host_role   text not null check (host_role in ('user1','user2')),
  host_slot   smallint not null default 1 check (host_slot in (1,2)),   -- cinema avatar of the host: 1 = girl, 2 = boy
  movie       text,
  status      text not null default 'lobby'
              check (status in ('lobby','invited','accepted','declined','started','ended','expired')),
  created_at  timestamptz not null default now(),
  invited_at  timestamptz,
  expires_at  timestamptz not null default (now() + interval '2 hours')
);
create index if not exists idx_cinema_sessions_couple on cinema_sessions(couple_id, created_at desc);
alter table cinema_sessions enable row level security;
drop policy if exists "no_direct_anon_access" on cinema_sessions;
create policy "no_direct_anon_access" on cinema_sessions
  for all to anon, authenticated using (false) with check (false);
