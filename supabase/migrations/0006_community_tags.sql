-- Add a lightweight tag system to community posts so per-agent hub pages
-- (Website, Browser Game, ...) can show a filtered feed of relevant builds
-- without a separate join table. A plain text[] column is the simplest thing
-- that works here: a handful of tags per post, and the only query shape is
-- "does this post have tag X" (see fetchCommunityPostsByTag in
-- apps/desktop/src/renderer/lib/community-client.ts).
--
-- No RLS policy changes needed: community_posts_select_all (0001) already
-- allows public SELECT of every column including the new one, and
-- community_posts_insert_own only checks user_id — an author inserting tags
-- on their own post is already covered.

alter table public.community_posts
	add column if not exists tags text[] not null default '{}';

-- GIN index so `tags && array['website']`-style containment filters don't
-- force a sequential scan as the table grows.
create index if not exists community_posts_tags_idx
	on public.community_posts using gin (tags);
