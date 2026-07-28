#!/usr/bin/env node
/**
 * Hramble eval harness — measures whether a model can actually complete real
 * coding tasks through the agent loop.
 *
 * Why this exists: without it, "is Qwen 30B good enough?" and "did tool-call
 * repair help?" are opinions. This turns them into numbers.
 *
 * How it works, per task:
 *   1. copy the task fixture to a temp dir (clean state every run)
 *   2. start `opencode serve` with CWD = that dir (this is how the agent gets
 *      scoped to the task repo — the API ignores a `directory` field)
 *   3. create a session, send the prompt with the chosen model
 *   4. poll until the assistant turn settles
 *   5. run the task's verification (shell command or file check)
 *   6. record pass/fail + diagnostics, kill the server, clean up
 *
 * Usage:
 *   node evals/run.mjs --model opencode/big-pickle
 *   node evals/run.mjs --model ollama/qwen3-coder:30b --only add-function
 *   node evals/run.mjs --model ollama/qwen3-coder:30b --json out.json
 */

import { execFile, spawn } from "node:child_process"
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TASKS_DIR = path.join(__dirname, "tasks")

// How long a single agent turn may take before we call it a failure.
const TURN_TIMEOUT_MS = 180_000
const SERVER_READY_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------- args

function parseArgs(argv) {
	// --agent selects an OpenCode agent (build | plan | general | explore).
	// --delay spaces tasks apart; free tiers rate-limit back-to-back runs, which
	// shows up as bogus ~10s "failures" that look like model incompetence.
	// delay default is deliberately large: free tiers (e.g. OpenCode Zen) throttle
	// back-to-back runs and return an EMPTY response rather than a 429. Measured
	// directly: a task that fails inside a fast suite passes 3/3 when spaced out.
	// Too small a delay makes a competent model look broken.
	// --mode: "build" (single turn, baseline) or "plan-build" (decomposition).
	const args = { model: null, only: null, json: null, keep: false, agent: null, delay: 30000, mode: "build" }
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === "--model") args.model = argv[++i]
		else if (a === "--only") args.only = argv[++i]
		else if (a === "--json") args.json = argv[++i]
		else if (a === "--agent") args.agent = argv[++i]
		else if (a === "--mode") args.mode = argv[++i]
		else if (a === "--delay") args.delay = Number(argv[++i])
		else if (a === "--keep") args.keep = true
	}
	if (!args.model) {
		console.error("Usage: node evals/run.mjs --model <provider>/<modelID> [--only <task>] [--json out.json]")
		process.exit(1)
	}
	// providerID is everything before the FIRST slash; modelIDs contain slashes/colons.
	const slash = args.model.indexOf("/")
	if (slash < 0) {
		console.error(`--model must be "<provider>/<modelID>", got "${args.model}"`)
		process.exit(1)
	}
	args.providerID = args.model.slice(0, slash)
	args.modelID = args.model.slice(slash + 1)
	return args
}

// ---------------------------------------------------------------- utils

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer()
		srv.unref()
		srv.on("error", reject)
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address()
			srv.close(() => resolve(port))
		})
	})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/session`, { signal: AbortSignal.timeout(2000) })
			if (r.ok) return true
		} catch {
			/* not up yet */
		}
		await sleep(1000)
	}
	return false
}

// ---------------------------------------------------------------- tasks

async function loadTasks(only) {
	const entries = await readdir(TASKS_DIR, { withFileTypes: true })
	const tasks = []
	for (const e of entries) {
		if (!e.isDirectory()) continue
		if (only && !e.name.includes(only)) continue
		const dir = path.join(TASKS_DIR, e.name)
		const spec = JSON.parse(await readFile(path.join(dir, "task.json"), "utf8"))
		tasks.push({ id: e.name, dir, ...spec })
	}
	return tasks.sort((a, b) => a.id.localeCompare(b.id))
}

/** Run a task's verification against the working copy. */
async function verify(task, workdir) {
	const v = task.verify || {}
	try {
		if (v.cmd) {
			await execFileAsync("/bin/bash", ["-lc", v.cmd], { cwd: workdir, timeout: 60_000 })
			return { pass: true }
		}
		if (v.fileContains) {
			const { file, text } = v.fileContains
			const content = await readFile(path.join(workdir, file), "utf8")
			return content.includes(text)
				? { pass: true }
				: { pass: false, reason: `"${file}" missing expected text: ${text}` }
		}
		return { pass: false, reason: "task has no verify block" }
	} catch (e) {
		// Keep only meaningful lines — node stack frames drown the real message.
		const raw = `${e.stdout || ""}\n${e.stderr || ""}`.trim() || e.message || ""
		const useful = raw
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !/^at\s/.test(l) && !/node:internal/.test(l) && !/^\^+$/.test(l))
		return { pass: false, reason: (useful[0] || e.message || "verification failed").slice(0, 120) }
	}
}

// ---------------------------------------------------------------- agent turn

/** Post one message to a session and poll until the assistant turn settles.
 *  Returns the full message list so the caller can extract diagnostics. */
async function sendAndWait(base, sessionId, prompt, providerID, modelID, agent) {
	const started = Date.now()
	// Fire the prompt. Don't await completion — it can outlive the socket; we
	// detect completion by polling the message list instead.
	const post = fetch(`${base}/session/${sessionId}/message`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			providerID,
			modelID,
			...(agent ? { agent } : {}),
			parts: [{ type: "text", text: prompt }],
		}),
		signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
	}).catch(() => null)

	let last = ""
	let stable = 0
	let msgs = []
	while (Date.now() - started < TURN_TIMEOUT_MS) {
		await sleep(2500)
		try {
			const r = await fetch(`${base}/session/${sessionId}/message`, { signal: AbortSignal.timeout(8000) })
			msgs = await r.json()
			if (!Array.isArray(msgs)) msgs = msgs.messages || []
		} catch {
			continue
		}
		const sig = JSON.stringify(msgs).length.toString()
		if (sig === last) {
			stable++
			if (stable >= 2 && msgs.some((m) => (m.info || m).role === "assistant")) break
		} else {
			stable = 0
			last = sig
		}
	}
	await post
	return msgs
}

/** Pull the diagnostics we score on out of a message list. */
function diagnose(msgs, startedAt) {
	const assistant = msgs.filter((m) => (m.info || m).role === "assistant")
	const parts = assistant.flatMap((m) => m.parts || (m.info || m).parts || [])
	const toolParts = parts.filter((p) => p.type === "tool" || p.type === "tool-invocation")
	const textParts = parts.filter((p) => p.type === "text")
	const tokens = (assistant.at(-1)?.info || assistant.at(-1) || {}).tokens || {}
	return {
		durationMs: Date.now() - startedAt,
		toolCalls: toolParts.length,
		toolErrors: toolParts.filter((p) => p.state?.status === "error" || p.error).length,
		toolNames: [...new Set(toolParts.map((p) => p.tool || p.name || "?"))],
		textChars: textParts.reduce((n, p) => n + (p.text?.length || 0), 0),
		outputTokens: tokens.output ?? 0,
		emptyResponse: parts.length === 0,
		saidText: textParts
			.map((p) => p.text || "")
			.join(" ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 240),
	}
}

/**
 * Run one task attempt.
 *  - mode "build"      : single turn (the OpenCode baseline).
 *  - mode "plan-build" : Codebuff-style decomposition — one no-edit planning
 *                        turn (plan agent), then an execution turn in the same
 *                        session so the model builds against its own plan.
 */
async function runTurn(port, prompt, providerID, modelID, agent, mode = "build") {
	const base = `http://127.0.0.1:${port}`
	const mk = await fetch(`${base}/session`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	})
	const session = await mk.json()
	const started = Date.now()

	if (mode === "plan-build") {
		// Step 1 — plan only. The `plan` agent has edit tools disabled, so this
		// can't accidentally start changing files.
		await sendAndWait(
			base,
			session.id,
			`${prompt}\n\nFirst, write a short numbered plan of the exact steps and file edits required. Do NOT make any changes yet — only the plan.`,
			providerID,
			modelID,
			"plan",
		)
		// Step 2 — execute the plan it just produced (build agent = edit tools on).
		const msgs = await sendAndWait(
			base,
			session.id,
			"Now carry out that plan exactly. Make all the file edits and run any commands needed.",
			providerID,
			modelID,
			agent || "build",
		)
		return diagnose(msgs, started)
	}

	const msgs = await sendAndWait(base, session.id, prompt, providerID, modelID, agent)
	return diagnose(msgs, started)
}

// ---------------------------------------------------------------- main

async function runTask(task, args) {
	const work = await mkdtemp(path.join(os.tmpdir(), `hramble-eval-${task.id}-`))
	const repoSrc = path.join(task.dir, "repo")
	if (existsSync(repoSrc)) await cp(repoSrc, work, { recursive: true })

	const port = await freePort()
	const server = spawn("opencode", ["serve", "--hostname=127.0.0.1", `--port=${port}`], {
		cwd: work,
		stdio: "ignore",
		detached: false,
	})

	const result = { id: task.id, pass: false }
	try {
		if (!(await waitForServer(port, SERVER_READY_TIMEOUT_MS))) {
			result.reason = "opencode server did not start"
			return result
		}
		let diag = await runTurn(port, task.prompt, args.providerID, args.modelID, args.agent, args.mode)

		// An empty response almost always means throttling, not incapability.
		// Back off and retry once so rate limits don't get scored as failures.
		if (diag.emptyResponse) {
			await sleep(45_000)
			diag = await runTurn(port, task.prompt, args.providerID, args.modelID, args.agent, args.mode)
			diag.retried = true
		}
		Object.assign(result, diag)

		if (diag.emptyResponse) {
			result.reason = "empty response twice (rate-limited or model unavailable)"
			return result
		}
		const v = await verify(task, work)
		result.pass = v.pass
		if (!v.pass) result.reason = v.reason
	} catch (e) {
		result.reason = e.message
	} finally {
		try {
			server.kill("SIGTERM")
		} catch {
			/* already gone */
		}
		if (!args.keep) await rm(work, { recursive: true, force: true }).catch(() => {})
		else result.workdir = work
	}
	return result
}

async function main() {
	const args = parseArgs(process.argv)
	const tasks = await loadTasks(args.only)
	if (!tasks.length) {
		console.error("No tasks found.")
		process.exit(1)
	}

	console.log(`\nModel: ${args.providerID}/${args.modelID}${args.agent ? `   Agent: ${args.agent}` : ""}`)
	console.log(`Tasks: ${tasks.length}\n`)

	const results = []
	for (const [i, t] of tasks.entries()) {
		// Space runs apart: free tiers throttle back-to-back requests, which
		// otherwise reads as the model failing instantly.
		if (i > 0 && args.delay) await sleep(args.delay)
		process.stdout.write(`  ${t.id.padEnd(28)} `)
		const r = await runTask(t, args)
		results.push(r)
		const secs = r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : "-"
		if (r.pass) {
			console.log(`PASS  (${secs}, ${r.toolCalls ?? 0} tools)`)
		} else {
			console.log(`FAIL  (${secs}, ${r.toolCalls ?? 0} tools) ${r.reason ? `- ${r.reason}`.slice(0, 80) : ""}`)
			if (r.saidText) console.log(`${" ".repeat(32)}said: "${r.saidText.slice(0, 110)}"`)
		}
	}

	const passed = results.filter((r) => r.pass).length
	const empty = results.filter((r) => r.emptyResponse).length
	const toolErrs = results.reduce((n, r) => n + (r.toolErrors || 0), 0)

	console.log(`\n${"─".repeat(52)}`)
	console.log(`  Score        ${passed}/${results.length}`)
	console.log(`  Empty replies ${empty}   (model never engaged)`)
	console.log(`  Tool errors   ${toolErrs}   (agent-loop breakage)`)
	console.log(`${"─".repeat(52)}\n`)

	if (args.json) {
		const { writeFile } = await import("node:fs/promises")
		await writeFile(
			args.json,
			JSON.stringify({ model: `${args.providerID}/${args.modelID}`, results }, null, 2),
		)
		console.log(`Wrote ${args.json}\n`)
	}

	process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
