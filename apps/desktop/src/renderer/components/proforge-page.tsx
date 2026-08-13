/**
 * ProForge — the entry point to Hramble's Pro/company-tier capabilities.
 * Same shape as Settings: a dedicated page whose own sub-nav replaces the
 * main sidebar, with each section as its own child route via <Outlet/>.
 * Not more buttons crammed into the session view — a separate space.
 */
import { Button } from "@hramble/ui/components/button"
import { NativeSelect, NativeSelectOption } from "@hramble/ui/components/native-select"
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@hramble/ui/components/sidebar"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	ArrowLeftIcon,
	FolderIcon,
	GaugeIcon,
	GitMergeIcon,
	InfoIcon,
	MonitorIcon,
	PaletteIcon,
	RocketIcon,
	RotateCwIcon,
	SparklesIcon,
	UsersIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CHAT_MODES } from "../atoms/chat-mode"
import { communityAccessTokenAtom } from "../atoms/community"
import { activeTeamAtom, activeTeamIdAtom, masterSessionPreviewUrlAtom } from "../atoms/team"
import { useProjectList } from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import type { Team } from "../lib/team-client"
import {
	connectMasterSessionCanvas,
	type MasterSessionCanvasStatus,
	masterSessionRoomToken,
	publishMasterSessionCanvasUrl,
} from "../lib/master-session-relay"
import { getProjectClient, loadProjectSessions } from "../services/connection-manager"
import { getSessionDiff } from "../services/opencode"
import { createWorktree, randomWorktreeName } from "../services/worktree-service"
import { useSetSidebarSlot } from "./sidebar-slot-context"
import { CreateOrJoinTeam, GateScreen, TeamWorkspace, useTeamSpaces } from "./team-page"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

// Electron's <webview> is a real embedded Chromium browser — same element
// browser-pane.tsx uses for the agent's own browser tab. Cast since its
// JSX/DOM types aren't in React's defaults.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Webview: any = "webview"

// ============================================================
// Section definitions
// ============================================================

type ProForgeSection = "master-session" | "design-deck" | "swarm" | "fan-out"

const sections: { id: ProForgeSection; label: string; icon: typeof SparklesIcon }[] = [
	{ id: "master-session", label: "Master Session", icon: GitMergeIcon },
	{ id: "design-deck", label: "Design Deck", icon: PaletteIcon },
	{ id: "swarm", label: "Swarm", icon: GaugeIcon },
	{ id: "fan-out", label: "Fan-Out", icon: RocketIcon },
]

// ============================================================
// ProForge layout (renders <Outlet /> for child routes)
// ============================================================

export function ProForgePage() {
	const { setContent, setFooter } = useSetSidebarSlot()

	useEffect(() => {
		setContent(<ProForgeSidebarContent />)
		setFooter(false)
		return () => {
			setContent(null)
			setFooter(null)
		}
	}, [setContent, setFooter])

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-2xl px-8 py-6">
				<Outlet />
			</div>
		</div>
	)
}

// ============================================================
// Sidebar content injected via slot context
// ============================================================

function ProForgeSidebarContent() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (s) => s.location.pathname })

	// Derive active section from the last path segment (e.g. "/proforge/design-deck" -> "design-deck")
	const activeSection = pathname.split("/").pop() || "master-session"

	return (
		<SidebarContent>
			<SidebarGroup>
				<SidebarGroupContent>
					<div className="px-2 py-1">
						<button
							type="button"
							onClick={() => navigate({ to: "/" })}
							className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeftIcon aria-hidden="true" className="size-4" />
							Back to app
						</button>
					</div>
					<div className="px-2 pt-2 pb-1">
						<div className="flex items-center gap-1.5 font-medium text-primary text-xs uppercase tracking-wide">
							<SparklesIcon className="size-3.5" />
							ProForge
						</div>
					</div>
					<div className="px-2 pb-1">
						<button
							type="button"
							onClick={() => navigate({ to: "/proforge/about" })}
							className="flex items-center gap-1.5 rounded-md px-1 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
						>
							<InfoIcon aria-hidden="true" className="size-3.5" />
							What's this?
						</button>
					</div>
					<SidebarMenu>
						{sections.map((section) => {
							const Icon = section.icon
							return (
								<SidebarMenuItem key={section.id}>
									<SidebarMenuButton
										isActive={activeSection === section.id}
										onClick={() => navigate({ to: `/proforge/${section.id}` })}
										tooltip={section.label}
									>
										<Icon aria-hidden="true" className="size-4" />
										<span>{section.label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							)
						})}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</SidebarContent>
	)
}

// ============================================================
// Section stub — shared placeholder until each one gets built
// ============================================================

export function ProForgeSectionStub({
	title,
	description,
	icon: Icon,
	footer,
}: {
	title: string
	description: string
	icon: typeof SparklesIcon
	footer?: ReactNode
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Icon className="size-5" />
				</div>
				<div>
					<h1 className="font-semibold text-xl">{title}</h1>
					<p className="text-muted-foreground text-sm">{description}</p>
				</div>
			</div>
			<div className="rounded-xl border border-border border-dashed p-6 text-center">
				{footer ?? <p className="text-muted-foreground text-sm">Coming soon.</p>}
			</div>
		</div>
	)
}

// ============================================================
// The four sections — stubs for now, filled in one at a time
// ============================================================

// ============================================================
// Master Session — Canvas (live combined preview) + Roster (who's in)
// ============================================================

const CANVAS_STATUS_LABEL: Record<MasterSessionCanvasStatus, string> = {
	connecting: "Connecting…",
	connected: "Live — synced with the team",
	disconnected: "Reconnecting…",
}

/** The live combined-build preview, shared with the whole team over the session relay (see lib/master-session-relay.ts). Whoever sets the URL broadcasts it; everyone else's Canvas loads it live. */
function MasterSessionCanvas({ team }: { team: Team }) {
	const [urls, setUrls] = useAtom(masterSessionPreviewUrlAtom)
	const accessToken = useAtomValue(communityAccessTokenAtom)
	const savedUrl = urls[team.id] ?? ""
	const [input, setInput] = useState(savedUrl)
	const [loadedUrl, setLoadedUrl] = useState(savedUrl)
	const [status, setStatus] = useState<MasterSessionCanvasStatus>("connecting")
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ref = useRef<any>(null)

	useEffect(() => {
		const roomToken = masterSessionRoomToken(team.id)
		const viewer = connectMasterSessionCanvas(
			roomToken,
			(url) => {
				setLoadedUrl(url)
				setInput(url)
				setUrls((prev) => (prev[team.id] === url ? prev : { ...prev, [team.id]: url }))
			},
			setStatus,
		)
		return () => viewer.stop()
	}, [team.id, setUrls])

	const load = () => {
		const url = input.trim()
		if (!url || !accessToken) return
		setLoadedUrl(url)
		setUrls((prev) => ({ ...prev, [team.id]: url }))
		publishMasterSessionCanvasUrl(accessToken, masterSessionRoomToken(team.id), url)
	}

	return (
		<div className="flex flex-col gap-3">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					load()
				}}
				className="flex gap-2"
			>
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="http://192.168.1.x:3000 — a LAN address every teammate can reach"
					className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
				/>
				<Button size="sm" type="submit" disabled={!input.trim() || !accessToken}>
					Share
				</Button>
				{loadedUrl && (
					<Button size="sm" variant="outline" type="button" onClick={() => ref.current?.reload()}>
						<RotateCwIcon className="size-3.5" />
					</Button>
				)}
			</form>
			<div className="h-[420px] overflow-hidden rounded-xl border border-border bg-muted/30">
				{loadedUrl ? (
					<Webview
						ref={ref}
						src={loadedUrl}
						partition="persist:hramble-master-session"
						style={{ width: "100%", height: "100%" }}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground text-sm">
						<MonitorIcon className="size-8 text-ring" />
						<p>
							Share whoever's dev server has the combined build running — everyone in this Master Session sees it
							live over your WiFi.
						</p>
					</div>
				)}
			</div>
			<p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
				<span
					className={`size-1.5 rounded-full ${status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
				/>
				{CANVAS_STATUS_LABEL[status]} · "localhost" only loads for you — use a LAN IP so the whole team can reach it
			</p>
		</div>
	)
}

type MasterSessionTab = "canvas" | "roster"

function MasterSessionShell({ team, teams }: { team: Team; teams: Team[] }) {
	const [tab, setTab] = useState<MasterSessionTab>("canvas")
	const setActiveTeamId = useSetAtom(activeTeamIdAtom)

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-xl">{team.name}</h1>
					<p className="text-muted-foreground text-sm">Master Session</p>
				</div>
				{teams.length > 1 && (
					<NativeSelect
						value={team.id}
						onChange={(e) => setActiveTeamId(e.target.value)}
						className="h-8 w-48 text-sm"
					>
						{teams.map((t) => (
							<NativeSelectOption key={t.id} value={t.id}>
								{t.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</div>
			<div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
				<button
					type="button"
					onClick={() => setTab("canvas")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition-colors ${
						tab === "canvas"
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<MonitorIcon className="size-3.5" />
					Canvas
				</button>
				<button
					type="button"
					onClick={() => setTab("roster")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition-colors ${
						tab === "roster"
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<UsersIcon className="size-3.5" />
					Roster
				</button>
			</div>
			{tab === "canvas" ? (
				<MasterSessionCanvas team={team} />
			) : (
				<div className="flex flex-col gap-6">
					<TeamWorkspace team={team} />
				</div>
			)}
		</div>
	)
}

export function ProForgeMasterSession() {
	const { backendEnabled, user, teams } = useTeamSpaces()
	const team = useAtomValue(activeTeamAtom)

	if (!backendEnabled || !user) return <GateScreen />
	if (teams.length === 0 || !team) return <CreateOrJoinTeam />
	return <MasterSessionShell team={team} teams={teams} />
}

// ============================================================
// Design Deck — N parallel design variants, compare, pick a winner
// ============================================================

interface DesignDeckVariant {
	index: number
	label: string
	directory: string | null
	sessionId: string | null
	status: "pending" | "generating" | "done" | "error"
	html: string | null
	error: string | null
}

const VARIANT_STYLES: { label: string; brief: string }[] = [
	{
		label: "Minimal",
		brief: "clean and minimal — generous whitespace, understated typography, a restrained neutral palette",
	},
	{ label: "Bold", brief: "bold and high-contrast — large type, one vivid accent color, strong visual hierarchy" },
	{ label: "Playful", brief: "playful and friendly — rounded shapes, warm colors, approachable and a bit whimsical" },
	{ label: "Editorial", brief: "editorial and refined — serif headlines, magazine-style layout, sophisticated and calm" },
]

function buildVariantPrompt(userBrief: string, styleBrief: string): string {
	return `Build a single self-contained index.html file (inline CSS and JS, no external dependencies, no build step) for: ${userBrief}\n\nDesign direction for this variant: ${styleBrief}\n\nMake it a real, polished, complete page — not a wireframe or placeholder text.`
}

function DesignDeckVariantCard({ variant, onPick }: { variant: DesignDeckVariant; onPick: () => void }) {
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border p-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{variant.label}</span>
				<span className="text-[11px] text-muted-foreground capitalize">
					{variant.status === "generating" ? "Generating…" : variant.status}
				</span>
			</div>
			<div className="h-56 overflow-hidden rounded-lg border border-border bg-muted/30">
				{variant.status === "done" && variant.html ? (
					<iframe
						title={variant.label}
						sandbox="allow-scripts"
						srcDoc={variant.html}
						className="h-full w-full"
					/>
				) : variant.status === "error" ? (
					<div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-red-500">
						{variant.error}
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-muted-foreground text-xs">
						{variant.status === "pending" ? "Waiting to start…" : "Building…"}
					</div>
				)}
			</div>
			<Button size="sm" variant="outline" disabled={variant.status !== "done"} onClick={onPick}>
				Pick this
			</Button>
		</div>
	)
}

export function ProForgeDesignDeck() {
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()
	const projects = useProjectList()
	const [brief, setBrief] = useState("")
	const [count, setCount] = useState(3)
	const [variants, setVariants] = useState<DesignDeckVariant[]>([])
	const [running, setRunning] = useState(false)

	const generateOne = async (
		runId: string,
		index: number,
		style: { label: string; brief: string },
		userBrief: string,
	) => {
		try {
			const directory = await bridge().getDesignDeckVariantDir(runId, index)
			setVariants((prev) => prev.map((v) => (v.index === index ? { ...v, directory, status: "generating" } : v)))
			const session = await createSession(directory, `Design Deck — ${style.label}`, CHAT_MODES.auto.permission ?? undefined)
			if (!session) throw new Error("Couldn't start a session")
			setVariants((prev) => prev.map((v) => (v.index === index ? { ...v, sessionId: session.id } : v)))
			await sendPrompt(directory, session.id, buildVariantPrompt(userBrief, style.brief), { agent: "build" })
			const client = getProjectClient(directory)
			const diffs = client ? await getSessionDiff(client, session.id) : []
			const htmlFile = diffs.find((d) => d.status !== "deleted" && /\.(html?|svg)$/i.test(d.file))
			if (!htmlFile?.after) throw new Error("No HTML file found in the result")
			setVariants((prev) => prev.map((v) => (v.index === index ? { ...v, status: "done", html: htmlFile.after } : v)))
		} catch (err) {
			setVariants((prev) =>
				prev.map((v) =>
					v.index === index
						? { ...v, status: "error", error: err instanceof Error ? err.message : "Generation failed" }
						: v,
				),
			)
		}
	}

	const generate = async () => {
		const userBrief = brief.trim()
		if (!userBrief || running) return
		const runId = crypto.randomUUID()
		setRunning(true)
		const styles = VARIANT_STYLES.slice(0, count)
		setVariants(
			styles.map((s, index) => ({
				index,
				label: s.label,
				directory: null,
				sessionId: null,
				status: "pending",
				html: null,
				error: null,
			})),
		)
		await Promise.all(styles.map((s, index) => generateOne(runId, index, s, userBrief)))
		setRunning(false)
	}

	const pickWinner = async (variant: DesignDeckVariant) => {
		if (!variant.directory || !variant.sessionId) return
		await loadProjectSessions(variant.directory)
		const project = projects.find((p) => p.directory === variant.directory)
		const projectSlug = project?.slug ?? variant.directory.split("/").pop() ?? "design-deck"
		navigate({
			to: "/project/$projectSlug/session/$sessionId",
			params: { projectSlug, sessionId: variant.sessionId },
		})
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<PaletteIcon className="size-5" />
				</div>
				<div>
					<h1 className="font-semibold text-xl">Design Deck</h1>
					<p className="text-muted-foreground text-sm">
						Describe what you want, get {count} distinct directions built in parallel, pick the one that works.
					</p>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<textarea
					value={brief}
					onChange={(e) => setBrief(e.target.value)}
					rows={3}
					disabled={running}
					placeholder="e.g. a landing page for a bakery that does custom wedding cakes"
					className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
				/>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-muted-foreground text-xs">
						Variants
						<NativeSelect
							value={String(count)}
							onChange={(e) => setCount(Number(e.target.value))}
							disabled={running}
							className="h-7 w-16 text-xs"
						>
							{[2, 3, 4].map((n) => (
								<NativeSelectOption key={n} value={String(n)}>
									{n}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<Button size="sm" onClick={generate} disabled={!brief.trim() || running}>
						{running ? "Generating…" : "Generate"}
					</Button>
				</div>
			</div>

			{variants.length > 0 && (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{variants.map((v) => (
						<DesignDeckVariantCard key={v.index} variant={v} onPick={() => pickWinner(v)} />
					))}
				</div>
			)}
		</div>
	)
}

// ============================================================
// Swarm — Hyperloop scaled up: worktree-isolated steps + a real combine phase
// ============================================================

// Hyperloop caps at HYPER_MAX_STEPS (21 = 3 loops of HYPER_LOOP_SIZE=7)
// because every step's agent edits the SAME shared directory — more
// concurrent agents there means real file collisions. Swarm removes that
// constraint by giving each step its own git worktree (same mechanism
// regular worktree sessions already use), so its cap is about local
// resource use, not collision risk — and it should clearly beat Hyperloop's
// 7-at-once, not undercut it.
const SWARM_MAX_STEPS = 30
const SWARM_CONCURRENCY = 12

interface SwarmStep {
	index: number
	text: string
	timeEstimate?: string
	status: "pending" | "creating-worktree" | "running" | "done" | "failed"
	worktreeRoot: string | null
	worktreeWorkspace: string | null
	branchName: string | null
	error: string | null
	combineStatus: "not-ready" | "ready" | "combining" | "combined" | "conflict"
	combineError: string | null
}

function buildSwarmDecomposePrompt(goal: string): string {
	return `First, in ONE short sentence, judge whether this goal is a small, medium, or large task and say roughly how many steps it needs. Use as many steps as the task genuinely needs, up to ${SWARM_MAX_STEPS} steps total — do NOT pad or force a specific count.\n\nThen on a new line, list the steps as a numbered list (1., 2., …), one step per line. Each step runs in its OWN isolated git worktree/branch by a separate agent, so make each step a precise, self-contained instruction (each step should touch different files/areas where possible) — include file names and what to do. At the end of each step line add a realistic time estimate in the format [~X min].\n\nCRITICAL: All file paths MUST be RELATIVE to the project folder. Never use absolute paths.\n\nNo preamble besides that one sizing sentence, no sub-bullets.\n\nGoal: ${goal}`
}

async function fetchLastAssistantText(directory: string, sessionId: string): Promise<string> {
	const client = getProjectClient(directory)
	if (!client) return ""
	const msgs = await client.session.messages({ sessionID: sessionId }).catch(() => null)
	type MsgEntry = { info: { role: string }; parts: Array<{ type: string; text?: string }> }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const allMsgs: MsgEntry[] = ((msgs as any)?.data as MsgEntry[]) ?? []
	const lastAssistant = [...allMsgs].reverse().find((m) => m.info?.role === "assistant")
	return (lastAssistant?.parts ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("\n")
}

function parseSwarmSteps(text: string): { text: string; timeEstimate?: string }[] {
	const lines = text.split("\n")
	return lines
		.filter((l) => /^\s*\d+[.)]\s+/.test(l))
		.map((l) => {
			const raw = l.replace(/^\s*\d+[.)]\s*/, "").trim()
			const timeMatch = raw.match(/\[~([^\]]+)\]\s*$/)
			return {
				text: timeMatch ? raw.slice(0, raw.lastIndexOf("[~")).trim() : raw,
				timeEstimate: timeMatch ? `~${timeMatch[1]}` : undefined,
			}
		})
		.filter((s) => s.text.length > 0)
		.slice(0, SWARM_MAX_STEPS)
}

/** Simple worker-pool: runs `worker` over `items` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
	let next = 0
	async function runner() {
		while (next < items.length) {
			const item = items[next++]
			await worker(item)
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
}

function SwarmStepRow({ step, onCombine }: { step: SwarmStep; onCombine: () => void }) {
	const statusLabel =
		step.status === "creating-worktree"
			? "Creating worktree…"
			: step.status === "running"
				? "Running…"
				: step.status
	return (
		<div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
			<div className="flex items-start justify-between gap-2">
				<span className="flex-1 text-sm">{step.text}</span>
				{step.timeEstimate && <span className="shrink-0 text-[11px] text-muted-foreground">{step.timeEstimate}</span>}
			</div>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] text-muted-foreground capitalize">
					{statusLabel}
					{step.branchName ? ` · ${step.branchName}` : ""}
				</span>
				{step.combineStatus === "ready" && (
					<Button size="sm" variant="outline" onClick={onCombine}>
						<GitMergeIcon className="size-3.5" />
						Combine
					</Button>
				)}
				{step.combineStatus === "combining" && <span className="text-[11px] text-muted-foreground">Combining…</span>}
				{step.combineStatus === "combined" && (
					<span className="text-[11px] text-emerald-600 dark:text-emerald-400">Combined</span>
				)}
			</div>
			{step.error && <p className="text-[11px] text-red-500">{step.error}</p>}
			{step.combineError && <p className="text-[11px] text-red-500">{step.combineError}</p>}
		</div>
	)
}

export function ProForgeSwarm() {
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()
	const projects = useProjectList()
	const [directory, setDirectory] = useState<string | null>(null)
	const [goal, setGoal] = useState("")
	const [decomposing, setDecomposing] = useState(false)
	const [sizingNote, setSizingNote] = useState<string | null>(null)
	const [steps, setSteps] = useState<SwarmStep[]>([])
	const [running, setRunning] = useState(false)

	const pickDirectory = async () => {
		const dir = await bridge().pickDirectory()
		if (dir) {
			setDirectory(dir)
			setSteps([])
			setSizingNote(null)
		}
	}

	const decompose = async () => {
		const trimmedGoal = goal.trim()
		if (!directory || !trimmedGoal || decomposing) return
		setDecomposing(true)
		setSteps([])
		setSizingNote(null)
		try {
			const session = await createSession(directory, "Swarm plan", CHAT_MODES.auto.permission ?? undefined)
			if (!session) return
			await sendPrompt(directory, session.id, buildSwarmDecomposePrompt(trimmedGoal), { agent: "build" })
			const text = await fetchLastAssistantText(directory, session.id)
			const lines = text.split("\n")
			const firstNumberedIdx = lines.findIndex((l) => /^\s*\d+[.)]\s+/.test(l))
			const note = (firstNumberedIdx > 0 ? lines.slice(0, firstNumberedIdx) : [])
				.join(" ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 240)
			const parsed = parseSwarmSteps(text)
			setSizingNote(note || null)
			setSteps(
				parsed.map((s, index) => ({
					index,
					text: s.text,
					timeEstimate: s.timeEstimate,
					status: "pending",
					worktreeRoot: null,
					worktreeWorkspace: null,
					branchName: null,
					error: null,
					combineStatus: "not-ready",
					combineError: null,
				})),
			)
		} finally {
			setDecomposing(false)
		}
	}

	const runStep = async (step: SwarmStep) => {
		if (!directory) return
		try {
			setSteps((prev) => prev.map((s) => (s.index === step.index ? { ...s, status: "creating-worktree" } : s)))
			const wt = await createWorktree(directory, directory, randomWorktreeName())
			setSteps((prev) =>
				prev.map((s) =>
					s.index === step.index
						? {
								...s,
								status: "running",
								worktreeRoot: wt.worktreeRoot,
								worktreeWorkspace: wt.worktreeWorkspace,
								branchName: wt.branchName,
							}
						: s,
				),
			)
			const session = await createSession(
				wt.worktreeWorkspace,
				`Swarm ${step.index + 1}: ${step.text.slice(0, 40)}`,
				CHAT_MODES.auto.permission ?? undefined,
			)
			if (!session) throw new Error("Couldn't start a session")
			await sendPrompt(wt.worktreeWorkspace, session.id, step.text, { agent: "build" })
			setSteps((prev) => prev.map((s) => (s.index === step.index ? { ...s, status: "done", combineStatus: "ready" } : s)))
		} catch (err) {
			setSteps((prev) =>
				prev.map((s) =>
					s.index === step.index
						? { ...s, status: "failed", error: err instanceof Error ? err.message : "Failed" }
						: s,
				),
			)
		}
	}

	const launch = async () => {
		if (!steps.length || running) return
		setRunning(true)
		await runWithConcurrency(steps, SWARM_CONCURRENCY, runStep)
		setRunning(false)
	}

	const mergeOne = async (step: SwarmStep): Promise<boolean> => {
		if (!directory || !step.branchName) return false
		setSteps((prev) => prev.map((s) => (s.index === step.index ? { ...s, combineStatus: "combining" } : s)))
		const result = await bridge().git.mergeBranch(directory, step.branchName)
		setSteps((prev) =>
			prev.map((s) =>
				s.index === step.index
					? {
							...s,
							combineStatus: result.success ? "combined" : "conflict",
							combineError: result.success
								? null
								: result.conflictedFiles.length > 0
									? `Conflicts in: ${result.conflictedFiles.join(", ")}`
									: (result.error ?? "Merge failed"),
						}
					: s,
			),
		)
		return result.success
	}

	const combineAll = async () => {
		for (const step of steps) {
			if (step.combineStatus !== "ready") continue
			const ok = await mergeOne(step)
			if (!ok) break // Stop so the user can resolve the conflict before combining the rest.
		}
	}

	const openProject = async () => {
		if (!directory) return
		await loadProjectSessions(directory)
		const project = projects.find((p) => p.directory === directory)
		const projectSlug = project?.slug ?? directory.split("/").pop() ?? "project"
		navigate({ to: "/project/$projectSlug", params: { projectSlug } })
	}

	const readyToCombine = steps.some((s) => s.combineStatus === "ready")
	const allCombined = steps.length > 0 && steps.every((s) => s.combineStatus === "combined")

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<GaugeIcon className="size-5" />
				</div>
				<div>
					<h1 className="font-semibold text-xl">Swarm</h1>
					<p className="text-muted-foreground text-sm">
						Hyperloop, scaled up — each step runs in its own isolated worktree, so far more agents can work in
						parallel with no file collisions. Combine folds each one back into the project.
					</p>
				</div>
			</div>

			{!directory ? (
				<button
					type="button"
					onClick={pickDirectory}
					className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-sm hover:border-foreground/30 hover:text-foreground"
				>
					<FolderIcon className="size-4 shrink-0" />
					Choose a project folder to start
				</button>
			) : (
				<>
					<button
						type="button"
						onClick={pickDirectory}
						disabled={running}
						className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-xs hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
					>
						<FolderIcon className="size-3.5 shrink-0" />
						<span className="truncate font-mono">{directory}</span>
					</button>

					<div className="flex flex-col gap-2">
						<textarea
							value={goal}
							onChange={(e) => setGoal(e.target.value)}
							rows={3}
							disabled={decomposing || running}
							placeholder="e.g. add a full checkout flow with cart, payment, and order confirmation"
							className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
						/>
						<div className="flex justify-end">
							<Button size="sm" onClick={decompose} disabled={!goal.trim() || decomposing || running}>
								{decomposing ? "Planning…" : "Decompose"}
							</Button>
						</div>
					</div>

					{sizingNote && <p className="text-muted-foreground text-xs">{sizingNote}</p>}

					{steps.length > 0 && (
						<>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground text-xs">
									{steps.length} step{steps.length !== 1 ? "s" : ""}, each in its own worktree
								</span>
								<Button size="sm" onClick={launch} disabled={running}>
									{running ? "Running…" : "Launch Swarm"}
								</Button>
							</div>
							<div className="flex flex-col gap-2">
								{steps.map((s) => (
									<SwarmStepRow key={s.index} step={s} onCombine={() => mergeOne(s)} />
								))}
							</div>
							<div className="flex items-center gap-2">
								{readyToCombine && (
									<Button size="sm" variant="outline" onClick={combineAll}>
										<GitMergeIcon className="size-3.5" />
										Combine all
									</Button>
								)}
								{allCombined && (
									<Button size="sm" onClick={openProject}>
										Open project
									</Button>
								)}
							</div>
						</>
					)}
				</>
			)}
		</div>
	)
}

// ============================================================
// Fan-Out — one finished project, several derived output formats
// ============================================================

// Unlike Swarm (incremental pieces of ONE result, so they get combined back
// into main), each Fan-Out target is a separate, standalone derivative — a
// deck isn't "part of" the web app, so there's nothing to merge. Each target
// runs in its own worktree so it can read the real project as context
// without touching it, and is opened individually rather than combined.
const FAN_OUT_FORMATS: { id: string; label: string; brief: string }[] = [
	{
		id: "deck",
		label: "Pitch Deck",
		brief:
			"a pitch-deck style HTML slideshow (one full-screen <section> per slide, simple click/arrow-key navigation between slides) summarizing this project's product",
	},
	{
		id: "summary",
		label: "One-Page Summary",
		brief:
			"a single-page, print-ready HTML summary of this project — its purpose, key features, and how it works, laid out for a one-page handout",
	},
	{
		id: "mobile",
		label: "Mobile Layout",
		brief:
			"a mobile-first responsive variant of this project's main page, adapted for a phone-sized screen (stacked layout, larger tap targets)",
	},
]

interface FanOutTarget {
	index: number
	id: string
	label: string
	status: "pending" | "creating-worktree" | "running" | "done" | "error"
	worktreeWorkspace: string | null
	sessionId: string | null
	html: string | null
	error: string | null
}

function buildFanOutPrompt(target: { label: string; brief: string }): string {
	return `This existing project is already built. Without modifying its existing files, add ONE new self-contained HTML file (inline CSS and JS, no build step, no external dependencies) that is ${target.brief}.\n\nFirst look at the existing project's files to see its real colors, fonts, and branding, then match that design system precisely in the new file. Make it a real, polished, complete result — not a wireframe or placeholder text.`
}

function FanOutTargetCard({ target, onOpen }: { target: FanOutTarget; onOpen: () => void }) {
	const statusLabel =
		target.status === "creating-worktree" ? "Preparing…" : target.status === "running" ? "Building…" : target.status
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border p-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{target.label}</span>
				<span className="text-[11px] text-muted-foreground capitalize">{statusLabel}</span>
			</div>
			<div className="h-56 overflow-hidden rounded-lg border border-border bg-muted/30">
				{target.status === "done" && target.html ? (
					<iframe title={target.label} sandbox="allow-scripts" srcDoc={target.html} className="h-full w-full" />
				) : target.status === "error" ? (
					<div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-red-500">
						{target.error}
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-muted-foreground text-xs">
						{target.status === "pending" ? "Waiting to start…" : statusLabel}
					</div>
				)}
			</div>
			<Button size="sm" variant="outline" disabled={target.status !== "done"} onClick={onOpen}>
				Open
			</Button>
		</div>
	)
}

export function ProForgeFanOut() {
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()
	const projects = useProjectList()
	const [directory, setDirectory] = useState<string | null>(null)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(FAN_OUT_FORMATS.map((f) => f.id)))
	const [targets, setTargets] = useState<FanOutTarget[]>([])
	const [running, setRunning] = useState(false)

	const pickDirectory = async () => {
		const dir = await bridge().pickDirectory()
		if (dir) {
			setDirectory(dir)
			setTargets([])
		}
	}

	const toggleFormat = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const generateOne = async (index: number, format: { id: string; label: string; brief: string }) => {
		if (!directory) return
		try {
			setTargets((prev) => prev.map((t) => (t.index === index ? { ...t, status: "creating-worktree" } : t)))
			const wt = await createWorktree(directory, directory, randomWorktreeName())
			setTargets((prev) =>
				prev.map((t) => (t.index === index ? { ...t, status: "running", worktreeWorkspace: wt.worktreeWorkspace } : t)),
			)
			const session = await createSession(
				wt.worktreeWorkspace,
				`Fan-Out — ${format.label}`,
				CHAT_MODES.auto.permission ?? undefined,
			)
			if (!session) throw new Error("Couldn't start a session")
			setTargets((prev) => prev.map((t) => (t.index === index ? { ...t, sessionId: session.id } : t)))
			await sendPrompt(wt.worktreeWorkspace, session.id, buildFanOutPrompt(format), { agent: "build" })
			const client = getProjectClient(wt.worktreeWorkspace)
			const diffs = client ? await getSessionDiff(client, session.id) : []
			const htmlFile = diffs.find((d) => d.status !== "deleted" && /\.(html?|svg)$/i.test(d.file))
			if (!htmlFile?.after) throw new Error("No HTML file found in the result")
			setTargets((prev) => prev.map((t) => (t.index === index ? { ...t, status: "done", html: htmlFile.after } : t)))
		} catch (err) {
			setTargets((prev) =>
				prev.map((t) =>
					t.index === index
						? { ...t, status: "error", error: err instanceof Error ? err.message : "Generation failed" }
						: t,
				),
			)
		}
	}

	const generate = async () => {
		if (!directory || selectedIds.size === 0 || running) return
		setRunning(true)
		const formats = FAN_OUT_FORMATS.filter((f) => selectedIds.has(f.id))
		setTargets(
			formats.map((f, index) => ({
				index,
				id: f.id,
				label: f.label,
				status: "pending",
				worktreeWorkspace: null,
				sessionId: null,
				html: null,
				error: null,
			})),
		)
		await Promise.all(formats.map((f, index) => generateOne(index, f)))
		setRunning(false)
	}

	const openTarget = async (target: FanOutTarget) => {
		if (!target.worktreeWorkspace || !target.sessionId) return
		await loadProjectSessions(target.worktreeWorkspace)
		const project = projects.find((p) => p.directory === target.worktreeWorkspace)
		const projectSlug = project?.slug ?? target.worktreeWorkspace.split("/").pop() ?? "fan-out"
		navigate({
			to: "/project/$projectSlug/session/$sessionId",
			params: { projectSlug, sessionId: target.sessionId },
		})
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<RocketIcon className="size-5" />
				</div>
				<div>
					<h1 className="font-semibold text-xl">Fan-Out</h1>
					<p className="text-muted-foreground text-sm">
						Take a finished project and generate other formats from it — reusing the same design, colors, and
						branding instead of starting from scratch.
					</p>
				</div>
			</div>

			{!directory ? (
				<button
					type="button"
					onClick={pickDirectory}
					className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-sm hover:border-foreground/30 hover:text-foreground"
				>
					<FolderIcon className="size-4 shrink-0" />
					Choose the finished project to fan out from
				</button>
			) : (
				<>
					<button
						type="button"
						onClick={pickDirectory}
						disabled={running}
						className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-xs hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
					>
						<FolderIcon className="size-3.5 shrink-0" />
						<span className="truncate font-mono">{directory}</span>
					</button>

					<div className="flex flex-col gap-2">
						<span className="text-muted-foreground text-xs">Formats to generate</span>
						<div className="flex flex-wrap gap-2">
							{FAN_OUT_FORMATS.map((f) => (
								<label
									key={f.id}
									className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
								>
									<input
										type="checkbox"
										checked={selectedIds.has(f.id)}
										onChange={() => toggleFormat(f.id)}
										disabled={running}
										className="size-3.5"
									/>
									{f.label}
								</label>
							))}
						</div>
						<div className="flex justify-end">
							<Button size="sm" onClick={generate} disabled={selectedIds.size === 0 || running}>
								{running ? "Generating…" : "Generate"}
							</Button>
						</div>
					</div>

					{targets.length > 0 && (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							{targets.map((t) => (
								<FanOutTargetCard key={t.index} target={t} onOpen={() => openTarget(t)} />
							))}
						</div>
					)}
				</>
			)}
		</div>
	)
}

// ============================================================
// About — plain-language explanation of the four ProForge sections
// ============================================================

const ABOUT_SECTIONS: { title: string; icon: typeof SparklesIcon; body: string }[] = [
	{
		title: "Master Session",
		icon: GitMergeIcon,
		body: "For a manager working with a team: start a named session, invite teammates by email, and everyone builds their own piece of the app. A live Canvas shows the combined result to everyone in real time, shared over WiFi so the whole team watches the same live preview together. You can mark specific trusted teammates so their work goes in directly without needing approval every time, while newer teammates' work waits for your OK.",
	},
	{
		title: "Design Deck",
		icon: PaletteIcon,
		body: "Describe what you want once, and get several distinct visual directions — minimal, bold, playful, editorial — built at the same time by separate AI agents working in parallel. Compare them side by side as real, working previews, then pick whichever one you like and keep building on it. No need to pick a direction upfront and hope it works out.",
	},
	{
		title: "Swarm",
		icon: GaugeIcon,
		body: "For big goals: the AI breaks your goal into many steps and works on all of them at once, each in its own fully isolated copy of the project, so far more steps can run in parallel than normal with zero risk of two steps overwriting each other's files. Once steps finish, Combine safely folds each one back into your real project, flagging anything that genuinely conflicts instead of silently breaking things.",
	},
	{
		title: "Fan-Out",
		icon: RocketIcon,
		body: "Take one finished project and generate other formats from it — a pitch deck, a one-page summary, a mobile layout — each built by its own AI agent that reads your existing project first, so it reuses the same design, colors, and branding instead of starting each format from scratch.",
	},
]

export function ProForgeAbout() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-xl">What's in ProForge</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					A plain-language rundown of what each part does and how it helps you in real life.
				</p>
			</div>
			<div className="space-y-4">
				{ABOUT_SECTIONS.map((section) => (
					<div key={section.title} className="rounded-xl border border-border p-4">
						<div className="flex items-center gap-3">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<section.icon className="size-4.5" />
							</div>
							<h2 className="font-semibold text-base">{section.title}</h2>
						</div>
						<p className="mt-2 text-muted-foreground text-sm">{section.body}</p>
					</div>
				))}
			</div>
		</div>
	)
}
