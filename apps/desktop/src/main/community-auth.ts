/**
 * Community sign-in — Google OAuth via Supabase, in an Electron BrowserWindow.
 *
 * Simpler than AvatarBox's login.html/createLoginWindow: no local HTTP server
 * to redirect back to, so instead of an app-scheme deep link round-tripping
 * through the OS, we redirect straight to `hramble://auth-callback` and catch
 * it INSIDE the same window via `will-redirect`/`will-navigate` before
 * Electron tries (and fails) to actually navigate to an unknown scheme. No
 * custom-protocol registration needed.
 *
 * All Supabase calls here are plain fetch() against its REST endpoints
 * (/auth/v1/authorize, /auth/v1/user, /auth/v1/token) rather than the JS SDK —
 * keeps the main process dependency-free; the renderer uses
 * @supabase/supabase-js for the convenient postgrest/rpc calls.
 */

import { BrowserWindow, ipcMain } from "electron"
import { COMMUNITY_CONFIG, communityEnabled } from "./community-config"
import {
	type CommunitySession,
	clearCommunitySession,
	getCommunitySession,
	storeCommunitySession,
} from "./community-session-store"
import { createLogger } from "./logger"

const log = createLogger("community-auth")

const REDIRECT_URL = "hramble://auth-callback"

// Refresh well before the ~1h Supabase access token actually expires, so
// Dispatch's standing host WebSocket (use-dispatch-bridge.ts -> share-client.ts)
// never has to survive on a token the relay's Durable Object would reject.
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const MIN_REFRESH_DELAY_MS = 5 * 1000
const RETRY_DELAY_MS = 30 * 1000

let loginWindow: BrowserWindow | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function broadcastSession(session: CommunitySession | null): void {
	const win = BrowserWindow.getAllWindows()[0]
	win?.webContents.send("community:session", session)
}

function clearScheduledRefresh(): void {
	if (refreshTimer) {
		clearTimeout(refreshTimer)
		refreshTimer = null
	}
}

/** Schedules the next refresh attempt relative to `session.expiresAt`. Call
 *  this any time a session is (re)stored — initial login, refresh success,
 *  or app startup picking up a persisted session. */
function scheduleRefresh(session: CommunitySession): void {
	clearScheduledRefresh()
	const delay = Math.max(session.expiresAt - Date.now() - REFRESH_MARGIN_MS, MIN_REFRESH_DELAY_MS)
	refreshTimer = setTimeout(() => void performRefresh(), delay)
}

type RefreshResult =
	| { ok: true; session: CommunitySession }
	// A 400/401 from the token endpoint means the refresh token itself is
	// dead (expired past its own grace window, revoked, or already
	// exchanged elsewhere — e.g. Supabase's refresh-token-rotation reuse
	// detection) — retrying with the same token will never succeed.
	| { ok: false; permanent: boolean }

/** Exchanges the stored refresh token for a new access/refresh token pair via
 *  Supabase's REST token endpoint — same plain-fetch pattern as the rest of
 *  this file, no persistent SDK client kept alive in the main process. */
async function refreshAccessToken(current: CommunitySession): Promise<RefreshResult> {
	try {
		const r = await fetch(`${COMMUNITY_CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
			method: "POST",
			headers: {
				apikey: COMMUNITY_CONFIG.supabaseAnonKey,
				"content-type": "application/json",
			},
			body: JSON.stringify({ refresh_token: current.refreshToken }),
		})
		if (!r.ok) {
			const bodyText = await r.text().catch(() => "")
			log.warn("Community session refresh failed", { status: r.status, bodyText })
			return { ok: false, permanent: r.status === 400 || r.status === 401 }
		}
		const data = (await r.json()) as {
			access_token?: string
			refresh_token?: string
			expires_in?: number
			user?: { email?: string }
		}
		if (!data.access_token || !data.refresh_token) {
			log.warn("Community session refresh response missing tokens")
			return { ok: false, permanent: false }
		}
		const email = data.user?.email || current.email
		return {
			ok: true,
			session: {
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				email,
				name: email.split("@")[0],
				expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
			},
		}
	} catch (err) {
		log.error("Community session refresh request failed", err)
		return { ok: false, permanent: false }
	}
}

/** Runs one refresh attempt against whatever session is currently stored
 *  (not a closed-over snapshot), re-persists + re-broadcasts on success via
 *  the exact same path a fresh login uses, and reschedules itself — so as
 *  long as the user stays "logged in" this keeps running indefinitely. A
 *  transient failure (network blip) retries soon rather than silently
 *  leaving Dispatch on a token that's about to expire. A permanent failure
 *  (dead refresh token) signs the user out instead of retrying forever —
 *  Community/Dispatch will show signed-out and the user just logs back in
 *  once, same as any other session expiry. */
async function performRefresh(): Promise<CommunitySession | null> {
	const current = getCommunitySession()
	if (!current) return null
	const result = await refreshAccessToken(current)
	if (!result.ok) {
		if (result.permanent) {
			log.warn("Community refresh token is permanently invalid — signing out")
			clearScheduledRefresh()
			clearCommunitySession()
			broadcastSession(null)
			return null
		}
		refreshTimer = setTimeout(() => void performRefresh(), RETRY_DELAY_MS)
		return null
	}
	const refreshed = result.session
	storeCommunitySession(refreshed)
	broadcastSession(refreshed)
	scheduleRefresh(refreshed)
	log.info("Community session refreshed", { email: refreshed.email, expiresAt: refreshed.expiresAt })
	return refreshed
}

async function fetchSupabaseUser(accessToken: string): Promise<{ id: string; email: string } | null> {
	try {
		const r = await fetch(`${COMMUNITY_CONFIG.supabaseUrl}/auth/v1/user`, {
			headers: {
				apikey: COMMUNITY_CONFIG.supabaseAnonKey,
				Authorization: `Bearer ${accessToken}`,
			},
		})
		if (!r.ok) return null
		const u = (await r.json()) as { id?: string; email?: string }
		return u.email ? { id: u.id || "", email: u.email } : null
	} catch (err) {
		log.error("Failed to fetch Supabase user", err)
		return null
	}
}

async function finishLogin(callbackUrl: string): Promise<void> {
	const hash = callbackUrl.split("#")[1] || ""
	const params = new URLSearchParams(hash)
	const error = params.get("error_description") || params.get("error")
	if (error) {
		log.warn("Community login failed", { error })
		broadcastSession(null)
		return
	}
	const accessToken = params.get("access_token")
	const refreshToken = params.get("refresh_token")
	const expiresIn = Number(params.get("expires_in") || "3600")
	if (!accessToken || !refreshToken) {
		log.warn("Community login callback missing tokens")
		return
	}
	const user = await fetchSupabaseUser(accessToken)
	if (!user) {
		log.warn("Community login: could not verify user from access token")
		return
	}
	const session: CommunitySession = {
		accessToken,
		refreshToken,
		email: user.email,
		name: user.email.split("@")[0],
		expiresAt: Date.now() + expiresIn * 1000,
	}
	storeCommunitySession(session)
	broadcastSession(session)
	scheduleRefresh(session)
}

function openLoginWindow(): void {
	if (!communityEnabled()) {
		log.warn("Community login requested but no Supabase project is configured")
		return
	}
	if (loginWindow && !loginWindow.isDestroyed()) {
		loginWindow.focus()
		return
	}
	loginWindow = new BrowserWindow({
		width: 480,
		height: 640,
		title: "Sign in to Hramble Community",
		webPreferences: { contextIsolation: true, nodeIntegration: false },
	})
	const authorizeUrl = `${COMMUNITY_CONFIG.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(REDIRECT_URL)}`
	loginWindow.loadURL(authorizeUrl)

	const interceptIfCallback = (event: Electron.Event, url: string) => {
		if (!url.startsWith(REDIRECT_URL)) return
		event.preventDefault()
		finishLogin(url)
		loginWindow?.close()
	}
	loginWindow.webContents.on("will-redirect", interceptIfCallback)
	loginWindow.webContents.on("will-navigate", interceptIfCallback)
	loginWindow.on("closed", () => {
		loginWindow = null
	})
}

export function registerCommunityAuth(): void {
	ipcMain.handle("community:login", () => {
		openLoginWindow()
	})
	ipcMain.handle("community:logout", () => {
		clearScheduledRefresh()
		clearCommunitySession()
		broadcastSession(null)
	})
	ipcMain.handle("community:get-session", () => getCommunitySession())
	ipcMain.handle("community:config", () => ({
		enabled: communityEnabled(),
		supabaseUrl: COMMUNITY_CONFIG.supabaseUrl,
		supabaseAnonKey: COMMUNITY_CONFIG.supabaseAnonKey,
		apiBase: COMMUNITY_CONFIG.apiBase,
	}))

	// Pick up a session restored from disk at startup (community-session-store's
	// initCommunitySessionStore runs before this) — without this, a session
	// that was already stale when the app launched would never refresh, since
	// finishLogin's scheduleRefresh() call only fires on a fresh interactive
	// login.
	const existing = getCommunitySession()
	if (existing) scheduleRefresh(existing)
}
