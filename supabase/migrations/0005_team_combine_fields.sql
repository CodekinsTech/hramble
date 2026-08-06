-- Fields needed for the Combine button: which local repo a team merges
-- into, and which branch each piece merges from.
alter table public.teams add column project_directory text;
alter table public.team_pieces add column branch_name text;
alter table public.team_pieces add column last_combine_error text;

-- 0002 never added an UPDATE policy on teams (only insert-via-RPC + select) —
-- needed now so any member can set project_directory.
create policy teams_update_members on public.teams
  for update to authenticated
  using (public.is_team_member(id, auth.jwt() ->> 'email'));
