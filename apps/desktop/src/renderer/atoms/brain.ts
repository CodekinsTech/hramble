/**
 * Brain — a local, growing library of taught skills and tools, separate from
 * Code, Hyperloop, and Home. Its own session(s), powered by the "general"
 * agent in a dedicated brain directory (no repo). See components/brain-page.tsx.
 */
import { atomWithStorage } from "jotai/utils"

/** The current Brain session id (null = show the opening screen). */
export const brainSessionAtom = atomWithStorage<string | null>("hramble:brainSession", null)

/** Past Brain session ids (newest first) — for a future Brain history list. */
export const brainSessionIdsAtom = atomWithStorage<string[]>("hramble:brainSessions", [])
