import { spawn, type ChildProcess } from "node:child_process"
import { nanoid } from "nanoid"

/**
 * Registry of long-running background shells (dev servers, watchers, builds).
 * `bash` with run_in_background spawns one and returns immediately; the model
 * polls its output with `bashoutput` and stops it with `killshell` — the same
 * shape as Claude Code's Bash(run_in_background)/BashOutput/KillShell.
 */
interface BgShell {
	id: string
	command: string
	cwd: string
	child: ChildProcess
	output: string
	cursor: number // chars already returned by readBackgroundShell
	status: "running" | "exited" | "error"
	exitCode: number | null
	startedAt: number
}

const shells = new Map<string, BgShell>()
const MAX_LIVE = 20 // concurrent running shells
const MAX_TOTAL = 40 // total tracked (running + finished) before reaping
const MAX_OUTPUT = 2 * 1024 * 1024 // 2 MB retained per shell

function appendOutput(s: BgShell, chunk: string): void {
	s.output += chunk
	if (s.output.length > MAX_OUTPUT) {
		const drop = s.output.length - MAX_OUTPUT
		s.output = s.output.slice(drop)
		s.cursor = Math.max(0, s.cursor - drop)
	}
}

/** Drop the oldest fully-drained finished shells so the map can't grow forever. */
function reap(): void {
	if (shells.size <= MAX_TOTAL) return
	const done = [...shells.values()]
		.filter((s) => s.status !== "running" && s.cursor >= s.output.length)
		.sort((a, b) => a.startedAt - b.startedAt)
	for (const s of done) {
		if (shells.size <= MAX_TOTAL) break
		shells.delete(s.id)
	}
}

export function startBackgroundShell(command: string, cwd: string): { id: string } | { error: string } {
	reap()
	const live = [...shells.values()].filter((s) => s.status === "running").length
	if (live >= MAX_LIVE) return { error: `Too many background shells running (${MAX_LIVE}). Stop one with killshell first.` }

	const id = nanoid(8)
	const isWin = process.platform === "win32"
	// Resolve the shell by absolute path (ComSpec) so spawning never depends on
	// System32 being on PATH — the same reason runBash lets exec resolve it.
	const shell = isWin ? process.env.ComSpec || "cmd.exe" : "/bin/bash"
	const child = spawn(shell, isWin ? ["/c", command] : ["-c", command], {
		cwd,
		windowsHide: true,
	})
	const s: BgShell = { id, command, cwd, child, output: "", cursor: 0, status: "running", exitCode: null, startedAt: Date.now() }
	child.stdout?.on("data", (d: Buffer) => appendOutput(s, d.toString()))
	child.stderr?.on("data", (d: Buffer) => appendOutput(s, d.toString()))
	child.on("exit", (code) => {
		s.status = "exited"
		s.exitCode = code ?? null
	})
	child.on("error", (err) => {
		appendOutput(s, `\n[spawn error] ${err instanceof Error ? err.message : String(err)}\n`)
		s.status = "error"
		s.exitCode = -1
	})
	shells.set(id, s)
	return { id }
}

/** Return output produced since the last read, plus the shell's current status. */
export function readBackgroundShell(id: string): string {
	const s = shells.get(id)
	if (!s) return `No background shell "${id}" — it may have been stopped or never existed.`
	const fresh = s.output.slice(s.cursor)
	s.cursor = s.output.length
	const statusLine = s.status === "running" ? "[still running]" : `[${s.status}, exit code ${s.exitCode}]`
	return `${fresh || "(no new output)"}\n${statusLine}`
}

export function killBackgroundShell(id: string): string {
	const s = shells.get(id)
	if (!s) return `No background shell "${id}".`
	try {
		if (process.platform === "win32" && s.child.pid) {
			// Windows children don't die with the shell — kill the whole tree.
			spawn("taskkill", ["/pid", String(s.child.pid), "/t", "/f"], { windowsHide: true })
		} else {
			s.child.kill("SIGTERM")
		}
	} catch {
		// already dead
	}
	s.status = "exited"
	shells.delete(id)
	return `Stopped background shell "${id}" (${s.command}).`
}

/** Kill every tracked shell — called on engine shutdown. */
export function killAllBackgroundShells(): void {
	for (const id of [...shells.keys()]) killBackgroundShell(id)
}

export const bashOutputToolDefinition = {
	name: "bashoutput",
	description:
		"Read new output from a background shell started by bash with run_in_background. Returns only output produced since the last read, plus whether the shell is still running or has exited.",
	input_schema: {
		type: "object" as const,
		properties: {
			bash_id: { type: "string", description: "The shell id returned when the background command was started." },
		},
		required: ["bash_id"],
	},
}

export const killShellToolDefinition = {
	name: "killshell",
	description: "Stop a background shell (and its child processes) started by bash with run_in_background.",
	input_schema: {
		type: "object" as const,
		properties: {
			shell_id: { type: "string", description: "The shell id to stop." },
		},
		required: ["shell_id"],
	},
}
