/**
 * Live Share — lets someone else watch this session from a browser and send
 * messages into it, via the relay in apps/session-relay/. Building the
 * outgoing snapshot reads messagesFamily/partsFamily directly through the
 * imperative appStore (not useAtomValue) so this hook can push updates from
 * a store subscription callback, not just on React re-render.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { communityAccessTokenAtom } from "../atoms/community"
import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { appStore } from "../atoms/store"
import { buildSnapshot, createScreenDedupe, startShareHost } from "../lib/share-client"
import { useAgentActions } from "./use-server"

export function useSessionShare(directory: string, sessionId: string) {
	const [shareUrl, setShareUrl] = useState<string | null>(null)
	const { sendPrompt } = useAgentActions()
	const hostRef = useRef<ReturnType<typeof startShareHost> | null>(null)
	const unsubRef = useRef<(() => void) | null>(null)

	const stop = useCallback(() => {
		unsubRef.current?.()
		unsubRef.current = null
		hostRef.current?.stop()
		hostRef.current = null
		setShareUrl(null)
	}, [])

	const start = useCallback(() => {
		const accessToken = appStore.get(communityAccessTokenAtom)
		if (!accessToken) return { ok: false as const, error: "Sign in first (Settings → Account) to share a session" }

		const host = startShareHost(accessToken, (text) => {
			sendPrompt(directory, sessionId, text).catch(() => {})
		})
		hostRef.current = host
		setShareUrl(host.url)

		const screenDedupe = createScreenDedupe()
		const push = () => {
			const messages = appStore.get(messagesFamily(sessionId))
			host.sendSnapshot(buildSnapshot(messages, (id) => appStore.get(partsFamily(id))))
			screenDedupe.pushIfChanged(host.sendScreen)
		}
		push()
		// Instant on new/removed messages. Streaming text lives in partsFamily,
		// not messagesFamily, so this alone would miss in-progress deltas —
		// the interval below is the simple catch-all for that (avoids having
		// to dynamically subscribe/unsubscribe a partsFamily atom per message
		// as they come and go).
		const unsubMessages = appStore.sub(messagesFamily(sessionId), push)
		const interval = setInterval(push, 1500)
		unsubRef.current = () => {
			unsubMessages()
			clearInterval(interval)
		}

		return { ok: true as const, url: host.url }
	}, [directory, sessionId, sendPrompt])

	// Stop sharing if the component unmounts (e.g. the session is closed) while live.
	useEffect(() => stop, [stop])

	return { shareUrl, isSharing: !!shareUrl, start, stop }
}
