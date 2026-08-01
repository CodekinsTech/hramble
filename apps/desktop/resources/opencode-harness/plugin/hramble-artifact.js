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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Minimal, dependency-free markdown → HTML (headings, bold/italic, code, code
// blocks, lists, links, rules, paragraphs). Enough for reports and notes.
function mdToHtml(md) {
	const lines = String(md).split("\n")
	let html = "",
		inCode = false,
		inList = false
	const code = []
	const flushList = () => {
		if (inList) {
			html += "</ul>"
			inList = false
		}
	}
	const inline = (t) =>
		esc(t)
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/\*([^*]+)\*/g, "<em>$1</em>")
			.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			if (inCode) {
				html += `<pre><code>${esc(code.join("\n"))}</code></pre>`
				code.length = 0
				inCode = false
			} else {
				flushList()
				inCode = true
			}
			continue
		}
		if (inCode) {
			code.push(line)
			continue
		}
		const h = line.match(/^(#{1,6})\s+(.*)$/)
		if (h) {
			flushList()
			html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`
			continue
		}
		if (/^\s*[-*]\s+/.test(line)) {
			if (!inList) {
				html += "<ul>"
				inList = true
			}
			html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`
			continue
		}
		if (/^\s*---\s*$/.test(line)) {
			flushList()
			html += "<hr>"
			continue
		}
		if (line.trim() === "") {
			flushList()
			continue
		}
		flushList()
		html += `<p>${inline(line)}</p>`
	}
	if (inCode) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`
	flushList()
	return html
}

function renderMarkdown(title, md) {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
	body{font-family:-apple-system,system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a1a1a}
	h1,h2,h3{line-height:1.25} code{background:#f2f2f2;padding:2px 5px;border-radius:4px;font-size:.9em}
	pre{background:#1a1a1a;color:#eee;padding:14px;border-radius:8px;overflow:auto} pre code{background:none;color:inherit}
	a{color:#2563eb} hr{border:none;border-top:1px solid #ddd;margin:24px 0}
	@media(prefers-color-scheme:dark){body{background:#111;color:#eee}code{background:#333}}
	</style></head><body>${mdToHtml(md)}</body></html>`
}

export default async () => ({
	tool: {
		artifact: tool({
			description:
				"Render content in Hramble's visible preview pane so the user sees it immediately. Set `type` to 'html' for a complete self-contained HTML document (inline all CSS/JS, no external requests) — use for UIs, landing pages, charts, diagrams, dashboards. Set `type` to 'markdown' to render a formatted document (headings, lists, code blocks, links) — use for reports, summaries, and explanations you want shown nicely. Calling it again replaces the current preview. For changes to the user's actual project files, use write/edit instead.",
			args: {
				title: z.string().describe("Short title for the artifact (shown in the pane)"),
				content: z
					.string()
					.describe("The document to render — a full self-contained HTML page, or markdown text (per `type`)"),
				type: z
					.enum(["html", "markdown"])
					.optional()
					.describe("How to render `content` (default: html)"),
			},
			execute: async (args) => {
				const port = getPort()
				if (!port)
					return "The Hramble preview isn't available (is the Hramble desktop app running?)."
				const html = args.type === "markdown" ? renderMarkdown(args.title, args.content) : args.content
				try {
					const res = await fetch(`http://127.0.0.1:${port}/browser`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "artifact", html, title: args.title }),
					})
					const data = await res.json()
					if (!data?.ok) return `Artifact error: ${data?.error ?? "unknown"}`
					return `Rendered "${args.title}" (${args.type ?? "html"}) in the preview pane.`
				} catch (e) {
					return `Could not reach the Hramble preview: ${String(e)}`
				}
			},
		}),
	},
})
