/**
 * Brain — a local, growing library of taught skills and tools, separate from
 * Code, Hyperloop, and Home. Its own session(s), powered by the "general"
 * agent in a dedicated brain directory (no repo). See components/brain-page.tsx.
 */
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { isBrainDir } from "./derived/agents"
import { sessionFamily, sessionIdsAtom } from "./sessions"

/** The current Brain session id (null = show the opening screen). */
export const brainSessionAtom = atomWithStorage<string | null>("hramble:brainSession", null)

/** Past Brain session ids (newest first) — for a future Brain history list. */
export const brainSessionIdsAtom = atomWithStorage<string[]>("hramble:brainSessions", [])

/**
 * The Brain history list: brain-chat sessions from the live store (by directory),
 * most-recent first, merged with any locally-remembered ids not yet in the store.
 * Sourcing from the store (not just localStorage) means engine-created brain
 * sessions actually appear on the Brain page.
 */
export const brainSessionListAtom = atom((get) => {
	const fromStore: Array<{ id: string; updated: number }> = []
	for (const id of get(sessionIdsAtom)) {
		const entry = get(sessionFamily(id))
		if (entry && isBrainDir(entry.directory)) {
			fromStore.push({ id, updated: entry.session.time.updated ?? entry.session.time.created ?? 0 })
		}
	}
	fromStore.sort((a, b) => b.updated - a.updated)

	const merged: string[] = []
	const seen = new Set<string>()
	for (const { id } of fromStore) {
		if (!seen.has(id)) {
			seen.add(id)
			merged.push(id)
		}
	}
	for (const id of get(brainSessionIdsAtom)) {
		if (!seen.has(id)) {
			seen.add(id)
			merged.push(id)
		}
	}
	return merged
})
