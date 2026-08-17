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

const cache = new Map<string, DirState>()

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

/** A string-only copy of process.env merged with a server's extra env. */
function buildEnv(extra?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {}
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
	if (extra) for (const [k, v] of Object.entries(extra)) env[k] = v
	return env
}

async function ensureConnected(directory: string): Promise<DirState> {
	const existing = cache.get(directory)
	if (existing) return existing

	const state: DirState = { tools: [], route: new Map(), clients: [] }
	cache.set(directory, state) // set before awaits so concurrent callers share it

	const servers = readConfig(directory).mcpServers ?? {}
	for (const [name, cfg] of Object.entries(servers)) {
		if (!cfg?.command) continue
		try {
			const client = new Client({ name: "hramble-engine", version: "0.1.0" }, { capabilities: {} })
			const transport = new StdioClientTransport({
				command: cfg.command,
				args: cfg.args ?? [],
				env: buildEnv(cfg.env),
			})
			await client.connect(transport)
			const { tools } = await client.listTools()
			for (const t of tools) {
				const namespaced = `${PREFIX}${sanitize(name)}${SEP}${sanitize(t.name)}`
				state.tools.push({
					name: namespaced,
					description: `[MCP:${name}] ${t.description ?? t.name}`.trim(),
					input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Tool["input_schema"],
				})
				state.route.set(namespaced, { client, toolName: t.name })
			}
			state.clients.push(client)
		} catch (err) {
			console.error(`[mcp] failed to connect "${name}":`, err instanceof Error ? err.message : err)
		}
	}
	return state
}

/** Anthropic-format tools for all configured MCP servers in this project. */
export async function getMcpTools(directory: string): Promise<Tool[]> {
	return (await ensureConnected(directory)).tools
}

export function isMcpTool(name: string): boolean {
	return name.startsWith(PREFIX)
}

/** Call a namespaced MCP tool and return its text result. */
export async function callMcpTool(directory: string, name: string, input: Record<string, unknown>): Promise<string> {
	const entry = cache.get(directory)?.route.get(name)
	if (!entry) return `MCP tool "${name}" is not available.`
	try {
		const result = (await entry.client.callTool({ name: entry.toolName, arguments: input })) as {
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

/** Close all MCP connections (on shutdown). */
export async function closeMcp(): Promise<void> {
	for (const state of cache.values()) {
		for (const client of state.clients) {
			try {
				await client.close()
			} catch {
				// ignore
			}
		}
	}
	cache.clear()
}
