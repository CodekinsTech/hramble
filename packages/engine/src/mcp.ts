import fs from "node:fs"
import path from "node:path"
import type { Tool } from "@anthropic-ai/sdk/resources/messages.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { truncateOutput } from "./limits.js"

/**
 * MCP (Model Context Protocol) client. Reads per-project server config from
 * <project>/.hramble/mcp.json:
 *   { "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }
 * connects to each stdio server, discovers its tools, and exposes them to the
 * agent as tools named `mcp__<server>__<tool>`. Connections are cached per
 * project directory. Failures to connect are logged and skipped — never fatal.
 */

interface McpServerConfig {
	command: string
	args?: string[]
	env?: Record<string, string>
}
interface McpConfig {
	mcpServers?: Record<string, McpServerConfig>
}

const PREFIX = "mcp__"
const SEP = "__"

interface DirState {
	tools: Tool[]
	route: Map<string, { client: Client; toolName: string }>
	clients: Client[]
}

// Cache the CONNECTION PROMISE (not the state) so concurrent callers for the same
// directory await the same connect instead of racing an empty, half-built state.
const cache = new Map<string, Promise<DirState>>()

const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 60_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		p.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e)
			},
		)
	})
}

function readConfig(directory: string): McpConfig {
	try {
		return JSON.parse(fs.readFileSync(path.join(directory, ".hramble", "mcp.json"), "utf-8")) as McpConfig
	} catch {
		return {}
	}
}

/** MCP tool/server names can contain chars illegal in a provider tool name. */
function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

// Env vars an MCP server may need to run, WITHOUT handing it the engine's secrets
// (API keys, tokens). A repo-supplied server must not be able to read our keys.
const SAFE_ENV_KEYS = new Set([
	"PATH",
	"Path",
	"SystemRoot",
	"windir",
	"ComSpec",
	"TEMP",
	"TMP",
	"HOME",
	"HOMEPATH",
	"HOMEDRIVE",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"LANG",
	"LC_ALL",
	"PATHEXT",
	"NUMBER_OF_PROCESSORS",
	"PROCESSOR_ARCHITECTURE",
])
const SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i

/** Minimal safe env + the server's explicitly-configured env. Secrets are scrubbed. */
function buildEnv(extra?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {}
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && SAFE_ENV_KEYS.has(k) && !SECRET_RE.test(k)) env[k] = v
	}
	// The server's own configured env is trusted (the user put it in mcp.json).
	if (extra) for (const [k, v] of Object.entries(extra)) env[k] = v
	return env
}

function ensureConnected(directory: string): Promise<DirState> {
	const existing = cache.get(directory)
	if (existing) return existing
	const promise = connectAll(directory)
	cache.set(directory, promise)
	// If the whole connect throws, drop the cache entry so a later prompt retries.
	promise.catch(() => cache.delete(directory))
	return promise
}

async function connectAll(directory: string): Promise<DirState> {
	const state: DirState = { tools: [], route: new Map(), clients: [] }
	const servers = readConfig(directory).mcpServers ?? {}
	for (const [name, cfg] of Object.entries(servers)) {
		if (!cfg?.command) continue
		const client = new Client({ name: "hramble-engine", version: "0.1.0" }, { capabilities: {} })
		try {
			const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: buildEnv(cfg.env) })
			await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP connect "${name}"`)
			// Track the client immediately so it's always closed, even if listTools fails.
			state.clients.push(client)
			const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP listTools "${name}"`)
			for (const t of tools) {
				const namespaced = `${PREFIX}${sanitize(name)}${SEP}${sanitize(t.name)}`
				state.tools.push({
					name: namespaced,
					description: `[MCP:${name}] ${t.description ?? t.name}`.trim(),
					input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Tool["input_schema"],
				})
				state.route.set(namespaced, { client, toolName: t.name })
			}
		} catch (err) {
			console.error(`[mcp] failed to connect "${name}":`, err instanceof Error ? err.message : err)
			// Reap the child process on failure so it doesn't leak.
			try {
				await client.close()
			} catch {
				// ignore
			}
		}
	}
	return state
}

/** Anthropic-format tools for all configured MCP servers in this project. */
export async function getMcpTools(directory: string): Promise<Tool[]> {
	try {
		return (await ensureConnected(directory)).tools
	} catch (err) {
		console.error("[mcp] getMcpTools failed:", err instanceof Error ? err.message : err)
		return []
	}
}

export function isMcpTool(name: string): boolean {
	return name.startsWith(PREFIX)
}

/** Call a namespaced MCP tool and return its text result (bounded by a timeout). */
export async function callMcpTool(directory: string, name: string, input: Record<string, unknown>): Promise<string> {
	let entry: { client: Client; toolName: string } | undefined
	try {
		entry = (await ensureConnected(directory)).route.get(name)
	} catch {
		return `MCP tool "${name}" is not available (server connection failed).`
	}
	if (!entry) return `MCP tool "${name}" is not available.`
	try {
		const result = (await withTimeout(
			entry.client.callTool({ name: entry.toolName, arguments: input }),
			CALL_TIMEOUT_MS,
			`MCP call "${name}"`,
		)) as {
			content?: Array<{ type: string; text?: string }>
			isError?: boolean
		}
		const text = (result.content ?? [])
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text)
			.join("\n")
		const out = truncateOutput(text || JSON.stringify(result.content ?? result))
		return result.isError ? `Error: ${out}` : out
	} catch (err) {
		return `Error calling MCP tool "${name}": ${err instanceof Error ? err.message : String(err)}`
	}
}

/** Close all MCP connections (on shutdown), bounded so one hung server can't block exit. */
export async function closeMcp(): Promise<void> {
	const states = await Promise.allSettled([...cache.values()])
	cache.clear()
	for (const s of states) {
		if (s.status !== "fulfilled") continue
		for (const client of s.value.clients) {
			await Promise.race([client.close().catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
		}
	}
}
