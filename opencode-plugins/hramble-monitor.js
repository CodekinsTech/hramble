// Hramble monitor — watch a condition (a file, a URL, or a command's output) and
// wake the agent (in a new session) when it changes. Runs in the persistent engine
// process via setInterval, so it keeps watching after the tool returns. Fires once
// on the first change, then auto-stops (a "tell me when X happens" watcher).

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
import { execSync } from "node:child_process"

const monitors = new Map() // id -> { timer, kind, target }
let counter = 0

async function probe(kind, target) {
	try {
		if (kind === "file") return fs.existsSync(target) ? String(fs.statSync(target).mtimeMs) : "missing"
		if (kind === "command") return execSync(target, { encoding: "utf8", timeout: 20000 }).trim()
		if (kind === "url") {
			const r = await fetch(target)
			return `${r.status}:${(await r.text()).length}`
		}
	} catch (e) {
		return `err:${String(e).slice(0, 60)}`
	}
	return ""
}

export default async ({ client }) => ({
	tool: {
		monitor: tool({
			description:
				"Watch a condition and wake the agent (in a new session) the first time it changes. Use to react to something out of band — a file being written, a URL/endpoint changing, or a command's output changing (e.g. a CI/build status). Fires ONCE on the first change, then stops. For recurring schedules use Automations instead.",
			args: {
				kind: z.enum(["file", "url", "command"]).describe("What to watch"),
				target: z
					.string()
					.describe("File path, URL, or shell command (whose output is watched)"),
				prompt: z
					.string()
					.describe("Self-contained instruction to run when the condition first changes"),
				interval_seconds: z
					.number()
					.optional()
					.describe("Poll interval in seconds (default 30)"),
			},
			execute: async (args) => {
				const id = `mon${++counter}`
				const initial = await probe(args.kind, args.target)
				const ms = Math.max(5, args.interval_seconds ?? 30) * 1000
				const timer = setInterval(async () => {
					const now = await probe(args.kind, args.target)
					if (now !== initial) {
						clearInterval(timer)
						monitors.delete(id)
						try {
							const s = await client.session.create({ title: `monitor: ${args.target}`.slice(0, 50) })
							if (s?.data?.id)
								client.session
									.promptAsync({
										sessionID: s.data.id,
										agent: "build",
										parts: [
											{
												type: "text",
												text: `A watched ${args.kind} changed (${args.target}).\n\n${args.prompt}`,
											},
										],
									})
									.catch(() => {})
						} catch {
							/* ignore */
						}
					}
				}, ms)
				monitors.set(id, { timer, kind: args.kind, target: args.target })
				return `Watching ${args.kind} "${args.target}" (id: ${id}). It will run your instruction in a new session the first time it changes. Use stop_monitor to cancel.`
			},
		}),

		stop_monitor: tool({
			description: "Stop a monitor started with the monitor tool.",
			args: { id: z.string().describe("The monitor id") },
			execute: async (args) => {
				const m = monitors.get(args.id)
				if (!m) return `No monitor ${args.id}.`
				clearInterval(m.timer)
				monitors.delete(args.id)
				return `Stopped monitor ${args.id}.`
			},
		}),
	},
})
