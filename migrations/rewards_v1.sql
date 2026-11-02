-- ═══════════════════════════════════════════════════════════════
--  rewards_v1.sql — Twin Rewards, Step 1 (wallet, check-in, streaks)
--  Run once in Supabase → SQL Editor.
--  Coins live ONLY in these tables. The apps never write them; only
--  the Express API (service role) does, through reward_credit().
-- ═══════════════════════════════════════════════════════════════

create table if not exists reward_wallets (
  user_id         text primary key,
  couple_id       text not null,
  balance         integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0,
  lifetime_spent  integer not null default 0,
  updated_at      timestamptz not null default now()
);
create index if not exists idx_reward_wallets_couple on reward_wallets(couple_id);

create table if not exists coin_transactions (
  id          bigint generated always as identity primary key,
  user_id     text not null,
  couple_id   text not null,
  amount      integer not null,                -- + earned, - spent
  kind        text not null,                   -- 'checkin', later 'spin', 'gift', ...
  idem_key    text not null,                   -- stops a double tap paying twice
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, idem_key)
);
create index if not exists idx_coin_tx_user on coin_transactions(user_id, created_at desc);

create table if not exists reward_checkins (
  user_id    text not null,
  couple_id  text not null,
  day        date not null,                    -- India date (Asia/Kolkata)
  streak     integer not null,
  coins      integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists idx_reward_checkins_couple on reward_checkins(couple_id, day desc);

-- Prize values the admin can change later without an app update.
create table if not exists reward_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only the Express API (service role) may touch these.
alter table reward_wallets     enable row level security;
alter table coin_transactions  enable row level security;
alter table reward_checkins    enable row level security;
alter table reward_config      enable row level security;

-- ── The ONE place coins change ──────────────────────────────────
-- Adds (or, with a negative amount, spends) coins atomically.
-- Same (user, idem_key) twice → second call changes nothing.
create or replace function reward_credit(
  p_user text, p_couple text, p_amount integer,
  p_kind text, p_idem text, p_meta jsonb default '{}'::jsonb
) returns table (applied boolean, balance integer)
language plpgsql security definer as $$
declare
  v_inserted bigint;
  v_balance  integer;
begin
  insert into reward_wallets(user_id, couple_id) values (p_user, p_couple)
    on conflict (user_id) do nothing;

  -- lock the wallet row so two requests can't overspend
  select w.balance into v_balance from reward_wallets w where w.user_id = p_user for update;

  if p_amount < 0 and v_balance + p_amount < 0 then
    return query select false, v_balance;  -- not enough coins
    return;
  end if;

  insert into coin_transactions(user_id, couple_id, amount, kind, idem_key, meta)
    values (p_user, p_couple, p_amount, p_kind, p_idem, coalesce(p_meta, '{}'::jsonb))
    on conflict (user_id, idem_key) do nothing
    returning id into v_inserted;

  if v_inserted is null then
    return query select false, v_balance;  -- already applied earlier
    return;
  end if;

  update reward_wallets w set
      balance         = w.balance + p_amount,
      lifetime_earned = w.lifetime_earned + greatest(p_amount, 0),
      lifetime_spent  = w.lifetime_spent  + greatest(-p_amount, 0),
      updated_at      = now()
    where w.user_id = p_user
    returning w.balance into v_balance;

  return query select true, v_balance;
end $$;

revoke all on function reward_credit(text,text,integer,text,text,jsonb) from public, anon, authenticated;
