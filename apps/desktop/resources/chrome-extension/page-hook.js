// Runs in the page's own JS world (MAIN), not the extension's isolated world —
// this is the only way to see console calls the page's own scripts make.
// Extension APIs (chrome.runtime.*) aren't available here, so results are
// handed off via postMessage to content-script.js, which relays them out.
;(() => {
	const LEVELS = { log: "log", info: "log", warn: "warn", error: "error", debug: "debug" }

	function send(level, args) {
		let message
		try {
			message = args
				.map((a) => {
					if (a instanceof Error) return a.stack || a.message
					if (typeof a === "object" && a !== null) {
						try {
							return JSON.stringify(a)
						} catch {
							return String(a)
						}
					}
					return String(a)
				})
				.join(" ")
		} catch {
			message = "[unprintable console argument]"
		}
		window.postMessage(
			{ source: "hramble-console-bridge", level, message, at: Date.now() },
			"*",
		)
	}

	for (const [method, level] of Object.entries(LEVELS)) {
		const original = console[method]?.bind(console)
		if (!original) continue
		console[method] = (...args) => {
			original(...args)
			send(level, args)
		}
	}

	window.addEventListener("error", (e) => {
		const loc = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : ""
		send("error", [`${e.message}${loc}`])
	})

	window.addEventListener("unhandledrejection", (e) => {
		const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)
		send("error", [`Unhandled promise rejection: ${reason}`])
	})
})()
