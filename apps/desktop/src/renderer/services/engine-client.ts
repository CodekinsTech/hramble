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
	const res = await fetch(`${ENGINE_URL}${path}`, {
		headers: { "Content-Type": "application/json", ...opts?.headers },
		...opts,
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
