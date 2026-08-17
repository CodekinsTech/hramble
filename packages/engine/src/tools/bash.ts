import { exec } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { truncateOutput } from "../limits.js"

const execAsync = promisify(exec)

const DANGEROUS_PATTERNS = [
	// Unix destructive
	/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\brm\s+-r\b.*\s-f|\brm\s+-f\b.*\s-r/i, // rm with -r and -f in any order/spelling
	/\brm\s+--recursive|\brm\s+--force/i,
	/\bfind\b.*-delete/i,
	/\bshred\b/i,
	/\btruncate\s+-s\s*0/i,
	/\bmkfs/i,
	/\bdd\s+if=/i,
	/>\s*\/dev\/(sd|nvme|disk|null)/i,
	/:\(\)\s*\{.*\}\s*;/, // fork bomb :(){ :|:& };:
	// Windows destructive (cmd.exe / powershell)
	/\bdel\s+.*\/[sq]/i, // del /s /q ...
	/\bdel\s+\/[sq]/i,
	/\brd\s+.*\/s/i, // rd /s /q
	/\brmdir\s+.*\/s/i,
	/\bformat\s+[a-z]:/i,
	/\bformat\s+\/|\bformat\s+[a-z]:/i,
	/\bRemove-Item\b.*-Recurse.*-Force|-Force.*-Recurse/i, // PowerShell rm -rf
	/\bri\s+.*-recurse.*-force/i,
	/\bClear-Disk\b|\bClear-Content\b/i,
	// VCS / DB / lifecycle (cross-platform)
	/\bgit\s+push\b.*--force(?!-with-lease)/i,
	/\bgit\s+reset\s+--hard/i,
	/\bgit\s+clean\s+-[a-z]*f/i,
	/DROP\s+TABLE/i,
	/DROP\s+DATABASE/i,
	/TRUNCATE\s+TABLE/i,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/\bnpm\s+publish/i,
	/\byarn\s+publish/i,
	/\bchmod\s+-R\s+777|\bchmod\s+777/i,
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
		const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; signal?: string }
		// maxBuffer overflow also sets killed=true — distinguish it from a timeout.
		if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
			return { stdout: truncateOutput(e.stdout ?? ""), stderr: "Command output exceeded the 10MB limit and was stopped.", exitCode: 1, timedOut: false }
		}
		if (e.killed && e.signal === "SIGTERM") {
			return { stdout: truncateOutput(e.stdout ?? ""), stderr: `Command timed out after ${timeout / 1000}s and was terminated.`, exitCode: 124, timedOut: true }
		}
		return {
			stdout: truncateOutput(e.stdout ?? ""),
			stderr: truncateOutput(e.stderr ?? String(err)),
			exitCode: typeof e.code === "number" ? e.code : 1,
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
