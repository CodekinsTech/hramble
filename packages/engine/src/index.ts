import { startServer, stopServer } from "./server.js"
import { closeDb } from "./sessions.js"
import { ensureToolsOnPath } from "./path-setup.js"

// Guarantee git + core tools are on PATH before we run any bash command.
ensureToolsOnPath()

startServer().catch((err) => {
	console.error("[xot-engine] failed to start:", err)
	process.exit(1)
})

process.on("SIGTERM", () => {
	console.log("[xot-engine] shutting down")
	stopServer()
	closeDb()
	process.exit(0)
})

process.on("SIGINT", () => {
	stopServer()
	closeDb()
	process.exit(0)
})
