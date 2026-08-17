import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { nanoid } from "nanoid"
import type { Session, Message, ContentBlock } from "./types.js"

const DATA_DIR = path.join(os.homedir(), ".local", "share", "hramble", "engine")
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json")
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json")

interface Store {
	sessions: Record<string, Session>
	messages: Record<string, Message[]>
}

let store: Store = { sessions: {}, messages: {} }

export function initDb(): void {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	if (fs.existsSync(SESSIONS_FILE)) {
		try {
			store = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"))
			if (!store.messages) store.messages = {}
		} catch {
			store = { sessions: {}, messages: {} }
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
	fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), "utf-8")
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
	persist()
	return message
}

export function getMessages(sessionId: string): Message[] {
	return (store.messages[sessionId] ?? []).sort((a, b) => a.createdAt - b.createdAt)
}

export function closeDb(): void {
	persist()
}
