// Vosk STT — real-time, offline mic transcription. Reuses AvatarBox's models.
// Engine loads via a UMD script tag (window.Vosk); models served from public/vosk.

const BASE = "/vosk"
const MODELS = {
	en: `${BASE}/vosk-model-small-en-us-0.15.tar.gz`,
	hi: `${BASE}/vosk-model-small-hi-0.22.tar.gz`,
}
export type SttLang = keyof typeof MODELS

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let libPromise: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
let modelLang: SttLang | "" = ""

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadLib(): Promise<any> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any
	if (w.Vosk) return Promise.resolve(w.Vosk)
	if (libPromise) return libPromise
	libPromise = new Promise((resolve, reject) => {
		const s = document.createElement("script")
		s.src = `${BASE}/vosk.js`
		s.onload = () => resolve(w.Vosk)
		s.onerror = () => reject(new Error("vosk.js failed to load"))
		document.body.appendChild(s)
	})
	return libPromise
}

async function getModel(lang: SttLang) {
	if (model && modelLang === lang) return model
	const V = await loadLib()
	model = await V.createModel(MODELS[lang])
	modelLang = lang
	return model
}

export function warmupVosk(lang: SttLang = "en") {
	getModel(lang).catch(() => {})
}

export interface SttHandle {
	stop: () => void
}

export async function startVosk(opts: {
	lang?: SttLang
	onPartial?: (text: string) => void
	onFinal?: (text: string) => void
}): Promise<SttHandle> {
	const lang = opts.lang || "en"
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
		video: false,
	})
	const m = await getModel(lang)
	const ctx = new AudioContext()
	const rec = new m.KaldiRecognizer(ctx.sampleRate)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rec.on("partialresult", (msg: any) => {
		const p = msg?.result?.partial
		if (p) opts.onPartial?.(p)
	})
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rec.on("result", (msg: any) => {
		const t = msg?.result?.text
		if (t) opts.onFinal?.(t)
	})
	const source = ctx.createMediaStreamSource(stream)
	const proc = ctx.createScriptProcessor(4096, 1, 1)
	proc.onaudioprocess = (e) => {
		try {
			rec.acceptWaveform(e.inputBuffer)
		} catch {
			/* ignore per-frame errors */
		}
	}
	source.connect(proc)
	proc.connect(ctx.destination)

	return {
		stop: () => {
			try {
				proc.disconnect()
				source.disconnect()
			} catch {
				/* ignore */
			}
			stream.getTracks().forEach((t) => t.stop())
			ctx.close().catch(() => {})
		},
	}
}

/** Inject transcribed text into the live chat textarea (React-safe). */
export function injectIntoChatInput(text: string): boolean {
	const areas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).filter(
		(t) => t.offsetParent !== null,
	)
	const ta = areas[areas.length - 1]
	if (!ta) return false
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
	const next = (ta.value ? `${ta.value} ` : "") + text
	setter?.call(ta, next)
	ta.dispatchEvent(new Event("input", { bubbles: true }))
	ta.focus()
	return true
}
