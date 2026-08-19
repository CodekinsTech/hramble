import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, XIcon } from "lucide-react"
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"

const MIN_W = 280
const MAX_W = 640
const MIN_H = 140

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), hi)
}

/** Resize directions — any combination of n/s + e/w (edges + corners). */
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

/**
 * A floating, draggable, resizable panel.
 *
 * Rendered through a portal to <body> as `position: fixed`, so it overlays the
 * app WITHOUT pushing or covering the layout — you see the summary/work behind
 * it. Grab the header to move it (clamped fully inside the window), minimise it
 * to just the header bar, or resize from ANY edge or corner. Defaults to the
 * lower-right, clear of the summary.
 */
export function FloatingPanel({
	title,
	onClose,
	children,
	width = 400,
}: {
	title: ReactNode
	onClose?: () => void
	children: ReactNode
	width?: number
}) {
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
	const [size, setSize] = useState<{ w: number; h: number }>({ w: width, h: 460 })
	const [minimized, setMinimized] = useState(false)
	const drag = useRef<{ dx: number; dy: number } | null>(null)
	const resize = useRef<{ dir: Dir; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null)

	// Default anchor: lower-right, above the chat bar and clear of the summary.
	const p = pos ?? {
		x: Math.max(8, window.innerWidth - size.w - 24),
		y: Math.max(8, window.innerHeight - (minimized ? 52 : size.h) - 92),
	}

	// ── Drag (header) ───────────────────────────────────────────────────────
	const onDragDown = useCallback(
		(e: ReactPointerEvent) => {
			drag.current = { dx: e.clientX - p.x, dy: e.clientY - p.y }
			e.currentTarget.setPointerCapture(e.pointerId)
		},
		[p.x, p.y],
	)
	const onDragMove = useCallback(
		(e: ReactPointerEvent) => {
			if (!drag.current) return
			const h = minimized ? 52 : size.h
			const x = clamp(e.clientX - drag.current.dx, 0, Math.max(0, window.innerWidth - size.w))
			const y = clamp(e.clientY - drag.current.dy, 0, Math.max(0, window.innerHeight - h))
			setPos({ x, y })
		},
		[minimized, size.h, size.w],
	)
	const onDragUp = useCallback((e: ReactPointerEvent) => {
		drag.current = null
		e.currentTarget.releasePointerCapture(e.pointerId)
	}, [])

	// ── Resize (any edge / corner) ───────────────────────────────────────────
	const onResizeDown = useCallback(
		(dir: Dir) => (e: ReactPointerEvent) => {
			e.stopPropagation()
			resize.current = { dir, px: e.clientX, py: e.clientY, x: p.x, y: p.y, w: size.w, h: size.h }
			e.currentTarget.setPointerCapture(e.pointerId)
		},
		[p.x, p.y, size.w, size.h],
	)
	const onResizeMove = useCallback((e: ReactPointerEvent) => {
		const r = resize.current
		if (!r) return
		const dx = e.clientX - r.px
		const dy = e.clientY - r.py
		const maxH = Math.round(window.innerHeight * 0.9)
		let x = r.x
		let y = r.y
		let w = r.w
		let h = r.h
		if (r.dir.includes("e")) w = clamp(r.w + dx, MIN_W, MAX_W)
		if (r.dir.includes("s")) h = clamp(r.h + dy, MIN_H, maxH)
		if (r.dir.includes("w")) {
			w = clamp(r.w - dx, MIN_W, MAX_W)
			x = r.x + (r.w - w) // keep the right edge fixed
		}
		if (r.dir.includes("n")) {
			h = clamp(r.h - dy, MIN_H, maxH)
			y = r.y + (r.h - h) // keep the bottom edge fixed
		}
		// Keep the whole panel inside the window.
		x = clamp(x, 0, Math.max(0, window.innerWidth - w))
		y = clamp(y, 0, Math.max(0, window.innerHeight - h))
		setSize({ w, h })
		setPos({ x, y })
	}, [])
	const onResizeUp = useCallback((e: ReactPointerEvent) => {
		resize.current = null
		e.currentTarget.releasePointerCapture(e.pointerId)
	}, [])

	const handle = (dir: Dir, cls: string) => (
		<div
			onPointerDown={onResizeDown(dir)}
			onPointerMove={onResizeMove}
			onPointerUp={onResizeUp}
			className={`absolute z-10 ${cls}`}
		/>
	)

	const style: CSSProperties = { left: p.x, top: p.y, width: size.w, height: minimized ? undefined : size.h }

	return createPortal(
		<div
			className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
			style={style}
		>
			<div
				onPointerDown={onDragDown}
				onPointerMove={onDragMove}
				onPointerUp={onDragUp}
				className="flex shrink-0 cursor-grab select-none items-center justify-between gap-2 border-border/60 border-b bg-muted/40 px-3 py-2 active:cursor-grabbing"
			>
				<span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-muted-foreground text-xs">
					<GripVerticalIcon className="size-3.5 shrink-0 opacity-60" />
					<span className="truncate">{title}</span>
				</span>
				<div className="flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						onClick={() => setMinimized((m) => !m)}
						className="rounded p-0.5 text-muted-foreground hover:text-foreground"
						title={minimized ? "Expand" : "Minimise"}
					>
						{minimized ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
					</button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							className="rounded p-0.5 text-muted-foreground hover:text-foreground"
							title="Hide"
						>
							<XIcon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
			{!minimized && <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>}

			{/* Resize handles — every edge + corner, so you can size from any side. */}
			{!minimized && (
				<>
					{handle("n", "top-0 right-2 left-2 h-1.5 cursor-ns-resize")}
					{handle("s", "bottom-0 right-2 left-2 h-1.5 cursor-ns-resize")}
					{handle("e", "top-2 right-0 bottom-2 w-1.5 cursor-ew-resize")}
					{handle("w", "top-2 bottom-2 left-0 w-1.5 cursor-ew-resize")}
					{handle("ne", "top-0 right-0 size-3 cursor-nesw-resize")}
					{handle("nw", "top-0 left-0 size-3 cursor-nwse-resize")}
					{handle("se", "right-0 bottom-0 size-3 cursor-nwse-resize")}
					{handle("sw", "bottom-0 left-0 size-3 cursor-nesw-resize")}
				</>
			)}
		</div>,
		document.body,
	)
}
