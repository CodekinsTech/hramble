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
// `envKey` = an API-key env var the user must supply (asked for in the UI).
const PRESETS = [
	{ id: "web-search", name: "Web Search (free)", command: ["npx", "-y", "@oevortex/ddg_search"], note: "Search the web + read pages — DuckDuckGo, no API key" },
	{ id: "web-search-exa", name: "Web Search (Exa)", command: ["npx", "-y", "exa-mcp-server"], note: "AI-tuned search + crawling — free tier key at exa.ai", envKey: "EXA_API_KEY" },
	{ id: "web-search-searxng", name: "Web Search (SearXNG)", command: ["npx", "-y", "mcp-searxng"], note: "Private meta-search — paste a SearXNG instance URL (self-host or a public one)", envKey: "SEARXNG_URL" },
	{ id: "web-search-tavily", name: "Web Search (Tavily)", command: ["npx", "-y", "tavily-mcp@latest"], note: "Higher-quality search — free key at tavily.com", envKey: "TAVILY_API_KEY" },
	{ id: "web-search-brave", name: "Web Search (Brave)", command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"], note: "Search the web — free key at brave.com/search/api", envKey: "BRAVE_API_KEY" },
	{ id: "memory", name: "Memory (long-term)", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], note: "Remembers facts across sessions (knowledge graph)" },
	{ id: "sequential-thinking", name: "Sequential Thinking", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], note: "Step-by-step reasoning for hard problems" },
	{ id: "filesystem", name: "Filesystem", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", homedir()], note: "Read/write files on your machine" },
	{ id: "github", name: "GitHub", command: ["npx", "-y", "@modelcontextprotocol/server-github"], note: "Repos, issues, PRs (needs a token env var)" },
	{ id: "playwright", name: "Browser (built-in)", command: ["npx", "-y", "@playwright/mcp@latest"], note: "Drive a browser — navigate, click, type, fill & submit forms. Offline, no key. Uses a bundled Chromium (works on any machine)." },
	{ id: "playwright-chrome", name: "Browser (your Chrome)", command: ["npx", "-y", "@playwright/mcp@latest", "--browser", "chrome"], note: "Same, but drives your installed Google Chrome with your logged-in sessions — no download. Requires Chrome to be installed." },
	{ id: "postgres", name: "Postgres", command: ["npx", "-y", "@modelcontextprotocol/server-postgres"], note: "Query a Postgres database" },
	{ id: "chrome-devtools", name: "Chrome DevTools", command: ["npx", "-y", "chrome-devtools-mcp@latest"], note: "Inspect/debug pages (confuses weak models)" },
	{ id: "figma", name: "Figma (design)", command: ["npx", "-y", "figma-developer-mcp", "--stdio"], note: "Read Figma designs to build UI from them — free key at figma.com/developers/api", envKey: "FIGMA_API_KEY" },

	// --- Backend platforms — let the agent build AND operate a real backend ---
	{ id: "supabase", name: "Supabase", command: ["npx", "-y", "@supabase/mcp-server-supabase@latest"], note: "Postgres DB, auth, storage, edge functions, migrations, advisors — token at supabase.com/dashboard/account/tokens", envKey: "SUPABASE_ACCESS_TOKEN" },
	{ id: "cloudflare", name: "Cloudflare (Workers/R2/D1/KV)", command: ["npx", "-y", "mcp-remote", "https://bindings.mcp.cloudflare.com/sse"], note: "Build & manage Workers, R2, D1, KV, deploys — opens a browser once to authorize your Cloudflare account (no key to paste)" },
	{ id: "firebase", name: "Firebase", command: ["npx", "-y", "firebase-tools@latest", "experimental:mcp"], note: "Firestore, Auth, Functions, Hosting — uses your Firebase CLI login (run `firebase login` once first)" },
	{ id: "neon", name: "Neon (serverless Postgres)", command: ["npx", "-y", "@neondatabase/mcp-server-neon", "start"], note: "Serverless Postgres — branches, SQL, migrations. API key at console.neon.tech", envKey: "NEON_API_KEY" },
	{ id: "mongodb", name: "MongoDB (Atlas)", command: ["npx", "-y", "mongodb-mcp-server"], note: "Query & manage MongoDB / Atlas — paste your DB connection string", envKey: "MDB_MCP_CONNECTION_STRING" },
	{ id: "stripe", name: "Stripe (payments)", command: ["npx", "-y", "@stripe/mcp", "--tools=all"], note: "Payments, subscriptions, customers — secret key at dashboard.stripe.com/apikeys", envKey: "STRIPE_SECRET_KEY" },

	// --- Remote (url-based) connectors — no local command, just an endpoint ---
	{ id: "stitch", name: "Stitch (Google UI design)", command: [], note: "Generate & edit UI screens with Google's Stitch — paste the MCP URL from stitch.withgoogle.com/docs/mcp/setup", urlPrompt: "Stitch MCP URL" },
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
		async (
			_e,
			entry: {
				name: string
				command?: string[]
				url?: string
				enabled?: boolean
				environment?: Record<string, string>
			},
		) => {
			if (!entry?.name) return { ok: false, error: "invalid" }
			const isRemote = !!entry.url
			if (!isRemote && !Array.isArray(entry.command)) return { ok: false, error: "invalid" }
			const cfg = await readConfig()
			cfg.mcp = cfg.mcp ?? {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const mcpEntry: any = isRemote
				? { type: "remote", url: entry.url, enabled: entry.enabled !== false }
				: { type: "local", command: entry.command, enabled: entry.enabled !== false }
			if (entry.environment && Object.keys(entry.environment).length) {
				mcpEntry.environment = entry.environment
			}
			cfg.mcp[entry.name] = mcpEntry
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
