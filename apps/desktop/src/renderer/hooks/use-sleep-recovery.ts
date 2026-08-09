/** Wires the main process's sleep/wake events into atoms/sleep-recovery.ts. Call once at the app root. */
import { useEffect } from "react"
import { handleResume, handleSuspend } from "../atoms/sleep-recovery"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

export function useSleepRecovery() {
	useEffect(() => {
		// No Electron preload bridge — e.g. running via `dev:web` in a plain
		// browser tab. Sleep/wake events don't exist there; nothing to wire up.
		if (!bridge()) return
		const offSuspend = bridge().onPowerSuspend(handleSuspend)
		const offResume = bridge().onPowerResume(handleResume)
		return () => {
			offSuspend()
			offResume()
		}
	}, [])
}
