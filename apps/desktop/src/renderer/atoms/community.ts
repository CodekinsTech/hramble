/**
 * Community — the real backend (Supabase + the community-api Worker, see
 * renderer/lib/community-client.ts) is now wired up, but it self-disables
 * until a Supabase project is actually configured (community-config.ts on
 * the main process side) — until then, `communityBackendEnabledAtom` stays
 * false and everything below behaves exactly like the original local-only
 * mock: "login" is a locally-remembered email, posts are a locally-persisted
 * list. This means the UI keeps working today and flips over to the real
 * backend automatically the moment real Supabase credentials exist.
 */
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { fetchCommunityPosts, toggleCommunityLikeRemote } from "../lib/community-client"

/** Set once at CommunityPage mount after checking the main process's config. */
export const communityBackendEnabledAtom = atom(false)

/** The current Supabase access token, needed for the image-upload Worker call. Null when signed out or backend disabled. */
export const communityAccessTokenAtom = atom<string | null>(null)

export interface CommunityUser {
	email: string
	name: string
}

export interface CommunityPost {
	id: string
	author: CommunityUser
	/** "build" = the original share-what-you-made post. "skill" = a reusable skill others can install. */
	type: "build" | "skill"
	caption: string
	/** A data: URL (mock/local path) or a real https: R2-hosted URL (real backend path) — both work directly as an <img src>. */
	thumbnailDataUrl: string | null
	repoUrl: string | null
	createdAt: number
	likedByMe: boolean
	likeCount: number
	/** Only set when type === "skill". Same shape the create_skill agent tool writes. */
	skill?: {
		name: string
		description: string
		instructions: string
	}
}

export const communityUserAtom = atomWithStorage<CommunityUser | null>("hramble:communityUser", null)

const SEED_POSTS: CommunityPost[] = [
	{
		id: "seed-1",
		author: { email: "maya@example.com", name: "Maya Chen" },
		type: "build",
		caption: "Shipped a local-first habit tracker this weekend — SQLite + a tiny Rust core, no cloud at all.",
		thumbnailDataUrl: null,
		repoUrl: "https://github.com/example/habit-tracker",
		createdAt: Date.now() - 1000 * 60 * 60 * 5,
		likedByMe: false,
		likeCount: 12,
	},
	{
		id: "seed-2",
		author: { email: "ravi@example.com", name: "Ravi Patel" },
		type: "build",
		caption: "A little CLI that turns a folder of markdown notes into a searchable static site. Feedback welcome!",
		thumbnailDataUrl: null,
		repoUrl: "https://github.com/example/notes-to-site",
		createdAt: Date.now() - 1000 * 60 * 60 * 26,
		likedByMe: true,
		likeCount: 34,
	},
	{
		id: "seed-3",
		author: { email: "priya@example.com", name: "Priya Nair" },
		type: "skill",
		caption: "",
		thumbnailDataUrl: null,
		repoUrl: null,
		createdAt: Date.now() - 1000 * 60 * 60 * 3,
		likedByMe: false,
		likeCount: 21,
		skill: {
			name: "changelog-writer",
			description:
				"Write a clean CHANGELOG.md entry from a set of commits or a diff. Use when the user asks to update the changelog, summarize what changed, or prep release notes.",
			instructions:
				"1. Run `git log` (or read the given diff) to see what actually changed.\n2. Group changes into Added / Changed / Fixed / Removed.\n3. Write one line per change, plain language, no commit hashes.\n4. Prepend the new section to CHANGELOG.md under today's date.",
		},
	},
]

export const communityPostsAtom = atomWithStorage<CommunityPost[]>("hramble:communityPosts", SEED_POSTS)

/** Toggle the current user's like on a post — optimistic locally, plus the real RPC when the backend is enabled. */
export const toggleCommunityLikeAtom = atom(null, (get, set, postId: string) => {
	set(communityPostsAtom, (prev) =>
		prev.map((p) =>
			p.id === postId
				? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }
				: p,
		),
	)
	if (get(communityBackendEnabledAtom)) toggleCommunityLikeRemote(postId)
})

/** Replaces the local feed with the real one from Supabase. No-op (returns early) when the backend is disabled. */
export const refreshCommunityPostsAtom = atom(null, async (get, set) => {
	if (!get(communityBackendEnabledAtom)) return
	const posts = await fetchCommunityPosts()
	set(communityPostsAtom, posts)
})
