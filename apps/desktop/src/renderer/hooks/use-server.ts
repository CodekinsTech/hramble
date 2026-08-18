import { useAtomValue } from "jotai"
import { useCallback } from "react"
import { connectionAtom } from "../atoms/connection"
import { messagesFamily, upsertMessageAtom } from "../atoms/messages"
import { upsertPartAtom } from "../atoms/parts"
import { removeSessionAtom, sessionFamily, upsertSessionAtom } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"
import type {
	FileAttachment,
	FilePart,
	FilePartInput,
	QuestionAnswer,
	Session,
	TextPart,
	UserMessage,
} from "../lib/types"
import { getProjectClient } from "../services/connection-manager"
import { engineConnectedAtom } from "../atoms/engine"
import { chatModeAtom } from "../atoms/chat-mode"
import {
	createEngineSession,
	sendEnginePrompt,
	abortEngineSession,
	allowEnginePermission,
	denyEnginePermission,
	renameEngineSession,
	deleteEngineSession,
	deleteEnginePart,
	forkEngineSession,
	revertEngineSession,
	unrevertEngineSession,
	summarizeEngineSession,
	type EngineModelRef,
} from "../services/engine-client"

const log = createLogger("use-server")

// ── Hyperloop ────────────────────────────────────────────────────────────────
// Autonomous mode: keep working, round after round, until the task is done.
// Safety is non-negotiable — a hard round cap prevents runaway cost, and any
// abort (Escape-to-stop) flags the session so the loop exits between rounds.
const HYPERLOOP_MAX_ROUNDS = 15
const hyperloopStopped = new Set<string>()

/** Called by abort paths so a running Hyperloop stops at the next round. */
export function stopHyperloop(sessionId: string) {
	hyperloopStopped.add(sessionId)
}

const HYPERLOOP_CONTINUE =
	"Continue working on the task. Resume exactly where you left off and complete the remaining steps. Never run destructive or irreversible commands (deleting files/dirs, force-pushing, dropping databases, disk operations) — if a step seems to need one, stop and report instead."

// Guardrail: destructive / irreversible shell commands. If one of these shows up
// in the agent's tool calls during Hyperloop, halt the loop immediately so it
// can't compound. Broad on purpose — in autonomous mode we favour false stops
// over real damage.
const DANGEROUS_COMMAND =
	/\brm\s+-[rf]{1,2}\b|\bsudo\s+rm\b|git\s+push[^\n]*--force|--force[^\n]*push|\bgit\s+reset\s+--hard\b|\bdd\s+if=|\bmkfs\b|drop\s+(table|database)\b|truncate\s+table\b|>\s*\/dev\/(sd|disk|null\/)|:\s*\(\s*\)\s*\{|\bshutdown\b|\breboot\b|\bhalt\b/i
const HYPERLOOP_CHECK =
	"Is the ORIGINAL task now fully complete? If the project has tests, run them now. Reply with ONLY the single word DONE if everything the task required is finished and any tests pass. Otherwise reply CONTINUE followed by one short line describing what still remains."

/** Read the DONE/CONTINUE verdict from the latest assistant message. */
function isHyperloopDone(text: string): boolean {
	const v = text.toUpperCase()
	if (/\bCONTINUE\b/.test(v)) return false
	if (/NOT\s+(YET\s+)?(DONE|COMPLETE|FINISHED)/.test(v)) return false
	return /\bDONE\b/.test(v)
}

// ── Layer 2 — Brain Auto-Recall ──────────────────────────────────────────────
// For the FIRST message of a session, ask the main process which saved Brain
// items are most relevant to what the user just typed, and turn them into a
// short, clearly-marked context block. The block is sent to the AGENT only — it
// is prepended as a SEPARATE text part so the user's own visible message (the
// optimistic text part) stays clean and unmodified. Returns null when the
// toggle is off, nothing matches, or the bridge isn't available.
async function buildBrainRecallPart(text: string): Promise<{ type: "text"; text: string } | null> {
	try {
		const recall = window.hramble?.recallBrain
		if (!recall) return null
		const matches = await recall(text, { limit: 5 })
		if (!Array.isArray(matches) || matches.length === 0) return null
		const lines = matches.map((m) => {
			const how = m.source ? `  [how to use: ${m.source}]` : ""
			return `- ${m.name} (${m.type}): ${m.description}${how}`
		})
		return {
			type: "text",
			text: `[Brain — relevant to this task, use if helpful:\n${lines.join("\n")}]`,
		}
	} catch (err) {
		// A recall problem must never block sending the message.
		log.debug("brain recall skipped", { error: err instanceof Error ? err.message : String(err) })
		return null
	}
}

// ── Layer 3 — Episodic Memory recall ─────────────────────────────────────────
// For the FIRST message of a session, ask the main process for the most similar
// PAST task(s) the user has done, and turn them into a short "here's what
// happened last time" pointer. Like Layer 2 it's a SEPARATE agent-only text part
// so the user's visible message stays untouched. Returns null when the toggle is
// off, nothing matches, or the bridge isn't available.
async function buildEpisodeRecallPart(text: string): Promise<{ type: "text"; text: string } | null> {
	try {
		const recall = window.hramble?.recallEpisodes
		if (!recall) return null
		const matches = await recall(text, { limit: 2 })
		if (!Array.isArray(matches) || matches.length === 0) return null
		const lines = matches.map((m) => {
			// Keep each match to one line: trimmed task, its outcome, and a lesson.
			const task = m.task.length > 100 ? `${m.task.slice(0, 99).trimEnd()}…` : m.task
			const lesson = m.lesson ? ` ${m.lesson}` : ""
			return `- "${task}" → ${m.outcome}.${lesson}`
		})
		return {
			type: "text",
			text: `[Brain memory — similar past task(s):\n${lines.join("\n")}\n]`,
		}
	} catch (err) {
		// Never let an episodic-memory hiccup block sending the message.
		log.debug("episode recall skipped", { error: err instanceof Error ? err.message : String(err) })
		return null
	}
}

/**
 * Hook for OpenCode server connection state.
 */
export function useServerConnection() {
	const conn = useAtomValue(connectionAtom)
	return {
		connected: conn.connected,
		url: conn.url,
	}
}

/**
 * Hook for agent actions (stop, approve, deny, etc.).
 */
export function useAgentActions() {
	const abort = useCallback(async (directory: string, sessionId: string) => {
		log.debug("abort", { sessionId })
		stopHyperloop(sessionId)
		try {
			if (appStore.get(engineConnectedAtom)) {
				await abortEngineSession(sessionId)
				return
			}
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to server")
			await client.session.abort({ sessionID: sessionId })
		} catch (err) {
			log.error("abort failed", { sessionId }, err)
			throw err
		}
	}, [])

	const sendPrompt = useCallback(
		async (
			directory: string,
			sessionId: string,
			text: string,
			options?: {
				model?: { providerID: string; modelID: string }
				agent?: string
				variant?: string
				files?: FileAttachment[]
				// Plan mode: think first, then act. Runs a no-edit planning turn
				// (plan agent) and then an execution turn (build agent) in the same
				// session. Measured to make weaker/local models markedly more
				// reliable — they otherwise reply with text and forget to edit.
				planMode?: boolean
				// Hyperloop: autonomous mode. Keep working round after round until the
				// task is complete (self-check + run tests) or the round cap is hit.
				hyperloop?: boolean
			},
		) => {
			log.debug("sendPrompt called", {
				directory,
				sessionId,
				textLength: text.length,
				agent: options?.agent,
				model: options?.model,
				variant: options?.variant,
				hasFiles: !!(options?.files && options.files.length > 0),
			})

			// The engine path needs no OpenCode client. Only require one when the
			// engine isn't connected (OpenCode fallback) — otherwise a null client
			// (OpenCode removed) wrongly failed engine prompts with "Not connected".
			const client = getProjectClient(directory)
			if (!client && !appStore.get(engineConnectedAtom)) {
				log.error("sendPrompt: no backend for directory", { directory })
				throw new Error("Not connected to server")
			}

			// Layer 2 — Auto-Recall runs on the FIRST message only (least-invasive
			// v1). Capture this BEFORE the optimistic message is added, since that
			// insertion would otherwise make the session look non-empty.
			const isFirstMessage = (appStore.get(messagesFamily(sessionId)) ?? []).length === 0

			// Optimistic user message — include variant so it's available when
			// re-initializing the session's toolbar state (the v1 UserMessage type
			// doesn't have variant but the server stores it on user messages).
			const optimisticId = `optimistic-${Date.now()}`
			const optimisticMessage: UserMessage & { variant?: string } = {
				id: optimisticId,
				sessionID: sessionId,
				role: "user",
				time: { created: Date.now() },
				agent: options?.agent ?? "build",
				model: options?.model ?? { providerID: "", modelID: "" },
				variant: options?.variant,
			}
			appStore.set(upsertMessageAtom, optimisticMessage as UserMessage)
			log.debug("sendPrompt: optimistic message set", { optimisticId })

			// Optimistic text part
			const optimisticTextPart: TextPart = {
				id: `${optimisticId}-text`,
				sessionID: sessionId,
				messageID: optimisticId,
				type: "text",
				text,
			}
			appStore.set(upsertPartAtom, optimisticTextPart)

			// Optimistic file parts
			const files = options?.files ?? []
			for (let i = 0; i < files.length; i++) {
				const file = files[i]
				const optimisticFilePart: FilePart = {
					id: `${optimisticId}-file-${i}`,
					sessionID: sessionId,
					messageID: optimisticId,
					type: "file",
					mime: file.mediaType ?? "application/octet-stream",
					filename: file.filename,
					url: file.url,
				}
				appStore.set(upsertPartAtom, optimisticFilePart)
			}

			// Layer 2 + Layer 3 — compute the Brain recall blocks (first message only).
			// These are prepended to the SERVER parts only; the optimistic text part
			// above keeps the user's raw message, so their visible bubble is never
			// mangled. Layer 2 = relevant Brain items; Layer 3 = similar past task(s).
			// Each is an independent, separately-marked part gated by its own toggle.
			const [recallPart, episodePart] =
				isFirstMessage && text.trim()
					? await Promise.all([buildBrainRecallPart(text), buildEpisodeRecallPart(text)])
					: [null, null]

			// Build parts array for the API call
			const parts: Array<{ type: "text"; text: string } | FilePartInput> = [
				...(recallPart ? [recallPart] : []),
				...(episodePart ? [episodePart] : []),
				{ type: "text", text },
			]
			for (const file of files) {
				parts.push({
					type: "file",
					mime: file.mediaType ?? "application/octet-stream",
					filename: file.filename,
					url: file.url,
				})
			}

			const model = options?.model
				? { providerID: options.model.providerID, modelID: options.model.modelID }
				: undefined

			log.debug("sendPrompt: calling promptAsync", {
				sessionId,
				agent: options?.agent,
				model: options?.model,
				partsCount: parts.length,
				planMode: options?.planMode,
				hyperloop: options?.hyperloop,
			})

			// ── Engine routing ──────────────────────────────────────────────
			// When the xot engine is connected, send the prompt there instead
			// of going through the OpenCode SDK.
			if (appStore.get(engineConnectedAtom)) {
				const engineModel: EngineModelRef | undefined = options?.model
					? {
						provider: options.model.providerID,
						model: options.model.modelID,
						apiKey: "", // engine uses env var fallback when empty
					}
					: undefined
				// Combine all text parts into a single string for the engine
				const promptText = parts
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n\n")
				const engineAttachments = parts
					.filter((p): p is FilePartInput => p.type === "file")
					.map((p) => ({ filename: p.filename, mime: p.mime, url: p.url }))
				// Map the chat-mode selector to the engine: plan -> read-only agent,
				// the other four -> permission mode.
				const chatMode = appStore.get(chatModeAtom)
				const enginePlan = chatMode === "plan" || options?.planMode
				const enginePermMode =
					chatMode === "plan" ? "auto" : (chatMode as "manual" | "accept-edits" | "auto" | "bypass")
				await sendEnginePrompt(sessionId, promptText || text, engineModel, {
					agent: enginePlan ? "plan" : options?.agent,
					planMode: enginePlan,
					permissionMode: enginePermMode,
					attachments: engineAttachments.length ? engineAttachments : undefined,
				})
				return
			}

			// OpenCode fallback path — needs a client.
			if (!client) throw new Error("Not connected to server")

			// One unit of work. When `withPlan`, it thinks first (plan agent, edits
			// disabled) then executes (build agent) in the same session; otherwise a
			// single normal turn.
			type Part = { type: "text"; text: string } | FilePartInput
			const runWorkTurn = async (turnParts: Part[], withPlan: boolean) => {
				if (withPlan) {
					await client.session.promptAsync({
						sessionID: sessionId,
						parts: [
							...turnParts,
							{
								type: "text",
								text: "\n\nFirst, write a short numbered plan of the exact steps and file edits required. Do not make any changes yet — only the plan.",
							},
						],
						model,
						agent: "plan",
						variant: options?.variant,
					})
					await client.session.promptAsync({
						sessionID: sessionId,
						parts: [
							{
								type: "text",
								text: "Now carry out that plan exactly — make all the file edits and run any commands needed.",
							},
						],
						model,
						agent: "build",
						variant: options?.variant,
					})
				} else {
					await client.session.promptAsync({
						sessionID: sessionId,
						parts: turnParts,
						model,
						agent: options?.agent,
						variant: options?.variant,
					})
				}
			}

			// Read the latest assistant text (used for the Hyperloop DONE/CONTINUE check).
			const readLastAssistantText = async (): Promise<string> => {
				try {
					const res = await client.session.messages({ sessionID: sessionId })
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const msgs: any[] = res.data ?? []
					const assistants = msgs.filter((m) => (m.info || m).role === "assistant")
					const lastParts = assistants[assistants.length - 1]?.parts ?? []
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					return lastParts
						.filter((p: any) => p.type === "text")
						.map((p: any) => p.text || "")
						.join(" ")
				} catch {
					return ""
				}
			}

			// Count tool executions so far — used to detect a stuck loop (a round
			// that runs no tools = the agent talked but didn't act). Returns -1 on
			// error so the caller can skip the check that round.
			const countTools = async (): Promise<number> => {
				try {
					const res = await client.session.messages({ sessionID: sessionId })
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const msgs: any[] = res.data ?? []
					let n = 0
					for (const m of msgs)
						for (const p of m.parts ?? [])
							if (p.type === "tool" || p.type === "tool-invocation") n++
					return n
				} catch {
					return -1
				}
			}

			// Scan the most recent tool calls for a destructive command.
			const scanDanger = async (): Promise<string | null> => {
				try {
					const res = await client.session.messages({ sessionID: sessionId })
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const msgs: any[] = res.data ?? []
					const recent = msgs
						.filter((m) => (m.info || m).role === "assistant")
						.slice(-2)
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						.flatMap((m: any) => m.parts ?? [])
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						.filter((p: any) => p.type === "tool" || p.type === "tool-invocation")
					const blob = JSON.stringify(recent)
					const match = blob.match(DANGEROUS_COMMAND)
					return match ? match[0] : null
				} catch {
					return null
				}
			}

			try {
				if (options?.hyperloop) {
					// Autonomous loop: work → guardrails → check done → repeat, up to the cap.
					hyperloopStopped.delete(sessionId)
					let round = 0
					let stuckRounds = 0
					let stopReason = "max-rounds"
					for (; round < HYPERLOOP_MAX_ROUNDS; round++) {
						if (hyperloopStopped.has(sessionId)) {
							stopReason = "stopped"
							break
						}
						const first = round === 0
						const beforeTools = await countTools()
						await runWorkTurn(
							first ? parts : [{ type: "text", text: HYPERLOOP_CONTINUE }],
							first && !!options?.planMode,
						)
						if (hyperloopStopped.has(sessionId)) {
							stopReason = "stopped"
							break
						}

						// Guardrail #2 — destructive command ran: halt immediately.
						const danger = await scanDanger()
						if (danger) {
							stopReason = `blocked-dangerous:${danger}`
							log.warn("hyperloop halted — dangerous command detected", { sessionId, danger })
							break
						}

						// Guardrail #1 — stuck: two rounds in a row with zero tool activity
						// means it's talking, not doing. Stop rather than burn the cap.
						const afterTools = await countTools()
						if (beforeTools >= 0 && afterTools >= 0 && afterTools === beforeTools) {
							stuckRounds++
							if (stuckRounds >= 2) {
								stopReason = "stuck-no-progress"
								log.warn("hyperloop halted — no progress for 2 rounds", { sessionId })
								break
							}
						} else {
							stuckRounds = 0
						}

						// Completion check (A: self-assess + B: run tests).
						await client.session.promptAsync({
							sessionID: sessionId,
							parts: [{ type: "text", text: HYPERLOOP_CHECK }],
							model,
							agent: "build",
							variant: options?.variant,
						})
						if (isHyperloopDone(await readLastAssistantText())) {
							stopReason = "done"
							break
						}
					}
					hyperloopStopped.delete(sessionId)
					log.debug("sendPrompt: hyperloop finished", {
						sessionId,
						rounds: round + 1,
						stopReason,
					})
				} else if (options?.planMode) {
					await runWorkTurn(parts, true)
				} else {
					await runWorkTurn(parts, false)
				}
			} catch (err) {
				log.error("sendPrompt: promptAsync failed", { sessionId, agent: options?.agent }, err)
				throw err
			}
		},
		[],
	)

	const createSession = useCallback(
		async (
			directory: string,
			title?: string,
			permission?: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>,
		) => {
			log.debug("createSession", { directory, title, hasPermission: !!permission })
			try {
				// Route to engine when connected
				if (appStore.get(engineConnectedAtom)) {
					const engineSession = await createEngineSession(directory, title ?? "New chat")
					// The engine SSE stream will fire session.created → upsertSessionAtom.
					// Return a minimal compatible session object for the caller.
					return {
						id: engineSession.id,
						directory: engineSession.directory,
						title: engineSession.title,
					} as unknown as import("../lib/types").Session
				}

				const client = getProjectClient(directory)
				if (!client) throw new Error("Not connected to server")
				const result = await client.session.create(permission ? { title, permission } : { title })
				const session = result.data
				if (session) {
					appStore.set(upsertSessionAtom, { session, directory })
				}
				log.debug("createSession succeeded", { sessionId: session?.id })
				return session
			} catch (err) {
				log.error("createSession failed", { directory, title }, err)
				throw err
			}
		}, [])

	const renameSession = useCallback(async (directory: string, sessionId: string, title: string) => {
		log.debug("renameSession", { sessionId, title })

		// Optimistic update
		const entry = appStore.get(sessionFamily(sessionId))
		if (entry) {
			appStore.set(upsertSessionAtom, {
				session: { ...entry.session, title },
				directory: entry.directory,
			})
		}

		if (appStore.get(engineConnectedAtom)) {
			await renameEngineSession(sessionId, title)
			return
		}

		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		try {
			await client.session.update({ sessionID: sessionId, title })
		} catch (err) {
			log.error("renameSession failed", { sessionId, title }, err)
			throw err
		}
	}, [])

	const deleteSession = useCallback(async (directory: string, sessionId: string) => {
		log.debug("deleteSession", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			// Remove from the UI immediately (don't wait on the SSE round-trip), then
			// delete from the engine. Also best-effort delete from OpenCode's parallel
			// store — imported sessions still exist there and would otherwise reappear
			// on the next OpenCode-backed reload.
			appStore.set(removeSessionAtom, sessionId)
			await deleteEngineSession(sessionId)
			try {
				await getProjectClient(directory)?.session.delete({ sessionID: sessionId })
			} catch {
				// Not in OpenCode (engine-only session) — fine.
			}
			return
		}

		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		try {
			await client.session.delete({ sessionID: sessionId })
		} catch (err) {
			log.error("deleteSession failed", { sessionId }, err)
			throw err
		}
	}, [])

	const respondToPermission = useCallback(
		async (
			directory: string,
			sessionId: string,
			permissionId: string,
			response: "once" | "always" | "reject",
		) => {
			log.debug("respondToPermission", { sessionId, permissionId, response })
			try {
				if (appStore.get(engineConnectedAtom)) {
					if (response === "reject") {
						await denyEnginePermission(permissionId)
					} else {
						await allowEnginePermission(permissionId, response === "always")
					}
					return
				}
				const client = getProjectClient(directory)
				if (!client) throw new Error("Not connected to server")
				await client.permission.respond({
					sessionID: sessionId,
					permissionID: permissionId,
					response,
				})
			} catch (err) {
				log.error("respondToPermission failed", { sessionId, permissionId, response }, err)
				throw err
			}
		},
		[],
	)

	const replyToQuestion = useCallback(
		async (directory: string, requestId: string, answers: QuestionAnswer[]) => {
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to server")
			log.debug("replyToQuestion", { requestId })
			try {
				await client.question.reply({ requestID: requestId, answers })
			} catch (err) {
				log.error("replyToQuestion failed", { requestId }, err)
				throw err
			}
		},
		[],
	)

	const rejectQuestion = useCallback(async (directory: string, requestId: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		log.debug("rejectQuestion", { requestId })
		try {
			await client.question.reject({ requestID: requestId })
		} catch (err) {
			log.error("rejectQuestion failed", { requestId }, err)
			throw err
		}
	}, [])

	const revert = useCallback(async (directory: string, sessionId: string, messageId: string) => {
		log.debug("revert", { sessionId, messageId })

		if (appStore.get(engineConnectedAtom)) {
			await revertEngineSession(sessionId, messageId)
			return
		}

		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		try {
			const entry = appStore.get(sessionFamily(sessionId))
			if (entry?.status?.type === "busy") {
				log.debug("revert: aborting busy session first", { sessionId })
				await client.session.abort({ sessionID: sessionId })
			}
			await client.session.revert({ sessionID: sessionId, messageID: messageId })
		} catch (err) {
			log.error("revert failed", { sessionId, messageId }, err)
			throw err
		}
	}, [])

	const unrevert = useCallback(async (directory: string, sessionId: string) => {
		log.debug("unrevert", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			await unrevertEngineSession(sessionId)
			return
		}

		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		try {
			await client.session.unrevert({ sessionID: sessionId })
		} catch (err) {
			log.error("unrevert failed", { sessionId }, err)
			throw err
		}
	}, [])

	const executeCommand = useCallback(
		async (directory: string, sessionId: string, command: string, args: string) => {
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to server")
			log.debug("executeCommand", { sessionId, command })
			try {
				await client.session.command({
					sessionID: sessionId,
					command,
					arguments: args,
				})
			} catch (err) {
				log.error("executeCommand failed", { sessionId, command }, err)
				throw err
			}
		},
		[],
	)

	const summarize = useCallback(async (directory: string, sessionId: string) => {
		log.debug("summarize", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			await summarizeEngineSession(sessionId)
			return
		}

		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to server")
		try {
			await client.session.summarize({ sessionID: sessionId })
		} catch (err) {
			log.error("summarize failed", { sessionId }, err)
			throw err
		}
	}, [])

	const deletePart = useCallback(
		async (directory: string, sessionId: string, messageId: string, partId: string) => {
			log.debug("deletePart", { sessionId, messageId, partId })

			if (appStore.get(engineConnectedAtom)) {
				// The engine's transcript is message-grained (no separate parts).
				await deleteEnginePart(sessionId, messageId)
				return
			}

			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to server")
			try {
				await client.part.delete({ sessionID: sessionId, messageID: messageId, partID: partId })
			} catch (err) {
				log.error("deletePart failed", { sessionId, messageId, partId }, err)
				throw err
			}
		},
		[],
	)

	const forkSession = useCallback(
		async (directory: string, sessionId: string, messageId?: string): Promise<Session> => {
			log.debug("forkSession", { sessionId, messageId })

			if (appStore.get(engineConnectedAtom)) {
				const forked = await forkEngineSession(sessionId, messageId)
				const session = forked as unknown as Session
				appStore.set(upsertSessionAtom, { session, directory })
				log.debug("forkSession succeeded (engine)", { forkedSessionId: forked.id })
				return session
			}

			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to server")
			try {
				const result = await client.session.fork({
					sessionID: sessionId,
					messageID: messageId,
				})
				const session = result.data as Session
				if (session) {
					appStore.set(upsertSessionAtom, { session, directory })
				}
				log.debug("forkSession succeeded", { forkedSessionId: session?.id })
				return session
			} catch (err) {
				log.error("forkSession failed", { sessionId, messageId }, err)
				throw err
			}
		},
		[],
	)

	return {
		abort,
		sendPrompt,
		createSession,
		renameSession,
		deleteSession,
		deletePart,
		respondToPermission,
		replyToQuestion,
		rejectQuestion,
		revert,
		unrevert,
		executeCommand,
		summarize,
		forkSession,
	}
}
