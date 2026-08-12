/**
 * Bridge client — connects to the session relay as a viewer so a second
 * Hramble instance can watch and send prompts into a bridged session.
 * Mirrors the host-side relay protocol from share-client.ts.
 */

const RELAY_BASE = "hramble-session-relay.hramble-community-api.workers.dev"

export interface BridgeEvent {
	id: string
	role: "user" | "assistant"
	text: string
}

export interface BridgeClient {
	sendMessage: (text: string) => void
	stop: () => void
}

export function connectBridge(
	roomToken: string,
	onSnapshot: (events: BridgeEvent[]) => void,
	onStatusChange: (status: "connecting" | "connected" | "disconnected") => void,
): BridgeClient {
	let ws: WebSocket
	let stopped = false
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null

	function connect() {
		onStatusChange("connecting")
		ws = new WebSocket(
			`wss://${RELAY_BASE}/parties/session-room/${roomToken}?role=viewer`,
		)
		ws.onopen = () => onStatusChange("connected")
		ws.onmessage = (event) => {
			if (typeof event.data !== "string") return
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "snapshot" && Array.isArray(msg.state)) {
					onSnapshot(msg.state as BridgeEvent[])
				}
			} catch {
				// Ignore malformed frames
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
		sendMessage(text: string) {
			if (ws.readyState !== WebSocket.OPEN) return
			ws.send(JSON.stringify({ type: "viewer-message", text }))
		},
		stop() {
			stopped = true
			if (reconnectTimer) clearTimeout(reconnectTimer)
			ws.close()
		},
	}
}

// ============================================================
// Bridge URL helpers (shared by both sides)
// ============================================================

export interface BridgeMeta {
	title: string
	project: string
}

export function buildBridgeUrl(relayViewerUrl: string, meta: BridgeMeta): string {
	const encoded = btoa(JSON.stringify(meta))
	const sep = relayViewerUrl.includes("?") ? "&" : "?"
	return `${relayViewerUrl}${sep}bridge=1&meta=${encodeURIComponent(encoded)}`
}

export function parseBridgeUrl(url: string): { roomToken: string; meta: BridgeMeta } | null {
	try {
		const u = new URL(url.trim())
		const room = u.searchParams.get("room")
		const bridge = u.searchParams.get("bridge")
		const metaStr = u.searchParams.get("meta")
		if (!room || bridge !== "1" || !metaStr) return null
		const meta = JSON.parse(atob(decodeURIComponent(metaStr))) as BridgeMeta
		return { roomToken: room, meta }
	} catch {
		return null
	}
}
