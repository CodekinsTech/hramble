// Serves a local file over a real localhost HTTP server instead of file://,
// so the "Open in your browser" button can preview a plain HTML file
// directly. Ports the exact same tiny dependency-free server the agent's own
// `preview` tool already uses (opencode-harness/plugin/hramble-preview.js) —
// that one runs inside the separate OpenCode server process and is only
// reachable by the agent, so this is a deliberate port across the process
// boundary, not a duplicate of unproven logic.
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const CTYPES: Record<string, string> = {
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

// One static server per served root directory, reused across calls.
const servers = new Map<string, { server: http.Server; port: number }>()

function startServer(root: string): Promise<{ port: number }> {
	const existing = servers.get(root)
	if (existing) return Promise.resolve(existing)
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
				const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "")
				const filePath = path.join(root, rel)
				if (!path.resolve(filePath).startsWith(path.resolve(root))) {
					res.writeHead(403)
					res.end("Forbidden")
					return
				}
				fs.readFile(filePath, (err, data) => {
					if (err) {
						res.writeHead(404, { "content-type": "text/plain" })
						res.end(`Not found: ${rel}`)
						return
					}
					res.writeHead(200, {
						"content-type": CTYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
						"cache-control": "no-cache",
						"access-control-allow-origin": "*",
					})
					res.end(data)
				})
			} catch (e) {
				res.writeHead(500)
				res.end(String(e))
			}
		})
		server.on("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			const port = typeof address === "object" && address ? address.port : 0
			const entry = { server, port }
			servers.set(root, entry)
			resolve(entry)
		})
	})
}

/** Serves `filePath`'s directory and returns a real http://localhost URL for it. */
export async function servePreviewFile(filePath: string): Promise<string> {
	const root = path.dirname(filePath)
	const entry = path.basename(filePath)
	const { port } = await startServer(root)
	return `http://localhost:${port}/${entry}`
}
