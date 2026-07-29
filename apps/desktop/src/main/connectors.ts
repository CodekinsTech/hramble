// Connectors (MCP servers) management — lets users add/remove/toggle MCP
// connectors from the UI instead of hand-editing opencode.jsonc.
//
// "Connectors" are MCP servers — the same mechanism Claude uses for
// integrations (GitHub, Postgres, browser, …). We read/write the `mcp` block of
// the OpenCode config. Changes take effect on the next OpenCode restart.

import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { ipcMain } from "electron"

const CONFIG_PATH = path.join(homedir(), ".config", "opencode", "opencode.jsonc")

type McpEntry = { type?: string; command?: string[]; url?: string; enabled?: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Config = { mcp?: Record<string, McpEntry>; [k: string]: any }

/** Strip // and /* *​/ comments so JSONC parses as JSON. */
function stripJsonComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1")
}

async function readConfig(): Promise<Config> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8")
		return JSON.parse(stripJsonComments(raw))
	} catch {
		return {}
	}
}

async function writeConfig(cfg: Config): Promise<void> {
	// Rewritten as clean JSON (comments are normalised away). Functionality is
	// preserved; the schema link is kept at the top.
	await writeFile(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8")
}

// Curated one-click connectors (npx-installable MCP servers).
const PRESETS = [
	{ id: "memory", name: "Memory (long-term)", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], note: "Remembers facts across sessions (knowledge graph)" },
	{ id: "sequential-thinking", name: "Sequential Thinking", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], note: "Step-by-step reasoning for hard problems" },
	{ id: "filesystem", name: "Filesystem", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", homedir()], note: "Read/write files on your machine" },
	{ id: "github", name: "GitHub", command: ["npx", "-y", "@modelcontextprotocol/server-github"], note: "Repos, issues, PRs (needs a token env var)" },
	{ id: "fetch", name: "Web Fetch", command: ["npx", "-y", "@modelcontextprotocol/server-fetch"], note: "Fetch and read web pages" },
	{ id: "playwright", name: "Browser (Playwright)", command: ["npx", "-y", "@playwright/mcp@latest"], note: "Control a browser" },
	{ id: "postgres", name: "Postgres", command: ["npx", "-y", "@modelcontextprotocol/server-postgres"], note: "Query a Postgres database" },
	{ id: "chrome-devtools", name: "Chrome DevTools", command: ["npx", "-y", "chrome-devtools-mcp@latest"], note: "Inspect/debug pages (confuses weak models)" },
]

export function registerConnectors() {
	ipcMain.handle("connectors:list", async () => {
		const cfg = await readConfig()
		const mcp = cfg.mcp ?? {}
		const installed = Object.entries(mcp).map(([name, e]) => ({
			name,
			command: e.command ?? [],
			url: e.url,
			enabled: e.enabled !== false,
		}))
		return { installed, presets: PRESETS }
	})

	ipcMain.handle(
		"connectors:add",
		async (_e, entry: { name: string; command: string[]; enabled?: boolean }) => {
			if (!entry?.name || !Array.isArray(entry.command)) return { ok: false, error: "invalid" }
			const cfg = await readConfig()
			cfg.mcp = cfg.mcp ?? {}
			cfg.mcp[entry.name] = { type: "local", command: entry.command, enabled: entry.enabled !== false }
			await writeConfig(cfg)
			return { ok: true }
		},
	)

	ipcMain.handle("connectors:remove", async (_e, name: string) => {
		const cfg = await readConfig()
		if (cfg.mcp && name in cfg.mcp) {
			delete cfg.mcp[name]
			await writeConfig(cfg)
		}
		return { ok: true }
	})

	ipcMain.handle("connectors:toggle", async (_e, name: string, enabled: boolean) => {
		const cfg = await readConfig()
		if (cfg.mcp?.[name]) {
			cfg.mcp[name].enabled = enabled
			await writeConfig(cfg)
		}
		return { ok: true }
	})
}
