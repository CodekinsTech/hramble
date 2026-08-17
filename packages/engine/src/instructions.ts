import fs from "node:fs"
import path from "node:path"
import { truncateOutput } from "./limits.js"

/**
 * Standard project instruction files, in precedence order. Matches Claude Code
 * (CLAUDE.md), the emerging AGENTS.md convention, and common rule files. These
 * are trusted, project-authored guidance that the agent should follow.
 */
const INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".cursorrules", ".hramble/rules.md"]
const MAX_INSTRUCTION_CHARS = 12_000

/**
 * Read this project's instruction files and format them for the system prompt.
 * Returns "" if none exist. Scoped to the given directory only — no parent walk,
 * no global files — so one project's rules never leak into another.
 */
export function readProjectInstructions(directory: string): string {
	const blocks: string[] = []
	for (const name of INSTRUCTION_FILES) {
		try {
			const content = fs.readFileSync(path.join(directory, name), "utf-8").trim()
			if (content) blocks.push(`### ${name}\n${content}`)
		} catch {
			// Missing/unreadable — skip.
		}
	}
	if (blocks.length === 0) return ""
	return truncateOutput(blocks.join("\n\n"), MAX_INSTRUCTION_CHARS)
}
