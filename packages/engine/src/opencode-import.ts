import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { nanoid } from "nanoid"
import { hasOpenCodeImport, importOpenCodeSessions, type ImportSession, type ImportBlock } from "./sessions.js"

// Same runtime driver resolution as sessions.ts (node:sqlite / bun:sqlite).
type DbCtor = new (path: string) => { prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] }; close(): void }
let DatabaseCtor: DbCtor
try {
	DatabaseCtor = (await import("node:sqlite")).DatabaseSync as unknown as DbCtor
} catch {
	const bunSqlite = "bun:sqlite"
	DatabaseCtor = (await import(bunSqlite)).Database as unknown as DbCtor
}

function opencodeDbPath(): string {
	return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")
}

interface OcRow {
	id: string
	title: string
	directory: string
	time_created: number
	time_updated: number
}

/**
 * Read the user's OpenCode sessions (its own SQLite store) and map them to the
 * engine's transcript format. Works on a COPY so the live DB the app holds open
 * is never touched. Returns null if there is no OpenCode store.
 */
export function readOpenCodeSessions(): ImportSession[] | null {
	const src = opencodeDbPath()
	if (!fs.existsSync(src)) return null

	const tmp = path.join(os.tmpdir(), `oc-import-${nanoid(6)}`)
	fs.mkdirSync(tmp, { recursive: true })
	const copy = path.join(tmp, "opencode.db")
	try {
		// Copy the DB plus its WAL/SHM so the snapshot includes uncheckpointed writes.
		for (const suffix of ["", "-wal", "-shm"]) {
			if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, copy + suffix)
		}
		const db = new DatabaseCtor(copy)
		const sessions = db.prepare("SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_created ASC").all() as unknown as OcRow[]
		const msgStmt = db.prepare("SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC")
		const partStmt = db.prepare("SELECT id, data, time_created FROM part WHERE message_id = ? ORDER BY time_created ASC")

		const result: ImportSession[] = []
		for (const s of sessions) {
			const messages: ImportSession["messages"] = []
			const rawMsgs = msgStmt.all(s.id) as unknown as Array<{ id: string; data: string; time_created: number }>
			for (const rm of rawMsgs) {
				let mdata: { role?: string } = {}
				try {
					mdata = JSON.parse(rm.data)
				} catch {
					// keep default (user)
				}
				const role: "user" | "assistant" = mdata.role === "assistant" ? "assistant" : "user"

				const blocks: ImportBlock[] = []
				const toolResults: ImportBlock[] = []
				const parts = partStmt.all(rm.id) as unknown as Array<{ data: string }>
				for (const p of parts) {
					let d: Record<string, unknown>
					try {
						d = JSON.parse(p.data) as Record<string, unknown>
					} catch {
						continue
					}
					if (d.type === "text" && typeof d.text === "string" && d.text) {
						blocks.push({ type: "text", text: d.text })
					} else if (d.type === "tool" && typeof d.callID === "string") {
						const st = (d.state ?? {}) as { status?: string; input?: Record<string, unknown>; output?: unknown; error?: string }
						blocks.push({ type: "tool_use", id: d.callID, name: typeof d.tool === "string" ? d.tool : "tool", input: st.input ?? {} })
						const out = st.status === "error" ? (st.error ?? "error") : typeof st.output === "string" ? st.output : JSON.stringify(st.output ?? "")
						toolResults.push({ type: "tool_result", tool_use_id: d.callID, content: out, is_error: st.status === "error" || undefined })
					} else if (d.type === "file" && typeof d.url === "string" && d.url.startsWith("data:") && String(d.mime ?? "").startsWith("image/")) {
						const comma = d.url.indexOf(",")
						const meta = d.url.slice(5, comma)
						if (meta.includes("base64")) blocks.push({ type: "image", mimeType: String(d.mime), data: d.url.slice(comma + 1) })
					}
					// reasoning / step-start / step-finish / patch are dropped (internal).
				}

				if (blocks.length) messages.push({ id: rm.id, role, content: blocks, createdAt: rm.time_created })
				// Tool outputs live on a following user turn (engine transcript shape),
				// so the tool_use blocks have their matching tool_result.
				if (toolResults.length) messages.push({ id: `${rm.id}-tr`, role: "user", content: toolResults, createdAt: rm.time_created + 1 })
			}

			if (messages.length) {
				result.push({
					id: s.id,
					title: s.title || "Untitled",
					directory: s.directory,
					createdAt: s.time_created,
					updatedAt: s.time_updated,
					messages,
				})
			}
		}
		db.close()
		return result
	} finally {
		try {
			fs.rmSync(tmp, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	}
}

/**
 * One-time import of OpenCode sessions into the engine store. Idempotent: skips
 * entirely once any OpenCode-sourced session (id "ses_…") is already present.
 */
export function maybeImportOpenCode(): void {
	try {
		if (hasOpenCodeImport()) return
		const sessions = readOpenCodeSessions()
		if (!sessions || sessions.length === 0) return
		const n = importOpenCodeSessions(sessions)
		if (n > 0) console.log(`[zyot-engine] imported ${n} session(s) from OpenCode`)
	} catch (err) {
		console.error(`[zyot-engine] OpenCode import skipped: ${err instanceof Error ? err.message : err}`)
	}
}
