import { atom } from "jotai"

// Browser pane state — a visible embedded browser docked as a right-side panel
// (like the File Explorer / Review panel) that the agent can also drive.
export const browserPanelOpenAtom = atom(false)
export const browserUrlAtom = atom("https://www.google.com")
