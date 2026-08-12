/**
 * Session Bridge (export side) — starts the relay host and generates a bridge
 * URL that another Hramble instance can paste to join and continue the session.
 * Built on the same relay infrastructure as Live Share (share-client.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { communityAccessTokenAtom } from "../atoms/community"
import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { appStore } from "../atoms/store"
import { buildBridgeUrl } from "../lib/bridge-client"
import { buildSnapshot, createScreenDedupe, shareUrlForRoom, startShareHost } from "../lib/share-client"
import { useAgentActions } from "./use-server"

export function useSessionBridge(
	directory: string,
	sessionId: string,
	agentName: string,
	project: string,
) {
	const [bridgeUrl, setBridgeUrl] = useState<string | null>(null)
	const { sendPrompt } = useAgentActions()
	const hostRef = useRef<ReturnType<typeof startShareHost> | null>(null)
	const unsubRef = useRef<(() => void) | null>(null)

	const stop = useCallback(() => {
		unsubRef.current?.()
		unsubRef.current = null
		hostRef.current?.stop()
		hostRef.current = null
		setBridgeUrl(null)
	}, [])

	const start = useCallback(() => {
		const accessToken = appStore.get(communityAccessTokenAtom)
		if (!accessToken) {
			return { ok: false as const, error: "Sign in first (Settings → Account) to create a bridge" }
		}

		const host = startShareHost(accessToken, (text) => {
			sendPrompt(directory, sessionId, text).catch(() => {})
		})
		hostRef.current = host

		const url = buildBridgeUrl(shareUrlForRoom(host.roomToken), {
			title: agentName,
			project,
		})
		setBridgeUrl(url)

		const screenDedupe = createScreenDedupe()
		const push = () => {
			const messages = appStore.get(messagesFamily(sessionId))
			host.sendSnapshot(buildSnapshot(messages, (id) => appStore.get(partsFamily(id))))
			screenDedupe.pushIfChanged(host.sendScreen)
		}
		push()
		const unsubMessages = appStore.sub(messagesFamily(sessionId), push)
		const interval = setInterval(push, 1500)
		unsubRef.current = () => {
			unsubMessages()
			clearInterval(interval)
		}

		return { ok: true as const, url }
	}, [directory, sessionId, agentName, project, sendPrompt])

	useEffect(() => stop, [stop])

	return { bridgeUrl, isBridging: !!bridgeUrl, start, stop }
}
