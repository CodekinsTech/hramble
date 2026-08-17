import Fastify from "fastify"
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js"
import { nanoid } from "nanoid"
import type { EngineEvent, ModelRef, PermissionRequest } from "./types.js"
import { runAgentLoop } from "./agent.js"
import { resolveApiKey } from "./auth.js"
import { getProvider, getModel, getAllProviders } from "./providers.js"
import { trimHistory } from "./limits.js"
import {
	initDb,
	createSession,
	getSession,
	listSessions,
	updateSessionStatus,
	addMessage,
	getMessages,
} from "./sessions.js"

const PORT = 4200

// Zero-setup default: the free, keyless OpenCode Zen tier so chat works with no keys.
const DEFAULT_MODEL = { provider: "opencode", model: "nemotron-3.5-lightning-free" }

// Active SSE clients — broadcast all events to every connected client
const sseClients = new Set<{ sessionId?: string; write: (event: EngineEvent) => void }>()

// Active agent abort controllers — keyed by sessionId
const activeAgents = new Map<string, AbortController>()

// Pending permission requests — keyed by permissionId
const pendingPermissions = new Map<
	string,
	{ resolve: (resolution: "allow" | "deny") => void }
>()

function broadcast(event: EngineEvent): void {
	for (const client of sseClients) {
		try {
			client.write(event)
		} catch {
			sseClients.delete(client)
		}
	}
}

export async function startServer(): Promise<void> {
	initDb()

	const app = Fastify({ logger: false })

	// ── Health ──────────────────────────────────────────────────────────
	app.get("/health", async () => ({ ok: true, engine: "xot", version: "0.1.0" }))

		app.get("/providers", async () => {
			const providers = getAllProviders().map((p) => ({
				id: p.id,
				name: p.name,
				type: p.type,
				keyless: p.keyless ?? false,
				connected: (p.keyless ?? false) || resolveApiKey(p.id) !== "",
				models: p.models.map((m) => ({
					id: m.id,
					name: m.name,
					contextWindow: m.contextWindow,
					supportsVision: m.supportsVision ?? false,
					supportsTools: m.supportsTools ?? false,
				})),
			}))
			return { providers, default: DEFAULT_MODEL }
		})

		app.get("/models", async () => {
			const models = getAllProviders().flatMap((p) =>
				p.models.map((m) => ({
					provider: p.id,
					providerName: p.name,
					id: m.id,
					name: m.name,
					contextWindow: m.contextWindow,
					supportsVision: m.supportsVision ?? false,
					supportsTools: m.supportsTools ?? false,
					connected: (p.keyless ?? false) || resolveApiKey(p.id) !== "",
				})),
			)
			return { models, default: DEFAULT_MODEL }
		})

		app.get("/config", async () => ({ default: DEFAULT_MODEL }))

	// ── SSE event stream ─────────────────────────────────────────────────
	app.get("/events", (req, reply) => {
		reply.raw.setHeader("Content-Type", "text/event-stream")
		reply.raw.setHeader("Cache-Control", "no-cache")
		reply.raw.setHeader("Connection", "keep-alive")
		reply.raw.setHeader("Access-Control-Allow-Origin", "*")
		reply.raw.flushHeaders()

		const write = (event: EngineEvent) => {
			reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
		}

		const client = { write }
		sseClients.add(client)

		// Keepalive ping every 15s
		const ping = setInterval(() => {
			try {
				reply.raw.write(": ping\n\n")
			} catch {
				clearInterval(ping)
				sseClients.delete(client)
			}
		}, 15000)

		req.raw.on("close", () => {
			clearInterval(ping)
			sseClients.delete(client)
		})

		// Don't let Fastify end the response
		return reply
	})

	// ── Sessions ─────────────────────────────────────────────────────────
	app.get("/sessions", async (req) => {
		const { directory } = req.query as { directory?: string }
		return listSessions(directory)
	})

	app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
		const session = getSession(req.params.id)
		if (!session) return reply.code(404).send({ error: "Session not found" })
		const messages = getMessages(req.params.id)
		return { ...session, messages }
	})

	app.post("/sessions", async (req, reply) => {
		const { title, directory } = req.body as { title?: string; directory: string }
		if (!directory) return reply.code(400).send({ error: "directory is required" })
		const session = createSession(title ?? "New chat", directory)
		broadcast({ type: "session.created", sessionId: session.id, title: session.title, directory: session.directory })
		return session
	})

	// ── Send prompt ──────────────────────────────────────────────────────
	app.post<{ Params: { id: string } }>("/sessions/:id/prompt", async (req, reply) => {
		const session = getSession(req.params.id)
		if (!session) return reply.code(404).send({ error: "Session not found" })

		const { text, model } = req.body as { text: string; model?: ModelRef }
		if (!text?.trim()) return reply.code(400).send({ error: "text is required" })

		if (activeAgents.has(session.id)) {
			return reply.code(409).send({ error: "Session is already running" })
		}

		// Resolve model — provider/model from the request, key looked up from
		// the request, OpenCode's auth store, or the provider env var. Falls back
		// to the free, keyless OpenCode Zen tier so chat works with no setup.
		const requested = model ?? { ...DEFAULT_MODEL, apiKey: "" }
		const provider = getProvider(requested.provider)
		const apiKey = resolveApiKey(requested.provider, requested.apiKey)

		if (!apiKey && !provider?.keyless) {
			return reply.code(400).send({
				error: `No API key for provider "${requested.provider}". Add it in Settings → Providers.`,
			})
		}

		const resolvedModel: ModelRef = { ...requested, apiKey }

		// Save user message
		addMessage(session.id, "user", text)
		updateSessionStatus(session.id, "running")
		broadcast({ type: "session.updated", sessionId: session.id, status: "running" })

		// Build message history for the API from the full stored transcript
		// (text + tool_use + tool_result), then trim to fit the context window.
		const history = getMessages(session.id)
		const rawMessages: MessageParam[] = history.map((m) => ({
			role: m.role,
			content: m.content as MessageParam["content"],
		}))
		const contextWindow = getModel(requested.provider, requested.model)?.contextWindow ?? 128_000
		const apiMessages = trimHistory(rawMessages, contextWindow)

		const abortController = new AbortController()
		activeAgents.set(session.id, abortController)

		// Run agent loop in background — don't await here so HTTP response returns immediately
		runAgentLoop({
			sessionId: session.id,
			directory: session.directory,
			messages: apiMessages,
			model: resolvedModel,
			signal: abortController.signal,
			emit: (event) => {
				broadcast(event)
			},
			onPermissionRequest: async (req: PermissionRequest) => {
				return new Promise<"allow" | "deny">((resolve) => {
					pendingPermissions.set(req.id, { resolve })
					// Auto-deny after 5 minutes if no response
					setTimeout(() => {
						if (pendingPermissions.has(req.id)) {
							pendingPermissions.delete(req.id)
							resolve("deny")
						}
					}, 5 * 60 * 1000)
				})
			},
		})
			.then(() => {
				activeAgents.delete(session.id)
				updateSessionStatus(session.id, "idle")
			})
			.catch((err) => {
				activeAgents.delete(session.id)
				updateSessionStatus(session.id, "error")
				broadcast({
					type: "session.error",
					sessionId: session.id,
					error: err instanceof Error ? err.message : String(err),
				})
			})

		return { ok: true, sessionId: session.id }
	})

	// ── Abort ────────────────────────────────────────────────────────────
	app.post<{ Params: { id: string } }>("/sessions/:id/abort", async (req, reply) => {
		const controller = activeAgents.get(req.params.id)
		if (!controller) return reply.code(404).send({ error: "No active agent for this session" })
		controller.abort()
		activeAgents.delete(req.params.id)
		updateSessionStatus(req.params.id, "idle")
		broadcast({ type: "session.idle", sessionId: req.params.id })
		return { ok: true }
	})

	// ── Permissions ──────────────────────────────────────────────────────
	app.post<{ Params: { id: string } }>("/permissions/:id/allow", async (req, reply) => {
		const pending = pendingPermissions.get(req.params.id)
		if (!pending) return reply.code(404).send({ error: "Permission request not found or already resolved" })
		pendingPermissions.delete(req.params.id)
		pending.resolve("allow")
		return { ok: true }
	})

	app.post<{ Params: { id: string } }>("/permissions/:id/deny", async (req, reply) => {
		const pending = pendingPermissions.get(req.params.id)
		if (!pending) return reply.code(404).send({ error: "Permission request not found or already resolved" })
		pendingPermissions.delete(req.params.id)
		pending.resolve("deny")
		return { ok: true }
	})

	// ── CORS preflight ───────────────────────────────────────────────────
	app.addHook("onSend", async (req, reply) => {
		reply.header("Access-Control-Allow-Origin", "*")
		reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization")
	})

	await app.listen({ port: PORT, host: "127.0.0.1" })
	console.log(`[xot-engine] running on http://127.0.0.1:${PORT}`)
}

export function stopServer(): void {
	for (const controller of activeAgents.values()) {
		controller.abort()
	}
	activeAgents.clear()
	sseClients.clear()
}
