// Ollama integration — powers the first-run "use a local model" path.
//
// This is the free tier: the user runs a coding model on their own machine, so
// there is no API key and no inference cost to us. We talk to Ollama's local
// HTTP API rather than shelling out, so it works whether Ollama was installed
// via the app, Homebrew, or the install script.

import { execFile, spawn } from "node:child_process"
import os from "node:os"
import { promisify } from "node:util"
import { BrowserWindow, ipcMain, shell } from "electron"
import { createLogger } from "./logger"

const execFileAsync = promisify(execFile)
const log = createLogger("ollama")

const OLLAMA_URL = "http://localhost:11434"

/** The model we recommend: MoE (30B total / ~3B active) so it's fast, and
 *  trained for agentic tool use — small dense models drop the agent loop. */
export const RECOMMENDED_MODEL = "qwen3-coder:30b"

/**
 * Pick a safe context window for THIS machine.
 *
 * Ollama defaults every model to a tiny 4096-token window — far too small for a
 * coding agent's prompt, so large prompts silently truncate and the model breaks.
 * But too large (e.g. 32K on a 32GB Mac) blows the GPU memory budget for the 30B
 * model and generation OOMs. So we scale the context to installed RAM, tuned so
 * the recommended 30B (~18GB) plus its KV cache still fits GPU memory.
 */
export function targetContextLength(): number {
	const gb = os.totalmem() / 1024 ** 3
	if (gb >= 60) return 32768 // 64GB+ — room for a big cache
	if (gb >= 28) return 16384 // 32GB — verified sweet spot for the 30B (32K OOMs)
	if (gb >= 14) return 8192 // 16GB — small model territory
	return 4096 // 8GB — bare minimum
}

/** Is the Ollama HTTP daemon reachable? */
async function daemonRunning(): Promise<boolean> {
	try {
		await fetchJson("/api/version", 1500)
		return true
	} catch {
		return false
	}
}

/**
 * Ensure Ollama is running WITH the right context window. If the daemon isn't
 * up, Hramble starts it itself with OLLAMA_CONTEXT_LENGTH set — so local models
 * "just work" without the user hand-configuring anything. If a daemon is already
 * running (e.g. the user's own Ollama app) we leave it alone rather than fight
 * for the port; its context is whatever it was started with.
 */
export async function ensureManagedOllama(): Promise<void> {
	if (await daemonRunning()) {
		log.info("[ollama] daemon already running — leaving it as-is")
		return
	}
	const ctx = targetContextLength()
	try {
		// Resolve the binary via a login shell so we pick up Homebrew / app PATHs.
		const { stdout } = await execFileAsync("/bin/bash", ["-lc", "command -v ollama"], {
			timeout: 4000,
		})
		const bin = stdout.trim()
		if (!bin) {
			log.warn("[ollama] binary not found — cannot auto-start")
			return
		}
		log.info("[ollama] starting managed daemon", { bin, contextLength: ctx })
		const child = spawn(bin, ["serve"], {
			env: { ...process.env, OLLAMA_CONTEXT_LENGTH: String(ctx) },
			detached: true,
			stdio: "ignore",
		})
		child.unref()
		// Give it a moment to bind the port.
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 500))
			if (await daemonRunning()) {
				log.info("[ollama] managed daemon up", { contextLength: ctx })
				return
			}
		}
		log.warn("[ollama] daemon did not come up in time")
	} catch (e) {
		log.warn("[ollama] auto-start failed", e)
	}
}

type OllamaModel = { name: string; size: number }

async function fetchJson(path: string, timeoutMs = 2500) {
	const r = await fetch(`${OLLAMA_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
	if (!r.ok) throw new Error(`${path} → ${r.status}`)
	return r.json()
}

/** Is the ollama binary present, even if the daemon isn't running? */
async function binaryInstalled(): Promise<boolean> {
	try {
		// Login shell so we pick up Homebrew / custom PATHs that a GUI app misses.
		await execFileAsync("/bin/bash", ["-lc", "command -v ollama"], { timeout: 4000 })
		return true
	} catch {
		return false
	}
}

export function registerOllama() {
	// Auto-start Ollama with a hardware-tuned context window so local models work
	// out of the box (no user config, no 4K-truncation). Fire-and-forget on boot.
	void ensureManagedOllama()

	// Status: is Ollama installed, is it running, and what's already pulled?
	ipcMain.handle("ollama:status", async () => {
		try {
			const data = (await fetchJson("/api/tags")) as { models?: OllamaModel[] }
			const models = (data.models ?? []).map((m) => ({ name: m.name, size: m.size }))
			return {
				installed: true,
				running: true,
				models,
				hasRecommended: models.some((m) => m.name.startsWith(RECOMMENDED_MODEL.split(":")[0])),
				recommended: RECOMMENDED_MODEL,
				contextLength: targetContextLength(),
			}
		} catch {
			// Daemon unreachable — distinguish "not installed" from "not started".
			return {
				installed: await binaryInstalled(),
				running: false,
				models: [],
				hasRecommended: false,
				recommended: RECOMMENDED_MODEL,
				contextLength: targetContextLength(),
			}
		}
	})

	// Pull a model, streaming progress back to the renderer as `ollama:pull-progress`.
	ipcMain.handle("ollama:pull", async (event, model?: string) => {
		const name = model || RECOMMENDED_MODEL
		const target = BrowserWindow.fromWebContents(event.sender)
		const send = (payload: unknown) => {
			try {
				target?.webContents.send("ollama:pull-progress", payload)
			} catch {
				/* window closed mid-pull */
			}
		}

		try {
			const r = await fetch(`${OLLAMA_URL}/api/pull`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name, stream: true }),
			})
			if (!r.ok || !r.body) throw new Error(`pull failed → ${r.status}`)

			// Ollama streams NDJSON: {status, completed?, total?}
			const reader = r.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ""
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() ?? "" // keep the partial line
				for (const line of lines) {
					if (!line.trim()) continue
					try {
						const j = JSON.parse(line)
						if (j.error) {
							send({ done: true, error: String(j.error) })
							return { ok: false, error: String(j.error) }
						}
						send({
							status: j.status ?? "",
							completed: j.completed ?? 0,
							total: j.total ?? 0,
							percent: j.total ? Math.round((j.completed / j.total) * 100) : undefined,
						})
					} catch {
						/* ignore malformed keepalive lines */
					}
				}
			}
			send({ done: true })
			return { ok: true }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			send({ done: true, error: msg })
			return { ok: false, error: msg }
		}
	})

	// Open the Ollama download page for users who don't have it yet.
	ipcMain.handle("ollama:openDownload", async () => {
		await shell.openExternal("https://ollama.com/download")
		return { ok: true }
	})
}
