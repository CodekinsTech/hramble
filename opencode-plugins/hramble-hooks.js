// Hramble hooks — user-defined shell commands that run around tool calls, like
// Claude Code's PreToolUse / PostToolUse hooks.
//
// Configure them in ~/.config/opencode/hramble-hooks.json as an array of:
//   {
//     "event":   "PreToolUse" | "PostToolUse",
//     "tool":    "bash",         // optional; omit or "*" = every tool. "*" wildcards ok.
//     "command": "echo $HRAMBLE_TOOL >> ~/tool.log",
//     "blocking": true,          // PreToolUse only: non-zero exit BLOCKS the tool
//     "timeout": 10000           // ms (default 10000)
//   }
//
// The command runs via /bin/sh -c with these environment variables:
//   HRAMBLE_EVENT  — "PreToolUse" | "PostToolUse"
//   HRAMBLE_TOOL   — the tool name (e.g. "bash", "edit")
//   HRAMBLE_ARGS   — JSON of the tool's arguments
//   HRAMBLE_OUTPUT — (PostToolUse only) JSON of the tool result
//
// The config is re-read on every event, so edits take effect without a restart.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

const CONFIG = path.join(homedir(), ".config", "opencode", "hramble-hooks.json")

function loadHooks() {
	try {
		const raw = fs.readFileSync(CONFIG, "utf8")
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return [] // no config (or invalid) = no hooks
	}
}

/** Does a hook's optional `tool` matcher apply to this tool name? */
function toolMatches(hookTool, toolName) {
	if (!hookTool || hookTool === "*") return true
	if (hookTool === toolName) return true
	// simple glob: "web*" etc.
	const rx = new RegExp(`^${hookTool.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
	return rx.test(toolName)
}

function runHook(hook, env) {
	const res = spawnSync("/bin/sh", ["-c", String(hook.command)], {
		env: { ...process.env, ...env },
		timeout: Number(hook.timeout) > 0 ? Number(hook.timeout) : 10_000,
		encoding: "utf8",
	})
	return {
		code: res.status ?? (res.error ? 1 : 0),
		stdout: (res.stdout || "").trim(),
		stderr: (res.stderr || "").trim(),
		error: res.error,
	}
}

export default async () => ({
	"tool.execute.before": async (input, output) => {
		const hooks = loadHooks().filter(
			(h) => h && h.event === "PreToolUse" && toolMatches(h.tool, input?.tool),
		)
		if (hooks.length === 0) return
		const env = {
			HRAMBLE_EVENT: "PreToolUse",
			HRAMBLE_TOOL: String(input?.tool ?? ""),
			HRAMBLE_ARGS: JSON.stringify(output?.args ?? {}),
		}
		for (const hook of hooks) {
			const r = runHook(hook, env)
			// A blocking PreToolUse hook that fails stops the tool from running.
			if (hook.blocking && r.code !== 0) {
				throw new Error(
					`Blocked by hook (exit ${r.code}): ${r.stderr || r.stdout || hook.command}`,
				)
			}
		}
	},
	"tool.execute.after": async (input, output) => {
		const hooks = loadHooks().filter(
			(h) => h && h.event === "PostToolUse" && toolMatches(h.tool, input?.tool),
		)
		if (hooks.length === 0) return
		const env = {
			HRAMBLE_EVENT: "PostToolUse",
			HRAMBLE_TOOL: String(input?.tool ?? ""),
			HRAMBLE_ARGS: JSON.stringify(input?.args ?? {}),
			HRAMBLE_OUTPUT: JSON.stringify({ title: output?.title, output: output?.output }),
		}
		for (const hook of hooks) runHook(hook, env) // post hooks never block
	},
})
