/**
 * Dispatch — a standing, paired phone connection to Hramble (unlike per-session
 * Live Share, which mints a fresh one-off link every time). Modeled on
 * Claude's own "Dispatch": pair once, then any message from the phone reaches
 * Hramble without re-sharing a link, and all phone messages land in one
 * persistent session — "one conversation from anywhere" — rather than
 * spawning a new session per message.
 */
import { atomWithStorage } from "jotai/utils"

export interface DispatchSessionRef {
	directory: string
	sessionId: string
}

/** Stable pairing token for the phone's standing connection. Null until the user pairs; set once and reused across restarts. "Unpair" clears it (tears down the bridge) and re-pairing mints a new one, invalidating the old link. */
export const dispatchPairTokenAtom = atomWithStorage<string | null>("hramble:dispatchPairToken", null)

/** The one ongoing session phone-dispatched messages land in. Created on the first phone message after pairing, then reused — matches "pick up exactly where you left off" instead of a fresh session per message. */
export const dispatchSessionRefAtom = atomWithStorage<DispatchSessionRef | null>("hramble:dispatchSessionRef", null)
