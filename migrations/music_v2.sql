-- ═══════════════════════════════════════════════════════════════
-- Music v2 — apply once in the Supabase SQL editor.
--
-- Everything here is ADDITIVE and idempotent (safe to run twice).
-- The server (routes/music.js, routes/recordings.js)
-- keeps working with graceful fallbacks if this has not been applied yet:
--   · per-user likes / play history fall back to songs.favorite / songs.last_played
--   · playlists report "needs database update" instead of crashing
--
-- As with personal_recordings, every table is locked to the service role:
-- the app talks to them only through the Express API, which scopes every
-- query by couple_id. The deny-all policies are a database-level backstop.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Per-user song state (likes, play counts, listening history) ──
create table if not exists music_user_state (
  couple_id    text        not null,
  song_id      text        not null,
  user_id      text        not null,               -- 'user1' | 'user2'
  is_liked     boolean     not null default false,
  liked_at     timestamptz,
  play_count   integer     not null default 0,
  last_played  timestamptz,
  primary key (song_id, user_id)
);
create index if not exists idx_music_user_state_couple_user
  on music_user_state (couple_id, user_id);

-- ── 2. Shared playlists ─────────────────────────────────────────
create table if not exists music_playlists (
  id           uuid        primary key default gen_random_uuid(),
  couple_id    text        not null,
  name         text        not null,
  description  text,
  created_by   text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_music_playlists_couple on music_playlists (couple_id);

create table if not exists music_playlist_songs (
  playlist_id  uuid        not null references music_playlists(id) on delete cascade,
  song_id      text        not null,
  position     integer     not null default 0,
  added_by     text,
  added_at     timestamptz not null default now(),
  primary key (playlist_id, song_id)
);
create index if not exists idx_music_playlist_songs_song on music_playlist_songs (song_id);

-- ── 3. Recordings: tag karaoke takes so they can show up under the right song ──
alter table personal_recordings add column if not exists kind    text not null default 'voice';  -- 'voice' | 'karaoke'
alter table personal_recordings add column if not exists song_id text;

-- ── 4. Atomic play counter for the song's total plays ──────────
create or replace function music_increment_play(p_song_id text)
returns void
language sql
as $$
  update songs
     set play_count  = coalesce(play_count, 0) + 1,
         last_played = now()
   where id::text = p_song_id;
$$;

-- ── 5. Lock the new tables to the service role ─────────────────
alter table music_user_state      enable row level security;
alter table music_playlists       enable row level security;
alter table music_playlist_songs  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['music_user_state','music_playlists','music_playlist_songs'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'no_direct_anon_access') then
      execute format(
        'create policy "no_direct_anon_access" on %I for all to anon, authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;
