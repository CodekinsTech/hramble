import Anthropic from "@anthropic-ai/sdk"
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages.js"
import OpenAI from "openai"
import { nanoid } from "nanoid"
import { buildSystemPrompt } from "./system-prompt.js"
import type { EngineEvent, ModelRef, PermissionRequest, PermissionResolution } from "./types.js"
import { runBash, bashToolDefinition } from "./tools/bash.js"
import { readFile, readToolDefinition } from "./tools/read.js"
import { writeFile, writeToolDefinition } from "./tools/write.js"
import { editFile, editToolDefinition } from "./tools/edit.js"
import { globFiles, globToolDefinition } from "./tools/glob.js"
import { grepFiles, grepToolDefinition } from "./tools/grep.js"
import { todoToolDefinition, normalizeTodos, type TodoWriteInput } from "./tools/todo.js"
import { webFetch, webFetchToolDefinition } from "./tools/webfetch.js"
import { taskToolDefinition, type TaskInput } from "./tools/task.js"
import { rememberToolDefinition, appendMemory } from "./tools/memory.js"
import { getProvider } from "./providers.js"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { addMessage, recordSnapshot } from "./sessions.js"
import { checkPermission, permissionKey } from "./permissions.js"
import { matchesPermissionRule, addPermissionRule, setTodos } from "./sessions.js"
import { resolveMaxOutputTokens } from "./limits.js"
import { getModel } from "./providers.js"
import { isTransientError, backoffDelay, sleep, MAX_RETRIES } from "./retry.js"
import type { ContentBlock } from "./types.js"

const TOOLS: Tool[] = [
	bashToolDefinition,
	readToolDefinition,
	writeToolDefinition,
	editToolDefinition,
	globToolDefinition,
	grepToolDefinition,
	todoToolDefinition,
	webFetchToolDefinition,
	taskToolDefinition,
	rememberToolDefinition,
]

/** Tools a read-only research sub-agent may use. */
const SUBAGENT_TOOL_NAMES = new Set(["read", "grep", "glob", "webfetch"])

// OpenAI-compat tool format (same schema, different wrapper)
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => ({
	type: "function" as const,
	function: {
		name: t.name,
		description: t.description,
		parameters: t.input_schema,
	},
}))

// Plan mode is read-only — the model can inspect the codebase but not change it.
const READ_ONLY_TOOL_NAMES = new Set(["read", "grep", "glob", "todowrite", "webfetch"])
const PLAN_TOOLS: Tool[] = TOOLS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name))
const PLAN_OPENAI_TOOLS = OPENAI_TOOLS.filter((t) => t.type === "function" && READ_ONLY_TOOL_NAMES.has(t.function.name))

export type AgentMode = "build" | "plan"

export type EventEmitter = (event: EngineEvent) => void

interface RunOptions {
	sessionId: string
	directory: string
	messages: MessageParam[]
	model: ModelRef
	emit: EventEmitter
	signal: AbortSignal
	onPermissionRequest: (req: PermissionRequest) => Promise<PermissionResolution>
	mode?: AgentMode
}

export async function runAgentLoop(options: RunOptions): Promise<void> {
	const { sessionId, directory, model, emit, signal, onPermissionRequest } = options
	const mode: AgentMode = options.mode ?? "build"
	const messages: MessageParam[] = [...options.messages]

	const provider = getProvider(model.provider)
	const useAnthropic = !provider || provider.type === "anthropic"

	const MAX_ITERATIONS = 50
	let iterations = 0

	while (iterations < MAX_ITERATIONS) {
		if (signal.aborted) break
		iterations++

		const messageId = nanoid()
		emit({ type: "message.start", messageId, sessionId, role: "assistant" })

		let fullText = ""
		let toolCalls: Array<{ id: string; name: string; inputJson: string }> = []

		// Attempt the model turn, retrying transient failures (429/5xx/network)
		// with backoff. Only retry when nothing has streamed to the user yet —
		// once text or tool calls have been emitted, a retry would duplicate them.
		let attempt = 0
		while (true) {
			if (signal.aborted) break
			fullText = ""
			toolCalls = []
			let streamed = false
			const attemptEmit: EventEmitter = (e) => {
				if (e.type === "message.delta") streamed = true
				emit(e)
			}
			try {
				if (useAnthropic) {
					;({ fullText } = await runAnthropicTurn(model, messages, directory, attemptEmit, messageId, sessionId, toolCalls, signal, mode))
				} else {
					;({ fullText } = await runOpenAICompatTurn(model, provider!.baseURL ?? "", messages, directory, attemptEmit, messageId, sessionId, toolCalls, signal, mode))
				}
				break
			} catch (err) {
				if (signal.aborted) break
				const error = err instanceof Error ? err.message : String(err)
				const canRetry = isTransientError(err) && !streamed && toolCalls.length === 0 && attempt < MAX_RETRIES
				if (!canRetry) {
					emit({ type: "session.error", sessionId, error })
					return
				}
				attempt++
				const delayMs = backoffDelay(attempt, err)
				emit({ type: "session.retry", sessionId, attempt, delayMs, error })
				await sleep(delayMs, signal)
			}
		}
		if (signal.aborted) break

		emit({ type: "message.complete", messageId, sessionId })

		// Build the assistant turn (text + any tool calls) and persist it verbatim
		// so the full transcript — not just the prose — survives across turns.
		const assistantBlocks: ContentBlock[] = []
		if (fullText) assistantBlocks.push({ type: "text", text: fullText })
		for (const tc of toolCalls) {
			assistantBlocks.push({
				type: "tool_use",
				id: tc.id,
				name: tc.name,
				input: JSON.parse(tc.inputJson || "{}") as Record<string, unknown>,
			})
		}
		let assistantMessageId = ""
		if (assistantBlocks.length > 0) {
			assistantMessageId = addMessage(sessionId, "assistant", assistantBlocks).id
			messages.push({ role: "assistant", content: assistantBlocks as MessageParam["content"] })
		}

		if (toolCalls.length === 0) break

		// Execute tools
		const toolResults: ContentBlock[] = []

		for (const tc of toolCalls) {
			if (signal.aborted) break

			const input = JSON.parse(tc.inputJson || "{}") as Record<string, unknown>
			emit({ type: "tool.start", toolCallId: tc.id, sessionId, tool: tc.name, input })

			// Enforce plan mode HARD: some gateways don't honor the offered tool
			// list, so reject any mutating tool the model calls anyway.
			if (mode === "plan" && !READ_ONLY_TOOL_NAMES.has(tc.name)) {
				const msg = `Tool "${tc.name}" is disabled in plan mode — only read, grep, and glob are available. Do not attempt changes; produce a plan instead.`
				emit({ type: "tool.result", toolCallId: tc.id, sessionId, output: msg, isError: true })
				toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: msg, is_error: true })
				continue
			}

			const perm = checkPermission(tc.name, input, directory)
			if (perm.needs) {
				const key = permissionKey(tc.name, input, directory)
				// Skip the prompt if the user previously chose "always allow" here.
				if (!matchesPermissionRule(directory, key)) {
					const permissionId = nanoid()
					const req: PermissionRequest = {
						id: permissionId,
						sessionId,
						tool: tc.name,
						input,
						description: perm.description,
					}
					emit({ type: "permission.request", permissionId, sessionId, tool: tc.name, input, description: perm.description })
					const resolution = await onPermissionRequest(req)
					emit({ type: "permission.resolved", permissionId, resolution })

					if (resolution === "reject") {
						emit({ type: "tool.result", toolCallId: tc.id, sessionId, output: "Permission denied by user.", isError: true })
						toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Permission denied by user.", is_error: true })
						continue
					}
					if (resolution === "always") addPermissionRule(directory, key)
				}
			}

			// Snapshot files touched by write/edit so the turn can be reverted.
			const snapshotPath =
				(tc.name === "write" || tc.name === "edit") && typeof input.filePath === "string"
					? path.resolve(directory, input.filePath)
					: null
			const beforeContent = snapshotPath
				? existsSync(snapshotPath)
					? readFileSync(snapshotPath, "utf-8")
					: null
				: null

			let output: string
			let isError = false
			try {
				if (tc.name === "todowrite") {
					// Handled inline (needs session + emit): store the list and notify the UI.
					const todos = normalizeTodos(input as unknown as TodoWriteInput)
					setTodos(sessionId, todos)
					emit({ type: "todo.updated", sessionId, todos })
					const done = todos.filter((t) => t.status === "completed").length
					output = `Todo list updated: ${done}/${todos.length} completed.`
				} else if (tc.name === "task") {
					// Delegate to a read-only research sub-agent (needs model/dir/signal).
					const taskInput = input as unknown as TaskInput
					output = await runSubAgent(model, directory, String(taskInput.prompt ?? ""), signal)
				} else {
					output = await executeTool(tc.name, input, directory)
					if (snapshotPath && assistantMessageId && !isError) {
						const afterContent = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf-8") : null
						recordSnapshot(sessionId, assistantMessageId, snapshotPath, beforeContent, afterContent)
					}
				}
			} catch (err) {
				output = err instanceof Error ? err.message : String(err)
				isError = true
			}

			emit({ type: "tool.result", toolCallId: tc.id, sessionId, output, isError })
			toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: isError ? `Error: ${output}` : output, is_error: isError || undefined })
		}

		// Persist the tool results so the next turn sees what the tools returned.
		addMessage(sessionId, "user", toolResults)
		messages.push({ role: "user", content: toolResults as MessageParam["content"] })
	}

	emit({ type: "session.idle", sessionId })
}

// ── Anthropic streaming turn ───────────────────────────────────────────────

async function runAnthropicTurn(
	model: ModelRef,
	messages: MessageParam[],
	directory: string,
	emit: EventEmitter,
	messageId: string,
	sessionId: string,
	toolCalls: Array<{ id: string; name: string; inputJson: string }>,
	signal: AbortSignal,
	mode: AgentMode = "build",
): Promise<{ fullText: string }> {
	const client = new Anthropic({ apiKey: model.apiKey })
	const maxTokens = resolveMaxOutputTokens(getModel(model.provider, model.model)?.contextWindow ?? 128_000)

	const stream = client.messages.stream(
		{
			model: model.model,
			max_tokens: maxTokens,
			system: buildSystemPrompt(directory, mode),
			tools: mode === "plan" ? PLAN_TOOLS : TOOLS,
			messages,
		},
		{ signal },
	)

	let fullText = ""

	for await (const event of stream) {
		if (signal.aborted) break
		if (event.type === "content_block_start") {
			if (event.content_block.type === "tool_use") {
				toolCalls.push({ id: event.content_block.id, name: event.content_block.name, inputJson: "" })
			}
		} else if (event.type === "content_block_delta") {
			if (event.delta.type === "text_delta") {
				fullText += event.delta.text
				emit({ type: "message.delta", messageId, sessionId, text: event.delta.text })
			} else if (event.delta.type === "input_json_delta") {
				const last = toolCalls[toolCalls.length - 1]
				if (last) last.inputJson += event.delta.partial_json
			}
		}
	}

	return { fullText }
}

// ── OpenAI-compat streaming turn ──────────────────────────────────────────

async function runOpenAICompatTurn(
	model: ModelRef,
	baseURL: string,
	messages: MessageParam[],
	directory: string,
	emit: EventEmitter,
	messageId: string,
	sessionId: string,
	toolCalls: Array<{ id: string; name: string; inputJson: string }>,
	signal: AbortSignal,
	mode: AgentMode = "build",
): Promise<{ fullText: string }> {
	// Keyless free tiers (e.g. OpenCode Zen "-free" models) 401 on a bogus
	// bearer, so omit the Authorization header entirely when we have no key.
	const hasKey = Boolean(model.apiKey?.trim())
	const client = new OpenAI({
		apiKey: hasKey ? model.apiKey : "unused",
		baseURL: model.baseURL ?? baseURL,
		...(hasKey ? {} : { defaultHeaders: { Authorization: null } }),
	})

	const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
		role: "system",
		content: buildSystemPrompt(directory, mode),
	}

	// Convert Anthropic-style messages to OpenAI format
	const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) => {
		if (typeof m.content === "string") {
			return { role: m.role as "user" | "assistant", content: m.content }
		}
		// Handle tool results (user messages with tool_result content)
		if (m.role === "user" && Array.isArray(m.content)) {
			const toolResults = m.content.filter((c): c is { type: "tool_result"; tool_use_id: string; content: string } =>
				"type" in c && c.type === "tool_result",
			)
			if (toolResults.length > 0) {
				return toolResults.map((tr) => ({
					role: "tool" as const,
					tool_call_id: tr.tool_use_id,
					content: tr.content,
				})) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam
			}
		}
		// Handle assistant messages with tool_use content
		if (m.role === "assistant" && Array.isArray(m.content)) {
			const text = m.content.find((c) => "type" in c && c.type === "text") as { text: string } | undefined
			const toolUses = m.content.filter((c): c is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
				"type" in c && c.type === "tool_use",
			)
			return {
				role: "assistant" as const,
				content: text?.text ?? null,
				tool_calls: toolUses.map((tu) => ({
					id: tu.id,
					type: "function" as const,
					function: { name: tu.name, arguments: JSON.stringify(tu.input) },
				})),
			}
		}
		return { role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" }
	}).flat() as OpenAI.Chat.Completions.ChatCompletionMessageParam[]

	const stream = await client.chat.completions.create(
		{
			model: model.model,
			messages: [systemMessage, ...openaiMessages],
			tools: mode === "plan" ? PLAN_OPENAI_TOOLS : OPENAI_TOOLS,
			tool_choice: "auto",
			max_tokens: resolveMaxOutputTokens(getModel(model.provider, model.model)?.contextWindow ?? 128_000),
			stream: true,
		},
		{ signal },
	)

	let fullText = ""
	const activeToolCalls: Record<number, { id: string; name: string; inputJson: string }> = {}

	for await (const chunk of stream) {
		if (signal.aborted) break
		const delta = chunk.choices[0]?.delta
		if (!delta) continue

		if (delta.content) {
			fullText += delta.content
			emit({ type: "message.delta", messageId, sessionId, text: delta.content })
		}

		if (delta.tool_calls) {
			for (const tc of delta.tool_calls) {
				const idx = tc.index
				if (!activeToolCalls[idx]) {
					activeToolCalls[idx] = { id: tc.id ?? nanoid(), name: tc.function?.name ?? "", inputJson: "" }
					toolCalls.push(activeToolCalls[idx])
				}
				if (tc.function?.arguments) {
					activeToolCalls[idx].inputJson += tc.function.arguments
				}
			}
		}
	}

	return { fullText }
}

// ── Tool execution ────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>, directory: string): Promise<string> {
	switch (name) {
		case "bash": {
			const result = await runBash(
				{ command: String(input.command ?? ""), timeout: Number(input.timeout) || undefined },
				directory,
			)
			const parts = []
			if (result.stdout) parts.push(result.stdout)
			if (result.stderr) parts.push(`[stderr] ${result.stderr}`)
			if (result.exitCode !== 0) parts.push(`[exit code: ${result.exitCode}]`)
			return parts.join("\n") || "(no output)"
		}
		case "read":
			return readFile({ filePath: String(input.filePath ?? ""), offset: input.offset !== undefined ? Number(input.offset) : undefined, limit: input.limit !== undefined ? Number(input.limit) : undefined }, directory)
		case "write":
			return writeFile({ filePath: String(input.filePath ?? ""), content: String(input.content ?? "") }, directory)
		case "edit":
			return editFile({ filePath: String(input.filePath ?? ""), oldString: String(input.oldString ?? ""), newString: String(input.newString ?? ""), replaceAll: Boolean(input.replaceAll) }, directory)
		case "glob":
			return globFiles({ pattern: String(input.pattern ?? "**/*"), exclude: Array.isArray(input.exclude) ? (input.exclude as string[]) : undefined }, directory)
		case "grep":
			return grepFiles({ pattern: String(input.pattern ?? ""), path: input.path ? String(input.path) : undefined, glob: input.glob ? String(input.glob) : undefined, caseSensitive: Boolean(input.caseSensitive) }, directory)
		case "webfetch":
			return webFetch({ url: String(input.url ?? "") })
		case "remember":
			return appendMemory(directory, String(input.memory ?? ""))
		default:
			throw new Error(`Unknown tool: ${name}`)
	}
}

/**
 * Run a read-only research sub-agent to completion and return its final text.
 * It reuses the streaming turn functions in plan mode (read-only tool set) but
 * runs silently — no UI events, no store writes — and is capped hard so a
 * runaway sub-agent can't stall the parent turn.
 */
const SUBAGENT_MAX_ITERATIONS = 15

async function runSubAgent(model: ModelRef, directory: string, prompt: string, signal: AbortSignal): Promise<string> {
	const provider = getProvider(model.provider)
	const useAnthropic = !provider || provider.type === "anthropic"
	// Frame the task: the turn runs in plan mode (read-only tools), so orient the
	// sub-agent as a researcher rather than a planner, and ask for a direct report.
	const framedPrompt = `You are a read-only research sub-agent. Use read, grep, glob, and webfetch to investigate, then report your findings directly and concisely — you cannot modify files or run commands, and your answer goes to another agent, not the user.\n\nTask:\n${prompt}`
	const messages: MessageParam[] = [{ role: "user", content: framedPrompt }]
	const silent: EventEmitter = () => {}
	let finalText = ""

	for (let i = 0; i < SUBAGENT_MAX_ITERATIONS; i++) {
		if (signal.aborted) break
		const toolCalls: Array<{ id: string; name: string; inputJson: string }> = []
		let text = ""
		try {
			if (useAnthropic) {
				;({ fullText: text } = await runAnthropicTurn(model, messages, directory, silent, nanoid(), "subagent", toolCalls, signal, "plan"))
			} else {
				;({ fullText: text } = await runOpenAICompatTurn(model, provider!.baseURL ?? "", messages, directory, silent, nanoid(), "subagent", toolCalls, signal, "plan"))
			}
		} catch (err) {
			return `Sub-agent error: ${err instanceof Error ? err.message : String(err)}`
		}

		const blocks: ContentBlock[] = []
		if (text) blocks.push({ type: "text", text })
		for (const tc of toolCalls) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: JSON.parse(tc.inputJson || "{}") as Record<string, unknown> })
		if (blocks.length > 0) messages.push({ role: "assistant", content: blocks as MessageParam["content"] })

		if (toolCalls.length === 0) {
			finalText = text
			break
		}

		const results: ContentBlock[] = []
		for (const tc of toolCalls) {
			if (signal.aborted) break
			const input = JSON.parse(tc.inputJson || "{}") as Record<string, unknown>
			let out: string
			let isError = false
			if (SUBAGENT_TOOL_NAMES.has(tc.name)) {
				try {
					out = await executeTool(tc.name, input, directory)
				} catch (err) {
					out = err instanceof Error ? err.message : String(err)
					isError = true
				}
			} else {
				out = `Tool "${tc.name}" is not available to sub-agents (read-only research only).`
				isError = true
			}
			results.push({ type: "tool_result", tool_use_id: tc.id, content: isError ? `Error: ${out}` : out, is_error: isError || undefined })
		}
		messages.push({ role: "user", content: results as MessageParam["content"] })
	}

	return finalText.trim() || "(sub-agent produced no findings)"
}
