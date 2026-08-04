/**
 * Codebase graph — an interactive, 2D view of how a project's symbols
 * reference each other. Styled after Obsidian's graph view (small unlabeled
 * dots by default, labels only on selection/search-match/high-connectivity,
 * a restrained muted palette) rather than a dense force-directed "hairball" —
 * see the design discussion this came out of. Pure client-side layout via
 * d3-force; the app already had it as a transitive dependency, now a direct
 * one. Data comes from `getRepoGraph`, a simpler standalone reimplementation
 * of the agent's repo_map plugin logic (different runtime, no shared import
 * possible — see repo-graph.ts for why).
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force"
import { SearchIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

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

type SimNode = RepoGraphNode & SimulationNodeDatum
interface RenderedLink {
	source: SimNode
	target: SimNode
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

const WIDTH = 760
const HEIGHT = 520

export function CodebaseGraph({ directory, onClose }: { directory: string; onClose: () => void }) {
	const [data, setData] = useState<RepoGraphData | null>(null)
	const [nodes, setNodes] = useState<SimNode[]>([])
	const [links, setLinks] = useState<RenderedLink[]>([])
	const [selected, setSelected] = useState<SimNode | null>(null)
	const [query, setQuery] = useState("")
	const [hiddenClusters, setHiddenClusters] = useState<Set<string>>(new Set())

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

	useEffect(() => {
		if (!data) return
		const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }))
		const idSet = new Set(simNodes.map((n) => n.id))
		const simLinks = data.edges
			.filter((e) => idSet.has(e.source) && idSet.has(e.target))
			// biome-ignore lint: d3-force's own types want string|Node here; string in, Node out after tick
			.map((e) => ({ source: e.source as any, target: e.target as any }))

		const sim = forceSimulation(simNodes)
			.force("charge", forceManyBody().strength(-60))
			.force(
				"link",
				forceLink(simLinks)
					.id((d) => (d as SimNode).id)
					.distance(38)
					.strength(0.35),
			)
			.force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
			.force("collide", forceCollide(10))
			.stop()
		for (let i = 0; i < 220; i++) sim.tick()

		setNodes(simNodes)
		setLinks(simLinks as unknown as RenderedLink[])
	}, [data])

	const clusters = useMemo(() => {
		if (!data) return []
		const counts = new Map<string, number>()
		for (const n of data.nodes) counts.set(n.cluster, (counts.get(n.cluster) || 0) + 1)
		return [...counts.entries()].sort((a, b) => b[1] - a[1])
	}, [data])

	const queryLower = query.trim().toLowerCase()
	const matchingIds = useMemo(() => {
		if (!queryLower) return null
		return new Set(nodes.filter((n) => n.name.toLowerCase().includes(queryLower)).map((n) => n.id))
	}, [nodes, queryLower])

	const visibleIds = useMemo(
		() => new Set(nodes.filter((n) => !hiddenClusters.has(n.cluster)).map((n) => n.id)),
		[nodes, hiddenClusters],
	)

	const toggleCluster = (name: string) => {
		setHiddenClusters((prev) => {
			const next = new Set(prev)
			if (next.has(name)) next.delete(name)
			else next.add(name)
			return next
		})
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
				<div className="relative flex-1 overflow-hidden">
					{!data ? (
						<div className="flex h-full items-center justify-center text-muted-foreground text-sm">Scanning…</div>
					) : (
						<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
							<title>Interactive codebase symbol graph</title>
							<g>
								{links.map((l) => {
									if (!visibleIds.has(l.source.id) || !visibleIds.has(l.target.id)) return null
									return (
										<line
											key={`${l.source.id}->${l.target.id}`}
											x1={l.source.x}
											y1={l.source.y}
											x2={l.target.x}
											y2={l.target.y}
											stroke="var(--border)"
											strokeWidth={0.6}
											opacity={0.6}
										/>
									)
								})}
							</g>
							<g>
								{nodes.map((n) => {
									if (!visibleIds.has(n.id)) return null
									const isSelected = selected?.id === n.id
									const isMatch = matchingIds?.has(n.id)
									const dim = matchingIds ? !isMatch && !isSelected : false
									const r = Math.min(3 + n.refCount * 0.8, 9)
									return (
										// biome-ignore lint: SVG interactive node, keyboard users use the sidebar list instead
										<g key={n.id} onClick={() => setSelected(n)} style={{ cursor: "pointer" }} opacity={dim ? 0.25 : 1}>
											<circle
												cx={n.x}
												cy={n.y}
												r={r}
												fill={colorFor(n.cluster)}
												stroke={isSelected || isMatch ? "var(--ring)" : "none"}
												strokeWidth={isSelected ? 2.5 : 1.5}
											/>
											{(isSelected || isMatch || n.refCount >= 4) && (
												<text
													x={n.x}
													y={(n.y ?? 0) - r - 4}
													textAnchor="middle"
													fontSize={9}
													fill="var(--foreground)"
												>
													{n.name}
												</text>
											)}
										</g>
									)
								})}
							</g>
						</svg>
					)}
				</div>
				<div className="w-56 shrink-0 overflow-y-auto border-border border-l p-3">
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
							<div className="text-muted-foreground">referenced in {selected.refCount} file{selected.refCount === 1 ? "" : "s"}</div>
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
