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
	GaugeIcon,
	GitMergeIcon,
	MonitorIcon,
	PaletteIcon,
	RocketIcon,
	RotateCwIcon,
	SparklesIcon,
	UsersIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { communityAccessTokenAtom } from "../atoms/community"
import { activeTeamAtom, activeTeamIdAtom, masterSessionPreviewUrlAtom } from "../atoms/team"
import type { Team } from "../lib/team-client"
import {
	connectMasterSessionCanvas,
	type MasterSessionCanvasStatus,
	masterSessionRoomToken,
	publishMasterSessionCanvasUrl,
} from "../lib/master-session-relay"
import { useSetSidebarSlot } from "./sidebar-slot-context"
import { CreateOrJoinTeam, GateScreen, TeamWorkspace, useTeamSpaces } from "./team-page"

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

export function ProForgeDesignDeck() {
	return (
		<ProForgeSectionStub
			icon={PaletteIcon}
			title="Design Deck"
			description="Generate multiple UI design variants at once, compare them side by side, and bring the one that works into production code."
		/>
	)
}

export function ProForgeSwarm() {
	return (
		<ProForgeSectionStub
			icon={GaugeIcon}
			title="Swarm"
			description="Hyperloop, scaled up — run far more agents through the loop in parallel for heavier, team-scale work. Planned for later."
		/>
	)
}

export function ProForgeFanOut() {
	return (
		<ProForgeSectionStub
			icon={RocketIcon}
			title="Fan-Out"
			description="One project, many outputs — web, mobile, decks, video — sharing the same design system. Planned for later."
		/>
	)
}
