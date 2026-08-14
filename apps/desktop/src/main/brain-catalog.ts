/**
 * Layer 1 — Always-Aware Brain catalog.
 *
 * Builds a COMPACT "menu" of everything saved in the user's local Brain — the
 * names + one-line descriptions of every skill, repo, doc, tool, model, and
 * connector — and writes it to `~/.config/opencode/BRAIN.md`.
 *
 * That file is wired into the OpenCode `instructions` list (see
 * opencode.template.json), so every session automatically KNOWS the full
 * inventory of what the Brain has — without the user asking. Only the menu is
 * ever injected; the full skill/doc body is still loaded on demand when a task
 * actually needs it.
 *
 * Everything here reads local files only — no network, no external services.
 * It never throws to callers: a missing/empty Brain simply yields an empty
 * catalog, and any read error is swallowed so a Brain problem can never block a
 * session from starting.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createLogger } from "./logger"

const log = createLogger("brain-catalog")

/** Root of the OpenCode config the Brain reads/writes (skills, registry, catalog). */
function configDir(): string {
	return path.join(os.homedir(), ".config", "opencode")
}

/** Absolute path of the generated catalog file. Kept next to skills/registry. */
export function getBrainCatalogPath(): string {
	return path.join(configDir(), "BRAIN.md")
}

/** Keep the menu small so it never bloats a session's context. */
const MAX_PER_GROUP = 40
const DESC_MAX = 160

type SkillEntry = {
	name: string
	description: string
	type: string
	verified: boolean
	source?: string
}

type RegistryEntry = {
	kind?: string
	name?: string
	command?: string
	description?: string
	verified?: boolean
}

/** Pull a single scalar frontmatter field (mirrors ipc-handlers `brain:vault`). */
function field(content: string, key: string): string | undefined {
	const raw = (content.match(new RegExp(`^${key}:\\s*(.*)$`, "m")) || [])[1]?.trim()
	if (!raw) return undefined
	if (
		raw.length >= 2 &&
		((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"))
	) {
		return raw.slice(1, -1)
	}
	return raw
}

/** Collapse to a single trimmed line and cap length so each item is one row. */
function oneLine(text: string): string {
	const flat = (text || "").replace(/\s+/g, " ").trim()
	return flat.length > DESC_MAX ? `${flat.slice(0, DESC_MAX - 1).trimEnd()}…` : flat
}

/** Read every skill folder's SKILL.md frontmatter under ~/.config/opencode/skills. */
function readSkills(): SkillEntry[] {
	const skillsDir = path.join(configDir(), "skills")
	let entries: fs.Dirent[]
	try {
		entries = fs.readdirSync(skillsDir, { withFileTypes: true })
	} catch {
		return []
	}
	const out: SkillEntry[] = []
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		try {
			const content = fs.readFileSync(path.join(skillsDir, entry.name, "SKILL.md"), "utf8")
			const type = field(content, "type") || "skill"
			out.push({
				name: field(content, "name") || entry.name,
				description: field(content, "description") || "",
				type: ["skill", "repo", "software", "docs", "model"].includes(type) ? type : "skill",
				verified: field(content, "verified") === "true",
				source: field(content, "source"),
			})
		} catch {
			// No SKILL.md / malformed frontmatter — skip, never crash the catalog.
		}
	}
	return out
}

/** Read the tool/model registry the agent has set up (brain-registry.json). */
function readRegistry(): RegistryEntry[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(path.join(configDir(), "brain-registry.json"), "utf8"))
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

/** Read the enabled MCP connectors from the user's opencode config `mcp` block. */
function readConnectors(): { name: string; hint: string }[] {
	// The user's own config (JSONC) is where connectors:add/remove/toggle write.
	const cfgPath = path.join(configDir(), "opencode.jsonc")
	let raw: string
	try {
		raw = fs.readFileSync(cfgPath, "utf8")
	} catch {
		return []
	}
	try {
		const stripped = raw
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/.*$/gm, "$1")
		const cfg = JSON.parse(stripped) as {
			mcp?: Record<string, { command?: string[]; url?: string; enabled?: boolean }>
		}
		const mcp = cfg.mcp ?? {}
		return Object.entries(mcp)
			.filter(([, e]) => e?.enabled !== false)
			.map(([name, e]) => {
				const hint = e.url
					? "remote MCP"
					: Array.isArray(e.command) && e.command.length
						? e.command.filter((c) => c && !c.startsWith("-") && c !== "npx" && c !== "-y")[0] ||
							"local MCP"
						: "MCP connector"
				return { name, hint: oneLine(hint) }
			})
	} catch {
		return []
	}
}

/** Render one "- name — desc  [verified]" block, capped, with an "…and N more" tail. */
function renderGroup(
	title: string,
	rows: string[],
): string {
	if (rows.length === 0) return ""
	const shown = rows.slice(0, MAX_PER_GROUP)
	const extra = rows.length - shown.length
	const lines = [`## ${title}`, ...shown]
	if (extra > 0) lines.push(`- …and ${extra} more`)
	return lines.join("\n")
}

/**
 * Build the compact catalog markdown from the local Brain. Returns an empty
 * string when the Brain has nothing saved (so nothing is injected).
 */
export function buildBrainCatalog(): string {
	const skills = readSkills()
	const registry = readRegistry()
	const connectors = readConnectors()

	const verifiedTag = (v: boolean) => (v ? "[verified]" : "[unverified]")

	// Skills split by frontmatter type; registry adds tools/models.
	const skillRows = skills
		.filter((s) => s.type === "skill")
		.map((s) => `- ${s.name} — ${oneLine(s.description)}  ${verifiedTag(s.verified)}`)
	const repoRows = skills
		.filter((s) => s.type === "repo")
		.map((s) => `- ${s.name} — ${oneLine(s.description)}  ${verifiedTag(s.verified)}`)
	const docRows = skills
		.filter((s) => s.type === "docs")
		.map((s) => `- ${s.name} — ${oneLine(s.description)}  ${verifiedTag(s.verified)}`)

	const toolRows = [
		...skills
			.filter((s) => s.type === "software")
			.map((s) => `- ${s.name} — ${oneLine(s.description)}  ${verifiedTag(s.verified)}`),
		...registry
			.filter((r) => r.kind === "tool" && r.name)
			.map((r) => {
				const cmd = r.command ? ` (\`${oneLine(r.command)}\`)` : ""
				return `- ${r.name}${cmd} — ${oneLine(r.description || "")}  ${verifiedTag(!!r.verified)}`
			}),
	]

	const modelRows = [
		...skills
			.filter((s) => s.type === "model")
			.map((s) => `- ${s.name} — ${oneLine(s.description)}  ${verifiedTag(s.verified)}`),
		...registry
			.filter((r) => r.kind === "model" && r.name)
			.map((r) => {
				const cmd = r.command ? ` (\`${oneLine(r.command)}\`)` : ""
				return `- ${r.name}${cmd} — ${oneLine(r.description || "")}  ${verifiedTag(!!r.verified)}`
			}),
	]

	const connectorRows = connectors.map((c) => `- ${c.name} — ${c.hint}`)

	const groups = [
		renderGroup("Skills", skillRows),
		renderGroup("Repos", repoRows),
		renderGroup("Docs", docRows),
		renderGroup("Tools", toolRows),
		renderGroup("Models", modelRows),
		renderGroup("Connectors", connectorRows),
	].filter(Boolean)

	if (groups.length === 0) return ""

	const header =
		"# Your Brain — local inventory\n\n" +
		"You already have everything below saved locally on this machine. This is just " +
		"the MENU (names + one-line descriptions) so you always know what's available — " +
		"you do NOT need to be told about these or go looking for them. Load the full " +
		"item only when a task actually needs it (matching skills auto-load by their " +
		"description; tools, models, and connectors are already set up and ready to use). " +
		"`[verified]` means it was actually tested and confirmed working; `[unverified]` " +
		"means treat with a little caution."

	return `${header}\n\n${groups.join("\n\n")}\n`
}

/**
 * One flat candidate for relevance matching — every saved Brain item, whatever
 * its group (skill/repo/docs/tool/model/connector), reduced to the fields a
 * matcher needs. Layer 2 (brain-recall.ts) scores these against a task's text.
 */
export type BrainCandidate = {
	name: string
	/** Human group label: "skill" | "repo" | "docs" | "tool" | "model" | "connector". */
	type: string
	description: string
	verified: boolean
	/** How to reach it — a command, repo/doc source, or connector hint (for the "how to use" pointer). */
	source?: string
}

/**
 * Build the full, flat list of Brain items using the SAME local readers the
 * Layer 1 catalog uses (no duplicated frontmatter parsing). Reads a few dozen
 * small local files only — no network. Never throws; returns [] on an empty or
 * unreadable Brain.
 */
export function readBrainCandidates(): BrainCandidate[] {
	try {
		const skills = readSkills()
		const registry = readRegistry()
		const connectors = readConnectors()

		const out: BrainCandidate[] = []

		// Skills carry their own type in frontmatter; "software" reads as "tool".
		for (const s of skills) {
			out.push({
				name: s.name,
				type: s.type === "software" ? "tool" : s.type,
				description: s.description,
				verified: s.verified,
				source: s.source,
			})
		}

		// Registry: real CLI tools + local models the agent set up.
		for (const r of registry) {
			if (!r.name || (r.kind !== "tool" && r.kind !== "model")) continue
			out.push({
				name: r.name,
				type: r.kind,
				description: r.description || "",
				verified: !!r.verified,
				source: r.command,
			})
		}

		// MCP connectors — the hint doubles as both description and "how to use".
		for (const c of connectors) {
			out.push({
				name: c.name,
				type: "connector",
				description: c.hint,
				verified: true,
				source: c.hint,
			})
		}

		return out
	} catch {
		return []
	}
}

/**
 * Regenerate `~/.config/opencode/BRAIN.md`. When `enabled` is false (toggle off)
 * or the Brain is empty, the file is truncated to empty so nothing is injected.
 * Safe to call often; never throws.
 */
export function writeBrainCatalog(enabled: boolean): void {
	try {
		const target = getBrainCatalogPath()
		fs.mkdirSync(path.dirname(target), { recursive: true })
		const content = enabled ? buildBrainCatalog() : ""
		fs.writeFileSync(target, content, "utf8")
		log.info("Wrote Brain catalog", { enabled, bytes: content.length })
	} catch (err) {
		log.warn("Failed to write Brain catalog (non-fatal)", {
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
