-- ═══════════════════════════════════════════════════════════════
-- Support & Customer Care Migration — Twin Hearts
-- Apply once in the Supabase SQL editor.
-- Everything is idempotent (safe to run multiple times).
-- ═══════════════════════════════════════════════════════════════

-- 1. Support Tickets Table
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  couple_id text,
  user_name text not null default 'User',
  user_email text,
  user_phone text,
  subject text default 'General Inquiry',
  status text not null default 'open',          -- 'open', 'waiting_admin', 'waiting_user', 'resolved'
  mode text not null default 'ai',              -- 'ai' (AI handled) or 'human' (manual agent)
  last_message text,
  unread_admin integer not null default 0,
  unread_user integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_status on support_tickets (status);
create index if not exists idx_support_tickets_couple on support_tickets (couple_id);
create index if not exists idx_support_tickets_updated on support_tickets (updated_at desc);

-- 2. Support Messages Table
create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender text not null,                         -- 'user', 'ai', 'admin'
  sender_name text not null,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_messages_ticket on support_messages (ticket_id, created_at asc);
