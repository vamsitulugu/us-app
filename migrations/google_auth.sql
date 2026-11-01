-- Continue with Google: remember which Google account an app account was created/linked with.
-- Optional — Google sign-in works without it (the server just skips saving the id), but run it
-- in the Supabase SQL editor so accounts are linked properly.
alter table users add column if not exists google_sub text;
create unique index if not exists users_google_sub_idx on users (google_sub) where google_sub is not null;
