/**
 * Sidebar shell layout: wraps child routes with the sidebar + SidebarInset chrome.
 * Reads from SidebarSlotContext to allow child routes to override sidebar content.
 */
import { Button } from "@hramble/ui/components/button"
import {
	Sidebar,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	useSidebar,
} from "@hramble/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@hramble/ui/components/tooltip"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { BrainIcon, CodeIcon, HomeIcon, InfinityIcon, LayoutGridIcon, Minus, Maximize2, PanelLeftIcon, RssIcon, SearchIcon, UsersIcon, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { activeServerConfigAtom, serverConnectedAtom } from "../atoms/connection"
import { hyperloopSessionSetAtom, workspaceModeAtom } from "../atoms/workspace"
import { browserPanelOpenAtom, browserPanelWidthAtom } from "../atoms/browser"
import { communityPanelOpenAtom, communityPanelSettingsAtom, communityPanelTagAtom } from "../atoms/ui"
import { activeBridgeAtom } from "../atoms/bridge"
import { BridgePanel } from "./bridge-panel"
import { BrowserPane } from "./browser-pane"
import { CommunityPage } from "./community-page"
import { useAgents, useProjectList, useSetCommandPaletteOpen } from "../hooks/use-agents"
import { useCommunityAuthSync } from "../hooks/use-community-auth-sync"
import { useDispatchBridge } from "../hooks/use-dispatch-bridge"
import { useSleepRecovery } from "../hooks/use-sleep-recovery"
import { useAgentActions } from "../hooks/use-server"
import type { Agent } from "../lib/types"
import { pickDirectory } from "../services/backend"
import { loadProjectSessions } from "../services/connection-manager"
import { AddProjectDialog } from "./add-project-dialog"
import { APP_BAR_HEIGHT, AppBar } from "./app-bar"
import { AppSidebarContent } from "./sidebar"
import { useSidebarSlot } from "./sidebar-slot-context"
import { UpdateBanner } from "./update-banner"

// ============================================================
// Workspace switcher (Code | Hyperloop)
// ============================================================

/** Top-of-sidebar tabs that switch between the normal coder and the autonomous
 *  Hyperloop workspace. Same projects; different session list + run behaviour. */
export function WorkspaceSwitcher({
	mode,
	onChange,
}: {
	mode: "code" | "hyperloop"
	onChange: (mode: "code" | "hyperloop") => void
}) {
	return (
		<div className="px-2 pt-1 pb-2">
			<div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
				<button
					type="button"
					onClick={() => onChange("code")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition-colors ${
						mode === "code"
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<CodeIcon className="size-3.5" />
					Code
				</button>
				<button
					type="button"
					onClick={() => onChange("hyperloop")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition-colors ${
						mode === "hyperloop"
							? "bg-background text-amber-600 shadow-sm dark:text-amber-400"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<InfinityIcon className="size-3.5" />
					Hyperloop
				</button>
			</div>
		</div>
	)
}

// ============================================================
// Constants
// ============================================================

const isMac =
	typeof window !== "undefined" && "hramble" in window && window.hramble.platform === "darwin"
const isElectronEnv = typeof window !== "undefined" && "hramble" in window

/** Pixel offset from the left edge where window controls (toggle + new session) start */
const WINDOW_CONTROLS_LEFT = isMac && isElectronEnv ? 93 : 8
/** Vertical position of the custom toolbar buttons */
const WINDOW_CONTROLS_TOP = isMac && isElectronEnv ? 8 : 9
/** Right offset for TopRightControls */
const WINDOW_CONTROLS_RIGHT = 12
/** Total width reserved for traffic lights + window control buttons */
const WINDOW_CONTROLS_INSET = isMac && isElectronEnv ? 160 : 72

// ============================================================
// NarrowWindowCollapser
// ============================================================

/**
 * Watches the window width and auto-collapses the sidebar when it drops below
 * COLLAPSE_THRESHOLD px, restoring it when the window grows back above the threshold.
 * Must be rendered inside a <SidebarProvider>.
 */
const COLLAPSE_THRESHOLD = 600

function NarrowWindowCollapser() {
	const { open, setOpen } = useSidebar()
	// Track whether the last collapse was triggered by us (vs. the user manually toggling)
	const collapsedByUsRef = useRef(false)

	useEffect(() => {
		const check = () => {
			const narrow = window.innerWidth < COLLAPSE_THRESHOLD
			if (narrow && open) {
				collapsedByUsRef.current = true
				setOpen(false)
			} else if (!narrow && !open && collapsedByUsRef.current) {
				// Only re-open if WE collapsed it — don't override the user's manual close
				collapsedByUsRef.current = false
				setOpen(true)
			} else if (!narrow) {
				// Window grew back — reset the flag regardless so we don't re-open unexpectedly
				if (!open) collapsedByUsRef.current = false
			}
		}

		check()
		window.addEventListener("resize", check)
		return () => window.removeEventListener("resize", check)
	}, [open, setOpen])

	return null
}

// ============================================================
// WindowControls
// ============================================================

/**
 * Absolutely positioned window control (sidebar toggle) that stays next to the
 * macOS traffic lights regardless of sidebar state.
 * Must be rendered inside a SidebarProvider.
 */
function WindowControls() {
	const { toggleSidebar } = useSidebar()
	const navigate = useNavigate()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()

	return (
		<div
			className="absolute z-50 flex items-center gap-0.5"
			style={{
				top: WINDOW_CONTROLS_TOP,
				left: WINDOW_CONTROLS_LEFT,
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegion: "no-drag",
			}}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={toggleSidebar}
						/>
					}
				>
					<PanelLeftIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Toggle sidebar (&#8984;B)</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/home" })}
						/>
					}
				>
					<HomeIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Home</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/brain" })}
						/>
					}
				>
					<BrainIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Brain</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => setCommandPaletteOpen(true)}
						/>
					}
				>
					<SearchIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Search (&#8984;K)</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/templates" })}
						/>
					}
				>
					<LayoutGridIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Templates — pick what you're building</TooltipContent>
			</Tooltip>
		</div>
	)
}

/**
 * Top-right window control — mirrors WindowControls (top-left) but anchored
 * to the opposite corner. Mac only (rendered absolutely over the layout).
 * On Windows, WinTitleBar handles this instead.
 */
function TopRightControls() {
	const navigate = useNavigate()

	return (
		<div
			className="absolute z-50 flex items-center gap-0.5"
			style={{
				top: WINDOW_CONTROLS_TOP,
				right: WINDOW_CONTROLS_RIGHT,
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegion: "no-drag",
			}}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/team" })}
						/>
					}
				>
					<UsersIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Team Spaces — work on this together</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/community" })}
						/>
					}
				>
					<RssIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Community — share what you built</TooltipContent>
			</Tooltip>
		</div>
	)
}

/**
 * Windows-only title bar buttons: Team, Community, then — □ ×.
 * Sits in the AppBar's drag region (no-drag on the buttons themselves).
 * Replaces the native titleBarOverlay entirely.
 */
function WinTitleBar() {
	const navigate = useNavigate()

	const minimize = () => window.hramble.minimizeWindow?.()
	const maximize = () => window.hramble.maximizeWindow?.()
	const close = () => window.hramble.closeWindow?.()

	return (
		<div
			className="flex h-full items-center"
			// @ts-expect-error -- vendor-prefixed CSS property
			style={{ WebkitAppRegion: "no-drag" }}
		>
			{/* Team / Community nav */}
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/team" })}
						/>
					}
				>
					<UsersIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Team Spaces</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/community" })}
						/>
					}
				>
					<RssIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Community</TooltipContent>
			</Tooltip>

			{/* Window chrome — □ × */}
			<div className="ml-1 flex h-full items-stretch">
				<button
					type="button"
					onClick={minimize}
					className="flex w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Minimize"
				>
					<Minus className="size-3.5" />
				</button>
				<button
					type="button"
					onClick={maximize}
					className="flex w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Maximize"
				>
					<Maximize2 className="size-3" />
				</button>
				<button
					type="button"
					onClick={close}
					className="flex w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
					aria-label="Close"
				>
					<X className="size-3.5" />
				</button>
			</div>
		</div>
	)
}

// ============================================================
// SidebarLayout
// ============================================================

export function SidebarLayout() {
	const navigate = useNavigate()
	const { content: slotContent, footer: slotFooter } = useSidebarSlot()

	// The app's Google account session (shared by Settings > Account and the
	// Community page) — synced once here at the root so it's available
	// everywhere, not just while the Community page happens to be mounted.
	useCommunityAuthSync()
	useSleepRecovery()
	useDispatchBridge()

	// ---- Sidebar-specific data ----
	const agents = useAgents()
	const projects = useProjectList()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const { renameSession, deleteSession, forkSession } = useAgentActions()
	const serverConnected = useAtomValue(serverConnectedAtom)

	// Workspace mode (Code | Hyperloop). Same projects; each mode shows its own
	// session list — Hyperloop runs are tagged by id and split out here.
	const workspaceMode = useAtomValue(workspaceModeAtom)
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)
	const hyperloopSet = useAtomValue(hyperloopSessionSetAtom)

	// Sub-agents are filtered at the API level (roots: true). The 7 Hyperloop step
	// sessions are an implementation detail — the user drives everything from the
	// Hyperloop panel, so they're NEVER listed in the sidebar (in either mode).
	// Hyperloop mode therefore shows no session list at all; Code mode shows only
	// normal (non-Hyperloop) sessions.
	const visibleAgents = useMemo(
		() =>
			workspaceMode === "hyperloop"
				? []
				: agents.filter((a) => !hyperloopSet.has(a.sessionId)),
		[agents, workspaceMode, hyperloopSet],
	)

	const handleRenameSession = useCallback(
		async (agent: Agent, title: string) => {
			await renameSession(agent.directory, agent.sessionId, title)
		},
		[renameSession],
	)

	const handleDeleteSession = useCallback(
		async (agent: Agent) => {
			await deleteSession(agent.directory, agent.sessionId)
		},
		[deleteSession],
	)

	const handleForkSession = useCallback(
		async (agent: Agent) => {
			const forked = await forkSession(agent.directory, agent.sessionId)
			if (forked) {
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: { projectSlug: agent.projectSlug, sessionId: forked.id },
				})
			}
		},
		[forkSession, navigate],
	)

	const handleOpenCommandPalette = useCallback(() => {
		setCommandPaletteOpen(true)
	}, [setCommandPaletteOpen])

	// Add project: local servers use native picker, remote servers use a dialog
	const activeServer = useAtomValue(activeServerConfigAtom)
	// Browser panel is mounted at the app root so the agent's `browser` tool can
	// drive it on any route (not only inside a session view).
	const activeBridge = useAtomValue(activeBridgeAtom)
	const browserPanelOpen = useAtomValue(browserPanelOpenAtom)
	const browserPanelWidth = useAtomValue(browserPanelWidthAtom)
	const setBrowserPanelWidth = useSetAtom(browserPanelWidthAtom)
	// Community panel (agent-hub-page.tsx's "Community" toggle, website/browser-game
	// only) — takes over this same right-hand slot in place of the browser pane
	// while it's open. See atoms/ui.ts for why these are separate atoms from the
	// review panel's own (same "expanded" pattern, different feature).
	const communityPanelOpen = useAtomValue(communityPanelOpenAtom)
	const setCommunityPanelOpen = useSetAtom(communityPanelOpenAtom)
	const communityPanelTag = useAtomValue(communityPanelTagAtom)
	const [communityPanelSettings, setCommunityPanelSettings] = useAtom(communityPanelSettingsAtom)
	const browserResizeRef = useRef<{ startX: number; startWidthVw: number } | null>(null)
	const [browserResizing, setBrowserResizing] = useState(false)

	const handleBrowserResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			browserResizeRef.current = { startX: e.clientX, startWidthVw: browserPanelWidth }
			setBrowserResizing(true)
		},
		[browserPanelWidth],
	)

	useEffect(() => {
		if (!browserResizing) return
		const onMove = (e: MouseEvent) => {
			const drag = browserResizeRef.current
			if (!drag) return
			// Dragging left (negative dx) widens the panel since it's docked on the right.
			const dxVw = ((e.clientX - drag.startX) / window.innerWidth) * 100
			const next = Math.min(80, Math.max(20, drag.startWidthVw - dxVw))
			setBrowserPanelWidth(next)
		}
		const onUp = () => {
			browserResizeRef.current = null
			setBrowserResizing(false)
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
		return () => {
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
	}, [browserResizing, setBrowserPanelWidth])

	const [addProjectOpen, setAddProjectOpen] = useState(false)

	const handleAddProject = useCallback(async () => {
		if (activeServer.type === "local") {
			// Local server: open native folder picker directly
			const directory = await pickDirectory()
			if (!directory) return
			await loadProjectSessions(directory)
			navigate({ to: "/" })
		} else {
			// Remote server: show dialog with text input
			setAddProjectOpen(true)
		}
	}, [activeServer.type, navigate])

	const handleProjectAdded = useCallback(
		(_directory: string) => {
			navigate({ to: "/" })
		},
		[navigate],
	)

	return (
		<div
			className="relative flex h-screen text-foreground"
			style={
				{
					"--window-controls-inset": `${WINDOW_CONTROLS_INSET}px`,
				} as React.CSSProperties
			}
		>
			<SidebarProvider embedded defaultOpen={true}>
				<NarrowWindowCollapser />
				<Sidebar collapsible="offcanvas" variant="sidebar">
					{/* Sidebar header -- reserves space to match the app bar height so
					 * sidebar content aligns with the main content area. Also clears
					 * the traffic lights + the absolutely-positioned toggle button. */}
					<SidebarHeader
						className="flex-row items-center gap-1 shrink-0"
						style={{
							height: APP_BAR_HEIGHT,
							// Make header draggable on Electron (acts as title bar above sidebar)
							// @ts-expect-error -- vendor-prefixed CSS property
							WebkitAppRegion: "drag",
						}}
					/>
					{!slotContent && (
						<WorkspaceSwitcher
							mode={workspaceMode}
							onChange={(m) => {
								setWorkspaceMode(m)
								navigate({ to: "/" })
							}}
						/>
					)}
					{slotContent ?? (
					<AppSidebarContent
						agents={visibleAgents}
						projects={projects}
						onOpenCommandPalette={handleOpenCommandPalette}
						onAddProject={handleAddProject}
						onRenameSession={handleRenameSession}
						onDeleteSession={handleDeleteSession}
						onForkSession={handleForkSession}
						serverConnected={serverConnected}
					/>
					)}
					{/* Footer: false = hide, ReactNode = render it, null = let default handle it.
					 * When default sidebar is active, AppSidebarContent renders its own footer. */}
					{slotFooter !== false && slotFooter}
				</Sidebar>
				<SidebarInset className="bg-sidebar">
					<UpdateBanner />
					<AppBar rightSlot={!isMac && isElectronEnv ? <WinTitleBar /> : undefined} />
					{/* Flex-1 + min-h-0 wrapper: pages use h-full which would
					    resolve to 100% of SidebarInset, ignoring AppBar height.
					    This container takes remaining space after AppBar and
					    constrains page content correctly. */}
					<div className="flex min-h-0 flex-1 overflow-hidden">
						<div
							data-slot="content-area"
							className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl bg-background"
						>
							<Outlet />
						</div>
						{/* Community panel (agent-hub-page.tsx) takes over this slot in
						    place of the browser pane while it's open — an explicit
						    replacement, not a co-existing split, per the feature's design.
						    No drag-resize here on purpose (unlike the browser pane below):
						    just the persisted normal/expanded sizes, same as the review
						    panel's own expand toggle (agent-detail.tsx). */}
						{communityPanelOpen ? (
							// No fixed-pixel inner wrapper here (unlike the review panel's
							// own expand toggle) — that trick guards against mid-transition
							// reflow for its virtualized diff list, which CommunityPage has
							// no equivalent of. A "100vw" minWidth would actually be wrong
							// here anyway: this row sits to the right of the sidebar, so the
							// real available width is less than the full window's vw.
							<div
								className="h-full shrink-0 overflow-hidden border-l border-border transition-[width] duration-250 ease-in-out"
								style={{ width: communityPanelSettings.expanded ? "100%" : `${browserPanelWidth}vw` }}
							>
								<CommunityPage
									embedded
									filterTag={communityPanelTag ?? undefined}
									expanded={communityPanelSettings.expanded}
									onToggleExpanded={() =>
										setCommunityPanelSettings((prev) => ({ ...prev, expanded: !prev.expanded }))
									}
									onClose={() => setCommunityPanelOpen(false)}
								/>
							</div>
						) : (
							<>
								{/* Browser panel — always mounted (even at 0 width) so the agent
								    can drive it regardless of the current route. */}
								{browserPanelOpen && (
									<div
										onMouseDown={handleBrowserResizeStart}
										className="w-1 shrink-0 cursor-ew-resize border-border border-l hover:bg-ring active:bg-ring"
									/>
								)}
								<div
									className={`shrink-0 overflow-hidden ${browserResizing ? "" : "transition-[width] duration-250 ease-in-out"}`}
									style={{ width: browserPanelOpen ? `${browserPanelWidth}vw` : 0 }}
								>
									<div className="h-full" style={{ width: `${browserPanelWidth}vw` }}>
										<BrowserPane />
									</div>
								</div>
							</>
						)}
					</div>
				</SidebarInset>
				{/* Rendered last so it paints on top of the sidebar and app bar,
				    whose transition properties create stacking contexts. */}
				{activeBridge && (
					<div className="pointer-events-auto absolute right-0 top-0 z-40 h-full w-72 shrink-0 border-l border-border bg-background shadow-lg">
						<BridgePanel />
					</div>
				)}
				<WindowControls />
				{isMac && isElectronEnv && <TopRightControls />}
			</SidebarProvider>
			<AddProjectDialog
				open={addProjectOpen}
				onOpenChange={setAddProjectOpen}
				onAdded={handleProjectAdded}
			/>
		</div>
	)
}
