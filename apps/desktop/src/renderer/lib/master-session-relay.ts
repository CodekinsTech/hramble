/**
 * Master Session Canvas relay — the actual "share over wifi" backend. Reuses
 * the same session-relay Worker/Durable Object as Live Share and Bridge (see
 * share-client.ts/bridge-client.ts) rather than standing up new
 * infrastructure: every teammate opens a viewer connection to a room keyed
 * by the team id, and whoever sets the shared dev-server URL briefly opens a
 * host connection to broadcast it. The relay persists the last "screen"
 * message per room and replays it to anyone who joins later, so a teammate
 * opening the Canvas tab mid-session still sees the current URL immediately.
 *
 * The URL itself has to be reachable by every teammate's machine for this to
 * actually work — a LAN address (e.g. http://192.168.1.42:3000), not
 * "localhost", since "localhost" always means each viewer's own machine.
 *
 * Room token is `ms-<teamId>`: a Supabase UUID, unguessable in practice, and
 * only known to people already invited into the team — same access-control
 * level as any other Live Share link.
 */
import type { BrowserPaneContent } from "./browser-pane-bridge"

const RELAY_BASE = "hramble-session-relay.hramble-community-api.workers.dev"

export function masterSessionRoomToken(teamId: string): string {
	return `ms-${teamId}`
}

export type MasterSessionCanvasStatus = "connecting" | "connected" | "disconnected"

export interface MasterSessionCanvasViewer {
	stop: () => void
}

/** Always-on viewer connection — kept open for as long as the Canvas tab is mounted, so the shared URL stays live-synced. */
export function connectMasterSessionCanvas(
	roomToken: string,
	onUrl: (url: string) => void,
	onStatusChange: (status: MasterSessionCanvasStatus) => void,
): MasterSessionCanvasViewer {
	let ws: WebSocket
	let stopped = false
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null

	function connect() {
		onStatusChange("connecting")
		ws = new WebSocket(`wss://${RELAY_BASE}/parties/session-room/${roomToken}?role=viewer`)
		ws.onopen = () => onStatusChange("connected")
		ws.onmessage = (event) => {
			if (typeof event.data !== "string") return
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "screen" && msg.content?.kind === "url" && typeof msg.content.url === "string") {
					onUrl(msg.content.url)
				}
			} catch {
				// Ignore malformed frames.
			}
		}
		ws.onclose = () => {
			onStatusChange("disconnected")
			if (stopped) return
			reconnectTimer = setTimeout(connect, 2000)
		}
	}
	connect()

	return {
		stop: () => {
			stopped = true
			if (reconnectTimer) clearTimeout(reconnectTimer)
			ws.close()
		},
	}
}

/**
 * One-shot publish: briefly becomes the room's host to broadcast the new
 * URL, then disconnects (the relay allows one host at a time — the newest
 * publisher always wins — and keeps the message around for later joiners
 * without needing the host connection to stay open).
 */
export function publishMasterSessionCanvasUrl(accessToken: string, roomToken: string, url: string): void {
	const ws = new WebSocket(
		`wss://${RELAY_BASE}/parties/session-room/${roomToken}?role=host&token=${encodeURIComponent(accessToken)}`,
	)
	ws.onopen = () => {
		const content: BrowserPaneContent = { kind: "url", url }
		ws.send(JSON.stringify({ type: "screen", content }))
		ws.close()
	}
}
