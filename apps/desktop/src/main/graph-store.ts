// Work-graph store — the persistent record behind the Graph view.
//
// Design goals (see product discussion):
//   • Tiny: a node is STRUCTURE, not code. ~0.5–2 KB each → a few MB for a
//     lifetime of work. We store pointers (git commit + file paths), never file
//     contents or diffs — those already live in git and are loaded lazily.
//   • Git-friendly & portable: one append-only JSONL file PER SESSION under
//     `<project>/.hramble/graph/`. Per-session files mean no merge conflicts,
//     and the folder can be committed so the graph travels with the repo.
//   • Cheap writes: every change appends one line. Reads "fold" events by id
//     (last write wins per field), so a status update is just another append.

import { appendFile, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { ipcMain } from "electron"
import { createLogger } from "./logger"

const log = createLogger("graph")

export type GraphNodeKind =
	| "command" // a user prompt — the milestone that starts a sub-tree
	| "decide" // a branch/decision point
	| "option" // one branch option (chosen or rejected)
	| "plan"
	| "implement"
	| "verify"
	| "repair"
	| "integrate"
	| "done"

export type GraphNodeStatus = "queued" | "working" | "done" | "failed" | "repair" | "rejected"

/** A single graph node. Kept deliberately light — pointers, not payloads. */
export interface GraphNode {
	id: string
	parent?: string // parent node id (tree structure)
	refs?: string[] // ids of earlier nodes this one builds on (cross-links)
	kind: GraphNodeKind
	title: string
	status: GraphNodeStatus
	ts: number
	files?: string[] // paths touched — a POINTER, not the file contents
	commit?: string // git SHA — a POINTER into history, not a copy
	summary?: string // short one-liner; full detail is loaded lazily from git/logs
}

/** What we append to disk: any subset of a node, keyed by id (folded on read). */
export type GraphEvent = Partial<GraphNode> & { id: string }

/** Lightweight summary of a whole session — used to build the collapsed history. */
export interface GraphSessionSummary {
	session: string
	title: string
	ts: number
	nodeCount: number
	status: GraphNodeStatus
}

function graphDir(directory: string): string {
	return path.join(directory, ".hramble", "graph")
}

/** Filesystem-safe session filename. */
function fileFor(directory: string, sessionId: string): string {
	const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_")
	return path.join(graphDir(directory), `${safe}.jsonl`)
}

/** Append one event. Creates `.hramble/graph/` on first write. */
async function record(directory: string, sessionId: string, event: GraphEvent): Promise<void> {
	// Require a real absolute project path — guards against an empty/relative
	// directory (or the filesystem root itself, seen from stale persisted runs)
	// resolving to something like "/.hramble".
	if (!directory || !path.isAbsolute(directory) || directory === path.parse(directory).root) return
	if (!sessionId || !event?.id) return
	try {
		await mkdir(graphDir(directory), { recursive: true })
		const withTs: GraphEvent = event.ts ? event : { ...event, ts: Date.now() }
		await appendFile(fileFor(directory, sessionId), `${JSON.stringify(withTs)}\n`, "utf8")
	} catch (e) {
		log.warn("[graph] record failed", e)
	}
}

/** Read a session file and FOLD events by id (last write wins per field). */
async function readSession(directory: string, sessionId: string): Promise<GraphNode[]> {
	try {
		const raw = await readFile(fileFor(directory, sessionId), "utf8")
		const byId = new Map<string, GraphNode>()
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue
			let ev: GraphEvent
			try {
				ev = JSON.parse(line)
			} catch {
				continue // skip a torn/partial line
			}
			const prev = byId.get(ev.id)
			byId.set(ev.id, { ...(prev ?? { id: ev.id, kind: "implement", title: "", status: "queued", ts: 0 }), ...ev } as GraphNode)
		}
		return [...byId.values()].sort((a, b) => a.ts - b.ts)
	} catch {
		return [] // no file yet
	}
}

/** Collapse the whole graph folder into per-session summaries for the history view. */
async function listSessions(directory: string): Promise<GraphSessionSummary[]> {
	try {
		const files = (await readdir(graphDir(directory))).filter((f) => f.endsWith(".jsonl"))
		const out: GraphSessionSummary[] = []
		for (const f of files) {
			const session = f.replace(/\.jsonl$/, "")
			const nodes = await readSession(directory, session)
			if (!nodes.length) continue
			// Title = the first command node's title, else the earliest node's title.
			const cmd = nodes.find((n) => n.kind === "command") ?? nodes[0]
			// Overall status: failed if anything failed, working if anything active, else done.
			const status: GraphNodeStatus = nodes.some((n) => n.status === "failed")
				? "failed"
				: nodes.some((n) => n.status === "working" || n.status === "repair" || n.status === "queued")
					? "working"
					: "done"
			out.push({ session, title: cmd.title || session, ts: nodes[0].ts, nodeCount: nodes.length, status })
		}
		return out.sort((a, b) => b.ts - a.ts) // newest first
	} catch {
		return []
	}
}

export function registerGraphStore() {
	// Append a node event (create or update). Fire-and-forget from the renderer.
	ipcMain.handle("graph:record", async (_e, directory: string, sessionId: string, event: GraphEvent) => {
		await record(directory, sessionId, event)
		return { ok: true }
	})

	// Full node list for ONE session (folded) — drives the live/expanded graph.
	ipcMain.handle("graph:session", async (_e, directory: string, sessionId: string) => {
		return readSession(directory, sessionId)
	})

	// Collapsed per-session summaries — drives the history timeline / pills.
	ipcMain.handle("graph:sessions", async (_e, directory: string) => {
		return listSessions(directory)
	})
}
