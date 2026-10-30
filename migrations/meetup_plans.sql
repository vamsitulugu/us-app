-- Meet Planner: table the routes in routes/meetplanner.js read and write.
-- Safe to run more than once. Run it in the Supabase SQL editor ONLY if the table does not exist yet.
create table if not exists meetup_plans (
  id               bigint generated always as identity primary key,
  couple_id        text not null,
  title            text not null default 'Our Meetup',
  meet_date        date,
  budget           numeric,
  currency         text default 'INR',
  city_name        text,
  city_lat         double precision,
  city_lng         double precision,
  stops            jsonb not null default '[]'::jsonb,
  route_geometry   jsonb,
  total_distance_km numeric,
  total_duration_min numeric,
  travel_mode      text default 'car',
  checklist        jsonb not null default '[]'::jsonb,
  notes            text,
  status           text not null default 'planned',
  created_by       text,
  globe_synced     boolean not null default false,
  globe_memory_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meetup_plans_couple_idx on meetup_plans (couple_id, meet_date);
