// Hramble memory — bakes Claude-style long-term memory into the engine.
//
// It registers three tools the model can call:
//   • remember(title, fact, type, scope)  — saves a durable fact as a note file.
//     scope "project" (default) = only this project. scope "global" = follows
//     the user everywhere, across every project.
//   • recall()                            — lists saved memories (project + global)
//   • search_past_work(query)             — searches old session titles/messages
//     across every project, so the agent can answer "what did we do about X
//     last week" without the user re-explaining it.
// Project notes live in <project>/.hramble/memory/<slug>.md, indexed in the
// project's AGENTS.md `## Memory` section (always loaded). Global notes live in
// ~/.hramble/global-memory/<slug>.md, indexed in ~/.hramble/global-memory/INDEX.md.
// Same pattern Claude uses: harness provides the tools + auto-loads the index;
// the model uses them.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const slugify = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50) || "note"

export default async ({ directory }) => {
	const memDir = path.join(directory, ".hramble", "memory")
	const agentsFile = path.join(directory, "AGENTS.md")
	const globalMemDir = path.join(os.homedir(), ".hramble", "global-memory")
	const globalIndexFile = path.join(globalMemDir, "INDEX.md")

	const upsertIndexLine = (indexFile, title, relPath, hook, heading) => {
		let content = ""
		try {
			content = fs.readFileSync(indexFile, "utf8")
		} catch {
			content = `# ${heading}\n\n## Memory\n`
		}
		if (!/##\s*Memory/i.test(content)) content += "\n## Memory\n"
		const line = `- [${title}](${relPath}) — ${hook}`
		if (!content.includes(relPath)) {
			content = content.replace(/(##\s*Memory[^\n]*\n)/i, `$1${line}\n`)
		}
		fs.writeFileSync(indexFile, content)
	}

	const listMemories = (dir) => {
		try {
			return fs
				.readdirSync(dir)
				.filter((f) => f.endsWith(".md") && f !== "INDEX.md")
				.map((f) => {
					const c = fs.readFileSync(path.join(dir, f), "utf8")
					const d = (c.match(/description:\s*(.*)/) || [])[1] || ""
					return `- ${f}: ${d}`
				})
		} catch {
			return []
		}
	}

	return {
		tool: {
			remember: tool({
				description:
					"Save a durable fact to long-term memory (persists across sessions). Use for the user's preferences and corrections, non-obvious project constraints, and decisions with their rationale — NOT transient details or things the code/git already records. Check recall() first to avoid duplicates.",
				args: {
					title: z.string().describe("Short title, e.g. 'Uses tabs not spaces'"),
					fact: z.string().describe("The fact to remember, in full"),
					type: z
						.enum(["user", "feedback", "project", "reference"])
						.describe("user=who they are; feedback=how to work with them; project=constraints/decisions; reference=links"),
					scope: z
						.enum(["project", "global"])
						.optional()
						.describe(
							"project (default) = only relevant to the project you're working in right now. global = about the USER themselves, true no matter which project — their name, role, general preferences, how they like to work.",
						),
				},
				execute: async (args) => {
					const isGlobal = args.scope === "global"
					const dir = isGlobal ? globalMemDir : memDir
					fs.mkdirSync(dir, { recursive: true })
					const slug = slugify(args.title)
					const file = `${slug}.md`
					const body = `---\nname: ${slug}\ndescription: ${args.fact.replace(/\n/g, " ").slice(0, 140)}\ntype: ${args.type}\n---\n\n${args.fact}\n`
					fs.writeFileSync(path.join(dir, file), body)
					const hook = args.fact.replace(/\n/g, " ").slice(0, 80)
					if (isGlobal) {
						upsertIndexLine(globalIndexFile, args.title, file, hook, "Global memory (all projects)")
					} else {
						upsertIndexLine(agentsFile, args.title, `.hramble/memory/${file}`, hook, "Project notes")
					}
					return `Remembered "${args.title}" (${args.type}, ${isGlobal ? "global — every project" : "this project only"}).`
				},
			}),
			recall: tool({
				description:
					"List saved long-term memories — both this project's and the global ones that apply everywhere. Call this at the start of real work; read a specific memory file when its description looks relevant.",
				args: {},
				execute: async () => {
					const project = listMemories(memDir)
					const global = listMemories(globalMemDir)
					const parts = []
					parts.push(global.length ? `Global (all projects):\n${global.join("\n")}` : "Global (all projects): none saved yet.")
					parts.push(project.length ? `This project:\n${project.join("\n")}` : "This project: none saved yet.")
					return parts.join("\n\n")
				},
			}),
			search_past_work: tool({
				description:
					"Search across ALL past sessions in every project for a keyword — session titles and what was actually discussed/done. Use this when the user references something from before ('what did we decide about X', 'didn't we already build Y') instead of asking them to repeat themselves.",
				args: {
					query: z.string().describe("A word or short phrase to search for, e.g. 'font picker' or 'cloudflare account'"),
				},
				execute: async (args) => {
					let Database
					try {
						;({ Database } = await import("bun:sqlite"))
					} catch {
						return "Session search isn't available in this environment (needs the Bun runtime)."
					}
					const dbPath = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")
					if (!fs.existsSync(dbPath)) return "No session history database found."
					let db
					try {
						db = new Database(dbPath, { readonly: true })
						const like = `%${args.query}%`
						const byTitle = db
							.query(
								"SELECT id, title, directory, time_created FROM session WHERE title LIKE ? ORDER BY time_created DESC LIMIT 8",
							)
							.all(like)
						const byContent = db
							.query(
								`SELECT DISTINCT s.id, s.title, s.directory, s.time_created
								 FROM part p JOIN session s ON s.id = p.session_id
								 WHERE p.data LIKE ?
								 ORDER BY s.time_created DESC LIMIT 8`,
							)
							.all(like)
						const seen = new Map()
						for (const row of [...byTitle, ...byContent]) {
							if (!seen.has(row.id)) seen.set(row.id, row)
						}
						const results = [...seen.values()].sort((a, b) => b.time_created - a.time_created).slice(0, 10)
						if (!results.length) return `No past sessions found mentioning "${args.query}".`
						return results
							.map((r) => `- "${r.title}" (${r.directory}, ${new Date(r.time_created).toLocaleDateString()})`)
							.join("\n")
					} catch (e) {
						return `Search failed: ${String(e)}`
					} finally {
						db?.close?.()
					}
				},
			}),
		},
	}
}
