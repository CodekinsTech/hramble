import { useEffect, useState } from "react"
import { useRelay } from "./hooks/useRelay"
import { clearStoredRoomToken, getStoredRoomToken, setStoredRoomToken } from "./lib/pairing"
import type { OutgoingFileAttachment } from "./lib/relay"
import { ChatScreen } from "./screens/ChatScreen"
import { PairScreen } from "./screens/PairScreen"
import { SessionListScreen } from "./screens/SessionListScreen"

type Screen = "loading" | "pair" | "sessions" | "chat"

export function App() {
	const [screen, setScreen] = useState<Screen>("loading")
	const [roomToken, setRoomToken] = useState<string | null>(null)
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

	const { state, sendMessage, selectSession, respondPermission, stopSession } = useRelay(roomToken)

	// Restore a previously-paired room token on launch.
	useEffect(() => {
		getStoredRoomToken().then((token) => {
			setRoomToken(token)
			setScreen(token ? "sessions" : "pair")
		})
	}, [])

	async function handlePaired(token: string) {
		await setStoredRoomToken(token)
		setRoomToken(token)
		setScreen("sessions")
	}

	async function handleUnpair() {
		await clearStoredRoomToken()
		setRoomToken(null)
		setActiveSessionId(null)
		setScreen("pair")
	}

	function handleSelectSession(sessionId: string) {
		selectSession(sessionId)
		setActiveSessionId(sessionId)
		setScreen("chat")
	}

	function handleNewMessage() {
		// No session picked — matches Dispatch's own "first phone message with
		// no session creates one" desktop behavior (use-dispatch-bridge.ts).
		setActiveSessionId(null)
		setScreen("chat")
	}

	function handleSend(text: string, files?: OutgoingFileAttachment[]) {
		// Sending with no session picked yet mirrors Dispatch's own desktop
		// behavior: the first message creates (or resumes) the standing session.
		sendMessage(text, files)
	}

	if (screen === "loading") {
		return <div style={{ minHeight: "100%", background: "var(--background)" }} />
	}

	if (screen === "pair" || !roomToken) {
		return <PairScreen onPaired={handlePaired} />
	}

	if (screen === "chat") {
		// Dispatch mirrors one standing session per pairing (see use-dispatch-bridge.ts) —
		// when the phone hasn't explicitly picked one yet (the "+ New message" path)
		// but messages are already flowing, the most-recently-active entry in the
		// (already most-recent-first) session list IS that standing session. This lets
		// the header's Stop action work on a session started from the phone itself,
		// not only ones picked from the list.
		const effectiveSessionId =
			activeSessionId ?? (state.events.length > 0 ? (state.sessions[0]?.id ?? null) : null)
		const activeSession = state.sessions.find((s) => s.id === effectiveSessionId)
		return (
			<ChatScreen
				sessionTitle={activeSession?.title ?? "New session"}
				events={state.events}
				screen={state.screen}
				relayConnected={state.relayConnected}
				hostConnected={state.hostConnected}
				noHostNotice={state.noHostNotice}
				permissionRequest={state.permissionRequest}
				onRespondPermission={respondPermission}
				activeSessionId={effectiveSessionId}
				sessionStatus={activeSession?.status}
				onStop={stopSession}
				onSend={handleSend}
				onBack={() => setScreen("sessions")}
			/>
		)
	}

	return (
		<SessionListScreen
			sessions={state.sessions}
			relayConnected={state.relayConnected}
			hostConnected={state.hostConnected}
			activeSessionId={activeSessionId}
			onSelect={handleSelectSession}
			onNewMessage={handleNewMessage}
			onUnpair={handleUnpair}
		/>
	)
}
