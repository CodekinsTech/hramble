import path from "node:path"
import { isDangerous } from "./tools/bash.js"
import type { PermissionMode } from "./types.js"

export interface PermissionCheck {
	needs: boolean
	description: string
}

// Tools that only read or track state — low-risk, never prompt (Claude-style),
// even for paths outside the project.
const NEVER_PROMPT = new Set(["read", "grep", "glob", "task", "todowrite", "remember", "skill"])

/** True if `target` is the project dir itself or nested inside it. */
export function isInsideProject(directory: string, target: string): boolean {
	const dir = path.resolve(directory)
	const resolved = path.resolve(target)
	if (resolved === dir) return true
	const withSep = dir.endsWith(path.sep) ? dir : dir + path.sep
	return resolved.startsWith(withSep)
}

const proceed: PermissionCheck = { needs: false, description: "" }

/**
 * Decide whether a tool call must be approved before it runs, given the current
 * permission mode. Claude-Code-style:
 *   - reads never prompt (low-risk), even outside the project
 *   - file writes: manual asks always; accept-edits/auto ask only OUTSIDE the
 *     project; bypass never asks
 *   - bash: manual/accept-edits ask; auto asks only for destructive commands;
 *     bypass never asks
 *   - webfetch: manual/accept-edits ask; auto/bypass allow
 * (plan mode blocks all mutations upstream, so it never reaches here for them.)
 */
export function checkPermission(
	tool: string,
	input: Record<string, unknown>,
	directory: string,
	mode: PermissionMode = "auto",
): PermissionCheck {
	if (mode === "bypass") return proceed
	if (NEVER_PROMPT.has(tool)) return proceed

	if (tool === "write" || tool === "edit" || tool === "multiedit" || tool === "notebookedit") {
		const resolved = path.resolve(directory, String(input.filePath ?? ""))
		const outside = !isInsideProject(directory, resolved)
		if (mode === "manual") {
			const verb =
				tool === "write" ? "Write" : tool === "multiedit" ? "Multi-edit" : tool === "notebookedit" ? "Edit notebook" : "Edit"
			return { needs: true, description: `${verb} ${String(input.filePath ?? resolved)}` }
		}
		// accept-edits & auto: apply in-project edits automatically, confirm outside.
		if (outside) return { needs: true, description: `Write file outside the project: ${resolved}` }
		return proceed
	}

	if (tool === "bash") {
		const command = String(input.command ?? "")
		if (mode === "manual" || mode === "accept-edits") return { needs: true, description: `Run command: ${command}` }
		// auto: only confirm destructive commands.
		if (isDangerous(command)) return { needs: true, description: `Run destructive command: ${command}` }
		return proceed
	}

	if (tool === "webfetch") {
		if (mode === "manual" || mode === "accept-edits") return { needs: true, description: `Fetch URL: ${String(input.url ?? "")}` }
		return proceed
	}

	return proceed
}

/**
 * A stable key identifying "this kind of action" for the persisted allow-list.
 * "Always allow" remembers this key so future matching calls skip the prompt:
 *   - bash  → the binary invoked (e.g. `bash:npm`), not the full command
 *   - file  → the parent directory being touched (e.g. `write:/abs/dir`)
 */
export function permissionKey(tool: string, input: Record<string, unknown>, directory: string): string {
	if (tool === "bash") {
		const bin = String(input.command ?? "").trim().split(/\s+/)[0] ?? ""
		return `bash:${bin}`
	}
	if (tool === "write" || tool === "edit" || tool === "multiedit" || tool === "notebookedit" || tool === "read") {
		const resolved = path.resolve(directory, String(input.filePath ?? ""))
		return `${tool}:${path.dirname(resolved)}`
	}
	return tool
}
