import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "jotai"
import { AVATARS, type AvatarKey, VrmStage } from "./vrm-stage"
import { speak, warmupTTS } from "../tts/supertonic"
import { anyBusyAtom } from "../atoms/sessions"
import { type SttHandle, injectIntoChatInput, startVosk, warmupVosk } from "../stt/vosk"

const DONE_PHRASES = [
	"All done — your code is ready.",
	"Finished! Take a look.",
	"Done. I've made the changes.",
	"That's ready for you.",
]

const PopOutIcon = () => (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
		<path d="M15 3h6v6" />
		<path d="M10 14 21 3" />
		<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
	</svg>
)
const DockIcon = () => (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 21H5a2 2 0 0 1-2-2v-4" />
		<path d="M3 21 10 14" />
		<path d="M10 21H3v-7" />
	</svg>
)

/**
 * Hramble avatar companion — a live VRM avatar (Flora / Libo) in a box near
 * New Session. One click pops it out into a floating, draggable card.
 */
export function HrambleAvatar() {
	const [floating, setFloating] = useState(false)
	const [pos, setPos] = useState({ x: 320, y: 120 })
	const [avatar, setAvatar] = useState<AvatarKey>("flora")
	const [speaking, setSpeaking] = useState(false)
	const [muted, setMuted] = useState(false)
	const [listening, setListening] = useState(false)
	const [perched, setPerched] = useState(false)
	const sttRef = useRef<SttHandle | null>(null)
	const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

	// Track perch state so the box hides its avatar while she's out perching.
	useEffect(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (window as any).palot?.onPerchActive?.((active: boolean) => setPerched(active))
	}, [])

	// ESC from the main window docks her back (escape hatch if the perch hangs).
	useEffect(() => {
		if (!perched) return
		const onKey = (e: KeyboardEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (e.key === "Escape") (window as any).palot?.perchStop?.()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [perched])

	const togglePerch = () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const p = (window as any).palot
		if (perched) p?.perchStop?.()
		else p?.perchStart?.(avatar, true)
	}

	// Warm up the TTS + STT models (they are large) so first use is snappy.
	useEffect(() => {
		warmupTTS(AVATARS[avatar].voice)
	}, [avatar])
	useEffect(() => {
		warmupVosk("en")
		return () => sttRef.current?.stop()
	}, [])

	const toggleMic = async () => {
		if (listening) {
			sttRef.current?.stop()
			sttRef.current = null
			setListening(false)
			return
		}
		try {
			setListening(true)
			sttRef.current = await startVosk({
				lang: "en",
				onFinal: (text) => injectIntoChatInput(text),
			})
		} catch {
			setListening(false)
		}
	}

	// Narrate when the agent finishes a turn (busy -> idle).
	const anyBusy = useAtomValue(anyBusyAtom)
	const wasBusy = useRef(false)
	const phraseIdx = useRef(0)
	const mutedRef = useRef(muted)
	mutedRef.current = muted
	const avatarRef = useRef(avatar)
	avatarRef.current = avatar
	useEffect(() => {
		if (wasBusy.current && !anyBusy && !mutedRef.current) {
			const a = AVATARS[avatarRef.current]
			const phrase = DONE_PHRASES[phraseIdx.current % DONE_PHRASES.length]
			phraseIdx.current++
			setSpeaking(true)
			speak(phrase, { voice: a.voice, lang: a.lang, onEnd: () => setSpeaking(false) }).catch(() =>
				setSpeaking(false),
			)
		}
		wasBusy.current = anyBusy
	}, [anyBusy])

	const toggleMute = () => {
		setMuted((m) => {
			const next = !m
			// Unmuting → quick voice test so you know it works.
			if (!next && !speaking) {
				const a = AVATARS[avatar]
				setSpeaking(true)
				speak(`Hi! I'm ${a.name}.`, {
					voice: a.voice,
					lang: a.lang,
					onEnd: () => setSpeaking(false),
				}).catch(() => setSpeaking(false))
			}
			return next
		})
	}

	const startDrag = (e: React.PointerEvent) => {
		if (!floating) return
		drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
		const move = (ev: PointerEvent) => {
			if (!drag.current) return
			setPos({
				x: drag.current.ox + ev.clientX - drag.current.sx,
				y: drag.current.oy + ev.clientY - drag.current.sy,
			})
		}
		const up = () => {
			drag.current = null
			window.removeEventListener("pointermove", move)
			window.removeEventListener("pointerup", up)
		}
		window.addEventListener("pointermove", move)
		window.addEventListener("pointerup", up)
	}

	const body = (onToggle: () => void, docked: boolean) => (
		<div className="hramble-av-body">
			{perched ? (
				<div className="hramble-av-away">🚶 out perching…</div>
			) : (
				<div className="hramble-av-stage-wrap">
					<VrmStage avatar={avatar} mode={docked ? "box" : "float"} />
				</div>
			)}
			<div className="hramble-av-tabs" onPointerDown={(e) => e.stopPropagation()}>
				{(Object.keys(AVATARS) as AvatarKey[]).map((k) => (
					<button
						key={k}
						type="button"
						className={`hramble-av-tab${avatar === k ? " active" : ""}`}
						onClick={(e) => {
							e.stopPropagation()
							setAvatar(k)
						}}
					>
						{AVATARS[k].name}
					</button>
				))}
				<button
					type="button"
					className={`hramble-av-tab hramble-av-mic${listening ? " listening" : ""}`}
					title={listening ? "Listening — click to stop" : "Talk to Hramble (mic)"}
					onClick={(e) => {
						e.stopPropagation()
						toggleMic()
					}}
				>
					🎤
				</button>
				<button
					type="button"
					className={`hramble-av-tab${perched ? " active" : ""}`}
					title={perched ? "Dock back to the box" : "Perch — sit on window edges / dock"}
					onClick={(e) => {
						e.stopPropagation()
						togglePerch()
					}}
				>
					🪜
				</button>
				<button
					type="button"
					className={`hramble-av-tab hramble-av-speak${speaking ? " active" : ""}`}
					title={muted ? "Narration off — click to enable" : "Narration on — click to mute"}
					onClick={(e) => {
						e.stopPropagation()
						toggleMute()
					}}
				>
					{speaking ? "…" : muted ? "🔇" : "🔊"}
				</button>
			</div>
			<button
				type="button"
				className="hramble-av-btn"
				title={docked ? "Pop out — then drag me anywhere" : "Dock back to the sidebar"}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation()
					onToggle()
				}}
			>
				{docked ? <PopOutIcon /> : <DockIcon />}
			</button>
		</div>
	)

	if (!floating) {
		return <div className="hramble-av-dock">{body(() => setFloating(true), true)}</div>
	}

	return createPortal(
		<div className="hramble-av-float" style={{ left: pos.x, top: pos.y }} onPointerDown={startDrag}>
			{body(() => setFloating(false), false)}
		</div>,
		document.body,
	)
}
