import fs from "node:fs"
import path from "node:path"
import { truncateOutput } from "./limits.js"

/** An attachment: a bare file path, or the desktop UI's file-part shape. */
export type Attachment = string | { filename?: string; mime?: string; url?: string }

/** A decoded image ready to send to a vision model (base64, no data: prefix). */
export interface ImagePart {
	mimeType: string
	data: string
}

export interface AttachmentResult {
	/** Text context to prepend to the user's prompt (@-file style). */
	text: string
	/** Images to include as real vision blocks in the user message. */
	images: ImagePart[]
}

const MAX_ATTACHMENT_CHARS = 30_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // vision payloads over ~5MB are rejected/too costly

// Vision models accept these four; svg/bmp/etc. are handled as text or noted.
const EXT_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
}

function isImageName(name?: string): boolean {
	return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name ?? "")
}

function visionMime(mime?: string, name?: string): string | null {
	if (mime && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)) return mime
	const ext = path.extname(name ?? "").toLowerCase()
	return EXT_MIME[ext] ?? null
}

/** Decode an image attachment to base64, or null if it can't be sent as vision. */
function extractImage(source: string, mime: string | undefined, filename: string): ImagePart | { note: string } {
	try {
		if (source.startsWith("data:")) {
			const comma = source.indexOf(",")
			const meta = source.slice(5, comma) // e.g. "image/png;base64"
			const declaredMime = meta.split(";")[0]
			const vm = visionMime(declaredMime, filename)
			if (!vm || !meta.includes("base64")) return { note: `[Image "${filename}" is not a supported vision format — skipped.]` }
			const data = source.slice(comma + 1)
			if (Buffer.byteLength(data, "base64") > MAX_IMAGE_BYTES) return { note: `[Image "${filename}" is too large to send (over 5MB) — skipped.]` }
			return { mimeType: vm, data }
		}
		const resolved = path.isAbsolute(source) ? source : path.resolve(source)
		const vm = visionMime(mime, filename ?? resolved)
		if (!vm) return { note: `[Image "${filename}" is not a supported vision format (use png/jpeg/gif/webp) — skipped.]` }
		const stat = fs.statSync(resolved)
		if (stat.size > MAX_IMAGE_BYTES) return { note: `[Image "${filename}" is too large to send (over 5MB) — skipped.]` }
		const data = fs.readFileSync(resolved).toString("base64")
		return { mimeType: vm, data }
	} catch (err) {
		return { note: `[Could not read image "${filename}": ${err instanceof Error ? err.message : String(err)}]` }
	}
}

/** Read one non-image attachment's text into an @-file style block. */
function readTextAttachment(source: string, filename: string, directory: string): string {
	try {
		let content: string
		if (source.startsWith("data:")) {
			const comma = source.indexOf(",")
			const meta = source.slice(5, comma)
			const payload = source.slice(comma + 1)
			content = meta.includes("base64") ? Buffer.from(payload, "base64").toString("utf-8") : decodeURIComponent(payload)
		} else {
			const resolved = path.isAbsolute(source) ? source : path.resolve(directory, source)
			content = fs.readFileSync(resolved, "utf-8")
		}
		return `<attachment name="${filename}">\n${truncateOutput(content, MAX_ATTACHMENT_CHARS)}\n</attachment>`
	} catch (err) {
		return `<attachment name="${filename}">\n[Could not read attachment: ${err instanceof Error ? err.message : String(err)}]\n</attachment>`
	}
}

/**
 * Turn attachments into (a) text context to prepend and (b) real image parts
 * for vision. Images become actual vision blocks in the user message (the one
 * place both Anthropic and OpenAI-compat accept them); text files are inlined.
 */
export function buildAttachments(attachments: Attachment[] | undefined, directory: string): AttachmentResult {
	if (!attachments?.length) return { text: "", images: [] }

	const textBlocks: string[] = []
	const images: ImagePart[] = []

	for (const att of attachments) {
		const filename = typeof att === "string" ? att : (att.filename ?? att.url ?? "attachment")
		const mime = typeof att === "string" ? undefined : att.mime
		const source = typeof att === "string" ? att : (att.url ?? att.filename ?? "")

		if (mime?.startsWith("image/") || isImageName(filename)) {
			const result = extractImage(source, mime, filename)
			if ("note" in result) textBlocks.push(`<attachment name="${filename}" type="image">\n${result.note}\n</attachment>`)
			else images.push(result)
			continue
		}
		textBlocks.push(readTextAttachment(source, filename, directory))
	}

	const text = textBlocks.length ? `The user attached the following for context:\n\n${textBlocks.join("\n\n")}\n\n` : ""
	return { text, images }
}
