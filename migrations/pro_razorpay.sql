-- ════════════════════════════════════════════════════════════════
--  Pro via Razorpay — Twin Hearts
--  Run in the Supabase SQL editor BEFORE deploying the backend.
--  Safe to run more than once. Builds on migrations/pro_subscription.sql
--  (the pro_* columns on `couples`).
--
--  Plans (prices live in lib/pro-plans.js, never in the browser):
--    monthly  ₹99   → 30 days, one-time payment (no auto-renew)
--    yearly   ₹499  → 365 days, one-time payment
--    lifetime ₹999  → never expires
-- ════════════════════════════════════════════════════════════════

-- 'yearly' is a new plan value, so widen the old CHECK constraint.
alter table couples drop constraint if exists couples_pro_plan_check;
alter table couples add constraint couples_pro_plan_check
  check (pro_plan is null or pro_plan in ('monthly','yearly','lifetime'));

-- One row per Razorpay order. Pro is only granted when a row flips
-- from 'created' to 'paid' after the payment signature is verified.
create table if not exists pro_payments (
  id                   uuid primary key default gen_random_uuid(),
  couple_id            text not null,
  user_id              text,
  plan                 text not null check (plan in ('monthly','yearly','lifetime')),
  amount_paise         integer not null,
  currency             text not null default 'INR',
  status               text not null default 'created' check (status in ('created','paid','failed')),
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text,
  source               text,               -- 'verify' (app/web) or 'webhook'
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);

create index if not exists idx_pro_payments_couple on pro_payments(couple_id, created_at desc);
create index if not exists idx_pro_payments_status on pro_payments(status);

-- Block direct browser access; only the Express API (service role) reads/writes.
alter table pro_payments enable row level security;
drop policy if exists "no_direct_access_pro_payments" on pro_payments;
create policy "no_direct_access_pro_payments" on pro_payments
  for all to anon, authenticated using (false) with check (false);

comment on table pro_payments is 'Razorpay orders/payments for Pro (verified server-side)';
