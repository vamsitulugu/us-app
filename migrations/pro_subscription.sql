-- ════════════════════════════════════════════════════════════════
--  Pro Subscription System — Twin Hearts
--  Apply in the Supabase SQL editor BEFORE deploying the backend.
--  Pro is per-couple: when either partner pays, both become Pro.
--  ₹99 / month  |  ₹499 lifetime (one-time)
-- ════════════════════════════════════════════════════════════════

-- Pro state lives on the couples row so both partners inherit it.
alter table couples add column if not exists pro_plan text check (pro_plan in ('monthly','lifetime'));
alter table couples add column if not exists pro_expires_at timestamptz;   -- null = lifetime / not set
alter table couples add column if not exists pro_activated_at timestamptz;
alter table couples add column if not exists pro_activated_by text;          -- admin email who approved

-- One payment/upgrade request per submission. Admin reviews and approves.
create table if not exists pro_upgrade_requests (
  id              uuid primary key default gen_random_uuid(),
  couple_id       text not null,
  plan            text not null check (plan in ('monthly','lifetime')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),

  -- who paid
  paid_by_name    text,
  paid_by_phone   text,
  -- their partner (so both are eligible)
  partner_name    text,
  partner_phone   text,

  transaction_id  text,
  payment_proof_url text,          -- uploaded screenshot / QR payment proof
  notes           text,

  requested_at    timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     text,
  review_note     text
);

create index if not exists idx_pro_requests_couple on pro_upgrade_requests(couple_id);
create index if not exists idx_pro_requests_status on pro_upgrade_requests(status);
create index if not exists idx_pro_requests_requested on pro_upgrade_requests(requested_at desc);

-- Block direct browser access; the Express API (service role) is the only writer.
alter table pro_upgrade_requests enable row level security;
drop policy if exists "no_direct_access_pro_requests" on pro_upgrade_requests;
create policy "no_direct_access_pro_requests" on pro_upgrade_requests
  for all to anon, authenticated using (false) with check (false);

comment on table couples is 'Added: pro_plan, pro_expires_at, pro_activated_at, pro_activated_by (Pro subscription)';
comment on table pro_upgrade_requests is 'Pro upgrade payment requests awaiting admin approval';
