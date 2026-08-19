import { GripVerticalIcon, XIcon } from "lucide-react"
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"

/**
 * A floating, draggable panel.
 *
 * Rendered `position: fixed`, so it overlays the app WITHOUT pushing or covering
 * the layout beneath it — you can see the summary/work behind it, and grab the
 * header to move it anywhere. Defaults to the lower-right corner (above the chat
 * bar), out of the way of the summary screen; drag sets an explicit position.
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
	// null = default anchored spot (lower-right). Once dragged, an explicit x/y.
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
	const drag = useRef<{ dx: number; dy: number } | null>(null)

	const onPointerDown = useCallback((e: ReactPointerEvent) => {
		// Convert whatever the current on-screen position is (default anchor or a
		// prior drag) into a grab offset, so movement starts without a jump.
		const panel = e.currentTarget.parentElement as HTMLElement | null
		if (!panel) return
		const rect = panel.getBoundingClientRect()
		drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
		e.currentTarget.setPointerCapture(e.pointerId)
	}, [])

	const onPointerMove = useCallback((e: ReactPointerEvent) => {
		if (!drag.current) return
		const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - 48)
		const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 48)
		setPos({ x, y })
	}, [])

	const onPointerUp = useCallback((e: ReactPointerEvent) => {
		drag.current = null
		e.currentTarget.releasePointerCapture(e.pointerId)
	}, [])

	// Default: lower-right, sitting above the chat bar and clear of the summary.
	const style: CSSProperties = pos ? { left: pos.x, top: pos.y, width } : { right: 24, bottom: 92, width }

	// Portal to <body> so `position: fixed` is relative to the viewport — an
	// ancestor with a CSS transform/filter would otherwise trap it inside the frame.
	return createPortal(
		<div
			className="fixed z-[70] flex max-h-[72vh] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
			style={style}
		>
			<div
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				className="flex cursor-grab select-none items-center justify-between gap-2 border-border/60 border-b bg-muted/40 px-3 py-2 active:cursor-grabbing"
			>
				<span className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
					<GripVerticalIcon className="size-3.5 shrink-0 opacity-60" />
					{title}
				</span>
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
			<div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
		</div>,
		document.body,
	)
}
