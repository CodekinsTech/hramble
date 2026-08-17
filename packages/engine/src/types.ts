export interface ModelRef {
	provider: string  // matches provider id in providers.ts
	model: string
	apiKey: string
	baseURL?: string  // override provider's default baseURL
}

export interface Session {
	id: string
	title: string
	directory: string
	createdAt: number
	updatedAt: number
	status: "idle" | "running" | "error"
}

/**
 * Canonical content blocks — a provider-agnostic superset of the Anthropic
 * message shape. Stored verbatim so a full transcript (text + tool calls +
 * tool results) survives across turns and can be replayed to either the
 * Anthropic or the OpenAI-compatible path without loss.
 */
export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

export interface Message {
	id: string
	sessionId: string
	role: "user" | "assistant"
	content: string | ContentBlock[]
	createdAt: number
}

export interface ToolCall {
	id: string
	tool: string
	input: Record<string, unknown>
}

/** Cumulative token usage for a session. */
export interface Usage {
	inputTokens: number
	outputTokens: number
}

/** A single task in the agent's todo list (Claude-Code-style task tracking). */
export interface Todo {
	content: string
	status: "pending" | "in_progress" | "completed"
	activeForm?: string
}

/** How a user resolved a permission prompt. */
export type PermissionResolution = "once" | "always" | "reject"

/**
 * Permission mode for a turn — the Claude-Code-style escalation.
 * (plan is handled separately as a read-only agent mode.)
 */
export type PermissionMode = "manual" | "accept-edits" | "auto" | "bypass"

export interface PermissionRequest {
	id: string
	sessionId: string
	tool: string
	input: Record<string, unknown>
	description: string
	resolvedAt?: number
	resolution?: PermissionResolution
}

// SSE event types streamed to the UI
export type EngineEvent =
	| { type: "session.created"; sessionId: string; title: string; directory: string }
	| { type: "session.updated"; sessionId: string; status: Session["status"] }
	| { type: "session.idle"; sessionId: string }
	| { type: "session.deleted"; sessionId: string }
	| { type: "session.reverted"; sessionId: string }
	| { type: "session.error"; sessionId: string; error: string }
	| { type: "session.retry"; sessionId: string; attempt: number; delayMs: number; error: string }
	| { type: "message.start"; messageId: string; sessionId: string; role: "assistant" }
	| { type: "message.delta"; messageId: string; sessionId: string; text: string }
	| { type: "message.complete"; messageId: string; sessionId: string }
	| { type: "tool.start"; toolCallId: string; sessionId: string; tool: string; input: Record<string, unknown> }
	| { type: "tool.result"; toolCallId: string; sessionId: string; output: string; isError: boolean }
	| { type: "todo.updated"; sessionId: string; todos: Todo[] }
	| { type: "usage"; sessionId: string; inputTokens: number; outputTokens: number }
	| { type: "permission.request"; permissionId: string; sessionId: string; tool: string; input: Record<string, unknown>; description: string }
	| { type: "permission.resolved"; permissionId: string; resolution: PermissionResolution }
