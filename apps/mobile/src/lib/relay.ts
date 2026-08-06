/**
 * Viewer-side client for the Hramble session-relay Cloudflare Worker
 * (apps/session-relay/). Mirrors the exact wire protocol already implemented
 * by the reference web viewer (apps/session-relay/public/index.html) and the
 * desktop host (apps/desktop/src/renderer/lib/share-client.ts) — this file
 * does not invent anything new on the wire, it just speaks the same protocol
 * from a mobile client.
 *
 * Extra message types (`session-list` / `select-session`) are the ones added
 * to the desktop host in this same change (use-dispatch-bridge.ts) to let a
 * phone browse and switch which session it's mirroring. The relay itself is
 * content-opaque and forwards these like any other host/viewer message.
 */

const RELAY_BASE = "hramble-session-relay.hramble-community-api.workers.dev"

export function shareUrlForRoom(roomToken: string): string {
	return `https://${RELAY_BASE}/?room=${roomToken}`
}

/** Pulls the `room` query param out of a pasted Dispatch/Live-Share link, or
 *  treats the whole input as a raw token if it's not a URL. */
export function extractRoomToken(input: string): string | null {
	const trimmed = input.trim()
	if (!trimmed) return null
	try {
		const url = new URL(trimmed)
		const room = url.searchParams.get("room")
		if (room) return room
	} catch {
		// Not a URL — fall through and treat the raw text as the token itself.
	}
	// A bare token: letters/numbers/dashes only, reject obvious garbage input.
	if (/^[A-Za-z0-9_-]{4,128}$/.test(trimmed)) return trimmed
	return null
}

export interface ChatEvent {
	id: string
	role: "user" | "assistant" | "session"
	text: string
}

export type ScreenContent =
	| { kind: "html"; html: string }
	| { kind: "url"; url: string }
	| { kind: "screenshot"; dataUrl: string }

export interface DispatchSessionSummary {
	id: string
	title: string
	project: string
	directory: string
	lastActiveAt: number
}

export interface RelayState {
	relayConnected: boolean
	hostConnected: boolean
	viewerCount: number
	events: ChatEvent[]
	screen: ScreenContent | null
	sessions: DispatchSessionSummary[]
	noHostNotice: number
}

export type RelayListener = (state: RelayState) => void

export class RelayClient {
	private ws: WebSocket | null = null
	private stopped = false
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private listeners = new Set<RelayListener>()

	private state: RelayState = {
		relayConnected: false,
		hostConnected: false,
		viewerCount: 0,
		events: [],
		screen: null,
		sessions: [],
		noHostNotice: 0,
	}

	constructor(private roomToken: string) {
		this.connect()
	}

	subscribe(listener: RelayListener): () => void {
		this.listeners.add(listener)
		listener(this.state)
		return () => this.listeners.delete(listener)
	}

	private emit() {
		for (const l of this.listeners) l(this.state)
	}

	private setState(patch: Partial<RelayState>) {
		this.state = { ...this.state, ...patch }
		this.emit()
	}

	private connect() {
		if (this.stopped) return
		const ws = new WebSocket(
			`wss://${RELAY_BASE}/parties/session-room/${encodeURIComponent(this.roomToken)}?role=viewer`,
		)
		this.ws = ws

		ws.onopen = () => this.setState({ relayConnected: true })

		ws.onclose = () => {
			this.setState({ relayConnected: false, hostConnected: false })
			if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), 2000)
		}

		ws.onerror = () => ws.close()

		ws.onmessage = (event) => {
			if (typeof event.data !== "string") return
			let msg: any
			try {
				msg = JSON.parse(event.data)
			} catch {
				return
			}
			if (msg.type === "presence") {
				this.setState({ hostConnected: !!msg.hostConnected, viewerCount: msg.viewerCount ?? 0 })
			} else if (msg.type === "no-host") {
				this.setState({ noHostNotice: this.state.noHostNotice + 1 })
			} else if (msg.type === "snapshot" && Array.isArray(msg.state)) {
				this.setState({ events: msg.state })
			} else if (msg.type === "screen") {
				this.setState({ screen: msg.content ?? null })
			} else if (msg.type === "session-list" && Array.isArray(msg.sessions)) {
				this.setState({ sessions: msg.sessions })
			}
		}
	}

	sendMessage(text: string) {
		if (this.ws?.readyState !== WebSocket.OPEN) return
		this.ws.send(JSON.stringify({ type: "viewer-message", text }))
	}

	selectSession(sessionId: string) {
		if (this.ws?.readyState !== WebSocket.OPEN) return
		this.ws.send(JSON.stringify({ type: "select-session", sessionId }))
	}

	stop() {
		this.stopped = true
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.ws?.close()
		this.listeners.clear()
	}
}
