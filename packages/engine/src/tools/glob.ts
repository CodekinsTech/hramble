import { glob as globFn } from "glob"
import path from "node:path"

export interface GlobInput {
	pattern: string
	exclude?: string[]
}

export async function globFiles(input: GlobInput, workingDir: string): Promise<string> {
	// Always ignore the heavy dirs; a caller-supplied exclude ADDS to these rather
	// than replacing them (so passing exclude can't accidentally traverse node_modules).
	const ignore = ["**/node_modules/**", "**/.git/**", "**/dist/**", ...(input.exclude ?? [])]
	const files = await globFn(input.pattern, {
		cwd: workingDir,
		ignore,
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

/**
 * File search for the UI's @-mention / file picker: walk the whole project tree
 * (minus heavy dirs), filter by a substring query, and cap only the RESULT count.
 * Unlike globFiles (which caps the file list at 1000 before anything sees it),
 * this never silently drops matches in a large repo.
 */
export async function searchFiles(query: string, workingDir: string, limit = 200): Promise<string[]> {
	const files = await globFn("**/*", {
		cwd: workingDir,
		ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
		dot: false,
		nodir: true,
	})
	const q = query.trim().toLowerCase()
	const matched = q ? files.filter((f) => f.toLowerCase().includes(q)) : files
	matched.sort()
	return matched.slice(0, limit).map((f) => path.join(workingDir, f))
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
