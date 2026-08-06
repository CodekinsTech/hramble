// Service worker — receives console entries relayed from every tab's
// content-script.js and forwards them to the Hramble desktop app's local
// bridge. Batches briefly per tab so a noisy page doesn't fire a network
// request per console line.
const BRIDGE_URL = "http://127.0.0.1:47821"
const FLUSH_MS = 250

const queues = new Map() // tabId -> { url, title, entries: [] }
const timers = new Map() // tabId -> timeout id

function flush(tabId) {
	timers.delete(tabId)
	const q = queues.get(tabId)
	if (!q || q.entries.length === 0) return
	queues.delete(tabId)
	fetch(`${BRIDGE_URL}/console`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ tabId, url: q.url, title: q.title, entries: q.entries }),
	}).catch(() => {
		// Hramble isn't running or the bridge is down — nothing to do but drop.
	})
}

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg?.type !== "console-entry" || !sender.tab?.id) return
	const tabId = sender.tab.id
	let q = queues.get(tabId)
	if (!q) {
		q = { url: msg.url, title: msg.title, entries: [] }
		queues.set(tabId, q)
	}
	q.url = msg.url
	q.title = msg.title
	q.entries.push({ level: msg.level, message: msg.message, at: msg.at })
	if (!timers.has(tabId)) {
		timers.set(tabId, setTimeout(() => flush(tabId), FLUSH_MS))
	}
})

// A closed tab's own console history is no longer useful to the app — tell it.
chrome.tabs.onRemoved.addListener((tabId) => {
	fetch(`${BRIDGE_URL}/console/clear`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ tabId }),
	}).catch(() => {})
})
