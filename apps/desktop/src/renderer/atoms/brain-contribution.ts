import { atom } from "jotai"
import { atomFamily } from "jotai-family"

/**
 * What the Brain actually contributed to a given chat session — surfaced from
 * the Layer 2 (Auto-Recall) + Layer 3 (Episodic Memory) results computed on the
 * FIRST message of the session (see hooks/use-server.ts). This is a DISPLAY
 * mirror only: it does not change what gets injected into the agent prompt, it
 * just records the same items so the docked-Brain header can show them.
 */
export type BrainContribution = {
	kind: "skill" | "repo" | "docs" | "tool" | "model" | "connector" | "episode"
	label: string
	detail?: string
}

/**
 * Per-session Brain contributions. Empty array = nothing recalled (or recall is
 * off) — the header then shows the slim "aware of your whole library" state.
 */
export const brainContributionFamily = atomFamily((_sessionId: string) =>
	atom<BrainContribution[]>([]),
)
