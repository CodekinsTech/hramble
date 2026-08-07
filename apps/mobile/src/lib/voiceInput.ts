import type { PluginListenerHandle } from "@capacitor/core"
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition"

/**
 * Voice input for the composer — wraps @capgo/capacitor-speech-recognition
 * (MPL-2.0, actively maintained fork of capacitor-community/speech-recognition;
 * v7.x matches this app's Capacitor 7). Uses the platform's native speech
 * recognizer (Android's SpeechRecognizer / iOS's SFSpeechRecognizer), not an
 * offline WASM model — mirrors mobiledab's own finding that on Android
 * specifically, native recognition is the reliable path (Vosk WASM there
 * causes audio artifacts), so there's no reason to reach for anything else.
 *
 * Fills the composer with the *live* transcript as the user talks (via the
 * partialResults listener) so "listening…" always shows real progress, but
 * never sends automatically — the caller decides when to stop and the text
 * stays editable, same as if the user had typed it.
 */

export type VoiceStartOutcome =
	| "listening"
	| "unsupported"
	| "permission-denied"
	| { error: string }

let partialListener: PluginListenerHandle | null = null

async function ensurePermission(): Promise<boolean> {
	const current = await SpeechRecognition.checkPermissions()
	if (current.speechRecognition === "granted") return true
	const requested = await SpeechRecognition.requestPermissions()
	return requested.speechRecognition === "granted"
}

/** Starts listening; `onPartial` fires with the best-guess transcript so far
 *  every time the recognizer updates it. Call `stopVoiceListening()` to end
 *  the session — the last text `onPartial` received is the final result. */
export async function startVoiceListening(
	onPartial: (text: string) => void,
): Promise<VoiceStartOutcome> {
	try {
		const { available } = await SpeechRecognition.available()
		if (!available) return "unsupported"

		const granted = await ensurePermission()
		if (!granted) return "permission-denied"

		await partialListener?.remove()
		partialListener = await SpeechRecognition.addListener("partialResults", (event) => {
			const text = event.matches?.[0]
			if (text) onPartial(text)
		})

		// popup:false — inline recognition so the mic button itself is the UI,
		// no OS dialog stealing focus from the chat screen.
		await SpeechRecognition.start({ partialResults: true, popup: false })
		return "listening"
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) }
	}
}

export async function stopVoiceListening(): Promise<void> {
	try {
		await SpeechRecognition.stop()
	} catch {
		// Already stopped/torn down — nothing to do.
	} finally {
		await partialListener?.remove()
		partialListener = null
	}
}
