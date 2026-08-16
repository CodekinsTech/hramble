import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js"

/** Max characters returned from a single tool call before we truncate. */
export const MAX_TOOL_OUTPUT_CHARS = 30_000
/** Max characters kept from a single line when numbering file reads. */
export const MAX_LINE_CHARS = 2_000
/** Default number of lines returned by the read tool when no limit is given. */
export const DEFAULT_READ_LINES = 2_000
/** Max output tokens requested per model turn. */
export const MAX_OUTPUT_TOKENS = 8_192

/**
 * Cap requested output tokens so they always fit the model's window — a small
 * (e.g. 8k) model can't be asked for a full 8k of output with no room for input.
 */
export function resolveMaxOutputTokens(contextWindow: number): number {
	return Math.max(1024, Math.min(MAX_OUTPUT_TOKENS, Math.floor(contextWindow * 0.25)))
}

/**
 * Trim a large tool output to a character budget, keeping the head and tail
 * (the ends usually carry the signal — command start and final error/summary).
 */
export function truncateOutput(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
	if (text.length <= maxChars) return text
	const keep = Math.floor(maxChars / 2)
	const head = text.slice(0, keep)
	const tail = text.slice(text.length - keep)
	const omitted = text.length - keep * 2
	return `${head}\n\n[... ${omitted.toLocaleString()} characters truncated ...]\n\n${tail}`
}

/** Rough token estimate (~4 chars/token) — good enough for budget decisions. */
function estimateTokens(messages: MessageParam[]): number {
	let chars = 0
	for (const m of messages) {
		chars += typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length
	}
	return Math.ceil(chars / 4)
}

function isOrphanToolResult(m: MessageParam): boolean {
	return (
		m.role === "user" &&
		Array.isArray(m.content) &&
		m.content.some((c) => typeof c === "object" && c !== null && "type" in c && c.type === "tool_result")
	)
}

/**
 * Drop the oldest messages until the estimated token count fits the budget,
 * without ever splitting a tool_use from its tool_result (an orphaned
 * tool_result as the first message is invalid for the Anthropic API).
 * Always keeps at least the final two messages (the current user turn).
 */
export function trimHistory(
	messages: MessageParam[],
	contextWindow: number,
	reserveTokens = MAX_OUTPUT_TOKENS,
): MessageParam[] {
	// Reserve room for the model's reply, but never reserve so much that a
	// small-window model (e.g. an 8k context) leaves no budget for input.
	const reserve = Math.min(reserveTokens, Math.floor(contextWindow * 0.25))
	const budget = Math.floor(contextWindow * 0.9) - reserve

	const trimmed = [...messages]
	while (trimmed.length > 2 && estimateTokens(trimmed) > budget) {
		trimmed.shift()
		// If dropping left an orphaned tool_result at the front, drop it too.
		while (trimmed.length > 2 && isOrphanToolResult(trimmed[0])) {
			trimmed.shift()
		}
	}
	return trimmed
}
