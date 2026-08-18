import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { nanoid } from "nanoid"
import type { Session, Message, ContentBlock, Todo, Usage } from "./types.js"
import { atomicWriteSync } from "./fsutil.js"

const DATA_DIR = process.env.ENGINE_DATA_DIR || path.join(os.homedir(), ".local", "share", "hramble", "engine")
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json")

function emptyStore(): Store {
	return { sessions: {}, messages: {}, checkpoints: {}, redo: {}, permissionRules: {}, todos: {}, usage: {} }
}

/**
 * A file's content captured around an engine edit, so a revert can restore it.
 * `before`/`after` are null when the file did not exist at that point.
 */
export interface FileSnapshot {
	messageId: string
	path: string
	before: string | null
	after: string | null
	ts: number
}

interface RevertBatch {
	messages: Message[]
	snapshots: FileSnapshot[]
}

interface Store {
	sessions: Record<string, Session>
	messages: Record<string, Message[]>
	// File snapshots per session (undo history) and a redo stack for unrevert.
	checkpoints: Record<string, FileSnapshot[]>
	redo: Record<string, RevertBatch[]>
	// "Always allow" rules, keyed by project directory -> permission keys.
	permissionRules: Record<string, string[]>
	// Current todo list per session.
	todos: Record<string, Todo[]>
	// Cumulative token usage per session.
	usage: Record<string, Usage>
}

let store: Store = emptyStore()

export function initDb(): void {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	if (fs.existsSync(SESSIONS_FILE)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8")) as Partial<Store>
			// Backfill EVERY map (incl. sessions) so a valid-but-partial file can't
			// throw downstream (Object.values(undefined)) and crash the engine.
			store = {
				sessions: parsed.sessions ?? {},
				messages: parsed.messages ?? {},
				checkpoints: parsed.checkpoints ?? {},
				redo: parsed.redo ?? {},
				permissionRules: parsed.permissionRules ?? {},
				todos: parsed.todos ?? {},
				usage: parsed.usage ?? {},
			}
		} catch (err) {
			// Corrupt store — DON'T silently wipe. Preserve the bad file for recovery
			// and start fresh, surfacing the loss loudly in the logs.
			try {
				fs.renameSync(SESSIONS_FILE, `${SESSIONS_FILE}.corrupt-${nanoid(6)}`)
			} catch {
				// ignore
			}
			console.error(`[xot-engine] sessions store was corrupt; backed it up and started fresh: ${err instanceof Error ? err.message : err}`)
			store = emptyStore()
		}
	}
	// Boot reconciliation: a restart orphans any session left "running" (its
	// agent loop and abort controller are gone). Reset them so the UI isn't
	// stuck showing a spinner for a run that will never finish.
	let changed = false
	for (const session of Object.values(store.sessions)) {
		if (session.status === "running") {
			session.status = "idle"
			changed = true
		}
	}
	if (changed) persist()
}

function persist(): void {
	// Atomic (temp + rename) so a crash mid-write can't truncate/brick the store.
	atomicWriteSync(SESSIONS_FILE, JSON.stringify(store))
}

export function createSession(title: string, directory: string): Session {
	const now = Date.now()
	const session: Session = {
		id: nanoid(),
		title,
		directory,
		createdAt: now,
		updatedAt: now,
		status: "idle",
	}
	store.sessions[session.id] = session
	store.messages[session.id] = []
	persist()
	return session
}

export function getSession(id: string): Session | null {
	return store.sessions[id] ?? null
}

export interface ListOptions {
	directory?: string
	search?: string
	limit?: number
}

export function listSessions(opts: ListOptions = {}): Session[] {
	let list = Object.values(store.sessions)
	if (opts.directory) list = list.filter((s) => s.directory === opts.directory)
	if (opts.search?.trim()) {
		const q = opts.search.trim().toLowerCase()
		list = list.filter((s) => s.title.toLowerCase().includes(q))
	}
	list.sort((a, b) => b.updatedAt - a.updatedAt)
	if (opts.limit && opts.limit > 0) list = list.slice(0, opts.limit)
	return list
}

export function renameSession(id: string, title: string): Session | null {
	const session = store.sessions[id]
	if (!session) return null
	session.title = title
	session.updatedAt = Date.now()
	persist()
	return session
}

export function deleteSession(id: string): boolean {
	if (!store.sessions[id]) return false
	delete store.sessions[id]
	delete store.messages[id]
	delete store.checkpoints[id]
	delete store.redo[id]
	delete store.todos[id]
	delete store.usage[id]
	persist()
	return true
}

/** Delete a single message ("part") from a session's transcript. */
export function deleteMessage(sessionId: string, messageId: string): boolean {
	const list = store.messages[sessionId]
	if (!list) return false
	const next = list.filter((m) => m.id !== messageId)
	if (next.length === list.length) return false
	store.messages[sessionId] = next
	// Drop the deleted message's file snapshots so they don't linger in the diff
	// forever, and invalidate redo (its batch may reference the removed message).
	if (store.checkpoints[sessionId]) {
		store.checkpoints[sessionId] = store.checkpoints[sessionId].filter((s) => s.messageId !== messageId)
	}
	store.redo[sessionId] = []
	const session = store.sessions[sessionId]
	if (session) session.updatedAt = Date.now()
	persist()
	return true
}

/**
 * Fork a session into a new one, copying its transcript up to and including
 * `throughMessageId` (or the whole transcript when omitted). Lets the user
 * branch a conversation without mutating the original.
 */
export function forkSession(id: string, throughMessageId?: string): Session | null {
	const source = store.sessions[id]
	if (!source) return null
	const srcMessages = getMessages(id)
	let slice = srcMessages
	if (throughMessageId) {
		const idx = srcMessages.findIndex((m) => m.id === throughMessageId)
		if (idx === -1) return null
		slice = srcMessages.slice(0, idx + 1)
	}
	const fork = createSession(`${source.title} (fork)`, source.directory)
	store.messages[fork.id] = slice.map((m) => ({ ...m, id: nanoid(), sessionId: fork.id }))
	persist()
	return fork
}

export function updateSessionStatus(id: string, status: Session["status"]): void {
	const session = store.sessions[id]
	if (!session) return
	session.status = status
	session.updatedAt = Date.now()
	persist()
}

export function addMessage(
	sessionId: string,
	role: "user" | "assistant",
	content: string | ContentBlock[],
): Message {
	const message: Message = {
		id: nanoid(),
		sessionId,
		role,
		content,
		createdAt: Date.now(),
	}
	if (!store.messages[sessionId]) store.messages[sessionId] = []
	store.messages[sessionId].push(message)
	// Continuing the conversation invalidates any reverted branch (redo).
	if (store.redo[sessionId]?.length) store.redo[sessionId] = []
	persist()
	return message
}

export function getMessages(sessionId: string): Message[] {
	return (store.messages[sessionId] ?? []).sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Replace a session's transcript with a single summary message (compaction).
 * The next turn continues with the summary as its only prior context.
 */
export function compactSession(sessionId: string, summary: string): Message | null {
	if (!store.sessions[sessionId]) return null
	const message: Message = {
		id: nanoid(),
		sessionId,
		role: "assistant",
		content: `Summary of the conversation so far:\n\n${summary}`,
		createdAt: Date.now(),
	}
	store.messages[sessionId] = [message]
	// The pre-compaction messages are gone, so their snapshots/redo are dead —
	// clear them to avoid a leak and a stale diff/unrevert referencing vanished state.
	store.checkpoints[sessionId] = []
	store.redo[sessionId] = []
	store.sessions[sessionId].updatedAt = Date.now()
	persist()
	return message
}

/**
 * Compact a session in place while preserving the most recent `keep` messages
 * (the current turn). Everything older is replaced by a single summary message
 * ordered just before the kept tail. Used by auto-compaction so a long session
 * keeps its thread instead of silently losing the oldest turns to trimming.
 */
export function compactSessionPreservingRecent(sessionId: string, summary: string, keep = 1): boolean {
	const list = store.messages[sessionId]
	if (!list) return false
	const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt)
	const tail = keep > 0 ? ordered.slice(-keep) : []
	const anchor = tail.length > 0 ? tail[0].createdAt - 1 : Date.now()
	const summaryMsg: Message = {
		id: nanoid(),
		sessionId,
		role: "assistant",
		content: `Summary of the conversation so far:\n\n${summary}`,
		createdAt: anchor,
	}
	store.messages[sessionId] = [summaryMsg, ...tail]
	// The pre-compaction messages are gone — their snapshots/redo are dead.
	store.checkpoints[sessionId] = []
	store.redo[sessionId] = []
	if (store.sessions[sessionId]) store.sessions[sessionId].updatedAt = Date.now()
	persist()
	return true
}

/** Record a file's before/after content around an engine edit for undo. */
export function recordSnapshot(
	sessionId: string,
	messageId: string,
	filePath: string,
	before: string | null,
	after: string | null,
): void {
	if (!store.checkpoints[sessionId]) store.checkpoints[sessionId] = []
	store.checkpoints[sessionId].push({ messageId, path: filePath, before, after, ts: Date.now() })
	// A fresh edit invalidates the redo stack.
	store.redo[sessionId] = []
	persist()
}

function applyFileState(filePath: string, content: string | null): void {
	if (content === null) {
		try {
			fs.rmSync(filePath, { force: true })
		} catch {
			// already gone
		}
		return
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, content, "utf-8")
}

/**
 * Revert a session back to (and including) `messageId`: undo every file change
 * made by that turn and later (restoring `before`), drop those messages, and
 * push them onto the redo stack so unrevert can replay them.
 */
export function revertSession(sessionId: string, messageId: string): { reverted: number } | null {
	const list = store.messages[sessionId]
	if (!list) return null
	const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt)
	const idx = ordered.findIndex((m) => m.id === messageId)
	if (idx === -1) return null

	const removed = ordered.slice(idx)
	const removedIds = new Set(removed.map((m) => m.id))
	const snaps = store.checkpoints[sessionId] ?? []
	const affected = snaps.filter((s) => removedIds.has(s.messageId))

	// Restore files newest-first so a file edited repeatedly ends at its earliest `before`.
	for (const snap of [...affected].sort((a, b) => b.ts - a.ts)) {
		applyFileState(snap.path, snap.before)
	}

	store.messages[sessionId] = ordered.slice(0, idx)
	store.checkpoints[sessionId] = snaps.filter((s) => !removedIds.has(s.messageId))
	if (!store.redo[sessionId]) store.redo[sessionId] = []
	store.redo[sessionId].push({ messages: removed, snapshots: affected })

	const session = store.sessions[sessionId]
	if (session) session.updatedAt = Date.now()
	persist()
	return { reverted: removed.length }
}

/** Replay the most recently reverted batch: re-apply files (`after`) and messages. */
export function unrevertSession(sessionId: string): { restored: number } | null {
	const stack = store.redo[sessionId]
	if (!stack || stack.length === 0) return null
	const batch = stack.pop()
	if (!batch) return null

	// Re-apply oldest-first so a file's final state matches its latest `after`.
	for (const snap of [...batch.snapshots].sort((a, b) => a.ts - b.ts)) {
		applyFileState(snap.path, snap.after)
	}

	if (!store.messages[sessionId]) store.messages[sessionId] = []
	store.messages[sessionId].push(...batch.messages)
	if (!store.checkpoints[sessionId]) store.checkpoints[sessionId] = []
	store.checkpoints[sessionId].push(...batch.snapshots)

	const session = store.sessions[sessionId]
	if (session) session.updatedAt = Date.now()
	persist()
	return { restored: batch.messages.length }
}

export interface FileDiff {
	path: string
	before: string | null
	after: string | null
	status: "created" | "modified" | "deleted"
}

/**
 * The net file changes made during a session, derived from the edit checkpoints:
 * earliest `before` vs latest `after` per file.
 */
export function getSessionDiff(sessionId: string): FileDiff[] {
	const snaps = (store.checkpoints[sessionId] ?? []).slice().sort((a, b) => a.ts - b.ts)
	const byPath = new Map<string, { before: string | null; after: string | null }>()
	for (const s of snaps) {
		const existing = byPath.get(s.path)
		if (existing) existing.after = s.after
		else byPath.set(s.path, { before: s.before, after: s.after })
	}
	const diffs: FileDiff[] = []
	for (const [path, { before, after }] of byPath) {
		if (before === after) continue
		const status = before === null ? "created" : after === null ? "deleted" : "modified"
		diffs.push({ path, before, after, status })
	}
	return diffs
}

export function setTodos(sessionId: string, todos: Todo[]): void {
	store.todos[sessionId] = todos
	persist()
}

export function getTodos(sessionId: string): Todo[] {
	return store.todos[sessionId] ?? []
}

/** Add a turn's token usage to the session total and return the new total. */
export function addUsage(sessionId: string, inputTokens: number, outputTokens: number): Usage {
	const current = store.usage[sessionId] ?? { inputTokens: 0, outputTokens: 0 }
	current.inputTokens += inputTokens
	current.outputTokens += outputTokens
	store.usage[sessionId] = current
	persist()
	return current
}

export function getUsage(sessionId: string): Usage {
	return store.usage[sessionId] ?? { inputTokens: 0, outputTokens: 0 }
}

/** True if the user previously chose "always allow" for this action in this project. */
export function matchesPermissionRule(directory: string, key: string): boolean {
	return store.permissionRules[directory]?.includes(key) ?? false
}

/** Remember an "always allow" decision for this project + action. */
export function addPermissionRule(directory: string, key: string): void {
	if (!store.permissionRules[directory]) store.permissionRules[directory] = []
	if (!store.permissionRules[directory].includes(key)) {
		store.permissionRules[directory].push(key)
		persist()
	}
}

export function closeDb(): void {
	persist()
}
