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
// Fixed port for the "Hramble Console Bridge" Chrome extension — unlike the
// embedded-pane bridge above, a Chrome extension can't read a port file off
// disk, so this one is a well-known constant instead (see
// apps/desktop/src/main/extension-bridge.ts and apps/chrome-extension).
const EXTENSION_BRIDGE_PORT = 47821

function formatConsoleEntries(entries) {
	if (entries.length === 0) return "No console output since the page last loaded — nothing logged."
	const lines = entries.map((e) => {
		const tag = e.level === "error" ? "ERROR" : e.level === "warn" ? "WARN" : String(e.level).toUpperCase()
		const loc = e.sourceId ? ` (${e.sourceId.split("/").pop()}:${e.line ?? "?"})` : ""
		return `[${tag}]${loc} ${e.message}`
	})
	const errorCount = entries.filter((e) => e.level === "error").length
	const warnCount = entries.filter((e) => e.level === "warn").length
	const summary = `${errorCount} error(s), ${warnCount} warning(s), ${entries.length} total message(s) since the page last loaded.`
	return `${summary}\n\n${lines.join("\n")}`
}

// Actions that act on the outside world (navigate, change the page, submit).
// These are gated behind the session's permission policy so the agent asks
// before driving the browser — like Claude asking before it controls Chrome.
// Read-only actions (read/screenshot/scroll/hover/wait) never prompt.
const ACTING = new Set(["open", "click", "type", "select", "back", "forward", "extract_design"])

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
				"Control the Hramble in-app browser that the user can see. Actions: 'open' (navigate to a URL), 'read' (get the page's URL/title/visible text), 'click' (by CSS selector or visible text), 'type' (into a field by selector, optionally submit), 'screenshot' (capture a PNG), 'scroll' (scroll the page, or a selector into view), 'wait' (wait for a selector to appear, or a number of seconds), 'select' (choose an option in a <select> by value), 'hover' (hover an element to reveal menus/tooltips), 'back'/'forward' (navigate history), 'extract_design' (get the page's dominant colors, fonts with roles/weights, and image/SVG assets — use this for 'what colors/fonts does this site use' or 'build something styled like this'), 'inspect_element' (get one element's full computed style — color, font, spacing, border — by selector or visible text), 'console' (read every console.log/warn/error the page in the in-app pane has made since it last loaded), 'chrome_console' (same thing, but for a tab in the user's REAL Chrome browser — only works if they've installed the 'Hramble Console Bridge' extension; pass `url` with a substring of the page's address to pick the right tab if more than one is open, otherwise the most recently active tab is used). The user cannot read raw console output and should never be asked to open DevTools or paste errors — when you're previewing something you built (in-pane or in real Chrome) or the user says a page is broken/not working, check the console yourself, read the errors, and fix them. Read the page first to find selectors/text before acting.",
			args: {
				action: z
					.enum([
						"open",
						"read",
						"click",
						"type",
						"screenshot",
						"scroll",
						"wait",
						"select",
						"hover",
						"back",
						"forward",
						"extract_design",
						"inspect_element",
						"console",
						"chrome_console",
					])
					.describe("What to do in the visible browser"),
				url: z
					.string()
					.optional()
					.describe(
						"URL to open (for action 'open', or to navigate before 'extract_design'). For 'chrome_console', a substring to match against open Chrome tabs instead.",
					),
				selector: z
					.string()
					.optional()
					.describe(
						"CSS selector of the target element (for click/type/select/hover/inspect_element, and scroll/wait when targeting an element)",
					),
				text: z
					.string()
					.optional()
					.describe(
						"For 'click'/'inspect_element': visible text to match. For 'type': the text to enter.",
					),
				submit: z
					.boolean()
					.optional()
					.describe("For 'type': submit the form / press Enter after typing"),
				amount: z.number().optional().describe("For 'scroll' without a selector: pixels to scroll (default 600)"),
				seconds: z.number().optional().describe("For 'wait' without a selector: seconds to wait"),
				value: z.string().optional().describe("For 'select': the option value to choose"),
			},
			execute: async (args, context) => {
				if (args.action === "chrome_console") {
					const qs = args.url ? `?url=${encodeURIComponent(args.url)}` : ""
					let data
					try {
						const res = await fetch(`http://127.0.0.1:${EXTENSION_BRIDGE_PORT}/console/read${qs}`)
						data = await res.json()
					} catch {
						return "Could not reach Hramble (is the desktop app running?)."
					}
					if (!data?.ok) {
						return `${data?.error ?? "No connected Chrome tab found."} Make sure the "Hramble Console Bridge" extension is installed and the tab is open (Settings → Chrome Console Access).`
					}
					return `Tab: ${data.title ?? ""} (${data.url ?? ""})\n\n${formatConsoleEntries(data.entries ?? [])}`
				}

				const port = getPort()
				if (!port)
					return "The Hramble browser isn't available (is the Hramble desktop app running?)."

				// Ask before acting on a page. `context.ask` raises a real permission
				// request that the session's mode policy answers (allow/ask/deny) and
				// that surfaces in the same permission card + OS notification. Guarded
				// so it's a no-op on engines that don't provide `ask`.
				if (ACTING.has(args.action) && typeof context?.ask === "function") {
					try {
						await context.ask({
							permission: "browser",
							patterns: [args.action],
							always: ["browser"],
							metadata: {
								action: args.action,
								url: args.url,
								selector: args.selector,
								text: args.text,
							},
						})
					} catch {
						return `Browser '${args.action}' was declined by the user.`
					}
				}

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
					case "scroll":
						return "Scrolled."
					case "wait":
						return "Done waiting."
					case "select":
						return `Selected ${args.value ?? ""} in ${args.selector ?? "the dropdown"}.`
					case "hover":
						return `Hovering ${args.selector ?? "the element"}.`
					case "back":
					case "forward":
						return `Navigated ${args.action}. Now at: ${data.url ?? ""}`
					case "console":
						return formatConsoleEntries(Array.isArray(data.entries) ? data.entries : [])
					default:
						return JSON.stringify(data)
				}
			},
		}),
	},
})
