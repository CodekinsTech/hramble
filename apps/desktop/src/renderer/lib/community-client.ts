/**
 * Real Community backend — Supabase (posts/likes) + the community-api Worker
 * (image upload). Talks to Supabase DIRECTLY from the renderer with the
 * public anon key, same as AvatarBox's own web/Electron clients do — Row
 * Level Security (see supabase/migrations/0001_community_schema.sql) is the
 * actual security boundary, not secrecy of the anon key.
 *
 * Everything here is a no-op / returns null until a real Supabase project is
 * configured (see community-config.ts) — the mock local-only atoms in
 * atoms/community.ts keep working exactly as before until then, so this file
 * being "live" in the bundle doesn't change today's behavior.
 */
import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import type { CommunityPost } from "../atoms/community"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

interface CommunityConfig {
	enabled: boolean
	supabaseUrl: string
	supabaseAnonKey: string
	apiBase: string
}

let client: SupabaseClient | null = null
let config: CommunityConfig | null = null

async function loadConfig(): Promise<CommunityConfig> {
	if (!config) config = await bridge().community.config()
	return config as CommunityConfig
}

export async function isCommunityBackendEnabled(): Promise<boolean> {
	return (await loadConfig()).enabled
}

/** Shared with team-client.ts — Team Spaces lives in the same Supabase project as Community.
 *
 * autoRefreshToken/persistSession are OFF on purpose: the main process
 * (community-session-store.ts + community-auth.ts) is the single authority
 * for this session — it owns the encrypted on-disk copy and refreshes the
 * access token on a timer before it expires, then pushes the new pair down
 * via syncClientSession() below. If this renderer client refreshed on its
 * own too, Supabase's refresh-token rotation would invalidate whichever
 * refresh token the OTHER side was still holding the next time it tried —
 * this is exactly what caused a live "refresh_token_already_used" 400 while
 * debugging the Dispatch reconnect-forever bug. */
export async function getClient(): Promise<SupabaseClient | null> {
	const cfg = await loadConfig()
	if (!cfg.enabled) return null
	if (!client) {
		client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	}
	return client
}

/** Keep the Supabase client's session in sync with the main process's OAuth flow. */
export async function syncClientSession(session: { accessToken: string; refreshToken: string } | null): Promise<void> {
	const c = await getClient()
	if (!c) return
	if (session) {
		await c.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
	} else {
		await c.auth.signOut()
	}
}

interface CommunityPostRow {
	id: string
	user_id: string
	username: string
	type: "build" | "skill"
	caption: string | null
	img: string | null
	repo_url: string | null
	skill: CommunityPost["skill"] | null
	likes: number
	created_at: string
}

function rowToPost(row: CommunityPostRow): CommunityPost {
	return {
		id: row.id,
		author: { email: row.user_id, name: row.username },
		type: row.type,
		caption: row.caption || "",
		thumbnailDataUrl: row.img,
		repoUrl: row.repo_url,
		createdAt: new Date(row.created_at).getTime(),
		likedByMe: false, // whether *I* liked it isn't in this row — see note below
		likeCount: row.likes,
		skill: row.skill || undefined,
	}
}

/**
 * Fetches the feed. Note: `likedByMe` can't be derived from community_posts
 * alone (likes are intentionally locked away from direct client reads — see
 * the migration). A follow-up can add a `my_likes` view/RPC once there's a
 * real user testing this; for now every post loads as not-liked, and the
 * existing optimistic toggle in toggleCommunityLikeAtom still flips it
 * correctly for the current session.
 */
export async function fetchCommunityPosts(): Promise<CommunityPost[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c.from("community_posts").select("*").order("created_at", { ascending: false })
	if (error || !data) return []
	return (data as CommunityPostRow[]).map(rowToPost)
}

export async function createCommunityPost(input: {
	author: { email: string; name: string }
	type: "build" | "skill"
	caption: string
	img: string | null
	repoUrl: string | null
	skill?: CommunityPost["skill"]
}): Promise<CommunityPost | null> {
	const c = await getClient()
	if (!c) return null
	const row = {
		id: crypto.randomUUID(),
		user_id: input.author.email,
		username: input.author.name,
		type: input.type,
		caption: input.caption,
		img: input.img,
		repo_url: input.repoUrl,
		skill: input.skill || null,
	}
	const { data, error } = await c.from("community_posts").insert(row).select().single()
	if (error || !data) return null
	return rowToPost(data as CommunityPostRow)
}

/** Fire-and-forget like toggle against the SECURITY DEFINER RPC. */
export async function toggleCommunityLikeRemote(postId: string): Promise<void> {
	const c = await getClient()
	if (!c) return
	await c.rpc("toggle_like", { p_id: postId })
}

/** Uploads a data: URL thumbnail via the community-api Worker, returns the hosted URL. */
export async function uploadCommunityImage(dataUrl: string, accessToken: string): Promise<string | null> {
	const cfg = await loadConfig()
	if (!cfg.enabled || !cfg.apiBase) return null
	try {
		const r = await fetch(`${cfg.apiBase}/v1/upload`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-user-token": accessToken },
			body: JSON.stringify({ dataUrl }),
		})
		const data = await r.json()
		return r.ok ? data.url : null
	} catch {
		return null
	}
}
