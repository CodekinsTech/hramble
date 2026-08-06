// ═══════════════════════════════════════════════════════════════════
// community-api — Cloudflare Worker for Hramble's Community image storage.
//
// Trimmed, Hramble-specific sibling of AvatarBox's avatarbox-api Worker —
// same pattern (public read, authenticated write, no presigned URLs, every
// upload proxied through here so the R2 binding never leaves the server),
// but scoped to only what Community actually needs: serve + upload post
// thumbnails. No avatar catalog, credits, or Razorpay code — this Worker
// does exactly one job.
//
// Auth model: uploads require a valid Supabase access token (the SAME token
// the renderer already holds after Google sign-in) sent as `x-user-token`.
// We verify it server-side against Supabase's own /auth/v1/user endpoint —
// never trust a client-supplied email/id for the storage path.
// ═══════════════════════════════════════════════════════════════════

const json = (data, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET,POST,OPTIONS",
			"access-control-allow-headers": "content-type,x-user-token",
		},
	})

const fail = (msg, status = 400) => json({ error: msg }, status)

// Verify a Supabase access token and return the real, server-checked email/id.
// Never trust a client-supplied identity for the storage path.
async function getUser(env, token) {
	if (!token) return null
	try {
		const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
			headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
		})
		if (!r.ok) return null
		const u = await r.json()
		return u && u.email ? { id: u.id, email: u.email.trim().toLowerCase() } : null
	} catch {
		return null
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const path = url.pathname

		if (request.method === "OPTIONS") return json({ ok: true })

		// Public read (no auth — must load in a plain <img> tag).
		// GET /v1/img/community/<user>/<file>
		if (path.startsWith("/v1/img/") && request.method === "GET") {
			const key = decodeURIComponent(path.slice("/v1/img/".length))
			if (!key || key.includes("..") || !key.startsWith("community/")) return fail("bad path", 400)
			const obj = await env.COMMUNITY_IMAGES.get(key)
			if (!obj || !obj.body) return fail("not found", 404)
			const headers = new Headers()
			obj.writeHttpMetadata(headers)
			if (!headers.get("content-type")) headers.set("content-type", "image/png")
			headers.set("access-control-allow-origin", "*")
			headers.set("cache-control", "public, max-age=31536000, immutable")
			if (obj.httpEtag) headers.set("etag", obj.httpEtag)
			return new Response(obj.body, { headers })
		}

		// Authenticated upload — POST /v1/upload, { dataUrl } (base64 data URL).
		// Namespaced per account, stored in R2, served publicly via /v1/img above.
		if (path === "/v1/upload" && request.method === "POST") {
			const u = await getUser(env, request.headers.get("x-user-token"))
			if (!u) return fail("login required", 401)
			let body = {}
			try {
				body = await request.json()
			} catch {
				body = {}
			}
			const dataUrl = body.dataUrl || ""
			const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
			if (!m) return fail("dataUrl required")
			const contentType = (m[1] || "image/png").toLowerCase()
			if (!contentType.startsWith("image/")) return fail("only images allowed", 415)
			let bytes
			try {
				bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
			} catch {
				return fail("invalid base64", 400)
			}
			if (bytes.length > 12 * 1024 * 1024) return fail("image too large (max 12 MB)", 413)
			const ext = (contentType.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "png").replace(/[^a-z0-9]/g, "")
			const safeId = (u.id || "u").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "u"
			const key = `community/${safeId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
			await env.COMMUNITY_IMAGES.put(key, bytes, {
				httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
			})
			return json({ ok: true, url: `${url.origin}/v1/img/${key}` })
		}

		return fail("not found", 404)
	},
}
