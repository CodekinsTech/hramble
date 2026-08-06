/**
 * Live Share — the desktop-app side of the relay in apps/session-relay/.
 * Connects to the Durable Object room as the "host": forwards a simplified,
 * text-only snapshot of the session whenever it changes, plus what's
 * currently in the browser pane (see browser-pane-bridge.ts), and reports
 * incoming viewer messages back to the caller (who injects them into the
 * real session via the same sendPrompt() the composer itself uses).
 *
 * The chat feed is deliberately text-only — not a full replica of Hramble's
 * rich tool-call UI. Visual output (artifacts, previews) rides a separate
 * "screen" message instead of being squeezed into that text feed.
 */
import { type BrowserPaneContent, getBrowserPaneContent } from "./browser-pane-bridge"
import type { Message, Part } from "./types"

// Public by design — same pattern as community-config.ts's apiBase; no secret involved.
const RELAY_BASE = "hramble-session-relay.hramble-community-api.workers.dev"

/** The viewer URL for a given room token — used by both per-session Live Share and the Dispatch pairing UI. */
export function shareUrlForRoom(roomToken: string): string {
	return `https://${RELAY_BASE}/?room=${roomToken}`
}

export interface ShareEvent {
	id: string
	role: "user" | "assistant"
	text: string
}

/** One entry in the phone's session-switcher list — see DispatchSessionSummary usage in use-dispatch-bridge.ts. */
export interface DispatchSessionSummary {
	id: string
	title: string
	project: string
	directory: string
	lastActiveAt: number
}

function partsToText(parts: Part[]): string {
	return parts
		.map((p) => {
			if (p.type === "text") return p.text
			if (p.type === "tool") return `[used tool: ${p.tool}]`
			if (p.type === "file") return `[attached: ${p.filename}]`
			return ""
		})
		.filter(Boolean)
		.join("\n")
}

/** Builds the flat, text-only event list a viewer's browser can render directly. */
export function buildSnapshot(messages: Message[], getParts: (messageId: string) => Part[]): ShareEvent[] {
	return messages
		.map((m) => ({ id: m.id, role: m.role, text: partsToText(getParts(m.id)) }))
		.filter((e) => e.text.trim().length > 0)
}

export interface ShareHost {
	url: string
	roomToken: string
	stop: () => void
}

/**
 * Opens a host connection to a share room. `onViewerMessage` fires whenever
 * someone watching sends a message in; `sendSnapshot(events)` pushes the
 * current state out (call it once immediately, then again whenever the
 * mirrored session's messages/parts change).
 *
 * `roomToken` defaults to a fresh one-off link (per-session Live Share).
 * Pass a stable, persisted token instead for a standing paired connection
 * (Dispatch) that doesn't need re-sharing every time.
 */
export function startShareHost(
	accessToken: string,
	onViewerMessage: (text: string) => void,
	roomToken: string = crypto.randomUUID(),
	onSelectSession?: (sessionId: string) => void,
): ShareHost & {
	sendSnapshot: (events: ShareEvent[]) => void
	sendScreen: (content: BrowserPaneContent) => void
	sendSessionList: (sessions: DispatchSessionSummary[]) => void
} {
	// A dropped connection (network blip, relay redeploy, Mac sleep/wake)
	// shouldn't need an app restart to recover — reconnect automatically,
	// same as the viewer page already does on its side.
	let ws: WebSocket
	let stopped = false
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null

	function connect() {
		ws = new WebSocket(
			`wss://${RELAY_BASE}/parties/session-room/${roomToken}?role=host&token=${encodeURIComponent(accessToken)}`,
		)
		ws.onmessage = (event) => {
			if (typeof event.data !== "string") return
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "viewer-message" && typeof msg.text === "string") onViewerMessage(msg.text)
				if (msg.type === "select-session" && typeof msg.sessionId === "string") onSelectSession?.(msg.sessionId)
			} catch {
				// Ignore malformed frames.
			}
		}
		ws.onclose = () => {
			if (stopped) return
			reconnectTimer = setTimeout(connect, 2000)
		}
	}
	connect()

	function sendSnapshot(events: ShareEvent[]) {
		if (ws.readyState !== WebSocket.OPEN) return
		ws.send(JSON.stringify({ type: "snapshot", state: events }))
	}

	function sendScreen(content: BrowserPaneContent) {
		if (ws.readyState !== WebSocket.OPEN) return
		ws.send(JSON.stringify({ type: "screen", content }))
	}

	function sendSessionList(sessions: DispatchSessionSummary[]) {
		if (ws.readyState !== WebSocket.OPEN) return
		ws.send(JSON.stringify({ type: "session-list", sessions }))
	}

	return {
		url: `https://${RELAY_BASE}/?room=${roomToken}`,
		roomToken,
		sendSnapshot,
		sendScreen,
		sendSessionList,
		stop: () => {
			stopped = true
			if (reconnectTimer) clearTimeout(reconnectTimer)
			ws.close()
		},
	}
}

/**
 * Tracks the last-sent browser-pane content so callers can poll cheaply
 * (e.g. on the same interval as the chat snapshot) without re-sending the
 * same artifact/URL/screenshot every tick. An "html" or "url" kind only
 * needs sending once per change — once the viewer has the code or the
 * address, it runs/loads it on its own. A "screenshot" naturally resends
 * whenever the captured pixels differ.
 */
export function createScreenDedupe(): { pushIfChanged: (send: (content: BrowserPaneContent) => void) => Promise<void> } {
	let lastSent: string | null = null
	return {
		async pushIfChanged(send) {
			const content = await getBrowserPaneContent()
			if (!content) return
			const serialized = JSON.stringify(content)
			if (serialized === lastSent) return
			lastSent = serialized
			send(content)
		},
	}
}
