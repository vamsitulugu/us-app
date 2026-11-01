-- ════════════════════════════════════════════════════════════════
--  Pro Subscription System — Twin Hearts
--  Apply in the Supabase SQL editor BEFORE deploying the backend.
--  Pro is per-couple: when either partner pays, both become Pro.
--  Payments are handled by Razorpay (see pro_razorpay.sql / RAZORPAY_SETUP.md).
-- ════════════════════════════════════════════════════════════════

-- Pro state lives on the couples row so both partners inherit it.
alter table couples add column if not exists pro_plan text check (pro_plan in ('monthly','lifetime'));
alter table couples add column if not exists pro_expires_at timestamptz;   -- null = lifetime / not set
alter table couples add column if not exists pro_activated_at timestamptz;
alter table couples add column if not exists pro_activated_by text;          -- 'razorpay' (set automatically after a verified payment)

comment on table couples is 'Added: pro_plan, pro_expires_at, pro_activated_at, pro_activated_by (Pro subscription)';
