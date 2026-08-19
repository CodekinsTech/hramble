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
	FolderIcon,
	FolderPlusIcon,
	GitForkIcon,
	InfinityIcon,
	ListIcon,
	ListOrderedIcon,
	MonitorIcon,
	MoonIcon,
	NetworkIcon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	RotateCwIcon,
	Share2Icon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CodebaseGraph } from "./codebase-graph"
import { readOllamaBaseURL } from "../lib/ollama"
import { Semaphore } from "../lib/semaphore"
import { projectModelsAtom, setProjectModelAtom } from "../atoms/preferences"
import {
	removeSessionAtom,
	setSessionBranchAtom,
	setSessionSetupPhaseAtom,
	setSessionWorktreeAtom,
	upsertSessionAtom,
} from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { CHAT_MODES, chatModeAtom } from "../atoms/chat-mode"
import { engineConnectedAtom } from "../atoms/engine"
import { pendingSessionStepsAtom } from "../atoms/chat"
import { mergeSessionPermission, permissionRulesAtom } from "../atoms/permission-rules"
import { interruptedWorkAtom, resolveInterruptedItemAtom } from "../atoms/sleep-recovery"
import {
	HYPER_LOOP_SIZE,
	HYPER_MAX_STEPS,
	type HyperStep,
	hyperloopRunAtom,
	markHyperloopSession,
	pendingHyperGoalAtom,
	upsertHyperloopRun,
	workspaceModeAtom,
} from "../atoms/workspace"
import { type GraphNodeStatus, graphViewAtom, recordGraph } from "../atoms/graph"
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
import {
	createEngineSession,
	deleteEngineSession,
	abortEngineSession,
	getEngineSession,
	getEngineSessionDiff,
	sendEnginePrompt,
	waitForEngineSessionIdle,
} from "../services/engine-client"
import { mapEngineMessagesToEntries, type EngineMessage } from "../services/engine-history"
import { pickDirectory } from "../services/backend"
import { createWorktree, randomWorktreeName } from "../services/worktree-service"
import { useSetAppBarContent } from "./app-bar-context"
import { BranchPicker } from "./branch-picker"
import { PromptAttachmentPreview } from "./chat/prompt-attachments"
import { PromptToolbar, StatusBar } from "./chat/prompt-toolbar"
import { HrambleLogo } from "./hramble-logo"
import { BrainSessionSummary } from "./brain-session-summary"
import { FloatingPanel } from "./floating-panel"
import { GraphView } from "./graph-view"
import { HyperloopSpinner } from "./hyperloop-spinner"

// ============================================================
// Engine helpers (Hyperloop runs on the xot engine)
// ============================================================

/** Engine model ref from the UI's selected model (empty apiKey → engine uses its env keys). */
function engineModelOf(m: { providerID: string; modelID: string } | null | undefined) {
	if (!m) return undefined
	// Local/LAN Ollama: point the engine at the user's server (Settings → General).
	if (m.providerID === "ollama") {
		const baseURL = readOllamaBaseURL()
		return { provider: m.providerID, model: m.modelID, apiKey: "", ...(baseURL ? { baseURL } : {}) }
	}
	return { provider: m.providerID, model: m.modelID, apiKey: "" }
}

/** Engine transcript entries for a session (info + parts), newest last. */
async function engineEntries(sessionId: string): Promise<Array<{ info: { role: string }; parts: unknown[] }>> {
	const es = await getEngineSession(sessionId).catch(() => null)
	return mapEngineMessagesToEntries((es?.messages ?? []) as EngineMessage[]) as unknown as Array<{
		info: { role: string }
		parts: unknown[]
	}>
}

/** Concatenated text of a session's last assistant message. */
async function engineLastAssistantText(sessionId: string): Promise<string> {
	const entries = await engineEntries(sessionId)
	const last = [...entries].reverse().find((m) => m.info?.role === "assistant")
	return ((last?.parts ?? []) as Array<{ type: string; text?: string }>)
		.map((p) => (p.type === "text" ? (p.text ?? "") : ""))
		.join("\n")
}

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

// Global across every Hyperloop run in the app (not per-run) — otherwise 3
// overlapping runs would each get their own "cap of 5" and still add up to 15
// concurrent step-sessions. A local model can't really parallelize generation
// requests (it serializes them internally anyway, or chokes holding multiple
// contexts in memory), so it gets a hard limit of 1. A hosted model can handle
// real concurrency but still has real rate limits, so it gets a bounded cap
// rather than "all at once."
const hyperSequentialGate = new Semaphore(1)
const hyperConcurrentGate = new Semaphore(5)

// Appended to every step's task text so each step ends its own reply with a
// short, plain summary — the same "what changed, what's next" convention used
// for end-of-turn summaries — instead of leaving the recap to fall back on
// whatever the last message happened to be.
const STEP_SUMMARY_INSTRUCTION =
	"\n\nWhen you're done, end your reply with a short summary in plain language — one or two sentences, what changed and what's next. Nothing else after that."

export function NewChat() {
	const { projectSlug } = useParams({ strict: false })
	const projects = useProjectList()
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()

	// App name in the AppBar — removed from the header for now.
	const setAppBarContent = useSetAppBarContent()
	useLayoutEffect(() => {
		setAppBarContent(null)
		return () => setAppBarContent(null)
	}, [setAppBarContent])

	const [selectedDirectory, setSelectedDirectory] = useState<string>("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [worktreeMode, setWorktreeMode] = useState<"local" | "worktree">("local")
	// The engine doesn't support git worktrees yet, so hide the toggle on the
	// engine path — sessions run in the project directory (local mode).
	const engineConnected = useAtomValue(engineConnectedAtom)

	// Hyperloop state — persisted in atom so navigating away (View) and back restores the run
	const [hyperRun, setHyperRun] = useAtom(hyperloopRunAtom)
	// Always show the persisted run regardless of directory — directory is used for launching only
	const hyperRunForDir = hyperRun

	// Sleep/wake recovery — surfaced only when the currently-open run is the one that got interrupted.
	const interruptedWork = useAtomValue(interruptedWorkAtom)
	const resolveInterruptedItem = useSetAtom(resolveInterruptedItemAtom)
	const interruptedHyperloopItem = interruptedWork.find(
		(item) => item.kind === "hyperloop" && hyperRun && item.id === (hyperRun.id ?? hyperRun.goal),
	)
	const [hyperOpen, setHyperOpen] = useState(() => hyperRunForDir !== null)
	const [hyperGoal, setHyperGoal] = useState(() => hyperRunForDir?.goal ?? "")
	const [hyperDecomposing, setHyperDecomposing] = useState(false)
	// Pick up a goal handed off from the Templates page (e.g. the "Browser Game"
	// card) — Hyperloop's own goal box is local state, not the shared draft, so
	// it needs this one-time atom handoff instead of the usual draft mechanism.
	const [pendingHyperGoal, setPendingHyperGoal] = useAtom(pendingHyperGoalAtom)
	useEffect(() => {
		if (pendingHyperGoal && !hyperRunForDir) {
			setHyperGoal(pendingHyperGoal)
			setHyperOpen(true)
			setPendingHyperGoal(null)
		}
		// Only meant to run once per handoff — deliberately not depending on hyperRunForDir.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingHyperGoal])
	// When true, the step column collapses into a compact on-page recap of what
	// each agent built (short paragraphs), so the user can see the result and
	// ask for small edits without the tall step column in the way.
	const [hyperCollapsed, setHyperCollapsed] = useState(false)
	// Index of the step currently being edited inline (null = none).
	const [editingStep, setEditingStep] = useState<number | null>(null)
	// Interactive codebase graph overlay — separate from the Hyperloop work-graph
	// view (that one's the agent's process; this one's the code's structure).
	const [showCodebaseGraph, setShowCodebaseGraph] = useState(false)
	// "Run one at a time" — user picked manual pacing instead of "Launch all"
	// (which fires every step in parallel). In this mode nothing auto-chains:
	// each step only starts when the user clicks its own Run button.
	const [manualQueueMode, setManualQueueMode] = useState(false)
	// Session IDs the user manually Stopped — checked by runStepUntilVerified so
	// a deliberate stop is never mistaken for a mechanical failure and auto-retried.
	const manuallyStoppedRef = useRef<Set<string>>(new Set())

	// Sequential steps panel (mirrors chat-view's 7-step queue)
	const STEP_COUNT = 7
	const [stepsOpen, setStepsOpen] = useState(false)
	const [steps, setSteps] = useState<string[]>(() => Array(STEP_COUNT).fill(""))
	const hasSteps = steps.some((s) => s.trim())
	const setPendingSessionSteps = useSetAtom(pendingSessionStepsAtom)

	// Which recap paragraph is expanded to show its full details inline (null = none).
	const [expandedRecap, setExpandedRecap] = useState<number | null>(null)
	// hyperRun is deliberately persisted across navigation (see above), but this
	// component itself isn't remounted just by navigating to "/" while already
	// there — so when something clears the run (e.g. sidebar's "New Session"),
	// the local UI-only state below needs an explicit reset to actually show a
	// blank slate instead of quietly keeping the old panel open/expanded.
	useEffect(() => {
		if (!hyperRun) {
			setHyperOpen(false)
			setHyperGoal("")
			setHyperCollapsed(false)
			setEditingStep(null)
			setManualQueueMode(false)
			setExpandedRecap(null)
			return
		}
		// Switching to a genuinely different run (e.g. clicking a different
		// Hyperloop session in the sidebar) must also drop leftover view state
		// from whichever run was open before — otherwise an already-collapsed
		// recap, an expanded paragraph index, or an editing-step index from the
		// OLD run silently carries over and can point at nothing meaningful in
		// the new one (this was why closing a freshly-opened run sometimes just
		// hid the panel instead of showing its recap).
		setHyperOpen(true)
		setHyperCollapsed(false)
		setEditingStep(null)
		setExpandedRecap(null)
		setManualQueueMode(false)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hyperRun?.id])
	// List ⇄ Graph view toggle for the Hyperloop panel (the graph is a VIEW, not a mode).
	const [graphView, setGraphView] = useAtom(graphViewAtom)
	// Mirror the Hyperloop run into the work-graph store (.hramble/graph) so the
	// Graph view can draw it: a command node + one node per step, keyed by the run
	// id. The store folds repeat events by id, so re-writing on each change is cheap.
	useEffect(() => {
		const run = hyperRunForDir
		if (!run?.id || !run.steps.length) return
		const dir = run.directory || selectedDirectory
		if (!dir || dir === "/") return
		const runId = run.id
		const map: Record<HyperStep["status"], GraphNodeStatus> = {
			idle: "queued",
			running: "working",
			repairing: "repair",
			done: "done",
			failed: "failed",
		}
		void recordGraph(dir, runId, {
			id: "cmd",
			kind: "command",
			title: run.goal,
			status: run.running ? "working" : "done",
		})
		run.steps.forEach((s, i) => {
			const files = s.files ?? []
			// File-overlap edges: reference every EARLIER step that touched a file this
			// step also touched (one edge per pair). Turns the flat step column into a
			// real relationship graph — steps sharing files are likely coupled/conflicting.
			const refs: string[] = []
			for (let j = 0; j < i; j++) {
				const other = run.steps[j].files ?? []
				if (other.length && files.some((f) => other.includes(f))) refs.push(`s${j}`)
			}
			void recordGraph(dir, runId, {
				id: `s${i}`,
				parent: "cmd",
				kind: "implement",
				title: s.text.slice(0, 60),
				status: map[s.status],
				summary: s.preview,
				files: files.length ? files : undefined,
				refs: refs.length ? refs : undefined,
			})
		})
		// Keep the run in the Hyperloop history (one entry per run) so the sidebar
		// can list it — reopening it just restores this object into hyperloopRunAtom.
		upsertHyperloopRun(run)
	}, [hyperRunForDir, selectedDirectory])
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
			if (hasSteps) {
				setPendingSessionSteps((prev) => ({ ...prev, [session.id]: { steps: [...steps], autoRun: false } }))
				setSteps(Array(STEP_COUNT).fill(""))
				setStepsOpen(false)
			}
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
			hasSteps,
			steps,
			setPendingSessionSteps,
			navigateToSession,
			vcs,
		],
	)

	// "Run all steps" from the new-chat panel — creates a session using the first
	// non-empty step as the initial prompt, hands the full list to chat-view with
	// autoRun=true so it starts executing immediately without a separate click.
	const runStepsFromNew = useCallback(async () => {
		const filled = steps.filter((s) => s.trim())
		if (!filled.length || badFolder || launching) return
		setLaunching(true)
		setError(null)
		try {
			const session = await createSession(
				selectedDirectory,
				undefined,
				mergeSessionPermission(modeSpec.permission, selectedDirectory, appStore.get(permissionRulesAtom)),
			)
			if (!session) return
			if (hyperloop) markHyperloopSession(session.id)
			const currentBranch = vcs?.branch ?? ""
			if (currentBranch) appStore.set(setSessionBranchAtom, { sessionId: session.id, branch: currentBranch })
			persistProjectModel()
			clearDraft()
			setPendingSessionSteps((prev) => ({
				...prev,
				[session.id]: { steps: [...steps], autoRun: true },
			}))
			setSteps(Array(STEP_COUNT).fill(""))
			setStepsOpen(false)
			navigateToSession(session.id)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start steps")
		} finally {
			setLaunching(false)
		}
	}, [
		steps,
		badFolder,
		launching,
		selectedDirectory,
		createSession,
		modeSpec,
		hyperloop,
		vcs,
		persistProjectModel,
		clearDraft,
		setPendingSessionSteps,
		navigateToSession,
	])

	const hyperDecompose = async () => {
		if (!hyperGoal.trim() || badFolder) return
		hyperDecomposeAbort.current = false
		setHyperCollapsed(false)
		setHyperDecomposing(true)
		setHyperSteps([])
		setManualQueueMode(false)
		let scratchId: string | undefined
		try {
			const created = await createEngineSession(selectedDirectory, "Hyperloop plan")
			scratchId = created.id
			hyperScratchId.current = scratchId
			if (hyperDecomposeAbort.current) return
			await sendEnginePrompt(
				scratchId,
				`First, in ONE short sentence, judge whether this goal is a small, medium, or large task and say roughly how many implementation steps it needs — for example "This is a medium task — I'll use 9 steps across 2 loops of 7." A loop holds ${HYPER_LOOP_SIZE} steps; use as many loops as the task genuinely needs, up to ${HYPER_MAX_STEPS} steps total. Do NOT pad or force a specific count — use exactly as many steps as the task needs.\n\nThen on a new line, list the steps as a numbered list (1., 2., …), one step per line. Make each step a precise, self-contained instruction that can be worked on in PARALLEL by separate agents (each step touches different files/areas) — include file names and what to do. At the end of each step line add a realistic time estimate in the format [~X min].\n\nCRITICAL: All file paths MUST be RELATIVE to the current project folder (e.g. index.html, src/app.js, backend/server.js). NEVER use absolute paths, a leading slash, ~, or /tmp — never write files outside the project directory. Do NOT create a new top-level subfolder to hold the site; put files directly in the project root unless the goal clearly needs subfolders.\n\nNo preamble besides that one sizing sentence, no sub-bullets.\n\nExample:\nThis is a small task — I'll use 4 steps.\n1. Create backend/server.js with Express setup [~5 min]\n\nGoal: ${hyperGoal}`,
				engineModelOf(effectiveModel),
				// Plan mode: read-only, so the model answers with the step list instead
				// of starting to implement (and can't mutate the real project).
				{ agent: "plan" },
			)
			await waitForEngineSessionIdle(scratchId, { shouldStop: () => hyperDecomposeAbort.current })
			const text = await engineLastAssistantText(scratchId)
			const lines = text.split("\n")
			const firstNumberedIdx = lines.findIndex((l) => /^\s*\d+[.)]\s+/.test(l))
			// Everything before the first numbered line is the AI's sizing sentence
			// ("This is a medium task — I'll use 9 steps across 2 loops.").
			const sizingNote = (firstNumberedIdx > 0 ? lines.slice(0, firstNumberedIdx) : [])
				.join(" ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 240)
			const parsed = lines
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
				.slice(0, HYPER_MAX_STEPS)
			if (!hyperDecomposeAbort.current && parsed.length > 0) {
				setHyperRun({
					id: crypto.randomUUID(),
					goal: hyperGoal,
					steps: parsed.map((s) => ({ ...s, status: "idle" as const })),
					running: false,
					directory: selectedDirectory,
					sizingNote: sizingNote || undefined,
				})
			}
		} finally {
			if (scratchId) await deleteEngineSession(scratchId).catch(() => {})
			hyperScratchId.current = null
			setHyperDecomposing(false)
		}
	}

	// Fetch a short "what was done" summary (the agent's last assistant message)
	// for a completed step session. Used to build the collapsed on-page recap.
	const fetchStepSummary = async (sessionID: string): Promise<string> => {
		try {
			return (await engineLastAssistantText(sessionID)).replace(/\s+/g, " ").trim().slice(0, 4000)
		} catch {
			return ""
		}
	}

	// Max automatic retries when a step fails verification, before giving up and
	// surfacing it as "failed" instead of silently accepting a broken result.
	const MAX_REPAIR_ATTEMPTS = 2

	/**
	 * Objectively check whether a step actually did something, instead of trusting
	 * "the session went idle" (which is all Hyperloop checked before — a run could
	 * finish with every step reporting "done" while nothing was ever built. See the
	 * "miss cafe" audit: step 1's whole reply was literal text printing a fake
	 * `<function=write>` call — no real tool call at all — and several other steps
	 * hit `Model tried to call unavailable tool 'explore'`, yet all were marked done).
	 *
	 * This can only catch MECHANICAL failures (no tool call happened / a tool
	 * errored / a hallucinated tool was attempted) — it cannot judge whether the
	 * result is actually what the user wanted. That's a real, permanent limit of
	 * automated verification, not a gap in this check.
	 */
	const verifyStepMessages = async (sessionID: string): Promise<{ ok: boolean; reason?: string }> => {
		try {
			const entries = await engineEntries(sessionID)
			type ToolPart = { type: string; tool?: string; state?: { status?: string; output?: string; error?: string } }
			const toolParts = entries.flatMap((m) => (m.parts ?? []) as ToolPart[]).filter((p) => p.type === "tool")

			if (toolParts.length === 0) {
				return { ok: false, reason: "No tool call was made — the model replied with text instead of doing the work" }
			}
			// A tool the engine couldn't run (unknown tool / no result) is recorded as
			// an errored tool part — that covers hallucinated tool calls too.
			const errored = toolParts.find((p) => p.state?.status === "error")
			if (errored) {
				return { ok: false, reason: `${errored.tool} failed: ${(errored.state?.error || "").slice(0, 250)}` }
			}
			return { ok: true }
		} catch {
			// Can't verify (engine hiccup, etc.) — don't punish the step for our own fetch failure.
			return { ok: true }
		}
	}

	/**
	 * Run a step's prompt, wait for it to finish, then verify it actually did
	 * something real before accepting "done". On a mechanical failure, retry in
	 * the SAME session (so the model sees its own error) with the failure fed
	 * back, up to MAX_REPAIR_ATTEMPTS — this is the self-repair loop.
	 */
	const runStepUntilVerified = async (
		i: number,
		sid: string,
		promptText: string,
		attempt: number,
	): Promise<void> => {
		// Small/local models can't really run multiple generations at once (they
		// serialize internally, or choke holding several contexts in memory) — so
		// they get a hard queue of 1. Hosted models get real concurrency, capped
		// rather than unbounded so a burst of steps/runs doesn't trip rate limits.
		const isLocalModel = effectiveModel?.providerID === "ollama"
		const gate = isLocalModel ? hyperSequentialGate : hyperConcurrentGate
		const release = await gate.acquire()
		try {
			await sendEnginePrompt(sid, `${promptText}${STEP_SUMMARY_INSTRUCTION}`, engineModelOf(effectiveModel))
			// Wait for the background run to finish; bail early if the user Stops it.
			await waitForEngineSessionIdle(sid, { shouldStop: () => manuallyStoppedRef.current.has(sid) })
		} finally {
			release()
		}

		// A step the user deliberately Stopped is not a mechanical failure — skip
		// verify/repair entirely so it never gets silently auto-retried behind
		// their back. It stays exactly as the Stop button left it (status "failed",
		// Edit + Run still available) until they choose to re-run it.
		if (manuallyStoppedRef.current.has(sid)) {
			manuallyStoppedRef.current.delete(sid)
			return
		}

		const verdict = await verifyStepMessages(sid)
		const summary = await fetchStepSummary(sid)

		if (verdict.ok) {
			// Record the files this step changed so the work graph can show a real
			// file count and draw file-overlap edges between steps.
			const files = (await getEngineSessionDiff(sid).catch(() => [])).map((d) => d.path)
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "done" as const, preview: summary || s.preview, files } : s)))
			return
		}
		if (attempt < MAX_REPAIR_ATTEMPTS) {
			setHyperSteps((prev) =>
				prev.map((s, j) => (j === i ? { ...s, status: "repairing" as const, preview: `Retrying — ${verdict.reason}` } : s)),
			)
			const corrective = `Your previous attempt did not succeed: ${verdict.reason}\n\nRetry the task below. Only use tools that actually exist in this environment — if a tool call fails because the tool doesn't exist, don't try it again, use a different real tool (e.g. read, write, edit, patch, bash, grep, glob) instead. Make sure to actually call a tool rather than just describing what you would do.\n\nTask: ${promptText}`
			return runStepUntilVerified(i, sid, corrective, attempt + 1)
		}
		setHyperSteps((prev) =>
			prev.map((s, j) =>
				j === i ? { ...s, status: "failed" as const, preview: `Failed after ${attempt + 1} attempts — ${verdict.reason}` } : s,
			),
		)
	}

	// Whether every REAL step has finished (done or failed) — enables the recap
	// collapse. An empty, never-filled-in idle slot (from clicking "add a step"
	// without typing anything into it) isn't a pending task — it must not block
	// the recap forever, so it's excluded here.
	const allStepsSettled =
		hyperSteps.length > 0 &&
		hyperSteps
			.filter((s) => s.text.trim() || s.status !== "idle")
			.every((s) => s.status === "done" || s.status === "failed")
	// "Launch all" only makes sense before anything has started — once any step is
	// running/done/failed, re-launching would redo the whole run. So gate on it.
	const hyperNotLaunched = hyperSteps.length > 0 && hyperSteps.every((s) => s.status === "idle")
	// How many loops of HYPER_LOOP_SIZE this plan spans ("twin loop" = 2, etc.) —
	// a small plan uses fewer than one loop's worth of slots; the rest render empty.
	const hyperLoopCount = Math.max(1, Math.ceil(hyperSteps.length / HYPER_LOOP_SIZE))
	// Multi-loop plans need the user to pick simultaneous vs sequential before
	// Launch is available — see the picker rendered in the panel below.
	const hyperNeedsRunModeChoice = hyperLoopCount > 1 && !hyperRun?.runMode
	const setHyperRunMode = (mode: "simultaneous" | "sequential") =>
		setHyperRun((prev) => (prev ? { ...prev, runMode: mode } : prev))
	// In "run one at a time" mode, nothing auto-chains — so once a step settles,
	// highlight the next idle one's Run button instead of guessing what's next.
	const nextManualStepIndex = manualQueueMode ? hyperSteps.findIndex((s) => s.status === "idle") : -1

	// Collapse the tall step column into a compact on-page recap. Lazily fills in
	// summaries for any completed step that doesn't have one yet (e.g. an older run).
	const collapseToRecap = async () => {
		setHyperCollapsed(true)
		// Graph view is a separate, persisted display toggle — if it was ever
		// turned on (even for a different run), it would win over the recap
		// below (`hyperCollapsed && !graphView`), leaving the user staring at a
		// graph for a run that may not resolve a valid session, instead of the
		// summary they just asked to see.
		setGraphView(false)
		// Everything below is best-effort background enrichment — the recap
		// itself is already showing (hyperCollapsed is true) and falls back to
		// each step's plain `text` when there's no `preview` yet, so a failure
		// here must never be allowed to look like the recap itself failed.
		try {
			if (!hyperSteps.some((s) => s.sessionId && !s.preview)) return
			const summaries = await Promise.all(
				hyperSteps.map((s) =>
					s.preview || !s.sessionId ? Promise.resolve(s.preview ?? "") : fetchStepSummary(s.sessionId),
				),
			)
			setHyperSteps((prev) => prev.map((s, j) => ({ ...s, preview: summaries[j] || s.preview })))
		} catch (err) {
			console.error("[hyperloop] recap summary fetch failed (non-fatal, recap still shows plain step text)", err)
		}
	}

	// Toggle a recap paragraph open/closed. When opening, if we only have a short
	// snippet, lazily pull the fuller detail from that step's session (best-effort).
	const toggleRecapDetail = async (i: number) => {
		const willExpand = expandedRecap !== i
		setExpandedRecap(willExpand ? i : null)
		if (!willExpand) return
		const step = hyperSteps[i]
		if (!step?.sessionId || (step.preview?.length ?? 0) >= 400) return
		const full = await fetchStepSummary(step.sessionId)
		if (full && full.length > (step.preview?.length ?? 0)) {
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, preview: full } : s)))
		}
	}

	// Expand one "unused slot" into a real, editable step — lets the user add
	// forgotten work to an already-running or already-finished plan without
	// re-planning everything. The new step runs independently via the existing
	// per-step "Run this step" button (same as re-running any other step); it
	// never re-triggers the original "Launch all" batch.
	const addHyperStep = () => {
		if (hyperSteps.length >= HYPER_MAX_STEPS) return
		const newIndex = hyperSteps.length
		setHyperSteps((prev) => [...prev, { text: "", status: "idle" as const }])
		setEditingStep(newIndex)
	}

	// Run (or re-run) a SINGLE step in its own fresh session — used by the per-step
	// "Run"/"Retry" buttons so the user can tweak one step without re-running all 7.
	const runSingleStep = async (i: number) => {
		const dir = hyperRun?.directory ?? selectedDirectory
		if (!dir || dir === "/" || dir.length <= 1) return
		const step = hyperSteps[i]
		if (!step || !step.text.trim()) return
		setEditingStep(null)
		setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "running" as const } : s)))
		try {
			const created = await createEngineSession(dir, `Hyperloop ${i + 1}: ${step.text.slice(0, 40)}`)
			const sid = created.id
			markHyperloopSession(sid)
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, sessionId: sid } : s)))
			// Running this step alone (a re-run, or a step added after the original
			// plan) means it wasn't decomposed alongside the others. Instead of just
			// telling it to "go check files", hand it the REAL summaries of what the
			// other steps already built — actual grounding, not a hope it explores well.
			const doneContext = hyperSteps
				.filter((s, j) => j !== i && s.status === "done" && s.preview)
				.map((s, j) => `- Step ${j + 1} (already done): ${s.text} — ${s.preview?.slice(0, 300)}`)
				.join("\n")
			const prompt = doneContext
				? `Other steps already completed in this project:\n${doneContext}\n\nBuild on that existing work — don't recreate it. Your task:\n${step.text}`
				: step.text
			await runStepUntilVerified(i, sid, prompt, 0)
		} catch {
			setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
		}
	}

	const hyperLaunchAll = async () => {
		if (!hyperSteps.length || badFolder || hyperNeedsRunModeChoice) return
		setHyperCollapsed(false)
		setHyperRunning(true)

		// Create all 7 sessions with correct directory
		const sessionIds = await Promise.all(
			hyperSteps.map((s, i) =>
				createEngineSession(selectedDirectory, `Hyperloop ${i + 1}: ${s.text.slice(0, 40)}`)
					.then((r) => r.id)
					.catch(() => null),
			),
		)
		// Tag every step session as Hyperloop so it's hidden from the sidebar — the
		// user controls all 7 from the panel and never sees them as separate entries.
		for (const id of sessionIds) if (id) markHyperloopSession(id)
		setHyperSteps((prev) =>
			prev.map((s, i) => ({ ...s, status: "running" as const, sessionId: sessionIds[i] ?? undefined })),
		)

		// Each step runs in its own session: prompt (fire-and-forget) then await idle,
		// with the mechanical verify + self-repair loop inside runStepUntilVerified.
		const runOne = async (i: number) => {
			const sid = sessionIds[i]
			const step = hyperSteps[i]
			if (!sid || !step) {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
				return
			}
			try {
				await runStepUntilVerified(i, sid, step.text, 0)
			} catch {
				setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
			}
		}

		if (hyperLoopCount > 1 && hyperRun?.runMode === "sequential") {
			// One loop at a time: parallel WITHIN a loop, sequential BETWEEN loops —
			// the user's choice for big plans, matching "sequential passes beat
			// parallel fan-out" for reducing cross-step conflicts.
			for (let loop = 0; loop < hyperLoopCount; loop++) {
				const start = loop * HYPER_LOOP_SIZE
				const end = Math.min(start + HYPER_LOOP_SIZE, hyperSteps.length)
				const indices = Array.from({ length: end - start }, (_, k) => start + k)
				await Promise.all(indices.map((i) => runOne(i)))
			}
		} else {
			// Single loop, or multi-loop running simultaneously — all at once.
			// promptAsync is non-blocking so this doesn't pile up rate limits.
			await Promise.all(hyperSteps.map((_, i) => runOne(i)))
		}
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
					if (hasSteps) {
						setPendingSessionSteps((prev) => ({ ...prev, [session.id]: { steps: [...steps], autoRun: false } }))
						setSteps(Array(STEP_COUNT).fill(""))
						setStepsOpen(false)
					}
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
			// badFolder also catches "/" and a bare home-folder pick — !selectedDirectory
			// alone let a session start with directory "/" (nowhere real to write files).
			if (badFolder || !promptText) return
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
		[badFolder, worktreeMode, launchLocal, launchWorktree],
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
			{showCodebaseGraph && !badFolder && (
				<div className="absolute inset-0 z-50 bg-background">
					<CodebaseGraph directory={selectedDirectory} onClose={() => setShowCodebaseGraph(false)} />
				</div>
			)}
			{/* Hero area — vertically centered. Once the Hyperloop panel is actually
			    open and doing work, this hero is just dead weight above it (same
			    principle as Code mode: once you're in an active session there's no
			    lingering "Build what's next" title) — hide it and let the step
			    panel below take the freed space instead. */}
			{!hyperPanelOpen && (
				<div className="flex flex-1 flex-col items-center justify-center px-0 sm:px-6">
					<div className="w-full max-w-4xl space-y-8">
						{/* Brand logo — hidden on the Hyperloop page entirely (the "Hyperloop" title already carries the brand look there) */}
						{!hyperloop && (
							<div className="flex justify-center">
								<HrambleLogo />
							</div>
						)}

						{/* "Build what's next" + project name */}
						<div className="text-center">
							<h1
								className={hyperloop ? "font-semibold" : "text-2xl font-semibold text-foreground"}
								style={
									hyperloop
										? {
												fontFamily: "'Syne Variable', sans-serif",
												fontSize: "40px",
												letterSpacing: "1px",
												color: "#12c24f",
												animation: "hramble-hue 10s ease-in-out infinite",
											}
										: undefined
								}
							>
								{hyperloop ? <strong>Hyperloop</strong> : "Build what's next"}
							</h1>
							{hyperloop && (
								<p className="mx-auto mt-2 max-w-md text-amber-600 text-sm dark:text-amber-400">
									Autonomous mode — 7 agents, one <InfinityIcon className="-mt-0.5 inline size-3.5" /> loop, building,
									verifying, repairing — until it's done. Press Escape any time to stop.
								</p>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Bottom-pinned input section — becomes the flex-growing element itself
			    once the hero above is hidden, so the step panel gets to use the
			    space the hero used to occupy instead of staying capped at 50vh. */}
			<div
				className={
					hyperPanelOpen
						? "flex min-h-0 flex-1 flex-col px-0 pb-0 pt-0 sm:px-6 sm:pb-5 sm:pt-3"
						: "shrink-0 px-0 pb-0 pt-0 sm:px-6 sm:pb-5 sm:pt-3"
				}
			>
				<div className={hyperPanelOpen ? "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col" : "mx-auto w-full max-w-4xl"}>
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
						<div className={hyperPanelOpen ? "relative flex min-h-0 flex-1 flex-col" : "relative"}>
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
								<div className="mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-primary/30 bg-muted/30 p-3">
									<div className="-mx-3 -mt-3 mb-2 overflow-hidden rounded-t-xl">
										<BrainSessionSummary sessionId={hyperRunForDir?.id ?? "hyperloop"} />
									</div>
									<div className="mb-2 flex items-center justify-between">
										<span className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
											{hyperRunning ? (
												<HyperloopSpinner className="h-3.5 w-auto text-primary" />
											) : (
												<InfinityIcon className="size-3.5 shrink-0" />
											)}
											{hyperCollapsed
												? "Hyperloop — what was built"
												: hyperSteps.length === 0
													? "Hyperloop — parallel agents"
													: hyperLoopCount > 1
														? `Hyperloop — ${hyperLoopCount} loops (${hyperSteps.length}/${hyperLoopCount * HYPER_LOOP_SIZE} steps)`
														: `Hyperloop — ${hyperSteps.length} step${hyperSteps.length === 1 ? "" : "s"}`}
											{hyperRunning && (
												<span className="text-primary">
													· {hyperSteps.filter((s) => s.status === "done").length}/{hyperSteps.length} done
												</span>
											)}
										</span>
										<div className="flex items-center gap-1">
											{hyperSteps.length > 0 && (
												<button
													type="button"
													title={graphView ? "Show as list" : "Show as graph"}
													onClick={() => setGraphView((v) => !v)}
													className={`rounded p-0.5 ${graphView ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
												>
													{graphView ? <ListIcon className="size-3.5" /> : <NetworkIcon className="size-3.5" />}
												</button>
											)}
											{hyperSteps.length > 0 && !hyperRunning && (
												<button
													type="button"
													title="Start a brand-new plan"
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
													!allStepsSettled
														? "Close"
														: hyperCollapsed
															? "Back to the full step list"
															: "Collapse into a recap of what was built"
												}
												onClick={() => {
													if (!allStepsSettled) {
														// Nothing finished yet — nothing to recap, just hide the panel.
														setHyperOpen(false)
													} else if (hyperCollapsed) {
														// Second click on a finished run's recap used to vanish the whole
														// panel with no way back — go to the full step list instead, so
														// closing never destroys the one place the recap lives.
														setHyperCollapsed(false)
													} else {
														collapseToRecap()
													}
												}}
												className="rounded p-0.5 text-muted-foreground hover:text-foreground"
											>
												<XIcon className="size-3.5" />
											</button>
										</div>
									</div>
									{hyperRun?.sizingNote && !hyperCollapsed && (
										<p className="mb-2 text-[11px] text-muted-foreground italic">{hyperRun.sizingNote}</p>
									)}
									{hyperNeedsRunModeChoice && (
										<div className="mb-2 flex flex-col gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
											<p className="text-[11px] text-foreground/90">
												This plan spans {hyperLoopCount} loops ({hyperSteps.length} steps) — run both loops now, or one loop at a time?
											</p>
											<div className="flex gap-1.5">
												<button
													type="button"
													onClick={() => setHyperRunMode("simultaneous")}
													className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground"
												>
													Run both loops now
												</button>
												<button
													type="button"
													onClick={() => setHyperRunMode("sequential")}
													className="rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground hover:bg-muted"
												>
													One loop at a time
												</button>
											</div>
										</div>
									)}
									{hyperLoopCount >= 3 && !hyperCollapsed && (
										<p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
											Large plan — {hyperSteps.length} steps across {hyperLoopCount} loops. Running this much at once raises the
											risk of conflicting edits or inconsistent results — review carefully, or prefer "one loop at a time."
										</p>
									)}
																		{allStepsSettled &&
										(() => {
											const failedCount = hyperSteps.filter((s) => s.status === "failed").length
											if (failedCount === 0) return null
											const isLocalModel = effectiveModel?.providerID === "ollama"
											return (
												<p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
													{failedCount === hyperSteps.length
														? `All ${failedCount} steps failed even after retrying`
														: `${failedCount} of ${hyperSteps.length} steps failed even after retrying`}
													{isLocalModel
														? " — this local model may not be capable enough for multi-step tool use. Try a larger or cloud model."
														: " — this model struggled with these steps. Try a different or more capable model."}
												</p>
											)
										})()}
									{hyperSteps.length === 0 && (
										<div className="flex flex-col gap-1.5">
											{badFolder && (
												<button
													type="button"
													onClick={chooseFolder}
													className="flex items-center gap-1.5 self-start rounded-md bg-amber-500/10 px-2 py-1 text-amber-600 text-xs hover:bg-amber-500/20 dark:text-amber-400"
												>
													<FolderIcon className="size-3.5 shrink-0" />
													Select a project folder before running Hyperloop — otherwise agents have nowhere real to write files
												</button>
											)}
											<div className="flex gap-2">
												<input
													className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
													placeholder="Describe your goal — AI will split it into as many parallel steps as it needs…"
													value={hyperGoal}
													onChange={(e) => setHyperGoal(e.target.value)}
													onKeyDown={(e) => { if (e.key === "Enter") hyperDecompose() }}
													disabled={hyperDecomposing || badFolder}
												/>
											<button
												type="button"
												onClick={() => {
													if (hyperDecomposing) {
														hyperDecomposeAbort.current = true
														if (hyperScratchId.current) {
															abortEngineSession(hyperScratchId.current).catch(() => {})
														}
														setHyperDecomposing(false)
													} else {
														hyperDecompose()
													}
												}}
												disabled={!hyperDecomposing && (!hyperGoal.trim() || badFolder)}
												className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
											>
												{hyperDecomposing ? <HyperloopSpinner className="h-3.5 w-auto" /> : "Decompose"}
											</button>
											</div>
										</div>
									)}
									{hyperSteps.length > 0 && graphView && (
										<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background/40">
											<div className="flex shrink-0 items-center gap-2 border-border/60 border-b px-3 py-2">
												{hyperNotLaunched && !badFolder && !hyperNeedsRunModeChoice && (
													<button
														type="button"
														onClick={hyperLaunchAll}
														disabled={hyperRunning}
														className="rounded-lg bg-primary px-3 py-1 font-medium text-primary-foreground text-xs disabled:opacity-50"
													>
														Run
													</button>
												)}
												<button
													type="button"
													onClick={() => {
														setHyperRun(null)
														setHyperCollapsed(false)
													}}
													disabled={hyperRunning}
													className="rounded-lg border border-border px-3 py-1 text-muted-foreground text-xs hover:text-foreground disabled:opacity-50"
												>
													Reset
												</button>
												{hyperRunning && <HyperloopSpinner className="ml-auto h-3.5 w-auto text-primary" />}
											</div>
											<GraphView
												className="min-h-0 flex-1"
												directory={hyperRunForDir?.directory ?? selectedDirectory}
												sessionId={hyperRunForDir?.id ?? null}
											/>
										</div>
									)}
									{hyperSteps.length > 0 && hyperCollapsed && !graphView && (
										<div className="flex min-h-0 flex-1 flex-col gap-3">
											<p className="text-xs text-muted-foreground/70">
												Here's what each agent built — type below to request small changes, or open a
												step to edit just that one.
											</p>
											<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
											{hyperSteps.map((step, i) => {
												// An empty, never-filled-in "add a step" slot — nothing to recap.
												if (!step.text.trim() && step.status === "idle") return null
												return (
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
												)
											})}
											</div>
											<button type="button" onClick={() => setHyperCollapsed(false)} className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
												Edit steps
											</button>
										</div>
									)}
									{hyperSteps.length > 0 && !hyperCollapsed && !graphView && (
										<div className="flex min-h-0 flex-1 flex-col gap-1.5">
											<div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
													{Array.from({ length: hyperLoopCount }, (_, loop) => loop).map((loop) => {
														const start = loop * HYPER_LOOP_SIZE
														const chunk = hyperSteps.slice(start, start + HYPER_LOOP_SIZE)
														const emptyCount = HYPER_LOOP_SIZE - chunk.length
														return (
														<div key={loop} className="flex flex-col gap-1.5">
															{hyperLoopCount > 1 && (
																<p className="mt-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
																	Loop {loop + 1} · steps {start + 1}–{start + HYPER_LOOP_SIZE}
																</p>
															)}
															{chunk.map((step, k) => {
																const i = start + k
													const isEditing = editingStep === i
													const isRunning = step.status === "running"
													const isRepairing = step.status === "repairing"
													const isBusy = isRunning || isRepairing
													return (
													<div key={i} className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs ${step.status === "done" ? "border-green-500/30 bg-green-500/5" : step.status === "failed" ? "border-red-500/30 bg-red-500/5" : isRepairing ? "border-amber-500/30 bg-amber-500/5" : isRunning ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
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
																	{!isBusy && step.preview && (step.status === "done" || step.status === "failed") && (
																		<span className="mt-1 block text-[11px] text-muted-foreground">{step.preview}</span>
																	)}
																</span>
															)}
															{isRunning && <HyperloopSpinner className="h-3.5 w-auto shrink-0 text-primary" />}
															{isRepairing && <RotateCwIcon className="size-3.5 shrink-0 animate-spin text-amber-500" />}
															{!isBusy && step.status === "done" && <CheckIcon className="size-3.5 shrink-0 text-green-500" />}
															{!isBusy && step.status === "failed" && <XIcon className="size-3.5 shrink-0 text-red-500" />}
														</div>
														{isRepairing && (
															<p className="pl-5 text-[10px] text-amber-600 dark:text-amber-400">
																First attempt didn't verify — retrying with the error fed back…
															</p>
														)}
														<div className="flex flex-wrap gap-1.5 pl-5">
															{!isBusy && !isEditing && (
																<button type="button" onClick={() => setEditingStep(i)} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><PencilIcon className="size-3" /> Edit</button>
															)}
															{!isBusy && (
																<button
																	type="button"
																	onClick={() => runSingleStep(i)}
																	className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10 ${i === nextManualStepIndex ? "animate-pulse bg-primary/10 ring-1 ring-primary" : ""}`}
																>
																	<PlayIcon className="size-3" /> {step.status === "done" || step.status === "failed" ? "Re-run" : "Run"} this step
																</button>
															)}
															{isEditing && (
																<button type="button" onClick={() => setEditingStep(null)} className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">Done</button>
															)}
															{isBusy && step.sessionId && (
																<button type="button" onClick={async () => {
																																		if (step.sessionId) {
																		manuallyStoppedRef.current.add(step.sessionId)
																		await abortEngineSession(step.sessionId).catch(() => {})
																		setHyperSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "failed" as const } : s)))
																	}
																}} className="rounded px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-500/10">Stop</button>
															)}
														</div>
													</div>
													)
															})}
															{emptyCount > 0 && loop === hyperLoopCount - 1 && (
																<button
																	type="button"
																	onClick={addHyperStep}
																	title="Add a step — e.g. something you forgot to mention"
																	className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-border/40 px-3 py-1 text-[10px] text-muted-foreground/40 transition-colors hover:border-primary/40 hover:text-primary"
																>
																	<PlusIcon className="size-3 shrink-0" />
																	{emptyCount === 1
																		? `Slot ${start + chunk.length + 1} unused — add a step`
																		: `Slots ${start + chunk.length + 1}–${start + HYPER_LOOP_SIZE} unused — add a step`}
																</button>
															)}
														</div>
														)
													})}
											</div>
											<div className="mt-1 flex items-center gap-2">
												{hyperNotLaunched && badFolder && (
													<button
														type="button"
														onClick={chooseFolder}
														className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-amber-600 text-xs hover:bg-amber-500/20 dark:text-amber-400"
													>
														<FolderIcon className="size-3.5 shrink-0" />
														Select a project folder to launch
													</button>
												)}
												{hyperNotLaunched && !badFolder && !hyperNeedsRunModeChoice && (
													<button
														type="button"
														onClick={hyperLaunchAll}
														className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
													>
														Run all steps automatically
														{hyperLoopCount > 1 ? ` (${hyperRun?.runMode === "sequential" ? "one loop at a time" : "both loops now"})` : ""}
													</button>
												)}
												{hyperNotLaunched && !badFolder && !hyperNeedsRunModeChoice && (
													<button
														type="button"
														onClick={() => {
															setManualQueueMode(true)
															runSingleStep(0)
														}}
														title="Starts just the first step. Add more whenever you think of them — nothing runs until you click its Run button."
														className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
													>
														Run one at a time
													</button>
												)}
												{hyperRunning && (
													<span className="px-1 text-xs text-muted-foreground">
														Running… {hyperSteps.filter((s) => s.status === "done").length}/{hyperSteps.length}
													</span>
												)}
												{allStepsSettled && (
													<span className="px-1 text-xs text-green-600 dark:text-green-500">
														Done · {hyperSteps.filter((s) => s.status === "done").length}/{hyperSteps.length}
													</span>
												)}
												<button type="button" onClick={() => { setHyperRun(null); setHyperCollapsed(false) }} disabled={hyperRunning} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
													Re-plan
												</button>
											</div>
										</div>
									)}
								</div>
							)}
						{badFolder && !hyperPanelOpen && (
							<button
								type="button"
								onClick={chooseFolder}
								className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-600 text-xs hover:bg-amber-500/20 dark:text-amber-400"
							>
								<FolderIcon className="size-3.5 shrink-0" />
								Select a project folder before starting — otherwise there's nowhere real to save the work
							</button>
						)}
						{interruptedHyperloopItem && (
							<div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
								<MoonIcon className="size-3.5 shrink-0" />
								<span className="flex-1">Your Mac went to sleep and this Hyperloop run was interrupted — continue from here?</span>
								<button
									type="button"
									onClick={() => resolveInterruptedItem(interruptedHyperloopItem.id)}
									className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-[11px] text-foreground transition-colors hover:bg-muted"
								>
									<CheckIcon className="size-3" />
									Yes, continue
								</button>
								<button
									type="button"
									onClick={() => resolveInterruptedItem(interruptedHyperloopItem.id)}
									className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:text-foreground"
								>
									Dismiss
								</button>
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
								disabled={launching || badFolder || projects.length === 0}
								onKeyDown={handleTextareaKeyDown}
								className="min-h-14 py-2.5"
							/>

							{stepsOpen && (
								<FloatingPanel
									title="Steps — run in order after session starts"
									onClose={() => setStepsOpen(false)}
								>
									<div className="space-y-1.5">
										{steps.map((s, i) => (
											<div key={i} className="flex items-start gap-2">
												<span className="flex w-4 shrink-0 items-center justify-center pt-2 text-center text-xs text-muted-foreground">
													{i + 1}
												</span>
												<input
													value={s}
													onChange={(e) => setSteps((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
													placeholder={`Step ${i + 1}`}
													className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
												/>
											</div>
										))}
									</div>
									<div className="mt-2 flex gap-2">
										<button
											type="button"
											onClick={() => void runStepsFromNew()}
											disabled={!hasSteps || launching || badFolder}
											className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:opacity-90 disabled:opacity-50"
										>
											<PlayIcon className="size-3.5" />
											Run all steps
										</button>
										<button
											type="button"
											onClick={() => { setSteps(Array(STEP_COUNT).fill("")); setStepsOpen(false) }}
											className="rounded-md border border-border px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
										>
											Clear
										</button>
									</div>
								</FloatingPanel>
							)}

							{/* Toolbar inside the card — agent + model + variant selectors */}
							{hasToolbar && (
								<PromptInputFooter>
									<PromptInputTools>
										{hyperloop && (
										<PromptInputButton
											title="Hyperloop — AI splits your goal into as many parallel steps as it needs"
											onClick={() => setHyperOpen((v) => !v)}
											className={hyperOpen || hyperSteps.length > 0 ? "text-primary" : ""}
										>
											<InfinityIcon className="size-4" />
										</PromptInputButton>
										)}
										<PromptInputButton
											onClick={() => setStepsOpen((v) => !v)}
											className={stepsOpen || hasSteps ? "text-primary" : ""}
											title="Loop — queue up to 7 steps and run them in sequence"
										>
											<ListOrderedIcon className="size-3.5" />
										</PromptInputButton>
										{!badFolder && (
										<PromptInputButton
											title="Codebase graph — how this project's symbols reference each other"
											onClick={() => setShowCodebaseGraph(true)}
										>
											<Share2Icon className="size-4" />
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
											onSelectMode={setChatMode}
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
							vcs && !engineConnected ? (
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
							No projects found. Open a project folder to get started.
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
