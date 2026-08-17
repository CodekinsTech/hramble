import fs from "node:fs"
import path from "node:path"
import { truncateOutput } from "../limits.js"

/**
 * Project-scoped memory. Each project keeps its own notes in
 * <project>/.hramble/memory.md — nothing global, so one project's memory can
 * never bleed into another's. The agent writes memories deliberately with the
 * `remember` tool; they're injected into the system prompt for that project only.
 */
const MEMORY_REL = path.join(".hramble", "memory.md")
const MAX_MEMORY_CHARS = 8_000

export interface RememberInput {
	memory: string
}

function memoryPath(directory: string): string {
	return path.join(directory, MEMORY_REL)
}

/** Read a project's saved memory (empty string if none). */
export function readProjectMemory(directory: string): string {
	try {
		const content = fs.readFileSync(memoryPath(directory), "utf-8").trim()
		return content ? truncateOutput(content, MAX_MEMORY_CHARS) : ""
	} catch {
		return ""
	}
}

/** Append a memory to the project's memory file. */
export function appendMemory(directory: string, memory: string): string {
	const text = memory.trim()
	if (!text) return "Nothing to remember (empty memory)."
	const file = memoryPath(directory)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const header = fs.existsSync(file) ? "" : "# Project memory\n\n"
	fs.appendFileSync(file, `${header}- ${text}\n`, "utf-8")
	return `Remembered for this project: ${text}`
}

export const rememberToolDefinition = {
	name: "remember",
	description:
		"Save a durable note about THIS project (a convention, decision, gotcha, or fact) so you recall it in future sessions. Stored in the project's .hramble/memory.md and shown to you automatically next time. Use sparingly for things not obvious from the code. Do not store secrets.",
	input_schema: {
		type: "object" as const,
		properties: {
			memory: { type: "string", description: "The single fact to remember, one sentence." },
		},
		required: ["memory"],
	},
}
