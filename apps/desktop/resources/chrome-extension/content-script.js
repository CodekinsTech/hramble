// Isolated world — has chrome.runtime access but can't see the page's real
// console. Relays what page-hook.js (running in the page's own world) posts.
window.addEventListener("message", (event) => {
	if (event.source !== window) return
	const data = event.data
	if (!data || data.source !== "hramble-console-bridge") return
	try {
		chrome.runtime.sendMessage({
			type: "console-entry",
			level: data.level,
			message: data.message,
			at: data.at,
			url: location.href,
			title: document.title,
		})
	} catch {
		// Extension context can go away on reload/update — drop silently.
	}
})
