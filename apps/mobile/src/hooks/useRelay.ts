import { useEffect, useRef, useState } from "react"
import { type RelayState, RelayClient } from "../lib/relay"

const initialState: RelayState = {
	relayConnected: false,
	hostConnected: false,
	viewerCount: 0,
	events: [],
	screen: null,
	sessions: [],
	noHostNotice: 0,
}

/** Owns one RelayClient for the lifetime of a room token; tears it down and
 *  reconnects fresh if the token changes (e.g. re-pairing). */
export function useRelay(roomToken: string | null): {
	state: RelayState
	sendMessage: (text: string) => void
	selectSession: (sessionId: string) => void
} {
	const [state, setState] = useState<RelayState>(initialState)
	const clientRef = useRef<RelayClient | null>(null)

	useEffect(() => {
		if (!roomToken) {
			setState(initialState)
			return
		}
		const client = new RelayClient(roomToken)
		clientRef.current = client
		const unsub = client.subscribe(setState)
		return () => {
			unsub()
			client.stop()
			clientRef.current = null
		}
	}, [roomToken])

	return {
		state,
		sendMessage: (text) => clientRef.current?.sendMessage(text),
		selectSession: (sessionId) => clientRef.current?.selectSession(sessionId),
	}
}
