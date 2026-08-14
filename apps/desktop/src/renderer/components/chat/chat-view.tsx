import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	useStickToBottomContext,
} from "@hramble/ui/components/ai-elements/conversation"
import {
	PromptInput,
	PromptInputButton,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@hramble/ui/components/ai-elements/prompt-input"
import { cn } from "@hramble/ui/lib/utils"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { type HyperStep, hyperloopRunAtom, markHyperloopSession, workspaceModeAtom } from "../../atoms/workspace"
import {
	ArrowUpToLineIcon,
	CheckIcon,
	ChevronUpIcon,
	GitForkIcon,
	InfinityIcon,
	ListOrderedIcon,
	Loader2Icon,
	MonitorIcon,
	MoonIcon,
	PlayIcon,
	PlusIcon,
	Redo2Icon,
	SendHorizontalIcon,
	SparklesIcon,
	SquareIcon,
	Undo2Icon,
	XIcon,
} from "lucide-react"
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { messagesFamily, removeMessageAtom } from "../../atoms/messages"
import { projectModelsAtom, setProjectModelAtom } from "../../atoms/preferences"
import { interruptedWorkAtom, resolveInterruptedItemAtom } from "../../atoms/sleep-recovery"
import type { SessionSetupPhase } from "../../atoms/sessions"
import { sessionFamily } from "../../atoms/sessions"
import {
	effectivePermissionFamily,
	effectiveQuestionFamily,
} from "../../atoms/derived/session-requests"
import { appStore } from "../../atoms/store"
import {
	newRuleId,
	permissionRulesAtom,
	type UserPermissionRule,
} from "../../atoms/permission-rules"
import { promptHistoryAtom, pushPromptHistory } from "../../atoms/prompt-history"
import { pendingSessionStepsAtom } from "../../atoms/chat"
import { fallbackModelAtom } from "../../atoms/fallback-model"
import { useDraftActions, useDraftSnapshot } from "../../hooks/use-draft"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	getModelVariants,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-opencode-data"
import type { ChatTurn } from "../../hooks/use-session-chat"
import { createLogger } from "../../lib/logger"
import { computeTurnWorkTimeSplit, formatWorkDuration } from "../../lib/session-metrics"
import type { Agent, FileAttachment, FilePart, QuestionAnswer, TextPart } from "../../lib/types"
import { getProjectClient } from "../../services/connection-manager"

const log = createLogger("chat-view")

import {
	type DiffComment,
	diffCommentsFamily,
	serializeCommentsForChat,
} from "../review/review-comments"
import { PermissionItem } from "./chat-permission"
import { ChatQuestionFlow } from "./chat-question"
import { ChatTurnComponent } from "./chat-turn"
import { ContextItems } from "./context-items"
import type { MentionOption } from "./mention-popover"
import { MentionPopover, type MentionPopoverHandle } from "./mention-popover"
import { PromptAttachmentPreview } from "./prompt-attachments"
import {
	createAgentMention,
	createFileMention,
	getMentionMarker,
	insertMentionIntoText,
	type PromptMention,
	reconcileMentions,
} from "./prompt-mentions"
import { PromptToolbar, StatusBar } from "./prompt-toolbar"
import { SessionTaskList } from "./session-task-list"
import { SkillPickerDialog } from "./skill-picker-dialog"
import { SlashCommandPopover, type SlashCommandPopoverHandle } from "./slash-command-popover"

/**
 * Small "+" button that opens the file picker for attachments.
 * Must be rendered inside a <PromptInput> so the attachments context is available.
 */
function AttachButton({ disabled }: { disabled?: boolean }) {
	const attachments = usePromptInputAttachments()
	return (
		<PromptInputButton
			tooltip="Attach files"
			onClick={() => attachments.openFileDialog()}
			disabled={disabled}
		>
			<PlusIcon className="size-3.5" />
		</PromptInputButton>
	)
}

/**
 * Convert a renderer-scoped blob: URL to a self-contained data: URL so an
 * attachment can be handed to a *different* session (the background job) that
 * can't resolve this window's blob URLs. Mirrors the conversion PromptInput's
 * own submit path does.
 */
async function blobUrlToDataUrl(url: string): Promise<string | null> {
	try {
		const response = await fetch(url)
		const blob = await response.blob()
		return await new Promise<string | null>((resolve) => {
			const reader = new FileReader()
			reader.onloadend = () => resolve(reader.result as string)
			reader.onerror = () => resolve(null)
			reader.readAsDataURL(blob)
		})
	} catch {
		return null
	}
}

/**
 * "Run in background" button. Must be rendered inside a <PromptInput> so it can
 * read the live composer text + attachments via the prompt-input context. On
 * click it hands the current prompt to `onSend` (which spins up a NEW parallel
 * session) and then clears the composer immediately so the input is free again.
 */
function SendInBackgroundButton({
	onSend,
	disabled,
}: {
	onSend: (text: string, files?: FileAttachment[]) => Promise<void> | void
	disabled?: boolean
}) {
	const controller = usePromptInputController()
	const attachments = usePromptInputAttachments()

	const handleClick = useCallback(async () => {
		const text = controller.textInput.value
		if (!text.trim()) return
		// Resolve blob: URLs to data: URLs so the background session gets usable files.
		const files: FileAttachment[] = await Promise.all(
			attachments.files.map(async ({ id: _id, ...item }) => {
				let url = item.url ?? ""
				if (url.startsWith("blob:")) {
					url = (await blobUrlToDataUrl(url)) ?? url
				}
				return {
					type: "file" as const,
					url,
					mediaType: item.mediaType,
					filename: item.filename,
				}
			}),
		)
		await onSend(text, files.length > 0 ? files : undefined)
		// Free the composer instantly — the local input value and attachments.
		controller.textInput.clear()
		attachments.clear()
	}, [controller, attachments, onSend])

	return (
		<PromptInputButton
			tooltip="Run in background — sends this as a separate task so you can keep typing."
			onClick={handleClick}
			disabled={disabled}
		>
			<SendHorizontalIcon className="size-3.5" />
		</PromptInputButton>
	)
}

/**
 * Instant-scroll when session content finishes loading.
 *
 * The `<Conversation>` (StickToBottom) uses `initial="instant"` for the first
 * paint, but messages are fetched async — by the time they arrive and render,
 * the library treats the content growth as a *resize* and applies
 * `resize="smooth"`, causing a visible scroll animation from top → bottom.
 *
 * This component sits inside `<Conversation>` so it can access the
 * StickToBottom context. It watches for the loading→loaded transition
 * and forces an instant scroll-to-bottom.
 */
function ScrollOnLoad({ loading, sessionId }: { loading: boolean; sessionId: string }) {
	const { scrollToBottom } = useStickToBottomContext()
	const prevLoadingRef = useRef(loading)
	const prevSessionRef = useRef(sessionId)

	useLayoutEffect(() => {
		const wasLoading = prevLoadingRef.current
		const sessionChanged = prevSessionRef.current !== sessionId
		prevLoadingRef.current = loading
		prevSessionRef.current = sessionId

		// Instant scroll when: loading just finished, or session changed while not loading
		// (e.g. messages were already cached in the Jotai store)
		if ((wasLoading && !loading) || (sessionChanged && !loading)) {
			scrollToBottom("instant")
		}
	}, [loading, sessionId, scrollToBottom])

	return null
}

interface ScrollHandle {
	scrollToBottom: (behavior?: "instant" | "smooth") => void
	/** Returns the current scrollHeight of the scroll container */
	getScrollHeight: () => number
	/** Smoothly scrolls the container to a specific scrollTop value */
	scrollToPosition: (top: number) => void
}

/**
 * Bridge that exposes the StickToBottom `scrollToBottom` to the parent
 * via a ref so imperative callers (handleSend, question reply, etc.)
 * can force a scroll-to-bottom even when the user has scrolled away.
 * Also exposes scroll position helpers for the "jump to start" feature.
 */
function ScrollBridge({ scrollRef }: { scrollRef: React.RefObject<ScrollHandle | null> }) {
	const ctx = useStickToBottomContext()
	useImperativeHandle(
		scrollRef,
		() => ({
			scrollToBottom: (behavior?: "instant" | "smooth") => {
				ctx.scrollToBottom(behavior ?? "smooth")
			},
			getScrollHeight: () => {
				return ctx.scrollRef.current?.scrollHeight ?? 0
			},
			scrollToPosition: (top: number) => {
				ctx.scrollRef.current?.scrollTo({ top, behavior: "smooth" })
			},
		}),
		[ctx],
	)
	return null
}

/**
 * Floating pill button that appears when the agent finishes working.
 * Scrolls to the beginning of the last assistant response so the user
 * can read it from the top. Dismisses on click or after 8 seconds.
 *
 * Captures the scroll container's scrollHeight when the agent starts
 * working (idle-to-working transition). This position corresponds to
 * "where the new response began" regardless of whether the agent
 * started from a fresh message, a question answer, or a permission grant.
 *
 * Must be rendered inside `<Conversation>` to position correctly.
 */
function ScrollToResponseStart({
	isWorking,
	scrollRef,
}: {
	isWorking: boolean
	scrollRef: React.RefObject<ScrollHandle | null>
}) {
	const [visible, setVisible] = useState(false)
	const prevWorkingRef = useRef(isWorking)
	// Saved scrollHeight at the moment the agent started working.
	// This is the Y position where the new response content begins.
	const savedScrollTopRef = useRef(0)

	useEffect(() => {
		const wasWorking = prevWorkingRef.current
		prevWorkingRef.current = isWorking

		if (!wasWorking && isWorking) {
			// Agent just started working -- snapshot where the response will begin.
			// scrollHeight is the total content height; subtracting a small offset
			// so the scroll lands slightly above the first new content.
			const handle = scrollRef.current
			if (handle) {
				savedScrollTopRef.current = Math.max(0, handle.getScrollHeight() - 80)
			}
		}

		if (wasWorking && !isWorking) {
			// Agent finished -- show the pill
			setVisible(true)
		}

		if (isWorking) {
			setVisible(false)
		}
	}, [isWorking, scrollRef])

	// Auto-dismiss after 8 seconds
	useEffect(() => {
		if (!visible) return
		const timer = setTimeout(() => setVisible(false), 8000)
		return () => clearTimeout(timer)
	}, [visible])

	const handleClick = useCallback(() => {
		scrollRef.current?.scrollToPosition(savedScrollTopRef.current)
		setVisible(false)
	}, [scrollRef])

	if (!visible) return null

	return (
		<button
			type="button"
			onClick={handleClick}
			className="absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
		>
			<ArrowUpToLineIcon className="size-3" />
			<span>Jump to start of response</span>
		</button>
	)
}

/**
 * Bridge component that syncs the PromptInputProvider's text state
 * to the persisted draft store (debounced). Must be rendered inside
 * both a <PromptInputProvider> and receive draft actions for the session.
 */
function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		// Skip the initial render — the provider was just hydrated from the draft
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

/**
 * Bridge that exposes the PromptInputProvider's text controller to the parent
 * via a ref, so handleSlashCommand can read/write the input text.
 */
function SlashCommandBridge({
	controllerRef,
}: {
	controllerRef: React.RefObject<{ setText: (text: string) => void; getText: () => string } | null>
}) {
	const controller = usePromptInputController()

	useEffect(() => {
		if (controllerRef && "current" in controllerRef) {
			;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = {
				setText: (text: string) => controller.textInput.setInput(text),
				getText: () => controller.textInput.value,
			}
		}
		return () => {
			if (controllerRef && "current" in controllerRef) {
				;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = null
			}
		}
	}, [controller, controllerRef])

	return null
}

/**
 * Bridge that detects `/` and `@` triggers from the text input
 * and syncs popover state. Must be rendered inside PromptInputProvider.
 *
 * Uses DOM queries to find the textarea for cursor position (since
 * PromptInputTextarea doesn't support ref forwarding).
 */
function TriggerDetector({
	onSlashChange,
	onMentionChange,
}: {
	onSlashChange: (open: boolean, query: string) => void
	onMentionChange: (open: boolean, query: string) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		// Find textarea via DOM query (PromptInputTextarea doesn't forward refs)
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? inputText.length
		const textBeforeCursor = inputText.slice(0, cursorPos)

		// Slash command: entire input starts with / and no space yet
		const slashMatch = inputText.match(/^\/(\S*)$/)
		if (slashMatch) {
			onSlashChange(true, slashMatch[1])
			onMentionChange(false, "")
			return
		}

		// @mention: @ followed by non-whitespace before cursor
		const atMatch = textBeforeCursor.match(/@(\S*)$/)
		if (atMatch) {
			onMentionChange(true, atMatch[1])
			onSlashChange(false, "")
			return
		}

		// No trigger
		onSlashChange(false, "")
		onMentionChange(false, "")
	}, [inputText, onSlashChange, onMentionChange])

	return null
}

/**
 * Bridge that reconciles mentions with the current text.
 * When the user manually deletes an `@mention` marker from the text,
 * this removes the corresponding entry from the mentions list.
 * Must be rendered inside PromptInputProvider.
 */
function MentionReconciler({
	mentions,
	onReconcile,
}: {
	mentions: PromptMention[]
	onReconcile: (updated: PromptMention[]) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		if (mentions.length === 0) return
		const reconciled = reconcileMentions(mentions, inputText)
		if (reconciled.length !== mentions.length) {
			onReconcile(reconciled)
		}
	}, [inputText, mentions, onReconcile])

	return null
}

interface ChatViewProps {
	turns: ChatTurn[]
	loading: boolean
	/** Whether earlier messages are currently being loaded */
	loadingEarlier: boolean
	/** Whether there are earlier messages that can be loaded */
	hasEarlierMessages: boolean
	/** Callback to load earlier messages */
	onLoadEarlier?: () => void
	agent: Agent
	isConnected: boolean
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
	/** Fire a prompt into a NEW parallel background session (keeps the current composer free). */
	onSendBackground?: (
		text: string,
		options?: {
			model?: ModelRef
			agentName?: string
			variant?: string
			files?: FileAttachment[]
			hyperloop?: boolean
		},
	) => Promise<void>
	/** Callback to stop/abort the running session */
	onStop?: (agent: Agent) => Promise<void>
	/** Provider data for model selector */
	providers?: ProvidersData | null
	/** Config data (default model, default agent) */
	config?: ConfigData | null
	/** VCS data for status bar */
	vcs?: VcsData | null
	/** Available OpenCode agents */
	openCodeAgents?: SdkAgent[]
	/** Permission handlers */
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
	/** Question handlers */
	onReplyQuestion?: (agent: Agent, requestId: string, answers: QuestionAnswer[]) => Promise<void>
	onRejectQuestion?: (agent: Agent, requestId: string) => Promise<void>
	/** Undo/redo */
	canUndo?: boolean
	canRedo?: boolean
	onUndo?: () => Promise<string | undefined>
	onRedo?: () => Promise<void>
	isReverted?: boolean
	/** Revert to a specific message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>
	/** Fork from a turn boundary (messageId of the next turn's user message, or undefined for full fork) */
	onForkFromTurn?: (messageId?: string) => Promise<void>
	/** Delete a specific part from a message (for error recovery) */
	onDeletePart?: (sessionId: string, messageId: string, partId: string) => Promise<void>
	/** Whether the review panel is open (removes max-w constraint) */
	reviewPanelOpen?: boolean
}

/**
 * Main chat view component.
 * Renders the full conversation as turns with auto-scroll,
 * plus a card-style input with agent/model/variant toolbar and status bar.
 *
 * The input section (toolbar, popovers, mentions, model/agent/variant state)
 * is extracted into `ChatInputSection` so that state changes in the input area
 * don't cause re-renders of the conversation turn list.
 */
export function ChatView({
	turns,
	loading,
	loadingEarlier,
	hasEarlierMessages,
	onLoadEarlier,
	agent,
	isConnected,
	onSendMessage,
	onSendBackground,
	onStop,
	providers,
	config,
	vcs,
	openCodeAgents,
	onApprove,
	onDeny,
	onReplyQuestion,
	onRejectQuestion,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	onRevertToMessage,
	onForkFromTurn,
	onDeletePart,
	reviewPanelOpen,
}: ChatViewProps) {
	const isWorking = agent.status === "running"

	// Ref to imperatively scroll the conversation to bottom from outside the
	// <Conversation> tree (e.g. after sending a message or answering a question).
	const scrollRef = useRef<ScrollHandle | null>(null)

	// Session-level error and setup phase from the session atom
	const sessionEntry = useAtomValue(sessionFamily(agent.sessionId))
	const sessionError = sessionEntry?.error
	const setupPhase = sessionEntry?.setupPhase
	// Format the session-level error for display. Only shown when the last
	// turn doesn't already carry an assistant-level error (the server emits
	// both session.error and message.updated for the same failure, so showing
	// both would duplicate the message).
	const sessionErrorText = useMemo(() => {
		if (!sessionError) return undefined
		if ("message" in sessionError.data && sessionError.data.message) {
			return String(sessionError.data.message)
		}
		return `${sessionError.name}: ${JSON.stringify(sessionError.data)}`
	}, [sessionError])

	const lastTurnHasError = useMemo(() => {
		const lastTurn = turns.at(-1)
		if (!lastTurn) return false
		return lastTurn.assistantMessages.some(
			(m) => m.info.role === "assistant" && m.info.error != null,
		)
	}, [turns])

	const showSessionError = !!sessionErrorText && !lastTurnHasError

	// Fallback-model retry: when a turn errors, offer to re-run the last prompt —
	// optionally with a different model (provider overload / model unavailable).
	const lastUserText = useMemo(() => {
		const lt = turns.at(-1)
		if (!lt) return ""
		return lt.userMessage.parts
			.map((p) => (p.type === "text" ? p.text : ""))
			.join("")
			.trim()
	}, [turns])

	const retryModelOptions = useMemo(() => {
		const provs = providers?.providers ?? []
		return provs.flatMap((p) =>
			Object.entries(p.models ?? {}).map(([modelID, m]) => ({
				key: `${p.id}/${modelID}`,
				providerID: p.id,
				modelID,
				label: (m as { name?: string })?.name ?? modelID,
			})),
		)
	}, [providers])

	const handleRetryError = useCallback(
		(model?: ModelRef) => {
			if (!onSendMessage || !lastUserText) return
			if (model) appStore.set(fallbackModelAtom, model)
			void onSendMessage(agent, lastUserText, model ? { model } : undefined)
		},
		[onSendMessage, lastUserText, agent],
	)

	// A previously-chosen fallback model, surfaced as a one-click retry.
	const storedFallback = useAtomValue(fallbackModelAtom)
	const storedFallbackLabel = useMemo(() => {
		if (!storedFallback) return null
		const opt = retryModelOptions.find(
			(o) => o.providerID === storedFallback.providerID && o.modelID === storedFallback.modelID,
		)
		return opt?.label ?? storedFallback.modelID
	}, [storedFallback, retryModelOptions])

	// Stable callbacks for question/permission handlers — agent is stable
	// per render, but wrapping in useCallback avoids creating new inline
	// closures inside the JSX .map() that would defeat memo() on children.
	const handleApprovePermission = useCallback(
		async (
			a: Agent,
			permissionSessionId: string,
			permissionId: string,
			response?: "once" | "always",
		) => {
			await onApprove?.(a, permissionSessionId, permissionId, response)

			// "Always" must survive restarts. The engine handles the *current*
			// session; we persist a durable project-scoped allow rule so every
			// future session honours it too (cross-session memory). Scoped to the
			// project — not global — so one click never silently allows everywhere;
			// the user can broaden or remove it in Settings → Permissions.
			if (response === "always") {
				const perm = a.permissions.find((p) => p.id === permissionId)
				if (perm) {
					const pattern = perm.patterns?.[0] ?? "*"
					const directory = a.projectDirectory
					const existing = appStore.get(permissionRulesAtom)
					const already = existing.some(
						(r) =>
							r.scope === "project" &&
							r.directory === directory &&
							r.permission === perm.permission &&
							r.pattern === pattern &&
							r.action === "allow",
					)
					if (!already) {
						const rule: UserPermissionRule = {
							id: newRuleId(perm.permission),
							permission: perm.permission,
							pattern,
							action: "allow",
							scope: "project",
							directory,
							note: `Always allow ${perm.permission}`,
							createdAt: Date.now(),
						}
						appStore.set(permissionRulesAtom, [...existing, rule])
					}
				}
			}
			// Permission card disappears after approval — scroll to keep content visible.
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onApprove],
	)

	const handleDenyPermission = useCallback(
		async (a: Agent, permissionSessionId: string, permissionId: string) => {
			await onDeny?.(a, permissionSessionId, permissionId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onDeny],
	)

	const handleSendNow = useCallback(
		async (turn: ChatTurn) => {
			if (!isWorking) return

			// Extract text and files from the queued turn BEFORE aborting, because
			// the abort may clean up state that we need.
			const text = turn.userMessage.parts
				.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
				.map((p) => p.text)
				.join("\n")
			const files: FileAttachment[] = turn.userMessage.parts
				.filter((p): p is FilePart => p.type === "file")
				.map((p) => ({
					type: "file" as const,
					url: p.url,
					mediaType: p.mime,
					filename: p.filename,
				}))

			if (!text.trim()) return

			// 1. Abort the currently running turn
			if (onStop) {
				await onStop(agent)
			}

			// 2. Remove the orphaned message from the local store to prevent
			// duplicates. After an abort the server discards queued prompt
			// callbacks, so the user message is persisted on the server but no
			// response will be generated. When we re-send below, a new user
			// message + optimistic entry will be created. The server's loop
			// reads full history and will respond to the newest user message,
			// effectively ignoring the orphaned one in the context.
			appStore.set(removeMessageAtom, {
				sessionId: agent.sessionId,
				messageId: turn.userMessage.info.id,
			})

			// 3. Re-send the queued message so the server actually processes it.
			if (onSendMessage) {
				await onSendMessage(agent, text, { files: files.length > 0 ? files : undefined })
			}
		},
		[onStop, onSendMessage, isWorking, agent],
	)

	// Keyboard shortcuts for undo/redo
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't intercept Cmd/Ctrl+Z in any text input — let the browser
			// handle native undo/redo. Session undo/redo is still available via
			// /undo, /redo slash commands and the command palette.
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

			// Cmd+Z / Ctrl+Z — Undo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (canUndo && onUndo) {
					e.preventDefault()
					onUndo()
				}
				return
			}

			// Cmd+Shift+Z / Ctrl+Shift+Z — Redo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
				if (canRedo && onRedo) {
					e.preventDefault()
					onRedo()
				}
				return
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [canUndo, canRedo, onUndo, onRedo])

	// Width constraint class: remove max-w when review panel is open
	const contentWidthClass = reviewPanelOpen
		? "mx-auto w-full min-w-0"
		: "mx-auto w-full min-w-0 max-w-4xl"

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			{/* Chat messages -- constrained width for readability */}
			<div className="relative min-h-0 min-w-0 flex-1">
				<Conversation key={agent.sessionId} className="h-full">
					<ScrollOnLoad loading={loading} sessionId={agent.sessionId} />
					<ScrollBridge scrollRef={scrollRef} />
					<ConversationContent className="gap-6 px-0 py-2 sm:px-4 sm:py-6">
						<div className={cn(contentWidthClass, "space-y-6")}>
							{/* Load earlier messages button */}
							{hasEarlierMessages && (
								<div className="flex justify-center pb-4">
									<button
										type="button"
										onClick={onLoadEarlier}
										disabled={loadingEarlier}
										className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
									>
										{loadingEarlier ? (
											<Loader2Icon className="size-3 animate-spin" />
										) : (
											<ChevronUpIcon className="size-3" />
										)}
										{loadingEarlier ? "Loading..." : "Load earlier messages"}
									</button>
								</div>
							)}

							{loading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
									<span className="ml-2 text-sm text-muted-foreground">Loading chat...</span>
								</div>
							) : turns.length > 0 ? (
							turns.map((turn, index) => (
								<ChatTurnComponent
									key={turn.id}
									turn={turn}
									isLast={index === turns.length - 1}
									isWorking={isWorking}
									onRevertToMessage={onRevertToMessage}
									onSendNow={isWorking ? handleSendNow : undefined}
									onForkFromTurn={
										onForkFromTurn
											? () => {
													const nextTurn = turns[index + 1]
													return onForkFromTurn(nextTurn?.userMessage.info.id)
												}
											: undefined
									}
									onDeletePart={onDeletePart}
								/>
							))
							) : setupPhase ? (
								<WorktreeSetupProgress phase={setupPhase} />
							) : (
								<div className="flex items-center justify-center py-8">
									<p className="text-sm text-muted-foreground">No messages yet</p>
								</div>
							)}

							{/* Session-level error from session.error events */}
							{showSessionError && sessionErrorText && (
								<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
									<div>{sessionErrorText}</div>
									{onSendMessage && lastUserText && (
										<div className="mt-2 flex items-center gap-2">
											<button
												type="button"
												onClick={() => handleRetryError()}
												className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
											>
												Retry
											</button>
											{storedFallback && storedFallbackLabel && (
												<button
													type="button"
													onClick={() => handleRetryError(storedFallback)}
													className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
												>
													Retry with {storedFallbackLabel}
												</button>
											)}
											{retryModelOptions.length > 1 && (
												<select
													className="h-6 rounded-md border border-red-500/30 bg-transparent px-1.5 text-[11px] text-red-300 outline-none"
													value=""
													onChange={(e) => {
														const opt = retryModelOptions.find((o) => o.key === e.target.value)
														if (opt) handleRetryError({ providerID: opt.providerID, modelID: opt.modelID })
													}}
													aria-label="Retry with another model"
												>
													<option value="">Retry with another model…</option>
													{retryModelOptions.map((o) => (
														<option key={o.key} value={o.key}>
															{o.label}
														</option>
													))}
												</select>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					</ConversationContent>
					<ScrollToResponseStart isWorking={isWorking} scrollRef={scrollRef} />
					<ConversationScrollButton />
				</Conversation>

				{/* Top fade */}
				<div
					data-slot="scroll-fade"
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background/30 to-transparent"
				/>
				{/* Bottom fade */}
				<div
					data-slot="scroll-fade"
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background/30 to-transparent"
				/>
			</div>

			{/* Bottom input section — hidden during worktree setup since the stub session
			   cannot accept prompts yet. Extracted into its own component so toolbar,
			   popover, mention, and model-selection state changes don't re-render the
			   conversation turn list above. */}
			{!setupPhase && (
				<ChatInputSection
					agent={agent}
					turns={turns}
					isConnected={isConnected}
					isWorking={isWorking}
					onSendMessage={onSendMessage}
					onSendBackground={onSendBackground}
					onStop={onStop}
					providers={providers}
					config={config}
					vcs={vcs}
					openCodeAgents={openCodeAgents}
					onApprove={handleApprovePermission}
					onDeny={handleDenyPermission}
					onReplyQuestion={onReplyQuestion}
					onRejectQuestion={onRejectQuestion}
					canRedo={canRedo}
					onUndo={onUndo}
					onRedo={onRedo}
					isReverted={isReverted}
					scrollRef={scrollRef}
					reviewPanelOpen={reviewPanelOpen}
					onForkFromTurn={onForkFromTurn}
				/>
			)}
		</div>
	)
}

// ============================================================
// Auto-growing textarea for a single step. Grows with the text up to a max
// height, then scrolls — so long steps aren't clipped to a single line.
function StepTextarea({
	value,
	onChange,
	placeholder,
	disabled,
	className,
}: {
	value: string
	onChange: (v: string) => void
	placeholder?: string
	disabled?: boolean
	className?: string
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		el.style.height = "auto"
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}, [value])
	return (
		<textarea
			ref={ref}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			disabled={disabled}
			rows={1}
			className={className}
		/>
	)
}

// ChatInputSection — owns all input/toolbar/popover/mention state
// ============================================================

interface ChatInputSectionProps {
	agent: Agent
	turns: ChatTurn[]
	isConnected: boolean
	isWorking: boolean
	onSendMessage?: ChatViewProps["onSendMessage"]
	onSendBackground?: ChatViewProps["onSendBackground"]
	onStop?: ChatViewProps["onStop"]
	providers?: ProvidersData | null
	config?: ConfigData | null
	vcs?: VcsData | null
	openCodeAgents?: SdkAgent[]
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
	onReplyQuestion?: ChatViewProps["onReplyQuestion"]
	onRejectQuestion?: ChatViewProps["onRejectQuestion"]
	canRedo?: boolean
	onUndo?: () => Promise<string | undefined>
	onRedo?: () => Promise<void>
	isReverted?: boolean
	scrollRef: React.RefObject<ScrollHandle | null>
	reviewPanelOpen?: boolean
	/** Fork the current session (full fork, no cutoff) */
	onForkFromTurn?: (messageId?: string) => Promise<void>
}

function ChatInputSection({
	agent,
	turns,
	isConnected,
	isWorking,
	onSendMessage,
	onSendBackground,
	onStop,
	providers,
	config,
	vcs,
	openCodeAgents,
	onApprove,
	onDeny,
	onReplyQuestion,
	onRejectQuestion,
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	scrollRef,
	reviewPanelOpen,
	onForkFromTurn,
}: ChatInputSectionProps) {
	const [sending, setSending] = useState(false)

	// Tree-scoped interactive requests — bubbles up from sub-agent sessions.
	// These replace the direct `agent.permissions` / `agent.questions` arrays
	// so the parent session's UI can respond on behalf of any descendant.
	const effectivePermission = useAtomValue(effectivePermissionFamily(agent.sessionId))
	const effectiveQuestion = useAtomValue(effectiveQuestionFamily(agent.sessionId))

	// Sleep/wake recovery — surfaced only on the specific session that got interrupted.
	const interruptedWork = useAtomValue(interruptedWorkAtom)
	const resolveInterruptedItem = useSetAtom(resolveInterruptedItemAtom)
	const interruptedItem = interruptedWork.find(
		(item) => item.kind === "session" && item.sessionId === agent.sessionId,
	)

	// Diff comments integration
	const diffComments = useAtomValue(diffCommentsFamily(agent.sessionId))
	const setDiffComments = useSetAtom(diffCommentsFamily(agent.sessionId))

	// Work time split for the current (last) turn — used for the live timer on the submit button.
	const currentTurnWorkSplit = useMemo(() => {
		if (!isWorking || turns.length === 0) return null
		const lastTurn = turns[turns.length - 1]
		if (lastTurn.assistantMessages.length === 0) return null
		return computeTurnWorkTimeSplit(lastTurn)
	}, [isWorking, turns])

	// Mention tracking — files and agents referenced via @
	const [mentions, setMentions] = useState<PromptMention[]>([])

	// Reset mentions when session changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear on session switch
	useEffect(() => {
		setMentions([])
	}, [agent.sessionId])

	// Stable callbacks for question/permission handlers
	const handleReplyQuestion = useCallback(
		async (requestId: string, answers: QuestionAnswer[]) => {
			await onReplyQuestion?.(agent, requestId, answers)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onReplyQuestion, agent, scrollRef],
	)

	const handleRejectQuestion = useCallback(
		async (requestId: string) => {
			await onRejectQuestion?.(agent, requestId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onRejectQuestion, agent, scrollRef],
	)

	// Draft persistence
	const draft = useDraftSnapshot(agent.sessionId)
	const { setDraft, clearDraft } = useDraftActions(agent.sessionId)

	// Escape-to-abort: double-press within 3s
	const [interruptCount, setInterruptCount] = useState(0)
	const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	// Step list: queue several steps and run them one after another, each waiting
	// for the previous to finish. Works in both Code (one turn/step) and Hyperloop
	// (full autonomous run/step) workspaces.
	const STEP_COUNT = 7
	const workspaceMode = useAtomValue(workspaceModeAtom)
	const [stepsOpen, setStepsOpen] = useState(false)
	const [steps, setSteps] = useState<string[]>(() => Array(STEP_COUNT).fill(""))
	const [pendingSessionSteps, setPendingSessionSteps] = useAtom(pendingSessionStepsAtom)
	const [runningSteps, setRunningSteps] = useState(false)
	const [currentStep, setCurrentStep] = useState(-1)
	const [completedSteps, setCompletedSteps] = useState<number[]>([])
	const stopStepsRef = useRef(false)
	// Always-current copy of the steps so the runner picks up live edits to
	// upcoming steps mid-run (the useCallback closure would otherwise be stale).
	const stepsRef = useRef<string[]>(steps)
	stepsRef.current = steps
	const hasSteps = steps.some((s) => s.trim())

	// Pick up steps queued from the new-chat screen (handed off via atom).
	useEffect(() => {
		const pending = pendingSessionSteps[agent.sessionId]
		if (!pending) return
		const { steps: pendingSteps, autoRun } = pending
		setSteps(Array.from({ length: STEP_COUNT }, (_, i) => pendingSteps[i] ?? ""))
		setStepsOpen(true)
		setPendingSessionSteps((prev) => {
			const next = { ...prev }
			delete next[agent.sessionId]
			return next
		})
		if (autoRun) {
			// Defer so the steps state has settled before the runner reads it.
			setTimeout(() => runSteps(), 200)
		}
	// Only run once per session mount — sessionId is the only dependency we need.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [agent.sessionId])

	// Verification gates: an optional "done when" shell command per step. After a
	// step's turn, the gate is run objectively (exit 0 = pass); on failure the
	// step is retried with the error fed back, then the run pauses.
	const MAX_STEP_RETRIES = 2
	const [gates, setGates] = useState<string[]>(() => Array(STEP_COUNT).fill(""))
	const gatesRef = useRef<string[]>(gates)
	gatesRef.current = gates
	const [failedStep, setFailedStep] = useState(-1)
	const [gateRunningStep, setGateRunningStep] = useState(-1)

	// Auto-decompose: turn one goal into an editable list of steps.
	const [goal, setGoal] = useState("")
	const [decomposing, setDecomposing] = useState(false)

	// Hyperloop: 7 parallel agents each working a separate step simultaneously.
	const [hyperRun, setHyperRun] = useAtom(hyperloopRunAtom)
	// Only restore a persisted run if it belongs to the current project directory
	const hyperRunForDir = hyperRun?.directory === agent.directory ? hyperRun : null
	const [hyperOpen, setHyperOpen] = useState(() => hyperRunForDir !== null)
	// The Hyperloop panel belongs to Hyperloop mode ONLY — never show it in Code mode.
	const hyperPanelOpen = workspaceMode === "hyperloop" && hyperOpen
	const [hyperGoal, setHyperGoal] = useState(() => hyperRunForDir?.goal ?? "")
	const [hyperDecomposing, setHyperDecomposing] = useState(false)
	const hyperSteps = hyperRunForDir?.steps ?? []
	const hyperRunning = hyperRunForDir?.running ?? false
	const setHyperSteps = (updater: HyperStep[] | ((prev: HyperStep[]) => HyperStep[])) =>
		setHyperRun((prev) => {
			const next = typeof updater === "function" ? updater(prev?.steps ?? []) : updater
			return prev ? { ...prev, steps: next } : { goal: hyperGoal, steps: next, running: false, directory: agent.directory }
		})
	const setHyperRunning = (running: boolean) =>
		setHyperRun((prev) => (prev ? { ...prev, running } : null))
	const [hyperReprompts, setHyperReprompts] = useState<string[]>(() => Array(7).fill(""))

	// Initialize model, variant, and agent from the session's last user message.
	const sessionMessages = useAtomValue(messagesFamily(agent.sessionId))
	const projectModels = useAtomValue(projectModelsAtom)
	const initializedForSessionRef = useRef<string | null>(null)
	const resetForSessionRef = useRef<string | null>(null)
	useEffect(() => {
		if (resetForSessionRef.current !== agent.sessionId) {
			resetForSessionRef.current = agent.sessionId
			initializedForSessionRef.current = null
			const stored = agent.directory ? projectModels[agent.directory] : undefined
			if (stored?.providerID && stored?.modelID) {
				setSelectedModel(stored)
				setSelectedVariant(stored.variant)
			} else {
				setSelectedModel(null)
				setSelectedVariant(undefined)
			}
			setSelectedAgent(stored?.agent || null)
		}

		if (initializedForSessionRef.current === agent.sessionId) return
		if (!sessionMessages || sessionMessages.length === 0) return
		initializedForSessionRef.current = agent.sessionId

		let foundModel = false
		let foundAgent = false
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role !== "user") continue
			const dynamic = msg as Record<string, unknown>

			if (!foundModel && "model" in msg && msg.model) {
				const model = msg.model as { providerID: string; modelID: string }
				if (model.providerID && model.modelID) {
					setSelectedModel(model)
					foundModel = true
					const variant = dynamic.variant as string | undefined
					if (variant) {
						setSelectedVariant(variant)
					} else {
						setSelectedVariant(undefined)
					}
				}
			}

			if (
				!foundAgent &&
				dynamic.agent &&
				typeof dynamic.agent === "string" &&
				dynamic.agent.length > 0
			) {
				setSelectedAgent(dynamic.agent)
				foundAgent = true
			}

			if (foundModel && foundAgent) break
		}
	}, [sessionMessages, agent.sessionId, agent.directory, projectModels])

	const { recentModels, addRecent: addRecentModel } = useModelState()

	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers],
	)

	useEffect(() => {
		if (!selectedVariant || !effectiveModel || !providers) return
		const available = getModelVariants(
			effectiveModel.providerID,
			effectiveModel.modelID,
			providers.providers,
		)
		if (!available.includes(selectedVariant)) {
			setSelectedVariant(undefined)
		}
	}, [selectedVariant, effectiveModel, providers])

	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
			setSelectedVariant(undefined)
			if (model) addRecentModel(model)
		},
		[addRecentModel],
	)

	const slashCommandRef = useRef<{
		setText: (text: string) => void
		getText: () => string
	} | null>(null)

	const handleSlashCommand = useCallback(
		async (text: string): Promise<boolean> => {
			const trimmed = text.trim()
			if (!trimmed.startsWith("/")) return false

			const spaceIndex = trimmed.indexOf(" ")
			const cmdName = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)
			const cmdArgs = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim()

			// Client-only commands that don't go through the server
			switch (cmdName.toLowerCase()) {
				case "undo":
					if (onUndo) await onUndo()
					return true
				case "redo":
					if (onRedo) await onRedo()
					return true
				case "compact":
				case "summarize":
					if (agent.directory && effectiveModel) {
						const client = getProjectClient(agent.directory)
						if (client) {
							try {
								await client.session.summarize({
									sessionID: agent.sessionId,
									providerID: effectiveModel.providerID,
									modelID: effectiveModel.modelID,
								})
							} catch (err) {
								log.error("session.summarize failed", { sessionId: agent.sessionId }, err)
							}
						}
					}
					return true
				default:
					break
			}

			if (agent.directory) {
				const client = getProjectClient(agent.directory)
				if (client) {
					try {
						await client.session.command({
							sessionID: agent.sessionId,
							command: cmdName,
							arguments: cmdArgs,
						})
						return true
					} catch {
						// Not a recognized server command
					}
				}
			}

			return false
		},
		[agent, onUndo, onRedo, effectiveModel],
	)

	/**
	 * Objectively check whether a step actually did something, instead of just
	 * trusting that its turn finished. Only looks at messages added after
	 * `sinceIndex` — all 7 steps share this one session, so without that bound
	 * this would re-check every prior step's messages too. Mirrors the same
	 * mechanical check Hyperloop's separate-session steps use: no tool call at
	 * all, a hallucinated tool, or a tool that errored all fail the step. This
	 * can't judge whether the result is actually what the user wanted — only
	 * that real work was attempted.
	 */
	const verifyStepMessages = async (
		client: NonNullable<ReturnType<typeof getProjectClient>>,
		sessionID: string,
		directory: string,
		sinceIndex: number,
	): Promise<{ ok: boolean; reason?: string }> => {
		try {
			const msgs = await client.session.messages({ sessionID, directory }).catch(() => null)
			type ToolPart = { type: string; tool?: string; state?: { status?: string; output?: string; error?: string } }
			const arr = ((msgs?.data as Array<{ parts: ToolPart[] }>) ?? []).slice(sinceIndex)
			const toolParts = arr.flatMap((m) => m.parts ?? []).filter((p) => p.type === "tool")

			if (toolParts.length === 0) {
				return { ok: false, reason: "No tool call was made — the model replied with text instead of doing the work" }
			}
			// OpenCode represents "the model called a tool that doesn't exist" as a
			// synthetic tool part named "invalid" with status "completed" (not
			// "error") — so status alone won't catch it; check the tool name too.
			const hallucinated = toolParts.find((p) => p.tool === "invalid")
			if (hallucinated) {
				return {
					ok: false,
					reason: (hallucinated.state?.output || hallucinated.state?.error || "Tried to call a tool that doesn't exist").slice(0, 300),
				}
			}
			const errored = toolParts.find((p) => p.state?.status === "error")
			if (errored) {
				return { ok: false, reason: `${errored.tool} failed: ${(errored.state?.error || "").slice(0, 250)}` }
			}
			return { ok: true }
		} catch {
			// Can't verify (server hiccup, etc.) — don't punish the step for our own fetch failure.
			return { ok: true }
		}
	}

	// "Run one at a time" — user picked manual pacing instead of running the
	// whole queue unattended, e.g. to watch step 1 land before trusting the
	// rest. Mirrors Hyperloop's own manual queue mode.
	const [manualStepMode, setManualStepMode] = useState(false)
	const nextManualStepIndex = manualStepMode
		? stepsRef.current.findIndex((s, i) => s.trim() && !completedSteps.includes(i) && i !== failedStep)
		: -1

	// Run ONE step: send it, then verify (auto check + optional shell gate),
	// retrying with the failure fed back up to MAX_STEP_RETRIES. Shared by both
	// "Run all steps" (looped below) and "Run one at a time" (called once per
	// click). Returns whether the step ultimately passed.
	const runOneStep = useCallback(
		async (i: number): Promise<boolean> => {
			const stepText = (stepsRef.current[i] ?? "").trim()
			if (!stepText || !onSendMessage) return true
			const hyperloop = workspaceMode === "hyperloop"
			const client = getProjectClient(agent.directory)
			setCurrentStep(i)
			setFailedStep(-1)
			const send = (text: string) =>
				onSendMessage(agent, text, {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent || undefined,
					variant: selectedVariant,
					hyperloop,
				})

			// All 7 steps share this one session, so "did this step's turn do
			// real work" has to be checked against only the messages it just
			// added — record the count before sending, diff against it after.
			const beforeCount =
				client && agent.directory
					? ((await client.session.messages({ sessionID: agent.sessionId, directory: agent.directory }).catch(() => null))
							?.data?.length ?? 0)
					: 0

			await send(stepText)

			// Combined verification: an automatic, no-setup check (did the step
			// actually call a tool, and did it succeed) runs on every step for
			// free, on top of the optional shell "done when" gate a user can add
			// for a harder, objective check. Either failing triggers the same
			// feed-back-and-retry loop, sharing one retry budget.
			const gate = (gatesRef.current[i] ?? "").trim()
			let passed = false
			for (let attempt = 0; attempt <= MAX_STEP_RETRIES; attempt++) {
				if (stopStepsRef.current) break

				const autoVerdict =
					client && agent.directory
						? await verifyStepMessages(client, agent.sessionId, agent.directory, beforeCount)
						: { ok: true as const }
				if (!autoVerdict.ok) {
					if (attempt === MAX_STEP_RETRIES) break
					await send(
						`That didn't do real work: ${autoVerdict.reason}\n\nActually use your tools to complete this step, then stop.`,
					)
					continue
				}

				if (gate && agent.directory) {
					setGateRunningStep(i)
					const res = await window.hramble
						.runShell(agent.directory, gate, 120_000)
						.catch(() => ({ code: 1, stdout: "", stderr: "gate could not run" }))
					setGateRunningStep(-1)
					if (res.code !== 0) {
						if (attempt === MAX_STEP_RETRIES) break
						const detail = (res.stderr || res.stdout || "").slice(-1500)
						await send(
							`The verification check \`${gate}\` still fails (exit ${res.code}):\n\n${detail}\n\nFix the code so that command passes, then stop.`,
						)
						continue
					}
				}

				passed = true
				break
			}
			if (passed) {
				setCompletedSteps((prev) => (prev.includes(i) ? prev : [...prev, i]))
			} else {
				setFailedStep(i)
			}
			return passed
		},
		[onSendMessage, workspaceMode, effectiveModel, agent, selectedAgent, selectedVariant],
	)

	// "Run all steps" — the existing unattended path, now just a loop over runOneStep.
	const runSteps = useCallback(async () => {
		if (!onSendMessage || runningSteps || !stepsRef.current.some((s) => s.trim())) return
		setRunningSteps(true)
		setCompletedSteps([])
		stopStepsRef.current = false
		try {
			if (effectiveModel && agent.directory) {
				appStore.set(setProjectModelAtom, {
					directory: agent.directory,
					model: { ...effectiveModel, variant: selectedVariant, agent: selectedAgent || undefined },
				})
			}
			for (let i = 0; i < STEP_COUNT; i++) {
				if (!(stepsRef.current[i] ?? "").trim()) continue
				if (stopStepsRef.current) break
				const passed = await runOneStep(i)
				if (!passed) {
					stopStepsRef.current = true
					break
				}
			}
		} finally {
			setRunningSteps(false)
			setCurrentStep(-1)
		}
	}, [onSendMessage, runningSteps, effectiveModel, agent, selectedAgent, selectedVariant, runOneStep])

	// "Run one at a time" — run just this one step, then stop and wait for the
	// user to click Run on whichever step they want next.
	const runSingleStep = useCallback(
		async (i: number) => {
			if (!onSendMessage || runningSteps || !(stepsRef.current[i] ?? "").trim()) return
			setManualStepMode(true)
			setRunningSteps(true)
			stopStepsRef.current = false
			try {
				if (effectiveModel && agent.directory) {
					appStore.set(setProjectModelAtom, {
						directory: agent.directory,
						model: { ...effectiveModel, variant: selectedVariant, agent: selectedAgent || undefined },
					})
				}
				await runOneStep(i)
			} finally {
				setRunningSteps(false)
				setCurrentStep(-1)
			}
		},
		[onSendMessage, runningSteps, effectiveModel, agent, selectedAgent, selectedVariant, runOneStep],
	)

	const stopSteps = useCallback(() => {
		stopStepsRef.current = true
		onStop?.(agent)
	}, [onStop, agent])

	// Auto-decompose: ask the model to break a single goal into an editable list
	// of steps. Runs in a throwaway session so it doesn't clutter the chat.
	const autoDecompose = useCallback(async () => {
		const g = goal.trim()
		if (!g || decomposing) return
		const client = getProjectClient(agent.directory)
		if (!client) return
		setDecomposing(true)
		try {
			const created = await client.session.create({ title: "Plan steps" })
			const scratchId = created.data?.id
			if (!scratchId) return
			const res = await client.session.prompt({
				sessionID: scratchId,
				parts: [
					{
						type: "text",
						text: `Break this goal into up to ${STEP_COUNT} concrete, ordered implementation steps. Reply ONLY as a numbered list (\`1.\`, \`2.\`, …), one step per line — no preamble, no sub-bullets.\n\nGoal: ${g}`,
					},
				],
				model: effectiveModel
					? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID }
					: undefined,
			})
			const text = (res.data?.parts ?? [])
				.map((p) => (p.type === "text" ? p.text : ""))
				.join("\n")
			const parsed = text
				.split("\n")
				.filter((l) => /^\s*\d+[.)]\s+/.test(l))
				.map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
				.filter((l) => l.length > 0)
				.slice(0, STEP_COUNT)
			if (parsed.length > 0) {
				setSteps(Array.from({ length: STEP_COUNT }, (_, i) => parsed[i] ?? ""))
				setStepsOpen(true)
			}
			await client.session.delete({ sessionID: scratchId, directory: agent.directory }).catch(() => {})
		} finally {
			setDecomposing(false)
		}
	}, [goal, decomposing, agent.directory, effectiveModel])

	// Hyperloop: decompose one big goal into 7 parallel steps via AI.
	const hyperDecompose = useCallback(async () => {
		const g = hyperGoal.trim()
		if (!g || hyperDecomposing) return
		const client = getProjectClient(agent.directory)
		if (!client) return
		setHyperDecomposing(true)
		setHyperSteps([])
		try {
			const created = await client.session.create({ title: "Hyperloop plan", directory: agent.directory })
			const scratchId = created.data?.id
			if (!scratchId) return
			await client.session.promptAsync({
				sessionID: scratchId,
				directory: agent.directory,
				parts: [
					{
						type: "text",
						text: `Break this goal into exactly 7 concrete implementation steps that can be worked on in PARALLEL by separate agents (each step touches different files/areas). Make each step a precise, self-contained instruction — include file names and what to do. At the end of each line add a realistic time estimate in the format [~X min].\n\nCRITICAL: All file paths MUST be RELATIVE to the current project folder (e.g. index.html, src/app.js, backend/server.js). NEVER use absolute paths, a leading slash, ~, or /tmp — never write files outside the project directory. Do NOT create a new top-level subfolder to hold the site; put files directly in the project root unless the goal clearly needs subfolders.\n\nReply ONLY as a numbered list (1., 2., …), one step per line. No preamble, no sub-bullets.\n\nExample line: 1. Create backend/server.js with Express setup [~5 min]\n\nGoal: ${g}`,
					},
				],
				model: effectiveModel
					? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID }
					: undefined,
			})
			// Poll until the session finishes. A finished session drops out of the status map,
			// so track seenBusy: once it's been busy and then disappears, it's genuinely done.
			let seenBusy = false
			for (let i = 0; i < 120; i++) {
				await new Promise((r) => setTimeout(r, 1000))
				const status = await client.session.status({ directory: agent.directory }).catch(() => null)
				const sessionStatus = (status?.data as Record<string, { type: string }> | null)?.[scratchId]
				if (sessionStatus?.type === "busy") { seenBusy = true; continue }
				if (seenBusy) break
				if (i >= 12) break
			}
			// Fetch the last assistant message
			const msgs = await client.session.messages({ sessionID: scratchId, directory: agent.directory }).catch(() => null)
			type MsgEntry = { info: { role: string }; parts: Array<{ type: string; text?: string }> }
			const allMsgs: MsgEntry[] = (msgs?.data as MsgEntry[]) ?? []
			const lastAssistant = [...allMsgs].reverse().find((m) => m.info?.role === "assistant")
			const text = (lastAssistant?.parts ?? [])
				.map((p) => (p.type === "text" ? p.text ?? "" : ""))
				.join("\n")
			const parsed = text
				.split("\n")
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
				.slice(0, 7)
			if (parsed.length > 0) {
				setHyperSteps(parsed.map((s) => ({ ...s, status: "idle" as const })))
			}
			await client.session.delete({ sessionID: scratchId, directory: agent.directory }).catch(() => {})
		} finally {
			setHyperDecomposing(false)
		}
	}, [hyperGoal, hyperDecomposing, agent.directory, effectiveModel])

	// Hyperloop: launch all steps simultaneously — each in its own session.
	const hyperLaunch = useCallback(async () => {
		if (hyperRunning || hyperSteps.length === 0) return
		const client = getProjectClient(agent.directory)
		if (!client) return
		setHyperRunning(true)
		const dir = agent.directory
		const sessionIds = await Promise.all(
			hyperSteps.map((s, i) =>
				client.session
					.create({ title: `Hyperloop ${i + 1}: ${s.text.slice(0, 40)}`, directory: dir })
					.then((r) => r.data?.id ?? null)
					.catch(() => null),
			),
		)
		// Tag every step session as Hyperloop so it's hidden from the sidebar.
		for (const id of sessionIds) if (id) markHyperloopSession(id)
		setHyperSteps((prev) =>
			prev.map((s, i) => ({ ...s, status: "running" as const, sessionId: sessionIds[i] ?? undefined })),
		)
		const runOne = async (i: number) => {
			const sid = sessionIds[i]
			const step = hyperSteps[i]
			if (!sid || !step) {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
				return
			}
			try {
				await client.session.promptAsync({
					sessionID: sid,
					directory: dir,
					parts: [{ type: "text", text: step.text }],
					model: effectiveModel
						? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID }
						: undefined,
				})
				// Poll until idle (max 10 min). A finished session drops out of the status map,
				// so break as soon as it's been busy and then disappears — not on timeout.
				let seenBusy = false
				for (let t = 0; t < 600; t++) {
					await new Promise((r) => setTimeout(r, 1000))
					const status = await client.session.status({ directory: dir }).catch(() => null)
					const st = (status?.data as Record<string, { type: string }> | null)?.[sid]
					if (st?.type === "busy") { seenBusy = true; continue }
					if (seenBusy) break
					if (t >= 12) break
				}
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "done" as const } : s)))
			} catch {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
			}
		}
		await Promise.all(hyperSteps.map((_, i) => runOne(i)))
		setHyperRunning(false)
	}, [hyperRunning, hyperSteps, agent.directory, effectiveModel])

	// Hyperloop: send a follow-up message to a specific step's session.
	const hyperReprompt = useCallback(
		async (i: number, text: string) => {
			const step = hyperSteps[i]
			if (!step?.sessionId || !text.trim()) return
			const client = getProjectClient(agent.directory)
			if (!client) return
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "running" as const } : s)))
			setHyperReprompts((prev) => prev.map((r, j) => (j === i ? "" : r)))
			try {
				const res = await client.session.prompt({
					sessionID: step.sessionId,
					parts: [{ type: "text", text }],
					model: effectiveModel
						? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID }
						: undefined,
				})
				const preview = (res.data?.parts ?? [])
					.map((p) => (p.type === "text" ? p.text : ""))
					.join("\n")
					.trim()
					.split("\n")
					.filter((l) => l.trim())
					.slice(-2)
					.join(" · ")
					.slice(0, 140)
				setHyperSteps((prev) =>
					prev.map((s, j) => (j === i ? { ...s, status: "done" as const, preview } : s)),
				)
			} catch {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
			}
		},
		[hyperSteps, agent.directory, effectiveModel],
	)

	const handleSend = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			log.debug("handleSend called", {
				textLength: text.trim().length,
				hasOnSendMessage: !!onSendMessage,
				sending,
				sessionId: agent.sessionId,
			})
			if (!text.trim() || !onSendMessage || sending) {
				log.warn("handleSend bailed", {
					emptyText: !text.trim(),
					noOnSendMessage: !onSendMessage,
					sending,
				})
				return
			}

			if (text.trim().startsWith("/")) {
				const handled = await handleSlashCommand(text)
				if (handled) {
					slashCommandRef.current?.setText("")
					clearDraft()
					setMentions([])
					return
				}
			}

			// Record the sent prompt for cross-session ↑/↓ recall, and reset any
			// in-progress history navigation.
			appStore.set(promptHistoryAtom, pushPromptHistory(appStore.get(promptHistoryAtom), text))
			historyIndexRef.current = -1
			historyStashRef.current = null

			setSending(true)
			try {
				if (effectiveModel && agent.directory) {
					appStore.set(setProjectModelAtom, {
						directory: agent.directory,
						model: {
							...effectiveModel,
							variant: selectedVariant,
							agent: selectedAgent || undefined,
						},
					})
				}

				log.debug("handleSend calling onSendMessage", {
					sessionId: agent.sessionId,
					directory: agent.directory,
					model: effectiveModel,
					agentName: selectedAgent,
					variant: selectedVariant,
					hasFiles: !!(files && files.length > 0),
				})

				// Prepend diff comments as structured context if any exist
				const commentPrefix = serializeCommentsForChat(diffComments)
				const finalText = commentPrefix ? `${commentPrefix}${text.trim()}` : text.trim()

				await onSendMessage(agent, finalText, {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent || undefined,
					variant: selectedVariant,
					files,
				})
				log.debug("handleSend onSendMessage completed", { sessionId: agent.sessionId })
				clearDraft()
				setMentions([])
				// Clear diff comments after successful send
				if (diffComments.length > 0) {
					setDiffComments([])
				}
				requestAnimationFrame(() => {
					scrollRef.current?.scrollToBottom("smooth")
				})
			} catch (err) {
				log.error("handleSend failed", { sessionId: agent.sessionId }, err)
			} finally {
				setSending(false)
			}
		},
		[
			onSendMessage,
			sending,
			agent,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			clearDraft,
			handleSlashCommand,
			scrollRef,
			diffComments,
			setDiffComments,
		],
	)

	// "Run in background" — hand the current prompt to onSendBackground (which
	// creates a new parallel session) instead of the active one. Deliberately NOT
	// gated on `sending` (the whole point is throughput — don't wait). Applies the
	// same model persistence + diff-comment prefix as a normal send so the
	// background job runs with the same context, then clears the draft/mentions.
	const handleSendBackground = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			if (!text.trim() || !onSendBackground) return

			if (effectiveModel && agent.directory) {
				appStore.set(setProjectModelAtom, {
					directory: agent.directory,
					model: {
						...effectiveModel,
						variant: selectedVariant,
						agent: selectedAgent || undefined,
					},
				})
			}

			const commentPrefix = serializeCommentsForChat(diffComments)
			const finalText = commentPrefix ? `${commentPrefix}${text.trim()}` : text.trim()

			try {
				await onSendBackground(finalText, {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent || undefined,
					variant: selectedVariant,
					files,
				})
				clearDraft()
				setMentions([])
				if (diffComments.length > 0) setDiffComments([])
			} catch (err) {
				log.error("handleSendBackground failed", { sessionId: agent.sessionId }, err)
			}
		},
		[
			onSendBackground,
			effectiveModel,
			agent,
			selectedAgent,
			selectedVariant,
			clearDraft,
			diffComments,
			setDiffComments,
		],
	)

	const canSend = isConnected && !sending

	const handleStop = useCallback(() => {
		if (onStop && isWorking) {
			onStop(agent)
		}
	}, [onStop, isWorking, agent])

	const handleEscapeAbort = useCallback(() => {
		if (!isWorking) return

		setInterruptCount((prev) => {
			const next = prev + 1
			if (next >= 2) {
				handleStop()
				if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
				return 0
			}
			if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
			interruptTimerRef.current = setTimeout(() => setInterruptCount(0), 3000)
			return next
		})
	}, [isWorking, handleStop])

	// --- Popover state (slash commands + mentions) ---
	const [slashOpen, setSlashOpen] = useState(false)
	const [slashQuery, setSlashQuery] = useState("")
	const [mentionOpen, setMentionOpen] = useState(false)
	const [mentionQuery, setMentionQuery] = useState("")

	// --- Skills picker dialog ---
	const [skillsDialogOpen, setSkillsDialogOpen] = useState(false)

	const handleForkViaSlash = useCallback(async () => {
		const ctrl = slashCommandRef.current
		if (ctrl) ctrl.setText("")
		await onForkFromTurn?.()
	}, [onForkFromTurn])

	const handleSkillsOpen = useCallback(() => {
		const ctrl = slashCommandRef.current
		if (ctrl) ctrl.setText("")
		setSkillsDialogOpen(true)
	}, [])

	const handleSkillSelect = useCallback((skillName: string) => {
		const ctrl = slashCommandRef.current
		if (ctrl) {
			ctrl.setText(`/${skillName} `)
		}
		requestAnimationFrame(() => {
			const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			if (ta) {
				ta.focus()
				const len = `/${skillName} `.length
				ta.setSelectionRange(len, len)
			}
		})
	}, [])

	const slashPopoverRef = useRef<SlashCommandPopoverHandle>(null)
	const mentionPopoverRef = useRef<MentionPopoverHandle>(null)

	// Prompt-history (↑/↓) navigation state. `index` -1 = not navigating; 0 =
	// newest entry. `stash` holds the in-progress draft while navigating so ↓
	// past the newest entry restores what the user was typing.
	const historyIndexRef = useRef(-1)
	const historyStashRef = useRef<string | null>(null)

	/** Recall a previous/next prompt into the composer. Returns true if handled. */
	const navigatePromptHistory = useCallback(
		(direction: "prev" | "next"): boolean => {
			const ctrl = slashCommandRef.current
			if (!ctrl) return false
			const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			const text = ctrl.getText()
			const caret = ta?.selectionStart ?? text.length
			const caretEnd = ta?.selectionEnd ?? text.length
			const history = appStore.get(promptHistoryAtom)
			if (history.length === 0) return false

			if (direction === "prev") {
				// Only hijack ↑ at the very start of the field, so multi-line editing
				// still works normally.
				if (caret !== 0 || caretEnd !== 0) return false
				if (historyIndexRef.current === -1) {
					historyStashRef.current = text
					historyIndexRef.current = 0
				} else if (historyIndexRef.current < history.length - 1) {
					historyIndexRef.current += 1
				} else {
					return true // already at the oldest — swallow the key, don't move
				}
			} else {
				// ↓ only recalls forward while navigating, and only from the end.
				if (historyIndexRef.current === -1) return false
				if (caret !== text.length || caretEnd !== text.length) return false
				if (historyIndexRef.current === 0) {
					historyIndexRef.current = -1
					const restore = historyStashRef.current ?? ""
					historyStashRef.current = null
					ctrl.setText(restore)
					requestAnimationFrame(() => {
						const el = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
						el?.setSelectionRange(restore.length, restore.length)
					})
					return true
				}
				historyIndexRef.current -= 1
			}

			const entry = history[history.length - 1 - historyIndexRef.current] ?? ""
			ctrl.setText(entry)
			// Keep the caret at the start so repeated ↑ keeps walking back.
			requestAnimationFrame(() => {
				const el = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
				el?.setSelectionRange(0, 0)
			})
			return true
		},
		[],
	)

	const handleSlashTriggerChange = useCallback((open: boolean, query: string) => {
		setSlashOpen(open)
		setSlashQuery(query)
	}, [])

	const handleMentionTriggerChange = useCallback((open: boolean, query: string) => {
		setMentionOpen(open)
		setMentionQuery(query)
	}, [])

	const handleSlashClose = useCallback(() => {
		setSlashOpen(false)
		setSlashQuery("")
	}, [])

	const handleMentionClose = useCallback(() => {
		setMentionOpen(false)
		setMentionQuery("")
	}, [])

	const handleSlashSelect = useCallback(
		(command: string) => {
			handleSlashClose()
			const ctrl = slashCommandRef.current
			// Use the command string directly instead of setText + getText round-trip,
			// which races with React's asynchronous state batching and sometimes reads
			// stale text (e.g. "/un" instead of "/undo").
			if (command.startsWith("/")) {
				handleSlashCommand(command).then((handled) => {
					if (handled) {
						if (ctrl) ctrl.setText("")
						clearDraft()
					} else if (ctrl) {
						// Not a recognized command — leave it in the input for the user
						ctrl.setText(command)
					}
				})
			} else if (ctrl) {
				ctrl.setText(command)
			}
		},
		[handleSlashClose, handleSlashCommand, clearDraft],
	)

	const handleMentionSelect = useCallback(
		(option: MentionOption) => {
			handleMentionClose()
			const ctrl = slashCommandRef.current
			if (!ctrl) return

			const currentText = ctrl.getText()
			const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			const cursorPos = textarea?.selectionStart ?? currentText.length

			const mention =
				option.type === "file" ? createFileMention(option.path) : createAgentMention(option.name)

			const { text: newText, cursorPosition: newCursor } = insertMentionIntoText(
				currentText,
				cursorPos,
				mention,
			)

			ctrl.setText(newText)

			setMentions((prev) => {
				const key = mention.type === "file" ? `file:${mention.path}` : `agent:${mention.name}`
				if (prev.some((m) => (m.type === "file" ? `file:${m.path}` : `agent:${m.name}`) === key))
					return prev
				return [...prev, mention]
			})

			requestAnimationFrame(() => {
				const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
				if (ta) {
					ta.focus()
					ta.setSelectionRange(newCursor, newCursor)
				}
			})
		},
		[handleMentionClose],
	)

	const handleMentionRemove = useCallback((mention: PromptMention) => {
		const ctrl = slashCommandRef.current
		if (ctrl) {
			const marker = getMentionMarker(mention)
			const currentText = ctrl.getText()
			ctrl.setText(currentText.replace(`${marker} `, "").replace(marker, ""))
		}
		setMentions((prev) => {
			const key = mention.type === "file" ? `file:${mention.path}` : `agent:${mention.name}`
			return prev.filter((m) => (m.type === "file" ? `file:${m.path}` : `agent:${m.name}`) !== key)
		})
	}, [])

	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Always delegate to popovers first — they guard on their own `open` prop
			// internally, so we don't need to check slashOpen/mentionOpen here.
			// This avoids stale-closure issues where the parent's boolean lags behind
			// the popover's actual state (due to async TriggerDetector effects).
			if (slashPopoverRef.current?.handleKeyDown(e)) return
			if (mentionPopoverRef.current?.handleKeyDown(e)) return

			// Prompt-history recall (↑/↓), Claude-style. Skipped while a modifier is
			// held so shortcuts still work.
			if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
				if (navigatePromptHistory(e.key === "ArrowUp" ? "prev" : "next")) {
					e.preventDefault()
					return
				}
			} else if (e.key !== "Shift") {
				// Any other edit exits history navigation (back to a fresh draft).
				historyIndexRef.current = -1
				historyStashRef.current = null
			}

			if (e.key === "Escape") {
				handleEscapeAbort()
			}
		},
		[handleEscapeAbort, navigatePromptHistory],
	)

	// Width constraint class: remove max-w when review panel is open
	const inputWidthClass = reviewPanelOpen
		? "mx-auto w-full min-w-0"
		: "mx-auto w-full min-w-0 max-w-4xl"

	return (
		<>
			<div className="min-w-0 px-0 pb-0 pt-1 sm:px-4 sm:pb-4 sm:pt-2">
				<div className={inputWidthClass}>
					{/* Session task list — collapsible todo progress */}
					<SessionTaskList sessionId={agent.sessionId} />

					{/* Revert banner — shown when session is in undo state */}
					{isReverted && (
						<div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-400">
							<Undo2Icon className="size-3.5 shrink-0" />
							<span className="flex-1">
								Session reverted — type to continue from here, or redo to restore
							</span>
							{canRedo && onRedo && (
								<button
									type="button"
									onClick={() => onRedo()}
									className="flex items-center gap-1 rounded-md bg-amber-200/60 px-2 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
								>
									<Redo2Icon className="size-3" />
									Redo
								</button>
							)}
						</div>
					)}

					{/* Sleep/wake recovery — Mac went to sleep mid-run, this session got interrupted */}
					{interruptedItem && (
						<div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
							<MoonIcon className="size-3.5 shrink-0" />
							<span className="flex-1">Your Mac went to sleep and this task was interrupted — continue from here?</span>
							<button
								type="button"
								onClick={() => resolveInterruptedItem(interruptedItem.id)}
								className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-[11px] text-foreground transition-colors hover:bg-muted"
							>
								<CheckIcon className="size-3" />
								Yes, continue
							</button>
							<button
								type="button"
								onClick={() => resolveInterruptedItem(interruptedItem.id)}
								className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:text-foreground"
							>
								Dismiss
							</button>
						</div>
					)}

					{/* Pending permissions — tree-scoped: shows own OR any sub-agent's permission */}
					{effectivePermission && (
						<div className="pb-2">
							<PermissionItem
								key={effectivePermission.request.id}
								agent={agent}
								permission={effectivePermission.request}
								onApprove={onApprove}
								onDeny={onDeny}
								isConnected={isConnected}
								isFromSubAgent={effectivePermission.sessionId !== agent.sessionId}
							/>
						</div>
					)}

					{/* When questions are pending, replace the input with a focused question flow.
					    Tree-scoped: shows own OR any sub-agent's question. */}
					{effectiveQuestion ? (
						<ChatQuestionFlow
							questions={[effectiveQuestion.request]}
							isFromSubAgent={effectiveQuestion.sessionId !== agent.sessionId}
							onReply={handleReplyQuestion}
							onReject={handleRejectQuestion}
							disabled={!isConnected}
						/>
					) : (
						/* Input card — PromptInputProvider wraps everything,
					   popovers positioned relative to the card wrapper,
					   textarea as a direct child of InputGroup inside PromptInput */
						<PromptInputProvider key={agent.sessionId} initialInput={draft}>
							<DraftSync setDraft={setDraft} />
							<SlashCommandBridge controllerRef={slashCommandRef} />
							<TriggerDetector
								onSlashChange={handleSlashTriggerChange}
								onMentionChange={handleMentionTriggerChange}
							/>
							<MentionReconciler mentions={mentions} onReconcile={setMentions} />
							{/* Relative wrapper for absolutely-positioned popovers */}
							<div className="relative">
								{/* Popovers render above the card via bottom-full */}
							<SlashCommandPopover
								ref={slashPopoverRef}
								query={slashQuery}
								open={slashOpen}
								enabled={isConnected}
								directory={agent.directory}
								onSelect={handleSlashSelect}
								onSkillsOpen={handleSkillsOpen}
								onFork={handleForkViaSlash}
								onClose={handleSlashClose}
							/>
								<MentionPopover
									ref={mentionPopoverRef}
									query={mentionQuery}
									open={mentionOpen}
									directory={agent.directory}
									agents={openCodeAgents ?? []}
									onSelect={handleMentionSelect}
									onClose={handleMentionClose}
								/>
								{hyperPanelOpen && (
									<div className="mb-2 rounded-xl border border-primary/30 bg-muted/30 p-3">
										<div className="mb-2 flex items-center justify-between">
											<span className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
												<InfinityIcon className="size-3.5 text-primary" />
												Hyperloop — 7 parallel agents
												{hyperRunning && (
													<span className="text-primary">
														· {hyperSteps.filter((s) => s.status === "done").length}/{hyperSteps.length} done
													</span>
												)}
											</span>
											<button
												type="button"
												onClick={() => setHyperOpen(false)}
												className="rounded p-0.5 text-muted-foreground hover:text-foreground"
											>
												<XIcon className="size-3.5" />
											</button>
										</div>

										{/* Goal input — shown when no steps yet */}
										{hyperSteps.length === 0 && (
											<div className="flex items-center gap-2">
												<input
													value={hyperGoal}
													onChange={(e) => setHyperGoal(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															e.preventDefault()
															hyperDecompose()
														}
													}}
													placeholder="Describe your goal — AI splits it into 7 parallel steps"
													disabled={hyperDecomposing}
													className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
												/>
												<button
													type="button"
													onClick={hyperDecompose}
													disabled={!hyperGoal.trim() || hyperDecomposing || !isConnected}
													className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs hover:bg-muted disabled:opacity-50"
												>
													{hyperDecomposing ? (
														<Loader2Icon className="size-3.5 animate-spin" />
													) : (
														<SparklesIcon className="size-3.5" />
													)}
													{hyperDecomposing ? "Planning…" : "Decompose"}
												</button>
											</div>
										)}

										{/* Step cards — vertical column */}
										{hyperSteps.length > 0 && (
											<div className="space-y-1.5">
												{hyperSteps.map((step, i) => (
													<div
														key={i}
														className={`rounded-lg border p-2.5 transition-colors ${
															step.status === "running"
																? "border-primary/60 bg-primary/5"
																: step.status === "done"
																	? "border-emerald-500/40"
																	: step.status === "failed"
																		? "border-red-500/40"
																		: "border-border"
														}`}
													>
														<div className="flex items-center gap-2">
															<span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground">
																{step.status === "running" ? (
																	<InfinityIcon className="size-3.5 animate-spin text-primary" />
																) : step.status === "done" ? (
																	<CheckIcon className="size-3.5 text-emerald-500" />
																) : step.status === "failed" ? (
																	<XIcon className="size-3.5 text-red-500" />
																) : (
																	i + 1
																)}
															</span>
															<span className="flex-1 min-w-0">
																	<span className="block truncate text-[13px] font-medium">{step.text}</span>
																	{step.timeEstimate && <span className="text-[10px] text-muted-foreground">{step.timeEstimate}</span>}
																</span>
															<span
																className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
																	step.status === "done"
																		? "bg-emerald-500/10 text-emerald-600"
																		: step.status === "running"
																			? "bg-primary/10 text-primary"
																			: step.status === "failed"
																				? "bg-red-500/10 text-red-500"
																				: "bg-muted text-muted-foreground"
																}`}
															>
																{step.status === "idle" ? "queued" : step.status}
															</span>
														</div>
														{step.preview && (
															<p className="mt-1 line-clamp-2 pl-6 text-[11px] text-muted-foreground">
																{step.preview}
															</p>
														)}
														{(step.sessionId || step.status === "running" || step.status === "failed") && (
															<div className="mt-1 flex gap-1.5 pl-6">
																{step.status === "running" && step.sessionId && (
																	<button type="button" onClick={async () => {
																		const c = getProjectClient(agent.directory)
																		if (c && step.sessionId) {
																			await c.session.abort({ sessionID: step.sessionId }).catch(() => {})
																			setHyperSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: "failed" as const } : s))
																		}
																	}} className="rounded px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-500/10">Stop</button>
																)}
																{step.status === "failed" && (
																	<button type="button" onClick={async () => {
																		const c = getProjectClient(agent.directory)
																		if (!c) return
																		setHyperSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: "running" as const } : s))
																		try {
																			const r = await c.session.create({ title: `Retry ${i + 1}: ${step.text.slice(0, 40)}` })
																			const sid = r.data?.id
																			if (!sid) throw new Error("no id")
																			markHyperloopSession(sid)
																			setHyperSteps((prev) => prev.map((s, j) => j === i ? { ...s, sessionId: sid } : s))
																			await c.session.prompt({ sessionID: sid, parts: [{ type: "text", text: step.text }], model: effectiveModel ? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID } : undefined })
																			setHyperSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: "done" as const } : s))
																		} catch {
																			setHyperSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: "failed" as const } : s))
																		}
																	}} className="rounded px-2 py-0.5 text-[10px] text-amber-500 hover:bg-amber-500/10">Retry</button>
																)}
															</div>
														)}
														{step.status === "done" && (
															<div className="mt-1.5 flex gap-1.5 pl-6">
																<input
																	value={hyperReprompts[i] ?? ""}
																	onChange={(e) =>
																		setHyperReprompts((prev) =>
																			prev.map((r, j) => (j === i ? e.target.value : r)),
																		)
																	}
																	onKeyDown={(e) => {
																		if (e.key === "Enter") {
																			e.preventDefault()
																			hyperReprompt(i, hyperReprompts[i] ?? "")
																		}
																	}}
																	placeholder={`Follow up on step ${i + 1}…`}
																	className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
																/>
																<button
																	type="button"
																	onClick={() => hyperReprompt(i, hyperReprompts[i] ?? "")}
																	disabled={!hyperReprompts[i]?.trim()}
																	className="rounded-md border border-border px-2 py-1 text-[11px] text-primary hover:bg-muted disabled:opacity-40"
																>
																	Send
																</button>
															</div>
														)}
													</div>
												))}
											</div>
										)}

										{/* Action row */}
										{hyperSteps.length > 0 && (
											<div className="mt-2 flex items-center gap-2">
												{!hyperRunning ? (
													<button
														type="button"
														onClick={hyperLaunch}
														disabled={!isConnected || hyperSteps.every((s) => s.status !== "idle")}
														className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:opacity-90 disabled:opacity-50"
													>
														<PlayIcon className="size-3.5" />
														Launch all {hyperSteps.length}
													</button>
												) : (
													<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
														<Loader2Icon className="size-3.5 animate-spin" />
														Running in parallel…
													</span>
												)}
												<button
													type="button"
													onClick={() => {
														setHyperRun(null)
														setHyperGoal("")
														setHyperReprompts(Array(7).fill(""))
													}}
													disabled={hyperRunning}
													className="rounded-md px-2 py-1.5 font-medium text-muted-foreground text-xs hover:text-foreground disabled:opacity-40"
												>
													Re-plan
												</button>
											</div>
										)}
									</div>
								)}

								{stepsOpen && (
									<div className="mb-2 rounded-xl border border-border bg-muted/30 p-3">
										<div className="mb-2 flex items-center justify-between">
											<span className="font-medium text-muted-foreground text-xs">
												Steps — run in order
												{workspaceMode === "hyperloop" ? " · Hyperloop each step" : ""}
											</span>
											<button
												type="button"
												onClick={() => setStepsOpen(false)}
												className="rounded p-0.5 text-muted-foreground hover:text-foreground"
												title="Hide steps"
											>
												<XIcon className="size-3.5" />
											</button>
										</div>
										{/* Auto-plan: turn one goal into steps */}
										<div className="mb-2 flex items-center gap-2">
											<input
												value={goal}
												onChange={(e) => setGoal(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") {
														e.preventDefault()
														autoDecompose()
													}
												}}
												placeholder="Describe a goal — Auto-plan breaks it into steps"
												disabled={decomposing || runningSteps}
												className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
											/>
											<button
												type="button"
												onClick={autoDecompose}
												disabled={!goal.trim() || decomposing || runningSteps || !isConnected}
												className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs hover:bg-muted disabled:opacity-50"
											>
												{decomposing ? (
													<Loader2Icon className="size-3.5 animate-spin" />
												) : (
													<SparklesIcon className="size-3.5" />
												)}
												{decomposing ? "Planning…" : "Auto-plan"}
											</button>
										</div>
										<div className="space-y-1.5">
											{steps.map((s, i) => (
												<div key={i} className="flex items-start gap-2">
													<span
														className={`flex w-4 shrink-0 items-center justify-center pt-2 text-center text-xs ${failedStep === i ? "text-red-500" : currentStep === i ? "font-bold text-primary" : "text-muted-foreground"}`}
													>
														{failedStep === i ? (
															<XIcon className="size-3.5 text-red-500" />
														) : gateRunningStep === i ? (
															<Loader2Icon className="size-3.5 animate-spin text-primary" />
														) : completedSteps.includes(i) ? (
															<CheckIcon className="size-3.5 text-emerald-500" />
														) : (
															i + 1
														)}
													</span>
													<div className="min-w-0 flex-1 space-y-1">
														<StepTextarea
															value={s}
															onChange={(v) =>
																setSteps((prev) => prev.map((x, j) => (j === i ? v : x)))
															}
															placeholder={`Step ${i + 1}…`}
															disabled={
																!isConnected ||
																(runningSteps && (i === currentStep || completedSteps.includes(i)))
															}
															className={`max-h-40 min-h-8 w-full resize-none overflow-y-auto rounded-md border bg-background px-2 py-1.5 text-sm leading-snug outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 ${failedStep === i ? "border-red-500/50" : currentStep === i ? "border-primary ring-1 ring-primary" : completedSteps.includes(i) ? "border-emerald-500/40" : "border-border"}`}
														/>
														{/* Optional verification gate — appears once the step has text */}
														{s.trim() && (
															<input
																value={gates[i] ?? ""}
																onChange={(e) =>
																	setGates((prev) =>
																		prev.map((x, j) => (j === i ? e.target.value : x)),
																	)
																}
																placeholder="✓ done when… optional check, e.g. npm test"
																disabled={
																	!isConnected ||
																	(runningSteps && (i === currentStep || completedSteps.includes(i)))
																}
																className="w-full rounded-md border border-border/60 bg-background/50 px-2 py-1 font-mono text-[11px] text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
															/>
														)}
														{manualStepMode && s.trim() && !runningSteps && !completedSteps.includes(i) && failedStep !== i && (
															<button
																type="button"
																onClick={() => runSingleStep(i)}
																disabled={!canSend}
																className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40 ${i === nextManualStepIndex ? "animate-pulse bg-primary/10 ring-1 ring-primary" : ""}`}
															>
																<PlayIcon className="size-3" /> Run this step
															</button>
														)}
													</div>
												</div>
											))}
										</div>
										{failedStep >= 0 && (
											<div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-400">
												Step {failedStep + 1}'s check didn't pass after retries — paused. Fix it or
												adjust the check, then Run steps again.
											</div>
										)}
										<div className="mt-2 flex items-center gap-2">
											{!runningSteps ? (
												<>
													<button
														type="button"
														onClick={() => {
															setManualStepMode(false)
															runSteps()
														}}
														disabled={!canSend || !hasSteps}
														className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:opacity-90 disabled:opacity-50"
													>
														<PlayIcon className="size-3.5" />
														Run all steps
													</button>
													<button
														type="button"
														onClick={() => runSingleStep(nextManualStepIndex >= 0 ? nextManualStepIndex : 0)}
														disabled={!canSend || !hasSteps}
														title="Run just the next step, then wait — pick your own pace and check each result before continuing."
														className="rounded-md border border-border px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:opacity-40"
													>
														Run one at a time
													</button>
												</>
											) : (
												<button
													type="button"
													onClick={stopSteps}
													className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 font-medium text-white text-xs hover:opacity-90"
												>
													<SquareIcon className="size-3.5" />
													Stop (running step {currentStep + 1})
												</button>
											)}
											<button
												type="button"
												onClick={() => {
													setSteps(Array(STEP_COUNT).fill(""))
													setGates(Array(STEP_COUNT).fill(""))
													setCompletedSteps([])
													setFailedStep(-1)
													setManualStepMode(false)
												}}
												disabled={runningSteps || !hasSteps}
												className="rounded-md px-2 py-1.5 font-medium text-muted-foreground text-xs hover:text-foreground disabled:opacity-40"
											>
												Clear
											</button>
										</div>
									</div>
								)}
								<PromptInput
									className="rounded-xl"
									accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
									multiple
									maxFileSize={10 * 1024 * 1024}
									onSubmit={(message) => {
										if (message.text.trim() && canSend)
											handleSend(message.text, message.files.length > 0 ? message.files : undefined)
									}}
								>
									{/* Mention chips above the textarea */}
									<ContextItems mentions={mentions} onRemove={handleMentionRemove} />
									{/* Diff comment chips above the textarea */}
									{diffComments.length > 0 && (
										<DiffCommentChips
											comments={diffComments}
											onRemove={(id) => setDiffComments((prev) => prev.filter((c) => c.id !== id))}
										/>
									)}
									<PromptAttachmentPreview
										supportsImages={modelCapabilities?.image}
										supportsPdf={modelCapabilities?.pdf}
									/>
									<PromptInputTextarea
										data-prompt-input
										onKeyDown={handleTextareaKeyDown}
										disabled={!isConnected}
										placeholder={
											isWorking ? "Send a follow-up message..." : "What would you like to do?"
										}
										className="min-h-14 py-2.5"
									/>

									{/* Toolbar inside the card — agent + model + variant selectors + submit */}
									<PromptInputFooter>
										<PromptInputTools>
											{workspaceMode === "hyperloop" && (
										<PromptInputButton
												onClick={() => setHyperOpen((v) => !v)}
												className={
													hyperOpen || hyperSteps.length > 0 ? "text-primary" : ""
												}
												title="Hyperloop — 7 parallel agents, each on a separate step"
											>
												<InfinityIcon className="size-3.5" />
											</PromptInputButton>
										)}
											<PromptInputButton
												onClick={() => setStepsOpen((v) => !v)}
												className={stepsOpen || hasSteps ? "text-primary" : ""}
												title="Loop — queue up to 7 steps and run them in sequence"
											>
												<ListOrderedIcon className="size-3.5" />
											</PromptInputButton>
											<AttachButton disabled={!isConnected} />
											{onSendBackground && (
												<SendInBackgroundButton
													onSend={handleSendBackground}
													disabled={!isConnected}
												/>
											)}
											<PromptToolbar
												agents={openCodeAgents ?? []}
												selectedAgent={selectedAgent}
												defaultAgent={config?.defaultAgent}
												onSelectAgent={setSelectedAgent}
												providers={providers ?? null}
												effectiveModel={effectiveModel}
												hasModelOverride={!!selectedModel}
												onSelectModel={handleModelSelect}
												recentModels={recentModels}
												selectedVariant={selectedVariant}
												onSelectVariant={setSelectedVariant}
												disabled={!isConnected}
											/>
										</PromptInputTools>
										<PromptInputSubmit
											disabled={!canSend}
											status={isWorking ? "streaming" : undefined}
											onStop={handleStop}
											size={isWorking && currentTurnWorkSplit ? "xs" : "icon-sm"}
										>
											{isWorking && currentTurnWorkSplit ? (
												<LiveTurnTimer
													completedMs={currentTurnWorkSplit.completedMs}
													activeStartMs={currentTurnWorkSplit.activeStartMs}
												/>
											) : undefined}
										</PromptInputSubmit>
									</PromptInputFooter>
								</PromptInput>
							</div>
						</PromptInputProvider>
					)}

					{/* Status bar — outside the card */}
					<StatusBar
						vcs={vcs ?? null}
						isConnected={isConnected}
						isWorking={isWorking}
						interruptCount={interruptCount}
						sessionId={agent.sessionId}
						providers={providers}
						compaction={config?.compaction}
						extraSlot={
							agent.worktreePath ? (
								<div className="flex items-center gap-1">
									<GitForkIcon className="size-3" />
									<span>Worktree</span>
								</div>
							) : (
								<div className="flex items-center gap-1">
									<MonitorIcon className="size-3" />
									<span>Local</span>
								</div>
							)
						}
					/>
				</div>
			</div>

			{/* Skills picker dialog — triggered by /skills command */}
			<SkillPickerDialog
				open={skillsDialogOpen}
				onOpenChange={setSkillsDialogOpen}
				directory={agent.directory}
				onSelect={handleSkillSelect}
			/>
		</>
	)
}

// ============================================================
// Live turn timer — ticks every second while the agent is working
// ============================================================

/**
 * Compact live timer that shows how long the current exchange has been working.
 * Uses the same completed + active split as the header's LiveWorkTime, so it
 * shows actual agent work time (sum of assistant message durations) rather than
 * wall-clock elapsed time.
 */
function LiveTurnTimer({
	completedMs,
	activeStartMs,
}: {
	completedMs: number
	activeStartMs: number | null
}) {
	const computeDisplay = useCallback(
		() =>
			formatWorkDuration(completedMs + (activeStartMs != null ? Date.now() - activeStartMs : 0)),
		[completedMs, activeStartMs],
	)

	const [elapsed, setElapsed] = useState(computeDisplay)

	useEffect(() => {
		const tick = () => setElapsed(computeDisplay())
		tick()
		// Only tick if there's an active (in-progress) message
		if (activeStartMs != null) {
			const id = setInterval(tick, 1_000)
			return () => clearInterval(id)
		}
	}, [computeDisplay, activeStartMs])

	return (
		<span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
			<SquareIcon className="size-3.5" />
			{elapsed}
		</span>
	)
}

// ============================================================
// Worktree setup progress (shown in empty state during creation)
// ============================================================

const SETUP_PHASE_LABELS: Record<NonNullable<SessionSetupPhase>, string> = {
	"creating-worktree": "Creating worktree...",
	"starting-session": "Starting session...",
}

function WorktreeSetupProgress({ phase }: { phase: NonNullable<SessionSetupPhase> }) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16">
			<div className="flex size-12 items-center justify-center rounded-xl border border-border/50 bg-muted/30">
				<GitForkIcon className="size-5 text-muted-foreground" />
			</div>
			<div className="flex flex-col items-center gap-2">
				<div className="flex items-center gap-2">
					<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
					<p className="text-sm font-medium text-foreground">{SETUP_PHASE_LABELS[phase]}</p>
				</div>
				<p className="text-xs text-muted-foreground">
					Setting up an isolated workspace for this session
				</p>
			</div>
		</div>
	)
}

// ============================================================
// Diff comment chips shown above the chat input
// ============================================================

function DiffCommentChips({
	comments,
	onRemove,
}: {
	comments: DiffComment[]
	onRemove: (id: string) => void
}) {
	if (comments.length === 0) return null

	return (
		<div className="flex flex-wrap gap-1 px-1 pt-1">
			{comments.map((comment) => {
				const fileName = comment.filePath.split("/").pop() ?? comment.filePath
				return (
					<span
						key={comment.id}
						className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] leading-tight"
					>
						<span className="shrink-0 font-mono text-muted-foreground">
							{fileName}:{comment.lineNumber}
						</span>
						<span className="truncate text-foreground">
							{comment.content.length > 40 ? `${comment.content.slice(0, 40)}...` : comment.content}
						</span>
						<button
							type="button"
							onClick={() => onRemove(comment.id)}
							className="shrink-0 text-muted-foreground/60 hover:text-foreground"
						>
							<XIcon className="size-2.5" />
						</button>
					</span>
				)
			})}
		</div>
	)
}
