/**
 * Graph view — draws a session's work-graph from the .hramble/graph store.
 *
 * This is the VIEW layer (see main/graph-store.ts for the record layer): it
 * reads the tiny node records and lays them out left-to-right by depth, showing
 * live status (working / done / failed → repair → done) as the engine runs.
 * Nodes are records/pointers, not editable containers — opening one (later)
 * fetches the real code lazily from git.
 */
import { useEffect, useMemo, useState } from "react"
import { type GraphNode, type GraphNodeStatus, loadSessionGraph } from "../atoms/graph"

const COL_W = 190
const ROW_H = 92
const NODE_W = 150
const NODE_H = 58
const PAD = 24
const POLL_MS = 1200

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

	return (
		<div className={`flex h-full w-full flex-col ${className ?? ""}`}>
			<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/40 border-b px-3 py-1.5 text-[10px] text-muted-foreground">
				{(
					[
						["working", "bg-primary"],
						["done", "bg-green-500"],
						["failed", "bg-red-500"],
						["repair", "bg-amber-500"],
						["queued", "bg-border"],
					] as const
				).map(([label, dot]) => (
					<span key={label} className="flex items-center gap-1">
						<span className={`size-2 rounded-[2px] ${dot}`} />
						{label}
					</span>
				))}
				<span className="ml-auto flex items-center gap-1 opacity-70">
					<span className="h-px w-3 border-primary/40 border-t border-dashed" />
					shared files
				</span>
			</div>
			<div className="relative min-h-0 flex-1 overflow-auto">
				<div className="relative" style={{ width, height, minWidth: "100%", minHeight: "100%" }}>
					<svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
					{nodes.flatMap((n) => {
						const to = pos.get(n.id)
						if (!to) return []
						const paths = []
						const from = n.parent ? pos.get(n.parent) : undefined
						if (from) {
							paths.push(
								<path key={`e-${n.id}`} d={edgePath(from, to)} fill="none" className="stroke-border" strokeWidth={2} />,
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
		</div>
	)
}
