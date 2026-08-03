/**
 * Home chat — a general Claude-style assistant page, separate from Code and
 * Hyperloop. Its own session(s), powered by the "general" agent in a dedicated
 * home directory (no repo). See components/home-chat.tsx.
 */
import { atomWithStorage } from "jotai/utils"

/** The current Home chat session id (null = show the opening screen). */
export const homeSessionAtom = atomWithStorage<string | null>("hramble:homeSession", null)

/** Past Home chat session ids (newest first) — for a future Home history list. */
export const homeSessionIdsAtom = atomWithStorage<string[]>("hramble:homeSessions", [])
