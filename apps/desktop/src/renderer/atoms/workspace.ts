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

/** Session ids that were started in Hyperloop mode (persisted). */
export const hyperloopSessionIdsAtom = atomWithStorage<string[]>("hramble:hyperloopSessions", [])

/** Tag a session as a Hyperloop run. */
export function markHyperloopSession(sessionId: string) {
	const cur = appStore.get(hyperloopSessionIdsAtom)
	if (!cur.includes(sessionId)) appStore.set(hyperloopSessionIdsAtom, [...cur, sessionId])
}

/** Fast membership set derived from the persisted list. */
export const hyperloopSessionSetAtom = atom((get) => new Set(get(hyperloopSessionIdsAtom)))
