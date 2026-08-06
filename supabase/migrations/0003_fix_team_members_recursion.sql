-- Fixes Postgres error 42P17 "infinite recursion detected in policy for
-- relation team_members": every policy added in 0002 checks membership via
-- `exists (select 1 from team_members where ...)`, and since team_members
-- itself has a select policy shaped the same way, that subquery re-triggers
-- team_members' own RLS check, which subqueries team_members again, forever.
--
-- Standard fix: a SECURITY DEFINER function bypasses RLS on the table it
-- queries internally (table owners are exempt from their own table's RLS
-- unless FORCE ROW LEVEL SECURITY is set, which these tables don't have),
-- so calling it from a policy can't recurse back into that policy.

create function public.is_team_member(p_team_id uuid, p_user_id text)
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id
  );
$$;

grant execute on function public.is_team_member(uuid, text) to authenticated;

drop policy teams_select_members on public.teams;
create policy teams_select_members on public.teams
  for select to authenticated
  using (public.is_team_member(id, auth.jwt() ->> 'email'));

drop policy team_members_select_members on public.team_members;
create policy team_members_select_members on public.team_members
  for select to authenticated
  using (public.is_team_member(team_id, auth.jwt() ->> 'email'));

drop policy team_invites_select_own_or_member on public.team_invites;
create policy team_invites_select_own_or_member on public.team_invites
  for select to authenticated
  using (
    email = auth.jwt() ->> 'email'
    or public.is_team_member(team_id, auth.jwt() ->> 'email')
  );

drop policy team_pieces_select_members on public.team_pieces;
create policy team_pieces_select_members on public.team_pieces
  for select to authenticated
  using (public.is_team_member(team_id, auth.jwt() ->> 'email'));

drop policy team_pieces_update_members on public.team_pieces;
create policy team_pieces_update_members on public.team_pieces
  for update to authenticated
  using (public.is_team_member(team_id, auth.jwt() ->> 'email'));

drop policy team_pieces_insert_members on public.team_pieces;
create policy team_pieces_insert_members on public.team_pieces
  for insert to authenticated
  with check (public.is_team_member(team_id, auth.jwt() ->> 'email'));

drop policy team_activity_select_members on public.team_activity;
create policy team_activity_select_members on public.team_activity
  for select to authenticated
  using (public.is_team_member(team_id, auth.jwt() ->> 'email'));

drop policy team_activity_insert_own on public.team_activity;
create policy team_activity_insert_own on public.team_activity
  for insert to authenticated
  with check (
    user_id = auth.jwt() ->> 'email'
    and public.is_team_member(team_id, auth.jwt() ->> 'email')
  );
