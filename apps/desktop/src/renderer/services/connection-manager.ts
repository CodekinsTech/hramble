import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { serverConnectedAtom } from "../atoms/connection"
import {
	SESSIONS_PAGE_SIZE,
	setProjectPaginationLoadingAtom,
	setSessionsAtom,
	updateProjectPaginationAtom,
} from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"
import type { OpenCodeProject, Session, SessionStatus } from "../lib/types"
import { engineConnectedAtom } from "../atoms/engine"
import { processEngineEvent } from "./engine-event-processor"
import { openEngineEventStream, listEngineSessions, listEngineProjects } from "./engine-client"
import { engineSessionToSession, engineSessionStatus, engineProjectToProject } from "./engine-history"

const log = createLogger("connection-manager")

// The zyot engine is the sole backend. The legacy OpenCode server connection, its
// SSE event loop, and the per-project client pool have been removed — the client
// accessors below are inert stubs kept only until the last OpenCode call sites are
// deleted (each already gates on engineConnectedAtom and ignores the result).

// ── Projects / sessions (engine) ────────────────────────────────────────────

export async function loadAllProjects(): Promise<OpenCodeProject[]> {
	try {
		const eps = await listEngineProjects()
		log.info("Loaded projects from engine", { count: eps.length })
		return eps.map(engineProjectToProject)
	} catch (err) {
		log.error("Failed to load engine projects", err)
		return []
	}
}

export async function loadProjectSessions(
	directory: string,
	sandboxDirs?: Set<string>,
	options?: { limit?: number; roots?: boolean; search?: string },
): Promise<void> {
	if (options?.limit) appStore.set(setProjectPaginationLoadingAtom, directory)
	try {
		const es = await listEngineSessions({ directory, search: options?.search, limit: options?.limit })
		const sessions = es.map(engineSessionToSession)
		const statuses: Record<string, SessionStatus> = {}
		for (const s of es) statuses[s.id] = engineSessionStatus(s)
		appStore.set(setSessionsAtom, { sessions, statuses, directory, sandboxDirs })
		if (options?.limit) appStore.set(updateProjectPaginationAtom, { directory, fetchedCount: es.length, limit: options.limit })
	} catch (err) {
		log.error("Failed to load engine sessions", { directory }, err)
		if (options?.limit) appStore.set(updateProjectPaginationAtom, { directory, fetchedCount: 0, limit: options.limit })
	}
}

export async function loadMoreProjectSessions(directory: string, currentLimit: number): Promise<void> {
	const nextLimit = currentLimit + SESSIONS_PAGE_SIZE
	log.info("Loading more sessions", { directory, currentLimit, nextLimit })
	appStore.set(setProjectPaginationLoadingAtom, directory)
	try {
		const es = await listEngineSessions({ directory, limit: nextLimit })
		const sessions = es.map(engineSessionToSession)
		const statuses: Record<string, SessionStatus> = {}
		for (const s of es) statuses[s.id] = engineSessionStatus(s)
		appStore.set(setSessionsAtom, { sessions, statuses, directory })
		appStore.set(updateProjectPaginationAtom, { directory, fetchedCount: es.length, limit: nextLimit })
	} catch (err) {
		log.error("Failed to load more engine sessions", { directory }, err)
		appStore.set(updateProjectPaginationAtom, { directory, fetchedCount: currentLimit, limit: currentLimit })
	}
}

// ── Legacy OpenCode client accessors (inert stubs) ──────────────────────────
// Return null now; every remaining call site gates on engineConnectedAtom (always
// true) and never uses the result. Removed with the OpenCode call sites.

export function getProjectClient(_directory: string): OpencodeClient | null {
	return null
}

export function getBaseClient(): OpencodeClient | null {
	return null
}

export async function fetchSessionById(_sessionId: string): Promise<Session | null> {
	return null
}

export function isConnected(): boolean {
	return appStore.get(engineConnectedAtom)
}

export function getServerUrl(): string | null {
	return null
}

export async function reloadConfig(): Promise<void> {
	// No-op: the engine reads config per request; nothing to dispose.
}

export function disconnect(): void {
	appStore.set(serverConnectedAtom, false)
}

// ── zyot engine connection ───────────────────────────────────────────────────

let engineEventSource: EventSource | null = null

/**
 * Open the SSE connection to the zyot engine and process its events. Resolves on
 * open (or a 4s timeout) so discovery can await the engine before loading.
 */
export function connectToEngine(): Promise<boolean> {
	if (engineEventSource) {
		engineEventSource.close()
		engineEventSource = null
		appStore.set(engineConnectedAtom, false)
	}
	log.info("Connecting to zyot engine SSE stream")
	const es = openEngineEventStream()
	engineEventSource = es
	return new Promise<boolean>((resolve) => {
		let settled = false
		const settle = (v: boolean) => {
			if (!settled) {
				settled = true
				resolve(v)
			}
		}
		es.addEventListener("open", () => {
			log.info("zyot engine SSE connected")
			appStore.set(engineConnectedAtom, true)
			settle(true)
		})
		es.addEventListener("message", (evt) => {
			try {
				processEngineEvent(JSON.parse(evt.data))
			} catch (err) {
				log.error("Failed to parse engine event", err, evt.data)
			}
		})
		es.addEventListener("error", () => {
			// EventSource auto-reconnects; keep engineConnectedAtom true once opened.
			log.warn("zyot engine SSE error (auto-reconnecting)")
		})
		setTimeout(() => settle(false), 4000)
	})
}

export function disconnectEngine(): void {
	if (engineEventSource) {
		engineEventSource.close()
		engineEventSource = null
	}
	appStore.set(engineConnectedAtom, false)
}
