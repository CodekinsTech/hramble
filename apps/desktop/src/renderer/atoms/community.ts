/**
 * Community — local-only state for the UI-first build. There is no backend
 * yet (Supabase auth + Cloudflare media storage come later, once the UI is
 * settled), so "login" here is just a locally-remembered email and posts are
 * a locally-persisted list — both structured so swapping in the real backend
 * later only touches how these atoms get populated, not the UI that reads them.
 */
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

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
	/** Data URL for now (local file read) — becomes a Cloudflare-hosted URL later. */
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

/** Toggle the current user's like on a post — optimistic, local-only for now. */
export const toggleCommunityLikeAtom = atom(null, (_get, set, postId: string) => {
	set(communityPostsAtom, (prev) =>
		prev.map((p) =>
			p.id === postId
				? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }
				: p,
		),
	)
})
