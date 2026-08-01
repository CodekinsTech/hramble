// Hramble background tasks — run long jobs as detached sessions that keep going
// while the user (and the main agent) continue working.
//
// Built on the engine's own session API (the plugin gets the full client SDK):
// spawn_task creates a session and fires promptAsync WITHOUT awaiting, so the run
// happens on the server in the background. The spawned session also shows up in
// Hramble's session sidebar, so it's visible in the UI too.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

// Tracks the tasks started in this session (module-scoped, per engine instance).
const tasks = new Map()

export default async ({ client }) => ({
	tool: {
		spawn_task: tool({
			description:
				"Start a long-running job as a BACKGROUND task that runs on its own while you keep working. Use it for big, self-contained work — run and fix the whole test suite, a large refactor, a broad investigation across the codebase. It returns a task id; check progress with task_output, list them with list_tasks, cancel with stop_task. For quick work, just do it directly instead of spawning a task.",
			args: {
				title: z.string().describe("Short label for the task (shows in the sidebar)"),
				prompt: z
					.string()
					.describe(
						"The full, self-contained instruction for the background task — it runs in its own session and can't see this conversation, so include everything it needs.",
					),
			},
			execute: async (args) => {
				const created = await client.session.create({ title: args.title })
				const session = created?.data
				if (!session?.id)
					return `Could not start the task${created?.error ? `: ${JSON.stringify(created.error)}` : "."}`
				// Fire the run WITHOUT awaiting → it processes on the server in the
				// background while this tool returns immediately.
				client.session
					.promptAsync({
						sessionID: session.id,
						agent: "build",
						parts: [{ type: "text", text: args.prompt }],
					})
					.catch(() => {})
				tasks.set(session.id, { title: args.title, startedAt: Date.now() })
				return `Started background task "${args.title}" (id: ${session.id}). It runs while you keep working. Use task_output to read its progress, list_tasks to see all tasks, stop_task to cancel.`
			},
		}),

		list_tasks: tool({
			description: "List the background tasks started this session, with their ids and titles.",
			args: {},
			execute: async () => {
				if (tasks.size === 0) return "No background tasks started this session."
				const now = Date.now()
				const lines = []
				for (const [id, t] of tasks) {
					const mins = Math.round((now - t.startedAt) / 60000)
					lines.push(`- ${id} — "${t.title}" (started ${mins}m ago)`)
				}
				return lines.join("\n")
			},
		}),

		task_output: tool({
			description:
				"Read the latest output/progress of a background task by id (its most recent assistant response).",
			args: { id: z.string().describe("The task id from spawn_task / list_tasks") },
			execute: async (args) => {
				try {
					const res = await client.session.messages({ sessionID: args.id })
					const msgs = res?.data ?? []
					const assistants = msgs.filter((m) => (m.info || m).role === "assistant")
					const last = assistants[assistants.length - 1]
					const text = (last?.parts ?? [])
						.filter((p) => p.type === "text")
						.map((p) => p.text || "")
						.join("\n")
						.trim()
					if (!text) return "No output yet — the task may still be starting up."
					return text.length > 4000 ? `…${text.slice(-4000)}` : text
				} catch (e) {
					return `Could not read task ${args.id}: ${String(e)}`
				}
			},
		}),

		stop_task: tool({
			description: "Cancel a running background task by id.",
			args: { id: z.string().describe("The task id to stop") },
			execute: async (args) => {
				try {
					await client.session.abort({ sessionID: args.id })
					tasks.delete(args.id)
					return `Stopped task ${args.id}.`
				} catch (e) {
					return `Could not stop task ${args.id}: ${String(e)}`
				}
			},
		}),
	},
})
