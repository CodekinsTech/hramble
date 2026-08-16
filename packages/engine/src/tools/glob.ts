import { glob as globFn } from "glob"
import path from "node:path"

export interface GlobInput {
	pattern: string
	exclude?: string[]
}

export async function globFiles(input: GlobInput, workingDir: string): Promise<string> {
	const files = await globFn(input.pattern, {
		cwd: workingDir,
		ignore: input.exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"],
		dot: false,
	})

	files.sort()

	if (files.length === 0) return "No files found matching the pattern."

	const MAX_FILES = 1000
	const shown = files.slice(0, MAX_FILES).map((f) => path.join(workingDir, f)).join("\n")
	if (files.length > MAX_FILES) {
		return `${shown}\n\n[${files.length - MAX_FILES} more file(s) — narrow the pattern to see them]`
	}
	return shown
}

export const globToolDefinition = {
	name: "glob",
	description: "Find files matching a glob pattern in the project directory.",
	input_schema: {
		type: "object" as const,
		properties: {
			pattern: {
				type: "string",
				description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.tsx".',
			},
			exclude: {
				type: "array",
				items: { type: "string" },
				description: "Patterns to exclude. Defaults to node_modules, .git, dist.",
			},
		},
		required: ["pattern"],
	},
}
