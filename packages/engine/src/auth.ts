/**
 * Resolves provider API keys for the engine.
 *
 * Priority:
 *   1. Key explicitly passed in the request (model.apiKey)
 *   2. OpenCode's auth.json (~/.local/share/opencode/auth.json) — where the
 *      app's Settings → Providers dialog stores keys via client.auth.set()
 *   3. The provider's environment variable (e.g. ANTHROPIC_API_KEY)
 *
 * This lets the desktop UI send prompts without ever handling raw keys in the
 * renderer — it just names the provider, and the engine looks the key up.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getProvider } from "./providers.js"

// OpenCode persists provider keys (set via the app's Settings → Providers dialog)
// to auth.json. Its location differs between prod (data dir) and dev (config dir),
// and honours XDG overrides — check every candidate.
function opencodeAuthFiles(): string[] {
	const home = os.homedir()
	const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
	const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
	return [
		path.join(xdgData, "opencode", "auth.json"),
		path.join(xdgConfig, "opencode", "auth.json"),
		path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "opencode", "auth.json"),
	]
}

interface AuthEntry {
	type?: string
	key?: string
}

/** Read a provider's API key from OpenCode's auth.json, if present. */
function readOpenCodeAuth(providerId: string): string {
	for (const file of opencodeAuthFiles()) {
		try {
			if (!fs.existsSync(file)) continue
			const store = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, AuthEntry>
			const entry = store[providerId]
			if (entry?.type === "api" && entry.key) return entry.key
		} catch {
			// Corrupt or unreadable auth file — try the next candidate, then env.
		}
	}
	return ""
}

/** Resolve the API key for a provider, trying request → auth.json → env. */
export function resolveApiKey(providerId: string, provided?: string): string {
	if (provided?.trim()) return provided.trim()

	const fromAuth = readOpenCodeAuth(providerId)
	if (fromAuth) return fromAuth

	const provider = getProvider(providerId)
	if (provider?.envKey) {
		const fromEnv = process.env[provider.envKey]
		if (fromEnv?.trim()) return fromEnv.trim()
	}

	return ""
}
