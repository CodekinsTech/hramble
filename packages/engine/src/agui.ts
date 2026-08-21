import type { EngineEvent } from "./types.js"

/**
 * AG-UI protocol adapter.
 *
 * Maps the engine's internal {@link EngineEvent} stream onto the standard
 * AG-UI event shapes (https://docs.ag-ui.com). This is a pure, side-effect-free
 * mapping so it can be reused by any transport (SSE, WebSocket, etc.). The
 * engine's native `/events` SSE stream is untouched; the `/agui` endpoint feeds
 * every engine event through {@link engineEventToAGUI} and emits the resulting
 * AG-UI events instead.
 *
 * AG-UI core has no native primitive for human-in-the-loop permission prompts,
 * so those (and any engine event without a native AG-UI counterpart) are carried
 * over the CUSTOM event.
 */

// ── AG-UI event types (SCREAMING_SNAKE type discriminants) ────────────────

export interface AGUIRunStarted {
	type: "RUN_STARTED"
	threadId: string
	runId: string
}

export interface AGUIRunFinished {
	type: "RUN_FINISHED"
	threadId: string
	runId: string
}

export interface AGUIRunError {
	type: "RUN_ERROR"
	message: string
	code?: string
}

export interface AGUITextMessageStart {
	type: "TEXT_MESSAGE_START"
	messageId: string
	role: "assistant"
}

export interface AGUITextMessageContent {
	type: "TEXT_MESSAGE_CONTENT"
	messageId: string
	delta: string
}

export interface AGUITextMessageEnd {
	type: "TEXT_MESSAGE_END"
	messageId: string
}

export interface AGUIToolCallStart {
	type: "TOOL_CALL_START"
	toolCallId: string
	toolCallName: string
	parentMessageId?: string
}

export interface AGUIToolCallArgs {
	type: "TOOL_CALL_ARGS"
	toolCallId: string
	delta: string
}

export interface AGUIToolCallEnd {
	type: "TOOL_CALL_END"
	toolCallId: string
}

export interface AGUIToolCallResult {
	type: "TOOL_CALL_RESULT"
	toolCallId: string
	content: string
	messageId?: string
}

export interface AGUICustom {
	type: "CUSTOM"
	name: string
	value: unknown
}

export type AGUIEvent =
	| AGUIRunStarted
	| AGUIRunFinished
	| AGUIRunError
	| AGUITextMessageStart
	| AGUITextMessageContent
	| AGUITextMessageEnd
	| AGUIToolCallStart
	| AGUIToolCallArgs
	| AGUIToolCallEnd
	| AGUIToolCallResult
	| AGUICustom

// ── Mapping ───────────────────────────────────────────────────────────────

/**
 * Map a single {@link EngineEvent} to zero or more {@link AGUIEvent}s.
 * Pure function — no side effects.
 */
export function engineEventToAGUI(e: EngineEvent): AGUIEvent[] {
	switch (e.type) {
		case "session.updated": {
			if (e.status === "running") {
				return [{ type: "RUN_STARTED", threadId: e.sessionId, runId: e.sessionId }]
			}
			if (e.status === "idle") {
				return [{ type: "RUN_FINISHED", threadId: e.sessionId, runId: e.sessionId }]
			}
			if (e.status === "error") {
				return [{ type: "RUN_ERROR", message: "session error" }]
			}
			return [{ type: "CUSTOM", name: e.type, value: e }]
		}

		case "message.start":
			return [{ type: "TEXT_MESSAGE_START", messageId: e.messageId, role: "assistant" }]

		case "message.delta":
			return [{ type: "TEXT_MESSAGE_CONTENT", messageId: e.messageId, delta: e.text }]

		case "message.complete":
			return [{ type: "TEXT_MESSAGE_END", messageId: e.messageId }]

		case "tool.start":
			return [
				{ type: "TOOL_CALL_START", toolCallId: e.toolCallId, toolCallName: e.tool },
				{ type: "TOOL_CALL_ARGS", toolCallId: e.toolCallId, delta: JSON.stringify(e.input) },
				{ type: "TOOL_CALL_END", toolCallId: e.toolCallId },
			]

		case "tool.result": {
			const events: AGUIEvent[] = [
				{ type: "TOOL_CALL_RESULT", toolCallId: e.toolCallId, content: e.output },
			]
			// AG-UI TOOL_CALL_RESULT has no error flag — surface errors over CUSTOM.
			if (e.isError) {
				events.push({
					type: "CUSTOM",
					name: "tool.error",
					value: { toolCallId: e.toolCallId, isError: true },
				})
			}
			return events
		}

		case "permission.request":
			// No native AG-UI permission primitive — use CUSTOM for human-in-the-loop.
			return [
				{
					type: "CUSTOM",
					name: "permission.request",
					value: {
						permissionId: e.permissionId,
						tool: e.tool,
						input: e.input,
						description: e.description,
					},
				},
			]

		default:
			// Any other/unknown engine event -> CUSTOM carrying the raw event.
			return [{ type: "CUSTOM", name: e.type, value: e }]
	}
}
