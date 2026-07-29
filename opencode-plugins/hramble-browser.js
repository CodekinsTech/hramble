// Hramble browser — lets the agent drive the visible in-app browser pane.
//
// Registers a `browser` tool. It talks to the Hramble desktop app's local
// browser bridge (an HTTP server the app starts; its port is written to
// ~/.config/opencode/.hramble-browser-port). The app performs the action on the
// webview the user can see, so the agent and the user share one browser.

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
		browser: tool({
			description:
				"Control the Hramble in-app browser that the user can see. Actions: 'open' (navigate to a URL), 'read' (get the page's URL/title/visible text), 'click' (click a link/button by CSS selector or visible text), 'type' (type into a field by CSS selector, optionally submit), 'screenshot' (capture the page as a PNG file). Read the page first to find selectors/text before clicking or typing.",
			args: {
				action: z
					.enum(["open", "read", "click", "type", "screenshot"])
					.describe("What to do in the visible browser"),
				url: z.string().optional().describe("URL to open (for action 'open')"),
				selector: z
					.string()
					.optional()
					.describe("CSS selector of the target element (for 'click'/'type')"),
				text: z
					.string()
					.optional()
					.describe("For 'click': visible text to match. For 'type': the text to enter."),
				submit: z
					.boolean()
					.optional()
					.describe("For 'type': submit the form / press Enter after typing"),
			},
			execute: async (args) => {
				const port = getPort()
				if (!port)
					return "The Hramble browser isn't available (is the Hramble desktop app running?)."
				let data
				try {
					const res = await fetch(`http://127.0.0.1:${port}/browser`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(args),
					})
					data = await res.json()
				} catch (e) {
					return `Could not reach the Hramble browser bridge: ${String(e)}`
				}
				if (!data?.ok) return `Browser error: ${data?.error ?? "unknown"}`

				switch (args.action) {
					case "open":
					case "read":
						return `URL: ${data.url ?? ""}\nTitle: ${data.title ?? ""}${data.text ? `\n\n${data.text}` : ""}`
					case "click":
						return `Clicked. Now at: ${data.url ?? ""}`
					case "type":
						return `Typed into ${args.selector ?? "the field"}.${args.submit ? " Submitted." : ""} Now at: ${data.url ?? ""}`
					case "screenshot": {
						if (!data.dataUrl) return "No screenshot returned."
						const b64 = String(data.dataUrl).replace(/^data:image\/\w+;base64,/, "")
						const dir = path.join(homedir(), ".config", "opencode", "browser-shots")
						fs.mkdirSync(dir, { recursive: true })
						const file = path.join(dir, `shot-${Date.now()}.png`)
						fs.writeFileSync(file, Buffer.from(b64, "base64"))
						return `Screenshot saved to ${file} (${data.title ?? ""}). Use the read tool on it if you need to see it.`
					}
					default:
						return JSON.stringify(data)
				}
			},
		}),
	},
})
