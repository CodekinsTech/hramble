/**
 * Maps the xot engine's stored transcript (message-grained content blocks) into
 * the OpenCode-shaped { info: Message, parts: Part[] } entries the chat UI and
 * session atoms consume — so loading an EXISTING engine session renders exactly
 * like an OpenCode one. Live streaming is handled separately by
 * engine-event-processor; this is the one-time hydration on session open.
 */
import type { Message, Part, Session, SessionStatus, TextPart, ToolPart, FilePart, UserMessage, AssistantMessage } from "../lib/types"
import type { EngineSession } from "./engine-client"

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
