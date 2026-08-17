/**
 * Maps xot engine SSE events to the existing Jotai atom structure.
 *
 * The engine emits simple events (message.delta, tool.start, etc.).
 * This module translates them into the same atom updates that the
 * OpenCode event processor uses, so the existing chat UI renders
 * engine output without any UI changes.
 */

import type { AssistantMessage, Session, TextPart, ToolPart } from "../lib/types"
import { enginePermissionsAtom, type EnginePermissionRequest } from "../atoms/engine"
import { upsertMessageAtom } from "../atoms/messages"
import { applyPartDeltaAtom, partsFamily, upsertPartAtom } from "../atoms/parts"
import {
	removeSessionAtom,
	setSessionErrorAtom,
	setSessionStatusAtom,
	upsertSessionAtom,
} from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { streamingVersionFamily } from "../atoms/streaming"
import { createLogger } from "../lib/logger"

const log = createLogger("engine-event-processor")

// ── xot engine event types (mirrors packages/engine/src/types.ts) ─────────

type EngineEvent =
	| { type: "session.created"; sessionId: string; title: string; directory: string }
	| { type: "session.updated"; sessionId: string; status: "idle" | "running" | "error" }
	| { type: "session.idle"; sessionId: string }
	| { type: "session.deleted"; sessionId: string }
	| { type: "session.reverted"; sessionId: string }
	| { type: "session.retry"; sessionId: string; attempt: number; delayMs: number; error: string }
	| { type: "session.error"; sessionId: string; error: string }
	| { type: "message.start"; messageId: string; sessionId: string; role: "assistant" }
	| { type: "message.delta"; messageId: string; sessionId: string; text: string }
	| { type: "message.complete"; messageId: string; sessionId: string }
	| { type: "tool.start"; toolCallId: string; sessionId: string; tool: string; input: Record<string, unknown> }
	| { type: "tool.result"; toolCallId: string; sessionId: string; output: string; isError: boolean }
	| { type: "permission.request"; permissionId: string; sessionId: string; tool: string; input: Record<string, unknown>; description: string }
	| { type: "permission.resolved"; permissionId: string; resolution: "once" | "always" | "reject" }

/** Tracks the current assistant message ID per session (for attaching tool parts). */
const currentMessageBySession = new Map<string, string>()

/** Build a minimal Session shape compatible with the existing atom. */
function makeSession(sessionId: string, title: string, directory: string): Session {
	return {
		id: sessionId,
		slug: sessionId,
		projectID: directory,
		directory,
		title,
		version: "1",
		time: { created: Date.now(), updated: Date.now() },
	} as unknown as Session
}

/** Build a minimal AssistantMessage compatible with the existing atom. */
function makeAssistantMessage(messageId: string, sessionId: string): AssistantMessage {
	return {
		id: messageId,
		sessionID: sessionId,
		role: "assistant",
		time: { created: Date.now() },
		parentID: sessionId,
		modelID: "",
		providerID: "",
		mode: "auto",
		agent: "build",
		path: { cwd: "", root: "" },
		cost: 0,
		tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	} as unknown as AssistantMessage
}

/** Build a minimal TextPart for streaming. */
function makeTextPart(messageId: string, sessionId: string): TextPart {
	return {
		id: `${messageId}-text`,
		sessionID: sessionId,
		messageID: messageId,
		type: "text",
		text: "",
	} as TextPart
}

/** Build a ToolPart in running state. */
function makeToolPartRunning(
	toolCallId: string,
	messageId: string,
	sessionId: string,
	tool: string,
	input: Record<string, unknown>,
): ToolPart {
	return {
		id: toolCallId,
		sessionID: sessionId,
		messageID: messageId,
		type: "tool",
		callID: toolCallId,
		tool,
		state: {
			status: "running",
			input,
			time: { start: Date.now() },
		},
	} as unknown as ToolPart
}

/** Build a ToolPart in completed/error state. */
function makeToolPartDone(
	toolCallId: string,
	messageId: string,
	sessionId: string,
	tool: string,
	input: Record<string, unknown>,
	output: string,
	isError: boolean,
): ToolPart {
	const now = Date.now()
	return {
		id: toolCallId,
		sessionID: sessionId,
		messageID: messageId,
		type: "tool",
		callID: toolCallId,
		tool,
		state: isError
			? {
				status: "error",
				input,
				error: output,
				time: { start: now - 1, end: now },
			}
			: {
				status: "completed",
				input,
				output,
				title: tool,
				metadata: {},
				time: { start: now - 1, end: now },
			},
	} as unknown as ToolPart
}

/**
 * Central dispatcher — called for each parsed engine SSE event.
 */
export function processEngineEvent(event: EngineEvent): void {
	const { set } = appStore

	switch (event.type) {
		case "session.created": {
			const session = makeSession(event.sessionId, event.title, event.directory)
			set(upsertSessionAtom, { session, directory: event.directory })
			break
		}

		case "session.updated":
		case "session.idle": {
			set(setSessionStatusAtom, {
				sessionId: event.sessionId,
				status: { type: "idle" },
			})
			break
		}

		case "session.deleted": {
			set(removeSessionAtom, event.sessionId)
			currentMessageBySession.delete(event.sessionId)
			break
		}

		case "session.reverted": {
			// The transcript changed underneath us — bump the stream version so the
			// view re-reads the (truncated/restored) message list on next render.
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			break
		}

		case "session.retry": {
			// Transient provider error being retried — keep the session busy.
			set(setSessionStatusAtom, {
				sessionId: event.sessionId,
				status: { type: "busy" },
			})
			break
		}

		case "session.error": {
			set(setSessionErrorAtom, {
				sessionId: event.sessionId,
				error: { name: event.error, data: {} },
			})
			set(setSessionStatusAtom, {
				sessionId: event.sessionId,
				status: { type: "idle" },
			})
			break
		}

		case "message.start": {
			currentMessageBySession.set(event.sessionId, event.messageId)
			const msg = makeAssistantMessage(event.messageId, event.sessionId)
			set(upsertMessageAtom, msg)
			// Create empty text part so applyPartDeltaAtom can find it
			set(upsertPartAtom, makeTextPart(event.messageId, event.sessionId))
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			break
		}

		case "message.delta": {
			set(applyPartDeltaAtom, {
				messageId: event.messageId,
				partId: `${event.messageId}-text`,
				field: "text",
				delta: event.text,
			})
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			break
		}

		case "message.complete": {
			// Bump version to trigger final render
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			set(setSessionStatusAtom, {
				sessionId: event.sessionId,
				status: { type: "idle" },
			})
			break
		}

		case "tool.start": {
			const messageId = currentMessageBySession.get(event.sessionId) ?? event.sessionId
			const toolPart = makeToolPartRunning(
				event.toolCallId,
				messageId,
				event.sessionId,
				event.tool,
				event.input,
			)
			set(upsertPartAtom, toolPart)
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			break
		}

		case "tool.result": {
			const messageId = currentMessageBySession.get(event.sessionId) ?? event.sessionId
			// Find the existing running tool part to preserve its tool name and input
			const existingParts = appStore.get(partsFamily(messageId))
			const runningTool = existingParts?.find(
				(p) => p.type === "tool" && (p as ToolPart).callID === event.toolCallId,
			) as ToolPart | undefined
			const donePart = makeToolPartDone(
				event.toolCallId,
				messageId,
				event.sessionId,
				runningTool?.tool ?? "tool",
				(runningTool?.state as { input?: Record<string, unknown> })?.input ?? {},
				event.output,
				event.isError,
			)
			set(upsertPartAtom, donePart)
			set(streamingVersionFamily(event.sessionId), (v) => v + 1)
			break
		}

		case "permission.request": {
			const req: EnginePermissionRequest = {
				id: event.permissionId,
				sessionId: event.sessionId,
				tool: event.tool,
				input: event.input,
				description: event.description,
			}
			const current = appStore.get(enginePermissionsAtom)
			set(enginePermissionsAtom, { ...current, [req.id]: req })
			break
		}

		case "permission.resolved": {
			const current = appStore.get(enginePermissionsAtom)
			const { [event.permissionId]: _removed, ...rest } = current
			set(enginePermissionsAtom, rest)
			break
		}

		default:
			log.debug("Unknown engine event", event)
	}
}
