import Anthropic from "@anthropic-ai/sdk"
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages.js"
import OpenAI from "openai"
import { nanoid } from "nanoid"
import { buildSystemPrompt } from "./system-prompt.js"
import type { EngineEvent, ModelRef, PermissionRequest, PermissionResolution, PermissionMode } from "./types.js"
import { runBash, bashToolDefinition, isDangerous } from "./tools/bash.js"
import { readFile, readToolDefinition } from "./tools/read.js"
import { writeFile, writeToolDefinition } from "./tools/write.js"
import { editFile, editToolDefinition } from "./tools/edit.js"
import { multiEdit, multiEditToolDefinition, type MultiEditInput } from "./tools/multiedit.js"
import { notebookEdit, notebookEditToolDefinition, type NotebookEditInput } from "./tools/notebook.js"
import { globFiles, globToolDefinition } from "./tools/glob.js"
import { grepFiles, grepToolDefinition } from "./tools/grep.js"
import { todoToolDefinition, normalizeTodos, type TodoWriteInput } from "./tools/todo.js"
import { webFetch, webFetchToolDefinition } from "./tools/webfetch.js"
import { taskToolDefinition, type TaskInput } from "./tools/task.js"
import { rememberToolDefinition, appendMemory } from "./tools/memory.js"
import { skillToolDefinition, readSkill, type SkillInput } from "./skills.js"
import { getMcpTools, isMcpTool, callMcpTool } from "./mcp.js"
import { getProvider } from "./providers.js"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { addMessage, recordSnapshot } from "./sessions.js"
import { checkPermission, permissionKey } from "./permissions.js"
import { matchesPermissionRule, addPermissionRule, setTodos, addUsage } from "./sessions.js"
import { resolveMaxOutputTokens } from "./limits.js"
import { getModel } from "./providers.js"
import { isTransientError, backoffDelay, sleep, MAX_RETRIES } from "./retry.js"
import type { ContentBlock } from "./types.js"

const TOOLS: Tool[] = [
	bashToolDefinition,
	readToolDefinition,
	writeToolDefinition,
	editToolDefinition,
	multiEditToolDefinition,
	notebookEditToolDefinition,
	globToolDefinition,
	grepToolDefinition,
	todoToolDefinition,
	webFetchToolDefinition,
	taskToolDefinition,
	rememberToolDefinition,
	skillToolDefinition,
]

/** Tools a read-only research sub-agent may use. */
const SUBAGENT_TOOL_NAMES = new Set(["read", "grep", "glob", "webfetch"])
const SUBAGENT_TOOLS: Tool[] = TOOLS.filter((t) => SUBAGENT_TOOL_NAMES.has(t.name))

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
const READ_ONLY_TOOL_NAMES = new Set(["read", "grep", "glob", "todowrite", "webfetch", "skill"])
const PLAN_TOOLS: Tool[] = TOOLS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name))
const PLAN_OPENAI_TOOLS = OPENAI_TOOLS.filter((t) => t.type === "function" && READ_ONLY_TOOL_NAMES.has(t.function.name))

export type AgentMode = "build" | "plan"

interface TurnResult {
	fullText: string
	usage?: { inputTokens: number; outputTokens: number }
}

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
	permissionMode?: PermissionMode
}

/** Parse a tool-call argument blob; never throws — a bad blob becomes a tool error. */
function safeParseInput(json: string): { input: Record<string, unknown>; error: boolean } {
	try {
		return { input: JSON.parse(json || "{}") as Record<string, unknown>, error: false }
	} catch {
		return { input: {}, error: true }
	}
}

/** Await a promise but resolve to `onAbort` immediately if the signal fires. */
function awaitWithAbort<T>(p: Promise<T>, signal: AbortSignal, onAbort: T): Promise<T> {
	if (signal.aborted) return Promise.resolve(onAbort)
	return new Promise<T>((resolve) => {
		const finish = (v: T) => {
			signal.removeEventListener("abort", onAbortEvt)
			resolve(v)
		}
		const onAbortEvt = () => finish(onAbort)
		signal.addEventListener("abort", onAbortEvt, { once: true })
		p.then(finish, () => finish(onAbort))
	})
}

export async function runAgentLoop(options: RunOptions): Promise<void> {
	const { sessionId, directory, model, emit, signal, onPermissionRequest } = options
	const mode: AgentMode = options.mode ?? "build"
	const permissionMode: PermissionMode = options.permissionMode ?? "auto"
	const messages: MessageParam[] = [...options.messages]

	const provider = getProvider(model.provider)
	const useAnthropic = !provider || provider.type === "anthropic"

	// Combine built-in tools with this project's MCP-server tools. MCP tools are
	// only offered in build mode (plan stays read-only, local-only).
	const mcpTools = mode === "plan" ? [] : await getMcpTools(directory)
	const activeTools: Tool[] = mode === "plan" ? PLAN_TOOLS : [...TOOLS, ...mcpTools]

	const MAX_ITERATIONS = 50
	let iterations = 0

	while (iterations < MAX_ITERATIONS) {
		if (signal.aborted) break
		iterations++

		const messageId = nanoid()
		emit({ type: "message.start", messageId, sessionId, role: "assistant" })

		let fullText = ""
		let toolCalls: Array<{ id: string; name: string; inputJson: string }> = []
		let turnUsage: TurnResult["usage"]

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
					;({ fullText, usage: turnUsage } = await runAnthropicTurn(model, messages, directory, attemptEmit, messageId, sessionId, toolCalls, signal, mode, activeTools))
				} else {
					;({ fullText, usage: turnUsage } = await runOpenAICompatTurn(model, provider!.baseURL ?? "", messages, directory, attemptEmit, messageId, sessionId, toolCalls, signal, mode, activeTools))
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

		// Record token usage for this turn (both provider paths report it).
		if (turnUsage && (turnUsage.inputTokens > 0 || turnUsage.outputTokens > 0)) {
			const total = addUsage(sessionId, turnUsage.inputTokens, turnUsage.outputTokens)
			emit({ type: "usage", sessionId, inputTokens: total.inputTokens, outputTokens: total.outputTokens })
		}

		// Parse each tool call's args once (safely); a malformed blob is surfaced
		// to the model as a tool error rather than crashing the whole turn.
		const parsed = new Map<string, { input: Record<string, unknown>; error: boolean }>()
		for (const tc of toolCalls) parsed.set(tc.id, safeParseInput(tc.inputJson))

		// Build the assistant turn (text + any tool calls) and persist it verbatim
		// so the full transcript — not just the prose — survives across turns.
		const assistantBlocks: ContentBlock[] = []
		if (fullText) assistantBlocks.push({ type: "text", text: fullText })
		for (const tc of toolCalls) {
			assistantBlocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: parsed.get(tc.id)!.input })
		}
		let assistantMessageId = ""
		if (assistantBlocks.length > 0) {
			assistantMessageId = addMessage(sessionId, "assistant", assistantBlocks).id
			messages.push({ role: "assistant", content: assistantBlocks as MessageParam["content"] })
		}

		if (toolCalls.length === 0) break

		// Execute tools. Every tool_use MUST get a matching tool_result or the next
		// provider request 400s — so we ALWAYS back-fill results for all calls,
		// including on abort partway through.
		const toolResults: ContentBlock[] = []
		const pushResult = (id: string, content: string, isError: boolean) => {
			emit({ type: "tool.result", toolCallId: id, sessionId, output: content, isError })
			toolResults.push({ type: "tool_result", tool_use_id: id, content: isError ? `Error: ${content}` : content, is_error: isError || undefined })
		}

		let interrupted = false
		for (const tc of toolCalls) {
			if (signal.aborted) {
				interrupted = true
				break
			}

			const { input, error: parseError } = parsed.get(tc.id)!
			emit({ type: "tool.start", toolCallId: tc.id, sessionId, tool: tc.name, input })

			if (parseError) {
				pushResult(tc.id, `Invalid tool input: the arguments for "${tc.name}" were not valid JSON. Re-issue the call with well-formed JSON.`, true)
				continue
			}

			// Enforce plan mode HARD: some gateways don't honor the offered tool
			// list, so reject any mutating tool the model calls anyway.
			if (mode === "plan" && !READ_ONLY_TOOL_NAMES.has(tc.name)) {
				pushResult(tc.id, `Tool "${tc.name}" is disabled in plan mode — only read/grep/glob are available. Produce a plan instead.`, true)
				continue
			}

			const perm = checkPermission(tc.name, input, directory, permissionMode)
			if (perm.needs) {
				const key = permissionKey(tc.name, input, directory)
				// A destructive bash command ALWAYS prompts, even if an "always allow"
				// rule matches its binary — so `git status; rm -rf ~` can't ride a
				// `bash:git` rule past the destructive gate.
				const dangerousBash = tc.name === "bash" && isDangerous(String(input.command ?? ""))
				// Skip the prompt only if the user previously chose "always allow" here.
				if (dangerousBash || !matchesPermissionRule(directory, key)) {
					const permissionId = nanoid()
					const req: PermissionRequest = { id: permissionId, sessionId, tool: tc.name, input, description: perm.description }
					emit({ type: "permission.request", permissionId, sessionId, tool: tc.name, input, description: perm.description })
					// Abort while waiting resolves as "reject" so the loop never hangs.
					const resolution = await awaitWithAbort(onPermissionRequest(req), signal, "reject" as PermissionResolution)
					emit({ type: "permission.resolved", permissionId, resolution })

					if (signal.aborted) {
						pushResult(tc.id, "Interrupted.", true)
						interrupted = true
						break
					}
					if (resolution === "reject") {
						pushResult(tc.id, "Permission denied by user.", true)
						continue
					}
					if (resolution === "always" && !dangerousBash) addPermissionRule(directory, key)
				}
			}

			// Snapshot files touched by write/edit so the turn can be reverted.
			const snapshotPath =
				(tc.name === "write" || tc.name === "edit" || tc.name === "multiedit" || tc.name === "notebookedit") &&
				typeof input.filePath === "string"
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

			pushResult(tc.id, output, isError)
		}

		// Back-fill a result for every tool_use that didn't get one (abort mid-loop),
		// so the persisted transcript never has an orphaned tool_use → the next
		// provider request stays valid.
		const answered = new Set(toolResults.map((r) => (r as { tool_use_id: string }).tool_use_id))
		for (const tc of toolCalls) {
			if (!answered.has(tc.id)) {
				toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Interrupted before this tool ran.", is_error: true })
			}
		}

		// Persist the tool results so the next turn sees what the tools returned.
		addMessage(sessionId, "user", toolResults)
		messages.push({ role: "user", content: toolResults as MessageParam["content"] })

		if (interrupted || signal.aborted) break
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
	turnTools: Tool[] = TOOLS,
): Promise<TurnResult> {
	const client = new Anthropic({ apiKey: model.apiKey })
	const maxTokens = resolveMaxOutputTokens(getModel(model.provider, model.model)?.contextWindow ?? 128_000)

	const stream = client.messages.stream(
		{
			model: model.model,
			max_tokens: maxTokens,
			system: buildSystemPrompt(directory, mode),
			tools: turnTools,
			messages,
		},
		{ signal },
	)

	let fullText = ""
	let inputTokens = 0
	let outputTokens = 0

	for await (const event of stream) {
		if (signal.aborted) break
		if (event.type === "message_start") {
			inputTokens = event.message.usage?.input_tokens ?? 0
			outputTokens = event.message.usage?.output_tokens ?? 0
		} else if (event.type === "message_delta") {
			// output_tokens on message_delta is cumulative — latest wins.
			outputTokens = event.usage?.output_tokens ?? outputTokens
		} else if (event.type === "content_block_start") {
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

	return { fullText, usage: { inputTokens, outputTokens } }
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
	turnTools: Tool[] = TOOLS,
): Promise<TurnResult> {
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
			// Omit tool_calls when empty — many OpenAI-compat gateways reject an
			// empty tool_calls array on an assistant message.
			const am: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
				role: "assistant",
				content: text?.text ?? null,
			}
			if (toolUses.length > 0) {
				am.tool_calls = toolUses.map((tu) => ({
					id: tu.id,
					type: "function" as const,
					function: { name: tu.name, arguments: JSON.stringify(tu.input) },
				}))
			}
			return am
		}
		return { role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" }
	}).flat() as OpenAI.Chat.Completions.ChatCompletionMessageParam[]

	const stream = await client.chat.completions.create(
		{
			model: model.model,
			messages: [systemMessage, ...openaiMessages],
			tools: turnTools.map((t) => ({
				type: "function" as const,
				function: { name: t.name, description: t.description, parameters: t.input_schema },
			})),
			tool_choice: "auto",
			max_tokens: resolveMaxOutputTokens(getModel(model.provider, model.model)?.contextWindow ?? 128_000),
			stream: true,
			stream_options: { include_usage: true },
		},
		{ signal },
	)

	let fullText = ""
	let inputTokens = 0
	let outputTokens = 0
	const activeToolCalls: Record<number, { id: string; name: string; inputJson: string }> = {}

	for await (const chunk of stream) {
		if (signal.aborted) break
		// The final usage chunk (when supported) carries usage with empty choices.
		if (chunk.usage) {
			inputTokens = chunk.usage.prompt_tokens ?? inputTokens
			outputTokens = chunk.usage.completion_tokens ?? outputTokens
		}
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

	return { fullText, usage: { inputTokens, outputTokens } }
}

// ── Tool execution ────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>, directory: string): Promise<string> {
	if (isMcpTool(name)) return callMcpTool(directory, name, input)
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
		case "multiedit":
			return multiEdit(input as unknown as MultiEditInput, directory)
		case "notebookedit":
			return notebookEdit(input as unknown as NotebookEditInput, directory)
		case "webfetch":
			return webFetch({ url: String(input.url ?? "") })
		case "remember":
			return appendMemory(directory, String(input.memory ?? ""))
		case "skill": {
			const loaded = readSkill(directory, String((input as unknown as SkillInput).name ?? ""))
			return loaded ?? `No skill named "${String(input.name ?? "")}" found.`
		}
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
				;({ fullText: text } = await runAnthropicTurn(model, messages, directory, silent, nanoid(), "subagent", toolCalls, signal, "plan", SUBAGENT_TOOLS))
			} else {
				;({ fullText: text } = await runOpenAICompatTurn(model, provider!.baseURL ?? "", messages, directory, silent, nanoid(), "subagent", toolCalls, signal, "plan", SUBAGENT_TOOLS))
			}
		} catch (err) {
			return `Sub-agent error: ${err instanceof Error ? err.message : String(err)}`
		}

		const blocks: ContentBlock[] = []
		if (text) blocks.push({ type: "text", text })
		for (const tc of toolCalls) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: safeParseInput(tc.inputJson).input })
		if (blocks.length > 0) messages.push({ role: "assistant", content: blocks as MessageParam["content"] })

		// Remember the latest prose so a sub-agent that runs out of iterations still
		// returns its findings instead of "(no findings)".
		if (text.trim()) finalText = text

		if (toolCalls.length === 0) break

		const results: ContentBlock[] = []
		for (const tc of toolCalls) {
			if (signal.aborted) break
			const input = safeParseInput(tc.inputJson).input
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
