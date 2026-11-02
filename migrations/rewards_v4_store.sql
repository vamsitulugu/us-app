-- ═══════════════════════════════════════════════════════════════
--  rewards_v4_store.sql — Twin Rewards, Step 4 (Twin Store & Spend Sinks)
--  Run once in Supabase → SQL Editor, AFTER rewards_v1..v3. Safe to run twice.
--  Coins are spent through reward_credit() (created in v1).
--  This table records unlocked store items and equipped selections.
-- ═══════════════════════════════════════════════════════════════

create table if not exists reward_purchases (
  id            bigint generated always as identity primary key,
  couple_id     text not null,
  user_id       text not null,
  item_id       text not null,
  category      text not null,                    -- 'theme', 'frame', 'decor', 'game'
  price         integer not null,
  client_id     text not null,
  created_at    timestamptz not null default now(),
  unique (couple_id, item_id)
);
create index if not exists idx_reward_purchases_couple on reward_purchases(couple_id, created_at desc);
create index if not exists idx_reward_purchases_user on reward_purchases(user_id, created_at desc);
alter table reward_purchases enable row level security;

create table if not exists reward_equipped (
  couple_id     text not null,
  category      text not null,                    -- 'theme', 'frame', 'decor'
  user_id       text not null default '',         -- '' for couple-wide (theme/decor), user_id for personal (frame)
  item_id       text not null,
  updated_at    timestamptz not null default now(),
  primary key (couple_id, category, user_id)
);
create index if not exists idx_reward_equipped_couple on reward_equipped(couple_id);
alter table reward_equipped enable row level security;
