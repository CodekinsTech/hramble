import fs from "node:fs"
import path from "node:path"
import os from "node:os"

/**
 * Candidate directories for common developer tools that a spawned process might
 * be missing from its inherited PATH (git especially, on Windows).
 */
function toolDirs(): string[] {
	if (process.platform === "win32") {
		const pf = process.env.ProgramFiles ?? "C:\\Program Files"
		const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
		const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
		const winDir = process.env.SystemRoot ?? "C:\\Windows"
		return [
			path.join(pf, "Git", "cmd"),
			path.join(pf, "Git", "bin"),
			path.join(pf86, "Git", "cmd"),
			path.join(local, "Programs", "Git", "cmd"),
			path.join(winDir, "System32"),
			winDir,
		]
	}
	// POSIX: the usual suspects a GUI-launched app can miss.
	return ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", path.join(os.homedir(), ".local", "bin")]
}

/**
 * Prepend any missing common tool directories to PATH so the engine's bash tool
 * can always find git and core utilities — even when the process was spawned
 * (e.g. by Electron) with a reduced PATH. Idempotent; only adds dirs that exist
 * and aren't already present.
 */
export function ensureToolsOnPath(): void {
	const sep = process.platform === "win32" ? ";" : ":"
	const current = process.env.PATH ?? ""
	const existing = new Set(current.split(sep).filter(Boolean).map((p) => p.toLowerCase()))
	const toAdd = toolDirs().filter((dir) => {
		try {
			return fs.existsSync(dir) && !existing.has(dir.toLowerCase())
		} catch {
			return false
		}
	})
	if (toAdd.length > 0) {
		process.env.PATH = [...toAdd, current].filter(Boolean).join(sep)
	}
}
