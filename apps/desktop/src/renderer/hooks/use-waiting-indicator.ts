import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { hasWaitingAtom } from "../atoms/derived/waiting"

/**
 * Updates the browser tab title when any agent is waiting for user input.
 */
export function useWaitingIndicator() {
	const hasWaiting = useAtomValue(hasWaitingAtom)

	useEffect(() => {
		// Header title removed for now \u2014 keep the waiting-for-input alert (it's
		// functional, not just branding) but drop the "Hramble code" branding text.
		document.title = hasWaiting ? "(!) Input needed" : ""

		return () => {
			document.title = ""
		}
	}, [hasWaiting])
}
