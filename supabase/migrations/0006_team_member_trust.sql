-- Master Session: lets the team owner mark specific members as "trusted" to
-- combine pieces directly, without asking the owner every time. Owners can
-- already combine anything (client-side gate); this grants that same
-- ability to individual members the owner has flagged, while everyone else
-- still needs the owner to combine on their behalf.
alter table public.team_members add column can_combine boolean not null default false;

create function public.set_member_trust(p_team_id uuid, p_user_id text, p_can_combine boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  caller text := auth.jwt() ->> 'email';
begin
  if caller is null then
    raise exception 'auth required';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = caller and role = 'owner'
  ) then
    raise exception 'only the team owner can grant combine trust';
  end if;

  update public.team_members
  set can_combine = p_can_combine
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_trust(uuid, text, boolean) to authenticated;
