import { FilePicker } from "@capawesome/capacitor-file-picker"

/**
 * File attach for the composer — wraps @capawesome/capacitor-file-picker
 * (MIT, pinned to the 7.x line to match this app's Capacitor 7; the @8 line
 * requires Capacitor 8).
 *
 * `pickFiles({ readData: true })` does the system file pick *and* the native
 * base64 read in a single round trip — this plugin has no separate
 * "peek the size, then optionally read" call. Prompting the system picker
 * twice (pick once to check size, pick again to read) would risk reading
 * back a *different* file than the one that was measured, so instead the
 * 700 KB raw-size cap below is enforced immediately after the one read
 * completes and before the result is ever turned into a `data:` URL or
 * handed back to the caller — an oversized file's base64 is discarded on
 * the spot and never reaches the composer, let alone the relay.
 *
 * Why 700 KB: base64 adds ~33% size overhead, plus a little more for the
 * JSON envelope the relay message rides in. Cloudflare Durable Object
 * WebSocket messages have roughly a 1 MiB ceiling, so 700 KB raw keeps the
 * encoded attachment safely under that with margin. No chunking or
 * resumable upload is implemented — this cap is the entire size-limit
 * strategy for attach.
 */

const MAX_RAW_BYTES = 700 * 1024

export interface PendingFileAttachment {
	mime: string
	filename?: string
	url: string
}

export type AttachFileOutcome =
	| { kind: "attached"; file: PendingFileAttachment }
	| "cancelled"
	| "too-large"
	| "permission-denied"
	| { error: string }

/** Opens the system file picker, reads the chosen file as base64, and
 *  enforces the size cap. Resolves — never throws — with a discriminated
 *  outcome the caller can render directly (mirrors voiceInput.ts's
 *  VoiceStartOutcome pattern). */
export async function pickAndReadFile(): Promise<AttachFileOutcome> {
	try {
		const result = await FilePicker.pickFiles({ limit: 1, readData: true })
		const picked = result.files[0]
		if (!picked || !picked.data) return { error: "no file data was returned" }

		// Prefer the plugin's own reported byte size; fall back to decoding the
		// base64 length (base64 is ~4/3 the size of the raw bytes) if it's absent.
		const sizeBytes = picked.size ?? Math.floor((picked.data.length * 3) / 4)
		if (sizeBytes > MAX_RAW_BYTES) return "too-large"

		const mime = picked.mimeType || "application/octet-stream"
		return {
			kind: "attached",
			file: {
				mime,
				filename: picked.name,
				url: `data:${mime};base64,${picked.data}`,
			},
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (message.toLowerCase().includes("cancel")) return "cancelled"
		if (message.toLowerCase().includes("permission")) return "permission-denied"
		return { error: message }
	}
}
