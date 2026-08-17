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

/**
 * Drop tool blocks that lost their partner — a tool_use with no matching
 * tool_result, or a tool_result with no matching tool_use. Deleting a message
 * (or any transcript edit) can orphan a pair, and the provider APIs reject an
 * unmatched tool block. Messages left empty after filtering are removed.
 */
export function stripOrphanToolBlocks(messages: MessageParam[]): MessageParam[] {
	const useIds = new Set<string>()
	const resultIds = new Set<string>()
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue
		for (const b of m.content) {
			if (typeof b !== "object" || b === null || !("type" in b)) continue
			if (b.type === "tool_use") useIds.add((b as { id: string }).id)
			else if (b.type === "tool_result") resultIds.add((b as { tool_use_id: string }).tool_use_id)
		}
	}

	const out: MessageParam[] = []
	for (const m of messages) {
		if (!Array.isArray(m.content)) {
			out.push(m)
			continue
		}
		const kept = m.content.filter((b) => {
			if (typeof b !== "object" || b === null || !("type" in b)) return true
			if (b.type === "tool_use") return resultIds.has((b as { id: string }).id)
			if (b.type === "tool_result") return useIds.has((b as { tool_use_id: string }).tool_use_id)
			return true
		})
		if (kept.length > 0) out.push({ ...m, content: kept as MessageParam["content"] })
	}
	return out
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
	// Final safety net: remove any tool_use/tool_result left without a partner
	// (e.g. by a deleted message) so the provider API never sees an orphan.
	return stripOrphanToolBlocks(trimmed)
}
