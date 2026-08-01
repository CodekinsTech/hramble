// Hramble preview — open a local file/page in the browser the user sees, served
// over a real HTTP server (localhost), the way Claude Code's preview works.
//
// Why a server (not file://): a served page gets a proper origin, so relative
// paths, ES modules, fetch(), and multi-file projects all work — file:// breaks
// them. The agent should ALWAYS use this instead of `open`/`xdg-open` from bash.
//
// It starts a tiny dependency-free static server rooted at the file's directory
// (one server per root, reused across calls), then tells the in-app browser
// bridge to navigate there so the user watches it render.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

const PORT_FILE = path.join(homedir(), ".config", "opencode", ".hramble-browser-port")

const CTYPES = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json",
	".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8",
}

// One static server per served root directory, reused across preview() calls.
const servers = new Map() // root -> { server, port }

function browserBridgePort() {
	try {
		const p = Number.parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10)
		return Number.isFinite(p) && p > 0 ? p : null
	} catch {
		return null
	}
}

function startServer(root) {
	const existing = servers.get(root)
	if (existing) return Promise.resolve(existing)
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
				let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "")
				const filePath = path.join(root, rel)
				// Path-traversal guard: never serve outside the root.
				if (!path.resolve(filePath).startsWith(path.resolve(root))) {
					res.writeHead(403); res.end("Forbidden"); return
				}
				fs.readFile(filePath, (err, data) => {
					if (err) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found: " + rel); return }
					res.writeHead(200, {
						"content-type": CTYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
						"cache-control": "no-cache",
						"access-control-allow-origin": "*",
					})
					res.end(data)
				})
			} catch (e) {
				res.writeHead(500); res.end(String(e))
			}
		})
		server.on("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port
			const entry = { server, port }
			servers.set(root, entry)
			resolve(entry)
		})
	})
}

async function openInBrowser(url) {
	const port = browserBridgePort()
	if (!port) return false
	try {
		const res = await fetch(`http://127.0.0.1:${port}/browser`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "open", url }),
		})
		const data = await res.json()
		return !!data?.ok
	} catch {
		return false
	}
}

export default async () => ({
	tool: {
		preview: tool({
			description:
				"Open a local HTML/SVG page (or a whole built site) in the browser the user sees, served over a real local HTTP server (localhost) — the correct way to preview, and the ONLY way to 'open in the browser / open in Chrome'. Never open a file:// path or use `open`/`xdg-open` from bash. Provide either `path` (an existing file to open) OR `content` (+ optional `filename`) to render inline. Serving over http (not file://) makes relative assets, ES modules, and fetch() work.",
			args: {
				path: z
					.string()
					.optional()
					.describe("Path to an existing file to open (relative to cwd or absolute), e.g. index.html or logo.svg. Its directory is served so sibling assets load."),
				content: z
					.string()
					.optional()
					.describe("Inline HTML/SVG to render (used when there is no file on disk). Written to a temp file under the project, then served."),
				filename: z
					.string()
					.optional()
					.describe("Filename for `content` (default preview.html). Use .svg for an SVG."),
			},
			execute: async (args, context) => {
				const cwd = context?.directory || context?.cwd || process.cwd()
				let root, entry

				if (args.path) {
					const abs = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path)
					if (!fs.existsSync(abs)) return `No such file: ${args.path}. Create it with the write tool first, then preview it.`
					root = path.dirname(abs)
					entry = path.basename(abs)
				} else if (args.content) {
					const dir = path.join(cwd, ".hramble-preview")
					fs.mkdirSync(dir, { recursive: true })
					entry = args.filename || "preview.html"
					fs.writeFileSync(path.join(dir, entry), args.content, "utf8")
					root = dir
				} else {
					return "Provide `path` (a file to open) or `content` (inline HTML/SVG) to preview."
				}

				let served
				try {
					served = await startServer(root)
				} catch (e) {
					return `Could not start the preview server: ${String(e)}`
				}
				const url = `http://localhost:${served.port}/${entry}`
				const opened = await openInBrowser(url)
				return opened
					? `Previewing in the in-app browser at ${url} (served over http). The user can see it now.`
					: `Serving at ${url} (http). The in-app browser wasn't reachable — the user can open ${url} in a browser.`
			},
		}),
	},
})
