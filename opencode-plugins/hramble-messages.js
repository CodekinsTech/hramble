// Hramble messages — same-machine agent-to-agent messaging via a shared file inbox.
// Lets parallel/background agents coordinate: one leaves a note in a named box, the
// other reads it. (The off-machine / cross-network version needs the cloud runtime;
// this is the local coordination layer.)

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

const DIR = path.join(homedir(), ".config", "opencode", "messages")
const box = (name) => path.join(DIR, `${String(name).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "default"}.jsonl`)

export default async () => ({
	tool: {
		send_message: tool({
			description:
				"Leave a message for another agent/task in a named inbox (same machine). Use to coordinate with a background task or a parallel run — e.g. post a result, a hand-off, or a heads-up that another agent can read with read_messages. For cross-machine messaging you'd need the cloud runtime.",
			args: {
				to: z.string().describe("Name of the inbox to post to (any label both sides agree on)"),
				message: z.string().describe("The message body"),
				from: z.string().optional().describe("Optional sender label"),
			},
			execute: async (args) => {
				try {
					fs.mkdirSync(DIR, { recursive: true })
					const line = JSON.stringify({ from: args.from ?? "agent", message: args.message }) + "\n"
					fs.appendFileSync(box(args.to), line)
					return `Message posted to inbox "${args.to}".`
				} catch (e) {
					return `Could not send: ${String(e)}`
				}
			},
		}),

		read_messages: tool({
			description:
				"Read messages from a named inbox (same machine). Use to pick up notes left by another agent/task. Optionally clear them after reading.",
			args: {
				inbox: z.string().describe("Name of the inbox to read"),
				clear: z.boolean().optional().describe("Delete the messages after reading (default false)"),
			},
			execute: async (args) => {
				try {
					const f = box(args.inbox)
					if (!fs.existsSync(f)) return `Inbox "${args.inbox}" is empty.`
					const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean)
					if (args.clear) fs.rmSync(f, { force: true })
					if (!lines.length) return `Inbox "${args.inbox}" is empty.`
					return lines
						.map((l, i) => {
							try {
								const m = JSON.parse(l)
								return `${i + 1}. [${m.from}] ${m.message}`
							} catch {
								return `${i + 1}. ${l}`
							}
						})
						.join("\n")
				} catch (e) {
					return `Could not read: ${String(e)}`
				}
			},
		}),
	},
})
