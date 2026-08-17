import fs from "node:fs/promises"
import path from "node:path"
import { atomicWrite } from "../fsutil.js"

export interface EditInput {
	filePath: string
	oldString: string
	newString: string
	replaceAll?: boolean
}

export async function editFile(input: EditInput, workingDir: string): Promise<string> {
	const resolved = path.resolve(workingDir, input.filePath)
	const content = await fs.readFile(resolved, "utf-8")

	const occurrences = content.split(input.oldString).length - 1

	if (occurrences === 0) {
		throw new Error(
			`String not found in ${input.filePath}. The old_string must match exactly — check whitespace, indentation, and line endings.`,
		)
	}

	if (!input.replaceAll && occurrences > 1) {
		throw new Error(
			`Found ${occurrences} occurrences of old_string in ${input.filePath}. Provide more surrounding context to make it unique, or set replaceAll to true.`,
		)
	}

	// Literal replacement — String.replace would interpret $&, $1, $$ etc. in
	// newString and silently corrupt the written text.
	const idx = content.indexOf(input.oldString)
	const updated = input.replaceAll
		? content.split(input.oldString).join(input.newString)
		: content.slice(0, idx) + input.newString + content.slice(idx + input.oldString.length)

	await atomicWrite(resolved, updated)
	return `Edited ${input.filePath}`
}

export const editToolDefinition = {
	name: "edit",
	description:
		"Make a targeted edit to a file by replacing an exact string. The old_string must match the file content exactly including whitespace and indentation. Read the file first if unsure.",
	input_schema: {
		type: "object" as const,
		properties: {
			filePath: {
				type: "string",
				description: "Path to the file, relative to the project directory.",
			},
			oldString: {
				type: "string",
				description: "The exact string to find and replace.",
			},
			newString: {
				type: "string",
				description: "The string to replace it with.",
			},
			replaceAll: {
				type: "boolean",
				description: "Replace all occurrences. Default false.",
			},
		},
		required: ["filePath", "oldString", "newString"],
	},
}
