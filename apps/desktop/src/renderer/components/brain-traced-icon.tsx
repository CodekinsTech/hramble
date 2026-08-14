/**
 * Brain traced icon — the real, original animation: all 134 GIF frames
 * individually vectorized with potrace (not a math reconstruction), replayed
 * as genuine vector paths. Two overlapping <g> layers cross-fade via CSS
 * transition so each frame dissolves into the next instead of hard-cutting.
 * Cycle starts on the cube pose (frames were reordered at build time —
 * see lib/brain-traced-frames.ts) and just keeps looping from there.
 */
import { useEffect, useRef } from "react"
import {
	BRAIN_TRACE_FRAMES,
	BRAIN_TRACE_HEIGHT,
	BRAIN_TRACE_TRANSFORM,
	BRAIN_TRACE_WIDTH,
} from "../lib/brain-traced-frames"

const FRAME_MS = 65

export function BrainTracedIcon({ className }: { className?: string }) {
	const layerARef = useRef<SVGGElement>(null)
	const layerBRef = useRef<SVGGElement>(null)

	useEffect(() => {
		const a = layerARef.current
		const b = layerBRef.current
		if (!a || !b) return
		a.innerHTML = BRAIN_TRACE_FRAMES[0]
		b.innerHTML = BRAIN_TRACE_FRAMES[1] ?? BRAIN_TRACE_FRAMES[0]

		let i = 0
		let showingA = true
		const id = setInterval(() => {
			i = (i + 1) % BRAIN_TRACE_FRAMES.length
			const next = showingA ? b : a
			const cur = showingA ? a : b
			next.innerHTML = BRAIN_TRACE_FRAMES[i]
			// Force layout so the browser registers the new content before
			// animating opacity, otherwise the transition can get skipped.
			void next.getBoundingClientRect()
			next.style.opacity = "1"
			cur.style.opacity = "0"
			showingA = !showingA
		}, FRAME_MS)
		return () => clearInterval(id)
	}, [])

	return (
		<svg
			viewBox={`0 0 ${BRAIN_TRACE_WIDTH} ${BRAIN_TRACE_HEIGHT}`}
			className={className}
			role="img"
			aria-label="Brain icon"
		>
			<g
				ref={layerARef}
				transform={BRAIN_TRACE_TRANSFORM}
				fill="#2B6CFF"
				stroke="none"
				style={{ opacity: 1, transition: `opacity ${FRAME_MS * 0.85}ms linear` }}
			/>
			<g
				ref={layerBRef}
				transform={BRAIN_TRACE_TRANSFORM}
				fill="#2B6CFF"
				stroke="none"
				style={{ opacity: 0, transition: `opacity ${FRAME_MS * 0.85}ms linear` }}
			/>
		</svg>
	)
}
