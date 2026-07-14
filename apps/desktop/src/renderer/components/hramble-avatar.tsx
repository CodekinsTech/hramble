import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import catUrl from "../hramble-cat.png"

// Pop-out (open in floating window) icon
const PopOutIcon = () => (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
		<path d="M15 3h6v6" />
		<path d="M10 14 21 3" />
		<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
	</svg>
)
// Dock-back icon
const DockIcon = () => (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 21H5a2 2 0 0 1-2-2v-4" />
		<path d="M3 21 10 14" />
		<path d="M10 21H3v-7" />
	</svg>
)

/**
 * Hramble avatar companion.
 * Docked in the sidebar by default; one click "pops it out" into a floating,
 * draggable card the user can place anywhere on the UI frame.
 */
export function HrambleAvatar() {
	const [floating, setFloating] = useState(false)
	const [pos, setPos] = useState({ x: 320, y: 120 })
	const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

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
			<img className="hramble-av-cat" src={catUrl} alt="Hramble avatar" draggable={false} />
			<span className="hramble-av-name">Hramble</span>
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
