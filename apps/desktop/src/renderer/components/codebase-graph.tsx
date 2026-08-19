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
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force"
import { useAtomValue } from "jotai"
import { PauseIcon, PlayIcon, SearchIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toolEventLogAtom } from "../atoms/sessions"

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

type LayoutMode = "force" | "3d" | "ring" | "tree"

const LAYOUT_MODES: { id: LayoutMode; label: string }[] = [
	{ id: "force", label: "Force" },
	{ id: "3d", label: "3D" },
	{ id: "ring", label: "Ring" },
	{ id: "tree", label: "Tree" },
]

/** A d3-force simulation node — real symbol node plus live x/y/velocity fields. */
interface ForceNode extends SimulationNodeDatum {
	id: string
	node: RepoGraphNode
	r: number
}
interface ForceLinkDatum extends SimulationLinkDatum<ForceNode> {
	source: string | ForceNode
	target: string | ForceNode
}

/** A node in the hand-rolled 3D force layout (canvas-projected, no 3D lib). */
interface Node3D {
	node: RepoGraphNode
	r: number
	x: number
	y: number
	z: number
	vx: number
	vy: number
	vz: number
}

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

// ── Replay mode ──────────────────────────────────────────────────────────────
// Replay plays the agent's recent session back over whichever layout (ring or
// tree) is active: the graph dims, then each touched file lights up in order
// with a glow and an ember trail bowed from the previous touch to the current.
// This is the ONLY mode that uses glow — static Ring/Tree stay muted.

/** Milliseconds each fixation (one file touch) holds the spotlight. */
const REPLAY_STEP_MS = 700
/** Ember trail colour drawn between consecutive touches. */
const EMBER_COLOR = "#ff9e5e"

/** Colour a touch by its tool: edits warm, reads cool, everything else green. */
function toolGlowColor(tool: string): string {
	const t = tool.toLowerCase()
	if (t === "edit" || t === "write" || t === "patch" || t === "multiedit" || t === "apply_patch") return "#f0ad5a"
	if (t === "read") return "#a5c8f1"
	return "#8fb45f"
}

/** One playback step: a file the agent touched, plus the symbol-nodes it maps to. */
interface Fixation {
	seq: number
	tool: string
	/** Ids of every symbol-node living in the touched file. */
	nodeIds: string[]
	/** Basename of the touched file, shown as the step caption. */
	repFile: string
}

/** Point along a quadratic bézier at parameter t ∈ [0,1]. */
function quadPoint(
	p0: { x: number; y: number },
	c: { x: number; y: number },
	p1: { x: number; y: number },
	t: number,
): { x: number; y: number } {
	const mt = 1 - t
	return {
		x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
		y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
	}
}

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
	const [layoutMode, setLayoutMode] = useState<LayoutMode>("force")
	// 3D auto-orbit play/pause (state drives the button; ref feeds the draw loop).
	const [autoOrbit, setAutoOrbit] = useState(true)
	const autoOrbitRef = useRef(true)
	autoOrbitRef.current = autoOrbit

	// Live positions from the Force layout's running simulation. Kept in a ref so
	// hit-testing and replay can read the current (or settled) node coordinates
	// without re-subscribing. Frozen (not cleared) when we hand off to replay.
	const forceNodesRef = useRef<ForceNode[] | null>(null)
	// Imperative handles the sidebar controls call into the active Force loop.
	const redrawForceRef = useRef<(() => void) | null>(null)
	const reheatForceRef = useRef<(() => void) | null>(null)

	// Replay mode — animates the session's file touches over the active layout.
	const toolLog = useAtomValue(toolEventLogAtom)
	const [replayActive, setReplayActive] = useState(false)
	const [replayPlaying, setReplayPlaying] = useState(false)
	const [replayMs, setReplayMs] = useState(0)
	const replayMsRef = useRef(0)

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

	// TEMP debug readout — live container/canvas/window sizes to diagnose clipping.
	const [dbg, setDbg] = useState("")
	useEffect(() => {
		const tick = () => {
			const el = containerRef.current
			if (!el) return
			const er = el.getBoundingClientRect()
			const c = el.querySelector("canvas")
			const cr = c ? c.getBoundingClientRect() : null
			setDbg(
				`cont ${Math.round(er.width)}x${Math.round(er.height)} top${Math.round(er.top)} bot${Math.round(er.bottom)} | win ${window.innerWidth}x${window.innerHeight} | canvas ${cr ? `${Math.round(cr.width)}x${Math.round(cr.height)} bot${Math.round(cr.bottom)}` : "-"}`,
			)
		}
		tick()
		const id = setInterval(tick, 400)
		return () => clearInterval(id)
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

	// Latest interaction state, mirrored into a ref so the long-lived Force / 3D
	// draw loops can read it each frame without being torn down and rebuilt on
	// every hover / selection / search change.
	const drawStateRef = useRef({ hovered, selected, matchingIds, hiddenClusters })
	drawStateRef.current = { hovered, selected, matchingIds, hiddenClusters }

	// Deterministic layout for the two STATIC modes (Ring / Tree). Positions are
	// computed over ALL nodes (hiding a cluster just skips drawing it), so the
	// picture never re-flows when clusters are toggled. The LIVE modes (Force /
	// 3D) run their own simulation loops and don't use this memo (→ null).
	const staticScene = useMemo<Scene | null>(() => {
		if (!data || data.nodes.length === 0) return null
		if (layoutMode !== "ring" && layoutMode !== "tree") return null
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

	// The scene that hit-testing and replay should read for the ACTIVE layout:
	//   • ring / tree → the deterministic static scene above.
	//   • force       → a live scene assembled from the simulation's current
	//                    (or settled/frozen) node positions.
	//   • 3d          → null (replay + 2D hit-testing are disabled in 3D v1).
	const getScene = useCallback((): Scene | null => {
		if (layoutMode === "ring" || layoutMode === "tree") return staticScene
		if (layoutMode === "force") {
			const fnodes = forceNodesRef.current
			if (!data || !fnodes || fnodes.length === 0) return null
			const points: PositionedNode[] = []
			const byId = new Map<string, PositionedNode>()
			for (const fn of fnodes) {
				const p: PositionedNode = { node: fn.node, x: fn.x ?? 0, y: fn.y ?? 0, r: fn.r }
				points.push(p)
				byId.set(fn.node.id, p)
			}
			const refEdges: RefEdge[] = []
			for (const e of data.edges) {
				const A = byId.get(e.source)
				const B = byId.get(e.target)
				if (A && B) refEdges.push({ a: A, b: B })
			}
			return { points, byId, refEdges, branches: [], labels: [], cx: width / 2, cy: HEIGHT / 2 }
		}
		return null
	}, [layoutMode, staticScene, data, width])

	// Build the replay trace: turn the session's logged file touches into an
	// ordered list of fixations, each mapped to the symbol-nodes in that file.
	// Matching is layout-independent (depends only on data + log), so it survives
	// switching between Ring and Tree. A logged absolute path like
	// `/abs/proj/src/auth/login.ts` matches a node whose `file` is a path suffix
	// of it (`src/auth/login.ts`); failing that, it falls back to basename.
	const fixations = useMemo<Fixation[]>(() => {
		if (!data || toolLog.length === 0) return []
		const norm = (s: string) => s.replace(/\\/g, "/")
		// Unique node-file → ids, plus a basename → ids fallback index.
		const byFile = new Map<string, string[]>()
		for (const n of data.nodes) {
			const nf = norm(n.file)
			const arr = byFile.get(nf)
			if (arr) arr.push(n.id)
			else byFile.set(nf, [n.id])
		}
		const byBase = new Map<string, string[]>()
		for (const [nf, ids] of byFile) {
			const base = nf.split("/").pop() || nf
			const arr = byBase.get(base)
			if (arr) arr.push(...ids)
			else byBase.set(base, [...ids])
		}

		const matchNodes = (loggedPath: string): { ids: string[]; repFile: string } => {
			const nl = norm(loggedPath)
			// Prefer the longest node-file that is a path-suffix of (or contains) the
			// logged path — the most specific match wins.
			let bestFile = ""
			let bestLen = -1
			for (const [nf] of byFile) {
				const suffix = nl === nf || nl.endsWith(`/${nf}`) || nf.endsWith(`/${nl}`)
				if (suffix && nf.length > bestLen) {
					bestLen = nf.length
					bestFile = nf
				}
			}
			if (bestFile) return { ids: byFile.get(bestFile) ?? [], repFile: baseName(bestFile) }
			// Fallback: basename match.
			const base = nl.split("/").pop() || nl
			const ids = byBase.get(base)
			if (ids && ids.length) return { ids, repFile: base }
			return { ids: [], repFile: base }
		}

		const out: Fixation[] = []
		let prevRep: string | null = null
		for (const entry of toolLog) {
			if (!entry.filePath) continue
			const { ids, repFile } = matchNodes(entry.filePath)
			if (ids.length === 0) continue // logged file matched no node — skip
			// Collapse consecutive touches of the same file so the ember trail always
			// moves and each step is a distinct hop.
			if (repFile === prevRep) continue
			out.push({ seq: entry.seq, tool: entry.tool, nodeIds: ids, repFile })
			prevRep = repFile
		}
		return out
	}, [data, toolLog])

	// Replay is a 2D-only affordance: it's disabled in the 3D layout for now.
	const canReplay = replayActive && fixations.length > 0 && layoutMode !== "3d"

	// Centroid of a fixation's nodes in a given scene (Ring / Tree static scene,
	// or the Force layout's live scene) — tracks whichever 2D layout is active.
	const fixationPoint = useCallback(
		(f: Fixation, scene: Scene): { x: number; y: number } | null => {
			let sx = 0
			let sy = 0
			let count = 0
			for (const id of f.nodeIds) {
				const p = scene.byId.get(id)
				if (p) {
					sx += p.x
					sy += p.y
					count++
				}
			}
			if (count === 0) return null
			return { x: sx / count, y: sy / count }
		},
		[],
	)

	// Draw a single replay frame at time `ms`. Only this path uses glow.
	const drawReplay = useCallback(
		(ms: number) => {
			const canvas = canvasRef.current
			const scene = getScene()
			if (!canvas || !scene || fixations.length === 0) return
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

			const css = getComputedStyle(document.documentElement)
			const cMuted = css.getPropertyValue("--muted-foreground").trim() || "#7a7a7a"
			const cForeground = css.getPropertyValue("--foreground").trim() || "#0d0d0d"

			const idx = Math.min(fixations.length - 1, Math.floor(ms / REPLAY_STEP_MS))
			const local = Math.max(0, Math.min(1, (ms - idx * REPLAY_STEP_MS) / REPLAY_STEP_MS))

			// 1) Dim base graph — faint reference chords + dim dots, no glow.
			ctx.lineWidth = 0.5
			for (const e of scene.refEdges) {
				ctx.strokeStyle = withAlpha(cMuted, 0.05)
				ctx.beginPath()
				ctx.moveTo(e.a.x, e.a.y)
				ctx.quadraticCurveTo(scene.cx, scene.cy, e.b.x, e.b.y)
				ctx.stroke()
			}
			for (const p of scene.points) {
				ctx.beginPath()
				ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
				ctx.fillStyle = withAlpha(colorFor(p.node.cluster), 0.12)
				ctx.fill()
			}

			// 2) Fading heatmap — every touched-so-far node keeps a glow that decays
			//    with recency; the current fixation is brightest.
			const heat = new Map<string, { intensity: number; tool: string }>()
			for (let j = 0; j <= idx; j++) {
				const f = fixations[j]
				const intensity = j === idx ? 0.6 + 0.4 * local : Math.max(0.08, 0.7 * 0.78 ** (idx - j))
				for (const id of f.nodeIds) {
					const cur = heat.get(id)
					if (!cur || cur.intensity < intensity) heat.set(id, { intensity, tool: f.tool })
				}
			}

			// 3) Ember trails — faint completed hops, plus the current hop drawn in as
			//    the fixation animates (quadratic bézier bowed away from centre).
			const drawTrail = (
				from: { x: number; y: number },
				to: { x: number; y: number },
				progress: number,
				alpha: number,
			) => {
				const mx = (from.x + to.x) / 2
				const my = (from.y + to.y) / 2
				const dx = to.x - from.x
				const dy = to.y - from.y
				const len = Math.hypot(dx, dy) || 1
				const bow = Math.min(60, len * 0.28)
				// Perpendicular, pushed away from the graph centre for a consistent bow.
				let nx = -dy / len
				let ny = dx / len
				if ((mx - scene.cx) * nx + (my - scene.cy) * ny < 0) {
					nx = -nx
					ny = -ny
				}
				const ctrl = { x: mx + nx * bow, y: my + ny * bow }
				ctx.strokeStyle = withAlpha(EMBER_COLOR, alpha)
				ctx.lineWidth = 1.6
				ctx.shadowColor = withAlpha(EMBER_COLOR, alpha)
				ctx.shadowBlur = 8
				ctx.beginPath()
				const steps = 24
				const end = Math.max(0.0001, progress)
				for (let s = 0; s <= steps; s++) {
					const t = (s / steps) * end
					const pt = quadPoint(from, ctrl, to, t)
					if (s === 0) ctx.moveTo(pt.x, pt.y)
					else ctx.lineTo(pt.x, pt.y)
				}
				ctx.stroke()
				ctx.shadowBlur = 0
			}
			for (let j = 1; j <= idx; j++) {
				const a = fixationPoint(fixations[j - 1], scene)
				const b = fixationPoint(fixations[j], scene)
				if (a && b) drawTrail(a, b, 1, 0.18)
			}
			if (idx >= 1) {
				const a = fixationPoint(fixations[idx - 1], scene)
				const b = fixationPoint(fixations[idx], scene)
				if (a && b) drawTrail(a, b, local, 0.85)
			}

			// 4) Glowing nodes for the heatmap.
			for (const p of scene.points) {
				const hot = heat.get(p.node.id)
				if (!hot) continue
				const color = toolGlowColor(hot.tool)
				const rad = p.r + (hot.intensity > 0.55 ? 2 : 0.5)
				ctx.shadowColor = withAlpha(color, hot.intensity)
				ctx.shadowBlur = 6 + hot.intensity * 12
				ctx.beginPath()
				ctx.arc(p.x, p.y, rad, 0, Math.PI * 2)
				ctx.fillStyle = withAlpha(color, Math.min(1, 0.35 + hot.intensity * 0.65))
				ctx.fill()
				ctx.shadowBlur = 0
			}

			// 5) Caption the current file near its centroid.
			const cur = fixations[idx]
			const pt = fixationPoint(cur, scene)
			if (pt) {
				ctx.font = "10px 'Inter Variable', Inter, sans-serif"
				ctx.textAlign = "center"
				ctx.textBaseline = "bottom"
				ctx.fillStyle = withAlpha(cForeground, 0.9)
				ctx.fillText(cur.repFile, pt.x, pt.y - 10)
			}
			ctx.globalAlpha = 1
		},
		[getScene, fixations, width, fixationPoint],
	)

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
		// In Replay mode the dedicated replay effects own the canvas.
		if (canReplay) return
		// The LIVE modes (Force / 3D) own the canvas via their own loops below.
		if (layoutMode === "force" || layoutMode === "3d") return
		const scene = staticScene
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
	}, [staticScene, width, hiddenClusters, matchingIds, selected, hovered, layoutMode, canReplay])

	// Replay playback loop — advances the clock and redraws each frame while playing.
	useEffect(() => {
		if (!canReplay || !replayPlaying) return
		const total = fixations.length * REPLAY_STEP_MS
		let raf = 0
		let last = performance.now()
		const tick = (now: number) => {
			const dt = now - last
			last = now
			replayMsRef.current = Math.min(total, replayMsRef.current + dt)
			setReplayMs(replayMsRef.current)
			drawReplay(replayMsRef.current)
			if (replayMsRef.current >= total) {
				setReplayPlaying(false)
				return
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [canReplay, replayPlaying, fixations, drawReplay])

	// Static replay frame — draws the current scrub position while paused (and on
	// scrub / layout change). The playback loop owns drawing while playing.
	useEffect(() => {
		if (!canReplay || replayPlaying) return
		drawReplay(replayMsRef.current)
	}, [canReplay, replayPlaying, replayMs, drawReplay])

	// ── FORCE layout (2D, default) ──────────────────────────────────────────────
	// A live Obsidian-style d3-force simulation, ticked by a requestAnimationFrame
	// loop until it cools (alphaMin) and then idles. The loop owns the canvas while
	// Force is the active, non-replay mode. Interaction state is read from a ref so
	// this effect is NOT rebuilt on every hover/select (which would restart the sim).
	useEffect(() => {
		if (layoutMode !== "force" || canReplay) return
		if (!data || data.nodes.length === 0) return
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext("2d")
		if (!ctx) return

		const w = width
		const h = HEIGHT
		const cx = w / 2
		const cy = h / 2

		// Seed on a small ring around centre so nodes expand outward smoothly
		// (avoids the default top-left phyllotaxis spiral jumping into frame).
		const nodes: ForceNode[] = data.nodes.map((n, i) => {
			const ang = (i / Math.max(1, data.nodes.length)) * Math.PI * 2
			const rad = 24 + (i % 9) * 5
			return {
				id: n.id,
				node: n,
				r: dotRadius(n.refCount),
				x: cx + Math.cos(ang) * rad,
				y: cy + Math.sin(ang) * rad,
			}
		})
		const links: ForceLinkDatum[] = data.edges.map((e) => ({ source: e.source, target: e.target }))
		forceNodesRef.current = nodes

		const sim: Simulation<ForceNode, ForceLinkDatum> = forceSimulation<ForceNode>(nodes)
			.force("charge", forceManyBody<ForceNode>().strength(-34))
			.force(
				"link",
				forceLink<ForceNode, ForceLinkDatum>(links)
					.id((d) => d.id)
					.distance(30)
					.strength(0.5),
			)
			.force("center", forceCenter<ForceNode>(cx, cy))
			.force("collide", forceCollide<ForceNode>().radius((d) => d.r + 3))
			.alphaMin(0.02)
			.alphaDecay(0.035)
		sim.stop() // we drive ticks by hand via rAF

		const draw = () => {
			const dpr = window.devicePixelRatio || 1
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			canvas.style.width = `${w}px`
			canvas.style.height = `${h}px`
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			ctx.clearRect(0, 0, w, h)

			const css = getComputedStyle(document.documentElement)
			const cForeground = css.getPropertyValue("--foreground").trim() || "#0d0d0d"
			const cRing = css.getPropertyValue("--ring").trim() || "#0080bd"

			const { hovered, selected, matchingIds, hiddenClusters } = drawStateRef.current
			const isVisible = (n: RepoGraphNode) => !hiddenClusters.has(n.cluster)
			const searching = !!matchingIds

			// Links — faint, tinted toward the source cluster.
			ctx.lineWidth = 0.7
			for (const l of links) {
				const a = l.source
				const b = l.target
				if (typeof a === "string" || typeof b === "string") continue
				if (!isVisible(a.node) || !isVisible(b.node)) continue
				ctx.strokeStyle = withAlpha(colorFor(a.node.cluster), 0.1)
				ctx.beginPath()
				ctx.moveTo(a.x ?? 0, a.y ?? 0)
				ctx.lineTo(b.x ?? 0, b.y ?? 0)
				ctx.stroke()
			}

			// Dots.
			for (const nd of nodes) {
				if (!isVisible(nd.node)) continue
				const isSelected = selected?.id === nd.node.id
				const isMatch = matchingIds?.has(nd.node.id) ?? false
				const isHover = hovered === nd.node.id
				const dim = searching && !isMatch && !isSelected
				ctx.globalAlpha = dim ? 0.22 : 1
				ctx.beginPath()
				ctx.arc(nd.x ?? 0, nd.y ?? 0, nd.r, 0, Math.PI * 2)
				ctx.fillStyle = colorFor(nd.node.cluster)
				ctx.fill()
				if (isSelected || isMatch || isHover) {
					ctx.strokeStyle = cRing
					ctx.lineWidth = isSelected ? 2.5 : 1.5
					ctx.stroke()
				}
				ctx.globalAlpha = 1
			}

			// Restrained labels — selection / search-match / hover / high refCount.
			ctx.font = "9px 'Inter Variable', Inter, sans-serif"
			ctx.textAlign = "center"
			ctx.textBaseline = "bottom"
			ctx.fillStyle = cForeground
			for (const nd of nodes) {
				if (!isVisible(nd.node)) continue
				const isSelected = selected?.id === nd.node.id
				const isMatch = matchingIds?.has(nd.node.id) ?? false
				const isHover = hovered === nd.node.id
				if (!(isSelected || isMatch || isHover || nd.node.refCount >= 4)) continue
				ctx.globalAlpha = searching && !isMatch && !isSelected ? 0.35 : 1
				ctx.fillText(nd.node.name, nd.x ?? 0, (nd.y ?? 0) - nd.r - 3)
				ctx.globalAlpha = 1
			}
		}

		let raf = 0
		const frame = () => {
			raf = 0
			const settled = sim.alpha() < 0.02
			if (!settled) sim.tick()
			draw()
			if (!settled) raf = requestAnimationFrame(frame)
		}
		const ensureLoop = () => {
			if (!raf) raf = requestAnimationFrame(frame)
		}
		ensureLoop()

		// Expose imperative handles: redraw on interaction change, reheat on demand.
		redrawForceRef.current = draw
		reheatForceRef.current = () => {
			sim.alpha(0.7)
			ensureLoop()
		}

		// Optional: drag a node to reposition + reheat (fix while dragging).
		let dragging: ForceNode | null = null
		const nodeAt = (clientX: number, clientY: number): ForceNode | null => {
			const rect = canvas.getBoundingClientRect()
			const px = clientX - rect.left
			const py = clientY - rect.top
			let best: ForceNode | null = null
			let bestDist = Number.POSITIVE_INFINITY
			for (const nd of nodes) {
				if (drawStateRef.current.hiddenClusters.has(nd.node.cluster)) continue
				const dx = px - (nd.x ?? 0)
				const dy = py - (nd.y ?? 0)
				const d = Math.hypot(dx, dy)
				const threshold = Math.max(nd.r + 5, 9)
				if (d <= threshold && d < bestDist) {
					bestDist = d
					best = nd
				}
			}
			return best
		}
		const onDown = (e: MouseEvent) => {
			const nd = nodeAt(e.clientX, e.clientY)
			if (!nd) return
			dragging = nd
			sim.alpha(0.5)
			ensureLoop()
		}
		const onMove = (e: MouseEvent) => {
			if (!dragging) return
			const rect = canvas.getBoundingClientRect()
			dragging.fx = e.clientX - rect.left
			dragging.fy = e.clientY - rect.top
			sim.alpha(0.5)
			ensureLoop()
		}
		const onUp = () => {
			if (!dragging) return
			dragging.fx = null
			dragging.fy = null
			dragging = null
		}
		canvas.addEventListener("mousedown", onDown)
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)

		return () => {
			if (raf) cancelAnimationFrame(raf)
			sim.stop()
			canvas.removeEventListener("mousedown", onDown)
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
			redrawForceRef.current = null
			reheatForceRef.current = null
			// forceNodesRef is intentionally NOT cleared — replay reads the settled
			// positions after handing off, and the next Force entry rebuilds it.
		}
	}, [layoutMode, canReplay, data, width])

	// While Force idles (settled), push a one-off redraw when interaction state
	// changes so hover / selection / search / cluster-hide stay responsive.
	useEffect(() => {
		if (layoutMode !== "force" || canReplay) return
		redrawForceRef.current?.()
	}, [layoutMode, canReplay, hovered, selected, matchingIds, hiddenClusters, width])

	// ── 3D layout ───────────────────────────────────────────────────────────────
	// Hand-rolled 3D force (no external 3D lib — CSP blocks CDNs): pairwise
	// repulsion with a distance cutoff, link springs, mild gravity, damped velocity
	// and alpha decay. Rendered by rotating each node (Y then X), projecting with
	// perspective, depth-sorting back-to-front, and fogging far nodes. Drag orbits;
	// a gentle auto-orbit runs when idle. Hover/select are skipped in 3D v1.
	useEffect(() => {
		if (layoutMode !== "3d") return
		if (!data || data.nodes.length === 0) return
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext("2d")
		if (!ctx) return

		const w = width
		const h = HEIGHT
		const cx = w / 2
		const cy = h / 2
		const focal = 520

		// Deterministic pseudo-random seed so the cloud is stable across renders.
		const rand = (seed: number) => {
			const x = Math.sin(seed * 12.9898) * 43758.5453
			return x - Math.floor(x)
		}
		const nodes: Node3D[] = data.nodes.map((n, i) => ({
			node: n,
			r: dotRadius(n.refCount),
			x: (rand(i + 1) - 0.5) * 220,
			y: (rand(i + 97) - 0.5) * 220,
			z: (rand(i + 211) - 0.5) * 220,
			vx: 0,
			vy: 0,
			vz: 0,
		}))
		const index = new Map<string, number>()
		nodes.forEach((nd, i) => index.set(nd.node.id, i))
		const links: [number, number][] = []
		for (const e of data.edges) {
			const a = index.get(e.source)
			const b = index.get(e.target)
			if (a !== undefined && b !== undefined && a !== b) links.push([a, b])
		}

		// Physics constants.
		const REST = 46
		const CUTOFF = 200
		const CUTOFF2 = CUTOFF * CUTOFF
		const REPULSION = 900
		const SPRING = 0.02
		const GRAVITY = 0.008
		const DAMPING = 0.86
		const ALPHA_DECAY = 0.018
		const ALPHA_MIN = 0.02
		let alpha = 1

		const step = () => {
			// Pairwise repulsion (distance-cutoff limited).
			for (let i = 0; i < nodes.length; i++) {
				const a = nodes[i]
				for (let j = i + 1; j < nodes.length; j++) {
					const b = nodes[j]
					let dx = a.x - b.x
					let dy = a.y - b.y
					let dz = a.z - b.z
					const d2 = dx * dx + dy * dy + dz * dz
					if (d2 > CUTOFF2) continue
					let d = Math.sqrt(d2)
					if (d < 0.01) {
						dx = rand(i + j + 1) - 0.5
						dy = rand(i * 3 + j + 2) - 0.5
						dz = rand(i + j * 3 + 3) - 0.5
						d = 1
					}
					const f = ((REPULSION / d2) * alpha) / d
					a.vx += dx * f
					a.vy += dy * f
					a.vz += dz * f
					b.vx -= dx * f
					b.vy -= dy * f
					b.vz -= dz * f
				}
			}
			// Link springs toward a rest length.
			for (const [i, j] of links) {
				const a = nodes[i]
				const b = nodes[j]
				const dx = b.x - a.x
				const dy = b.y - a.y
				const dz = b.z - a.z
				const d = Math.hypot(dx, dy, dz) || 0.01
				const f = ((d - REST) * SPRING * alpha) / d
				a.vx += dx * f
				a.vy += dy * f
				a.vz += dz * f
				b.vx -= dx * f
				b.vy -= dy * f
				b.vz -= dz * f
			}
			// Gravity to origin, integrate, damp.
			for (const nd of nodes) {
				nd.vx -= nd.x * GRAVITY * alpha
				nd.vy -= nd.y * GRAVITY * alpha
				nd.vz -= nd.z * GRAVITY * alpha
				nd.vx *= DAMPING
				nd.vy *= DAMPING
				nd.vz *= DAMPING
				nd.x += nd.vx
				nd.y += nd.vy
				nd.z += nd.vz
			}
		}

		let rotX = 0.5
		let rotY = 0.4
		let dragging = false
		let lastX = 0
		let lastY = 0

		const draw = () => {
			const dpr = window.devicePixelRatio || 1
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			canvas.style.width = `${w}px`
			canvas.style.height = `${h}px`
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			ctx.clearRect(0, 0, w, h)

			const { matchingIds, hiddenClusters } = drawStateRef.current
			const searching = !!matchingIds

			if (autoOrbitRef.current && !dragging) rotY += 0.0035
			const cosY = Math.cos(rotY)
			const sinY = Math.sin(rotY)
			const cosX = Math.cos(rotX)
			const sinX = Math.sin(rotX)

			const proj = nodes.map((nd) => {
				// Rotate around Y, then around X.
				const x1 = nd.x * cosY - nd.z * sinY
				const z1 = nd.x * sinY + nd.z * cosY
				const y2 = nd.y * cosX - z1 * sinX
				const z2 = nd.y * sinX + z1 * cosX
				const scale = focal / (focal + z2)
				return { nd, sx: cx + x1 * scale, sy: cy + y2 * scale, z: z2, scale }
			})

			let zmin = Number.POSITIVE_INFINITY
			let zmax = Number.NEGATIVE_INFINITY
			for (const p of proj) {
				if (p.z < zmin) zmin = p.z
				if (p.z > zmax) zmax = p.z
			}
			const zspan = zmax - zmin || 1
			// Near (small z) bright, far (large z) dim — fog.
			const fog = (z: number) => 1 - ((z - zmin) / zspan) * 0.72

			// Links first, faint, fogged by the nearer endpoint.
			ctx.lineWidth = 0.6
			for (const [i, j] of links) {
				const a = proj[i]
				const b = proj[j]
				if (hiddenClusters.has(a.nd.node.cluster) || hiddenClusters.has(b.nd.node.cluster)) continue
				const alp = Math.min(fog(a.z), fog(b.z)) * 0.12
				ctx.strokeStyle = withAlpha(colorFor(a.nd.node.cluster), alp)
				ctx.beginPath()
				ctx.moveTo(a.sx, a.sy)
				ctx.lineTo(b.sx, b.sy)
				ctx.stroke()
			}

			// Dots back-to-front (farthest first).
			const order = proj.map((_, i) => i).sort((i, j) => proj[j].z - proj[i].z)
			for (const oi of order) {
				const p = proj[oi]
				if (hiddenClusters.has(p.nd.node.cluster)) continue
				const isMatch = matchingIds?.has(p.nd.node.id) ?? false
				let a = fog(p.z)
				if (searching && !isMatch) a *= 0.3
				a = Math.max(0.05, Math.min(1, a))
				const rad = Math.max(1, p.nd.r * p.scale)
				// Soft glow on high-connectivity hubs.
				if (p.nd.node.refCount >= 4) {
					ctx.shadowColor = withAlpha(colorFor(p.nd.node.cluster), a * 0.7)
					ctx.shadowBlur = 6
				}
				ctx.globalAlpha = a
				ctx.beginPath()
				ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2)
				ctx.fillStyle = colorFor(p.nd.node.cluster)
				ctx.fill()
				ctx.shadowBlur = 0
				ctx.globalAlpha = 1
			}
		}

		let raf = 0
		const frame = () => {
			if (alpha > ALPHA_MIN) {
				step()
				alpha *= 1 - ALPHA_DECAY
			}
			draw()
			raf = requestAnimationFrame(frame) // keep looping for auto-orbit
		}
		raf = requestAnimationFrame(frame)

		const onDown = (e: MouseEvent) => {
			dragging = true
			lastX = e.clientX
			lastY = e.clientY
		}
		const onMove = (e: MouseEvent) => {
			if (!dragging) return
			rotY += (e.clientX - lastX) * 0.01
			rotX += (e.clientY - lastY) * 0.01
			rotX = Math.max(-1.4, Math.min(1.4, rotX))
			lastX = e.clientX
			lastY = e.clientY
		}
		const onUp = () => {
			dragging = false
		}
		canvas.addEventListener("mousedown", onDown)
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)

		return () => {
			if (raf) cancelAnimationFrame(raf)
			canvas.removeEventListener("mousedown", onDown)
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
	}, [layoutMode, data, width])

	// Replay is 2D-only: leaving for the 3D layout tears any active replay down.
	useEffect(() => {
		if (layoutMode === "3d" && replayActive) {
			setReplayPlaying(false)
			setReplayActive(false)
		}
	}, [layoutMode, replayActive])

	// Nearest-node hit-test in canvas-local (CSS px) coordinates.
	const hitTest = (clientX: number, clientY: number): RepoGraphNode | null => {
		const canvas = canvasRef.current
		const scene = getScene()
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

	const totalReplayMs = fixations.length * REPLAY_STEP_MS
	const replayIdx = fixations.length ? Math.min(fixations.length - 1, Math.floor(replayMs / REPLAY_STEP_MS)) : 0

	const enterReplay = () => {
		replayMsRef.current = 0
		setReplayMs(0)
		setReplayActive(true)
		setReplayPlaying(fixations.length > 0)
	}
	const exitReplay = () => {
		setReplayPlaying(false)
		setReplayActive(false)
	}
	const toggleReplayPlay = () => {
		if (replayPlaying) {
			setReplayPlaying(false)
			return
		}
		// Restart from the top if we're parked at the end.
		if (replayMsRef.current >= totalReplayMs) {
			replayMsRef.current = 0
			setReplayMs(0)
		}
		setReplayPlaying(true)
	}
	const scrubReplay = (ms: number) => {
		replayMsRef.current = ms
		setReplayMs(ms)
		setReplayPlaying(false)
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
				<div ref={containerRef} className="relative flex flex-1 flex-col overflow-hidden">
					<div className="pointer-events-none absolute top-1 left-1 z-[100] rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white">
						{dbg}
					</div>
					{!data ? (
						<div className="flex h-full items-center justify-center text-muted-foreground text-sm">Scanning…</div>
					) : (
						// biome-ignore lint: canvas interactive surface; keyboard users use the sidebar list/search instead
						<canvas
							ref={canvasRef}
							onClick={(e) => {
								// Selection is disabled during replay so clicks don't fight the animation.
								if (replayActive) return
								setSelected(hitTest(e.clientX, e.clientY))
							}}
							onMouseMove={(e) => {
								if (replayActive) return
								setHovered(hitTest(e.clientX, e.clientY)?.id ?? null)
							}}
							onMouseLeave={() => setHovered(null)}
							style={{ cursor: replayActive ? "default" : hovered ? "pointer" : "default" }}
						/>
					)}
					{/* 3D auto-orbit pause/play. */}
					{data && layoutMode === "3d" && (
						<button
							type="button"
							onClick={() => setAutoOrbit((v) => !v)}
							className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-2 py-1 text-muted-foreground text-xs backdrop-blur hover:text-foreground"
						>
							{autoOrbit ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
							Orbit
						</button>
					)}
					{/* Force: nudge the simulation to re-settle. */}
					{data && layoutMode === "force" && !replayActive && (
						<button
							type="button"
							onClick={() => reheatForceRef.current?.()}
							className="absolute bottom-2 left-2 rounded-md border border-border bg-background/80 px-2 py-1 text-muted-foreground text-xs backdrop-blur hover:text-foreground"
						>
							Re-settle
						</button>
					)}
					{data && replayActive && (
						<div className="border-border border-t px-3 py-2">
							{fixations.length === 0 ? (
								<div className="text-muted-foreground text-xs">No recent session activity to replay</div>
							) : (
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={toggleReplayPlay}
										className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted"
										aria-label={replayPlaying ? "Pause replay" : "Play replay"}
									>
										{replayPlaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
									</button>
									<input
										type="range"
										min={0}
										max={Math.max(1, totalReplayMs)}
										step={10}
										value={Math.min(replayMs, totalReplayMs)}
										onChange={(e) => scrubReplay(Number(e.target.value))}
										className="h-1 flex-1 cursor-pointer accent-[color:var(--ring)]"
										aria-label="Replay position"
									/>
									<span className="shrink-0 tabular-nums text-muted-foreground text-xs">
										{replayIdx + 1}/{fixations.length}
									</span>
								</div>
							)}
						</div>
					)}
				</div>
				<div className="w-56 shrink-0 overflow-y-auto border-border border-l p-3">
					<div className="mb-3 inline-flex w-full rounded-md border border-border bg-muted/40 p-0.5">
						{LAYOUT_MODES.map(({ id, label }) => (
							<button
								key={id}
								type="button"
								onClick={() => setLayoutMode(id)}
								className={`flex-1 rounded-[5px] px-1.5 py-1 text-xs transition-colors ${
									layoutMode === id
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					{/* Replay is a 2D-only affordance — hidden while the 3D layout is active. */}
					{layoutMode !== "3d" && (
						<button
							type="button"
							onClick={replayActive ? exitReplay : enterReplay}
							className={`mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
								replayActive
									? "border-[color:var(--ring)] bg-[color:var(--ring)]/10 text-foreground"
									: "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
							}`}
						>
							<PlayIcon className="size-3" />
							{replayActive ? "Exit replay" : "Replay session"}
						</button>
					)}
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
