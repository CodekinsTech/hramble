// Supertonic TTS wrapper — dynamic-imports the served engine + ONNX models
// (in public/supertonic) and plays speech, exposing a live mouth level for lipsync.

const BASE = "/supertonic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mod: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tts: any = null
let _ep: "webgpu" | "wasm" = "wasm"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _styles: Record<string, Promise<any>> = {}
let _ctx: AudioContext | null = null
let _initPromise: Promise<unknown> | null = null

// Shared state VrmStage reads each frame to drive the mouth (0 = closed, 1 = open).
export const lipsync = { level: 0, speaking: false }

async function initTTS() {
	if (_tts) return _tts
	if (_initPromise) return _initPromise
	_initPromise = (async () => {
		_mod = await import(/* @vite-ignore */ `${BASE}/supertonic.js`)
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const gpu = (navigator as any).gpu
			if (gpu && (await gpu.requestAdapter())) _ep = "webgpu"
		} catch {
			_ep = "wasm"
		}
		const res = await _mod.loadTextToSpeech(`${BASE}/onnx`, {
			executionProviders: [_ep],
			graphOptimizationLevel: "all",
		})
		_tts = res.textToSpeech
		return _tts
	})()
	return _initPromise
}

async function loadVoice(name: string) {
	if (!_styles[name]) {
		_styles[name] = initTTS().then(() =>
			_mod.loadVoiceStyle([`${BASE}/voice_styles/${name}.json`], false),
		)
	}
	return _styles[name]
}

/** Warm up the engine + voice ahead of first speak (models are ~380MB). */
export function warmupTTS(voice = "F1") {
	loadVoice(voice).catch(() => {})
}

export async function speak(
	text: string,
	opts: { voice?: string; lang?: string; onEnd?: () => void } = {},
): Promise<void> {
	if (!text?.trim()) return
	const tts = await initTTS()
	const style = await loadVoice(opts.voice || "F1")
	const lang = opts.lang || "en"
	const steps = _ep === "webgpu" ? 6 : 5

	const { wav } = await tts.call(text, lang, style, steps, 1.0, 0.3, null)
	const sr = tts.sampleRate as number

	if (!_ctx) _ctx = new AudioContext()
	if (_ctx.state === "suspended") await _ctx.resume()

	const buf = _ctx.createBuffer(1, wav.length, sr)
	const ch = buf.getChannelData(0)
	for (let i = 0; i < wav.length; i++) ch[i] = wav[i] || 0

	const src = _ctx.createBufferSource()
	src.buffer = buf
	const analyser = _ctx.createAnalyser()
	analyser.fftSize = 256
	src.connect(analyser)
	analyser.connect(_ctx.destination)

	const data = new Uint8Array(analyser.frequencyBinCount)
	let raf = 0
	const tick = () => {
		analyser.getByteTimeDomainData(data)
		let sum = 0
		for (let i = 0; i < data.length; i++) {
			const v = (data[i] - 128) / 128
			sum += v * v
		}
		lipsync.level = Math.min(1, Math.sqrt(sum / data.length) * 3.2)
		raf = requestAnimationFrame(tick)
	}

	lipsync.speaking = true
	src.onended = () => {
		cancelAnimationFrame(raf)
		lipsync.level = 0
		lipsync.speaking = false
		opts.onEnd?.()
	}
	src.start()
	tick()
}
