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

export async function listEngineSessions(directory?: string): Promise<EngineSession[]> {
	const q = directory ? `?directory=${encodeURIComponent(directory)}` : ""
	return request(`/sessions${q}`)
}

export async function getEngineSession(id: string): Promise<EngineSession & { messages: unknown[] }> {
	return request(`/sessions/${id}`)
}

export async function sendEnginePrompt(
	sessionId: string,
	text: string,
	model?: EngineModelRef,
): Promise<{ ok: boolean; sessionId: string }> {
	return request(`/sessions/${sessionId}/prompt`, {
		method: "POST",
		body: JSON.stringify({ text, model }),
	})
}

export async function abortEngineSession(sessionId: string): Promise<{ ok: boolean }> {
	return request(`/sessions/${sessionId}/abort`, { method: "POST" })
}

export async function allowEnginePermission(permissionId: string): Promise<{ ok: boolean }> {
	return request(`/permissions/${permissionId}/allow`, { method: "POST" })
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
