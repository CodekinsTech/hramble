import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { nanoid } from "nanoid"
import type { Session, Message, ContentBlock, Todo, Usage } from "./types.js"

// SQLite driver, resolved for the runtime: node:sqlite under Node, bun:sqlite
// under Bun (the desktop app spawns the engine with Bun, which lacks
// node:sqlite). Both expose the same surface we use: exec(), prepare() →
// run/get/all(...params), close().
interface SqlStatement {
	run(...params: unknown[]): { changes: number | bigint }
	get(...params: unknown[]): unknown
	all(...params: unknown[]): unknown[]
}
interface SqlDatabase {
	exec(sql: string): void
	prepare(sql: string): SqlStatement
	close(): void
}
type DbCtor = new (path: string) => SqlDatabase

let DatabaseCtor: DbCtor
try {
	DatabaseCtor = (await import("node:sqlite")).DatabaseSync as unknown as DbCtor
} catch {
	// Non-literal specifier so tsc doesn't try to resolve the Bun-only module.
	const bunSqlite = "bun:sqlite"
	DatabaseCtor = (await import(bunSqlite)).Database as unknown as DbCtor
}

const DATA_DIR = process.env.ENGINE_DATA_DIR || path.join(os.homedir(), ".local", "share", "hramble", "engine")
const DB_FILE = path.join(DATA_DIR, "engine.db")
const LEGACY_JSON = path.join(DATA_DIR, "sessions.json")

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

let db: SqlDatabase

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	directory TEXT NOT NULL,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL,
	status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY,
	sessionId TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, createdAt);
CREATE TABLE IF NOT EXISTS checkpoints (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	sessionId TEXT NOT NULL,
	messageId TEXT NOT NULL,
	path TEXT NOT NULL,
	before TEXT,
	after TEXT,
	ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(sessionId);
CREATE TABLE IF NOT EXISTS redo (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	sessionId TEXT NOT NULL,
	batch TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redo_session ON redo(sessionId);
CREATE TABLE IF NOT EXISTS permission_rules (
	directory TEXT NOT NULL,
	key TEXT NOT NULL,
	PRIMARY KEY(directory, key)
);
CREATE TABLE IF NOT EXISTS todos (
	sessionId TEXT PRIMARY KEY,
	todos TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
	sessionId TEXT PRIMARY KEY,
	inputTokens INTEGER NOT NULL,
	outputTokens INTEGER NOT NULL
);
`

export function initDb(): void {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	db = openOrRecover()
	db.exec("PRAGMA journal_mode = WAL")
	db.exec("PRAGMA foreign_keys = OFF")
	db.exec(SCHEMA)

	// One-time migration from the old flat-JSON store, if present and not yet done.
	if (fs.existsSync(LEGACY_JSON) && isEmpty()) {
		try {
			migrateFromJson(LEGACY_JSON)
			fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated-${nanoid(6)}`)
			console.log("[xot-engine] migrated sessions.json → engine.db")
		} catch (err) {
			console.error(`[xot-engine] sessions.json migration failed (left in place): ${err instanceof Error ? err.message : err}`)
		}
	}

	// Boot reconciliation: a restart orphans any session left "running" (its agent
	// loop and abort controller are gone). Reset them so the UI isn't stuck.
	db.exec("UPDATE sessions SET status = 'idle' WHERE status = 'running'")
}

/** Open the DB; if the file is corrupt, back it up and start fresh (don't crash). */
function openOrRecover(): SqlDatabase {
	try {
		const d = new DatabaseCtor(DB_FILE)
		d.exec("SELECT 1") // force it to actually touch the file
		return d
	} catch (err) {
		try {
			if (fs.existsSync(DB_FILE)) fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${nanoid(6)}`)
		} catch {
			// ignore
		}
		console.error(`[xot-engine] engine.db was unreadable; backed it up and started fresh: ${err instanceof Error ? err.message : err}`)
		return new DatabaseCtor(DB_FILE)
	}
}

function isEmpty(): boolean {
	const row = db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
	return row.n === 0
}

/** Run a set of writes atomically. */
function tx<T>(fn: () => T): T {
	db.exec("BEGIN")
	try {
		const result = fn()
		db.exec("COMMIT")
		return result
	} catch (err) {
		db.exec("ROLLBACK")
		throw err
	}
}

// ── Row mappers ───────────────────────────────────────────────────────────

interface SessionRow {
	id: string
	title: string
	directory: string
	createdAt: number
	updatedAt: number
	status: string
}
interface MessageRow {
	id: string
	sessionId: string
	role: string
	content: string
	createdAt: number
}

function toSession(r: SessionRow): Session {
	return { id: r.id, title: r.title, directory: r.directory, createdAt: r.createdAt, updatedAt: r.updatedAt, status: r.status as Session["status"] }
}
function toMessage(r: MessageRow): Message {
	return { id: r.id, sessionId: r.sessionId, role: r.role as Message["role"], content: JSON.parse(r.content) as Message["content"], createdAt: r.createdAt }
}

function touch(id: string, ts = Date.now()): void {
	db.prepare("UPDATE sessions SET updatedAt = ? WHERE id = ?").run(ts, id)
}

// ── Migration ─────────────────────────────────────────────────────────────

interface LegacyStore {
	sessions?: Record<string, Session>
	messages?: Record<string, Message[]>
	checkpoints?: Record<string, FileSnapshot[]>
	redo?: Record<string, RevertBatch[]>
	permissionRules?: Record<string, string[]>
	todos?: Record<string, Todo[]>
	usage?: Record<string, Usage>
}

function migrateFromJson(file: string): void {
	const data = JSON.parse(fs.readFileSync(file, "utf-8")) as LegacyStore
	tx(() => {
		const insS = db.prepare("INSERT OR REPLACE INTO sessions(id,title,directory,createdAt,updatedAt,status) VALUES(?,?,?,?,?,?)")
		for (const s of Object.values(data.sessions ?? {})) insS.run(s.id, s.title, s.directory, s.createdAt, s.updatedAt, s.status)

		const insM = db.prepare("INSERT OR REPLACE INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)")
		for (const [sid, list] of Object.entries(data.messages ?? {})) {
			for (const m of list) insM.run(m.id, sid, m.role, JSON.stringify(m.content), m.createdAt)
		}

		const insC = db.prepare("INSERT INTO checkpoints(sessionId,messageId,path,before,after,ts) VALUES(?,?,?,?,?,?)")
		for (const [sid, snaps] of Object.entries(data.checkpoints ?? {})) {
			for (const s of snaps) insC.run(sid, s.messageId, s.path, s.before, s.after, s.ts)
		}

		const insR = db.prepare("INSERT INTO redo(sessionId,batch) VALUES(?,?)")
		for (const [sid, batches] of Object.entries(data.redo ?? {})) {
			for (const b of batches) insR.run(sid, JSON.stringify(b))
		}

		const insP = db.prepare("INSERT OR IGNORE INTO permission_rules(directory,key) VALUES(?,?)")
		for (const [dir, keys] of Object.entries(data.permissionRules ?? {})) {
			for (const k of keys) insP.run(dir, k)
		}

		const insT = db.prepare("INSERT OR REPLACE INTO todos(sessionId,todos) VALUES(?,?)")
		for (const [sid, todos] of Object.entries(data.todos ?? {})) insT.run(sid, JSON.stringify(todos))

		const insU = db.prepare("INSERT OR REPLACE INTO usage(sessionId,inputTokens,outputTokens) VALUES(?,?,?)")
		for (const [sid, u] of Object.entries(data.usage ?? {})) insU.run(sid, u.inputTokens, u.outputTokens)
	})
}

// ── Sessions ──────────────────────────────────────────────────────────────

export function createSession(title: string, directory: string): Session {
	const now = Date.now()
	const session: Session = { id: nanoid(), title, directory, createdAt: now, updatedAt: now, status: "idle" }
	db.prepare("INSERT INTO sessions(id,title,directory,createdAt,updatedAt,status) VALUES(?,?,?,?,?,?)").run(
		session.id,
		session.title,
		session.directory,
		session.createdAt,
		session.updatedAt,
		session.status,
	)
	return session
}

export function getSession(id: string): Session | null {
	const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined
	return row ? toSession(row) : null
}

export interface ListOptions {
	directory?: string
	search?: string
	limit?: number
}

export function listSessions(opts: ListOptions = {}): Session[] {
	let sql = "SELECT * FROM sessions"
	const where: string[] = []
	const params: (string | number)[] = []
	if (opts.directory) {
		where.push("directory = ?")
		params.push(opts.directory)
	}
	if (opts.search?.trim()) {
		// Escape LIKE wildcards so a literal search can't act as a pattern.
		const q = opts.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)
		where.push("lower(title) LIKE ? ESCAPE '\\'")
		params.push(`%${q}%`)
	}
	if (where.length) sql += ` WHERE ${where.join(" AND ")}`
	sql += " ORDER BY updatedAt DESC"
	if (opts.limit && opts.limit > 0) {
		sql += " LIMIT ?"
		params.push(opts.limit)
	}
	return (db.prepare(sql).all(...params) as unknown as SessionRow[]).map(toSession)
}

export interface ProjectDir {
	directory: string
	updatedAt: number
	sessionCount: number
}

/** Distinct project directories that have sessions, most-recently-active first. */
export function listProjectDirs(): ProjectDir[] {
	return db
		.prepare("SELECT directory, MAX(updatedAt) AS updatedAt, COUNT(*) AS sessionCount FROM sessions GROUP BY directory ORDER BY updatedAt DESC")
		.all() as unknown as ProjectDir[]
}

export function renameSession(id: string, title: string): Session | null {
	const session = getSession(id)
	if (!session) return null
	db.prepare("UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ?").run(title, Date.now(), id)
	return getSession(id)
}

export function deleteSession(id: string): boolean {
	return tx(() => {
		const info = db.prepare("DELETE FROM sessions WHERE id = ?").run(id)
		if (info.changes === 0) return false
		db.prepare("DELETE FROM messages WHERE sessionId = ?").run(id)
		db.prepare("DELETE FROM checkpoints WHERE sessionId = ?").run(id)
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(id)
		db.prepare("DELETE FROM todos WHERE sessionId = ?").run(id)
		db.prepare("DELETE FROM usage WHERE sessionId = ?").run(id)
		return true
	})
}

/** Delete a single message ("part") from a session's transcript. */
export function deleteMessage(sessionId: string, messageId: string): boolean {
	return tx(() => {
		const info = db.prepare("DELETE FROM messages WHERE id = ? AND sessionId = ?").run(messageId, sessionId)
		if (info.changes === 0) return false
		// Drop the message's file snapshots and invalidate redo (its batch may
		// reference the removed message).
		db.prepare("DELETE FROM checkpoints WHERE sessionId = ? AND messageId = ?").run(sessionId, messageId)
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(sessionId)
		touch(sessionId)
		return true
	})
}

/**
 * Fork a session into a new one, copying its transcript up to and including
 * `throughMessageId` (or the whole transcript when omitted).
 */
export function forkSession(id: string, throughMessageId?: string): Session | null {
	const source = getSession(id)
	if (!source) return null
	const srcMessages = getMessages(id)
	let slice = srcMessages
	if (throughMessageId) {
		const idx = srcMessages.findIndex((m) => m.id === throughMessageId)
		if (idx === -1) return null
		slice = srcMessages.slice(0, idx + 1)
	}
	return tx(() => {
		const fork = createSession(`${source.title} (fork)`, source.directory)
		const ins = db.prepare("INSERT INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)")
		for (const m of slice) ins.run(nanoid(), fork.id, m.role, JSON.stringify(m.content), m.createdAt)
		return fork
	})
}

export function updateSessionStatus(id: string, status: Session["status"]): void {
	db.prepare("UPDATE sessions SET status = ?, updatedAt = ? WHERE id = ?").run(status, Date.now(), id)
}

export function addMessage(sessionId: string, role: "user" | "assistant", content: string | ContentBlock[]): Message {
	const message: Message = { id: nanoid(), sessionId, role, content, createdAt: Date.now() }
	tx(() => {
		db.prepare("INSERT INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)").run(
			message.id,
			sessionId,
			role,
			JSON.stringify(content),
			message.createdAt,
		)
		// Continuing the conversation invalidates any reverted branch (redo).
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(sessionId)
	})
	return message
}

export function getMessages(sessionId: string): Message[] {
	const rows = db.prepare("SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC").all(sessionId) as unknown as MessageRow[]
	return rows.map(toMessage)
}

/**
 * Replace a session's transcript with a single summary message (compaction).
 */
export function compactSession(sessionId: string, summary: string): Message | null {
	if (!getSession(sessionId)) return null
	const message: Message = {
		id: nanoid(),
		sessionId,
		role: "assistant",
		content: `Summary of the conversation so far:\n\n${summary}`,
		createdAt: Date.now(),
	}
	tx(() => {
		db.prepare("DELETE FROM messages WHERE sessionId = ?").run(sessionId)
		db.prepare("INSERT INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)").run(
			message.id,
			sessionId,
			message.role,
			JSON.stringify(message.content),
			message.createdAt,
		)
		// Pre-compaction snapshots/redo are dead — clear them.
		db.prepare("DELETE FROM checkpoints WHERE sessionId = ?").run(sessionId)
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(sessionId)
		touch(sessionId)
	})
	return message
}

/**
 * Compact a session in place while preserving the most recent `keep` messages
 * (the current turn). Everything older is replaced by a single summary message
 * ordered just before the kept tail. Used by auto-compaction.
 */
export function compactSessionPreservingRecent(sessionId: string, summary: string, keep = 1): boolean {
	if (!getSession(sessionId)) return false
	const ordered = getMessages(sessionId)
	const tail = keep > 0 ? ordered.slice(-keep) : []
	const tailIds = new Set(tail.map((m) => m.id))
	const anchor = tail.length > 0 ? tail[0].createdAt - 1 : Date.now()
	const summaryMsg: Message = {
		id: nanoid(),
		sessionId,
		role: "assistant",
		content: `Summary of the conversation so far:\n\n${summary}`,
		createdAt: anchor,
	}
	tx(() => {
		// Delete everything except the preserved tail, then insert the summary.
		if (tailIds.size > 0) {
			const placeholders = [...tailIds].map(() => "?").join(",")
			db.prepare(`DELETE FROM messages WHERE sessionId = ? AND id NOT IN (${placeholders})`).run(sessionId, ...tailIds)
		} else {
			db.prepare("DELETE FROM messages WHERE sessionId = ?").run(sessionId)
		}
		db.prepare("INSERT INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)").run(
			summaryMsg.id,
			sessionId,
			summaryMsg.role,
			JSON.stringify(summaryMsg.content),
			summaryMsg.createdAt,
		)
		db.prepare("DELETE FROM checkpoints WHERE sessionId = ?").run(sessionId)
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(sessionId)
		touch(sessionId)
	})
	return true
}

// ── Checkpoints / revert ──────────────────────────────────────────────────

/** Record a file's before/after content around an engine edit for undo. */
export function recordSnapshot(sessionId: string, messageId: string, filePath: string, before: string | null, after: string | null): void {
	tx(() => {
		db.prepare("INSERT INTO checkpoints(sessionId,messageId,path,before,after,ts) VALUES(?,?,?,?,?,?)").run(
			sessionId,
			messageId,
			filePath,
			before,
			after,
			Date.now(),
		)
		// A fresh edit invalidates the redo stack.
		db.prepare("DELETE FROM redo WHERE sessionId = ?").run(sessionId)
	})
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

function getCheckpoints(sessionId: string): FileSnapshot[] {
	const rows = db.prepare("SELECT messageId, path, before, after, ts FROM checkpoints WHERE sessionId = ? ORDER BY ts ASC").all(sessionId) as {
		messageId: string
		path: string
		before: string | null
		after: string | null
		ts: number
	}[]
	return rows.map((r) => ({ messageId: r.messageId, path: r.path, before: r.before, after: r.after, ts: r.ts }))
}

/**
 * Revert a session back to (and including) `messageId`: undo every file change
 * made by that turn and later (restoring `before`), drop those messages, and
 * push them onto the redo stack so unrevert can replay them.
 */
export function revertSession(sessionId: string, messageId: string): { reverted: number } | null {
	const ordered = getMessages(sessionId)
	const idx = ordered.findIndex((m) => m.id === messageId)
	if (idx === -1) return null

	const removed = ordered.slice(idx)
	const removedIds = new Set(removed.map((m) => m.id))
	const affected = getCheckpoints(sessionId).filter((s) => removedIds.has(s.messageId))

	// Restore files newest-first so a file edited repeatedly ends at its earliest `before`.
	for (const snap of [...affected].sort((a, b) => b.ts - a.ts)) applyFileState(snap.path, snap.before)

	tx(() => {
		const placeholders = [...removedIds].map(() => "?").join(",")
		db.prepare(`DELETE FROM messages WHERE sessionId = ? AND id IN (${placeholders})`).run(sessionId, ...removedIds)
		db.prepare(`DELETE FROM checkpoints WHERE sessionId = ? AND messageId IN (${placeholders})`).run(sessionId, ...removedIds)
		const batch: RevertBatch = { messages: removed, snapshots: affected }
		db.prepare("INSERT INTO redo(sessionId,batch) VALUES(?,?)").run(sessionId, JSON.stringify(batch))
		touch(sessionId)
	})
	return { reverted: removed.length }
}

/** Replay the most recently reverted batch: re-apply files (`after`) and messages. */
export function unrevertSession(sessionId: string): { restored: number } | null {
	const row = db.prepare("SELECT seq, batch FROM redo WHERE sessionId = ? ORDER BY seq DESC LIMIT 1").get(sessionId) as
		| { seq: number; batch: string }
		| undefined
	if (!row) return null
	const batch = JSON.parse(row.batch) as RevertBatch

	// Re-apply oldest-first so a file's final state matches its latest `after`.
	for (const snap of [...batch.snapshots].sort((a, b) => a.ts - b.ts)) applyFileState(snap.path, snap.after)

	tx(() => {
		const insM = db.prepare("INSERT OR REPLACE INTO messages(id,sessionId,role,content,createdAt) VALUES(?,?,?,?,?)")
		for (const m of batch.messages) insM.run(m.id, sessionId, m.role, JSON.stringify(m.content), m.createdAt)
		const insC = db.prepare("INSERT INTO checkpoints(sessionId,messageId,path,before,after,ts) VALUES(?,?,?,?,?,?)")
		for (const s of batch.snapshots) insC.run(sessionId, s.messageId, s.path, s.before, s.after, s.ts)
		db.prepare("DELETE FROM redo WHERE seq = ?").run(row.seq)
		touch(sessionId)
	})
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
	const snaps = getCheckpoints(sessionId) // already ts-ascending
	const byPath = new Map<string, { before: string | null; after: string | null }>()
	for (const s of snaps) {
		const existing = byPath.get(s.path)
		if (existing) existing.after = s.after
		else byPath.set(s.path, { before: s.before, after: s.after })
	}
	const diffs: FileDiff[] = []
	for (const [p, { before, after }] of byPath) {
		if (before === after) continue
		const status = before === null ? "created" : after === null ? "deleted" : "modified"
		diffs.push({ path: p, before, after, status })
	}
	return diffs
}

// ── Todos / usage / permissions ───────────────────────────────────────────

export function setTodos(sessionId: string, todos: Todo[]): void {
	db.prepare("INSERT OR REPLACE INTO todos(sessionId,todos) VALUES(?,?)").run(sessionId, JSON.stringify(todos))
}

export function getTodos(sessionId: string): Todo[] {
	const row = db.prepare("SELECT todos FROM todos WHERE sessionId = ?").get(sessionId) as { todos: string } | undefined
	return row ? (JSON.parse(row.todos) as Todo[]) : []
}

/** Add a turn's token usage to the session total and return the new total. */
export function addUsage(sessionId: string, inputTokens: number, outputTokens: number): Usage {
	const current = getUsage(sessionId)
	const next: Usage = { inputTokens: current.inputTokens + inputTokens, outputTokens: current.outputTokens + outputTokens }
	db.prepare("INSERT OR REPLACE INTO usage(sessionId,inputTokens,outputTokens) VALUES(?,?,?)").run(sessionId, next.inputTokens, next.outputTokens)
	return next
}

export function getUsage(sessionId: string): Usage {
	const row = db.prepare("SELECT inputTokens, outputTokens FROM usage WHERE sessionId = ?").get(sessionId) as Usage | undefined
	return row ?? { inputTokens: 0, outputTokens: 0 }
}

/** True if the user previously chose "always allow" for this action in this project. */
export function matchesPermissionRule(directory: string, key: string): boolean {
	const row = db.prepare("SELECT 1 AS ok FROM permission_rules WHERE directory = ? AND key = ?").get(directory, key)
	return Boolean(row)
}

/** Remember an "always allow" decision for this project + action. */
export function addPermissionRule(directory: string, key: string): void {
	db.prepare("INSERT OR IGNORE INTO permission_rules(directory,key) VALUES(?,?)").run(directory, key)
}

export function closeDb(): void {
	try {
		db?.close()
	} catch {
		// already closed
	}
}
