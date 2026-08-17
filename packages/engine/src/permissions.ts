import path from "node:path"
import { isDangerous } from "./tools/bash.js"

export interface PermissionCheck {
	needs: boolean
	description: string
}

/** True if `target` is the project dir itself or nested inside it. */
export function isInsideProject(directory: string, target: string): boolean {
	const dir = path.resolve(directory)
	const resolved = path.resolve(target)
	if (resolved === dir) return true
	const withSep = dir.endsWith(path.sep) ? dir : dir + path.sep
	return resolved.startsWith(withSep)
}

/**
 * Decide whether a tool call must be approved by the user before it runs.
 *
 * Policy (safety boundary, not nag-on-everything):
 *   - bash matching a destructive pattern  → ask
 *   - read/write/edit resolving OUTSIDE the project directory → ask
 *   - everything else inside the project → proceed
 */
export function checkPermission(
	tool: string,
	input: Record<string, unknown>,
	directory: string,
): PermissionCheck {
	if (tool === "bash") {
		const command = String(input.command ?? "")
		if (isDangerous(command)) return { needs: true, description: `Run destructive command: ${command}` }
		return { needs: false, description: "" }
	}

	if (tool === "write" || tool === "edit" || tool === "multiedit" || tool === "read") {
		const filePath = String(input.filePath ?? "")
		const resolved = path.resolve(directory, filePath)
		if (!isInsideProject(directory, resolved)) {
			const verb = tool === "read" ? "Read" : tool === "write" ? "Write" : "Edit"
			return { needs: true, description: `${verb} file outside the project: ${resolved}` }
		}
	}

	return { needs: false, description: "" }
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
	if (tool === "write" || tool === "edit" || tool === "multiedit" || tool === "read") {
		const resolved = path.resolve(directory, String(input.filePath ?? ""))
		return `${tool}:${path.dirname(resolved)}`
	}
	return tool
}
