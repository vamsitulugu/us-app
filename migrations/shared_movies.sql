-- ═══════════════════════════════════════════════════════════════
-- Watch Together — "Shared Cloud Storage" (Cloudflare R2) metadata
-- Apply manually in the Supabase SQL editor BEFORE deploying the
-- matching backend. The video bytes live in a PRIVATE R2 bucket;
-- this table only stores metadata + the R2 object key.
-- ═══════════════════════════════════════════════════════════════

create table if not exists shared_movies (
  id            uuid primary key default gen_random_uuid(),
  couple_id     text not null,
  title         text not null,
  object_key    text not null unique,      -- R2 key, e.g. movies/<coupleId>/<uuid>.mp4
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  duration_sec  numeric not null check (duration_sec > 0),
  status        text not null default 'uploading' check (status in ('uploading','ready')),
  upload_id     text,                      -- R2 multipart upload id while status='uploading'
  uploaded_by   text,                      -- users.id of the uploader
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists idx_shared_movies_couple on shared_movies(couple_id, created_at desc);

-- Same pattern as personal_recordings: all access goes through the
-- Express API (service-role key). Block direct anon/authenticated access.
alter table shared_movies enable row level security;
drop policy if exists "no_direct_anon_access" on shared_movies;
create policy "no_direct_anon_access" on shared_movies
  for all to anon, authenticated using (false) with check (false);

-- Room → which shared movie (if any) the current session streams.
-- NULL = Direct Device Video mode (existing behaviour, unchanged).
alter table watch_sessions add column if not exists shared_movie_id uuid;
