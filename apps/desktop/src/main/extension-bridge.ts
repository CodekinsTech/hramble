// Extension bridge — receives console entries relayed by the "Hramble Console
// Bridge" Chrome extension (apps/chrome-extension) from any real Chrome tab,
// so the agent's `browser` tool can read a user's actual Chrome console the
// same way it already reads the embedded preview pane's console. Unlike
// browser-bridge.ts (a dynamic port discovered via a port file, since the
// agent process can read local files), a Chrome extension can't read
// arbitrary files — so this listens on a fixed, well-known port instead.

import http from "node:http"
import { createLogger } from "./logger"

const log = createLogger("extension-bridge")

export const EXTENSION_BRIDGE_PORT = 47821
const CAP_PER_TAB = 300
const STALE_TAB_MS = 30 * 60 * 1000 // drop tabs we haven't heard from in 30min

export interface ConsoleEntry {
	level: "debug" | "log" | "warn" | "error"
	message: string
	at: number
}

interface TabConsole {
	url: string
	title: string
	entries: ConsoleEntry[]
	lastUpdated: number
}

const tabs = new Map<number, TabConsole>()

let server: http.Server | null = null

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let body = ""
		req.on("data", (c) => {
			body += c
		})
		req.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"))
			} catch {
				resolve({})
			}
		})
	})
}

function pruneStale() {
	const now = Date.now()
	for (const [id, tab] of tabs) {
		if (now - tab.lastUpdated > STALE_TAB_MS) tabs.delete(id)
	}
}

/** Finds the tab most relevant to a lookup: by tabId, by URL substring, or (if
 *  neither matches) the most recently active tab overall. */
function findTab(tabId?: number, urlContains?: string): { tabId: number; tab: TabConsole } | null {
	pruneStale()
	if (tabId != null && tabs.has(tabId)) return { tabId, tab: tabs.get(tabId)! }

	const candidates = [...tabs.entries()].sort((a, b) => b[1].lastUpdated - a[1].lastUpdated)
	if (urlContains) {
		const match = candidates.find(([, tab]) => tab.url.includes(urlContains))
		if (match) return { tabId: match[0], tab: match[1] }
		return null
	}
	if (candidates.length === 0) return null
	const [id, tab] = candidates[0]
	return { tabId: id, tab }
}

export function startExtensionBridge(): void {
	if (server) return

	server = http.createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Headers", "content-type")
		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		const url = new URL(req.url ?? "/", "http://127.0.0.1")

		if (req.method === "GET" && url.pathname === "/status") {
			pruneStale()
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify({ ok: true, connectedTabs: tabs.size }))
			return
		}

		if (req.method === "GET" && url.pathname === "/console/read") {
			const tabIdParam = url.searchParams.get("tabId")
			const urlContains = url.searchParams.get("url") ?? undefined
			const found = findTab(tabIdParam ? Number.parseInt(tabIdParam, 10) : undefined, urlContains)
			res.writeHead(200, { "content-type": "application/json" })
			if (!found) {
				res.end(JSON.stringify({ ok: false, error: "no connected Chrome tab matches" }))
				return
			}
			res.end(
				JSON.stringify({
					ok: true,
					url: found.tab.url,
					title: found.tab.title,
					entries: found.tab.entries,
				}),
			)
			return
		}

		if (req.method === "POST" && url.pathname === "/console") {
			readBody(req).then((body) => {
				const tabId = Number(body.tabId)
				if (!Number.isFinite(tabId)) {
					res.writeHead(400)
					res.end()
					return
				}
				const incoming = Array.isArray(body.entries) ? (body.entries as ConsoleEntry[]) : []
				const existing = tabs.get(tabId)
				const entries = [...(existing?.entries ?? []), ...incoming].slice(-CAP_PER_TAB)
				tabs.set(tabId, {
					url: typeof body.url === "string" ? body.url : (existing?.url ?? ""),
					title: typeof body.title === "string" ? body.title : (existing?.title ?? ""),
					entries,
					lastUpdated: Date.now(),
				})
				res.writeHead(200, { "content-type": "application/json" })
				res.end('{"ok":true}')
			})
			return
		}

		if (req.method === "POST" && url.pathname === "/console/clear") {
			readBody(req).then((body) => {
				const tabId = Number(body.tabId)
				if (Number.isFinite(tabId)) tabs.delete(tabId)
				res.writeHead(200, { "content-type": "application/json" })
				res.end('{"ok":true}')
			})
			return
		}

		res.writeHead(404)
		res.end()
	})

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			log.warn("Extension bridge port already in use — another Hramble instance is probably running", {
				port: EXTENSION_BRIDGE_PORT,
			})
		} else {
			log.error("Extension bridge server error", err)
		}
	})

	server.listen(EXTENSION_BRIDGE_PORT, "127.0.0.1", () => {
		log.info(`[extension-bridge] listening on 127.0.0.1:${EXTENSION_BRIDGE_PORT}`)
	})
}
