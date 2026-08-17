import { startServer, stopServer } from "./server.js"
import { closeDb } from "./sessions.js"
import { ensureToolsOnPath } from "./path-setup.js"
import { closeMcp } from "./mcp.js"

// Guarantee git + core tools are on PATH before we run any bash command.
ensureToolsOnPath()

startServer().catch((err) => {
	console.error("[xot-engine] failed to start:", err)
	process.exit(1)
})

async function shutdown(): Promise<void> {
	stopServer()
	await closeMcp()
	closeDb()
	process.exit(0)
}

process.on("SIGTERM", () => {
	console.log("[xot-engine] shutting down")
	void shutdown()
})

process.on("SIGINT", () => {
	void shutdown()
})
