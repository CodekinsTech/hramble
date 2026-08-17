import path from "node:path"
import { atomicWrite } from "../fsutil.js"

export interface WriteInput {
	filePath: string
	content: string
}

export async function writeFile(input: WriteInput, workingDir: string): Promise<string> {
	const resolved = path.resolve(workingDir, input.filePath)
	await atomicWrite(resolved, input.content)
	return `Written ${input.filePath}`
}

export const writeToolDefinition = {
	name: "write",
	description: "Write content to a file. Creates the file and any missing parent directories. Overwrites if the file already exists.",
	input_schema: {
		type: "object" as const,
		properties: {
			filePath: {
				type: "string",
				description: "Path to the file, relative to the project directory.",
			},
			content: {
				type: "string",
				description: "Content to write to the file.",
			},
		},
		required: ["filePath", "content"],
	},
}
