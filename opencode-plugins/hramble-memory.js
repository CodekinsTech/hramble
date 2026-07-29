// Hramble memory — bakes Claude-style long-term memory into the engine.
//
// It registers two tools the model can call:
//   • remember(title, fact, type)  — saves a durable fact as a note file
//   • recall()                     — lists saved memories
// Notes live in <project>/.hramble/memory/<slug>.md with frontmatter, and are
// indexed in the project's AGENTS.md `## Memory` section (which OpenCode always
// loads). Same pattern Claude uses: harness provides the tools + auto-loads the
// index; the model uses them.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
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

	const upsertIndexLine = (title, file, hook) => {
		let content = ""
		try {
			content = fs.readFileSync(agentsFile, "utf8")
		} catch {
			content = "# Project notes\n\n## Memory\n"
		}
		if (!/##\s*Memory/i.test(content)) content += "\n## Memory\n"
		const line = `- [${title}](.hramble/memory/${file}) — ${hook}`
		if (!content.includes(`.hramble/memory/${file}`)) {
			content = content.replace(/(##\s*Memory[^\n]*\n)/i, `$1${line}\n`)
		}
		fs.writeFileSync(agentsFile, content)
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
				},
				execute: async (args) => {
					fs.mkdirSync(memDir, { recursive: true })
					const slug = slugify(args.title)
					const file = `${slug}.md`
					const body = `---\nname: ${slug}\ndescription: ${args.fact.replace(/\n/g, " ").slice(0, 140)}\ntype: ${args.type}\n---\n\n${args.fact}\n`
					fs.writeFileSync(path.join(memDir, file), body)
					upsertIndexLine(args.title, file, args.fact.replace(/\n/g, " ").slice(0, 80))
					return `Remembered "${args.title}" (${args.type}).`
				},
			}),
			recall: tool({
				description:
					"List saved long-term memories (titles + descriptions). Call this at the start of real work; read a specific .hramble/memory/*.md file when its description looks relevant.",
				args: {},
				execute: async () => {
					try {
						const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md"))
						if (!files.length) return "No memories saved yet."
						return files
							.map((f) => {
								const c = fs.readFileSync(path.join(memDir, f), "utf8")
								const d = (c.match(/description:\s*(.*)/) || [])[1] || ""
								return `- ${f}: ${d}`
							})
							.join("\n")
					} catch {
						return "No memories saved yet."
					}
				},
			}),
		},
	}
}
