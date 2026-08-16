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

export function listSessions(directory?: string): Session[] {
	const all = Object.values(store.sessions)
	const filtered = directory ? all.filter((s) => s.directory === directory) : all
	return filtered.sort((a, b) => b.updatedAt - a.updatedAt)
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
