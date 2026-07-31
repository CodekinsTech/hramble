/**
 * One-time migration of legacy "palot:" localStorage keys → "hramble:".
 *
 * Runs at import time and MUST be imported before any atom module (atoms read
 * localStorage during render, and preferences.ts runs its own migrations at
 * module load), so the renamed keys carry the user's existing values.
 *
 * Safe: only copies when the new key is absent, then removes the old key.
 */
try {
	if (typeof localStorage !== "undefined") {
		const keys: string[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)
			if (k) keys.push(k)
		}
		for (const k of keys) {
			let newKey: string | null = null
			if (k.startsWith("palot:")) newKey = `hramble:${k.slice("palot:".length)}`
			else if (k === "palot-preferences") newKey = "hramble-preferences"
			if (newKey && localStorage.getItem(newKey) === null) {
				const value = localStorage.getItem(k)
				if (value !== null) localStorage.setItem(newKey, value)
				localStorage.removeItem(k)
			}
		}
	}
} catch {
	/* localStorage unavailable — ignore */
}

export {}
