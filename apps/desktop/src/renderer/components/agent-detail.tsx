import { Button } from "@hramble/ui/components/button"
import { Input } from "@hramble/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@hramble/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@hramble/ui/components/tooltip"
import { cn } from "@hramble/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { toast } from "sonner"
import {
	ArrowLeftIcon,
	ArrowUpRightIcon,
	CheckIcon,
	ChevronLeftIcon,
	CopyIcon,
	ExternalLinkIcon,
	LinkIcon,
	FileDiffIcon,
	FolderTreeIcon,
	GlobeIcon,
	GitForkIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RadioTowerIcon,
	SendIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { OpenInTarget } from "../../preload/api"
import { reviewPanelOpenAtom, reviewPanelSettingsAtom, sessionDiffStatsFamily } from "../atoms/ui"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../hooks/use-opencode-data"
import { useAgents } from "../hooks/use-agents"
import { useAgentActions, useServerConnection } from "../hooks/use-server"
import { useSessionShare } from "../hooks/use-session-share"
import { useSessionBridge } from "../hooks/use-session-bridge"
import type { ChatTurn } from "../hooks/use-session-chat"
import type { Agent, FileAttachment, QuestionAnswer } from "../lib/types"
import {
	fetchOpenInTargets,
	isElectron,
	openExternal,
	openInTarget,
	pickHtmlFile,
	servePreviewFile,
} from "../services/backend"
import { messagesFamily } from "../atoms/messages"
import { useSetAppBarContent } from "./app-bar-context"
import { ChatView } from "./chat"
import { HrambleWordmark } from "./hramble-wordmark"
import { ReviewPanel } from "./review/review-panel"
import { fileExplorerOpenAtom } from "../atoms/file-explorer"
import { FileExplorer } from "./file-explorer"
import { browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"
import { WorktreeActions } from "./worktree-actions"


interface AgentDetailProps {
	agent: Agent
	/** Structured chat turns (for Chat tab) */
	chatTurns: ChatTurn[]
	chatLoading?: boolean
	/** Whether earlier messages are currently being loaded */
	chatLoadingEarlier?: boolean
	/** Whether there are earlier messages that can be loaded */
	chatHasEarlier?: boolean
	/** Callback to load earlier messages */
	onLoadEarlier?: () => void
	onStop?: (agent: Agent) => Promise<void>
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
	onReplyQuestion?: (agent: Agent, requestId: string, answers: QuestionAnswer[]) => Promise<void>
	onRejectQuestion?: (agent: Agent, requestId: string) => Promise<void>
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: {
			model?: ModelRef
			agentName?: string
			variant?: string
			files?: FileAttachment[]
			hyperloop?: boolean
		},
	) => Promise<void>
	onRename?: (agent: Agent, title: string) => Promise<void>
	/** Display name of the parent session (for breadcrumb) */
	parentSessionName?: string
	isConnected?: boolean
	/** Provider data for model selector */
	providers?: ProvidersData | null
	/** Config data (default model, default agent) */
	config?: ConfigData | null
	/** VCS data for status bar */
	vcs?: VcsData | null
	/** Available OpenCode agents for agent selector */
	openCodeAgents?: SdkAgent[]
	/** Whether undo is available */
	canUndo?: boolean
	/** Whether redo is available */
	canRedo?: boolean
	/** Undo handler — returns the undone user message text */
	onUndo?: () => Promise<string | undefined>
	/** Redo handler */
	onRedo?: () => Promise<void>
	/** Whether the session is in a reverted state */
	isReverted?: boolean
	/** Revert to a specific message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>
	/** Fork from a turn boundary (messageId of the next turn's user message, or undefined for full fork) */
	onForkFromTurn?: (messageId?: string) => Promise<void>
	/** Delete a specific part from a message (for error recovery) */
	onDeletePart?: (sessionId: string, messageId: string, partId: string) => Promise<void>
}

export function AgentDetail({
	agent,
	chatTurns,
	chatLoading,
	onStop,
	onApprove,
	onDeny,
	onReplyQuestion,
	onRejectQuestion,
	onSendMessage,
	onRename,
	parentSessionName,
	isConnected,
	providers,
	config,
	vcs,
	openCodeAgents,
	chatLoadingEarlier,
	chatHasEarlier,
	onLoadEarlier,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	onRevertToMessage,
	onForkFromTurn,
	onDeletePart,
}: AgentDetailProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }
	const setAppBarContent = useSetAppBarContent()

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [titleValue, setTitleValue] = useState(agent.name)
	const titleInputRef = useRef<HTMLInputElement>(null)

	// Review panel state
	const [reviewPanelOpen, setReviewPanelOpen] = useAtom(reviewPanelOpenAtom)
	const [reviewSettings, setReviewSettings] = useAtom(reviewPanelSettingsAtom)
	// File explorer panel state (left side).
	const [fileExplorerOpen, setFileExplorerOpen] = useAtom(fileExplorerOpenAtom)
	// Browser panel state (right side).
	const [browserPanelOpen, setBrowserPanelOpen] = useAtom(browserPanelOpenAtom)

	// Keyboard shortcut: Cmd+Shift+D toggles review; Cmd+Shift+E toggles files;
	// Cmd+Shift+B toggles the browser.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
				e.preventDefault()
				setFileExplorerOpen((prev) => !prev)
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
				e.preventDefault()
				setReviewPanelOpen((prev) => !prev)
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "b") {
				e.preventDefault()
				setBrowserPanelOpen((prev) => !prev)
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
				e.preventDefault()
				if (reviewPanelOpen) {
					setReviewSettings((prev) => ({ ...prev, expanded: !prev.expanded }))
				}
			}
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [setReviewPanelOpen, setReviewSettings, reviewPanelOpen, setFileExplorerOpen, setBrowserPanelOpen])

	// Close review panel when navigating to a session with no diffs
	const prevSessionIdRef = useRef(agent.sessionId)
	const diffStats = useAtomValue(sessionDiffStatsFamily(agent.sessionId))
	useEffect(() => {
		if (prevSessionIdRef.current !== agent.sessionId) {
			prevSessionIdRef.current = agent.sessionId
			if (diffStats.fileCount === 0) {
				setReviewPanelOpen(false)
			}
		}
	}, [agent.sessionId, diffStats.fileCount, setReviewPanelOpen])

	const startEditingTitle = useCallback(() => {
		if (!onRename) return
		setTitleValue(agent.name)
		setIsEditingTitle(true)
	}, [agent.name, onRename])

	const confirmTitle = useCallback(async () => {
		const trimmed = titleValue.trim()
		setIsEditingTitle(false)
		if (trimmed && trimmed !== agent.name && onRename) {
			await onRename(agent, trimmed)
		}
	}, [titleValue, agent, onRename])

	const cancelEditingTitle = useCallback(() => {
		setIsEditingTitle(false)
		setTitleValue(agent.name)
	}, [agent.name])

	useEffect(() => {
		if (isEditingTitle && titleInputRef.current) {
			titleInputRef.current.focus()
			titleInputRef.current.select()
		}
	}, [isEditingTitle])

	// ===== Inject session info into AppBar right section =====
	useEffect(() => {
		setAppBarContent(
			<SessionAppBarContent
				agent={agent}
				isEditingTitle={isEditingTitle}
				titleValue={titleValue}
				titleInputRef={titleInputRef}
				onTitleValueChange={setTitleValue}
				onStartEditing={startEditingTitle}
				onConfirmTitle={confirmTitle}
				onCancelEditing={cancelEditingTitle}
				onRename={onRename}
				projectSlug={projectSlug}
				reviewPanelOpen={reviewPanelOpen}
				onToggleReviewPanel={() => setReviewPanelOpen((prev) => !prev)}
				fileExplorerOpen={fileExplorerOpen}
				onToggleFileExplorer={() => setFileExplorerOpen((prev) => !prev)}
					browserPanelOpen={browserPanelOpen}
					onToggleBrowserPanel={() => setBrowserPanelOpen((prev) => !prev)}
			/>,
		)

		// Clean up when unmounting
		return () => setAppBarContent(null)
	}, [
		agent,
		isEditingTitle,
		titleValue,
		startEditingTitle,
		confirmTitle,
		cancelEditingTitle,
		onRename,
		projectSlug,
		setAppBarContent,
		reviewPanelOpen,
		setReviewPanelOpen,
		fileExplorerOpen,
		setFileExplorerOpen,
	])

	const chatContent = (
		<>
			{/* Sub-agent breadcrumb -- navigate back to parent */}
			{agent.parentId && (
				<button
					type="button"
					onClick={() =>
						navigate({
							to: "/project/$projectSlug/session/$sessionId",
							params: { projectSlug: projectSlug ?? agent.projectSlug, sessionId: agent.parentId! },
						})
					}
					className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3" />
					<span>
						Back to{" "}
						<span className="font-medium text-foreground">
							{parentSessionName || "parent session"}
						</span>
					</span>
				</button>
			)}

			{/* Chat -- full height */}
			<div className="min-h-0 flex-1">
				<ChatView
					turns={chatTurns}
					loading={chatLoading ?? false}
					loadingEarlier={chatLoadingEarlier ?? false}
					hasEarlierMessages={chatHasEarlier ?? false}
					onLoadEarlier={onLoadEarlier}
					agent={agent}
					isConnected={isConnected ?? false}
					onSendMessage={onSendMessage}
					onStop={onStop}
					providers={providers}
					config={config}
					vcs={vcs}
					openCodeAgents={openCodeAgents}
					onApprove={onApprove}
					onDeny={onDeny}
					onReplyQuestion={onReplyQuestion}
					onRejectQuestion={onRejectQuestion}
					canUndo={canUndo}
					canRedo={canRedo}
					onUndo={onUndo}
					onRedo={onRedo}
					isReverted={isReverted}
				onRevertToMessage={onRevertToMessage}
				onForkFromTurn={onForkFromTurn}
				onDeletePart={onDeletePart}
				reviewPanelOpen={reviewPanelOpen}
				/>
			</div>
		</>
	)

	return (
		<div className="flex h-full">
			{/* File explorer -- slides in/out from the left */}
			<div
				className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
				style={{ width: fileExplorerOpen ? 240 : 0 }}
			>
				<div className="h-full" style={{ width: 240 }}>
					<FileExplorer directory={agent.directory} />
				</div>
			</div>

			{/* Chat panel -- takes remaining space */}
			<div className="min-w-0 flex-1 flex flex-col">{chatContent}</div>

			{/* Review panel -- slides in/out from right */}
			<div
				className="shrink-0 overflow-hidden border-l border-border transition-[width] duration-250 ease-in-out"
				style={{ width: reviewPanelOpen ? (reviewSettings.expanded ? "100%" : "40%") : 0 }}
			>
				{/* Keep ReviewPanel mounted so it retains state, just hidden at 0 width */}
				<div className="h-full" style={{ minWidth: reviewSettings.expanded ? "100vw" : "40vw" }}>
					<ReviewPanel sessionId={agent.sessionId} directory={agent.directory} />
				</div>
			</div>

		</div>
	)
}

// ============================================================
// Session header content injected into the AppBar
// ============================================================

function SessionAppBarContent({
	agent,
	isEditingTitle,
	titleValue,
	titleInputRef,
	onTitleValueChange,
	onStartEditing,
	onConfirmTitle,
	onCancelEditing,
	onRename,
	projectSlug,
	reviewPanelOpen,
	onToggleReviewPanel,
	fileExplorerOpen,
	onToggleFileExplorer,
	browserPanelOpen,
	onToggleBrowserPanel,
}: {
	agent: Agent
	isEditingTitle: boolean
	titleValue: string
	titleInputRef: React.RefObject<HTMLInputElement | null>
	onTitleValueChange: (v: string) => void
	onStartEditing: () => void
	onConfirmTitle: () => void
	onCancelEditing: () => void
	onRename?: (agent: Agent, title: string) => Promise<void>
	projectSlug?: string
	reviewPanelOpen: boolean
	onToggleReviewPanel: () => void
	fileExplorerOpen: boolean
	onToggleFileExplorer: () => void
	browserPanelOpen: boolean
	onToggleBrowserPanel: () => void
}) {
	const navigate = useNavigate()
	const diffStats = useAtomValue(sessionDiffStatsFamily(agent.sessionId))
	const messages = useAtomValue(messagesFamily(agent.sessionId))
	const hasMessages = messages.length > 0

	return (
		<div className="flex h-full w-full min-w-0 items-center gap-2.5">
			{/* App name — hidden once the session has messages */}
			{!hasMessages && (
				<>
					<HrambleWordmark className="hidden h-[11px] w-auto shrink-0 text-muted-foreground/70 md:block" />
					<div className="hidden h-3 w-px shrink-0 bg-border/60 md:block" />
				</>
			)}

			{/* Breadcrumb: project / [branch badge] / session name */}
			<div
				className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
				style={{
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* Project name */}
				<span className="hidden shrink-0 text-xs leading-none text-muted-foreground sm:inline">
					{agent.project}
				</span>

				{/* Worktree branch badge */}
				{agent.worktreeBranch && <WorktreeBranchBadge branch={agent.worktreeBranch} />}

				<span className="hidden shrink-0 text-xs leading-none text-muted-foreground/40 sm:inline">
					/
				</span>

				{/* Session name — click to edit */}
				{isEditingTitle ? (
					<div className="inline-grid min-w-0 max-w-full flex-1 items-center">
						{/* Ghost span — sizes the grid column to match the text width */}
						<span className="invisible col-start-1 row-start-1 truncate text-xs font-semibold leading-none">
							{titleValue}
						</span>
						<Input
							ref={titleInputRef}
							value={titleValue}
							onChange={(e) => onTitleValueChange(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === "Enter") onConfirmTitle()
								if (e.key === "Escape") onCancelEditing()
							}}
							onBlur={onConfirmTitle}
							className="col-start-1 row-start-1 h-7 min-w-0 border-none bg-transparent p-0 text-xs md:text-xs font-semibold leading-none shadow-none focus-visible:ring-0"
						/>
					</div>
				) : (
					<button
						type="button"
						onClick={onRename ? onStartEditing : undefined}
						className={`group flex min-w-0 items-center gap-1.5 ${onRename ? "cursor-pointer" : "cursor-default"}`}
					>
						<h2 className="min-w-0 truncate text-xs font-semibold leading-none">
							{agent.name}
						</h2>
						{onRename && (
							<PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
						)}
					</button>
				)}
			</div>

			{/* Right-aligned items */}
			{/* pr-[76px] reserves room for the fixed, window-corner-pinned
			 *  TopRightControls (Team Spaces + Community icons, sidebar-layout.tsx) —
			 *  without it, this row's own Close button ends up underneath them. */}
			<div
				className="flex min-w-0 shrink-0 items-center gap-2.5 overflow-hidden pr-[76px]"
				style={{
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* Worktree actions (Apply to local, Commit & push) */}
				{agent.worktreePath && <WorktreeActions agent={agent} />}

				{agent.worktreePath && <div className="hidden h-3 w-px shrink-0 bg-border/60 md:block" />}

				{/* File explorer toggle */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleFileExplorer}
								className={cn(
									"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
									fileExplorerOpen
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							/>
						}
					>
						<FolderTreeIcon className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent>
						{fileExplorerOpen ? "Hide files" : "Show files"} (Cmd+Shift+E)
					</TooltipContent>
				</Tooltip>

				{/* Review panel toggle with change stats badge */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleReviewPanel}
								className={cn(
									"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
									reviewPanelOpen
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							/>
						}
					>
						<FileDiffIcon className="size-3.5" />
						{diffStats.fileCount > 0 && (
							<span className="flex items-center gap-1 text-[11px]">
								<span className="text-green-500">+{diffStats.additions}</span>
								<span className="text-red-500">-{diffStats.deletions}</span>
							</span>
						)}
					</TooltipTrigger>
					<TooltipContent>
						{reviewPanelOpen ? "Hide changes panel" : "Show changes panel"} (Cmd+Shift+D)
					</TooltipContent>
				</Tooltip>

				{/* Browser panel toggle */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleBrowserPanel}
								className={cn(
									"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
									browserPanelOpen
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							/>
						}
					>
						<GlobeIcon className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent>
						{browserPanelOpen ? "Hide browser" : "Show browser"} (Cmd+Shift+B)
					</TooltipContent>
				</Tooltip>

				{/* More — Live Share + open elsewhere (browser/editor/terminal), one
				 *  overflow menu for the occasional-use actions, Claude-style. */}
				<SessionMoreMenu
					shareDirectory={agent.directory}
					openDirectory={agent.worktreePath ?? agent.directory}
					sessionId={agent.sessionId}
					agentName={agent.name}
					project={agent.project}
				/>

					{/* Close button */}
				<button
					type="button"
					onClick={() =>
						navigate({
							to: projectSlug ? "/project/$projectSlug" : "/",
							params: projectSlug ? { projectSlug } : undefined,
						})
					}
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>
		</div>
	)
}

// ============================================================
// Open in external editor/terminal
// ============================================================

// OpenInTarget type is provided by fetchOpenInTargets() via OpenInTargetsResult

/**
 * Renders a small app icon for a target. Uses runtime-resolved icon data URLs
 * from Electron's app.getFileIcon() API. Falls back to ExternalLinkIcon
 * if no icon data is available.
 */
function TargetIcon({ iconDataUrl, className }: { iconDataUrl?: string; className?: string }) {
	if (!iconDataUrl) return <ExternalLinkIcon className={className} />
	return (
		<img
			alt=""
			aria-hidden="true"
			src={iconDataUrl}
			className={cn("shrink-0 object-contain", className)}
		/>
	)
}

/** The browser pane's untouched default — nothing real is being previewed yet. */
const BROWSER_PANE_PLACEHOLDER = "https://www.google.com"

/** One row inside the "•••" panel — plain button, not DropdownMenuItem, so
 *  clicking it never force-closes the popover (needed for Live Share's
 *  "start then show the link" flow). */
function MoreMenuRow({
	icon,
	label,
	onClick,
	disabled,
	trailing,
}: {
	icon: React.ReactNode
	label: React.ReactNode
	onClick?: () => void
	disabled?: boolean
	trailing?: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
		>
			{icon}
			<span className="flex-1">{label}</span>
			{trailing}
		</button>
	)
}

/**
 * "More" overflow menu — Live Share plus everything from the old "Open in"
 * dropdown, merged into one panel for the session's less-frequent, occasional
 * actions (Claude-style "•••"), so the header only shows the toggles used
 * constantly (files/changes/browser) as direct icons.
 */
function SessionMoreMenu({
	shareDirectory,
	openDirectory,
	sessionId,
	agentName,
	project,
}: {
	shareDirectory: string
	openDirectory: string
	sessionId: string
	agentName: string
	project: string
}) {
	// --- Live Share ---
	const { shareUrl, isSharing, start, stop } = useSessionShare(shareDirectory, sessionId)
	const [shareCopied, setShareCopied] = useState(false)
	const [shareError, setShareError] = useState<string | null>(null)

	// --- Session Bridge ---
	const { bridgeUrl, isBridging, start: startBridge, stop: stopBridge } = useSessionBridge(
		shareDirectory, sessionId, agentName, project,
	)
	const [bridgeCopied, setBridgeCopied] = useState(false)
	const [bridgeError, setBridgeError] = useState<string | null>(null)

	const handleStartBridge = useCallback(() => {
		const result = startBridge()
		setBridgeError(result.ok ? null : result.error)
	}, [startBridge])

	const copyBridgeLink = useCallback(() => {
		if (!bridgeUrl) return
		navigator.clipboard.writeText(bridgeUrl)
		setBridgeCopied(true)
		setTimeout(() => setBridgeCopied(false), 1500)
	}, [bridgeUrl])

	const handleStartShare = useCallback(() => {
		const result = start()
		setShareError(result.ok ? null : result.error)
	}, [start])

	const copyShareLink = useCallback(() => {
		if (!shareUrl) return
		navigator.clipboard.writeText(shareUrl)
		setShareCopied(true)
		setTimeout(() => setShareCopied(false), 1500)
	}, [shareUrl])

	// --- Send to Session ---
	const allAgents = useAgents()
	const { sendPrompt } = useAgentActions()
	const otherSessions = allAgents.filter((a) => a.sessionId !== sessionId)
	const [targetSession, setTargetSession] = useState<(typeof allAgents)[0] | null>(null)
	const [crossMsg, setCrossMsg] = useState("")
	const [sending, setSending] = useState(false)

	const handleSendToSession = useCallback(async () => {
		if (!targetSession || !crossMsg.trim()) return
		setSending(true)
		try {
			await sendPrompt(targetSession.directory, targetSession.sessionId, crossMsg.trim())
			toast.success(`Message sent to "${targetSession.name}"`, {
				description: "Switch to that session to see the response.",
			})
			setCrossMsg("")
			setTargetSession(null)
		} catch {
			toast.error("Failed to send message")
		} finally {
			setSending(false)
		}
	}, [targetSession, crossMsg, sendPrompt])

	// --- Open elsewhere (browser / editor / terminal) ---
	const browserUrl = useAtomValue(browserUrlAtom)
	const { url: serverUrl } = useServerConnection()
	const [targets, setTargets] = useState<OpenInTarget[]>([])
	const [preferred, setPreferred] = useState<string | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [opening, setOpening] = useState<string | null>(null)
	const [chromeBusy, setChromeBusy] = useState(false)

	const loadTargets = useCallback(async () => {
		if (loaded) return
		try {
			const result = await fetchOpenInTargets()
			setTargets(result.targets.filter((t) => t.available))
			setPreferred(result.preferredTarget)
		} catch {
			// Silently fail — menu will show "No editors found"
		} finally {
			setLoaded(true)
		}
	}, [loaded])

	const handleOpenTarget = useCallback(
		async (targetId: string) => {
			setOpening(targetId)
			try {
				await openInTarget(openDirectory, targetId, true)
				setPreferred(targetId)
			} catch {
				// Silently fail
			} finally {
				setOpening(null)
			}
		},
		[openDirectory],
	)

	const handleOpenChrome = useCallback(async () => {
		// Already showing something real (whatever the agent previewed, or a page
		// the user navigated to) — just mirror it into the real browser.
		if (browserUrl !== BROWSER_PANE_PLACEHOLDER) {
			openExternal(browserUrl)
			return
		}
		// Nothing's being previewed — let the user pick a page and serve it over
		// localhost (not file://, which breaks relative paths/fetch/modules),
		// same server the agent's own preview tool uses.
		setChromeBusy(true)
		try {
			const filePath = await pickHtmlFile()
			if (!filePath) return
			const servedUrl = await servePreviewFile(filePath)
			if (servedUrl) openExternal(servedUrl)
		} finally {
			setChromeBusy(false)
		}
	}, [browserUrl])

	const handleCopyAttachCommand = useCallback(() => {
		const command = `opencode attach ${serverUrl ?? "http://127.0.0.1:4101"} --session ${sessionId} --dir ${openDirectory}`
		navigator.clipboard.writeText(command)
		toast.success("Attach command copied", {
			description: "Paste in your terminal to attach — both views stay in sync.",
		})
	}, [serverUrl, sessionId, openDirectory])

	return (
		<Popover onOpenChange={(open) => open && void loadTargets()}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<button
									type="button"
									className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								/>
							}
						/>
					}
				>
					<MoreHorizontalIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>More</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-72 gap-0 p-0">
				{/* Live Share */}
				<div className="p-3">
					<p className="font-medium text-sm">Live Share</p>
					{isSharing ? (
						<div className="mt-2 flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<Input
									readOnly
									value={shareUrl ?? ""}
									className="text-xs"
									onFocus={(e) => e.target.select()}
								/>
								<Button size="sm" variant="outline" onClick={copyShareLink}>
									{shareCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
								</Button>
							</div>
							<Button size="sm" variant="ghost" onClick={stop} className="self-start text-muted-foreground">
								Stop sharing
							</Button>
						</div>
					) : (
						<div className="mt-2 flex flex-col gap-2">
							<p className="text-muted-foreground text-xs">
								Anyone with the link can watch this session live and send messages into it — no
								account needed.
							</p>
							{shareError && <p className="text-red-500 text-xs">{shareError}</p>}
							<Button size="sm" variant="outline" onClick={handleStartShare} className="w-fit gap-1.5">
								<RadioTowerIcon className="size-3.5" />
								Start Live Share
							</Button>
						</div>
					)}
				</div>

				<div className="h-px bg-border" />

				{/* Session Bridge */}
				<div className="p-3">
					<p className="font-medium text-sm">Session Bridge</p>
					{isBridging ? (
						<div className="mt-2 flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<Input readOnly value={bridgeUrl ?? ""} className="text-xs" onFocus={(e) => e.target.select()} />
								<Button size="sm" variant="outline" onClick={copyBridgeLink}>
									{bridgeCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
								</Button>
							</div>
							<Button size="sm" variant="ghost" onClick={stopBridge} className="self-start text-muted-foreground">
								Stop bridge
							</Button>
						</div>
					) : (
						<div className="mt-2 flex flex-col gap-2">
							<p className="text-muted-foreground text-xs">
								Generate a link so another Hramble instance can join and continue this session.
							</p>
							{bridgeError && <p className="text-red-500 text-xs">{bridgeError}</p>}
							<Button size="sm" variant="outline" onClick={handleStartBridge} className="w-fit gap-1.5">
								<LinkIcon className="size-3.5" />
								Create Bridge Link
							</Button>
						</div>
					)}
				</div>

				<div className="h-px bg-border" />

				{/* Send to Session */}
				<div className="p-3">
					<p className="font-medium text-sm">Send to Session</p>
					{otherSessions.length === 0 ? (
						<p className="mt-1 text-muted-foreground text-xs">No other sessions open</p>
					) : targetSession ? (
						<div className="mt-2 flex flex-col gap-2">
							<button
								type="button"
								onClick={() => setTargetSession(null)}
								className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
							>
								<ChevronLeftIcon className="size-3" />
								<span className="truncate max-w-[180px] font-medium text-foreground">{targetSession.name}</span>
							</button>
							<Input
								autoFocus
								value={crossMsg}
								onChange={(e) => setCrossMsg(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSendToSession() }
								}}
								placeholder="Message for that session…"
								className="text-xs"
								disabled={sending}
							/>
							<Button
								size="sm"
								variant="outline"
								className="w-fit gap-1.5"
								onClick={() => void handleSendToSession()}
								disabled={!crossMsg.trim() || sending}
							>
								<SendIcon className="size-3.5" />
								{sending ? "Sending…" : "Send"}
							</Button>
						</div>
					) : (
						<div className="mt-2 flex flex-col gap-0.5">
							{otherSessions.map((s) => (
								<button
									key={s.sessionId}
									type="button"
									onClick={() => setTargetSession(s)}
									className="flex flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
								>
									<span className="text-xs font-medium leading-tight truncate max-w-full">{s.name}</span>
									<span className="text-[10px] text-muted-foreground truncate max-w-full">{s.project}</span>
								</button>
							))}
						</div>
					)}
				</div>

				<div className="h-px bg-border" />

				{/* Open elsewhere */}
				<div className="p-1">
					<MoreMenuRow
						icon={<ArrowUpRightIcon className="size-4" />}
						label={browserUrl !== BROWSER_PANE_PLACEHOLDER ? "Open in your browser" : "Preview a page in browser…"}
						onClick={handleOpenChrome}
						disabled={chromeBusy}
					/>

					{isElectron &&
						(!loaded ? (
							<p className="px-2 py-1.5 text-muted-foreground text-xs">Loading editors...</p>
						) : targets.length === 0 ? (
							<p className="px-2 py-1.5 text-muted-foreground text-xs">No editors found</p>
						) : (
							targets.map((target) => (
								<MoreMenuRow
									key={target.id}
									icon={<TargetIcon iconDataUrl={target.iconDataUrl} className="size-4" />}
									label={target.label}
									onClick={() => handleOpenTarget(target.id)}
									disabled={opening === target.id}
									trailing={
										preferred === target.id ? (
											<CheckIcon className="size-3 shrink-0 text-muted-foreground/60" />
										) : undefined
									}
								/>
							))
						))}

					<MoreMenuRow
						icon={<TerminalIcon className="size-4" />}
						label="Attach in terminal"
						onClick={handleCopyAttachCommand}
					/>
				</div>

				<div className="h-px bg-border" />
				<p className="truncate px-3 py-2 text-[11px] text-muted-foreground/50">{openDirectory}</p>
			</PopoverContent>
		</Popover>
	)
}

/**
 * Compact badge showing the worktree branch name with a copy action.
 */
function WorktreeBranchBadge({ branch }: { branch: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(branch)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [branch])

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={handleCopy}
						className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					/>
				}
			>
				<GitForkIcon className="size-2.5" aria-hidden="true" />
				<span className="max-w-[120px] truncate">{branch}</span>
				{copied && <CheckIcon className="size-2.5 text-green-500" />}
			</TooltipTrigger>
			<TooltipContent>Click to copy branch name</TooltipContent>
		</Tooltip>
	)
}

