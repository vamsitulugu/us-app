-- ════════════════════════════════════════════════════════════════
--  Movie Favorites / Watchlist — Twin Hearts
--  Apply in Supabase SQL editor BEFORE deploying backend.
--  Stores movies added from TMDB search + manual entries.
--  Per-couple: both partners see the same list.
-- ════════════════════════════════════════════════════════════════

create table if not exists movie_favorites (
  id            uuid primary key default gen_random_uuid(),
  couple_id     text not null,
  tmdb_id       text,           -- null for manually added movies
  title         text not null,
  year          text,
  genre         text,
  poster_url    text,
  backdrop_url  text,
  overview      text,
  rating        numeric check (rating >= 0 and rating <= 10),
  status        text not null default 'watchlist'
                check (status in ('watchlist','watching','watched')),
  added_by      text,           -- 'user1' | 'user2' role who added it
  created_at    timestamptz not null default now()
);

create index if not exists idx_movie_fav_couple on movie_favorites(couple_id, created_at desc);
create index if not exists idx_movie_fav_status on movie_favorites(couple_id, status);
create index if not exists idx_movie_fav_tmdb on movie_favorites(tmdb_id);

alter table movie_favorites enable row level security;
drop policy if exists "no_direct_access_movie_fav" on movie_favorites;
create policy "no_direct_access_movie_fav" on movie_favorites
  for all to anon, authenticated using (false) with check (false);

comment on table movie_favorites is 'Couple movie watchlist / favorites (TMDB + manual)';
