/**
 * Work-graph (renderer side) — the toggle + thin helpers over the main-process
 * `.hramble/graph` store (see main/graph-store.ts).
 *
 * The graph is a VIEW of the coding path, available in BOTH Code and Hyperloop
 * modes. It's opt-in via `graphViewAtom` (default off, so Code stays fast and
 * bare); Hyperloop can flip it on by default when it starts a run.
 *
 * We keep the node type here light and local (a mirror of the main-process
 * type) so the renderer doesn't reach across into the preload/main package.
 */
import { atomWithStorage } from "jotai/utils"

export type GraphNodeKind =
	| "command"
	| "decide"
	| "option"
	| "plan"
	| "implement"
	| "verify"
	| "repair"
	| "integrate"
	| "done"

export type GraphNodeStatus = "queued" | "working" | "done" | "failed" | "repair" | "rejected"

export interface GraphNode {
	id: string
	parent?: string
	refs?: string[]
	kind: GraphNodeKind
	title: string
	status: GraphNodeStatus
	ts: number
	files?: string[]
	commit?: string
	summary?: string
}

export type GraphEvent = Partial<GraphNode> & { id: string }

export interface GraphSessionSummary {
	session: string
	title: string
	ts: number
	nodeCount: number
	status: GraphNodeStatus
}

/** Show the Graph view instead of the plain list. Persisted; default off. */
export const graphViewAtom = atomWithStorage<boolean>("hramble:graphView", false)

// window.hramble.graph is typed in preload/api.d.ts; access defensively so the
// app still runs if the preload bridge is ever missing (e.g. a stale dev preload).
function bridge() {
	return window.hramble?.graph
}

/** Append/update one graph node. Fire-and-forget — never throws into the UI. */
export async function recordGraph(directory: string, sessionId: string, event: GraphEvent): Promise<void> {
	try {
		await bridge()?.record(directory, sessionId, event)
	} catch {
		/* graph is best-effort; a failed write must never break coding */
	}
}

/** Load a single session's folded node list (for the live/expanded graph). */
export async function loadSessionGraph(directory: string, sessionId: string): Promise<GraphNode[]> {
	try {
		return (await bridge()?.session(directory, sessionId)) ?? []
	} catch {
		return []
	}
}

/** Load collapsed per-session summaries (for the history timeline). */
export async function loadGraphSessions(directory: string): Promise<GraphSessionSummary[]> {
	try {
		return (await bridge()?.sessions(directory)) ?? []
	} catch {
		return []
	}
}
