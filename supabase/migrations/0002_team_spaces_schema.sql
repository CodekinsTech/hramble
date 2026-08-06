-- Team Spaces: private multi-person teams built on top of the existing
-- Community auth (Supabase Google OAuth). Mirrors the identity convention
-- already used by community_posts (user_id = auth.jwt() ->> 'email'),
-- and the SECURITY DEFINER pattern already used by toggle_like for any
-- mutation that must trust the server-verified JWT over client input.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id text not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  invited_by text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

create table public.team_pieces (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  assigned_to text,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'ready_to_combine', 'combined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_activity (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id text not null,
  type text not null,
  message text,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_pieces enable row level security;
alter table public.team_activity enable row level security;

-- Membership is the gate for everything below. A user can see a team's
-- rows only if they're already in team_members for that team.

create policy teams_select_members on public.teams
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.team_id = teams.id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_members_select_members on public.team_members
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.team_id = team_members.team_id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_invites_select_own_or_member on public.team_invites
  for select to authenticated
  using (
    email = auth.jwt() ->> 'email'
    or exists (
      select 1 from public.team_members m
      where m.team_id = team_invites.team_id and m.user_id = auth.jwt() ->> 'email'
    )
  );

create policy team_pieces_select_members on public.team_pieces
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.team_id = team_pieces.team_id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_pieces_update_members on public.team_pieces
  for update to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.team_id = team_pieces.team_id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_pieces_insert_members on public.team_pieces
  for insert to authenticated
  with check (exists (
    select 1 from public.team_members m
    where m.team_id = team_pieces.team_id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_activity_select_members on public.team_activity
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.team_id = team_activity.team_id and m.user_id = auth.jwt() ->> 'email'
  ));

create policy team_activity_insert_own on public.team_activity
  for insert to authenticated
  with check (
    user_id = auth.jwt() ->> 'email'
    and exists (
      select 1 from public.team_members m
      where m.team_id = team_activity.team_id and m.user_id = auth.jwt() ->> 'email'
    )
  );

-- No direct insert/update policy on teams or team_members: creating a team
-- and becoming its first (owner) member is a chicken-and-egg problem for
-- plain RLS, so it goes through create_team() below, same reasoning as
-- toggle_like needing SECURITY DEFINER to touch community_likes safely.

create function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  uid text := auth.jwt() ->> 'email';
  new_team_id uuid;
begin
  if uid is null then
    raise exception 'auth required';
  end if;

  insert into public.teams (name, owner_id) values (p_name, uid)
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, role)
  values (new_team_id, uid, 'owner');

  return new_team_id;
end;
$$;

grant execute on function public.create_team(text) to authenticated;

create function public.invite_member(p_team_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  uid text := auth.jwt() ->> 'email';
  new_invite_id uuid;
begin
  if uid is null then
    raise exception 'auth required';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = uid
  ) then
    raise exception 'not a team member';
  end if;

  insert into public.team_invites (team_id, email, invited_by)
  values (p_team_id, p_email, uid)
  returning id into new_invite_id;

  return new_invite_id;
end;
$$;

grant execute on function public.invite_member(uuid, text) to authenticated;

create function public.accept_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  uid text := auth.jwt() ->> 'email';
  invite record;
begin
  if uid is null then
    raise exception 'auth required';
  end if;

  select * into invite from public.team_invites where id = p_invite_id;

  if invite is null then
    raise exception 'invite not found';
  end if;

  if invite.email <> uid then
    raise exception 'invite is not for this account';
  end if;

  if invite.status <> 'pending' then
    raise exception 'invite already resolved';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (invite.team_id, uid, 'member')
  on conflict (team_id, user_id) do nothing;

  update public.team_invites set status = 'accepted' where id = p_invite_id;

  return invite.team_id;
end;
$$;

grant execute on function public.accept_invite(uuid) to authenticated;
