-- ═══════════════════════════════════════════════════════════════
--  rewards_v3_spin_scratch.sql — Twin Rewards, Step 3 (Spin & Win and Scratch cards)
--  Run once in Supabase → SQL Editor, AFTER rewards_v1.sql. Safe to run twice.
--  Coins are credited through reward_credit() (created in v1).
--  These tables track the daily spin and scratch results for audit, limits and idempotency.
-- ═══════════════════════════════════════════════════════════════

create table if not exists reward_spins (
  id            bigint generated always as identity primary key,
  user_id       text not null,
  couple_id     text not null,
  day           date not null,                    -- India date (Asia/Kolkata)
  slice_index   integer not null,
  coins         integer not null,
  label         text not null,
  source        text not null default 'daily',
  client_id     text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists idx_reward_spins_user on reward_spins(user_id, day desc);
create index if not exists idx_reward_spins_couple on reward_spins(couple_id, day desc);
alter table reward_spins enable row level security;

create table if not exists reward_scratches (
  id            bigint generated always as identity primary key,
  user_id       text not null,
  couple_id     text not null,
  day           date not null,                    -- India date (Asia/Kolkata)
  prize_id      text not null,
  coins         integer not null,
  title         text not null,
  message       text not null,
  source        text not null default 'daily',
  client_id     text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists idx_reward_scratches_user on reward_scratches(user_id, day desc);
create index if not exists idx_reward_scratches_couple on reward_scratches(couple_id, day desc);
alter table reward_scratches enable row level security;
