import { truncateOutput } from "../limits.js"

export interface WebFetchInput {
	url: string
}

const TIMEOUT_MS = 15_000
const MAX_BYTES = 2_000_000
const MAX_OUTPUT_CHARS = 30_000

/** Strip HTML to readable-ish text (no external deps). */
function htmlToText(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim()
}

export async function webFetch(input: WebFetchInput): Promise<string> {
	let url: URL
	try {
		url = new URL(input.url)
	} catch {
		return `Invalid URL: ${input.url}`
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return `Unsupported protocol: ${url.protocol} (only http/https)`
	}

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			redirect: "follow",
			headers: { "User-Agent": "HrambleEngine/0.1 (+https://localhost)" },
		})
		const type = res.headers.get("content-type") ?? ""
		if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${url.href}`

		const buf = await res.arrayBuffer()
		const clipped = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
		const body = new TextDecoder("utf-8").decode(clipped)

		if (type.includes("text/html")) {
			return truncateOutput(htmlToText(body), MAX_OUTPUT_CHARS) || "(empty page)"
		}
		if (type.includes("json") || type.includes("text/") || type.includes("xml") || type.includes("javascript")) {
			return truncateOutput(body, MAX_OUTPUT_CHARS) || "(empty response)"
		}
		return `Fetched ${url.href} (${type || "unknown type"}, ${buf.byteLength} bytes) — non-text content not shown.`
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return `Request timed out after ${TIMEOUT_MS / 1000}s: ${url.href}`
		return `Failed to fetch ${url.href}: ${err instanceof Error ? err.message : String(err)}`
	} finally {
		clearTimeout(timer)
	}
}

export const webFetchToolDefinition = {
	name: "webfetch",
	description:
		"Fetch a URL over http/https and return its text content (HTML is converted to readable text). Use for documentation, API responses, or reference pages. Returns text only.",
	input_schema: {
		type: "object" as const,
		properties: {
			url: { type: "string", description: "The absolute http(s) URL to fetch." },
		},
		required: ["url"],
	},
}
