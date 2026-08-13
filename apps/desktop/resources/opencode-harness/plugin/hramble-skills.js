// Hramble skills — lets the agent turn something it worked out into a reusable
// skill, instead of re-deriving it from scratch next time. Same idea as
// Hermes Agent's "creates skills from experience, improves them during use."
//
// Skills live in the same folder OpenCode already scans for bundled skills
// (config `skills.paths`), using the exact same SKILL.md format — so a
// self-created skill shows up and gets picked up exactly like a bundled one.

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
		.slice(0, 50) || "skill"

export default async () => {
	const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills")
	const registryPath = path.join(os.homedir(), ".config", "opencode", "brain-registry.json")

	return {
		tool: {
			register_brain_tool: tool({
				description:
					"Record a real CLI tool or local model the Brain has set up, so future sessions know it's available as a reusable capability. Call this AFTER you have actually installed/set up and tested the thing — pass verified: true only if you ran the exact command and it worked. Upserts by name, so calling it again with the same name updates the entry rather than duplicating it.",
				args: {
					kind: z.enum(["tool", "model"]).describe("'tool' for a CLI/software tool, 'model' for a local model"),
					name: z.string().describe("Short identifier, e.g. 'vtracer' or 'llama-3.3-70b'"),
					command: z
						.string()
						.describe("The actual shell command / how to invoke it, e.g. 'vtracer input.png output.svg'"),
					description: z.string().describe("One line: what it does and when to use it"),
					source: z.string().optional().describe("Where it came from — the original URL or path, if any."),
					verified: z
						.boolean()
						.optional()
						.describe("Set true ONLY after you actually ran the command and it worked. Defaults to false."),
				},
				execute: async (args) => {
					let registry = []
					try {
						registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
						if (!Array.isArray(registry)) registry = []
					} catch {
						registry = []
					}
					const verified = args.verified === true
					const existing = registry.find((e) => e && e.name === args.name)
					if (existing) {
						existing.kind = args.kind
						existing.command = args.command
						existing.description = args.description
						existing.verified = verified
						if (args.source) existing.source = args.source
					} else {
						registry.push({
							id: `${slugify(args.name)}-${Date.now().toString(36)}`,
							kind: args.kind,
							name: args.name,
							command: args.command,
							description: args.description,
							verified,
							source: args.source,
							addedAt: Date.now(),
						})
					}
					fs.mkdirSync(path.dirname(registryPath), { recursive: true })
					fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))
					return `${existing ? "Updated" : "Registered"} ${args.kind} "${args.name}" (${verified ? "verified" : "unverified"}) — future sessions can reuse it via: ${args.command}`
				},
			}),
			create_skill: tool({
				description:
					"Save a reusable skill after solving something non-trivial, so a future session can do it faster and more reliably instead of re-deriving it from scratch. A skill is step-by-step HOW-TO instructions for a repeatable kind of task — NOT a one-off fact about the user or project (use remember() for those). If a skill with this name already exists, this UPDATES it — fold in what you learned this time rather than creating a near-duplicate with a slightly different name. Only pass verified: true after you have ACTUALLY run/tested the thing on a small example and confirmed it works — never mark something verified just because you set it up or read about it.",
				args: {
					name: z.string().describe("Short kebab-case identifier, e.g. 'debug-flaky-playwright-test'"),
					description: z
						.string()
						.describe(
							"One line: what this skill does and WHEN to use it — this is how a future session decides whether it's relevant",
						),
					instructions: z
						.string()
						.describe(
							"The actual step-by-step how-to, in full — as much detail as a competent engineer would need to repeat this without re-deriving it",
						),
					type: z
						.enum(["skill", "repo", "software", "model"])
						.optional()
						.describe("What kind of thing this is. Defaults to 'skill'."),
					verified: z
						.boolean()
						.optional()
						.describe(
							"Set true ONLY after you actually ran/tested it and confirmed it works. Defaults to false.",
						),
					source: z.string().optional().describe("Where it came from — the original URL or path, if any."),
				},
				execute: async (args) => {
					const slug = slugify(args.name)
					const dir = path.join(skillsDir, slug)
					const existed = fs.existsSync(dir)
					fs.mkdirSync(dir, { recursive: true })
					const type = args.type || "skill"
					const verified = args.verified === true
					let frontmatter = `name: ${slug}\ndescription: ${args.description.replace(/\n/g, " ")}\ntype: ${type}\nverified: ${verified}`
					if (args.source) frontmatter += `\nsource: ${args.source.replace(/\n/g, " ")}`
					const body = `---\n${frontmatter}\n---\n\n${args.instructions}\n`
					fs.writeFileSync(path.join(dir, "SKILL.md"), body)
					return `${existed ? "Updated" : "Created"} skill "${slug}" (${type}, ${verified ? "verified" : "unverified"}) — it'll be picked up in future sessions.`
				},
			}),
		},
	}
}
