import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { truncateOutput } from "../limits.js"

const execFileAsync = promisify(execFile)

export interface GrepInput {
	pattern: string
	path?: string
	glob?: string
	caseSensitive?: boolean
}

export async function grepFiles(input: GrepInput, workingDir: string): Promise<string> {
	const searchPath = input.path ?? "."
	// Pass every value as a discrete argv entry (execFile, no shell) so a
	// pattern containing quotes, $(...) or backticks can't inject a command.
	const args: string[] = ["--line-number", "--with-filename"]
	if (!input.caseSensitive) args.push("--ignore-case")
	if (input.glob) args.push("--glob", input.glob)
	args.push("--glob", "!node_modules", "--glob", "!.git", "--glob", "!dist")
	args.push("--max-count", "50", "--", input.pattern, searchPath)

	try {
		const { stdout } = await execFileAsync("rg", args, { cwd: workingDir, timeout: 10000 })
		return truncateOutput(stdout.trim()) || "No matches found."
	} catch {
		// rg exits with code 1 when no matches — try Node.js fallback
		return nodeGrepFallback(input, workingDir)
	}
}

async function nodeGrepFallback(input: GrepInput, workingDir: string): Promise<string> {
	const { glob } = await import("glob")
	const pattern = input.glob ?? "**/*.{ts,tsx,js,jsx,py,go,rs,md,json,yaml,yml}"
	const files = await glob(pattern, {
		cwd: workingDir,
		ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
	})

	const { readFile } = await import("node:fs/promises")
	const regex = new RegExp(input.pattern, input.caseSensitive ? "g" : "gi")
	const results: string[] = []

	for (const file of files) {
		if (results.length >= 50) break
		try {
			const content = await readFile(`${workingDir}/${file}`, "utf-8")
			const lines = content.split("\n")
			for (let i = 0; i < lines.length; i++) {
				if (regex.test(lines[i])) {
					results.push(`${file}:${i + 1}:${lines[i]}`)
					regex.lastIndex = 0
				}
			}
		} catch {
			// skip unreadable files
		}
	}

	return results.length > 0 ? truncateOutput(results.join("\n")) : "No matches found."
}

export const grepToolDefinition = {
	name: "grep",
	description: "Search for a pattern in files. Uses ripgrep if available, falls back to Node.js.",
	input_schema: {
		type: "object" as const,
		properties: {
			pattern: {
				type: "string",
				description: "Regular expression pattern to search for.",
			},
			path: {
				type: "string",
				description: "Directory or file to search in. Defaults to project root.",
			},
			glob: {
				type: "string",
				description: 'File glob filter, e.g. "*.ts".',
			},
			caseSensitive: {
				type: "boolean",
				description: "Case sensitive search. Default false.",
			},
		},
		required: ["pattern"],
	},
}
