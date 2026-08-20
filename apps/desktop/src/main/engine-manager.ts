import { type ChildProcess, spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { createLogger } from "./logger"
import { waitForEnv } from "./shell-env"

const log = createLogger("engine-manager")

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ENGINE_PORT = 4200
const ENGINE_HOST = "127.0.0.1"
export const ENGINE_URL = `http://${ENGINE_HOST}:${ENGINE_PORT}`

// In dev, __dirname is apps/desktop/dist/main/ — go up 4 levels to project root
const PROJECT_ROOT = path.join(__dirname, "../../../..")
const ENGINE_ENTRY = path.join(PROJECT_ROOT, "packages/engine/src/index.ts")

export interface EngineServer {
	url: string
	pid: number | null
}

let engineProcess: ChildProcess | null = null
let engineServer: EngineServer | null = null

async function isRunning(): Promise<boolean> {
	try {
		const res = await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(1500) })
		return res.ok
	} catch {
		return false
	}
}

export async function ensureEngine(): Promise<EngineServer> {
	if (engineServer) return engineServer

	await waitForEnv()

	// Check if already running (e.g. restarted dev server)
	if (await isRunning()) {
		engineServer = { url: ENGINE_URL, pid: null }
		log.info("Engine already running at", ENGINE_URL)
		return engineServer
	}

	return spawnEngine()
}

async function spawnEngine(): Promise<EngineServer> {
	log.info("Starting zyot engine at", ENGINE_ENTRY)

	const env = { ...process.env }

	// Try bun (used by the project), fall back to node
	const [cmd, args] = process.platform === "win32"
		? ["bun.exe", ["run", ENGINE_ENTRY]]
		: ["bun", ["run", ENGINE_ENTRY]]

	engineProcess = spawn(cmd, args, {
		env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: false,
		// On Windows, spawn inside a shell so bun is found via PATH
		shell: process.platform === "win32",
	})

	engineProcess.stdout?.on("data", (d: Buffer) => {
		for (const line of d.toString().trim().split("\n")) {
			if (line) log.info(`[zyot] ${line}`)
		}
	})
	engineProcess.stderr?.on("data", (d: Buffer) => {
		for (const line of d.toString().trim().split("\n")) {
			if (line) log.warn(`[zyot:err] ${line}`)
		}
	})
	engineProcess.on("exit", (code) => {
		log.warn(`Engine exited (code ${code})`)
		engineProcess = null
		engineServer = null
	})
	engineProcess.on("error", (err) => {
		log.error("Engine spawn error", err)
		engineProcess = null
		engineServer = null
	})

	// Poll up to 30 seconds
	for (let i = 0; i < 60; i++) {
		await sleep(500)
		if (await isRunning()) {
			engineServer = { url: ENGINE_URL, pid: engineProcess?.pid ?? null }
			log.info("Engine ready at", ENGINE_URL)
			return engineServer
		}
	}

	engineProcess?.kill()
	engineProcess = null
	throw new Error("zyot engine failed to start within 30 seconds")
}

export function stopEngine(): void {
	if (engineProcess) {
		log.info("Stopping zyot engine")
		engineProcess.kill()
		engineProcess = null
	}
	engineServer = null
}

export function getEngineUrl(): string | null {
	return engineServer?.url ?? null
}
