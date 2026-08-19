/**
 * Local / LAN Ollama helpers.
 *
 * Ollama can run on another machine (e.g. a Mac on the same network) and serve
 * models over HTTP. The user sets that server's URL in Settings → General; we
 * persist it under this localStorage key and send it to the engine as the
 * per-request `ModelRef.baseURL` for the "ollama" provider, overriding the
 * engine's localhost default.
 */

export const OLLAMA_BASE_URL_KEY = "hramble:ollamaBaseURL"

/** Normalize a user-entered Ollama URL to an OpenAI-compatible base (…/v1). */
export function normalizeOllamaBaseURL(raw: string): string {
	const base = (raw || "").trim().replace(/\/+$/, "")
	if (!base) return ""
	return base.endsWith("/v1") ? base : `${base}/v1`
}

/** Read the persisted Ollama server base URL (normalized), or "" if unset. */
export function readOllamaBaseURL(): string {
	try {
		const raw = localStorage.getItem(OLLAMA_BASE_URL_KEY)
		// atomWithStorage persists as JSON, so the value is a quoted string.
		return normalizeOllamaBaseURL(raw ? (JSON.parse(raw) as string) : "")
	} catch {
		return ""
	}
}
