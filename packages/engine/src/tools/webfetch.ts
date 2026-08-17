import dnsp from "node:dns/promises"
import net from "node:net"
import { truncateOutput } from "../limits.js"

export interface WebFetchInput {
	url: string
}

const TIMEOUT_MS = 15_000
const MAX_BYTES = 2_000_000
const MAX_OUTPUT_CHARS = 30_000
const MAX_REDIRECTS = 5

/** True if an IP literal is loopback, private, link-local (incl. cloud metadata), or otherwise not publicly routable. */
function isBlockedIp(ip: string): boolean {
	const v = net.isIP(ip)
	if (v === 4) {
		const [a, b] = ip.split(".").map(Number)
		if (a === 127 || a === 10 || a === 0) return true // loopback, private, "this host"
		if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
		if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
		if (a === 192 && b === 168) return true // 192.168/16
		if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
		return false
	}
	if (v === 6) {
		const lower = ip.toLowerCase()
		if (lower === "::1" || lower === "::") return true // loopback / unspecified
		if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true // link-local / ULA
		if (lower.startsWith("::ffff:")) return isBlockedIp(lower.slice(7)) // IPv4-mapped
		return false
	}
	return false
}

/** Reject URLs that target the local machine or an internal network (SSRF guard). */
async function assertPublicHost(url: URL): Promise<void> {
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
		throw new Error(`Refusing to fetch internal host: ${host}`)
	}
	if (net.isIP(host)) {
		if (isBlockedIp(host)) throw new Error(`Refusing to fetch private/loopback address: ${host}`)
		return
	}
	// Resolve the name and reject if it points at an internal address (catches
	// DNS-rebinding and domains aliased to the metadata IP).
	let addrs: { address: string }[]
	try {
		addrs = await dnsp.lookup(host, { all: true })
	} catch {
		throw new Error(`Could not resolve host: ${host}`)
	}
	if (addrs.some((a) => isBlockedIp(a.address))) {
		throw new Error(`Refusing to fetch host that resolves to a private/loopback address: ${host}`)
	}
}

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
		// Follow redirects manually so every hop is re-validated against SSRF
		// (a public URL can 30x-redirect to the metadata endpoint).
		let current = url
		let res: Response
		for (let hop = 0; ; hop++) {
			await assertPublicHost(current)
			res = await fetch(current, {
				signal: controller.signal,
				redirect: "manual",
				headers: { "User-Agent": "HrambleEngine/0.1" },
			})
			if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
				if (hop >= MAX_REDIRECTS) return `Too many redirects for ${url.href}`
				current = new URL(res.headers.get("location") as string, current)
				if (current.protocol !== "http:" && current.protocol !== "https:") {
					return `Refusing redirect to unsupported protocol: ${current.protocol}`
				}
				continue
			}
			break
		}

		const type = res.headers.get("content-type") ?? ""
		if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${current.href}`

		// Stream and stop at the byte cap so a huge/endless response can't OOM us.
		const body = await readCapped(res, MAX_BYTES)

		if (type.includes("text/html")) {
			return truncateOutput(htmlToText(body), MAX_OUTPUT_CHARS) || "(empty page)"
		}
		if (type.includes("json") || type.includes("text/") || type.includes("xml") || type.includes("javascript")) {
			return truncateOutput(body, MAX_OUTPUT_CHARS) || "(empty response)"
		}
		return `Fetched ${current.href} (${type || "unknown type"}) — non-text content not shown.`
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return `Request timed out after ${TIMEOUT_MS / 1000}s: ${url.href}`
		return `Failed to fetch ${url.href}: ${err instanceof Error ? err.message : String(err)}`
	} finally {
		clearTimeout(timer)
	}
}

/** Read a response body up to maxBytes, cancelling the stream once the cap is hit. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
	if (!res.body) return await res.text()
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let received = 0
	while (received < maxBytes) {
		const { done, value } = await reader.read()
		if (done) break
		if (value) {
			chunks.push(value)
			received += value.byteLength
		}
	}
	try {
		await reader.cancel()
	} catch {
		// ignore
	}
	return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes))
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
