import path from "node:path"
import Fastify from "fastify"
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js"
import { nanoid } from "nanoid"
import type { EngineEvent, ModelRef, PermissionRequest, PermissionResolution, PermissionMode, ContentBlock } from "./types.js"
import { engineEventToAGUI } from "./agui.js"
import { runAgentLoop } from "./agent.js"
import { resolveApiKey } from "./auth.js"
import { getProvider, getModel, getAllProviders } from "./providers.js"
import { trimHistory, estimateTokens } from "./limits.js"
import {
	initDb,
	createSession,
	getSession,
	listSessions,
	listProjectDirs,
	updateSessionStatus,
	addMessage,
	getMessages,
	getTodos,
	getUsage,
	getSessionDiff,
	renameSession,
	deleteSession,
	deleteMessage,
	forkSession,
	compactSession,
	compactSessionPreservingRecent,
	revertSession,
	unrevertSession,
	deriveTitle,
	isGenericTitle,
} from "./sessions.js"
import { summarizeConversation } from "./summarize.js"
import { maybeImportOpenCode } from "./opencode-import.js"
import { buildAttachments, type Attachment } from "./attachments.js"
import { searchFiles } from "./tools/glob.js"
import { listDirectory } from "./fsutil.js"
import { discoverSkills } from "./skills.js"

const PORT = Number(process.env.ENGINE_PORT) || 4200

// Zero-setup default: the free, keyless OpenCode Zen tier so chat works with no keys.
const DEFAULT_MODEL = { provider: "opencode", model: "nemotron-3.5-lightning-free" }

// Active SSE clients — broadcast all events to every connected client
const sseClients = new Set<{ sessionId?: string; write: (event: EngineEvent) => void }>()

// Active agent abort controllers — keyed by sessionId
const activeAgents = new Map<string, AbortController>()

// Pending permission requests — keyed by permissionId
const pendingPermissions = new Map<
	string,
	{ resolve: (resolution: PermissionResolution) => void; timer: NodeJS.Timeout; sessionId: string }
>()

/** True if `directory` is (or is inside) a project the engine already tracks. */
function isKnownProjectDir(directory: string): boolean {
	const target = path.resolve(directory)
	for (const s of listSessions()) {
		const dir = path.resolve(s.directory)
		if (target === dir || target.startsWith(dir + path.sep)) return true
	}
	return false
}

/** True for the desktop renderer / local origins; false for real remote sites. */
function isLocalOrigin(origin: string): boolean {
	if (origin === "null") return true // sandboxed/file pages report a null origin
	try {
		const u = new URL(origin)
		if (u.protocol === "file:" || u.protocol === "app:" || u.protocol === "tauri:") return true
		const h = u.hostname
		return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".localhost")
	} catch {
		return false
	}
}

/** Resolve + clean up a pending permission (clears its auto-reject timer). */
function settlePermission(permissionId: string, resolution: PermissionResolution): boolean {
	const pending = pendingPermissions.get(permissionId)
	if (!pending) return false
	clearTimeout(pending.timer)
	pendingPermissions.delete(permissionId)
	pending.resolve(resolution)
	return true
}

/** Reject every pending permission for a session (e.g. on abort/delete). */
function rejectSessionPermissions(sessionId: string): void {
	for (const [id, p] of pendingPermissions) {
		if (p.sessionId === sessionId) settlePermission(id, "reject")
	}
}

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
	// One-time: bring the user's existing OpenCode sessions into the engine store
	// so history carries over on the cutover (idempotent — skips if already done).
	maybeImportOpenCode()

	const app = Fastify({ logger: false })

	// ── Health ──────────────────────────────────────────────────────────
	app.get("/health", async () => ({ ok: true, engine: "zyot", version: "0.1.0" }))

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

		// File search by name — replaces OpenCode's find.files for the picker.
		// We glob everything then substring-filter, so a query containing glob
		// metacharacters ([ { * ?) can't break or inject into the pattern.
		app.get("/find", async (req, reply) => {
			const { directory, query } = req.query as { directory?: string; query?: string }
			if (!directory) return reply.code(400).send({ error: "directory is required" })
			// Only search directories the engine already knows as projects — never an
			// arbitrary path like C:\ (info-disclosure + whole-disk-glob DoS).
			if (!isKnownProjectDir(directory)) {
				return reply.code(403).send({ error: "directory is not an open project" })
			}
			// Full-tree search, capping only the RESULT count (not the pre-filter list).
			return { files: await searchFiles(query ?? "", directory) }
		})

	// ── List one directory level (file-explorer tree) ─────────────────────
	app.get("/files", async (req, reply) => {
		const { directory, path: relPath } = req.query as { directory?: string; path?: string }
		if (!directory) return reply.code(400).send({ error: "directory is required" })
		// Only list inside directories the engine knows as projects — the root is
		// validated here and listDirectory refuses any `..` escape below it.
		if (!isKnownProjectDir(directory)) {
			return reply.code(403).send({ error: "directory is not an open project" })
		}
		try {
			return { entries: await listDirectory(directory, relPath ?? "") }
		} catch {
			return { entries: [] }
		}
	})

	// ── List a project's skills (skill picker) ────────────────────────────
	app.get("/skills", async (req, reply) => {
		const { directory } = req.query as { directory?: string }
		if (!directory) return reply.code(400).send({ error: "directory is required" })
		if (!isKnownProjectDir(directory)) {
			return reply.code(403).send({ error: "directory is not an open project" })
		}
		return { skills: discoverSkills(directory) }
	})

	// ── SSE event stream ─────────────────────────────────────────────────
	app.get("/events", (req, reply) => {
		reply.raw.setHeader("Content-Type", "text/event-stream")
		reply.raw.setHeader("Cache-Control", "no-cache")
		reply.raw.setHeader("Connection", "keep-alive")
		reply.raw.setHeader("Access-Control-Allow-Origin", "*")
		// Defeat any proxy/stream buffering so each event flushes immediately.
		reply.raw.setHeader("X-Accel-Buffering", "no")
		reply.raw.flushHeaders()
		reply.raw.socket?.setNoDelay(true)

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

	// ── AG-UI event stream ───────────────────────────────────────────────
	// Mirrors /events exactly, but each engine event is passed through the
	// AG-UI adapter and every resulting AG-UI event is written as its own
	// `data:` frame. /events and the EngineEvent broadcast are untouched.
	app.get("/agui", (req, reply) => {
		reply.raw.setHeader("Content-Type", "text/event-stream")
		reply.raw.setHeader("Cache-Control", "no-cache")
		reply.raw.setHeader("Connection", "keep-alive")
		reply.raw.setHeader("Access-Control-Allow-Origin", "*")
		// Defeat any proxy/stream buffering so each event flushes immediately.
		reply.raw.setHeader("X-Accel-Buffering", "no")
		reply.raw.flushHeaders()
		reply.raw.socket?.setNoDelay(true)

		const write = (event: EngineEvent) => {
			for (const aguiEvent of engineEventToAGUI(event)) {
				reply.raw.write(`data: ${JSON.stringify(aguiEvent)}\n\n`)
			}
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

	// ── Projects ─────────────────────────────────────────────────────────
	// Distinct project directories that have engine sessions (sidebar source).
	app.get("/projects", async () => {
		return { projects: listProjectDirs() }
	})

	// ── Sessions ─────────────────────────────────────────────────────────
	app.get("/sessions", async (req) => {
		const { directory, search, limit } = req.query as { directory?: string; search?: string; limit?: string }
		return listSessions({ directory, search, limit: limit ? Number(limit) : undefined })
	})

	app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
		const session = getSession(req.params.id)
		if (!session) return reply.code(404).send({ error: "Session not found" })
		const messages = getMessages(req.params.id)
		return { ...session, messages }
	})

	app.get<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		return getMessages(req.params.id)
	})

	app.get<{ Params: { id: string } }>("/sessions/:id/todos", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		return getTodos(req.params.id)
	})

	app.get<{ Params: { id: string } }>("/sessions/:id/usage", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		return getUsage(req.params.id)
	})

	// Files changed during this session (from edit checkpoints).
	app.get<{ Params: { id: string } }>("/sessions/:id/diff", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		return getSessionDiff(req.params.id)
	})

	// Rename a session's title.
	app.patch<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
		const { title } = req.body as { title?: string }
		if (!title?.trim()) return reply.code(400).send({ error: "title is required" })
		const session = renameSession(req.params.id, title.trim())
		if (!session) return reply.code(404).send({ error: "Session not found" })
		broadcast({ type: "session.updated", sessionId: session.id, status: session.status })
		return session
	})

	// Delete a session and its transcript (aborting any active run first).
	app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
		const active = activeAgents.get(req.params.id)
		if (active) {
			active.abort()
			activeAgents.delete(req.params.id)
			rejectSessionPermissions(req.params.id)
		}
		if (!deleteSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		broadcast({ type: "session.deleted", sessionId: req.params.id })
		return { ok: true }
	})

	// Delete a single message ("part") from a session.
	app.delete<{ Params: { id: string; messageId: string } }>(
		"/sessions/:id/messages/:messageId",
		async (req, reply) => {
			if (!deleteMessage(req.params.id, req.params.messageId)) {
				return reply.code(404).send({ error: "Message not found" })
			}
			return { ok: true }
		},
	)

	// Fork a session (optionally up to a given message).
	app.post<{ Params: { id: string } }>("/sessions/:id/fork", async (req, reply) => {
		const { throughMessageId } = req.body as { throughMessageId?: string }
		const fork = forkSession(req.params.id, throughMessageId)
		if (!fork) return reply.code(404).send({ error: "Session or message not found" })
		broadcast({ type: "session.created", sessionId: fork.id, title: fork.title, directory: fork.directory })
		return fork
	})

	// Revert a session to a message, rolling back file edits made after it.
	app.post<{ Params: { id: string } }>("/sessions/:id/revert", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		const { messageId } = req.body as { messageId?: string }
		if (!messageId) return reply.code(400).send({ error: "messageId is required" })
		// Abort any in-flight run first — otherwise it keeps appending to the
		// transcript we're about to rewind, corrupting the session.
		const active = activeAgents.get(req.params.id)
		if (active) {
			active.abort()
			activeAgents.delete(req.params.id)
			updateSessionStatus(req.params.id, "idle")
		}
		const result = revertSession(req.params.id, messageId)
		if (!result) return reply.code(404).send({ error: "Message not found" })
		broadcast({ type: "session.reverted", sessionId: req.params.id })
		return { ok: true, ...result }
	})

	// Unrevert — replay the most recently reverted batch (redo).
	app.post<{ Params: { id: string } }>("/sessions/:id/unrevert", async (req, reply) => {
		if (!getSession(req.params.id)) return reply.code(404).send({ error: "Session not found" })
		const result = unrevertSession(req.params.id)
		if (!result) return reply.code(400).send({ error: "Nothing to unrevert" })
		broadcast({ type: "session.reverted", sessionId: req.params.id })
		return { ok: true, ...result }
	})

	// Summarize / compact a session — replace the transcript with a summary.
	app.post<{ Params: { id: string } }>("/sessions/:id/summarize", async (req, reply) => {
		const session = getSession(req.params.id)
		if (!session) return reply.code(404).send({ error: "Session not found" })

		const { model } = req.body as { model?: ModelRef }
		const requested = model ?? { ...DEFAULT_MODEL, apiKey: "" }
		const provider = getProvider(requested.provider)
		const apiKey = resolveApiKey(requested.provider, requested.apiKey)
		if (!apiKey && !provider?.keyless) {
			return reply.code(400).send({ error: `No API key for provider "${requested.provider}".` })
		}

		const history = getMessages(req.params.id)
		if (history.length < 2) return reply.code(400).send({ error: "Not enough history to summarize." })

		const rawMessages: MessageParam[] = history.map((m) => ({
			role: m.role,
			content: m.content as MessageParam["content"],
		}))
		try {
			const summary = await summarizeConversation({ ...requested, apiKey }, rawMessages)
			const message = compactSession(req.params.id, summary)
			broadcast({ type: "session.updated", sessionId: req.params.id, status: session.status })
			return { ok: true, summary, message }
		} catch (err) {
			return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) })
		}
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

		const { text, model, agent, planMode, attachments, permissionMode } = req.body as {
			text: string
			model?: ModelRef
			agent?: string
			planMode?: boolean
			attachments?: Attachment[]
			permissionMode?: PermissionMode
		}
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

		// Prepend attached text context inline; attach images as real vision blocks
		// (the one message shape both providers accept for images).
		const { text: attachmentContext, images } = buildAttachments(attachments, session.directory)
		const userText = attachmentContext ? `${attachmentContext}${text}` : text
		const userContent: string | ContentBlock[] =
			images.length > 0
				? [...images.map((im) => ({ type: "image" as const, mimeType: im.mimeType, data: im.data })), { type: "text" as const, text: userText }]
				: userText

		// Save user message
		const wasEmpty = getMessages(session.id).length === 0
		addMessage(session.id, "user", userContent)
		// Auto-title a fresh session from its first message (engine-side, no model
		// call) so engine-created sessions are recognizable instead of "New chat".
		if (wasEmpty && isGenericTitle(session.title)) {
			const title = deriveTitle(text)
			if (title) {
				renameSession(session.id, title)
				broadcast({ type: "session.updated", sessionId: session.id, status: "running", title })
			}
		}
		updateSessionStatus(session.id, "running")
		broadcast({ type: "session.updated", sessionId: session.id, status: "running" })

		const contextWindow = getModel(requested.provider, requested.model)?.contextWindow ?? 128_000

		// Auto-compaction: when the stored transcript approaches the context window,
		// summarize the older turns into one message (preserving the current one)
		// BEFORE running — so a long session keeps its thread instead of silently
		// dropping the oldest turns. Best-effort: on failure we fall through to the
		// token-based trim below, which never fails.
		const preHistory = getMessages(session.id)
		const preRaw: MessageParam[] = preHistory.map((m) => ({ role: m.role, content: m.content as MessageParam["content"] }))
		if (preHistory.length > 4 && estimateTokens(preRaw) > contextWindow * 0.8) {
			try {
				const prior = preRaw.slice(0, -1) // everything except the just-added user turn
				const summary = await summarizeConversation(resolvedModel, prior)
				if (summary.trim()) {
					compactSessionPreservingRecent(session.id, summary, 1)
					broadcast({ type: "session.updated", sessionId: session.id, status: "running" })
				}
			} catch {
				// summarizer unavailable — keep going; trimHistory handles the overflow.
			}
		}

		// Build message history for the API from the (possibly compacted) transcript
		// (text + tool_use + tool_result), then trim to fit the context window.
		const history = getMessages(session.id)
		const rawMessages: MessageParam[] = history.map((m) => ({
			role: m.role,
			content: m.content as MessageParam["content"],
		}))
		const apiMessages = trimHistory(rawMessages, contextWindow)

		const abortController = new AbortController()
		activeAgents.set(session.id, abortController)

		const onPermissionRequest = async (req: PermissionRequest) =>
			new Promise<PermissionResolution>((resolve) => {
				// Auto-reject after 5 minutes if no response (timer cleared on resolve).
				const timer = setTimeout(() => settlePermission(req.id, "reject"), 5 * 60 * 1000)
				pendingPermissions.set(req.id, { resolve, timer, sessionId: session.id })
			})

		// Run one agent phase over the current stored transcript.
		const runPhase = (msgs: MessageParam[], mode: "build" | "plan") =>
			runAgentLoop({
				sessionId: session.id,
				directory: session.directory,
				messages: msgs,
				model: resolvedModel,
				signal: abortController.signal,
				mode,
				permissionMode: permissionMode ?? "auto",
				emit: (event) => broadcast(event),
				onPermissionRequest,
			})

		// planMode = plan (read-only) then build (execute) in one request.
		// agent "plan" = a single read-only planning turn.
		const orchestrate = async () => {
			if (planMode) {
				await runPhase(apiMessages, "plan")
				if (abortController.signal.aborted) return
				addMessage(session.id, "user", "Now carry out that plan exactly — make all the file edits and run any commands needed.")
				const hist2 = getMessages(session.id).map((m) => ({ role: m.role, content: m.content as MessageParam["content"] }))
				await runPhase(trimHistory(hist2, contextWindow), "build")
			} else {
				await runPhase(apiMessages, agent === "plan" ? "plan" : "build")
			}
		}

		// Run in background — don't await so the HTTP response returns immediately.
		orchestrate()
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

	// ── Run status ────────────────────────────────────────────────────────
	// Definitive "is the agent still running for this session" — backed by the
	// activeAgents map, so callers (7-steps / Hyperloop / proforge) can await a
	// run's completion instead of racing the SSE stream.
	app.get<{ Params: { id: string } }>("/sessions/:id/status", async (req) => {
		return { active: activeAgents.has(req.params.id) }
	})

	// ── Abort ────────────────────────────────────────────────────────────
	app.post<{ Params: { id: string } }>("/sessions/:id/abort", async (req, reply) => {
		const controller = activeAgents.get(req.params.id)
		if (!controller) return reply.code(404).send({ error: "No active agent for this session" })
		controller.abort()
		activeAgents.delete(req.params.id)
		rejectSessionPermissions(req.params.id)
		updateSessionStatus(req.params.id, "idle")
		broadcast({ type: "session.idle", sessionId: req.params.id })
		return { ok: true }
	})

	// ── Permissions ──────────────────────────────────────────────────────
	app.post<{ Params: { id: string } }>("/permissions/:id/allow", async (req, reply) => {
		const { always } = (req.body ?? {}) as { always?: boolean }
		if (!settlePermission(req.params.id, always ? "always" : "once")) {
			return reply.code(404).send({ error: "Permission request not found or already resolved" })
		}
		return { ok: true }
	})

	app.post<{ Params: { id: string } }>("/permissions/:id/deny", async (req, reply) => {
		if (!settlePermission(req.params.id, "reject")) {
			return reply.code(404).send({ error: "Permission request not found or already resolved" })
		}
		return { ok: true }
	})

	// ── CORS ─────────────────────────────────────────────────────────────
	const CORS_METHODS = "GET,POST,PATCH,DELETE,OPTIONS"
	app.addHook("onRequest", async (req, reply) => {
		// Drive-by RCE guard: reject real remote origins; allow local/app origins
		// and origin-less clients (native fetch, curl).
		const origin = req.headers.origin
		if (origin && !isLocalOrigin(origin)) {
			await reply.code(403).send({ error: "Forbidden: cross-origin requests are not allowed" })
		}
	})
	app.addHook("onSend", async (req, reply) => {
		reply.header("Access-Control-Allow-Origin", req.headers.origin ?? "*")
		reply.header("Vary", "Origin")
		reply.header("Access-Control-Allow-Methods", CORS_METHODS)
		reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		reply.header("Access-Control-Allow-Private-Network", "true")
	})

	// Preflight: a GET/POST with Content-Type: application/json (or any custom
	// header) triggers a CORS preflight in the Electron renderer. Without a 2xx
	// OPTIONS response the browser blocks the real request — so answer every
	// preflight here, incl. Chromium's Private-Network-Access requirement.
	app.options("/*", async (_req, reply) => {
		reply
			.header("Access-Control-Allow-Origin", "*")
			.header("Access-Control-Allow-Methods", CORS_METHODS)
			.header("Access-Control-Allow-Headers", "Content-Type,Authorization")
			.header("Access-Control-Allow-Private-Network", "true")
			.header("Access-Control-Max-Age", "86400")
			.code(204)
			.send()
	})

	await app.listen({ port: PORT, host: "127.0.0.1" })
	console.log(`[zyot-engine] running on http://127.0.0.1:${PORT}`)
}

export function stopServer(): void {
	for (const controller of activeAgents.values()) {
		controller.abort()
	}
	activeAgents.clear()
	sseClients.clear()
}
