-- ═══════════════════════════════════════════════════════════════
-- Profile "Highlights" (Instagram-style circles with clips inside)
-- Apply this manually in the Supabase SQL editor.
-- Media files live in the existing public 'couple-photos' bucket
-- under  <coupleId>/highlights/…  so no new bucket is needed.
-- ═══════════════════════════════════════════════════════════════

create table if not exists highlights (
  id          uuid primary key default gen_random_uuid(),
  couple_id   text not null,
  user_id     text not null,                       -- role: 'user1' | 'user2' (same pattern as personal_recordings)
  title       text not null default 'Highlights',
  category    text not null default 'other',       -- travel | love | dates | friends | family | food | events | fun | other
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_highlights_couple on highlights(couple_id);

create table if not exists highlight_items (
  id            uuid primary key default gen_random_uuid(),
  highlight_id  uuid not null references highlights(id) on delete cascade,
  couple_id     text not null,
  user_id       text not null,
  media_type    text not null check (media_type in ('image','video')),
  media_url     text not null,
  storage_path  text not null,
  duration_sec  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_highlight_items_highlight on highlight_items(highlight_id);
create index if not exists idx_highlight_items_couple on highlight_items(couple_id);

-- All access goes through the Express API (service key). Block direct anon access,
-- exactly like personal_recordings.
alter table highlights enable row level security;
alter table highlight_items enable row level security;

drop policy if exists "no_direct_anon_access" on highlights;
create policy "no_direct_anon_access" on highlights
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "no_direct_anon_access" on highlight_items;
create policy "no_direct_anon_access" on highlight_items
  for all to anon, authenticated using (false) with check (false);
