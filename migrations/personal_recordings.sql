-- ═══════════════════════════════════════════════════════════════
-- "My Recordings" — individual voice/video recordings
-- Apply this manually in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════

create table if not exists personal_recordings (
  id            uuid primary key default gen_random_uuid(),
  couple_id     text not null,
  user_id       text not null,      -- role: 'user1' | 'user2' (matches your existing pattern)
  title         text not null default 'Untitled',
  media_type    text not null check (media_type in ('audio','video')),
  media_url     text not null,
  storage_path  text not null,
  duration_sec  integer default 0,
  note          text,
  is_favorite   boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_personal_recordings_couple on personal_recordings(couple_id);

-- Row Level Security: a couple can only ever see/modify their own rows.
-- NOTE: this app authenticates via a custom coupleId/role scheme rather
-- than Supabase Auth sessions, and the server (service-role key) is what
-- actually issues these queries — routes/recordings.js already scopes
-- every query by :coupleId from the URL/body. This RLS is a second,
-- database-level backstop in case the anon key is ever used directly
-- from the client (e.g. the realtime channel below).
alter table personal_recordings enable row level security;

-- Since coupleId isn't tied to Supabase auth.uid() in this app, and all
-- writes go through the server (service role, which bypasses RLS), the
-- practical policy here is: block anon/authenticated roles from
-- reading or writing this table directly. All access must go through
-- your Express API, which is what you already do for `songs`.
create policy "no_direct_anon_access" on personal_recordings
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ── Storage bucket ──
-- Reuses the existing private 'couple-recordings' bucket (already used
-- by /api/media/upload-recording for solo karaoke recordings). No new
-- bucket needed — video files just get uploaded under the same
-- {coupleId}/... prefix with a .webm extension, same as audio.
-- Confirm in Supabase Storage settings that 'couple-recordings' is
-- PRIVATE (not public) — routes/media.js already signs URLs for it,
-- which only makes sense if the bucket itself isn't public.
