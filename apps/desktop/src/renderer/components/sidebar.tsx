import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@hramble/ui/components/context-menu"
import { Input } from "@hramble/ui/components/input"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hramble/ui/components/dropdown-menu"
import {
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@hramble/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@hramble/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import {
	AlertCircleIcon,
	ArrowDownUpIcon,
	BotIcon,
	CheckIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	CommandIcon,
	GitForkIcon,
	Loader2Icon,
	MoreVerticalIcon,
	PlusIcon,
	SettingsIcon,
	TimerIcon,
	TrashIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { activeServerConfigAtom } from "../atoms/connection"
import { automationsEnabledAtom } from "../atoms/feature-flags"
import {
	type HyperloopRun,
	hyperloopRunAtom,
	hyperloopRunsAtom,
	hyperloopSessionSetAtom,
	workspaceModeAtom,
} from "../atoms/workspace"
import { useSessionSortMode } from "../hooks/use-agents"
import type { Agent, AgentStatus, SidebarProject } from "../lib/types"
import { splitDefaultSessionName } from "../lib/session-title"
import { ServerIndicator } from "./server-indicator"
import { HrambleAvatar } from "./hramble-avatar"

// ============================================================
// Constants
// ============================================================

/** How many sessions to show in the flat "Sessions" list */
const SESSION_COUNT = 30

const STATUS_ICON: Record<AgentStatus, typeof Loader2Icon> = {
	running: Loader2Icon,
	waiting: TimerIcon,
	paused: CircleDotIcon,
	completed: CheckCircle2Icon,
	failed: AlertCircleIcon,
	idle: CircleDotIcon,
}

const STATUS_COLOR: Record<AgentStatus, string> = {
	running: "text-green-500",
	waiting: "text-yellow-500",
	paused: "text-muted-foreground",
	completed: "text-muted-foreground",
	failed: "text-red-500",
	idle: "text-muted-foreground",
}

/**
 * Claude-style session marker for the common running/idle/paused/completed
 * states: a near-invisible ring with a small centered dot that's green while
 * the session is actively working and grey otherwise. Waiting/failed keep
 * their own distinct icon (Timer/Alert) since those need to stand out, not
 * blend in like this one deliberately does.
 */
function StatusDot({ color }: { color: "green" | "red" | "grey" }) {
	const dotColor = color === "green" ? "bg-green-500" : color === "red" ? "bg-red-500" : "bg-muted-foreground/30"
	return (
		<span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/10">
			<span className={`size-1.5 rounded-full ${dotColor} ${color === "green" ? "animate-pulse" : ""}`} />
		</span>
	)
}

// ============================================================
// Props
// ============================================================

interface AppSidebarContentProps {
	agents: Agent[]
	projects: SidebarProject[]
	onOpenCommandPalette: () => void
	onAddProject?: () => void
	onRenameSession?: (agent: Agent, title: string) => Promise<void>
	onDeleteSession?: (agent: Agent) => Promise<void>
	onForkSession?: (agent: Agent) => Promise<void>
	serverConnected: boolean
}

// ============================================================
// Main component
// ============================================================

/**
 * A single Hyperloop run in the sidebar — ONE row per run (goal), not the 7
 * step sessions. Clicking it reopens the run in the Hyperloop panel.
 */
function HyperloopRunItem({
	run,
	isSelected,
	onOpen,
}: {
	run: HyperloopRun
	isSelected: boolean
	onOpen: () => void
}) {
	const done = run.steps.filter((s) => s.status === "done").length
	const failed = run.steps.some((s) => s.status === "failed")
	return (
		<SidebarMenuItem>
			<SidebarMenuButton isActive={isSelected} tooltip={run.goal} onClick={onOpen}>
				<StatusDot color={run.running ? "green" : failed ? "red" : "grey"} />
				<span className="min-w-0 flex-1 truncate text-[13px]">{run.goal || "Untitled run"}</span>
				<span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
					{done}/{run.steps.length}
				</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	)
}

const SORT_OPTIONS: { mode: "default" | "numbered" | "date"; label: string; hint: string }[] = [
	{ mode: "default", label: "Default", hint: "Active first, then most recent — no extra sorting." },
	{ mode: "numbered", label: "Numbered", hint: "Stable order by when each was created; whatever's working stays on top." },
	{ mode: "date", label: "Today, Yesterday…", hint: "Grouped under date headers, Claude-style." },
]

/** Sort-mode picker for the Sessions list — Default / Numbered / by-date groups. */
function SessionSortButton() {
	const [mode, setMode] = useSessionSortMode()
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						title="Sort sessions"
						className={`text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors ${mode !== "default" ? "text-primary" : ""}`}
					/>
				}
			>
				<ArrowDownUpIcon className="size-4 shrink-0" />
				<span className="sr-only">Sort sessions</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{SORT_OPTIONS.map((opt) => (
					<DropdownMenuItem key={opt.mode} onClick={() => setMode(opt.mode)} className="flex flex-col items-start gap-0.5">
						<span className="flex w-full items-center gap-1.5">
							{opt.label}
							{mode === opt.mode && <CheckIcon className="ml-auto size-3.5 text-primary" />}
						</span>
						<span className="text-[11px] text-muted-foreground">{opt.hint}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/**
 * Default sidebar content: Active Now, Recent, Projects groups + Settings footer.
 * Rendered inside the `<Sidebar>` shell provided by `SidebarLayout`.
 */
export function AppSidebarContent({
	agents,
	projects,
	onOpenCommandPalette,
	onAddProject,
	onRenameSession,
	onDeleteSession,
	onForkSession,
	serverConnected,
}: AppSidebarContentProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null
	const automationsEnabled = useAtomValue(automationsEnabledAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
	const isLocalServer = activeServer.type === "local"
	// Each mode gets its OWN session history: Code shows normal sessions,
	// Hyperloop shows only Hyperloop-tagged ones. (Same projects; separate lists.)
	const workspaceMode = useAtomValue(workspaceModeAtom)
	const hyperloopSessions = useAtomValue(hyperloopSessionSetAtom)
	// Hyperloop history: one entry per run (not the 7 step sessions).
	const hyperloopRuns = useAtomValue(hyperloopRunsAtom)
	const activeRun = useAtomValue(hyperloopRunAtom)
	const setActiveRun = useSetAtom(hyperloopRunAtom)

	const [sessionSortMode] = useSessionSortMode()

	// Sessions (Claude-style), filtered to the active mode. Three sort modes:
	// "default" (active first, then most-recent), "numbered" (stable creation
	// order, active still pinned above), "date" (grouped under Today/Yesterday/…).
	const sessionListBase = useMemo(
		() =>
			agents
				.filter((a) => !a.parentId)
				.filter((a) => {
					// A session is Hyperloop if it's tagged OR named like a Hyperloop step
					// ("Hyperloop plan", "Hyperloop 3: …"). The name check catches older
					// runs whose step sessions predate tagging, so they never leak into the
					// Code list — the 7 steps are not pages the user should browse.
					const isHyper = hyperloopSessions.has(a.id) || /^Hyperloop(\s|:|$)/i.test(a.name)
					return workspaceMode === "hyperloop" ? isHyper : !isHyper
				}),
		[agents, workspaceMode, hyperloopSessions],
	)

	const isActiveSession = (a: Agent) =>
		a.status === "running" || a.status === "waiting" || a.status === "failed"

	type SortedSessions = { mode: "flat"; items: Agent[] } | { mode: "grouped"; groups: { label: string; items: Agent[] }[] }

	const sessionList = useMemo<SortedSessions>(() => {
		if (sessionSortMode === "numbered") {
			const working = sessionListBase.filter(isActiveSession).sort((a, b) => a.createdAt - b.createdAt)
			const rest = sessionListBase.filter((a) => !isActiveSession(a)).sort((a, b) => a.createdAt - b.createdAt)
			return { mode: "flat", items: [...working, ...rest].slice(0, SESSION_COUNT) }
		}

		const defaultSorted = [...sessionListBase]
			.sort((a, b) => {
				const aActive = isActiveSession(a)
				const bActive = isActiveSession(b)
				if (aActive !== bActive) return aActive ? -1 : 1
				return b.lastActiveAt - a.lastActiveAt
			})
			.slice(0, SESSION_COUNT)

		if (sessionSortMode !== "date") return { mode: "flat", items: defaultSorted }

		const today = new Date()
		today.setHours(0, 0, 0, 0)
		const todayMs = today.getTime()
		const yesterdayMs = todayMs - 86_400_000
		const weekAgoMs = todayMs - 7 * 86_400_000
		const buckets: { label: string; items: Agent[] }[] = [
			{ label: "Today", items: [] },
			{ label: "Yesterday", items: [] },
			{ label: "Previous 7 Days", items: [] },
			{ label: "Older", items: [] },
		]
		for (const a of defaultSorted) {
			if (a.lastActiveAt >= todayMs) buckets[0].items.push(a)
			else if (a.lastActiveAt >= yesterdayMs) buckets[1].items.push(a)
			else if (a.lastActiveAt >= weekAgoMs) buckets[2].items.push(a)
			else buckets[3].items.push(a)
		}
		return { mode: "grouped", groups: buckets.filter((b) => b.items.length > 0) }
	}, [sessionListBase, sessionSortMode])

	const hasContent = agents.length > 0 || projects.length > 0 || hyperloopRuns.length > 0
	const showEmptyState = !hasContent

	return (
		<>
			{/* Scrollable content */}
			<SidebarContent>
				{/* Empty state */}
				{showEmptyState && (
					<div className="flex flex-1 items-center justify-center p-4">
						<div className="space-y-2 text-center">
							{!serverConnected ? (
								<>
									<p className="text-sm text-muted-foreground">Server offline</p>
									<p className="text-xs text-muted-foreground/60">
										Check your connection in Settings
									</p>
								</>
							) : (
								<>
									<p className="text-sm text-muted-foreground">No projects yet</p>
									<p className="text-xs text-muted-foreground/60">Add a project to get started</p>
								</>
							)}
						</div>
					</div>
				)}

			{/* Avatar companion — docked here, click to pop out & drag anywhere */}
			<HrambleAvatar />

			{/* New Session + Automations */}
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="New Session"
								onClick={() => {
									// Hyperloop's run persists across navigation on purpose (so
									// leaving and coming back restores it) — but "New Session" is
									// an explicit ask for a blank slate, so clear it here. Never
									// clear a run that's still actively working, to avoid losing
									// an in-flight job just because the user clicked New Session
									// while looking at the Code tab.
									if (activeRun && !activeRun.running) setActiveRun(null)
									navigate({ to: "/" })
								}}
								className="text-muted-foreground"
							>
								<PlusIcon className="size-4" />
								<span>New Session</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						{automationsEnabled && isLocalServer && (
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Automations"
									onClick={() => navigate({ to: "/automations" })}
									className="text-muted-foreground"
								>
									<BotIcon className="size-4" />
									<span>Automations</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						)}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

				{/* Sessions — flat list, Claude-style (no project-folder tree) */}
				{hasContent && (
					<SidebarGroup>
						<SidebarGroupLabel>{workspaceMode === "hyperloop" ? "Hyperloop runs" : "Sessions"}</SidebarGroupLabel>
						{/* Action buttons: sort + command palette + add folder */}
						<div className="absolute top-3.5 right-3 flex items-center gap-0.5">
							{workspaceMode !== "hyperloop" && <SessionSortButton />}
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											onClick={onOpenCommandPalette}
											className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
										/>
									}
								>
									<CommandIcon className="size-4 shrink-0" />
									<span className="sr-only">Command palette</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">Command palette (&#8984;K)</TooltipContent>
							</Tooltip>
							{onAddProject && (
								<Tooltip>
									<TooltipTrigger
										render={
											<button
												type="button"
												onClick={onAddProject}
												className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
											/>
										}
									>
										<PlusIcon className="size-4 shrink-0" />
										<span className="sr-only">Add folder</span>
									</TooltipTrigger>
									<TooltipContent side="bottom">Add folder</TooltipContent>
								</Tooltip>
							)}
						</div>
						<SidebarGroupContent>
							<SidebarMenu>
							{workspaceMode === "hyperloop" ? (
								<>
									{hyperloopRuns.map((run) => (
										<HyperloopRunItem
											key={run.id}
											run={run}
											isSelected={run.id === activeRun?.id}
											onOpen={() => {
												setActiveRun(run)
												navigate({ to: "/" })
											}}
										/>
									))}
									{hyperloopRuns.length === 0 && (
										<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No runs yet</p>
									)}
								</>
							) : sessionList.mode === "grouped" ? (
								<>
									{sessionList.groups.map((group) => (
										<div key={group.label} className="mb-1">
											<p className="px-2 pt-1.5 pb-0.5 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wide">
												{group.label}
											</p>
											{group.items.map((agent) => (
												<SessionItem
													key={agent.id}
													agent={agent}
													isSelected={agent.id === selectedSessionId}
													onRename={onRenameSession}
													onDelete={onDeleteSession}
													onFork={onForkSession}
													showProject
												/>
											))}
										</div>
									))}
								</>
							) : (
								<>
									{sessionList.items.map((agent) => (
										<SessionItem
											key={agent.id}
											agent={agent}
											isSelected={agent.id === selectedSessionId}
											onRename={onRenameSession}
											onDelete={onDeleteSession}
											onFork={onForkSession}
											showProject
										/>
									))}
									{sessionList.items.length === 0 && (
										<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
									)}
								</>
							)}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
						</SidebarContent>
			<SidebarFooter className="space-y-0 p-2">
				<ServerIndicator />
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Settings"
							onClick={() => navigate({ to: "/settings" })}
							className="text-muted-foreground"
						>
							<SettingsIcon className="size-4" />
							<span>Settings</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</>
	)
}

// ============================================================
// Session item
// ============================================================

/**
 * Hook that returns a live-updating relative "last active" time string.
 * For active (running/waiting) sessions, ticks every minute.
 * For idle/completed sessions, returns the static duration from the agent atom.
 */
function useLiveLastActive(agent: Agent): string {
	const isActive = agent.status === "running" || agent.status === "waiting"

	const [display, setDisplay] = useState(agent.duration)

	useEffect(() => {
		if (!isActive) {
			setDisplay(agent.duration)
			return
		}

		// Active sessions: show "now" and tick every 60s to stay fresh
		setDisplay("now")
		const id = setInterval(() => setDisplay("now"), 60_000)
		return () => clearInterval(id)
	}, [isActive, agent.duration])

	return display
}

const SessionItem = memo(function SessionItem({
	agent,
	isSelected,
	onRename,
	onDelete,
	onFork,
	showProject = false,
	compact = false,
}: {
	agent: Agent
	isSelected: boolean
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
	showProject?: boolean
	compact?: boolean
}) {
	const navigate = useNavigate()
	const [, startTransition] = useTransition()
	const StatusIcon = STATUS_ICON[agent.status]
	const statusColor = STATUS_COLOR[agent.status]
	const isWorktree = !!agent.worktreePath
	const lastActive = useLiveLastActive(agent)
	// A session can end up here (e.g. leaked past the Code/Hyperloop list filter,
	// or opened via search/fork) even though it's Hyperloop-tagged — in that case
	// clicking it must restore the Hyperloop view, not the plain chat page, or the
	// user lands on SessionView with no Hyperloop panel at all.
	const hyperloopSessions = useAtomValue(hyperloopSessionSetAtom)
	const hyperloopRuns = useAtomValue(hyperloopRunsAtom)
	const setActiveRun = useSetAtom(hyperloopRunAtom)
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)

	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState(agent.name)
	const inputRef = useRef<HTMLInputElement>(null)

	const onSelect = useCallback(() => {
		// Same "is this a Hyperloop session" check the sidebar's own list filter
		// uses (hyperloopSessionSetAtom OR the "Hyperloop ..." name pattern for
		// older runs whose steps predate tagging) — matching only the tag Set
		// here missed exactly those older/legacy sessions.
		const isHyperTagged = hyperloopSessions.has(agent.id) || /^Hyperloop(\s|:|$)/i.test(agent.name)
		if (isHyperTagged) {
			// Prefer an exact match on which run this session was a step of; if
			// that fails (e.g. this is the plan/parent session rather than one of
			// the 7 step sessions), fall back to the most recent run for the same
			// project directory rather than silently restoring nothing.
			const run =
				hyperloopRuns.find((r) => r.steps.some((s) => s.sessionId === agent.id)) ||
				hyperloopRuns.find((r) => r.directory === agent.projectDirectory)
			startTransition(() => {
				if (run) setActiveRun(run)
				setWorkspaceMode("hyperloop")
				navigate({ to: "/" })
			})
			return
		}
		startTransition(() => {
			navigate({
				to: "/project/$projectSlug/session/$sessionId",
				params: { projectSlug: agent.projectSlug, sessionId: agent.id },
			})
		})
	}, [
		navigate,
		agent.projectSlug,
		agent.id,
		agent.name,
		agent.projectDirectory,
		hyperloopSessions,
		hyperloopRuns,
		setActiveRun,
		setWorkspaceMode,
	])

	const startEditing = useCallback(() => {
		setEditValue(agent.name)
		setIsEditing(true)
	}, [agent.name])

	const confirmRename = useCallback(async () => {
		const trimmed = editValue.trim()
		setIsEditing(false)
		if (trimmed && trimmed !== agent.name && onRename) {
			await onRename(agent, trimmed)
		}
	}, [editValue, agent, onRename])

	const cancelEditing = useCallback(() => {
		setIsEditing(false)
		setEditValue(agent.name)
	}, [agent.name])

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus()
			inputRef.current.select()
		}
	}, [isEditing])

	const { display: displayName, createdAtLabel } = useMemo(
		() => splitDefaultSessionName(agent.name),
		[agent.name],
	)
	const tooltipLabel = showProject
		? createdAtLabel
			? `${agent.project} — created ${createdAtLabel}`
			: agent.project
		: createdAtLabel
			? `Created ${createdAtLabel}`
			: agent.name

	const btn = (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={isSelected}
				tooltip={tooltipLabel}
				size={compact ? "sm" : "default"}
				onClick={isEditing ? undefined : onSelect}
			>
				{isWorktree ? (
					<GitForkIcon
						className={`shrink-0 ${statusColor} ${agent.status === "running" ? "animate-pulse" : ""}`}
					/>
				) : agent.status === "waiting" || agent.status === "failed" ? (
					<StatusIcon className={`shrink-0 ${statusColor}`} />
				) : (
					<StatusDot color={agent.status === "running" ? "green" : "grey"} />
				)}

				{isEditing ? (
					<Input
						ref={inputRef}
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter") confirmRename()
							if (e.key === "Escape") cancelEditing()
						}}
						onBlur={confirmRename}
						onClick={(e) => e.stopPropagation()}
						className={`h-auto min-w-0 flex-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 ${compact ? "text-xs" : "text-[13px]"}`}
					/>
				) : (
					<div className="min-w-0 flex-1">
						{/* Claude-style rename: click the title of the session you're
						 *  already viewing to edit it inline — no menu needed. Other
						 *  (non-active) rows keep click-to-navigate as their one job. */}
						<span
							className={`block truncate leading-tight ${compact ? "text-xs" : "text-[13px]"} ${
								isSelected && onRename ? "hover:underline" : ""
							}`}
							onClick={
								isSelected && onRename
									? (e) => {
											e.stopPropagation()
											startEditing()
										}
									: undefined
							}
						>
							{displayName}
						</span>

						{agent.status === "waiting" && agent.currentActivity && (
							<span className="block truncate text-[11px] leading-tight text-yellow-500">
								{agent.currentActivity}
							</span>
						)}
					</div>
				)}

				{!isEditing && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground group-hover/menu-item:opacity-0">
						{lastActive}
					</span>
				)}
			</SidebarMenuButton>

			{/* Visible ⋯ button (appears on hover) — same actions as the right-click menu.
			 *  Rename lives on the title itself now (click it while selected), not here. */}
			{!isEditing && (onFork || onDelete) && (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuAction
								showOnHover
								aria-label="Session options"
								onClick={(e) => e.stopPropagation()}
							/>
						}
					>
						<MoreVerticalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="right" className="min-w-[150px]">
						{onFork && (
							<DropdownMenuItem onClick={() => onFork(agent)}>
								<GitForkIcon className="size-4" />
								Fork
							</DropdownMenuItem>
						)}
						{onFork && onDelete && <DropdownMenuSeparator />}
						{onDelete && (
							<DropdownMenuItem variant="destructive" onClick={() => onDelete(agent)}>
								<TrashIcon className="size-4" />
								Delete
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</SidebarMenuItem>
	)

	return (
		<ContextMenu>
			<ContextMenuTrigger render={btn} />
			<ContextMenuContent>
				{onFork && (
					<ContextMenuItem onSelect={() => onFork(agent)}>
						<GitForkIcon className="size-4" />
						Fork
					</ContextMenuItem>
				)}
				{onFork && onDelete && <ContextMenuSeparator />}
				{onDelete && (
					<ContextMenuItem variant="destructive" onSelect={() => onDelete(agent)}>
						<TrashIcon className="size-4" />
						Delete
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
})

