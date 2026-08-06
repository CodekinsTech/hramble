-- Hramble Community feed schema — mirrors AvatarBox's proven Prompter
-- architecture (public read, owner-only write, likes locked behind a
-- SECURITY DEFINER RPC so they can never be forged by a direct client write).
-- Pulled live from AvatarBox's Supabase project (ceqictcnlfomtyotmwmo) via
-- pg_policies / pg_get_functiondef and adapted — table/column names differ,
-- the security model is identical.
--
-- Run this against the NEW Hramble Supabase project once it exists (task:
-- "Create new Supabase project for Hramble" — blocked on the org's free-tier
-- project limit as of 2026-08-04, see memory project_hramble_community_backend).
--
-- Scope note: only what apps/desktop/src/renderer/components/community-page.tsx
-- actually uses today — posts + likes. No comments/reports tables — the current
-- UI has no comment thread or report button, so there's nothing to back yet.
-- Add them later with the same SECURITY DEFINER pattern if a comment UI ships.

create table if not exists public.community_posts (
	id text primary key,
	user_id text not null,               -- auth.jwt() ->> 'email' of the author
	username text not null default 'Anonymous',
	type text not null check (type in ('build', 'skill')),
	caption text,
	img text,                            -- public R2 URL (see apps/community-api), null until uploaded
	repo_url text,
	skill jsonb,                         -- {name, description, instructions} for type='skill', null otherwise
	likes integer not null default 0,
	created_at timestamptz not null default now()
);

create table if not exists public.community_likes (
	post_id text not null references public.community_posts (id) on delete cascade,
	user_id text not null,               -- auth.jwt() ->> 'email' of the liker
	primary key (post_id, user_id)
);

alter table public.community_posts enable row level security;
alter table public.community_likes enable row level security;

-- Posts: anyone can read, only the author can write/edit/delete their own.
create policy "community_posts_select_all" on public.community_posts
	for select to public using (true);

create policy "community_posts_insert_own" on public.community_posts
	for insert to authenticated
	with check (user_id = (auth.jwt() ->> 'email'));

create policy "community_posts_update_own" on public.community_posts
	for update to authenticated
	using (user_id = (auth.jwt() ->> 'email'))
	with check (user_id = (auth.jwt() ->> 'email'));

create policy "community_posts_delete_own" on public.community_posts
	for delete to authenticated
	using (user_id = (auth.jwt() ->> 'email'));

-- community_likes has NO policies at all — it's intentionally unreachable by
-- direct client reads/writes. The only way to touch it is toggle_like() below,
-- which runs as SECURITY DEFINER and derives the user from the verified JWT,
-- never a client-supplied id. This is the exact same lockdown AvatarBox uses
-- for prompt_likes.

create or replace function public.toggle_like(p_id text)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
	uid text := auth.jwt() ->> 'email';
	now_liked boolean;
begin
	if uid is null then
		raise exception 'auth required';
	end if;
	if exists (select 1 from community_likes where post_id = p_id and user_id = uid) then
		delete from community_likes where post_id = p_id and user_id = uid;
		update community_posts set likes = greatest(0, coalesce(likes, 0) - 1) where id = p_id;
		now_liked := false;
	else
		insert into community_likes (post_id, user_id) values (p_id, uid);
		update community_posts set likes = coalesce(likes, 0) + 1 where id = p_id;
		now_liked := true;
	end if;
	return now_liked;
end;
$$;

grant execute on function public.toggle_like(text) to authenticated;
