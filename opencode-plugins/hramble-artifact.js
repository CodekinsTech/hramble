// Hramble artifact — render generated HTML in the visible browser pane so the
// user immediately SEES what the agent built (a UI, a page, a chart, a report).
//
// Reuses the browser bridge (the app's local HTTP server whose port is written to
// ~/.config/opencode/.hramble-browser-port). The agent calls `artifact` with HTML;
// the app renders it in the pane the user watches.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

const PORT_FILE = path.join(homedir(), ".config", "opencode", ".hramble-browser-port")

function getPort() {
	try {
		const p = Number.parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10)
		return Number.isFinite(p) && p > 0 ? p : null
	} catch {
		return null
	}
}

export default async () => ({
	tool: {
		artifact: tool({
			description:
				"Render a self-contained HTML page in Hramble's visible preview pane so the user can see it immediately. Use this to show generated UIs, landing pages, charts, diagrams, dashboards, or formatted reports. The HTML must be self-contained (inline CSS/JS; no external network requests). For plain code changes to project files, use write/edit instead — this is for showing a rendered result.",
			args: {
				title: z.string().describe("Short title for the artifact (shown in the pane)"),
				html: z
					.string()
					.describe("A complete, self-contained HTML document to render (inline all CSS/JS)"),
			},
			execute: async (args) => {
				const port = getPort()
				if (!port)
					return "The Hramble preview isn't available (is the Hramble desktop app running?)."
				try {
					const res = await fetch(`http://127.0.0.1:${port}/browser`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "artifact", html: args.html, title: args.title }),
					})
					const data = await res.json()
					if (!data?.ok) return `Artifact error: ${data?.error ?? "unknown"}`
					return `Rendered "${args.title}" in the preview pane.`
				} catch (e) {
					return `Could not reach the Hramble preview: ${String(e)}`
				}
			},
		}),
	},
})
