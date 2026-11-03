-- ═══════════════════════════════════════════════════════════════
--  rewards_v6_game_cards.sql — Scratch cards won by finishing a couple game
--  Run once in Supabase → SQL Editor, AFTER rewards_v1.sql. Safe to run twice.
--  A finished game puts one card in BOTH partners' "My Scratch Cards" page.
--  The prize is decided by the server when the card is opened (coins go through reward_credit()).
-- ═══════════════════════════════════════════════════════════════
create table if not exists reward_cards (
  id           bigint generated always as identity primary key,
  user_id      text not null,
  couple_id    text not null,
  game         text not null,
  session_id   text not null,
  status       text not null default 'new',        -- 'new' (unscratched) | 'opened'
  day          date not null,                       -- India date the card was won
  prize_id     text,
  coins        integer,
  title        text,
  message      text,
  emoji        text,
  skipped      boolean not null default false,      -- opened with the Skip button
  opened_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, session_id)
);
create index if not exists idx_reward_cards_user on reward_cards(user_id, status, created_at desc);
create index if not exists idx_reward_cards_couple on reward_cards(couple_id, game, created_at desc);
alter table reward_cards enable row level security;
