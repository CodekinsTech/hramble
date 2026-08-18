/**
 * Maps the xot engine's stored transcript (message-grained content blocks) into
 * the OpenCode-shaped { info: Message, parts: Part[] } entries the chat UI and
 * session atoms consume — so loading an EXISTING engine session renders exactly
 * like an OpenCode one. Live streaming is handled separately by
 * engine-event-processor; this is the one-time hydration on session open.
 */
import type { Message, Part, Session, SessionStatus, TextPart, ToolPart, FilePart, UserMessage, AssistantMessage, OpenCodeProject, FileDiff } from "../lib/types"
import type { EngineSession, EngineProject, EngineFileDiff } from "./engine-client"

/**
 * Count added/removed lines between two file versions. Uses an LCS line diff for
 * accuracy on modest files, falling back to a set-based estimate on very large
 * ones to keep it O(n) instead of O(n²).
 */
function countChanges(before: string | null, after: string | null): { additions: number; deletions: number } {
	if (before === null) return { additions: after ? after.split("\n").length : 0, deletions: 0 }
	if (after === null) return { additions: 0, deletions: before.split("\n").length }
	const b = before.split("\n")
	const a = after.split("\n")
	const LIMIT = 2000
	if (b.length > LIMIT || a.length > LIMIT) {
		const bSet = new Set(b)
		const aSet = new Set(a)
		return { additions: a.filter((l) => !bSet.has(l)).length, deletions: b.filter((l) => !aSet.has(l)).length }
	}
	// LCS length via DP.
	const m = b.length
	const n = a.length
	let prev = new Int32Array(n + 1)
	let cur = new Int32Array(n + 1)
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			cur[j] = b[i - 1] === a[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
		}
		;[prev, cur] = [cur, prev]
		cur.fill(0)
	}
	const lcs = prev[n]
	return { additions: n - lcs, deletions: m - lcs }
}

/** Map engine file diffs to the app's FileDiff shape (adds +/- line counts). */
export function engineDiffsToFileDiffs(raw: EngineFileDiff[]): FileDiff[] {
	return raw.map((d) => {
		const { additions, deletions } = countChanges(d.before, d.after)
		// The SDK FileDiff keys the path as `file` (forward slashes so the UI's
		// path.split("/") / lastIndexOf(".") work); keep `path` too for safety.
		const file = d.path.replace(/\\/g, "/")
		// The UI's status vocabulary is added|modified|deleted; the engine emits
		// created|modified|deleted, so map created -> added or the diff status
		// badge lookup returns undefined and crashes the panel.
		const status = d.status === "created" ? "added" : d.status
		// The UI diff view calls before/after.split(...) directly, so never hand it
		// null (created files have before=null, deleted have after=null).
		return { file, path: d.path, before: d.before ?? "", after: d.after ?? "", status, additions, deletions } as unknown as FileDiff
	})
}

/** Map an engine project directory to the app's Project (sidebar) shape. */
export function engineProjectToProject(p: EngineProject): OpenCodeProject {
	const name = p.directory.split(/[\\/]/).filter(Boolean).pop() ?? p.directory
	return {
		id: p.directory,
		worktree: p.directory,
		name,
		time: { created: p.updatedAt, updated: p.updatedAt },
		sandboxes: [],
	} as unknown as OpenCodeProject
}

// Engine content-block shapes (mirror packages/engine/src/types.ts ContentBlock).
interface EngineBlock {
	type: "text" | "tool_use" | "tool_result" | "image"
	text?: string
	id?: string
	name?: string
	input?: Record<string, unknown>
	tool_use_id?: string
	content?: string
	is_error?: boolean
	mimeType?: string
	data?: string
}
export interface EngineMessage {
	id: string
	sessionId: string
	role: "user" | "assistant"
	content: string | EngineBlock[]
	createdAt: number
}

/** Map an engine session record to the app's Session atom shape. */
export function engineSessionToSession(es: EngineSession): Session {
	return {
		id: es.id,
		slug: es.id,
		projectID: es.directory,
		directory: es.directory,
		title: es.title,
		version: "1",
		time: { created: es.createdAt, updated: es.updatedAt },
	} as unknown as Session
}

/** Map an engine session's status to the app's SessionStatus shape. */
export function engineSessionStatus(es: EngineSession): SessionStatus {
	if (es.status === "running") return { type: "busy" } as SessionStatus
	if (es.status === "error") return { type: "idle" } as SessionStatus
	return { type: "idle" } as SessionStatus
}

function userInfo(m: EngineMessage): UserMessage {
	return { id: m.id, sessionID: m.sessionId, role: "user", time: { created: m.createdAt } } as unknown as UserMessage
}

function assistantInfo(m: EngineMessage): AssistantMessage {
	return {
		id: m.id,
		sessionID: m.sessionId,
		role: "assistant",
		time: { created: m.createdAt, completed: m.createdAt },
		modelID: "",
		providerID: "",
		mode: "auto",
		agent: "build",
		path: { cwd: "", root: "" },
		cost: 0,
		tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	} as unknown as AssistantMessage
}

function textPart(id: string, sessionId: string, messageId: string, text: string): TextPart {
	return { id, sessionID: sessionId, messageID: messageId, type: "text", text } as TextPart
}

function toolPart(
	callId: string,
	messageId: string,
	sessionId: string,
	tool: string,
	input: Record<string, unknown>,
	result: { content: string; isError: boolean } | undefined,
): ToolPart {
	const now = Date.now()
	// No result recorded → the call never completed (interrupted); show as error
	// so the turn still renders instead of hanging on a phantom running spinner.
	const state = !result
		? { status: "error", input, error: "No result recorded.", time: { start: now - 1, end: now } }
		: result.isError
			? { status: "error", input, error: result.content, time: { start: now - 1, end: now } }
			: { status: "completed", input, output: result.content, title: tool, metadata: {}, time: { start: now - 1, end: now } }
	return { id: callId, sessionID: sessionId, messageID: messageId, type: "tool", callID: callId, tool, state } as unknown as ToolPart
}

function imagePart(id: string, sessionId: string, messageId: string, mimeType: string, data: string): FilePart {
	return {
		id,
		sessionID: sessionId,
		messageID: messageId,
		type: "file",
		mime: mimeType,
		filename: "image",
		url: `data:${mimeType};base64,${data}`,
	} as unknown as FilePart
}

/**
 * Convert an ordered list of engine messages into chat entries. Tool results
 * (stored on the following user message) are paired back onto their tool_use
 * parts, and the user messages that carry ONLY tool results are dropped (they
 * feed the tool parts, they aren't their own chat bubble).
 */
export function mapEngineMessagesToEntries(messages: EngineMessage[]): Array<{ info: Message; parts: Part[] }> {
	// Index every tool_result by the tool_use id it answers.
	const results = new Map<string, { content: string; isError: boolean }>()
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue
		for (const b of m.content) {
			if (b.type === "tool_result" && b.tool_use_id) results.set(b.tool_use_id, { content: b.content ?? "", isError: Boolean(b.is_error) })
		}
	}

	const entries: Array<{ info: Message; parts: Part[] }> = []
	for (const m of messages) {
		// Drop user messages that are purely tool results (not a visible bubble).
		if (m.role === "user" && Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result")) {
			continue
		}

		const parts: Part[] = []
		if (typeof m.content === "string") {
			if (m.content.trim()) parts.push(textPart(`${m.id}-text`, m.sessionId, m.id, m.content))
		} else {
			let i = 0
			for (const b of m.content) {
				if (b.type === "text" && b.text) parts.push(textPart(`${m.id}-t${i++}`, m.sessionId, m.id, b.text))
				else if (b.type === "tool_use" && b.id) parts.push(toolPart(b.id, m.id, m.sessionId, b.name ?? "tool", b.input ?? {}, results.get(b.id)))
				else if (b.type === "image" && b.data) parts.push(imagePart(`${m.id}-img${i++}`, m.sessionId, m.id, b.mimeType ?? "image/png", b.data))
			}
		}

		// A message with no renderable parts (e.g. an empty user turn) is skipped.
		if (parts.length === 0) continue
		entries.push({ info: (m.role === "user" ? userInfo(m) : assistantInfo(m)) as Message, parts })
	}
	return entries
}
