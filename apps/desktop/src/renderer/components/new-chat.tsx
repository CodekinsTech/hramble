import {
	PromptInput,
	PromptInputButton,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputController,
} from "@hramble/ui/components/ai-elements/prompt-input"
import { type MentionOption, MentionPopover, type MentionPopoverHandle } from "./chat/mention-popover"
import {
	createAgentMention,
	createFileMention,
	insertMentionIntoText,
} from "./chat/prompt-mentions"
import { Popover, PopoverContent, PopoverTrigger } from "@hramble/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@hramble/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	CheckIcon,
	ChevronDownIcon,
	CodeIcon,
	FileTextIcon,
	FolderIcon,
	FolderPlusIcon,
	GitForkIcon,
	GitPullRequestIcon,
	InfinityIcon,
	MonitorIcon,
	PencilIcon,
	PlayIcon,
	RotateCwIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { projectModelsAtom, setProjectModelAtom } from "../atoms/preferences"
import {
	removeSessionAtom,
	setSessionBranchAtom,
	setSessionSetupPhaseAtom,
	setSessionWorktreeAtom,
	upsertSessionAtom,
} from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { CHAT_MODE_ORDER, CHAT_MODES, chatModeAtom } from "../atoms/chat-mode"
import { mergeSessionPermission, permissionRulesAtom } from "../atoms/permission-rules"
import { type HyperStep, hyperloopRunAtom, markHyperloopSession, workspaceModeAtom } from "../atoms/workspace"
import { useAgents, useProjectList } from "../hooks/use-agents"
import { NEW_CHAT_DRAFT_KEY, useDraftActions, useDraftSnapshot } from "../hooks/use-draft"
import type { ModelRef } from "../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	getModelVariants,
	resolveEffectiveModel,
	useConfig,
	useModelState,
	useOpenCodeAgents,
	useProviders,
	useVcs,
} from "../hooks/use-opencode-data"
import { useAgentActions } from "../hooks/use-server"
import type { FileAttachment } from "../lib/types"
import { getProjectClient } from "../services/connection-manager"
import { pickDirectory } from "../services/backend"
import { createWorktree, randomWorktreeName } from "../services/worktree-service"
import { useSetAppBarContent } from "./app-bar-context"
import { BranchPicker } from "./branch-picker"
import { PromptAttachmentPreview } from "./chat/prompt-attachments"
import { PromptToolbar, StatusBar } from "./chat/prompt-toolbar"
import { HrambleWordmark } from "./hramble-wordmark"
import { HrambleLogo } from "./hramble-logo"

// ============================================================
// Worktree mode toggle
// ============================================================

function WorktreeToggle({
	mode,
	onModeChange,
}: {
	mode: "local" | "worktree"
	onModeChange: (mode: "local" | "worktree") => void
}) {
	return (
		<div className="flex items-center rounded-md border border-border/40">
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={() => onModeChange("local")}
							className={`flex items-center gap-1 rounded-l-md px-1.5 py-0.5 text-[11px] transition-colors ${
								mode === "local"
									? "bg-muted/80 text-foreground"
									: "text-muted-foreground/60 hover:text-muted-foreground"
							}`}
						/>
					}
				>
					<MonitorIcon className="size-3" />
					<span>Local</span>
				</TooltipTrigger>
				<TooltipContent side="top">Run in your current working directory</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={() => onModeChange("worktree")}
							className={`flex items-center gap-1 rounded-r-md px-1.5 py-0.5 text-[11px] transition-colors ${
								mode === "worktree"
									? "bg-muted/80 text-foreground"
									: "text-muted-foreground/60 hover:text-muted-foreground"
							}`}
						/>
					}
				>
					<GitForkIcon className="size-3" />
					<span>Worktree</span>
				</TooltipTrigger>
				<TooltipContent side="top">
					Run in an isolated git worktree (your working copy stays untouched)
				</TooltipContent>
			</Tooltip>
		</div>
	)
}

// ============================================================
// Mention support helpers (mirrors the pattern in ChatInput)
// ============================================================

/**
 * Exposes the PromptInputProvider's text controller to outside components
 * via a ref — needed to insert mention text without going through React state.
 */
function MentionBridge({
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
 * Detects `@` trigger patterns in the prompt textarea and notifies the parent
 * so the MentionPopover can open/close and filter results.
 */
function MentionTrigger({
	onMentionChange,
}: {
	onMentionChange: (open: boolean, query: string) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value
	useEffect(() => {
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? inputText.length
		const textBeforeCursor = inputText.slice(0, cursorPos)
		const atMatch = textBeforeCursor.match(/@(\S*)$/)
		if (atMatch) {
			onMentionChange(true, atMatch[1])
			return
		}
		onMentionChange(false, "")
	}, [inputText, onMentionChange])
	return null
}

const SUGGESTIONS = [
	{
		icon: CodeIcon,
		text: "Build a new feature based on the existing patterns in this repo.",
	},
	{
		icon: FileTextIcon,
		text: "Summarize the architecture and key design decisions.",
	},
	{
		icon: GitPullRequestIcon,
		text: "Review recent changes and suggest improvements.",
	},
]

/**
 * Syncs PromptInputProvider text to persisted drafts (debounced).
 * Must be rendered inside a <PromptInputProvider>.
 */
function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

export function NewChat() {
	const { projectSlug } = useParams({ strict: false })
	const projects = useProjectList()
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()

	// Inject app name into the AppBar
	const setAppBarContent = useSetAppBarContent()
	useLayoutEffect(() => {
		setAppBarContent(
			<HrambleWordmark className="h-[11px] w-auto shrink-0 text-muted-foreground/70" />,
		)
		return () => setAppBarContent(null)
	}, [setAppBarContent])

	const [selectedDirectory, setSelectedDirectory] = useState<string>("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [worktreeMode, setWorktreeMode] = useState<"local" | "worktree">("local")

	// Hyperloop state — persisted in atom so navigating away (View) and back restores the run
	const [hyperRun, setHyperRun] = useAtom(hyperloopRunAtom)
	// Always show the persisted run regardless of directory — directory is used for launching only
	const hyperRunForDir = hyperRun
	const [hyperOpen, setHyperOpen] = useState(() => hyperRunForDir !== null)
	const [hyperGoal, setHyperGoal] = useState(() => hyperRunForDir?.goal ?? "")
	const [hyperDecomposing, setHyperDecomposing] = useState(false)
	// When true, the step column collapses into a compact on-page recap of what
	// each agent built (short paragraphs), so the user can see the result and
	// ask for small edits without the tall step column in the way.
	const [hyperCollapsed, setHyperCollapsed] = useState(false)
	// Index of the step currently being edited inline (null = none).
	const [editingStep, setEditingStep] = useState<number | null>(null)
	// Which recap paragraph is expanded to show its full details inline (null = none).
	const [expandedRecap, setExpandedRecap] = useState<number | null>(null)
	const hyperDecomposeAbort = useRef(false)
	const hyperScratchId = useRef<string | null>(null)
	const hyperSteps = hyperRunForDir?.steps ?? []
	const hyperRunning = hyperRunForDir?.running ?? false
	const setHyperSteps = (updater: HyperStep[] | ((prev: HyperStep[]) => HyperStep[])) =>
		setHyperRun((prev) => {
			const next = typeof updater === "function" ? updater(prev?.steps ?? []) : updater
			return prev ? { ...prev, steps: next } : { goal: hyperGoal, steps: next, running: false, directory: selectedDirectory }
		})
	const setHyperRunning = (running: boolean) =>
		setHyperRun((prev) => prev ? { ...prev, running } : null)
	// Reset stuck "running" flag on mount (in case app was closed mid-run)
	useEffect(() => {
		setHyperRun((prev) => prev ? { ...prev, running: false } : null)
	}, [])

	// Draft persistence — survives page reloads.
	// Non-reactive snapshot: the draft is only used for PromptInputProvider's
	// initialInput (consumed once on mount), so reactive tracking is unnecessary.
	const draft = useDraftSnapshot(NEW_CHAT_DRAFT_KEY)
	const { setDraft, clearDraft } = useDraftActions(NEW_CHAT_DRAFT_KEY)
	const [projectPickerOpen, setProjectPickerOpen] = useState(false)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)
	// Plan mode: think-first-then-act. Auto-on for local models (Ollama), where it
	// measurably lifts reliability; off for strong hosted models where it just
	// adds latency. The user can override, after which we stop auto-toggling.
	const [planMode, setPlanMode] = useState(false)
	const planModeTouched = useRef(false)
	const togglePlanMode = useCallback((v: boolean) => {
		planModeTouched.current = true
		setPlanMode(v)
	}, [])
	// Hyperloop is now a top-level workspace (Code | Hyperloop), not a composer
	// toggle. When the Hyperloop workspace is active, every new run is autonomous.
	const workspaceMode = useAtomValue(workspaceModeAtom)
	const hyperloop = workspaceMode === "hyperloop"
	// The Hyperloop panel (7 steps / recap) belongs to Hyperloop mode ONLY. In Code
	// mode there is never any Hyperloop UI, even if the panel was left open before.
	const hyperPanelOpen = hyperloop && hyperOpen

	// Permission mode (Plan / Manual / Accept Edits / Auto / Bypass) — cycles like
	// Claude's Shift+Tab. Applied as a session permission preset at creation.
	const chatMode = useAtomValue(chatModeAtom)
	const setChatMode = useSetAtom(chatModeAtom)
	const cycleMode = useCallback(() => {
		const i = CHAT_MODE_ORDER.indexOf(chatMode)
		setChatMode(CHAT_MODE_ORDER[(i + 1) % CHAT_MODE_ORDER.length])
	}, [chatMode, setChatMode])
	const modeSpec = CHAT_MODES[chatMode]

	// Mention popover state
	const [mentionOpen, setMentionOpen] = useState(false)
	const [mentionQuery, setMentionQuery] = useState("")
	const controllerRef = useRef<{ setText: (text: string) => void; getText: () => string } | null>(
		null,
	)
	const mentionPopoverRef = useRef<MentionPopoverHandle>(null)

	// Seed selectedModel, selectedVariant, and selectedAgent from the persisted
	// per-project preferences on first mount / project switch.
	// This puts the model at step 1 (user override) in resolveEffectiveModel, so it
	// wins over config.model and global recent list — matching the user's expectation
	// that the model they last used in this project sticks.
	const projectModels = useAtomValue(projectModelsAtom)
	const prevDirectoryRef = useRef<string>("")
	useEffect(() => {
		if (!selectedDirectory || selectedDirectory === prevDirectoryRef.current) return
		prevDirectoryRef.current = selectedDirectory
		const stored = projectModels[selectedDirectory]
		if (stored?.providerID && stored?.modelID) {
			setSelectedModel(stored)
			setSelectedVariant(stored.variant)
		} else {
			setSelectedModel(null)
			setSelectedVariant(undefined)
		}
		// Restore the per-project agent preference (null = use config default)
		setSelectedAgent(stored?.agent ?? null)
	}, [selectedDirectory, projectModels])

	const selectedProject = useMemo(
		() => projects.find((p) => p.directory === selectedDirectory),
		[projects, selectedDirectory],
	)

	// The current working folder — where the agent reads/writes files. Shown
	// prominently (like Claude Code needing a directory) so files never land in
	// a surprise location.
	const folderSegs = selectedDirectory.split("/").filter(Boolean)
	const folderName = selectedProject?.name || folderSegs.at(-1) || ""
	// A bad working dir: filesystem root or the user's home folder — files would
	// scatter there instead of a project folder.
	const badFolder =
		!selectedDirectory || selectedDirectory === "/" || (folderSegs.length <= 2 && folderSegs[0] === "Users")

	const chooseFolder = useCallback(async () => {
		const dir = await pickDirectory()
		if (dir) {
			setSelectedDirectory(dir)
			setProjectPickerOpen(false)
		}
	}, [])

	const { data: providers } = useProviders(selectedDirectory || null)
	const { data: config } = useConfig(selectedDirectory || null)
	const { data: vcs, reload: reloadVcs } = useVcs(selectedDirectory || null)
	const { agents: openCodeAgents } = useOpenCodeAgents(selectedDirectory || null)
	const { recentModels, addRecent: addRecentModel } = useModelState()

	// Handle model selection — set local state + persist to model.json.
	// Reset variant when the model changes: the new model may have different
	// (or no) variants, so carrying over a stale variant would be incorrect.
	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
			setSelectedVariant(undefined)
			if (model) addRecentModel(model)
		},
		[addRecentModel],
	)

	// Count active sessions on the selected directory (for branch switch warnings)
	const allAgents = useAgents()
	const activeSessionCount = useMemo(() => {
		if (!selectedDirectory) return 0
		return allAgents.filter(
			(a) =>
				a.directory === selectedDirectory && (a.status === "running" || a.status === "waiting"),
		).length
	}, [allAgents, selectedDirectory])

	// Callback when branch is switched via the BranchPicker — forces VCS reload
	const handleBranchChanged = useCallback(
		(_branch: string) => {
			// VCS hook polls every 30s, but we want immediate UI update.
			// The SSE vcs.branch.updated event will also fire eventually.
			reloadVcs()
		},
		[reloadVcs],
	)

	// Insert a selected mention into the prompt textarea
	const handleMentionSelect = useCallback((option: MentionOption) => {
		setMentionOpen(false)
		const ctrl = controllerRef.current
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
		requestAnimationFrame(() => {
			const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			if (ta) {
				ta.focus()
				ta.setSelectionRange(newCursor, newCursor)
			}
		})
	}, [])

	// Delegate keyboard events to the mention popover when it's open
	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (mentionPopoverRef.current?.handleKeyDown(e)) return
		},
		[],
	)

	// Resolve active agent for model resolution
	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	// Resolve effective model — selectedModel is seeded from the persisted project model
	// on mount/project switch (above), so it already wins at step 1 of the resolution chain.
	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
				recentModels,
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers, recentModels],
	)

	// Default to Build (plan off) for every model — plan is opt-in, not needed for
	// most tasks. Auto-planning for local models actually hurt them: the
	// plan→execute split confuses weaker models more than it helps. Stops once the
	// user flips the toggle themselves.
	useEffect(() => {
		if (planModeTouched.current) return
		setPlanMode(false)
	}, [effectiveModel])

	// Validate variant against the effective model's available variants.
	// Clears the variant if the current model doesn't support it (e.g. restored
	// from per-project preference but the model was changed, or provider updated).
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

	// Model input capabilities (for attachment warnings)
	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	useEffect(() => {
		if (projects.length === 0) return

		if (projectSlug) {
			const match = projects.find((p) => p.slug === projectSlug)
			if (match) {
				setSelectedDirectory(match.directory)
				return
			}
		}

		// Only set a default if nothing is selected yet — don't override the user's pick
		setSelectedDirectory((prev) => prev || projects[0].directory)
	}, [projectSlug, projects])

	// ---
	// Launch helpers
	// ---

	/** Persist the model + variant + agent for this project so new sessions remember it. */
	const persistProjectModel = useCallback(() => {
		if (!effectiveModel || !selectedDirectory) return
		appStore.set(setProjectModelAtom, {
			directory: selectedDirectory,
			model: {
				...effectiveModel,
				variant: selectedVariant,
				agent: selectedAgent ?? undefined,
			},
		})
	}, [effectiveModel, selectedDirectory, selectedVariant, selectedAgent])

	/** Navigate to the chat view for a given session. */
	const navigateToSession = useCallback(
		(sessionId: string) => {
			const dir = hyperRun?.directory || selectedDirectory
			const project = projects.find((p) => p.directory === dir)
			navigate({
				to: "/project/$projectSlug/session/$sessionId",
				params: {
					projectSlug: project?.slug ?? selectedDirectory.split("/").pop() ?? "unknown",
					sessionId,
				},
			})
		},
		[projects, selectedDirectory, hyperRun, navigate],
	)

	/** Launch a session in local mode (no worktree). */
	const launchLocal = useCallback(
		async (promptText: string, files?: FileAttachment[]) => {
			const session = await createSession(
				selectedDirectory,
				undefined,
				mergeSessionPermission(modeSpec.permission, selectedDirectory, appStore.get(permissionRulesAtom)),
			)
			if (!session) return

			// Tag Hyperloop runs so they show under the Hyperloop workspace only.
			if (hyperloop) markHyperloopSession(session.id)

			const currentBranch = vcs?.branch ?? ""
			if (currentBranch) {
				appStore.set(setSessionBranchAtom, { sessionId: session.id, branch: currentBranch })
			}

			persistProjectModel()

			await sendPrompt(selectedDirectory, session.id, promptText, {
				model: effectiveModel ?? undefined,
				// Plan mode forces the read-only `plan` agent; other modes keep the user's pick.
				agent: modeSpec.agent ?? selectedAgent ?? undefined,
				variant: selectedVariant,
				files,
				planMode,
				hyperloop,
			})
			clearDraft()
			navigateToSession(session.id)
		},
		[
			selectedDirectory,
			createSession,
			sendPrompt,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			planMode,
			hyperloop,
			modeSpec,
			clearDraft,
			persistProjectModel,
			navigateToSession,
			vcs,
		],
	)

	const hyperDecompose = async () => {
		if (!hyperGoal.trim() || !selectedDirectory) return
		const client = getProjectClient(selectedDirectory)
		if (!client) return
		hyperDecomposeAbort.current = false
		setHyperCollapsed(false)
		setHyperDecomposing(true)
		setHyperSteps([])
		try {
			const created = await client.session.create({ title: "Hyperloop plan", directory: selectedDirectory })
			const scratchId = created.data?.id
			if (!scratchId) return
			hyperScratchId.current = scratchId
			if (hyperDecomposeAbort.current) {
				await client.session.delete({ sessionID: scratchId, directory: selectedDirectory }).catch(() => {})
				return
			}
			await client.session.promptAsync({
				sessionID: scratchId,
				directory: selectedDirectory,
				parts: [
					{
						type: "text",
						text: `Break this goal into exactly 7 concrete implementation steps that can be worked on in PARALLEL by separate agents (each step touches different files/areas). Make each step a precise, self-contained instruction — include file names and what to do. At the end of each line add a realistic time estimate in the format [~X min].\n\nCRITICAL: All file paths MUST be RELATIVE to the current project folder (e.g. index.html, src/app.js, backend/server.js). NEVER use absolute paths, a leading slash, ~, or /tmp — never write files outside the project directory. Do NOT create a new top-level subfolder to hold the site; put files directly in the project root unless the goal clearly needs subfolders.\n\nReply ONLY as a numbered list (1., 2., …), one step per line. No preamble, no sub-bullets.\n\nExample line: 1. Create backend/server.js with Express setup [~5 min]\n\nGoal: ${hyperGoal}`,
					},
				],
				model: effectiveModel
					? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID }
					: undefined,
			})
			// Poll until the session finishes. Wait up to 2 min.
			// A finished session DROPS OUT of the status map (status is {}), so absence
			// means either "not started yet" or "already done". Track seenBusy to tell them apart:
			// once we've seen it busy, the next time it's absent it's genuinely finished.
			let seenBusy = false
			for (let i = 0; i < 120; i++) {
				if (hyperDecomposeAbort.current) break
				await new Promise((r) => setTimeout(r, 1000))
				const status = await client.session.status({ directory: selectedDirectory }).catch(() => null)
				const sessionStatus = (status?.data as Record<string, { type: string }> | null)?.[scratchId]
				if (sessionStatus?.type === "busy") { seenBusy = true; continue }
				if (seenBusy) break        // was working, now gone → done
				if (i >= 12) break         // never went busy after 12s → nothing to wait for
			}
			// Fetch the last assistant message
			const msgs = await client.session.messages({ sessionID: scratchId, directory: selectedDirectory }).catch(() => null)
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
			if (!hyperDecomposeAbort.current && parsed.length > 0) {
				setHyperRun({ goal: hyperGoal, steps: parsed.map((s) => ({ ...s, status: "idle" as const })), running: false, directory: selectedDirectory })
			}
			await client.session.delete({ sessionID: scratchId, directory: selectedDirectory }).catch(() => {})
		} finally {
			hyperScratchId.current = null
			setHyperDecomposing(false)
		}
	}

	// Fetch a short "what was done" summary (the agent's last assistant message)
	// for a completed step session. Used to build the collapsed on-page recap.
	const fetchStepSummary = async (
		client: NonNullable<ReturnType<typeof getProjectClient>>,
		sessionID: string,
		directory: string,
	): Promise<string> => {
		try {
			const msgs = await client.session.messages({ sessionID, directory }).catch(() => null)
			const arr =
				(msgs?.data as Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>) ?? []
			const last = [...arr].reverse().find((m) => m.info?.role === "assistant")
			return (last?.parts ?? [])
				.map((p) => (p.type === "text" ? p.text ?? "" : ""))
				.join(" ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 4000)
		} catch {
			return ""
		}
	}

	// Whether every step has finished (done or failed) — enables the recap collapse.
	const allStepsSettled =
		hyperSteps.length > 0 && hyperSteps.every((s) => s.status === "done" || s.status === "failed")

	// Collapse the tall step column into a compact on-page recap. Lazily fills in
	// summaries for any completed step that doesn't have one yet (e.g. an older run).
	const collapseToRecap = async () => {
		setHyperCollapsed(true)
		const dir = hyperRun?.directory || selectedDirectory
		const client = getProjectClient(dir)
		if (!client) return
		if (!hyperSteps.some((s) => s.sessionId && !s.preview)) return
		const summaries = await Promise.all(
			hyperSteps.map((s) => (s.preview || !s.sessionId ? Promise.resolve(s.preview ?? "") : fetchStepSummary(client, s.sessionId, dir))),
		)
		setHyperSteps((prev) => prev.map((s, j) => ({ ...s, preview: summaries[j] || s.preview })))
	}

	// Toggle a recap paragraph open/closed. When opening, if we only have a short
	// snippet, lazily pull the fuller detail from that step's session (best-effort).
	const toggleRecapDetail = async (i: number) => {
		const willExpand = expandedRecap !== i
		setExpandedRecap(willExpand ? i : null)
		if (!willExpand) return
		const step = hyperSteps[i]
		if (!step?.sessionId || (step.preview?.length ?? 0) >= 400) return
		const dir = hyperRun?.directory || selectedDirectory
		const client = getProjectClient(dir)
		if (!client) return
		const full = await fetchStepSummary(client, step.sessionId, dir)
		if (full && full.length > (step.preview?.length ?? 0)) {
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, preview: full } : s)))
		}
	}

	// Run (or re-run) a SINGLE step in its own fresh session — used by the per-step
	// "Run"/"Retry" buttons so the user can tweak one step without re-running all 7.
	const runSingleStep = async (i: number) => {
		const dir = hyperRun?.directory ?? selectedDirectory
		const client = getProjectClient(dir)
		const step = hyperSteps[i]
		if (!client || !step || !step.text.trim()) return
		setEditingStep(null)
		setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "running" as const } : s)))
		try {
			const r = await client.session.create({ title: `Hyperloop ${i + 1}: ${step.text.slice(0, 40)}`, directory: dir })
			const sid = r.data?.id
			if (!sid) throw new Error("no id")
			markHyperloopSession(sid)
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, sessionId: sid } : s)))
			await client.session.promptAsync({
				sessionID: sid,
				directory: dir,
				parts: [{ type: "text", text: step.text }],
				model: effectiveModel ? { providerID: effectiveModel.providerID, modelID: effectiveModel.modelID } : undefined,
			})
			let seenBusy = false
			for (let t = 0; t < 600; t++) {
				await new Promise((res) => setTimeout(res, 1000))
				const status = await client.session.status({ directory: dir }).catch(() => null)
				const st = (status?.data as Record<string, { type: string }> | null)?.[sid]
				if (st?.type === "busy") { seenBusy = true; continue }
				if (seenBusy) break
				if (t >= 12) break
			}
			const summary = await fetchStepSummary(client, sid, dir)
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "done" as const, preview: summary || s.preview } : s)))
		} catch {
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
		}
	}

	const hyperLaunchAll = async () => {
		if (!hyperSteps.length || !selectedDirectory) return
		setHyperCollapsed(false)
		const client = getProjectClient(selectedDirectory)
		if (!client) return
		setHyperRunning(true)

		// Create all 7 sessions with correct directory
		const sessionIds = await Promise.all(
			hyperSteps.map((s, i) =>
				client.session
					.create({ title: `Hyperloop ${i + 1}: ${s.text.slice(0, 40)}`, directory: selectedDirectory })
					.then((r) => r.data?.id ?? null)
					.catch(() => null),
			),
		)
		// Tag every step session as Hyperloop so it's hidden from the sidebar — the
		// user controls all 7 from the panel and never sees them as separate entries.
		for (const id of sessionIds) if (id) markHyperloopSession(id)
		setHyperSteps((prev) =>
			prev.map((s, i) => ({ ...s, status: "running" as const, sessionId: sessionIds[i] ?? undefined })),
		)

		// Fire all prompts with promptAsync (non-blocking fire-and-forget)
		// then poll each session status until idle
		const dir = selectedDirectory
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
				// Poll until session goes idle (max 10 min per step). A finished session drops
				// out of the status map, so track seenBusy: break as soon as it's been busy and
				// then disappears — instead of spinning the full timeout.
				let seenBusy = false
				for (let t = 0; t < 600; t++) {
					await new Promise((r) => setTimeout(r, 1000))
					const status = await client.session.status({ directory: dir }).catch(() => null)
					const st = (status?.data as Record<string, { type: string }> | null)?.[sid]
					if (st?.type === "busy") { seenBusy = true; continue }
					if (seenBusy) break        // was working, now gone → done
					if (t >= 12) break         // never went busy after 12s → nothing to wait for
				}
				// Grab a one-paragraph summary of what this agent actually did (its
				// last assistant message) so the collapsed recap can show it.
				const summary = await fetchStepSummary(client, sid, dir)
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "done" as const, preview: summary || s.preview } : s)))
			} catch {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
			}
		}

		// Run all 7 in parallel — promptAsync is non-blocking so no rate-limit pile-up
		await Promise.all(hyperSteps.map((_, i) => runOne(i)))
		setHyperRunning(false)
	}

	/**
	 * Launch a session in worktree mode.
	 *
	 * Creates a stub session immediately and navigates to the chat view so
	 * the user sees progress in the main content area instead of waiting
	 * on the new-chat screen. The actual worktree creation, real session
	 * creation, and prompt sending happen in the background.
	 */
	const launchWorktree = useCallback(
		(promptText: string, files?: FileAttachment[]) => {
			const sessionSlug = randomWorktreeName()

			// Create a stub session so the chat view can render immediately.
			const stubId = crypto.randomUUID()
			const now = Date.now()
			appStore.set(upsertSessionAtom, {
				session: {
					id: stubId,
					slug: sessionSlug,
					projectID: "",
					directory: selectedDirectory,
					title: "Setting up worktree...",
					version: "",
					time: { created: now, updated: now },
				},
				directory: selectedDirectory,
			})
			appStore.set(setSessionSetupPhaseAtom, {
				sessionId: stubId,
				setupPhase: "creating-worktree",
			})

			persistProjectModel()
			clearDraft()
			navigateToSession(stubId)

			// Background: create worktree -> create real session -> send prompt.
			// The chat view shows the setup phase while this runs.
			const run = async () => {
				try {
					// Phase 1: Create the worktree
					const result = await createWorktree(selectedDirectory, selectedDirectory, sessionSlug)
					const sdkDirectory = result.worktreeWorkspace

					// Phase 2: Create the real session
					appStore.set(setSessionSetupPhaseAtom, {
						sessionId: stubId,
						setupPhase: "starting-session",
					})
					const session = await createSession(
						sdkDirectory,
						undefined,
						mergeSessionPermission(modeSpec.permission, selectedDirectory, appStore.get(permissionRulesAtom)),
					)
					if (!session) {
						throw new Error("Failed to create session in worktree")
					}
					if (hyperloop) markHyperloopSession(session.id)

					// Replace the stub with the real session data. Override the
					// directory back to the parent so it groups correctly in the sidebar.
					appStore.set(upsertSessionAtom, {
						session,
						directory: selectedDirectory,
					})
					appStore.set(setSessionWorktreeAtom, {
						sessionId: session.id,
						worktreePath: result.worktreeRoot,
						worktreeBranch: result.branchName,
					})
					appStore.set(setSessionBranchAtom, {
						sessionId: session.id,
						branch: result.branchName,
					})

					// Navigate to the real session, then clean up the stub
					navigateToSession(session.id)
					appStore.set(removeSessionAtom, stubId)

					// Phase 3: Send the prompt
					await sendPrompt(sdkDirectory, session.id, promptText, {
						model: effectiveModel ?? undefined,
						agent: modeSpec.agent ?? selectedAgent ?? undefined,
						variant: selectedVariant,
						files,
						planMode,
						hyperloop,
					})
				} catch (err) {
					console.error("Worktree launch failed:", err)
					// Remove the stub and navigate back to new chat
					appStore.set(removeSessionAtom, stubId)
					setError(`Worktree setup failed: ${err instanceof Error ? err.message : "Unknown error"}`)
					navigate({ to: "/" })
				}
			}

			run()
		},
		[
			selectedDirectory,
			createSession,
			sendPrompt,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			planMode,
			hyperloop,
			modeSpec,
			clearDraft,
			persistProjectModel,
			navigateToSession,
			navigate,
		],
	)

	const handleLaunch = useCallback(
		async (promptText: string, files?: FileAttachment[]) => {
			if (!selectedDirectory || !promptText) return
			setLaunching(true)
			setError(null)
			try {
				if (worktreeMode === "worktree") {
					// Worktree mode navigates immediately and runs setup in the background.
					// The launching state is cleared right away since the chat view takes over.
					launchWorktree(promptText, files)
					setLaunching(false)
				} else {
					await launchLocal(promptText, files)
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create session")
			} finally {
				setLaunching(false)
			}
		},
		[selectedDirectory, worktreeMode, launchLocal, launchWorktree],
	)

	const hasToolbar = providers

	// Compact working-folder picker — lives in the bottom status bar (Claude-style),
	// not floating in the middle of the screen. Amber when the folder is unsafe.
	const folderPicker = (
		<Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						title={
							badFolder
								? "Choose a project folder — files would otherwise scatter in your home folder"
								: selectedDirectory
						}
						className={`flex items-center gap-1 transition-colors ${
							badFolder ? "text-amber-600 dark:text-amber-400" : "hover:text-foreground"
						}`}
					/>
				}
			>
				<FolderIcon className="size-3 shrink-0" />
				<span className="max-w-[160px] truncate">{folderName || "Choose a folder"}</span>
				<ChevronDownIcon className="size-3 shrink-0" />
			</PopoverTrigger>
			<PopoverContent className="w-72 p-1" align="start">
				{projects.map((p) => (
					<button
						key={p.directory}
						type="button"
						onClick={() => {
							setSelectedDirectory(p.directory)
							setProjectPickerOpen(false)
						}}
						className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
							p.directory === selectedDirectory
								? "bg-muted text-foreground"
								: "text-muted-foreground"
						}`}
					>
						<span className="truncate font-medium">{p.name}</span>
						<span className="ml-auto text-xs text-muted-foreground/60">{p.agentCount}</span>
					</button>
				))}
				<div className="my-1 border-border border-t" />
				<button
					type="button"
					onClick={chooseFolder}
					className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-primary text-sm transition-colors hover:bg-muted"
				>
					<FolderPlusIcon className="size-4" />
					Choose a folder…
				</button>
			</PopoverContent>
		</Popover>
	)

	return (
		<div className="relative flex h-full flex-col">
			{/* Hero area — vertically centered */}
			<div className="flex flex-1 flex-col items-center justify-center px-0 sm:px-6">
				<div className="w-full max-w-4xl space-y-8">
					{/* Brand logo — hidden once the Hyperloop panel is open */}
					{!hyperPanelOpen && (
						<div className="flex justify-center">
							<HrambleLogo />
						</div>
					)}

					{/* "Build what's next" + project name */}
					<div className="text-center">
						<h1 className="text-2xl font-semibold text-foreground">
							{hyperloop ? "Hyperloop" : "Build what's next"}
						</h1>
						{hyperloop && (
							<p className="mx-auto mt-2 max-w-md text-amber-600 text-sm dark:text-amber-400">
								Autonomous mode — give one task and it works round after round until it's done.
								Press Escape any time to stop.
							</p>
						)}
					</div>

					{/* Suggestion cards — hidden when Hyperloop panel is open */}
					{!hyperPanelOpen && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
						{SUGGESTIONS.map((suggestion) => {
							const Icon = suggestion.icon
							return (
								<button
									key={suggestion.text}
									type="button"
									onClick={() => handleLaunch(suggestion.text)}
									disabled={launching || !selectedDirectory}
									className="group/card flex flex-col gap-3 rounded-xl border border-border/50 bg-background/40 backdrop-blur-sm p-4 text-left transition-colors hover:border-muted-foreground/30 hover:bg-background/60 disabled:opacity-50"
								>
									<Icon className="size-5 text-muted-foreground transition-colors group-hover/card:text-foreground" />
									<p className="text-sm leading-snug text-muted-foreground transition-colors group-hover/card:text-foreground">
										{suggestion.text}
									</p>
								</button>
							)
						})}
					</div>}
				</div>
			</div>

			{/* Bottom-pinned input section */}
			<div className="shrink-0 px-0 pb-0 pt-0 sm:px-6 sm:pb-5 sm:pt-3">
				<div className="mx-auto w-full max-w-4xl">
					{/* Input card */}
					<PromptInputProvider key={NEW_CHAT_DRAFT_KEY} initialInput={draft}>
						<DraftSync setDraft={setDraft} />
						<MentionBridge controllerRef={controllerRef} />
						<MentionTrigger
							onMentionChange={(open, query) => {
								setMentionOpen(open)
								setMentionQuery(query)
							}}
						/>
						<div className="relative">
							<MentionPopover
								ref={mentionPopoverRef}
								query={mentionQuery}
								open={mentionOpen}
								directory={selectedDirectory || null}
								agents={openCodeAgents ?? []}
								onSelect={handleMentionSelect}
								onClose={() => setMentionOpen(false)}
							/>
							{hyperPanelOpen && (
								<div className="mb-2 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-primary/30 bg-muted/30 p-3">
									<div className="mb-2 flex items-center justify-between">
										<span className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
											<InfinityIcon className="size-3.5 text-primary" />
											{hyperCollapsed ? "Hyperloop — what was built" : "Hyperloop — 7 parallel agents"}
											{hyperRunning && (
												<span className="text-primary">
													· {hyperSteps.filter((s) => s.status === "done").length}/{hyperSteps.length} done
												</span>
											)}
										</span>
										<div className="flex items-center gap-1">
											{hyperSteps.length > 0 && !hyperRunning && (
												<button
													type="button"
													title="Start a brand-new 7 steps"
													onClick={() => {
														setHyperRun(null)
														setHyperCollapsed(false)
														setEditingStep(null)
													}}
													className="rounded p-0.5 text-muted-foreground hover:text-foreground"
												>
													<RotateCwIcon className="size-3.5" />
												</button>
											)}
											<button
												type="button"
												title={
													allStepsSettled && !hyperCollapsed
														? "Collapse into a recap of what was built"
														: "Close"
												}
												onClick={() => {
													if (allStepsSettled && !hyperCollapsed) {
														collapseToRecap()
													} else {
														setHyperOpen(false)
														setHyperCollapsed(false)
													}
												}}
												className="rounded p-0.5 text-muted-foreground hover:text-foreground"
											>
												<XIcon className="size-3.5" />
											</button>
										</div>
									</div>
									{hyperSteps.length === 0 && (
										<div className="flex gap-2">
											<input
												className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
												placeholder="Describe your goal — AI will split it into 7 parallel tasks…"
												value={hyperGoal}
												onChange={(e) => setHyperGoal(e.target.value)}
												onKeyDown={(e) => { if (e.key === "Enter") hyperDecompose() }}
												disabled={hyperDecomposing || !selectedDirectory}
											/>
										<button
											type="button"
											onClick={() => {
												if (hyperDecomposing) {
													hyperDecomposeAbort.current = true
													const client = getProjectClient(selectedDirectory)
													if (client && hyperScratchId.current) {
														client.session.abort({ sessionID: hyperScratchId.current }).catch(() => {})
													}
													setHyperDecomposing(false)
												} else {
													hyperDecompose()
												}
											}}
											disabled={!hyperDecomposing && (!hyperGoal.trim() || !selectedDirectory)}
											className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
										>
											{hyperDecomposing ? <InfinityIcon className="size-3.5 animate-spin" /> : "Decompose"}
										</button>
										</div>
									)}
									{hyperSteps.length > 0 && hyperCollapsed && (
										<div className="flex min-h-0 flex-1 flex-col gap-3">
											<p className="text-xs text-muted-foreground/70">
												Here's what each agent built — type below to request small changes, or open a
												step to edit just that one.
											</p>
											<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
											{hyperSteps.map((step, i) => (
												<div key={i} className="rounded-xl border border-border bg-muted/20 px-4 py-3.5">
													<div className="flex items-start gap-3">
														<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">
															{i + 1}
														</span>
														<div className="min-w-0 flex-1">
															{(() => {
																const full = step.preview || step.text
																const expanded = expandedRecap === i
																const long = full.length > 180
																const shown = expanded || !long ? full : `${full.slice(0, 180).trimEnd()}…`
																return (
																	<>
																		<p className={`text-sm leading-relaxed text-foreground/90 ${expanded ? "whitespace-pre-wrap" : ""}`}>{shown}</p>
																		<div className="mt-2 flex flex-wrap gap-2">
																			{long && (
																				<button type="button" onClick={() => toggleRecapDetail(i)} className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
																					{expanded ? "Show less" : "Show full details"}
																				</button>
																			)}
																		</div>
																	</>
																)
															})()}
														</div>
														{step.status === "done" ? (
															<CheckIcon className="size-4 shrink-0 text-green-500" />
														) : step.status === "failed" ? (
															<XIcon className="size-4 shrink-0 text-red-500" />
														) : null}
													</div>
												</div>
											))}
											</div>
											<button type="button" onClick={() => setHyperCollapsed(false)} className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
												Edit steps
											</button>
										</div>
									)}
									{hyperSteps.length > 0 && !hyperCollapsed && (
										<div className="flex min-h-0 flex-1 flex-col gap-1.5">
											<div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
											{hyperSteps.map((step, i) => {
													const isEditing = editingStep === i
													const isRunning = step.status === "running"
													return (
													<div key={i} className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs ${step.status === "done" ? "border-green-500/30 bg-green-500/5" : step.status === "failed" ? "border-red-500/30 bg-red-500/5" : isRunning ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
														<div className="flex items-start gap-2">
															<span className="mt-0.5 shrink-0 font-mono text-muted-foreground">{i + 1}</span>
															{isEditing ? (
																<textarea
																	value={step.text}
																	onChange={(e) => setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)))}
																	rows={3}
																	autoFocus
																	className="min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
																/>
															) : (
																<span className="min-w-0 flex-1">
																	<span className="block">{step.text}</span>
																	{step.timeEstimate && <span className="text-[10px] text-muted-foreground">{step.timeEstimate}</span>}
																</span>
															)}
															{isRunning && <InfinityIcon className="size-3.5 shrink-0 animate-spin text-primary" />}
															{!isRunning && step.status === "done" && <CheckIcon className="size-3.5 shrink-0 text-green-500" />}
															{!isRunning && step.status === "failed" && <XIcon className="size-3.5 shrink-0 text-red-500" />}
														</div>
														<div className="flex flex-wrap gap-1.5 pl-5">
															{!isRunning && !isEditing && (
																<button type="button" onClick={() => setEditingStep(i)} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><PencilIcon className="size-3" /> Edit</button>
															)}
															{!isRunning && (
																<button type="button" onClick={() => runSingleStep(i)} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"><PlayIcon className="size-3" /> {step.status === "done" || step.status === "failed" ? "Re-run" : "Run"} this step</button>
															)}
															{isEditing && (
																<button type="button" onClick={() => setEditingStep(null)} className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">Done</button>
															)}
															{isRunning && step.sessionId && (
																<button type="button" onClick={async () => {
																	const c2 = getProjectClient(hyperRun?.directory ?? selectedDirectory)
																	if (c2 && step.sessionId) {
																		await c2.session.abort({ sessionID: step.sessionId }).catch(() => {})
																		setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
																	}
																}} className="rounded px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-500/10">Stop</button>
															)}
														</div>
													</div>
													)
											})}
											</div>
											<div className="mt-1 flex gap-2">
												<button
													type="button"
													onClick={hyperLaunchAll}
													disabled={hyperRunning || !selectedDirectory}
													className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
												>
													{hyperRunning ? "Running…" : `Launch all ${hyperSteps.length}`}
												</button>
												<button type="button" onClick={() => { setHyperRun(null); setHyperCollapsed(false) }} disabled={hyperRunning} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
													Re-plan
												</button>
											</div>
										</div>
									)}
								</div>
							)}
						<PromptInput
							className="rounded-xl"
							accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
							multiple
							maxFileSize={10 * 1024 * 1024}
							onSubmit={(message) => {
								if (message.text.trim())
									handleLaunch(
										message.text.trim(),
										message.files.length > 0 ? message.files : undefined,
									)
							}}
						>
							<PromptAttachmentPreview
								supportsImages={modelCapabilities?.image}
								supportsPdf={modelCapabilities?.pdf}
							/>
							<PromptInputTextarea
								placeholder="What should this session work on?"
								autoFocus
								disabled={launching || !selectedDirectory || projects.length === 0}
								className="min-h-[80px]"
								onKeyDown={handleTextareaKeyDown}
							/>

							{/* Toolbar inside the card — agent + model + variant selectors */}
							{hasToolbar && (
								<PromptInputFooter>
									<PromptInputTools>
										{hyperloop && (
										<PromptInputButton
											title="Hyperloop — AI splits your goal into 7 parallel tasks"
											onClick={() => setHyperOpen((v) => !v)}
											className={hyperOpen || hyperSteps.length > 0 ? "text-primary" : ""}
										>
											<InfinityIcon className="size-4" />
										</PromptInputButton>
										)}
										<PromptToolbar
											agents={openCodeAgents ?? []}
											selectedAgent={selectedAgent}
											defaultAgent={config?.defaultAgent}
											onSelectAgent={setSelectedAgent}
											providers={providers}
											effectiveModel={effectiveModel}
											hasModelOverride={!!selectedModel}
											onSelectModel={handleModelSelect}
											recentModels={recentModels}
											selectedVariant={selectedVariant}
											onSelectVariant={setSelectedVariant}
											chatMode={chatMode}
											onCycleMode={cycleMode}
											planMode={planMode}
											onTogglePlanMode={togglePlanMode}
										/>
									</PromptInputTools>
								</PromptInputFooter>
							)}
						</PromptInput>
						</div>
					</PromptInputProvider>

					{/* Status bar — outside the card */}
					{/* Status bar — always shown so the folder picker (Claude-style, bottom-left) is reachable even before a folder is chosen */}
					<StatusBar
						vcs={vcs ?? null}
						isConnected={true}
						folderSlot={hyperPanelOpen ? undefined : folderPicker}
						branchSlot={
							selectedDirectory ? (
								<BranchPicker
									directory={selectedDirectory}
									currentBranch={vcs?.branch}
									onBranchChanged={handleBranchChanged}
									activeSessionCount={activeSessionCount}
								/>
							) : undefined
						}
						extraSlot={
							vcs ? (
								<WorktreeToggle mode={worktreeMode} onModeChange={setWorktreeMode} />
							) : undefined
						}
					/>

					{/* Error */}
					{error && (
						<div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
							{error}
						</div>
					)}

					{/* No projects warning */}
					{projects.length === 0 && (
						<p className="mt-2 text-center text-xs text-muted-foreground">
							No projects found. Check that projects exist in ~/.local/share/opencode/storage/.
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
