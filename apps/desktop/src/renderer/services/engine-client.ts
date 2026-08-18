/**
 * Typed fetch client for the xot engine REST API (port 4200).
 *
 * All calls go through plain `fetch` — no SDK, no IPC proxy.
 * The engine always runs locally so we don't need to bypass
 * Chromium's connection limit.
 */

const ENGINE_URL = "http://127.0.0.1:4200"

export interface EngineSession {
	id: string
	title: string
	directory: string
	createdAt: number
	updatedAt: number
	status: "idle" | "running" | "error"
}

export interface EngineModelRef {
	provider: string
	model: string
	apiKey: string
	baseURL?: string
}

async function request<T>(
	path: string,
	opts?: RequestInit,
): Promise<T> {
	// Only send a JSON content-type when there's actually a body. Sending it on a
	// bodyless request (DELETE, or POST abort/unrevert/deny) makes Fastify reject
	// with 400 FST_ERR_CTP_EMPTY_JSON_BODY ("Body cannot be empty…").
	const headers: Record<string, string> = { ...(opts?.headers as Record<string, string>) }
	if (opts?.body != null) headers["Content-Type"] = "application/json"
	const res = await fetch(`${ENGINE_URL}${path}`, {
		...opts,
		headers,
	})
	if (!res.ok) {
		const text = await res.text().catch(() => "")
		throw new Error(`Engine ${opts?.method ?? "GET"} ${path} → ${res.status}: ${text}`)
	}
	return res.json() as Promise<T>
}

export async function engineHealth(): Promise<{ ok: boolean }> {
	return request("/health")
}

export async function createEngineSession(
	directory: string,
	title = "New chat",
): Promise<EngineSession> {
	return request("/sessions", {
		method: "POST",
		body: JSON.stringify({ directory, title }),
	})
}

export interface EngineProject {
	directory: string
	updatedAt: number
	sessionCount: number
}

export interface EngineFileDiff {
	path: string
	before: string | null
	after: string | null
	status: "created" | "modified" | "deleted"
}

/** Net file changes made during a session (from edit checkpoints). */
export async function getEngineSessionDiff(sessionId: string): Promise<EngineFileDiff[]> {
	return request(`/sessions/${sessionId}/diff`)
}

/** Fuzzy file search within an open project directory. */
export async function findEngineFiles(directory: string, query: string): Promise<string[]> {
	const params = new URLSearchParams({ directory })
	if (query) params.set("query", query)
	const res = await request<{ files: string[] }>(`/find?${params.toString()}`)
	return res.files
}

export async function listEngineProjects(): Promise<EngineProject[]> {
	const res = await request<{ projects: EngineProject[] }>("/projects")
	return res.projects
}

export interface EngineDirEntry {
	name: string
	type: "directory" | "file"
	path: string
	ignored: boolean
}

/** List one level of a project directory (file-explorer tree). `path` is "" for the root. */
export async function listEngineDir(directory: string, path = ""): Promise<EngineDirEntry[]> {
	const params = new URLSearchParams({ directory })
	if (path) params.set("path", path)
	const res = await request<{ entries: EngineDirEntry[] }>(`/files?${params.toString()}`)
	return res.entries
}

export interface EngineSkill {
	name: string
	description: string
	slug: string
}

/** List a project's skills (.hramble/skills) for the skill picker. */
export async function listEngineSkills(directory: string): Promise<EngineSkill[]> {
	const params = new URLSearchParams({ directory })
	const res = await request<{ skills: EngineSkill[] }>(`/skills?${params.toString()}`)
	return res.skills
}

export async function listEngineSessions(
	opts: { directory?: string; search?: string; limit?: number } = {},
): Promise<EngineSession[]> {
	const params = new URLSearchParams()
	if (opts.directory) params.set("directory", opts.directory)
	if (opts.search) params.set("search", opts.search)
	if (opts.limit) params.set("limit", String(opts.limit))
	const q = params.toString()
	return request(`/sessions${q ? `?${q}` : ""}`)
}

export async function renameEngineSession(id: string, title: string): Promise<EngineSession> {
	return request(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) })
}

export async function deleteEngineSession(id: string): Promise<{ ok: boolean }> {
	return request(`/sessions/${id}`, { method: "DELETE" })
}

export async function deleteEnginePart(sessionId: string, messageId: string): Promise<{ ok: boolean }> {
	return request(`/sessions/${sessionId}/messages/${messageId}`, { method: "DELETE" })
}

export async function forkEngineSession(id: string, throughMessageId?: string): Promise<EngineSession> {
	return request(`/sessions/${id}/fork`, {
		method: "POST",
		body: JSON.stringify({ throughMessageId }),
	})
}

export async function revertEngineSession(id: string, messageId: string): Promise<{ ok: boolean; reverted: number }> {
	return request(`/sessions/${id}/revert`, { method: "POST", body: JSON.stringify({ messageId }) })
}

export async function unrevertEngineSession(id: string): Promise<{ ok: boolean; restored: number }> {
	return request(`/sessions/${id}/unrevert`, { method: "POST" })
}

export async function summarizeEngineSession(
	id: string,
	model?: EngineModelRef,
): Promise<{ ok: boolean; summary: string }> {
	return request(`/sessions/${id}/summarize`, { method: "POST", body: JSON.stringify({ model }) })
}

export interface EngineModelInfo {
	provider: string
	providerName: string
	id: string
	name: string
	contextWindow: number
	supportsVision: boolean
	supportsTools: boolean
	connected: boolean
}

export async function listEngineModels(): Promise<EngineModelInfo[]> {
	const res = await request<{ models: EngineModelInfo[] }>("/models")
	return res.models
}

export interface EngineProviderInfo {
	id: string
	name: string
	type: string
	keyless: boolean
	connected: boolean
	models: Array<{
		id: string
		name: string
		contextWindow: number
		supportsVision: boolean
		supportsTools: boolean
	}>
}

export interface EngineProvidersResponse {
	providers: EngineProviderInfo[]
	default: { provider: string; model: string }
}

export async function listEngineProviders(): Promise<EngineProvidersResponse> {
	return request("/providers")
}

export async function getEngineConfig(): Promise<{ default: { provider: string; model: string } }> {
	return request("/config")
}

export async function getEngineSession(id: string): Promise<EngineSession & { messages: unknown[] }> {
	return request(`/sessions/${id}`)
}

export async function sendEnginePrompt(
	sessionId: string,
	text: string,
	model?: EngineModelRef,
	opts?: {
		agent?: string
		planMode?: boolean
		permissionMode?: "manual" | "accept-edits" | "auto" | "bypass"
		attachments?: Array<{ filename?: string; mime?: string; url?: string }>
	},
): Promise<{ ok: boolean; sessionId: string }> {
	return request(`/sessions/${sessionId}/prompt`, {
		method: "POST",
		body: JSON.stringify({
			text,
			model,
			agent: opts?.agent,
			planMode: opts?.planMode,
			permissionMode: opts?.permissionMode,
			attachments: opts?.attachments,
		}),
	})
}

export async function abortEngineSession(sessionId: string): Promise<{ ok: boolean }> {
	return request(`/sessions/${sessionId}/abort`, { method: "POST" })
}

/** Whether the engine still has an agent running for this session. */
export async function isEngineSessionActive(sessionId: string): Promise<boolean> {
	const res = await request<{ active: boolean }>(`/sessions/${sessionId}/status`)
	return res.active
}

/**
 * Resolve once the engine's agent run for a session has finished (or a timeout /
 * abort predicate fires). The engine's /prompt returns immediately and runs in
 * the background, so callers that need the result (7-steps verify, Hyperloop,
 * proforge diff harvest) await this. Polls the definitive activeAgents-backed
 * status endpoint rather than racing the SSE stream.
 *
 * Waits for the run to actually START (become active) before treating "not
 * active" as done, so a poll landing in the gap between prompt POST and agent
 * spin-up doesn't return prematurely. If it never becomes active within
 * `startGraceMs`, assumes it finished too fast to observe and returns.
 */
export async function waitForEngineSessionIdle(
	sessionId: string,
	opts?: { timeoutMs?: number; pollMs?: number; startGraceMs?: number; shouldStop?: () => boolean },
): Promise<void> {
	const timeoutMs = opts?.timeoutMs ?? 600_000
	const pollMs = opts?.pollMs ?? 600
	const startGraceMs = opts?.startGraceMs ?? 8_000
	const start = performance.now()
	let seenActive = false
	while (performance.now() - start < timeoutMs) {
		if (opts?.shouldStop?.()) return
		await new Promise((r) => setTimeout(r, pollMs))
		if (opts?.shouldStop?.()) return
		const active = await isEngineSessionActive(sessionId).catch(() => false)
		if (active) {
			seenActive = true
			continue
		}
		if (seenActive) return
		// Never observed a busy window — assume the run finished before our first poll.
		if (performance.now() - start > startGraceMs) return
	}
}

export async function allowEnginePermission(
	permissionId: string,
	always = false,
): Promise<{ ok: boolean }> {
	return request(`/permissions/${permissionId}/allow`, {
		method: "POST",
		body: JSON.stringify({ always }),
	})
}

export async function denyEnginePermission(permissionId: string): Promise<{ ok: boolean }> {
	return request(`/permissions/${permissionId}/deny`, { method: "POST" })
}

/**
 * Open the SSE event stream. Returns an EventSource.
 * Caller is responsible for closing it when done.
 */
export function openEngineEventStream(): EventSource {
	return new EventSource(`${ENGINE_URL}/events`)
}
