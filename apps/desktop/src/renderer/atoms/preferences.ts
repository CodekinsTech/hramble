import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { WindowChromeTier } from "../../preload/api"
import type { CompanionStyle } from "../lib/companion-phrases"
import type { ColorScheme } from "../lib/themes"

// ============================================================
// Types
// ============================================================

export type DisplayMode = "default" | "verbose"

// "default" = today's behavior, active sessions first then most-recent.
// "numbered" = stable order by when each session was created, but whichever
//   one is actively working is pinned to the top.
// "date" = grouped under Today / Yesterday / Previous 7 Days / Older headers.
export type SessionSortMode = "default" | "numbered" | "date"

export interface PersistedModelRef {
	providerID: string
	modelID: string
	variant?: string
	agent?: string
}

// ============================================================
// One-time migration from Zustand persist to Jotai atomWithStorage
// ============================================================

function migrateFromZustandPersist(): void {
	const oldKey = "palot-preferences"
	const raw = localStorage.getItem(oldKey)
	if (!raw) return

	try {
		const { state } = JSON.parse(raw) // Zustand persist wraps in { state, version }
		if (state.displayMode)
			localStorage.setItem("hramble:displayMode", JSON.stringify(state.displayMode))
		if (state.theme) localStorage.setItem("hramble:theme", JSON.stringify(state.theme))
		if (state.colorScheme)
			localStorage.setItem("hramble:colorScheme", JSON.stringify(state.colorScheme))
		if (state.drafts) localStorage.setItem("hramble:drafts", JSON.stringify(state.drafts))
		if (state.projectModels)
			localStorage.setItem("hramble:projectModels", JSON.stringify(state.projectModels))

		// Remove old key after successful migration
		localStorage.removeItem(oldKey)
	} catch {
		// Ignore malformed data
	}
}

// Run migration at module load time (before any atoms are read)
migrateFromZustandPersist()

// Migrate removed "compact" display mode to "default"
function migrateDisplayMode(): void {
	const raw = localStorage.getItem("hramble:displayMode")
	if (raw === '"compact"') {
		localStorage.setItem("hramble:displayMode", '"default"')
	}
}
migrateDisplayMode()

// ============================================================
// Persisted atoms — each is independent with its own localStorage key
// ============================================================

export const displayModeAtom = atomWithStorage<DisplayMode>("hramble:displayMode", "default")

export const sessionSortModeAtom = atomWithStorage<SessionSortMode>("hramble:sessionSortMode", "default")

export const themeAtom = atomWithStorage<string>("hramble:theme", "default")

export const colorSchemeAtom = atomWithStorage<ColorScheme>("hramble:colorScheme", "light")

/**
 * Whether the companion (avatar) box is collapsed into a compact bar. On by
 * default it's expanded (shows the live VRM avatar); collapsing shrinks the
 * docked box for a cleaner coding view. Collapsing only hides the VISUAL box —
 * the companion component stays mounted, so its narration/notify behavior
 * (e.g. speaking when a Hyperloop run finishes) still fires while collapsed.
 */
export const companionCollapsedAtom = atomWithStorage<boolean>("hramble:companionCollapsed", false)

/**
 * Whether the companion has ever been activated. Off by default — the
 * companion box isn't mounted at all (no narration, no VRM, nothing) until
 * the user activates it (Store page → "Get your AI assistant"). Once true,
 * it stays true forever, and companionCollapsedAtom takes over from there.
 */
export const companionActivatedAtom = atomWithStorage<boolean>("hramble:companionActivated", false)

/**
 * The companion's persona/voice style — "chill", "smart", or "buddy". Controls
 * which phrase set the avatar speaks on greeting (unmute) and on task-done.
 * Defaults to "buddy" (the warmest set). Phrases live in lib/companion-phrases.
 */
// Key bumped to :v2 when the "chill" persona was removed, so any stored "chill"
// value is dropped and everyone falls back to the "buddy" default.
export const companionStyleAtom = atomWithStorage<CompanionStyle>("hramble:companionStyle:v2", "buddy")

/**
 * Whether the user prefers opaque (non-transparent) windows.
 * When true, the renderer uses solid backgrounds instead of semi-transparent.
 */
export const opaqueWindowsAtom = atomWithStorage<boolean>("hramble:opaqueWindows", false)

/**
 * The active window chrome tier, set by the main process on load.
 * "liquid-glass" = macOS 26+, "vibrancy" = older macOS, "opaque" = non-macOS or user pref.
 * Defaults to "opaque" for browser-mode dev (no Electron).
 */
export const chromeTierAtom = atom<WindowChromeTier>("opaque")

/**
 * Whether the window has any form of transparency (liquid glass or vibrancy).
 * Used by CSS to decide between semi-transparent and solid backgrounds.
 */
export const isTransparentAtom = atom((get) => {
	const tier = get(chromeTierAtom)
	const opaque = get(opaqueWindowsAtom)
	return !opaque && (tier === "liquid-glass" || tier === "vibrancy")
})

export const draftsAtom = atomWithStorage<Record<string, string>>("hramble:drafts", {})

export const projectModelsAtom = atomWithStorage<Record<string, PersistedModelRef>>(
	"hramble:projectModels",
	{},
)

/**
 * Whether the user has dismissed the automations permissions info banner.
 * Once dismissed, the banner never reappears.
 */
export const automationsBannerDismissedAtom = atomWithStorage<boolean>(
	"hramble:automationsBannerDismissed",
	false,
)

// ============================================================
// Derived atoms for drafts
// ============================================================

/** Read a draft for a specific key */
export const readDraftAtom = (key: string) => atom((get) => get(draftsAtom)[key] ?? "")

/** Set a draft for a specific key (write-only action atom) */
export const setDraftAtom = atom(null, (get, set, args: { key: string; text: string }) => {
	const drafts = { ...get(draftsAtom) }
	if (args.text) {
		drafts[args.key] = args.text
	} else {
		delete drafts[args.key]
	}
	set(draftsAtom, drafts)
})

/** Clear a draft (write-only action atom) */
export const clearDraftAtom = atom(null, (get, set, key: string) => {
	const drafts = { ...get(draftsAtom) }
	delete drafts[key]
	set(draftsAtom, drafts)
})

/** Set a project model (write-only action atom) */
export const setProjectModelAtom = atom(
	null,
	(
		get,
		set,
		args: {
			directory: string
			model: PersistedModelRef
		},
	) => {
		const models = { ...get(projectModelsAtom) }
		models[args.directory] = {
			providerID: args.model.providerID,
			modelID: args.model.modelID,
			variant: args.model.variant,
			agent: args.model.agent,
		}
		set(projectModelsAtom, models)
	},
)
