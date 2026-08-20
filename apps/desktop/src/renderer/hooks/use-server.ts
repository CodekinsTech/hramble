import { useAtomValue } from "jotai"
import { useCallback } from "react"
import { type BrainContribution, brainContributionFamily } from "../atoms/brain-contribution"
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
const hyperloopStopped = new Set<string>()

/** Called by abort paths so a running Hyperloop stops at the next round. */
export function stopHyperloop(sessionId: string) {
	hyperloopStopped.add(sessionId)
}



// ── Layer 2 — Brain Auto-Recall ──────────────────────────────────────────────
// For the FIRST message of a session, ask the main process which saved Brain
// items are most relevant to what the user just typed, and turn them into a
// short, clearly-marked context block. The block is sent to the AGENT only — it
// is prepended as a SEPARATE text part so the user's own visible message (the
// optimistic text part) stays clean and unmodified. Returns null when the
// toggle is off, nothing matches, or the bridge isn't available.
/** Map a saved Brain item's free-form `type` onto a known contribution kind. */
function toContributionKind(type: string): BrainContribution["kind"] {
	const t = (type || "").toLowerCase()
	if (t === "repo" || t === "docs" || t === "tool" || t === "model" || t === "connector") return t
	return "skill"
}

async function buildBrainRecallPart(
	text: string,
): Promise<{ part: { type: "text"; text: string } | null; contributions: BrainContribution[] }> {
	try {
		const recall = window.hramble?.recallBrain
		if (!recall) return { part: null, contributions: [] }
		const matches = await recall(text, { limit: 5 })
		if (!Array.isArray(matches) || matches.length === 0) return { part: null, contributions: [] }
		const lines = matches.map((m) => {
			const how = m.source ? `  [how to use: ${m.source}]` : ""
			return `- ${m.name} (${m.type}): ${m.description}${how}`
		})
		const contributions: BrainContribution[] = matches.map((m) => ({
			kind: toContributionKind(m.type),
			label: m.name,
			detail: m.description || m.source || undefined,
		}))
		return {
			part: {
				type: "text",
				text: `[Brain — relevant to this task, use if helpful:\n${lines.join("\n")}]`,
			},
			contributions,
		}
	} catch (err) {
		log.debug("brain recall skipped", { error: err instanceof Error ? err.message : String(err) })
		return { part: null, contributions: [] }
	}
}

// ── Layer 3 — Episodic Memory recall ─────────────────────────────────────────
// For the FIRST message of a session, ask the main process for the most similar
// PAST task(s) the user has done, and turn them into a short "here's what
// happened last time" pointer. Like Layer 2 it's a SEPARATE agent-only text part
// so the user's visible message stays untouched. Returns null when the toggle is
// off, nothing matches, or the bridge isn't available.
async function buildEpisodeRecallPart(
	text: string,
): Promise<{ part: { type: "text"; text: string } | null; contributions: BrainContribution[] }> {
	try {
		const recall = window.hramble?.recallEpisodes
		if (!recall) return { part: null, contributions: [] }
		const matches = await recall(text, { limit: 2 })
		if (!Array.isArray(matches) || matches.length === 0) return { part: null, contributions: [] }
		const lines = matches.map((m) => {
			// Keep each match to one line: trimmed task, its outcome, and a lesson.
			const task = m.task.length > 100 ? `${m.task.slice(0, 99).trimEnd()}…` : m.task
			const lesson = m.lesson ? ` ${m.lesson}` : ""
			return `- "${task}" → ${m.outcome}.${lesson}`
		})
		const contributions: BrainContribution[] = matches.map((m) => {
			const task = m.task.length > 64 ? `${m.task.slice(0, 63).trimEnd()}…` : m.task
			return { kind: "episode", label: task, detail: m.outcome }
		})
		return {
			part: {
				type: "text",
				text: `[Brain memory — similar past task(s):\n${lines.join("\n")}\n]`,
			},
			contributions,
		}
	} catch (err) {
		// Never let an episodic-memory hiccup block sending the message.
		log.debug("episode recall skipped", { error: err instanceof Error ? err.message : String(err) })
		return { part: null, contributions: [] }
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
	const abort = useCallback(async (_directory: string, sessionId: string) => {
		log.debug("abort", { sessionId })
		stopHyperloop(sessionId)
		try {
			if (appStore.get(engineConnectedAtom)) {
				await abortEngineSession(sessionId)
				return
			}
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

			if (!appStore.get(engineConnectedAtom)) {
				log.error("sendPrompt: engine not connected", { directory })
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
			const [recallResult, episodeResult] =
				isFirstMessage && text.trim()
					? await Promise.all([buildBrainRecallPart(text), buildEpisodeRecallPart(text)])
					: [
							{ part: null, contributions: [] as BrainContribution[] },
							{ part: null, contributions: [] as BrainContribution[] },
						]
			const recallPart = recallResult.part
			const episodePart = episodeResult.part

			// DISPLAY-ONLY — mirror what the Brain contributed into a per-session atom
			// so the docked-Brain header can list it. Never throws; empty when recall
			// is off or nothing matched. Only touched on the first-message path.
			if (isFirstMessage) {
				try {
					appStore.set(brainContributionFamily(sessionId), [
						...recallResult.contributions,
						...episodeResult.contributions,
					])
				} catch (err) {
					log.debug("brain contribution capture skipped", {
						error: err instanceof Error ? err.message : String(err),
					})
				}
			}

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

			log.debug("sendPrompt: calling promptAsync", {
				sessionId,
				agent: options?.agent,
				model: options?.model,
				partsCount: parts.length,
				planMode: options?.planMode,
				hyperloop: options?.hyperloop,
			})

			// ── Engine routing ──────────────────────────────────────────────
			// When the zyot engine is connected, send the prompt there instead
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

			} catch (err) {
				log.error("createSession failed", { directory, title }, err)
				throw err
			}
		}, [])

	const renameSession = useCallback(async (_directory: string, sessionId: string, title: string) => {
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

	}, [])

	const deleteSession = useCallback(async (_directory: string, sessionId: string) => {
		log.debug("deleteSession", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			// Remove from the UI immediately (don't wait on the SSE round-trip), then
			// delete from the engine. Also best-effort delete from OpenCode's parallel
			// store — imported sessions still exist there and would otherwise reappear
			// on the next OpenCode-backed reload.
			appStore.set(removeSessionAtom, sessionId)
			await deleteEngineSession(sessionId)
			return
		}
	}, [])

	const respondToPermission = useCallback(
		async (
			_directory: string,
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
			} catch (err) {
				log.error("respondToPermission failed", { sessionId, permissionId, response }, err)
				throw err
			}
		},
		[],
	)

	const replyToQuestion = useCallback(
		async (_directory: string, _requestId: string, _answers: QuestionAnswer[]) => {
			// The engine has no structured-question feature — never reached in engine mode.
			throw new Error("Structured questions are not supported by the engine.")
		},
		[],
	)

	const rejectQuestion = useCallback(async (_directory: string, _requestId: string) => {
		// The engine has no structured-question feature — never reached in engine mode.
		throw new Error("Structured questions are not supported by the engine.")
	}, [])

	const revert = useCallback(async (_directory: string, sessionId: string, messageId: string) => {
		log.debug("revert", { sessionId, messageId })

		if (appStore.get(engineConnectedAtom)) {
			await revertEngineSession(sessionId, messageId)
			return
		}

	}, [])

	const unrevert = useCallback(async (_directory: string, sessionId: string) => {
		log.debug("unrevert", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			await unrevertEngineSession(sessionId)
			return
		}

	}, [])

	const executeCommand = useCallback(
		async (_directory: string, _sessionId: string, _command: string, _args: string) => {
			// The engine has no custom slash-command feature — never reached in engine mode.
			throw new Error("Server-side commands are not supported by the engine.")
		},
		[],
	)

	const summarize = useCallback(async (_directory: string, sessionId: string) => {
		log.debug("summarize", { sessionId })

		if (appStore.get(engineConnectedAtom)) {
			await summarizeEngineSession(sessionId)
			return
		}

	}, [])

	const deletePart = useCallback(
		async (_directory: string, sessionId: string, messageId: string, partId: string) => {
			log.debug("deletePart", { sessionId, messageId, partId })

			if (appStore.get(engineConnectedAtom)) {
				// The engine's transcript is message-grained (no separate parts).
				await deleteEnginePart(sessionId, messageId)
				return
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

			throw new Error("Session not found")
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
