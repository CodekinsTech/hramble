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

let loginWindow: BrowserWindow | null = null

function broadcastSession(session: CommunitySession | null): void {
	const win = BrowserWindow.getAllWindows()[0]
	win?.webContents.send("community:session", session)
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
}
