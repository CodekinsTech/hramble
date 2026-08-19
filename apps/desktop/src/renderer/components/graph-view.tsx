/**
 * Graph view — draws a session's work-graph from the .hramble/graph store.
 *
 * This is the VIEW layer (see main/graph-store.ts for the record layer): it
 * reads the tiny node records and shows live status (working / done / failed →
 * repair → done) as the engine runs. Three alternate LIVE renderings of the
 * same nodes, picked by a header toggle:
 *   • Steps — the original left-to-right layered layout (DEFAULT; unchanged).
 *   • Tree  — a radial dendrogram built from the parent links, root at center.
 *   • Ring  — all nodes around a circle (by depth, then time) with parent→child
 *             chords across it.
 * Tree/Ring draw on a DPR-aware <canvas>; nothing new is saved — they recompute
 * from the current polled nodes each render, so they stay live too.
 * Nodes are records/pointers, not editable containers.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { type GraphNode, type GraphNodeStatus, loadSessionGraph } from "../atoms/graph"

const COL_W = 190
const ROW_H = 92
const NODE_W = 150
const NODE_H = 58
const PAD = 24
const POLL_MS = 1200

type Layout = "steps" | "tree" | "ring"

interface Pos {
	x: number
	y: number
}

/** Layered layout: x = depth from root (parent chain), y = order within depth. */
function computeLayout(nodes: GraphNode[]) {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const depthOf = (n: GraphNode): number => {
		let d = 0
		let cur: GraphNode | undefined = n
		const seen = new Set<string>()
		while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) {
			seen.add(cur.id)
			cur = byId.get(cur.parent)
			d++
		}
		return d
	}
	const groups = new Map<number, GraphNode[]>()
	let maxDepth = 0
	for (const n of nodes) {
		const d = depthOf(n)
		maxDepth = Math.max(maxDepth, d)
		const arr = groups.get(d) ?? []
		arr.push(n)
		groups.set(d, arr)
	}
	const pos = new Map<string, Pos>()
	let maxRows = 0
	for (const [d, arr] of groups) {
		arr.sort((a, b) => a.ts - b.ts)
		maxRows = Math.max(maxRows, arr.length)
		arr.forEach((n, i) => pos.set(n.id, { x: PAD + d * COL_W, y: PAD + i * ROW_H }))
	}
	return {
		pos,
		width: PAD * 2 + (maxDepth + 1) * COL_W,
		height: PAD * 2 + Math.max(1, maxRows) * ROW_H,
	}
}

const STATUS_RING: Record<GraphNodeStatus, string> = {
	queued: "border-border opacity-60",
	working: "border-primary shadow-[0_0_0_1px] shadow-primary/40 animate-pulse",
	done: "border-green-500/50",
	failed: "border-red-500/60 bg-red-500/10",
	repair: "border-amber-500/60 bg-amber-500/10",
	rejected: "border-border opacity-40",
}
const STATUS_BAR: Record<GraphNodeStatus, string> = {
	queued: "bg-border",
	working: "bg-primary",
	done: "bg-green-500",
	failed: "bg-red-500",
	repair: "bg-amber-500",
	rejected: "bg-border",
}
const STATUS_BADGE: Record<GraphNodeStatus, string> = {
	queued: "",
	working: "",
	done: "✓",
	failed: "✕",
	repair: "⟳",
	rejected: "—",
}

function edgePath(a: Pos, b: Pos): string {
	const sx = a.x + NODE_W
	const sy = a.y + NODE_H / 2
	const ex = b.x
	const ey = b.y + NODE_H / 2
	const dx = ex - sx
	return `M${sx},${sy} C${sx + dx * 0.5},${sy} ${ex - dx * 0.5},${ey} ${ex},${ey}`
}

// ---------------------------------------------------------------------------
// Canvas (Tree / Ring) — same live nodes, alternate renderings.
// ---------------------------------------------------------------------------

/**
 * Resolve the SAME status→color meaning the Steps view uses, as concrete
 * canvas colors. green/red/amber match Tailwind's 500 shades used by the DOM
 * view; `working` uses the theme's --primary and neutral states use --border /
 * --muted-foreground (resolved live so light/dark both read correctly).
 */
function statusColors(el: HTMLElement): Record<GraphNodeStatus, string> {
	const cs = getComputedStyle(el)
	const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
	const primary = v("--primary", "#0d0d0d")
	const border = v("--border", "#ededed")
	const muted = v("--muted-foreground", "#8a94a3")
	return {
		queued: border,
		working: primary,
		done: "#22c55e",
		failed: "#ef4444",
		repair: "#f59e0b",
		rejected: muted,
	}
}

interface Polar {
	x: number
	y: number
	r: number
	a: number
}

/** Immediate parent→children map, roots = nodes with no in-graph parent. */
function buildForest(nodes: GraphNode[]) {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const children = new Map<string, GraphNode[]>()
	const roots: GraphNode[] = []
	for (const n of nodes) {
		const p = n.parent && n.parent !== n.id && byId.has(n.parent) ? n.parent : undefined
		if (p) {
			const arr = children.get(p) ?? []
			arr.push(n)
			children.set(p, arr)
		} else {
			roots.push(n)
		}
	}
	roots.sort((a, b) => a.ts - b.ts)
	for (const arr of children.values()) arr.sort((a, b) => a.ts - b.ts)
	return { children, roots }
}

/** Radial dendrogram: depth → radius, leaves fan out by equal angular share. */
function radialLayout(nodes: GraphNode[], w: number, h: number) {
	const { children, roots } = buildForest(nodes)
	const useVirtual = roots.length !== 1 // single root sits dead-center
	const depth = new Map<string, number>()
	const angle = new Map<string, number>()
	let maxDepth = 0

	// Pass 1: count leaves reachable from the roots (for equal angular share).
	let totalLeaves = 0
	const seen1 = new Set<string>()
	const count = (id: string) => {
		if (seen1.has(id)) return
		seen1.add(id)
		const ch = children.get(id) ?? []
		if (!ch.length) {
			totalLeaves++
			return
		}
		for (const c of ch) count(c.id)
	}
	for (const r of roots) count(r.id)
	if (totalLeaves === 0) totalLeaves = 1

	// Pass 2: assign depth + angle (internal node = mean of its descendants).
	const seen2 = new Set<string>()
	let leafIdx = 0
	const assign = (id: string, d: number): number => {
		if (seen2.has(id)) return angle.get(id) ?? 0
		seen2.add(id)
		depth.set(id, d)
		maxDepth = Math.max(maxDepth, d)
		const ch = (children.get(id) ?? []).filter((c) => !seen2.has(c.id))
		let a: number
		if (!ch.length) {
			a = ((leafIdx + 0.5) / totalLeaves) * Math.PI * 2
			leafIdx++
		} else {
			let sum = 0
			for (const c of ch) sum += assign(c.id, d + 1)
			a = sum / ch.length
		}
		angle.set(id, a)
		return a
	}
	const baseDepth = useVirtual ? 1 : 0
	for (const r of roots) assign(r.id, baseDepth)
	// Any node stranded by a parent cycle: park it on the outer ring.
	for (const n of nodes) {
		if (!seen2.has(n.id)) {
			seen2.add(n.id)
			depth.set(n.id, Math.max(1, maxDepth))
			angle.set(n.id, ((leafIdx + 0.5) / totalLeaves) * Math.PI * 2)
			leafIdx++
		}
	}
	maxDepth = Math.max(maxDepth, 1)

	const cx = w / 2
	const cy = h / 2
	const maxR = Math.max(20, Math.min(w, h) / 2 - 48)
	const pos = new Map<string, Polar>()
	for (const n of nodes) {
		const d = depth.get(n.id) ?? 0
		const a = angle.get(n.id) ?? 0
		const r = (d / maxDepth) * maxR
		pos.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, r, a })
	}
	return { pos, cx, cy }
}

/** Ring: every node on one circle, ordered by (depth, then time). */
function ringLayout(nodes: GraphNode[], w: number, h: number) {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const depthOf = (n: GraphNode): number => {
		let d = 0
		let cur: GraphNode | undefined = n
		const seen = new Set<string>()
		while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) {
			seen.add(cur.id)
			cur = byId.get(cur.parent)
			d++
		}
		return d
	}
	const ordered = [...nodes].sort((a, b) => {
		const da = depthOf(a)
		const db = depthOf(b)
		return da !== db ? da - db : a.ts - b.ts
	})
	const cx = w / 2
	const cy = h / 2
	const r = Math.max(20, Math.min(w, h) / 2 - 48)
	const pos = new Map<string, Polar>()
	ordered.forEach((n, i) => {
		const a = (i / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2
		pos.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, r, a })
	})
	return { pos, cx, cy }
}

function shortLabel(n: GraphNode): string {
	const t = (n.title || n.kind || "").trim()
	return t.length > 22 ? `${t.slice(0, 21)}…` : t
}

function CanvasGraph({ nodes, layout, className }: { nodes: GraphNode[]; layout: "tree" | "ring"; className?: string }) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const posRef = useRef<Map<string, Polar>>(new Map())
	const [size, setSize] = useState({ w: 0, h: 0 })
	const [hovered, setHovered] = useState<string | null>(null)

	// Track the container size so the canvas stays responsive.
	useEffect(() => {
		const el = wrapRef.current
		if (!el) return
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect
			if (cr) setSize({ w: Math.round(cr.width), h: Math.round(cr.height) })
		})
		ro.observe(el)
		setSize({ w: el.clientWidth, h: el.clientHeight })
		return () => ro.disconnect()
	}, [])

	// Redraw whenever the live nodes, layout, size, or hover changes.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || size.w <= 0 || size.h <= 0) return
		const ctx = canvas.getContext("2d")
		if (!ctx) return
		const { w, h } = size
		const dpr = window.devicePixelRatio || 1
		canvas.width = Math.round(w * dpr)
		canvas.height = Math.round(h * dpr)
		canvas.style.width = `${w}px`
		canvas.style.height = `${h}px`
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, w, h)

		const colors = statusColors(canvas)
		const cs = getComputedStyle(canvas)
		const linkColor = cs.getPropertyValue("--border").trim() || "#d0d0d0"
		const labelColor = cs.getPropertyValue("--foreground").trim() || "#0d0d0d"

		const { pos, cx, cy } = layout === "tree" ? radialLayout(nodes, w, h) : ringLayout(nodes, w, h)
		posRef.current = pos

		// --- links (parent → child) ---
		ctx.lineWidth = 1.5
		ctx.strokeStyle = linkColor
		for (const n of nodes) {
			if (!n.parent || n.parent === n.id) continue
			const a = pos.get(n.parent)
			const b = pos.get(n.id)
			if (!a || !b) continue
			ctx.beginPath()
			ctx.moveTo(a.x, a.y)
			if (layout === "tree") {
				// Dendrogram elbow: control at the parent radius, child angle.
				ctx.quadraticCurveTo(cx + Math.cos(b.a) * a.r, cy + Math.sin(b.a) * a.r, b.x, b.y)
			} else {
				// Chord bowing toward the ring center.
				const mx = (a.x + b.x) / 2
				const my = (a.y + b.y) / 2
				ctx.quadraticCurveTo(mx + (cx - mx) * 0.7, my + (cy - my) * 0.7, b.x, b.y)
			}
			ctx.stroke()
		}

		// --- nodes ---
		for (const n of nodes) {
			const p = pos.get(n.id)
			if (!p) continue
			const active = n.status === "working" || n.status === "failed" || n.status === "repair"
			const isHover = hovered === n.id
			const rad = active || isHover ? 6 : 4
			ctx.beginPath()
			ctx.arc(p.x, p.y, rad, 0, Math.PI * 2)
			ctx.fillStyle = colors[n.status]
			ctx.fill()
			if (n.status === "working" || isHover) {
				ctx.beginPath()
				ctx.arc(p.x, p.y, rad + 3, 0, Math.PI * 2)
				ctx.strokeStyle = colors[n.status]
				ctx.globalAlpha = 0.4
				ctx.lineWidth = 1.5
				ctx.stroke()
				ctx.globalAlpha = 1
			}
		}

		// --- labels (active / failed / hovered only, to stay legible) ---
		ctx.font = "11px Inter, system-ui, sans-serif"
		ctx.textBaseline = "middle"
		for (const n of nodes) {
			const p = pos.get(n.id)
			if (!p) continue
			const active = n.status === "working" || n.status === "failed" || n.status === "repair"
			if (!active && hovered !== n.id) continue
			const outward = Math.cos(p.a) >= 0 ? 1 : -1
			ctx.textAlign = outward >= 0 ? "left" : "right"
			ctx.fillStyle = labelColor
			ctx.fillText(shortLabel(n), p.x + outward * 10, p.y)
		}
	}, [nodes, layout, size, hovered])

	// Hover hit-test (nearest node within a small radius).
	const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current
		if (!canvas) return
		const rect = canvas.getBoundingClientRect()
		const mx = e.clientX - rect.left
		const my = e.clientY - rect.top
		let best: string | null = null
		let bestD = 14
		for (const [id, p] of posRef.current) {
			const d = Math.hypot(p.x - mx, p.y - my)
			if (d < bestD) {
				bestD = d
				best = id
			}
		}
		if (best !== hovered) setHovered(best)
	}

	return (
		<div ref={wrapRef} className={`relative h-full w-full overflow-hidden ${className ?? ""}`}>
			<canvas
				ref={canvasRef}
				className="absolute inset-0"
				onMouseMove={onMove}
				onMouseLeave={() => setHovered(null)}
			/>
		</div>
	)
}

export function GraphView({
	directory,
	sessionId,
	className,
}: {
	directory?: string
	sessionId?: string | null
	className?: string
}) {
	const [nodes, setNodes] = useState<GraphNode[]>([])
	const [layout, setLayout] = useState<Layout>("steps")

	// Poll the store so the graph reflects live status while the engine runs.
	useEffect(() => {
		if (!directory || !sessionId) {
			setNodes([])
			return
		}
		let alive = true
		const tick = async () => {
			const n = await loadSessionGraph(directory, sessionId)
			if (alive) setNodes(n)
		}
		void tick()
		const id = setInterval(tick, POLL_MS)
		return () => {
			alive = false
			clearInterval(id)
		}
	}, [directory, sessionId])

	const { pos, width, height } = useMemo(() => computeLayout(nodes), [nodes])

	if (!nodes.length) {
		return (
			<div className={`flex h-full items-center justify-center p-6 ${className ?? ""}`}>
				<p className="max-w-xs text-center text-sm text-muted-foreground">
					No graph yet — the work path will appear here as steps run.
				</p>
			</div>
		)
	}

	const toggle = (
		<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
			<span className="mr-auto pl-1 text-[11px] text-muted-foreground">Work graph</span>
			<div className="flex rounded-md border border-border p-0.5 text-[11px]">
				{(["steps", "tree", "ring"] as Layout[]).map((l) => (
					<button
						key={l}
						type="button"
						onClick={() => setLayout(l)}
						className={`rounded px-2 py-0.5 capitalize transition-colors ${
							layout === l
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{l}
					</button>
				))}
			</div>
		</div>
	)

	return (
		<div className={`flex h-full w-full flex-col ${className ?? ""}`}>
			{toggle}
			{layout === "steps" ? (
				<div className="relative min-h-0 w-full flex-1 overflow-auto">
					<div className="relative" style={{ width, height, minWidth: "100%", minHeight: "100%" }}>
						<svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
							{nodes.flatMap((n) => {
								const to = pos.get(n.id)
								if (!to) return []
								const paths = []
								const from = n.parent ? pos.get(n.parent) : undefined
								if (from) {
									paths.push(
										<path
											key={`e-${n.id}`}
											d={edgePath(from, to)}
											fill="none"
											className="stroke-border"
											strokeWidth={2}
										/>,
									)
								}
								for (const r of n.refs ?? []) {
									const rf = pos.get(r)
									if (rf) {
										paths.push(
											<path
												key={`r-${n.id}-${r}`}
												d={edgePath(rf, to)}
												fill="none"
												className="stroke-primary/40"
												strokeWidth={1.5}
												strokeDasharray="3 3"
											/>,
										)
									}
								}
								return paths
							})}
						</svg>
						{nodes.map((n) => {
							const p = pos.get(n.id)
							if (!p) return null
							return (
								<div
									key={n.id}
									className={`absolute flex flex-col justify-center gap-0.5 rounded-lg border bg-card px-3 py-2 transition-colors ${STATUS_RING[n.status]}`}
									style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
									title={n.summary || n.title}
								>
									<span className={`absolute bottom-2 left-0 top-2 w-[3px] rounded ${STATUS_BAR[n.status]}`} />
									<div className="truncate pl-1 text-[13px] font-medium text-foreground">{n.title || n.kind}</div>
									<div className="truncate pl-1 text-[10px] text-muted-foreground">
										{n.kind}
										{n.files?.length ? ` · ${n.files.length} file${n.files.length > 1 ? "s" : ""}` : ""}
									</div>
									{STATUS_BADGE[n.status] && (
										<span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">
											{STATUS_BADGE[n.status]}
										</span>
									)}
								</div>
							)
						})}
					</div>
				</div>
			) : (
				<CanvasGraph nodes={nodes} layout={layout} className="min-h-0 flex-1" />
			)}
		</div>
	)
}
