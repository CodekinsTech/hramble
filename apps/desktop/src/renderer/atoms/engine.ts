import { atom } from "jotai"

/**
 * Tracks the xot engine connection state.
 */
export const engineConnectedAtom = atom(false)
export const engineUrlAtom = atom<string | null>(null)

/**
 * Pending permission request from the engine — shown as a modal in the UI.
 */
export interface EnginePermissionRequest {
	id: string
	sessionId: string
	tool: string
	input: Record<string, unknown>
	description: string
}

export const enginePermissionsAtom = atom<Record<string, EnginePermissionRequest>>({})
