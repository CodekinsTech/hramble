import fs from "node:fs"
import path from "node:path"
import { truncateOutput } from "./limits.js"

/** An attachment: a bare file path, or the desktop UI's file-part shape. */
export type Attachment = string | { filename?: string; mime?: string; url?: string }

const MAX_ATTACHMENT_CHARS = 30_000

function isImageMime(mime?: string, name?: string): boolean {
	if (mime?.startsWith("image/")) return true
	return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name ?? "")
}

/** Read one attachment's text, or return an image/binary placeholder note. */
function readAttachment(att: Attachment, directory: string): string {
	const filename = typeof att === "string" ? att : (att.filename ?? att.url ?? "attachment")
	const mime = typeof att === "string" ? undefined : att.mime
	const source = typeof att === "string" ? att : (att.url ?? att.filename ?? "")

	if (isImageMime(mime, filename)) {
		return `<attachment name="${filename}" type="image">\n[Image attachments require a vision-capable model — not included as text.]\n</attachment>`
	}

	try {
		let content: string
		if (source.startsWith("data:")) {
			// data:<mime>;base64,<payload>
			const comma = source.indexOf(",")
			const meta = source.slice(5, comma)
			const payload = source.slice(comma + 1)
			content = meta.includes("base64")
				? Buffer.from(payload, "base64").toString("utf-8")
				: decodeURIComponent(payload)
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
 * Build a context block from attachments to prepend to the user's prompt, so
 * the model sees the referenced file contents (like an @-file mention).
 * Returns "" when there are no attachments.
 */
export function buildAttachmentContext(attachments: Attachment[] | undefined, directory: string): string {
	if (!attachments?.length) return ""
	const blocks = attachments.map((a) => readAttachment(a, directory))
	return `The user attached the following for context:\n\n${blocks.join("\n\n")}\n\n`
}
