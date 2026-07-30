/**
 * Global prompt history — cross-session ↑/↓ recall in the composer, like a
 * shell's command history (and Claude Code's up-arrow recall).
 *
 * Every sent prompt is appended here (newest last) and persisted, so pressing ↑
 * in an empty composer walks back through what you've asked before — across
 * sessions and restarts.
 */
import { atomWithStorage } from "jotai/utils"

/** Keep the store bounded; oldest entries fall off. */
const MAX_HISTORY = 300

/** Sent prompts, oldest first. Persisted in localStorage. */
export const promptHistoryAtom = atomWithStorage<string[]>("hramble:promptHistory", [])

/**
 * Append a sent prompt. Skips blanks and consecutive duplicates, and caps the
 * list. Returns the new list (caller assigns it back to the atom).
 */
export function pushPromptHistory(history: string[], text: string): string[] {
	const t = text.trim()
	if (!t) return history
	if (history[history.length - 1] === t) return history
	const next = [...history, t]
	return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}
