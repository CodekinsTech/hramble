import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Lets the Community page's "Install to my skills" button write a skill
// locally — same destination and SKILL.md format as the agent's own
// create_skill tool (opencode-harness/plugin/hramble-skills.js), so a skill
// installed from the feed shows up identically to one the agent created.
// Also lists what's already installed, so the Community page can show a
// browsable "Skills" catalog instead of only the post feed.

export interface InstallCommunitySkillInput {
	name: string
	description: string
	instructions: string
}

export interface InstallCommunitySkillResult {
	ok: boolean
	slug?: string
	error?: string
}

export interface InstalledSkill {
	slug: string
	name: string
	description: string
}

const SKILLS_DIR = path.join(os.homedir(), ".config", "opencode", "skills")

// Some source skills quote their frontmatter values in YAML ("like this"),
// which a plain regex line-match doesn't unwrap — strip a single matching
// pair of surrounding quotes so the UI doesn't show literal quote marks.
function unquote(value: string): string {
	if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
		return value.slice(1, -1)
	}
	return value
}

function slugify(input: string): string {
	const cleaned = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
	return cleaned || "skill"
}

export async function installCommunitySkill(input: InstallCommunitySkillInput): Promise<InstallCommunitySkillResult> {
	try {
		const slug = slugify(input.name)
		const dir = path.join(SKILLS_DIR, slug)
		await mkdir(dir, { recursive: true })
		const body = `---\nname: ${slug}\ndescription: ${input.description.replace(/\n/g, " ")}\n---\n\n${input.instructions}\n`
		await writeFile(path.join(dir, "SKILL.md"), body, "utf8")
		return { ok: true, slug }
	} catch (err) {
		return { ok: false, error: String(err) }
	}
}

export async function listInstalledSkills(): Promise<InstalledSkill[]> {
	try {
		const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
		const skills: InstalledSkill[] = []
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			try {
				const content = await readFile(path.join(SKILLS_DIR, entry.name, "SKILL.md"), "utf8")
				const name = unquote((content.match(/^name:\s*(.*)$/m) || [])[1]?.trim() || entry.name)
				const description = unquote((content.match(/^description:\s*(.*)$/m) || [])[1]?.trim() || "")
				skills.push({ slug: entry.name, name, description })
			} catch {
				// No SKILL.md in this folder — not a skill, skip it.
			}
		}
		return skills.sort((a, b) => a.name.localeCompare(b.name))
	} catch {
		return []
	}
}
