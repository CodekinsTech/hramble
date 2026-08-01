// Hramble workflow — run several independent sub-tasks IN PARALLEL, each in its own
// agent session, then return all their results together. Built on the engine's own
// session API (no cloud): awaiting promptAsync resolves when that turn finishes, so
// Promise.all fans them out and waits for all to complete.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

async function runOne(client, task) {
	try {
		const created = await client.session.create({ title: task.slice(0, 50) })
		const id = created?.data?.id
		if (!id) return { task, error: "could not create session" }
		try {
			await client.session.promptAsync({
				sessionID: id,
				agent: "build",
				parts: [{ type: "text", text: task }],
			})
		} catch {
			/* fall through and read whatever output exists */
		}
		const res = await client.session.messages({ sessionID: id })
		const msgs = res?.data ?? []
		const assistants = msgs.filter((m) => (m.info || m).role === "assistant")
		const last = assistants[assistants.length - 1]
		const text = (last?.parts ?? [])
			.filter((p) => p.type === "text")
			.map((p) => p.text || "")
			.join("\n")
			.trim()
		return { task, id, result: text || "(no output)" }
	} catch (e) {
		return { task, error: String(e) }
	}
}

export default async ({ client }) => ({
	tool: {
		run_parallel: tool({
			description:
				"Run several INDEPENDENT sub-tasks in parallel, each in its own agent session, then return all their results together. Use for comprehensive work you can split into pieces that don't depend on each other — investigate N modules at once, try M approaches and compare, review several files in parallel. Each sub-task runs in isolation (it can't see the others or this conversation), so make every prompt fully self-contained. Do NOT use it for steps that depend on each other's output — do those in order yourself.",
			args: {
				tasks: z
					.array(z.string())
					.min(2)
					.max(8)
					.describe(
						"The independent sub-task prompts to run in parallel (2-8). Each must be self-contained.",
					),
			},
			execute: async (args) => {
				const results = await Promise.all(
					args.tasks.map((t) => runOne(client, t).catch((e) => ({ task: t, error: String(e) }))),
				)
				return results
					.map(
						(r, i) =>
							`### Sub-task ${i + 1}${r.error ? ` — ERROR: ${r.error}` : ""}\n${r.result ?? ""}`,
					)
					.join("\n\n")
			},
		}),

		run_pipeline: tool({
			description:
				"Run sub-tasks in SEQUENCE as a pipeline, passing each stage's result into the next. Use for multi-step work where a later step needs an earlier step's output — e.g. 'investigate the bug' → 'given those findings, write the fix' → 'verify the fix'. Each stage runs in its own session; the previous stage's output is handed to the next. For independent work that does NOT chain, use run_parallel instead.",
			args: {
				stages: z
					.array(z.string())
					.min(2)
					.max(6)
					.describe(
						"The pipeline stages in order (2-6). Each stage's instruction; the previous stage's output is appended to the next stage's prompt.",
					),
			},
			execute: async (args) => {
				let carry = ""
				const outputs = []
				for (let i = 0; i < args.stages.length; i++) {
					const prompt =
						i === 0
							? args.stages[i]
							: `${args.stages[i]}\n\n--- Output of the previous stage ---\n${carry}`
					const r = await runOne(client, prompt)
					carry = r.result ?? r.error ?? ""
					outputs.push(`### Stage ${i + 1}${r.error ? ` — ERROR: ${r.error}` : ""}\n${carry}`)
					if (r.error) break // stop the pipeline if a stage fails
				}
				return outputs.join("\n\n")
			},
		}),
	},
})
