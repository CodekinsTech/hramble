import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { ModelRef } from "../hooks/use-opencode-data"
import { appStore } from "./store"

// ============================================================
// Session Settings (Atomic per session)
// ============================================================

export interface SessionChatSettings {
	selectedModel: ModelRef | null
	selectedAgent: string | null
	selectedVariant: string | undefined
}

/**
 * Persisted chat settings per session.
 * Seeded from project preferences, but overrides are session-specific.
 */
export const sessionSettingsAtom = atomFamily((_sessionId: string) =>
	atom<SessionChatSettings>({
		selectedModel: null,
		selectedAgent: null,
		selectedVariant: undefined,
	}),
)

/**
 * Global timer for live-updating UI (durations, elapsed time).
 * Updates once per second.
 */
export const nowAtom = atom(Date.now())

if (typeof window !== "undefined") {
	setInterval(() => {
		appStore.set(nowAtom, Date.now())
	}, 1000)
}

/**
 * Steps queued from the new-chat screen, keyed by session ID.
 * When new-chat starts a session with steps filled in, it writes here.
 * chat-view reads on mount, initialises its steps state, then clears the entry.
 * autoRun: true means chat-view should immediately start running all steps.
 */
export const pendingSessionStepsAtom = atom<Record<string, { steps: string[]; autoRun: boolean }>>({})
