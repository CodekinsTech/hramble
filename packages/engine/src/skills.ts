import fs from "node:fs"
import path from "node:path"
import { truncateOutput } from "./limits.js"

/**
 * Skills: reusable capability docs the agent can load on demand. Each skill is a
 * folder under <project>/.hramble/skills/<slug>/SKILL.md with YAML-ish
 * frontmatter (name, description) then instructions. The engine shows the model
 * an index (name + description); the model calls the `skill` tool to load the
 * full instructions when a task matches — progressive disclosure, Claude-style.
 */
export interface SkillInfo {
	name: string
	description: string
	slug: string
}

const MAX_SKILL_CHARS = 30_000

function skillsDir(directory: string): string {
	return path.join(directory, ".hramble", "skills")
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!m) return {}
	const out: Record<string, string> = {}
	for (const line of m[1].split(/\r?\n/)) {
		const i = line.indexOf(":")
		if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "")
	}
	return out
}

function listSkillDirs(directory: string): string[] {
	try {
		return fs
			.readdirSync(skillsDir(directory), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
	} catch {
		return []
	}
}

/** All skills available in this project (index metadata only). */
export function discoverSkills(directory: string): SkillInfo[] {
	const skills: SkillInfo[] = []
	for (const slug of listSkillDirs(directory)) {
		try {
			const content = fs.readFileSync(path.join(skillsDir(directory), slug, "SKILL.md"), "utf-8")
			const fm = parseFrontmatter(content)
			skills.push({ slug, name: fm.name || slug, description: fm.description || "" })
		} catch {
			// no SKILL.md — skip
		}
	}
	return skills
}

/** Full SKILL.md content for a named skill (by frontmatter name or folder slug). */
export function readSkill(directory: string, name: string): string | null {
	for (const slug of listSkillDirs(directory)) {
		try {
			const content = fs.readFileSync(path.join(skillsDir(directory), slug, "SKILL.md"), "utf-8")
			const fm = parseFrontmatter(content)
			if ((fm.name || slug) === name || slug === name) return truncateOutput(content, MAX_SKILL_CHARS)
		} catch {
			// skip
		}
	}
	return null
}

/** The skills index block for the system prompt (empty if no skills). */
export function buildSkillsIndex(directory: string): string {
	const skills = discoverSkills(directory)
	if (skills.length === 0) return ""
	const list = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
	return `\n\n## Skills\nReusable skills for this project. When a task matches one, call the \`skill\` tool with its name to load its full instructions, then follow them:\n\n${list}`
}

export interface SkillInput {
	name: string
}

export const skillToolDefinition = {
	name: "skill",
	description:
		"Load the full instructions for one of the project's skills (listed under '## Skills'). Call this when a task matches a skill, then follow the returned instructions.",
	input_schema: {
		type: "object" as const,
		properties: {
			name: { type: "string", description: "The skill name to load." },
		},
		required: ["name"],
	},
}
