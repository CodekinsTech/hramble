import { exec } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { truncateOutput } from "../limits.js"

const execAsync = promisify(exec)

const DANGEROUS_PATTERNS = [
	/rm\s+-rf?\s/,
	/rm\s+-fr?\s/,
	/git\s+push.*--force/,
	/git\s+reset\s+--hard/,
	/git\s+clean\s+-f/,
	/DROP\s+TABLE/i,
	/DROP\s+DATABASE/i,
	/TRUNCATE\s+TABLE/i,
	/mkfs/,
	/dd\s+if=/,
	/>\s*\/dev\//,
	/shutdown/,
	/reboot/,
	/npm\s+publish/,
	/yarn\s+publish/,
]

export interface BashInput {
	command: string
	timeout?: number
	directory?: string
}

export interface BashResult {
	stdout: string
	stderr: string
	exitCode: number
	timedOut: boolean
}

export function isDangerous(command: string): boolean {
	return DANGEROUS_PATTERNS.some((p) => p.test(command))
}

export async function runBash(input: BashInput, workingDir: string): Promise<BashResult> {
	const timeout = input.timeout ?? 30000
	const cwd = input.directory ? path.resolve(workingDir, input.directory) : workingDir

	try {
		const { stdout, stderr } = await execAsync(input.command, {
			cwd,
			timeout,
			maxBuffer: 10 * 1024 * 1024, // 10MB hard cap to avoid OOM
			shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
		})
		return { stdout: truncateOutput(stdout ?? ""), stderr: truncateOutput(stderr ?? ""), exitCode: 0, timedOut: false }
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number; killed?: boolean }
		if (e.killed) {
			return { stdout: truncateOutput(e.stdout ?? ""), stderr: "Command timed out", exitCode: 124, timedOut: true }
		}
		return {
			stdout: truncateOutput(e.stdout ?? ""),
			stderr: truncateOutput(e.stderr ?? String(err)),
			exitCode: e.code ?? 1,
			timedOut: false,
		}
	}
}

export const bashToolDefinition = {
	name: "bash",
	description:
		"Execute a shell command in the project directory. Returns stdout, stderr, and exit code.",
	input_schema: {
		type: "object" as const,
		properties: {
			command: {
				type: "string",
				description: "The shell command to run.",
			},
			timeout: {
				type: "number",
				description: "Timeout in milliseconds. Default 30000.",
			},
		},
		required: ["command"],
	},
}
