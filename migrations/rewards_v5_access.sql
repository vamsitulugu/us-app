-- ═══════════════════════════════════════════════════════════════
--  rewards_v5_access.sql — free daily uses + coin passes (movie, songs, pins, games)
--  Run once in Supabase → SQL Editor, AFTER rewards_v1..v4. Safe to run twice.
--  kind 'use'  = one free try used today (per person, counted by India day)
--  kind 'pass' = a coin pass, shared by both partners until expires_at
--  Coins are taken through reward_credit() as before; this table only remembers uses and passes.
-- ═══════════════════════════════════════════════════════════════
create table if not exists reward_access (
  id          bigint generated always as identity primary key,
  couple_id   text not null,
  user_id     text not null,
  feature     text not null,                       -- 'movie' | 'songs' | 'pins' | 'games'
  kind        text not null check (kind in ('use','pass')),
  day         text not null,                       -- YYYY-MM-DD (India time)
  expires_at  timestamptz,                         -- passes only
  client_id   text,                                -- passes only (retry safety)
  created_at  timestamptz not null default now()
);
create index if not exists idx_reward_access_user on reward_access(user_id, feature, kind, day);
create index if not exists idx_reward_access_couple on reward_access(couple_id, feature, kind, expires_at desc);
create unique index if not exists uq_reward_access_client on reward_access(client_id) where client_id is not null;
alter table reward_access enable row level security;

-- Optional: tune numbers without a release
-- insert into reward_config(key, value) values ('access_rules',
--   '{"movie":{"free":1,"price":20,"hours":12},"songs":{"free":5,"price":10,"hours":12},"pins":{"free":3,"price":10,"hours":24},"games":{"free":3,"price":10,"hours":12}}')
-- on conflict (key) do update set value = excluded.value;
