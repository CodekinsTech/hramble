import fs from "node:fs/promises"
import path from "node:path"

export interface EditOp {
	oldString: string
	newString: string
	replaceAll?: boolean
}

export interface MultiEditInput {
	filePath: string
	edits: EditOp[]
}

/**
 * Apply several edits to one file atomically. Edits run in order (each sees the
 * previous edit's result); if ANY fails to match, nothing is written — so the
 * file is never left half-edited.
 */
export async function multiEdit(input: MultiEditInput, workingDir: string): Promise<string> {
	const edits = Array.isArray(input.edits) ? input.edits : []
	if (edits.length === 0) throw new Error("multiedit requires at least one edit.")

	const resolved = path.resolve(workingDir, input.filePath)
	let content = await fs.readFile(resolved, "utf-8")

	for (let i = 0; i < edits.length; i++) {
		const { oldString, newString, replaceAll } = edits[i]
		if (typeof oldString !== "string" || oldString.length === 0) {
			throw new Error(`Edit ${i + 1}: oldString must be a non-empty string.`)
		}
		if (oldString === newString) {
			throw new Error(`Edit ${i + 1}: oldString and newString are identical (no-op).`)
		}
		const occurrences = content.split(oldString).length - 1
		if (occurrences === 0) {
			throw new Error(`Edit ${i + 1}: string not found in ${input.filePath}. Match exactly incl. whitespace.`)
		}
		if (!replaceAll && occurrences > 1) {
			throw new Error(`Edit ${i + 1}: ${occurrences} occurrences in ${input.filePath}. Add context or set replaceAll.`)
		}
		content = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
	}

	await fs.writeFile(resolved, content, "utf-8")
	return `Applied ${edits.length} edit(s) to ${input.filePath}`
}

export const multiEditToolDefinition = {
	name: "multiedit",
	description:
		"Apply multiple find-and-replace edits to a SINGLE file in one atomic operation. Edits apply in order (each sees the previous result); if any edit's old_string doesn't match, none are written. Prefer this over several edit calls on the same file. Read the file first.",
	input_schema: {
		type: "object" as const,
		properties: {
			filePath: { type: "string", description: "Path to the file, relative to the project directory." },
			edits: {
				type: "array",
				description: "Edits to apply in sequence.",
				items: {
					type: "object",
					properties: {
						oldString: { type: "string", description: "Exact text to replace (non-empty)." },
						newString: { type: "string", description: "Replacement text." },
						replaceAll: { type: "boolean", description: "Replace all occurrences. Default false." },
					},
					required: ["oldString", "newString"],
				},
			},
		},
		required: ["filePath", "edits"],
	},
}
