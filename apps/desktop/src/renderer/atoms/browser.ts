import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// Browser pane state — a visible embedded browser docked as a right-side panel
// (like the File Explorer / Review panel) that the agent can also drive.
export const browserPanelOpenAtom = atom(false)
export const browserUrlAtom = atom("https://www.google.com")

/**
 * When true (default), agent browser actions (open, screenshot, click, …) pop
 * the browser panel open automatically. When false, the agent can still drive
 * the browser silently (it stays mounted at 0 width) but the panel only opens
 * when the user clicks the globe button. Persisted across sessions.
 */
export const browserAutoOpenAtom = atomWithStorage<boolean>("hramble:browserAutoOpen", true)

/** Browser panel width as a percentage of window width. Drag-resizable, persisted. */
export const browserPanelWidthAtom = atomWithStorage<number>("hramble:browserPanelWidth", 45)
