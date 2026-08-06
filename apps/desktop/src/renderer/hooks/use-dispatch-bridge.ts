/**
 * Dispatch bridge — the always-on counterpart to per-session Live Share.
 * Mounted once at the app shell (see sidebar-layout.tsx), it opens a standing
 * host connection on the user's stable, persisted pairing token whenever
 * they've paired a phone (atoms/dispatch.ts), so a phone message reaches
 * Hramble without the desktop needing to open or re-share anything.
 *
 * All phone messages land in one persistent session (created on first use,
 * then reused) rather than spawning a new session per message — "one
 * conversation from anywhere," matching Dispatch's own model.
 */
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import { agentsAtom, projectListAtom } from "../atoms/derived/agents"
import { communityAccessTokenAtom } from "../atoms/community"
import { dispatchPairTokenAtom, dispatchSessionRefAtom } from "../atoms/dispatch"
import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { sessionFamily } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import type { BrowserPaneContent } from "../lib/browser-pane-bridge"
import {
	buildSnapshot,
	createScreenDedupe,
	type DispatchSessionSummary,
	type ShareEvent,
	startShareHost,
} from "../lib/share-client"
import { useAgentActions } from "./use-server"

export function useDispatchBridge(): void {
	const pairToken = useAtomValue(dispatchPairTokenAtom)
	const accessToken = useAtomValue(communityAccessTokenAtom)
	const { createSession, sendPrompt } = useAgentActions()

	const sendSnapshotRef = useRef<((events: ShareEvent[]) => void) | null>(null)
	const sendScreenRef = useRef<((content: BrowserPaneContent) => void) | null>(null)
	const sendSessionListRef = useRef<((sessions: DispatchSessionSummary[]) => void) | null>(null)
	const mirrorUnsubRef = useRef<(() => void) | null>(null)
	const mirroringSessionIdRef = useRef<string | null>(null)

	const mirrorSession = useCallback((sessionId: string) => {
		if (mirroringSessionIdRef.current === sessionId) return
		mirroringSessionIdRef.current = sessionId
		mirrorUnsubRef.current?.()

		const screenDedupe = createScreenDedupe()
		const push = () => {
			const messages = appStore.get(messagesFamily(sessionId))
			sendSnapshotRef.current?.(buildSnapshot(messages, (id) => appStore.get(partsFamily(id))))
			if (sendScreenRef.current) screenDedupe.pushIfChanged(sendScreenRef.current)
		}
		push()
		const unsubMessages = appStore.sub(messagesFamily(sessionId), push)
		const interval = setInterval(push, 1500)
		mirrorUnsubRef.current = () => {
			unsubMessages()
			clearInterval(interval)
		}
	}, [])

	const reportError = useCallback((text: string) => {
		sendSnapshotRef.current?.([{ id: `dispatch-error-${Date.now()}`, role: "assistant", text }])
	}, [])

	/** Pushes the full cross-project session list — same "/" bucket exclusion and
	 *  sub-agent exclusion as the sidebar (see projectSessionIdsFamily), sorted
	 *  most-recently-active first so the phone's list matches desktop ordering. */
	const pushSessionList = useCallback(() => {
		if (!sendSessionListRef.current) return
		const sessions: DispatchSessionSummary[] = appStore
			.get(agentsAtom)
			.filter((a) => !a.parentId && a.directory !== "/")
			.map((a) => ({
				id: a.sessionId,
				title: a.name,
				project: a.project,
				directory: a.directory,
				lastActiveAt: a.lastActiveAt,
			}))
			.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
		sendSessionListRef.current(sessions)
	}, [])

	/** A phone tapping a session in the list — switch Dispatch's standing
	 *  session to it and start mirroring, same as picking up an existing
	 *  conversation rather than always starting a fresh one. */
	const handleSelectSession = useCallback(
		(sessionId: string) => {
			const entry = appStore.get(sessionFamily(sessionId))
			if (!entry) {
				reportError("That session isn't available anymore.")
				return
			}
			appStore.set(dispatchSessionRefAtom, { directory: entry.directory, sessionId })
			mirrorSession(sessionId)
		},
		[mirrorSession, reportError],
	)

	const handleViewerMessage = useCallback(
		async (text: string) => {
			let ref = appStore.get(dispatchSessionRefAtom)
			if (!ref) {
				// Exclude the "/" global bucket (OpenCode's no-project-picked namespace,
				// e.g. Home chat) — a real project directory only, never filesystem root.
				// Try candidates in most-recently-active order — a project whose folder
				// was since moved/deleted fails createSession, so fall through to the
				// next real one instead of giving up on the first pick.
				const candidates = appStore.get(projectListAtom).filter((p) => p.directory !== "/")
				if (candidates.length === 0) {
					reportError("No project is open in Hramble yet — open one on your desktop first, then try again.")
					return
				}
				for (const candidate of candidates) {
					try {
						const session = await createSession(candidate.directory)
						if (session) {
							ref = { directory: candidate.directory, sessionId: session.id }
							break
						}
					} catch {
						// This project's connection is likely dead (e.g. its folder no
						// longer exists) — try the next most-recently-active one.
					}
				}
				if (!ref) {
					reportError(
						"Couldn't start a task in any open project — make sure at least one project folder still exists, then try again.",
					)
					return
				}
				appStore.set(dispatchSessionRefAtom, ref)
			}
			mirrorSession(ref.sessionId)
			try {
				await sendPrompt(ref.directory, ref.sessionId, text)
			} catch {
				reportError("Something went wrong sending that to Hramble — try again.")
			}
		},
		[createSession, sendPrompt, mirrorSession, reportError],
	)

	useEffect(() => {
		if (!pairToken || !accessToken) return

		const host = startShareHost(
			accessToken,
			(text) => handleViewerMessage(text),
			pairToken,
			(sessionId) => handleSelectSession(sessionId),
		)
		sendSnapshotRef.current = host.sendSnapshot
		sendScreenRef.current = host.sendScreen
		sendSessionListRef.current = host.sendSessionList

		const existingRef = appStore.get(dispatchSessionRefAtom)
		if (existingRef) mirrorSession(existingRef.sessionId)

		pushSessionList()
		const unsubAgents = appStore.sub(agentsAtom, pushSessionList)
		const sessionListInterval = setInterval(pushSessionList, 3000)

		return () => {
			mirrorUnsubRef.current?.()
			mirrorUnsubRef.current = null
			mirroringSessionIdRef.current = null
			sendSnapshotRef.current = null
			sendScreenRef.current = null
			sendSessionListRef.current = null
			unsubAgents()
			clearInterval(sessionListInterval)
			host.stop()
		}
	}, [pairToken, accessToken, handleViewerMessage, handleSelectSession, mirrorSession, pushSessionList])
}
