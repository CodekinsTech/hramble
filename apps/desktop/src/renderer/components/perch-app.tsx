import { useEffect, useRef, useState } from "react"
import { type AvatarKey, type PerchZone, VrmStage } from "./vrm-stage"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hramble = () => (window as any).hramble

/** The perch window's content: just the avatar, draggable, click-through around it. */
export function PerchApp() {
	const avatar = (new URLSearchParams(location.search).get("avatar") as AvatarKey) || "flora"
	const [zone, setZone] = useState<PerchZone>("dock")
	// Drag (matches AvatarBox: pointer capture + 4px threshold + stand while carried).
	const dragging = useRef(false)
	const started = useRef(false)
	const last = useRef({ x: 0, y: 0 })

	// The perch loop tells us where she is (dock / stand-on-window / sit-on-window).
	useEffect(() => {
		return hramble()?.onPerchZone?.((z: string) => {
			if (z === "sit" || z === "stand" || z === "dock") setZone(z)
		})
	}, [])

	// ESC → dock her back to the box.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") hramble()?.perchStop?.()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	useEffect(() => {
		// Remove the "Hramble" splash (only StartupOverlay removes it, and perch has none).
		document.getElementById("splash")?.remove()
		// Transparent window — no background anywhere.
		document.title = "Hramble"
		document.documentElement.style.background = "transparent"
		document.body.style.background = "transparent"
		const root = document.getElementById("root")
		if (root) root.style.background = "transparent"

		// Report the avatar's body region as the interactive hit-rect so clicks
		// pass through the transparent areas to the apps behind.
		const report = () => {
			const w = window.innerWidth
			const h = window.innerHeight
			hramble()?.perchHitRects?.([{ x: Math.round(w * 0.28), y: Math.round(h * 0.08), w: Math.round(w * 0.44), h: Math.round(h * 0.88) }])
		}
		report()
		const iv = setInterval(report, 800)
		return () => clearInterval(iv)
	}, [])

	// Drag matches AvatarBox exactly: 4px threshold, then send "start" (forcing
	// stand), then "move" deltas, then "end" (snaps to nearest edge immediately).
	const onPointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return
		dragging.current = true
		started.current = false
		last.current = { x: e.screenX, y: e.screenY }
		try {
			e.currentTarget.setPointerCapture(e.pointerId)
		} catch {
			/* ignore */
		}
	}
	const onPointerMove = (e: React.PointerEvent) => {
		if (!dragging.current) return
		const dx = e.screenX - last.current.x
		const dy = e.screenY - last.current.y
		if (!started.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
		if (!started.current) {
			// Threshold crossed — she's now being carried: stand and start the drag.
			started.current = true
			setZone("stand")
			hramble()?.perchDrag?.("start", 0, 0)
		}
		last.current = { x: e.screenX, y: e.screenY }
		hramble()?.perchDrag?.("move", dx, dy)
	}
	const onPointerUp = (e: React.PointerEvent) => {
		if (dragging.current && started.current) hramble()?.perchDrag?.("end", 0, 0)
		dragging.current = false
		started.current = false
		try {
			e.currentTarget.releasePointerCapture(e.pointerId)
		} catch {
			/* ignore */
		}
	}

	return (
		<div className="perch-root">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
			<div
				className="perch-avatar"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			>
				<VrmStage avatar={avatar} mode="perch" zone={zone} />
			</div>
			<button type="button" className="perch-close" title="Dock back" onClick={() => hramble()?.perchStop?.()}>
				×
			</button>
		</div>
	)
}
