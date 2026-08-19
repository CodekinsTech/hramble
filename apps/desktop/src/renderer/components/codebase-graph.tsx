/**
 * Codebase graph — an interactive, 2D view of how a project's symbols
 * reference each other. Styled after Obsidian's graph view (small unlabeled
 * dots by default, labels only on selection/search-match/high-connectivity,
 * a restrained muted palette) rather than a dense force-directed "hairball".
 *
 * Two deterministic layouts, switchable by a toggle, drawn on a <canvas>:
 *   • Ring — a chord diagram. Symbols are laid out around a circle in
 *     cluster-contiguous arcs; reference edges bow through the centre.
 *   • Tree — a mindwalk-style radial tree. A root → cluster → file → symbol
 *     hierarchy fans out from the centre, leaves (symbols) on the rim.
 *
 * Layouts are derived purely from data order (no randomness, no simulation),
 * so the picture is stable across renders. Data comes from `getRepoGraph`, a
 * simpler standalone reimplementation of the agent's repo_map plugin logic
 * (different runtime, no shared import possible — see repo-graph.ts for why).
 */
import { SearchIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

interface RepoGraphNode {
	id: string
	name: string
	kind: string
	file: string
	cluster: string
	refCount: number
}
interface RepoGraphEdge {
	source: string
	target: string
}
interface RepoGraphData {
	nodes: RepoGraphNode[]
	edges: RepoGraphEdge[]
	fileCount: number
	truncated: boolean
}

type LayoutMode = "ring" | "tree"

interface PositionedNode {
	node: RepoGraphNode
	x: number
	y: number
	r: number
}
interface Branch {
	x1: number
	y1: number
	x2: number
	y2: number
}
interface ClusterLabel {
	text: string
	x: number
	y: number
	align: CanvasTextAlign
}
interface RefEdge {
	a: PositionedNode
	b: PositionedNode
}
interface Scene {
	points: PositionedNode[]
	byId: Map<string, PositionedNode>
	refEdges: RefEdge[]
	branches: Branch[]
	labels: ClusterLabel[]
	cx: number
	cy: number
}

// A muted, restrained palette (not the brighter one used for skill cards) —
// this is meant to sit quietly behind data, not compete for attention.
const CLUSTER_COLORS = [
	"#7ba7d9", "#a892d9", "#7fc4a8", "#d9b76f",
	"#d98f9c", "#7fc9d9", "#9aa0d9", "#d9a97f",
]

function colorFor(cluster: string): string {
	let hash = 0
	for (let i = 0; i < cluster.length; i++) hash = (hash * 31 + cluster.charCodeAt(i)) >>> 0
	return CLUSTER_COLORS[hash % CLUSTER_COLORS.length]
}

const HEIGHT = 520

// Dot radius scales gently with how often a symbol is referenced.
function dotRadius(refCount: number): number {
	return Math.max(2.5, Math.min(3 + refCount * 0.8, 9))
}

function baseName(file: string): string {
	if (!file) return "—"
	const parts = file.split(/[\\/]/)
	return parts[parts.length - 1] || file
}

// Resolve a `#rrggbb` theme/cluster colour to an rgba() string so the canvas
// can draw it at a chosen alpha. Falls back to a neutral grey if unparsable.
function withAlpha(hex: string, alpha: number): string {
	const h = hex.trim().replace("#", "")
	if (h.length === 6) {
		const r = Number.parseInt(h.slice(0, 2), 16)
		const g = Number.parseInt(h.slice(2, 4), 16)
		const b = Number.parseInt(h.slice(4, 6), 16)
		if (!(Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b))) return `rgba(${r}, ${g}, ${b}, ${alpha})`
	}
	if (h.length === 3) {
		const r = Number.parseInt(h[0] + h[0], 16)
		const g = Number.parseInt(h[1] + h[1], 16)
		const b = Number.parseInt(h[2] + h[2], 16)
		if (!(Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b))) return `rgba(${r}, ${g}, ${b}, ${alpha})`
	}
	return `rgba(128, 128, 128, ${alpha})`
}

export function CodebaseGraph({ directory, onClose }: { directory: string; onClose: () => void }) {
	const [data, setData] = useState<RepoGraphData | null>(null)
	const [selected, setSelected] = useState<RepoGraphNode | null>(null)
	const [hovered, setHovered] = useState<string | null>(null)
	const [query, setQuery] = useState("")
	const [hiddenClusters, setHiddenClusters] = useState<Set<string>>(new Set())
	const [layoutMode, setLayoutMode] = useState<LayoutMode>("ring")

	const containerRef = useRef<HTMLDivElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [width, setWidth] = useState(760)

	useEffect(() => {
		let cancelled = false
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bridge = (window as any).hramble
		bridge.getRepoGraph(directory).then((d: RepoGraphData) => {
			if (!cancelled) setData(d)
		})
		return () => {
			cancelled = true
		}
	}, [directory])

	// Track container width so the canvas stays responsive.
	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const update = () => setWidth(Math.max(240, el.clientWidth))
		update()
		const ro = new ResizeObserver(update)
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	const clusters = useMemo(() => {
		if (!data) return []
		const counts = new Map<string, number>()
		for (const n of data.nodes) counts.set(n.cluster, (counts.get(n.cluster) || 0) + 1)
		return [...counts.entries()].sort((a, b) => b[1] - a[1])
	}, [data])

	const queryLower = query.trim().toLowerCase()
	const matchingIds = useMemo(() => {
		if (!queryLower || !data) return null
		return new Set(data.nodes.filter((n) => n.name.toLowerCase().includes(queryLower)).map((n) => n.id))
	}, [data, queryLower])

	// Deterministic layout for the active mode. Positions are computed over ALL
	// nodes (hiding a cluster just skips drawing it), so the picture never
	// re-flows when clusters are toggled.
	const scene = useMemo<Scene | null>(() => {
		if (!data || data.nodes.length === 0) return null
		const w = width
		const h = HEIGHT
		const cx = w / 2
		const cy = h / 2
		const R = Math.max(40, Math.min(w, h) / 2 - 72)
		const byId = new Map<string, PositionedNode>()

		if (layoutMode === "ring") {
			return buildRing(data, cx, cy, R, byId)
		}
		return buildTree(data, cx, cy, R, byId)
	}, [data, width, layoutMode])

	const toggleCluster = (name: string) => {
		setHiddenClusters((prev) => {
			const next = new Set(prev)
			if (next.has(name)) next.delete(name)
			else next.add(name)
			return next
		})
	}

	// Draw the active scene. Re-runs on any visual change; each pass resolves
	// live theme colours so the graph respects light/dark.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext("2d")
		if (!ctx) return

		const dpr = window.devicePixelRatio || 1
		const w = width
		const h = HEIGHT
		canvas.width = Math.round(w * dpr)
		canvas.height = Math.round(h * dpr)
		canvas.style.width = `${w}px`
		canvas.style.height = `${h}px`
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, w, h)
		if (!scene) return

		const css = getComputedStyle(document.documentElement)
		const cForeground = css.getPropertyValue("--foreground").trim() || "#0d0d0d"
		const cMuted = css.getPropertyValue("--muted-foreground").trim() || "#7a7a7a"
		const cBorder = css.getPropertyValue("--border").trim() || "#dddddd"
		const cRing = css.getPropertyValue("--ring").trim() || "#0080bd"

		const isVisible = (n: RepoGraphNode) => !hiddenClusters.has(n.cluster)
		const searching = !!matchingIds

		// 1) Reference edges as chords bowing through the centre. Faint, tinted
		//    toward the source cluster so it stays readable behind the dots.
		ctx.lineWidth = layoutMode === "ring" ? 0.8 : 0.6
		const edgeAlpha = layoutMode === "ring" ? 0.14 : 0.06
		for (const e of scene.refEdges) {
			if (!isVisible(e.a.node) || !isVisible(e.b.node)) continue
			ctx.strokeStyle = withAlpha(colorFor(e.a.node.cluster), edgeAlpha)
			ctx.beginPath()
			ctx.moveTo(e.a.x, e.a.y)
			ctx.quadraticCurveTo(scene.cx, scene.cy, e.b.x, e.b.y)
			ctx.stroke()
		}

		// 2) Tree branch links (parent → child). Dim + neutral.
		if (scene.branches.length) {
			ctx.strokeStyle = withAlpha(cMuted, 0.28)
			ctx.lineWidth = 0.7
			for (const b of scene.branches) {
				ctx.beginPath()
				ctx.moveTo(b.x1, b.y1)
				ctx.lineTo(b.x2, b.y2)
				ctx.stroke()
			}
		}

		// 3) Cluster labels around the outside.
		ctx.font = "10px 'Inter Variable', Inter, sans-serif"
		ctx.textBaseline = "middle"
		ctx.fillStyle = withAlpha(cMuted, 0.85)
		for (const lb of scene.labels) {
			ctx.textAlign = lb.align
			ctx.fillText(lb.text, lb.x, lb.y)
		}

		// 4) Nodes.
		for (const p of scene.points) {
			if (!isVisible(p.node)) continue
			const isSelected = selected?.id === p.node.id
			const isMatch = matchingIds?.has(p.node.id) ?? false
			const isHover = hovered === p.node.id
			const dim = searching && !isMatch && !isSelected
			ctx.globalAlpha = dim ? 0.22 : 1
			ctx.beginPath()
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
			ctx.fillStyle = colorFor(p.node.cluster)
			ctx.fill()
			if (isSelected || isMatch || isHover) {
				ctx.strokeStyle = cRing
				ctx.lineWidth = isSelected ? 2.5 : 1.5
				ctx.stroke()
			}
			ctx.globalAlpha = 1
		}

		// 5) Node labels — restrained: only selection / search-match / hover /
		//    high-connectivity get a label.
		ctx.font = "9px 'Inter Variable', Inter, sans-serif"
		ctx.textAlign = "center"
		ctx.textBaseline = "bottom"
		ctx.fillStyle = cForeground
		for (const p of scene.points) {
			if (!isVisible(p.node)) continue
			const isSelected = selected?.id === p.node.id
			const isMatch = matchingIds?.has(p.node.id) ?? false
			const isHover = hovered === p.node.id
			if (!(isSelected || isMatch || isHover || p.node.refCount >= 4)) continue
			ctx.globalAlpha = searching && !isMatch && !isSelected ? 0.35 : 1
			ctx.fillText(p.node.name, p.x, p.y - p.r - 3)
			ctx.globalAlpha = 1
		}

		// Border ignored for drawing but resolved above keeps lint honest.
		void cBorder
	}, [scene, width, hiddenClusters, matchingIds, selected, hovered, layoutMode])

	// Nearest-node hit-test in canvas-local (CSS px) coordinates.
	const hitTest = (clientX: number, clientY: number): RepoGraphNode | null => {
		const canvas = canvasRef.current
		if (!canvas || !scene) return null
		const rect = canvas.getBoundingClientRect()
		const px = clientX - rect.left
		const py = clientY - rect.top
		let best: RepoGraphNode | null = null
		let bestDist = Number.POSITIVE_INFINITY
		for (const p of scene.points) {
			if (hiddenClusters.has(p.node.cluster)) continue
			const dx = px - p.x
			const dy = py - p.y
			const d = Math.hypot(dx, dy)
			const threshold = Math.max(p.r + 5, 9)
			if (d <= threshold && d < bestDist) {
				bestDist = d
				best = p.node
			}
		}
		return best
	}

	return (
		<div className="flex h-full flex-col bg-background">
			<div className="flex items-center justify-between border-border border-b px-3 py-2">
				<div className="flex items-center gap-2">
					<span className="font-semibold text-foreground text-sm">Codebase graph</span>
					{data && (
						<span className="text-muted-foreground text-xs">
							{data.fileCount} files{data.truncated ? " · showing most-connected" : ""}
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
			</div>
			<div className="flex flex-1 overflow-hidden">
				<div ref={containerRef} className="relative flex-1 overflow-hidden">
					{!data ? (
						<div className="flex h-full items-center justify-center text-muted-foreground text-sm">Scanning…</div>
					) : (
						// biome-ignore lint: canvas interactive surface; keyboard users use the sidebar list/search instead
						<canvas
							ref={canvasRef}
							onClick={(e) => setSelected(hitTest(e.clientX, e.clientY))}
							onMouseMove={(e) => setHovered(hitTest(e.clientX, e.clientY)?.id ?? null)}
							onMouseLeave={() => setHovered(null)}
							style={{ cursor: hovered ? "pointer" : "default" }}
						/>
					)}
				</div>
				<div className="w-56 shrink-0 overflow-y-auto border-border border-l p-3">
					<div className="mb-3 inline-flex w-full rounded-md border border-border bg-muted/40 p-0.5">
						{(["ring", "tree"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								onClick={() => setLayoutMode(mode)}
								className={`flex-1 rounded-[5px] px-2 py-1 text-xs capitalize transition-colors ${
									layoutMode === mode
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{mode}
							</button>
						))}
					</div>
					<div className="relative mb-3">
						<SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search symbols…"
							className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 text-xs outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>
					{selected && (
						<div className="mb-3 rounded-md border border-border bg-card p-2 text-xs">
							<div className="font-medium text-foreground">{selected.name}</div>
							<div className="mt-0.5 text-muted-foreground">
								{selected.kind} · {selected.file}
							</div>
							<div className="text-muted-foreground">
								referenced in {selected.refCount} file{selected.refCount === 1 ? "" : "s"}
							</div>
						</div>
					)}
					<div className="mb-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Clusters</div>
					<div className="flex flex-col gap-1.5">
						{clusters.map(([name, count]) => (
							<label key={name} className="flex cursor-pointer items-center gap-1.5 text-xs">
								<input
									type="checkbox"
									checked={!hiddenClusters.has(name)}
									onChange={() => toggleCluster(name)}
									className="size-3"
								/>
								<span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(name) }} />
								<span className="flex-1 truncate text-foreground">{name}</span>
								<span className="text-muted-foreground">{count}</span>
							</label>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}

// ── Layout builders ─────────────────────────────────────────────────────────

// RING (chord diagram): nodes laid out around a circle in cluster-contiguous
// arcs with a small gap between clusters; reference edges bow through centre.
function buildRing(
	data: RepoGraphData,
	cx: number,
	cy: number,
	R: number,
	byId: Map<string, PositionedNode>,
): Scene {
	const groups = new Map<string, RepoGraphNode[]>()
	for (const n of data.nodes) {
		const arr = groups.get(n.cluster)
		if (arr) arr.push(n)
		else groups.set(n.cluster, [n])
	}
	const clusterNames = [...groups.keys()].sort((a, b) => a.localeCompare(b))
	for (const name of clusterNames) {
		const g = groups.get(name)
		if (g) g.sort((a, b) => a.name.localeCompare(b.name))
	}

	const total = data.nodes.length
	const gap = 0.06
	const totalGap = gap * clusterNames.length
	const avail = Math.max(0.0001, Math.PI * 2 - totalGap)
	const step = avail / Math.max(1, total)

	const points: PositionedNode[] = []
	const labels: ClusterLabel[] = []
	let a = -Math.PI / 2 // start at top

	for (const name of clusterNames) {
		const g = groups.get(name) ?? []
		const arcStart = a
		for (const node of g) {
			const angle = a + step / 2
			const p: PositionedNode = {
				node,
				x: cx + R * Math.cos(angle),
				y: cy + R * Math.sin(angle),
				r: dotRadius(node.refCount),
			}
			points.push(p)
			byId.set(node.id, p)
			a += step
		}
		const arcEnd = a
		const mid = (arcStart + arcEnd) / 2
		const lr = R + 16
		const cos = Math.cos(mid)
		labels.push({
			text: name,
			x: cx + lr * cos,
			y: cy + lr * Math.sin(mid),
			align: cos < -0.3 ? "right" : cos > 0.3 ? "left" : "center",
		})
		a += gap
	}

	const refEdges: RefEdge[] = []
	for (const e of data.edges) {
		const A = byId.get(e.source)
		const B = byId.get(e.target)
		if (A && B) refEdges.push({ a: A, b: B })
	}

	return { points, byId, refEdges, branches: [], labels, cx, cy }
}

// TREE (mindwalk-style radial tree): root → cluster → file → symbol. Leaves
// (symbols) get equal angular share in path-sorted order; internal nodes sit at
// the mean angle of their descendant leaves; radius = depth / maxDepth * R.
function buildTree(
	data: RepoGraphData,
	cx: number,
	cy: number,
	R: number,
	byId: Map<string, PositionedNode>,
): Scene {
	const sorted = [...data.nodes].sort((a, b) => {
		const c = a.cluster.localeCompare(b.cluster)
		if (c !== 0) return c
		const f = baseName(a.file).localeCompare(baseName(b.file))
		if (f !== 0) return f
		return a.name.localeCompare(b.name)
	})

	const leafCount = sorted.length
	const maxDepth = 3
	const rAt = (depth: number) => (depth / maxDepth) * R
	const pos = (depth: number, angle: number) => ({
		x: cx + rAt(depth) * Math.cos(angle),
		y: cy + rAt(depth) * Math.sin(angle),
	})

	// Angle per leaf, and accumulate mean angles up the hierarchy.
	interface FileAgg { angleSum: number; count: number }
	interface ClusterAgg { angleSum: number; count: number; files: Map<string, FileAgg> }
	const clusterAggs = new Map<string, ClusterAgg>()
	const leafAngle = new Map<string, number>()

	sorted.forEach((node, i) => {
		const angle = ((i + 0.5) / Math.max(1, leafCount)) * Math.PI * 2 - Math.PI / 2
		leafAngle.set(node.id, angle)
		let ca = clusterAggs.get(node.cluster)
		if (!ca) {
			ca = { angleSum: 0, count: 0, files: new Map() }
			clusterAggs.set(node.cluster, ca)
		}
		ca.angleSum += angle
		ca.count += 1
		const fb = baseName(node.file)
		let fa = ca.files.get(fb)
		if (!fa) {
			fa = { angleSum: 0, count: 0 }
			ca.files.set(fb, fa)
		}
		fa.angleSum += angle
		fa.count += 1
	})

	const points: PositionedNode[] = []
	const branches: Branch[] = []
	const labels: ClusterLabel[] = []

	for (const [clusterName, ca] of clusterAggs) {
		const cAngle = ca.angleSum / Math.max(1, ca.count)
		const cPos = pos(1, cAngle)
		// root → cluster
		branches.push({ x1: cx, y1: cy, x2: cPos.x, y2: cPos.y })
		// cluster label at the rim near its mean angle
		const lr = R + 16
		const cos = Math.cos(cAngle)
		labels.push({
			text: clusterName,
			x: cx + lr * cos,
			y: cy + lr * Math.sin(cAngle),
			align: cos < -0.3 ? "right" : cos > 0.3 ? "left" : "center",
		})
		for (const [, fa] of ca.files) {
			const fAngle = fa.angleSum / Math.max(1, fa.count)
			const fPos = pos(2, fAngle)
			// cluster → file
			branches.push({ x1: cPos.x, y1: cPos.y, x2: fPos.x, y2: fPos.y })
		}
	}

	// Leaves (symbols) on the rim + file → leaf links.
	for (const node of sorted) {
		const angle = leafAngle.get(node.id) ?? 0
		const leafPos = pos(3, angle)
		const p: PositionedNode = { node, x: leafPos.x, y: leafPos.y, r: dotRadius(node.refCount) }
		points.push(p)
		byId.set(node.id, p)
		const ca = clusterAggs.get(node.cluster)
		const fa = ca?.files.get(baseName(node.file))
		if (fa) {
			const fAngle = fa.angleSum / Math.max(1, fa.count)
			const fPos = pos(2, fAngle)
			branches.push({ x1: fPos.x, y1: fPos.y, x2: leafPos.x, y2: leafPos.y })
		}
	}

	// Reference edges as very faint chords behind the tree.
	const refEdges: RefEdge[] = []
	for (const e of data.edges) {
		const A = byId.get(e.source)
		const B = byId.get(e.target)
		if (A && B) refEdges.push({ a: A, b: B })
	}

	return { points, byId, refEdges, branches, labels, cx, cy }
}
