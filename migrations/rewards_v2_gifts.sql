-- ═══════════════════════════════════════════════════════════════
--  rewards_v2_gifts.sql — Twin Rewards, Step 2 (Gift Shop)
--  Run once in Supabase → SQL Editor, AFTER rewards_v1.sql. Safe to run twice.
--  Coins are spent through reward_credit() (already created in v1).
--  This table is only a log of who sent which gift (for stats / abuse checks).
-- ═══════════════════════════════════════════════════════════════
create table if not exists gifts_sent (
  id            bigint generated always as identity primary key,
  couple_id     text not null,
  sender_id     text not null,
  sender_role   text not null,
  gift_id       text not null,
  price         integer not null,
  message_id    bigint,
  client_id     text not null,
  created_at    timestamptz not null default now(),
  unique (sender_id, client_id)
);
create index if not exists idx_gifts_sent_couple on gifts_sent(couple_id, created_at desc);
create index if not exists idx_gifts_sent_sender on gifts_sent(sender_id, created_at desc);
alter table gifts_sent enable row level security;
