/**
 * Live Share relay — the transport layer for watching a live Hramble
 * session from another device. Built on partyserver (ISC-licensed,
 * https://github.com/partykit/partyserver), which handles the actual
 * WebSocket/hibernation/broadcast plumbing over a Durable Object — this file
 * is the thin, Hramble-specific layer on top: who's allowed to be the host,
 * and who messages get relayed to.
 *
 * Deliberately opaque about session content: the Worker never parses what
 * the host sends beyond a `type` discriminator, so it never needs updating
 * when Hramble's own session data shape changes. Auth for the host reuses
 * the same Supabase project as Community/Team Spaces (a real signed-in
 * Hramble account); viewers need no account — the room's id (a random,
 * unguessable share token minted by the host) is the only access control,
 * the same "anyone with the link" model as a Google Docs share.
 */
import { type Connection, type ConnectionContext, routePartykitRequest, Server, type WSMessage } from "partyserver"

interface Env {
	SESSION_ROOM: DurableObjectNamespace
	ASSETS: Fetcher
	SUPABASE_URL: string
	SUPABASE_PUBLISHABLE_KEY: string
}

interface ConnState {
	role: "host" | "viewer"
}

async function verifyHost(accessToken: string, env: Env): Promise<boolean> {
	if (!accessToken) return false
	try {
		const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
			headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
		})
		return r.ok
	} catch {
		return false
	}
}

function roleFromRequest(request: Request): "host" | "viewer" {
	return new URL(request.url).searchParams.get("role") === "host" ? "host" : "viewer"
}

export class SessionRoom extends Server<Env> {
	static options = { hibernate: true }

	/** The host's latest full session snapshot — replayed to viewers who join after it was sent, so they don't see a blank screen. */
	latestSnapshot: string | null = null
	/** Same idea for the browser-pane mirror (see share-client.ts's "screen" messages) — otherwise a viewer joining mid-session sees nothing until the host's pane content next changes. */
	latestScreen: string | null = null

	getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
		return [`role:${roleFromRequest(ctx.request)}`]
	}

	async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
		const role = roleFromRequest(ctx.request)

		if (role === "host") {
			const token = new URL(ctx.request.url).searchParams.get("token") ?? ""
			if (!(await verifyHost(token, this.env))) {
				connection.close(4001, "unauthorized")
				return
			}
			// Only one live host per room — an older tab/session reconnecting replaces it.
			for (const other of this.getConnections<ConnState>(["role:host"])) {
				if (other.id !== connection.id) other.close(4002, "replaced by a new host connection")
			}
		} else {
			if (this.latestSnapshot) connection.send(this.latestSnapshot)
			if (this.latestScreen) connection.send(this.latestScreen)
		}

		connection.setState<ConnState>({ role })
		this.broadcastPresence()
	}

	onMessage(connection: Connection, message: WSMessage): void {
		const state = connection.state as ConnState | null
		if (state?.role === "host") {
			if (typeof message === "string") {
				try {
					const parsed = JSON.parse(message)
					if (parsed?.type === "snapshot") this.latestSnapshot = message
					if (parsed?.type === "screen") this.latestScreen = message
				} catch {
					// Non-JSON host messages are just relayed as-is below.
				}
			}
			// Host → every viewer.
			this.broadcast(message, [connection.id])
		} else {
			// Viewer → the host only (never broadcast between viewers).
			const hosts = [...this.getConnections<ConnState>(["role:host"])]
			if (hosts.length === 0) {
				// Nothing silently swallowed — tell this viewer nobody's there to act on it.
				connection.send(JSON.stringify({ type: "no-host" }))
				return
			}
			for (const host of hosts) host.send(message)
		}
	}

	onClose(): void {
		this.broadcastPresence()
	}

	private broadcastPresence(): void {
		const viewerCount = [...this.getConnections<ConnState>(["role:viewer"])].length
		const hostConnected = [...this.getConnections<ConnState>(["role:host"])].length > 0
		this.broadcast(JSON.stringify({ type: "presence", viewerCount, hostConnected }))
	}
}

export default {
	async fetch(request, env) {
		return (await routePartykitRequest(request, { ...env })) || env.ASSETS.fetch(request)
	},
} satisfies ExportedHandler<Env>
