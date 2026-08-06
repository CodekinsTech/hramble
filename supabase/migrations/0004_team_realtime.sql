-- Enables Supabase Realtime on the tables the Team Spaces dashboard needs to
-- update live for every member (piece status changes, new activity, new
-- members) — without this, postgres_changes subscriptions never fire.
alter publication supabase_realtime add table public.team_pieces;
alter publication supabase_realtime add table public.team_activity;
alter publication supabase_realtime add table public.team_members;
