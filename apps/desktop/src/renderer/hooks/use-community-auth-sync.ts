/**
 * Syncs the app's Google account session (same one used for Community) into
 * the shared atoms. Called once at the app root (SidebarLayout) so it's kept
 * fresh regardless of which page is open — Settings > Account and the
 * Community page both just read the resulting atoms.
 */
import { useSetAtom } from "jotai"
import { useEffect } from "react"
import {
	communityAccessTokenAtom,
	communityBackendEnabledAtom,
	communityUserAtom,
	refreshCommunityPostsAtom,
} from "../atoms/community"
import { isCommunityBackendEnabled, syncClientSession } from "../lib/community-client"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

interface CommunitySession {
	accessToken: string
	refreshToken: string
	email: string
	name: string
}

export function useCommunityAuthSync() {
	const setEnabled = useSetAtom(communityBackendEnabledAtom)
	const setUser = useSetAtom(communityUserAtom)
	const setToken = useSetAtom(communityAccessTokenAtom)
	const refreshPosts = useSetAtom(refreshCommunityPostsAtom)

	useEffect(() => {
		let cancelled = false

		// No Electron preload bridge — e.g. running via `dev:web` in a plain
		// browser tab for a quick UI preview. Nothing to sync; the public feed
		// path (below, via refreshPosts) still works over plain HTTP.
		if (!bridge()?.community) return

		const applySession = (session: CommunitySession | null) => {
			setToken(session?.accessToken ?? null)
			setUser(session ? { email: session.email, name: session.name } : null)
			syncClientSession(session ? { accessToken: session.accessToken, refreshToken: session.refreshToken } : null)
			if (session) refreshPosts()
		}

		isCommunityBackendEnabled().then(async (enabled) => {
			if (cancelled) return
			setEnabled(enabled)
			if (!enabled) return
			const existing = (await bridge().community.getSession()) as CommunitySession | null
			if (!cancelled && existing) applySession(existing)
			else if (!cancelled) refreshPosts() // public feed still loads while signed out
		})

		const unsubscribe = bridge().community.onSession((session: CommunitySession | null) => applySession(session))
		return () => {
			cancelled = true
			unsubscribe?.()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])
}
