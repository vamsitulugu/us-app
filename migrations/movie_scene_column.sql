-- Run once in the Supabase SQL editor. Lets a movie keep its favourite scene / quote.
alter table movie_favorites add column if not exists scene text;
