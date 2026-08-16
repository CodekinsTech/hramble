/**
 * Per-agent hub — lands here after picking a card on /templates. Shows who
 * the agent is, then either:
 *  - Website / Browser Game: a fixed vertical node-graph build path (see
 *    agent-graph-node.tsx) — reference sites/games + Inspect Design, a
 *    Design-Studio-vs-template fork, backend/legal/domain callouts, and the
 *    goal input + "Start session" all live inside graph nodes now.
 *  - The other 5 agents: the original plain card stack (reference/asset
 *    links, engine picker, Design Studio stub, filtered Community feed where
 *    the agent has one) ending in the same goal input + "Start session"
 *    action that used to live inline on the Templates card itself (see git
 *    history of templates-page.tsx for the old start() logic this was moved
 *    from, unchanged).
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtom, useSetAtom } from "jotai"
import {
	CheckIcon,
	ChevronDownIcon,
	DatabaseIcon,
	EyeIcon,
	GamepadIcon,
	GlobeIcon,
	PaletteIcon,
	PlayIcon,
	RssIcon,
	ScaleIcon,
	Volume2Icon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ACCENT_CAT_FILTERS, ACCENT_STYLES, getAgent } from "../lib/agent-catalog"
import { ConnectorIcon } from "../lib/connector-icons"
import { setDraftAtom } from "../atoms/preferences"
import { NEW_CHAT_DRAFT_KEY } from "../hooks/use-draft"
import { appStore } from "../atoms/store"
import { browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"
import { communityPanelOpenAtom, communityPanelTagAtom } from "../atoms/ui"
import { pendingHyperGoalAtom, workspaceModeAtom } from "../atoms/workspace"
import { GraphFork, GraphForkOption, GraphNode, GraphSpine } from "./agent-graph-node"
import { CommunityTagFeed } from "./community-tag-feed"
import catUrl from "../hramble-cat.png"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

type ConnectorPreset = { id: string; name: string; command: string[]; note: string; envKey?: string; urlPrompt?: string }

// Visual-only stand-in for `bridge().connectors.list()`'s real preset data,
// used ONLY when there's no Electron bridge (e.g. this page open via
// `dev:web` in a plain browser tab for a quick layout check) — so the section
// still has something to render instead of just disappearing. The real app
// always has a bridge and ignores this entirely. Covers every id referenced
// by any agent's connectorIds in agent-catalog.ts.
const BROWSER_PREVIEW_CONNECTOR_PRESETS: ConnectorPreset[] = [
	{ id: "figma", name: "Figma (design)", command: [], note: "Read Figma designs to build UI from them — free key at figma.com/developers/api", envKey: "FIGMA_API_KEY" },
	{ id: "stitch", name: "Stitch (Google UI design)", command: [], note: "Generate & edit UI screens with Google's Stitch — paste the MCP URL from stitch.withgoogle.com/docs/mcp/setup", urlPrompt: "Stitch MCP URL" },
	{ id: "github", name: "GitHub", command: [], note: "Repos, issues, PRs (needs a token env var)" },
	{ id: "supabase", name: "Supabase", command: [], note: "Postgres DB, auth, storage, edge functions, migrations, advisors — token at supabase.com/dashboard/account/tokens", envKey: "SUPABASE_ACCESS_TOKEN" },
	{ id: "postgres", name: "Postgres", command: [], note: "Query a Postgres database" },
	{ id: "cloudflare", name: "Cloudflare (Workers/R2/D1/KV)", command: [], note: "Build & manage Workers, R2, D1, KV, deploys — opens a browser once to authorize your Cloudflare account" },
	{ id: "firebase", name: "Firebase", command: [], note: "Firestore, Auth, Functions, Hosting — uses your Firebase CLI login" },
	{ id: "filesystem", name: "Filesystem", command: [], note: "Read/write files on your machine" },
	{ id: "playwright", name: "Browser (built-in)", command: [], note: "Drive a browser — navigate, click, type, fill & submit forms" },
	{ id: "playwright-chrome", name: "Browser (your Chrome)", command: [], note: "Drives your installed Chrome with your logged-in sessions" },
	{ id: "chrome-devtools", name: "Chrome DevTools", command: [], note: "Inspect/debug pages" },
	{ id: "web-search", name: "Web Search (free)", command: [], note: "Search the web + read pages — DuckDuckGo, no API key" },
	{ id: "sequential-thinking", name: "Sequential Thinking", command: [], note: "Step-by-step reasoning for hard problems" },
]

export function AgentHubPage() {
	const { agentId } = useParams({ strict: false }) as { agentId?: string }
	const navigate = useNavigate()
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)
	const setPendingHyperGoal = useSetAtom(pendingHyperGoalAtom)
	const setBrowserUrl = useSetAtom(browserUrlAtom)
	const setBrowserOpen = useSetAtom(browserPanelOpenAtom)
	const [goal, setGoal] = useState("")
	const [feedOpen, setFeedOpen] = useState(false)
	const [connectorPresets, setConnectorPresets] = useState<ConnectorPreset[]>([])
	const [connectedNames, setConnectedNames] = useState<Set<string>>(new Set())

	const agent = getAgent(agentId)
	// Hooks above must run unconditionally; these only make sense once an
	// agent is found, so they're declared after the early return below via `agent?.` guards.
	const [engineId, setEngineId] = useState(() => agent?.enginePicker?.[0]?.id)

	// Live status straight from the same source Settings → Connectors reads,
	// so "already connected" here can never drift out of sync with that page.
	// Falls back to a static preview (no real "connect" action) when there's no
	// Electron bridge, e.g. this page open via `dev:web` for a layout check.
	useEffect(() => {
		const ids = agent?.connectorIds ?? []
		if (ids.length === 0) {
			setConnectorPresets([])
			return
		}
		if (!bridge()?.connectors) {
			setConnectorPresets(BROWSER_PREVIEW_CONNECTOR_PRESETS.filter((p) => ids.includes(p.id)))
			return
		}
		bridge()
			.connectors.list()
			.then((r: { installed?: { name: string }[]; presets?: ConnectorPreset[] }) => {
				setConnectedNames(new Set((r?.installed ?? []).map((i) => i.name)))
				setConnectorPresets((r?.presets ?? []).filter((p) => ids.includes(p.id)))
			})
			.catch(() => {})
	}, [agent?.connectorIds])

	const connectTool = async (preset: ConnectorPreset) => {
		if (!bridge()?.connectors) {
			toast.info("Preview only — this button doesn't connect anything here.", {
				description: "Open the real app to actually connect a tool.",
			})
			return
		}
		if (connectedNames.has(preset.id)) {
			navigate({ to: "/settings/connectors" })
			return
		}
		if (preset.urlPrompt) {
			const url = window.prompt(`${preset.name}\n\n${preset.note}\n\nPaste the ${preset.urlPrompt}:`)
			if (!url) return
			await bridge()?.connectors?.add({ name: preset.id, url: url.trim() })
			setConnectedNames((prev) => new Set(prev).add(preset.id))
			toast.success(`${preset.name} connected`, { description: "Restart Hramble in Settings → Connectors to apply it." })
			return
		}
		let environment: Record<string, string> | undefined
		if (preset.envKey) {
			const key = window.prompt(`${preset.name} needs an API key.\n\n${preset.note}\n\nPaste your ${preset.envKey}:`)
			if (!key) return
			environment = { [preset.envKey]: key.trim() }
		}
		await bridge()?.connectors?.add({ name: preset.id, command: preset.command, environment })
		setConnectedNames((prev) => new Set(prev).add(preset.id))
		toast.success(`${preset.name} connected`, { description: "Restart Hramble in Settings → Connectors to apply it." })
	}

	// Community panel — the real Community page, filtered to this agent's tag,
	// shown in the same right-hand slot the browser pane normally occupies
	// (see sidebar-layout.tsx). Website/Browser Game only.
	const [communityPanelOpen, setCommunityPanelOpen] = useAtom(communityPanelOpenAtom)
	const setCommunityPanelTag = useSetAtom(communityPanelTagAtom)
	const isGraphAgentForPanel = agent?.id === "website" || agent?.id === "browser-game"

	// Keep the panel's tag in sync with whichever hub page is actually being
	// viewed (agentId can change without this component unmounting), and
	// force it closed on any non-graph agent so the other 5 pages are never
	// affected by a panel left open from Website/Browser Game.
	useEffect(() => {
		if (!isGraphAgentForPanel) {
			if (communityPanelOpen) setCommunityPanelOpen(false)
			return
		}
		if (communityPanelOpen && agent?.communityTag) setCommunityPanelTag(agent.communityTag)
	}, [isGraphAgentForPanel, agent?.communityTag, communityPanelOpen, setCommunityPanelOpen, setCommunityPanelTag])

	// Leaving the hub page entirely (e.g. back to Templates, into a session)
	// restores the browser pane rather than leaving Community panel stuck open.
	useEffect(() => () => setCommunityPanelOpen(false), [setCommunityPanelOpen])

	const openCommunityPanel = () => {
		if (agent?.communityTag) setCommunityPanelTag(agent.communityTag)
		setCommunityPanelOpen(true)
	}
	const toggleCommunityPanel = () => {
		if (communityPanelOpen) setCommunityPanelOpen(false)
		else openCommunityPanel()
	}

	if (!agent) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-center">
				<p className="text-foreground text-sm">Unknown agent "{agentId}".</p>
				<button type="button" onClick={() => navigate({ to: "/templates" })} className="text-primary text-sm underline">
					Back to Templates
				</button>
			</div>
		)
	}

	const styles = ACCENT_STYLES[agent.accent]
	// Website and Browser Game get the fixed vertical node-graph layout (see
	// agent-graph-node.tsx); the other 5 agents keep the plain card stack below.
	// Same condition as isGraphAgentForPanel above (computed pre-guard for the
	// community-panel effects) — `agent` is just narrowed non-null here.
	const isGraphAgent = isGraphAgentForPanel

	const openInBrowser = (url: string) => {
		setBrowserUrl(url)
		setBrowserOpen(true)
	}

	// Unchanged from the old templates-page.tsx start() — same brief + goal
	// combination, same mode/draft/pending-goal wiring, same navigate target.
	// The only addition is appending the selected engine's briefNote, when
	// this agent has an enginePicker (Browser Game).
	const start = () => {
		if (!goal.trim()) return
		const engineNote = agent.enginePicker?.find((e) => e.id === engineId)?.briefNote
		const prompt = `${agent.brief}${engineNote ? `\n\n${engineNote}` : ""}\n\nGoal: ${goal.trim()}`
		setWorkspaceMode(agent.mode)
		if (agent.mode === "hyperloop") {
			setPendingHyperGoal(prompt)
		} else {
			appStore.set(setDraftAtom, { key: NEW_CHAT_DRAFT_KEY, text: prompt })
		}
		navigate({ to: "/" })
	}

	// Shared between the graph agents (Website/Browser Game, rendered after the
	// spine) and the other 5 agents (rendered inline in their card stack) so
	// this markup exists exactly once instead of being duplicated per layout.
	const renderConnectorsSection = () =>
		connectorPresets.length > 0 && (
			<div className="rounded-xl border border-border bg-card p-4">
				<h2 className="font-medium text-foreground text-sm">Connect your tools</h2>
				<p className="mt-0.5 text-muted-foreground text-xs">
					Real MCP connectors — same mechanism Claude uses. Once connected, the agent can actually use them
					during your session instead of guessing.
				</p>
				<div className="mt-3 flex flex-col gap-2">
					{connectorPresets.map((preset) => {
						const connected = connectedNames.has(preset.id)
						return (
							<button
								key={preset.id}
								type="button"
								onClick={() => connectTool(preset)}
								className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
							>
								<div className="relative">
									<ConnectorIcon id={preset.id} />
									{connected && (
										<span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-card">
											<CheckIcon className="size-2.5 text-white" />
										</span>
									)}
								</div>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground text-xs">{preset.name}</div>
									<div className="text-[11px] text-muted-foreground">{preset.note}</div>
								</div>
								<span
									className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-[10px] ${
										connected
											? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
											: "bg-muted text-muted-foreground"
									}`}
								>
									{connected ? "Connected" : "Connect"}
								</span>
							</button>
						)
					})}
				</div>
			</div>
		)

	const renderSuggestedReposSection = () =>
		agent.suggestedRepos &&
		agent.suggestedRepos.length > 0 && (
			<div className="rounded-xl border border-border bg-card p-4">
				<h2 className="font-medium text-foreground text-sm">Suggested Git Repo</h2>
				<p className="mt-0.5 text-muted-foreground text-xs">
					For reference and study — real repos worth a look. More get added here over time.
				</p>
				<div className="mt-3 flex flex-wrap gap-2">
					{agent.suggestedRepos.map((repo) => (
						<button
							key={repo.url}
							type="button"
							title={repo.note}
							onClick={() => openInBrowser(repo.url)}
							className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
						>
							{repo.name}
						</button>
					))}
				</div>
			</div>
		)

	return (
		<div className="flex h-full flex-col items-center overflow-y-auto p-8">
			<div className="w-full max-w-2xl">
				<button
					type="button"
					onClick={() => navigate({ to: "/templates" })}
					className="mb-6 text-muted-foreground text-xs hover:text-foreground"
				>
					← All agents
				</button>

				{/* Identity blurb */}
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-4">
						<div className={`flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full ${styles.chip}`}>
							<img
								src={catUrl}
								alt=""
								className="size-10 object-contain"
								style={{ filter: ACCENT_CAT_FILTERS[agent.accent] }}
							/>
						</div>
						<div className="min-w-0">
							<h1 className="font-semibold text-2xl text-foreground">{agent.agentName}</h1>
							<p className="text-muted-foreground text-sm">{agent.tagline}</p>
						</div>
					</div>
					{/* Swaps the right-hand browser pane for the real Community page,
					    filtered to this agent's tag — see sidebar-layout.tsx. */}
					{isGraphAgent && agent.communityTag && (
						<button
							type="button"
							onClick={toggleCommunityPanel}
							className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
								communityPanelOpen
									? `border-transparent ${styles.solid}`
									: "border-border bg-muted/40 text-foreground hover:bg-muted"
							}`}
						>
							<RssIcon className="size-3.5" /> Community
						</button>
					)}
				</div>
				<p className="mt-3 text-muted-foreground text-xs">{agent.toolsNote}</p>

				{isGraphAgent ? (
					// Fixed, hand-laid-out vertical build path — see agent-graph-node.tsx.
					// Node order/copy per page matches the approved mockup; the community
					// feed (both pages) and Browser Game's old livePreviewNote callout are
					// folded into the closest-fitting node instead of getting cut, since
					// neither is called out separately in the mockup's node list.
					<>
					<div className="relative mt-8">
						<GraphSpine />
						<div className="flex flex-col">
							{agent.id === "website" ? (
								<>
									<GraphNode kind="required" icon={<PaletteIcon className="size-[18px]" />} title="Pick a starting look" tag="Pick one">
										<p className="mt-1 text-muted-foreground text-xs">
											Every site starts here — a real base to build from, not a blank page.
										</p>
										<GraphFork>
											<GraphForkOption
												title="Use a template"
												description="Browse the template gallery, pick one that's close"
												onClick={() =>
													toast.info("Template gallery is coming soon.", {
														description: "For now, describe the look you want in the goal box below.",
													})
												}
											/>
											<GraphForkOption
												title="Design it yourself"
												description="Open the Design Studio and sketch it out"
												onClick={() => toast.info("Design Studio (Penpot) is coming soon.")}
											/>
										</GraphFork>
									</GraphNode>

									<GraphNode kind="optional" icon={<EyeIcon className="size-[18px]" />} title="See real examples" tag="Optional">
										<p className="mt-1 text-muted-foreground text-xs">{agent.referenceSitesHint}</p>
										<div className="mt-3 flex flex-wrap gap-2">
											{agent.referenceSites?.map((site) => (
												<button
													key={site.url}
													type="button"
													onClick={() => openInBrowser(site.url)}
													className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
												>
													{site.name}
												</button>
											))}
										</div>
										{agent.communityTag && (
											<div className="mt-3 border-border border-t pt-3">
												<button
													type="button"
													onClick={() => setFeedOpen((v) => !v)}
													className="flex w-full items-center justify-between text-left"
												>
													<span className="font-medium text-foreground text-xs">{agent.communityFeedLabel}</span>
													<ChevronDownIcon
														className={`size-4 text-muted-foreground transition-transform ${feedOpen ? "rotate-180" : ""}`}
													/>
												</button>
												{feedOpen && (
													<div className="mt-3">
														<CommunityTagFeed tag={agent.communityTag} />
														{/* Preview only — the real feed (composer + every post, not
														   just a handful) is one click away via the "Community" toggle up top. */}
														<button
															type="button"
															onClick={openCommunityPanel}
															className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
														>
															<RssIcon className="size-3" /> Open full Community feed
														</button>
													</div>
												)}
											</div>
										)}
									</GraphNode>

									<GraphNode kind="optional" icon={<DatabaseIcon className="size-[18px]" />} title="Add a backend" tag="If needed">
										<p className="mt-1 text-muted-foreground text-xs">
											Only if your site needs logins, a database, or a contact form that saves somewhere. No backend
											tooling is wired up here yet — mention it in your goal below and describe what it needs to do.
										</p>
									</GraphNode>

									<GraphNode kind="optional" icon={<ScaleIcon className="size-[18px]" />} title="Add legal pages" tag="Usually needed">
										<p className="mt-1 text-muted-foreground text-xs">
											Terms, Privacy Policy, cookie notice — most real sites need these before launch. Generating
											starter legal text isn't built yet; this is a placeholder step for now.
										</p>
									</GraphNode>

									<GraphNode
										kind="optional"
										icon={<GlobeIcon className="size-[18px]" />}
										title="Domain & hosting"
										tag="Before you launch"
										isLast
									>
										<p className="mt-1 text-muted-foreground text-xs">
											Connect a real domain name and put the finished site online. Not automated yet — a manual step
											once the site's ready.
										</p>
									</GraphNode>
								</>
							) : (
								<>
									<GraphNode kind="required" icon={<GamepadIcon className="size-[18px]" />} title="Pick an engine" tag="Pick one">
										<p className="mt-1 text-muted-foreground text-xs">Baked into the brief when you start the session.</p>
										<div className="mt-3 flex flex-wrap gap-2">
											{agent.enginePicker?.map((option) => (
												<button
													key={option.id}
													type="button"
													onClick={() => setEngineId(option.id)}
													className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
														engineId === option.id
															? `border-transparent ${styles.solid}`
															: "border-border bg-muted/40 text-foreground hover:bg-muted"
													}`}
												>
													{option.label}
												</button>
											))}
										</div>
									</GraphNode>

									<GraphNode kind="optional" icon={<EyeIcon className="size-[18px]" />} title="See reference games" tag="Optional">
										<p className="mt-1 text-muted-foreground text-xs">{agent.referenceSitesHint}</p>
										<div className="mt-3 flex flex-wrap gap-2">
											{agent.referenceSites?.map((site) => (
												<button
													key={site.url}
													type="button"
													onClick={() => openInBrowser(site.url)}
													className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
												>
													{site.name}
												</button>
											))}
										</div>
										{agent.communityTag && (
											<div className="mt-3 border-border border-t pt-3">
												<button
													type="button"
													onClick={() => setFeedOpen((v) => !v)}
													className="flex w-full items-center justify-between text-left"
												>
													<span className="font-medium text-foreground text-xs">{agent.communityFeedLabel}</span>
													<ChevronDownIcon
														className={`size-4 text-muted-foreground transition-transform ${feedOpen ? "rotate-180" : ""}`}
													/>
												</button>
												{feedOpen && (
													<div className="mt-3">
														<CommunityTagFeed tag={agent.communityTag} />
														{/* Preview only — the real feed (composer + every post, not
														   just a handful) is one click away via the "Community" toggle up top. */}
														<button
															type="button"
															onClick={openCommunityPanel}
															className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
														>
															<RssIcon className="size-3" /> Open full Community feed
														</button>
													</div>
												)}
											</div>
										)}
									</GraphNode>

									<GraphNode
										kind="optional"
										icon={<Volume2Icon className="size-[18px]" />}
										title="Free assets & sound tools"
										tag="Optional"
										isLast
									>
										<p className="mt-1 text-muted-foreground text-xs">Opens in the browser pane, same as reference games above.</p>
										<div className="mt-3 flex flex-wrap gap-2">
											{agent.assetLinks?.map((link) => (
												<button
													key={link.url}
													type="button"
													onClick={() => openInBrowser(link.url)}
													className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
												>
													{link.name}
												</button>
											))}
											{agent.soundToolLink && (
												<button
													type="button"
													onClick={() => openInBrowser(agent.soundToolLink?.url ?? "")}
													className={`flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
												>
													<Volume2Icon className="size-3.5" /> {agent.soundToolLink.name}
												</button>
											)}
										</div>
									</GraphNode>
								</>
							)}
						</div>
					</div>

					{/* Reference/tooling call-outs — deliberately NOT graph nodes (this
					    blueprint's dotted spine is the step-by-step build path; these are
					    reference material, not a step), so they sit as plain sections after
					    the graph and before the actual Start session action. */}
					<div className="mt-8 flex flex-col gap-3">
						{renderConnectorsSection()}
						{renderSuggestedReposSection()}

						<div className="rounded-xl border border-border bg-card p-4">
							<h2 className="font-medium text-foreground text-sm">Start building</h2>
							<p className="mt-0.5 text-muted-foreground text-xs">
								{agent.livePreviewNote ? `${agent.livePreviewNote} ` : ""}Everything picked above becomes the agent's
								brief automatically.
							</p>
							<textarea
								value={goal}
								onChange={(e) => setGoal(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start()
								}}
								placeholder={agent.placeholder}
								rows={3}
								className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
							/>
							<button
								type="button"
								onClick={start}
								disabled={!goal.trim()}
								className={`mt-3 w-full rounded-lg px-3 py-2 font-medium text-sm disabled:opacity-50 ${styles.solid}`}
							>
								Start session
							</button>
						</div>
					</div>
					</>
				) : (
					<>
						<div className="mt-6 flex flex-col gap-3">
							{agent.referenceSites && (
								<div className="rounded-xl border border-border bg-card p-4">
									<h2 className="font-medium text-foreground text-sm">{agent.referenceSitesTitle ?? "Reference sites"}</h2>
									<p className="mt-0.5 text-muted-foreground text-xs">{agent.referenceSitesHint}</p>
									<div className="mt-3 flex flex-wrap gap-2">
										{agent.referenceSites.map((site) => (
											<button
												key={site.url}
												type="button"
												onClick={() => openInBrowser(site.url)}
												className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
											>
												{site.name}
											</button>
										))}
									</div>
								</div>
							)}

							{(agent.assetLinks || agent.soundToolLink) && (
								<div className="rounded-xl border border-border bg-card p-4">
									<h2 className="font-medium text-foreground text-sm">Free assets & tools</h2>
									<p className="mt-0.5 text-muted-foreground text-xs">
										Opens in the browser pane, same as reference games above.
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										{agent.assetLinks?.map((link) => (
											<button
												key={link.url}
												type="button"
												onClick={() => openInBrowser(link.url)}
												className={`rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
											>
												{link.name}
											</button>
										))}
										{agent.soundToolLink && (
											<button
												type="button"
												onClick={() => openInBrowser(agent.soundToolLink?.url ?? "")}
												className={`flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-foreground text-xs transition-colors ${styles.border}`}
											>
												<Volume2Icon className="size-3.5" /> {agent.soundToolLink.name}
											</button>
										)}
									</div>
								</div>
							)}

							{agent.enginePicker && (
								<div className="rounded-xl border border-border bg-card p-4">
									<h2 className="font-medium text-foreground text-sm">Engine</h2>
									<p className="mt-0.5 text-muted-foreground text-xs">Baked into the brief when you start the session.</p>
									<div className="mt-3 flex flex-wrap gap-2">
										{agent.enginePicker.map((option) => (
											<button
												key={option.id}
												type="button"
												onClick={() => setEngineId(option.id)}
												className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
													engineId === option.id
														? `border-transparent ${styles.solid}`
														: "border-border bg-muted/40 text-foreground hover:bg-muted"
												}`}
											>
												{option.label}
											</button>
										))}
									</div>
								</div>
							)}

							{agent.showDesignStudio !== false && (
								<button
									type="button"
									onClick={() => toast.info("Design Studio (Penpot) is coming soon.")}
									className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/30"
								>
									<div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${styles.chip}`}>
										<PaletteIcon className={`size-4 ${styles.icon}`} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="font-medium text-foreground text-sm">Design Studio</div>
										<div className="mt-0.5 text-muted-foreground text-xs">Visual design canvas, powered by Penpot</div>
									</div>
								</button>
							)}

							{agent.livePreviewNote && (
								<div className={`flex items-center gap-3 rounded-xl border p-4 ${styles.chip} ${styles.border}`}>
									<div className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-background`}>
										<PlayIcon className={`size-4 ${styles.icon}`} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="font-medium text-foreground text-sm">Live preview & playtest</div>
										<div className="mt-0.5 text-muted-foreground text-xs">{agent.livePreviewNote}</div>
									</div>
								</div>
							)}

							{/*
							 * Live-vector drawing/"pen" tool slot — explicitly deferred, not
							 * built here. Leaving this comment (not a rendered placeholder)
							 * since an inert box in a tool column reads as broken, not "coming
							 * soon" — Design Studio/Live preview above already carry that role.
							 */}

							{agent.communityTag && (
								<div className="rounded-xl border border-border bg-card p-4">
									<button
										type="button"
										onClick={() => setFeedOpen((v) => !v)}
										className="flex w-full items-center justify-between text-left"
									>
										<span className="font-medium text-foreground text-sm">{agent.communityFeedLabel}</span>
										<ChevronDownIcon
											className={`size-4 text-muted-foreground transition-transform ${feedOpen ? "rotate-180" : ""}`}
										/>
									</button>
									{feedOpen && (
										<div className="mt-3">
											<CommunityTagFeed tag={agent.communityTag} />
										</div>
									)}
								</div>
							)}

							{renderConnectorsSection()}
							{renderSuggestedReposSection()}
						</div>

						<div className="mt-8 rounded-xl border border-border bg-card p-4">
							<h2 className="font-medium text-foreground text-sm">What do you want to build?</h2>
							<textarea
								value={goal}
								onChange={(e) => setGoal(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start()
								}}
								placeholder={agent.placeholder}
								rows={3}
								className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
							/>
							<button
								type="button"
								onClick={start}
								disabled={!goal.trim()}
								className={`mt-3 w-full rounded-lg px-3 py-2 font-medium text-sm disabled:opacity-50 ${styles.solid}`}
							>
								Start session
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	)
}
