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

/**
 * A floating, draggable, resizable panel.
 *
 * Rendered through a portal to <body> as `position: fixed`, so it overlays the
 * app WITHOUT pushing or covering the layout — you can see the summary/work
 * behind it. Grab the header to move it (clamped fully inside the window),
 * minimise it to just the header bar, or drag the corner to resize. Defaults to
 * the lower-right, clear of the summary.
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
	const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

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

	// ── Resize (bottom-right corner) ─────────────────────────────────────────
	const onResizeDown = useCallback(
		(e: ReactPointerEvent) => {
			e.stopPropagation()
			resize.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
			e.currentTarget.setPointerCapture(e.pointerId)
		},
		[size.w, size.h],
	)
	const onResizeMove = useCallback(
		(e: ReactPointerEvent) => {
			if (!resize.current) return
			const w = clamp(resize.current.w + (e.clientX - resize.current.x), MIN_W, MAX_W)
			const h = clamp(resize.current.h + (e.clientY - resize.current.y), MIN_H, Math.round(window.innerHeight * 0.9))
			setSize({ w, h })
		},
		[],
	)
	const onResizeUp = useCallback((e: ReactPointerEvent) => {
		resize.current = null
		e.currentTarget.releasePointerCapture(e.pointerId)
	}, [])

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
			{!minimized && (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
					{/* Resize grabber — drag to change the panel size. */}
					<div
						onPointerDown={onResizeDown}
						onPointerMove={onResizeMove}
						onPointerUp={onResizeUp}
						className="absolute right-0 bottom-0 size-4 cursor-nwse-resize"
						title="Drag to resize"
					>
						<div className="absolute right-1 bottom-1 size-2 border-muted-foreground/50 border-r-2 border-b-2" />
					</div>
				</>
			)}
		</div>,
		document.body,
	)
}
