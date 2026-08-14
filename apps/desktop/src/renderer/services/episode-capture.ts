/**
 * Layer 3 — Episode capture (renderer side).
 *
 * When a session goes idle (a task/round just finished), snapshot a compact
 * "episode" from what's already in the store — the user's original request and a
 * rough success/failure read of the final assistant turn — and hand it to the
 * main process to persist. Capture is the least-invasive trigger available: it
 * rides the existing `session.status: idle` event the connection manager already
 * handles, so no new hook into the engine is needed.
 *
 * Everything here is best-effort and error-swallowing: if anything is missing or
 * throws, we simply don't record — capture must never disturb a session ending.
 * The toggle is enforced in the main process (`brain:record-episode` no-ops when
 * `brainEpisodicMemory` is off), mirroring how Layer 2's recall is gated.
 */

import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { sessionFamily } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"

const log = createLogger("episode-capture")

// Per-session signature of the last capture, so repeated idle events for the same
// session don't rewrite the store unless something actually changed.
const lastCaptured = new Map<string, string>()

// Rough outcome heuristics read off the final assistant turn. Deliberately simple
// (the task calls for a best-effort signal, not a classifier): a clear completion
// phrase ⇒ "success"; a clear can't/failed phrase with no completion ⇒ "failed";
// otherwise "unknown".
const COMPLETION =
	/\b(done|completed?|finished|fixed|resolved|works?|working|implemented|added|created|updated|deployed|ready|success(?:fully)?|all set|here'?s)\b/i
const FAILURE =
	/\b(could ?n'?t|could not|un ?able to|can'?t|cannot|failed|errored?|not able|no luck|stuck|did ?n'?t work|does ?n'?t work|do not work)\b/i

/** Concatenate the text parts of a message (skipping our own injected blocks). */
function messageText(messageId: string): string {
	const parts = appStore.get(partsFamily(messageId)) ?? []
	const chunks: string[] = []
	for (const p of parts) {
		if (p.type !== "text") continue
		const t = (p.text || "").trim()
		if (!t) continue
		// Skip the agent-only context blocks Layer 2/3 prepend — they are not the
		// user's words and would poison both the task text and the outcome read.
		if (t.startsWith("[Brain —") || t.startsWith("[Brain memory —")) continue
		chunks.push(t)
	}
	return chunks.join("\n").trim()
}

/** The user's original request for this session (first user message, or title). */
function firstUserTask(sessionId: string): string {
	const messages = appStore.get(messagesFamily(sessionId)) ?? []
	for (const m of messages) {
		if (m.role !== "user") continue
		const text = messageText(m.id)
		if (text) return text
	}
	// Fallback: the session title the engine derived (often the first request).
	const entry = appStore.get(sessionFamily(sessionId))
	return (entry?.session?.title || "").trim()
}

/** Concatenated text of the most recent assistant message, for the outcome read. */
function lastAssistantText(sessionId: string): string {
	const messages = appStore.get(messagesFamily(sessionId)) ?? []
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "assistant") continue
		const text = messageText(messages[i].id)
		if (text) return text
	}
	return ""
}

function guessOutcome(text: string): "success" | "failed" | "unknown" {
	if (!text) return "unknown"
	// Read the tail — the sign-off is where "done" / "couldn't" usually lands.
	const tail = text.slice(-600)
	const completed = COMPLETION.test(tail)
	const failed = FAILURE.test(tail)
	if (completed && !failed) return "success"
	if (failed && !completed) return "failed"
	return "unknown"
}

/**
 * Capture (or refine) the episode for a session that just went idle. Safe to call
 * on every idle event — it dedupes by a content signature and no-ops when there's
 * nothing meaningful to record. Never throws.
 */
export function captureEpisode(sessionId: string): void {
	try {
		const record = window.hramble?.recordEpisode
		if (!record || !sessionId) return

		const task = firstUserTask(sessionId)
		if (!task) return

		const messages = appStore.get(messagesFamily(sessionId)) ?? []
		const outcome = guessOutcome(lastAssistantText(sessionId))

		// Only write when something changed since the last capture for this session.
		const signature = `${messages.length}:${outcome}`
		if (lastCaptured.get(sessionId) === signature) return
		lastCaptured.set(sessionId, signature)

		void record({ id: sessionId, task, outcome }).catch(() => {})
	} catch (err) {
		log.debug("episode capture skipped", {
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
