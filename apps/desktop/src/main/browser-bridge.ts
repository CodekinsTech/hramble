// Browser bridge — lets the Hramble agent drive the visible in-app browser pane.
//
// The agent (a separate process) calls a `browser` tool, which POSTs to this
// local HTTP server. We forward the command to the renderer over IPC (the
// renderer owns the <webview>), await the result, and reply. The chosen port is
// written to a file the tool reads.

import http from "node:http"
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { type BrowserWindow, ipcMain } from "electron"

const PORT_FILE = path.join(homedir(), ".config", "opencode", ".hramble-browser-port")

// id -> resolver for an in-flight command awaiting the renderer's reply.
const pending = new Map<string, (result: unknown) => void>()
let counter = 0
let server: http.Server | null = null

export function startBrowserBridge(win: BrowserWindow): void {
	// Renderer sends the result of a command back here.
	ipcMain.removeAllListeners("browser:result")
	ipcMain.on("browser:result", (_e, payload: { id: string; result: unknown }) => {
		const resolve = pending.get(payload.id)
		if (resolve) {
			pending.delete(payload.id)
			resolve(payload.result)
		}
	})

	if (server) return // already running

	server = http.createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405)
			res.end()
			return
		}
		let body = ""
		req.on("data", (c) => {
			body += c
		})
		req.on("end", async () => {
			let cmd: Record<string, unknown>
			try {
				cmd = JSON.parse(body || "{}")
			} catch {
				res.writeHead(400, { "content-type": "application/json" })
				res.end('{"ok":false,"error":"bad json"}')
				return
			}
			const id = `b${++counter}`
			const result = await new Promise<unknown>((resolve) => {
				pending.set(id, resolve)
				try {
					win.webContents.send("browser:command", { id, ...cmd })
				} catch {
					pending.delete(id)
					resolve({ ok: false, error: "window unavailable" })
					return
				}
				setTimeout(() => {
					if (pending.has(id)) {
						pending.delete(id)
						resolve({ ok: false, error: "timeout" })
					}
				}, 30000)
			})
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify(result))
		})
	})

	server.listen(0, "127.0.0.1", () => {
		const addr = server?.address()
		const port = typeof addr === "object" && addr ? addr.port : 0
		try {
			writeFileSync(PORT_FILE, String(port))
		} catch {
			/* config dir should exist; ignore if not */
		}
		console.log(`[browser-bridge] listening on 127.0.0.1:${port}`)
	})
}
