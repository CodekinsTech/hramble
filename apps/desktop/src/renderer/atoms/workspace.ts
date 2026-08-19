/**
 * Workspace mode — the top-level "Code vs Hyperloop" switch, like Claude's
 * Code / Cowork split.
 *
 * Both modes share the SAME projects/folders (option A). What differs is the
 * session list you see and how new sessions run:
 *   • "code"      — normal chats; Hyperloop runs are hidden.
 *   • "hyperloop" — autonomous runs only; new sessions loop until done.
 *
 * Sessions started in Hyperloop are tagged by id in `hyperloopSessionIdsAtom`,
 * so the sidebar can show each mode its own run history.
 */
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { appStore } from "./store"

export type WorkspaceMode = "code" | "hyperloop"

export const workspaceModeAtom = atomWithStorage<WorkspaceMode>("hramble:workspaceMode", "code")

/**
 * A goal handed off from the Templates page into Hyperloop's own goal input
 * (which is local component state, not the normal chat draft). NewChat reads
 * this once on mount when landing in Hyperloop mode, then clears it.
 */
export const pendingHyperGoalAtom = atom<string | null>(null)

/** Session ids that were started in Hyperloop mode (persisted). */
export const hyperloopSessionIdsAtom = atomWithStorage<string[]>("hramble:hyperloopSessions", [])

/** Tag a session as a Hyperloop run. */
export function markHyperloopSession(sessionId: string) {
	const cur = appStore.get(hyperloopSessionIdsAtom)
	if (!cur.includes(sessionId)) appStore.set(hyperloopSessionIdsAtom, [...cur, sessionId])
}

/** Fast membership set derived from the persisted list. */
export const hyperloopSessionSetAtom = atom((get) => new Set(get(hyperloopSessionIdsAtom)))

/** A single Hyperloop step (serialisable — stored in localStorage). */
export interface HyperStep {
	text: string
	// "repairing" = the step's first attempt failed an objective check (no real
	// tool call, a tool errored, or a hallucinated/unavailable tool was tried) and
	// it's being automatically retried with the failure fed back — see
	// verifyStepMessages/runStepUntilVerified in new-chat.tsx.
	status: "idle" | "running" | "repairing" | "done" | "failed"
	sessionId?: string
	timeEstimate?: string
	preview?: string
	/** Project-relative files this step changed (from its diff) — feeds the work
	 *  graph: the per-node file count and the file-overlap edges between steps. */
	files?: string[]
}

/**
 * How many steps fit in one Hyperloop "loop" (a batch of parallel agents). The
 * AI decides how many steps a goal actually needs — small goals use fewer than
 * one loop (the rest of that loop's slots render empty), bigger goals span
 * multiple loops of this size ("twin loop" etc.).
 */
export const HYPER_LOOP_SIZE = 7

/** Hard ceiling on total steps for now — beyond this, growing further needs
 *  more design (see HyperloopRun.sizingNote warning at 3+ loops). */
export const HYPER_MAX_STEPS = HYPER_LOOP_SIZE * 3

/** The active Hyperloop run — persists across navigation so "View" → back works. */
export interface HyperloopRun {
	/** Stable id for this run — used as the work-graph session key (.hramble/graph). */
	id?: string
	goal: string
	steps: HyperStep[]
	running: boolean
	directory?: string
	/** The AI's one-line sizing decision, e.g. "Medium task — 9 steps across 2 loops." */
	sizingNote?: string
	/** Only meaningful when the plan spans more than one loop; unset until the
	 *  user picks how multi-loop plans should run. */
	runMode?: "simultaneous" | "sequential"
}

export const hyperloopRunAtom = atomWithStorage<HyperloopRun | null>("hramble:hyperloopRun", null)

/**
 * History of Hyperloop runs — ONE entry per run (goal), newest first. This is
 * what the Hyperloop sidebar lists, so the user sees a clean run history instead
 * of the 7 underlying step sessions (which stay hidden as an implementation
 * detail). Clicking a run reopens it into `hyperloopRunAtom`.
 */
export const hyperloopRunsAtom = atomWithStorage<HyperloopRun[]>("hramble:hyperloopRuns", [])

const MAX_RUNS = 30

/** Insert or update a run by id (newest first, capped). No-op without an id. */
export function upsertHyperloopRun(run: HyperloopRun) {
	if (!run.id) return
	const cur = appStore.get(hyperloopRunsAtom)
	const rest = cur.filter((r) => r.id !== run.id)
	appStore.set(hyperloopRunsAtom, [run, ...rest].slice(0, MAX_RUNS))
}
