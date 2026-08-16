/** Transient-error retry policy for provider API calls. */

export const MAX_RETRIES = 4
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 15_000

/** HTTP statuses worth retrying — rate limits and transient server faults. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

/** Network-level error codes/markers that indicate a transient blip. */
const RETRYABLE_MARKERS = [
	"ECONNRESET",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"EAI_AGAIN",
	"EPIPE",
	"socket hang up",
	"fetch failed",
	"network error",
	"terminated",
]

function getStatus(err: unknown): number | undefined {
	if (typeof err === "object" && err !== null) {
		const s = (err as { status?: unknown }).status
		if (typeof s === "number") return s
	}
	return undefined
}

/** True if the error is a transient failure that a retry might clear. */
export function isTransientError(err: unknown): boolean {
	const status = getStatus(err)
	if (status !== undefined) return RETRYABLE_STATUS.has(status)

	const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name ?? "") : ""
	if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true

	const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : ""
	const message = err instanceof Error ? err.message : String(err)
	const haystack = `${code} ${message}`.toLowerCase()
	return RETRYABLE_MARKERS.some((m) => haystack.includes(m.toLowerCase()))
}

/** Read a Retry-After header (seconds) off an SDK error, if present. */
function retryAfterMs(err: unknown): number | undefined {
	if (typeof err !== "object" || err === null) return undefined
	const headers = (err as { headers?: unknown }).headers
	let raw: string | null | undefined
	if (headers && typeof (headers as Headers).get === "function") {
		raw = (headers as Headers).get("retry-after")
	} else if (headers && typeof headers === "object") {
		raw = (headers as Record<string, string>)["retry-after"]
	}
	if (!raw) return undefined
	const seconds = Number(raw)
	if (!Number.isFinite(seconds) || seconds < 0) return undefined
	return Math.min(seconds * 1000, MAX_DELAY_MS)
}

/**
 * Delay before the next attempt: honor Retry-After when the server sends it,
 * otherwise exponential backoff with full jitter, capped.
 * `attempt` is 1-based (1 = first retry).
 */
export function backoffDelay(attempt: number, err?: unknown): number {
	const serverHint = retryAfterMs(err)
	if (serverHint !== undefined) return serverHint
	const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
	return Math.floor(ceiling * (0.5 + Math.random() * 0.5))
}

/** Abortable sleep — resolves early (still resolves) if the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve()
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timer)
			resolve()
		}
		signal?.addEventListener("abort", onAbort, { once: true })
	})
}
