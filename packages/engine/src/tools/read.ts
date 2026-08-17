import fs from "node:fs/promises"
import path from "node:path"
import { DEFAULT_READ_LINES, MAX_LINE_CHARS } from "../limits.js"

export interface ReadInput {
	filePath: string
	offset?: number
	limit?: number
}

/**
 * Read a file and return it with 1-based line numbers (`   12\tcode`), the same
 * shape editors and Claude Code use so the model can make precise line-anchored
 * edits. Defaults to the first DEFAULT_READ_LINES lines; over-long lines are
 * clipped so one minified file can't blow up the context window.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024 // don't slurp a multi-GB file into memory

export async function readFile(input: ReadInput, workingDir: string): Promise<string> {
	const resolved = path.resolve(workingDir, input.filePath)

	const stat = await fs.stat(resolved)
	if (stat.isDirectory()) return `${input.filePath} is a directory, not a file. Use glob or grep to list its contents.`
	if (stat.size > MAX_FILE_BYTES) {
		return `${input.filePath} is ${(stat.size / 1024 / 1024).toFixed(1)} MB — too large to read whole. Use grep to search it, or bash to inspect specific parts.`
	}

	const buf = await fs.readFile(resolved)
	// Binary detection: a NUL byte in the first 8 KB reliably marks non-text.
	const sample = buf.subarray(0, 8192)
	if (sample.includes(0)) {
		return `${input.filePath} appears to be a binary file (${stat.size} bytes) — not shown as text.`
	}
	const content = buf.toString("utf-8")
	const allLines = content.split("\n")

	const start = input.offset ?? 0
	const limit = input.limit ?? DEFAULT_READ_LINES
	const end = Math.min(allLines.length, start + limit)
	const slice = allLines.slice(start, end)

	if (slice.length === 0) return "(no lines in the requested range)"

	const width = String(end).length
	const numbered = slice
		.map((line, i) => {
			const n = String(start + i + 1).padStart(width, " ")
			const clipped = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [line truncated]` : line
			return `${n}\t${clipped}`
		})
		.join("\n")

	const remaining = allLines.length - end
	if (remaining > 0) {
		return `${numbered}\n\n[${remaining} more line(s) — read with offset ${end} to continue]`
	}
	return numbered
}

export const readToolDefinition = {
	name: "read",
	description: "Read the contents of a file. Optionally specify offset (line number to start) and limit (number of lines).",
	input_schema: {
		type: "object" as const,
		properties: {
			filePath: {
				type: "string",
				description: "Path to the file, relative to the project directory.",
			},
			offset: {
				type: "number",
				description: "Line number to start reading from (0-indexed).",
			},
			limit: {
				type: "number",
				description: "Maximum number of lines to read.",
			},
		},
		required: ["filePath"],
	},
}
