// Hramble schedule_wakeup — resume a task later (one-shot). Runs in the persistent
// engine process via setTimeout, then starts a new session with the given prompt.
// For recurring schedules, use Automations instead.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

const wakeups = new Map() // id -> timer
let counter = 0

export default async ({ client }) => ({
	tool: {
		schedule_wakeup: tool({
			description:
				"Schedule the agent to resume a task after a delay (one-shot). Use to come back to something later — check on a deploy in 10 minutes, retry after a cooldown, follow up on a long process. It runs the given prompt in a new session when the delay elapses. For recurring/cron schedules, use Automations.",
			args: {
				delay_seconds: z.number().min(1).describe("How long to wait before running, in seconds"),
				prompt: z
					.string()
					.describe("Self-contained instruction to run when the delay elapses"),
			},
			execute: async (args) => {
				const id = `wake${++counter}`
				const timer = setTimeout(async () => {
					wakeups.delete(id)
					try {
						const s = await client.session.create({ title: `wakeup: ${args.prompt}`.slice(0, 50) })
						if (s?.data?.id)
							client.session
								.promptAsync({
									sessionID: s.data.id,
									agent: "build",
									parts: [{ type: "text", text: args.prompt }],
								})
								.catch(() => {})
					} catch {
						/* ignore */
					}
				}, args.delay_seconds * 1000)
				// Don't keep the process alive just for this timer.
				if (typeof timer.unref === "function") timer.unref()
				wakeups.set(id, timer)
				return `Scheduled a wakeup in ${args.delay_seconds}s (id: ${id}). It will run your instruction in a new session then. Use cancel_wakeup to cancel.`
			},
		}),

		cancel_wakeup: tool({
			description: "Cancel a scheduled wakeup.",
			args: { id: z.string().describe("The wakeup id") },
			execute: async (args) => {
				const t = wakeups.get(args.id)
				if (!t) return `No wakeup ${args.id}.`
				clearTimeout(t)
				wakeups.delete(args.id)
				return `Cancelled wakeup ${args.id}.`
			},
		}),
	},
})
