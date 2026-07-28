import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { hasWaitingAtom } from "../atoms/derived/waiting"

/**
 * Updates the browser tab title when any agent is waiting for user input.
 */
export function useWaitingIndicator() {
	const hasWaiting = useAtomValue(hasWaitingAtom)

	useEffect(() => {
		document.title = hasWaiting ? "(!) Hramble code \u2014 Input needed" : "Hramble code"

		return () => {
			document.title = "Hramble code"
		}
	}, [hasWaiting])
}
