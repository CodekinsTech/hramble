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
	const [layoutMode, setLayoutMode] = useState<LayoutMode>("ring")

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

	const canReplay = replayActive && fixations.length > 0

	// Centroid of a fixation's nodes in the current layout (positions come from
	// `scene`, so this tracks whichever layout is active).
	const fixationPoint = useCallback(
		(f: Fixation): { x: number; y: number } | null => {
			if (!scene) return null
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
		[scene],
	)

	// Draw a single replay frame at time `ms`. Only this path uses glow.
	const drawReplay = useCallback(
		(ms: number) => {
			const canvas = canvasRef.current
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
				const a = fixationPoint(fixations[j - 1])
				const b = fixationPoint(fixations[j])
				if (a && b) drawTrail(a, b, 1, 0.18)
			}
			if (idx >= 1) {
				const a = fixationPoint(fixations[idx - 1])
				const b = fixationPoint(fixations[idx])
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
			const pt = fixationPoint(cur)
			if (pt) {
				ctx.font = "10px 'Inter Variable', Inter, sans-serif"
				ctx.textAlign = "center"
				ctx.textBaseline = "bottom"
				ctx.fillStyle = withAlpha(cForeground, 0.9)
				ctx.fillText(cur.repFile, pt.x, pt.y - 10)
			}
			ctx.globalAlpha = 1
		},
		[scene, fixations, width, fixationPoint],
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
	}, [scene, width, hiddenClusters, matchingIds, selected, hovered, layoutMode, canReplay])

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
