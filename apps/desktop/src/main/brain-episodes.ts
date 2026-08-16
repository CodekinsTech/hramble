/**
 * Layer 3 — Episodic Memory for the Brain.
 *
 * Layers 1 (always-aware catalog) and 2 (per-task auto-recall of Brain items)
 * tell the agent WHAT it has. Layer 3 remembers WHAT HAPPENED: for each finished
 * task it records a compact "episode" — the request, whether it worked, which
 * Brain items were relevant, and (optionally) a one-line lesson. On a NEW task it
 * finds the most similar PAST episode and surfaces a short pointer, so the agent
 * reuses what worked and avoids repeating a past mistake.
 *
 * It deliberately does NOT stand up a parallel session store. The engine already
 * keeps full session history (see hramble-memory.js `search_past_work`, which
 * reads OpenCode's SQLite DB from the Bun runtime). That DB isn't reachable from
 * the Electron *main* process without a new native sqlite dep, so Layer 3 keeps a
 * tiny, purpose-built append store next to the Brain catalog
 * (`~/.config/opencode/brain-episodes.jsonl`) — one line per task, capped, local,
 * and cheap to score. It reuses Layer 2's tokenizer/threshold for matching so
 * there's a single scoring approach across the Brain (no embeddings, no network).
 *
 * Everything here is local and error-swallowing: an empty/unreadable store simply
 * yields no matches, and a write failure is logged and ignored — Layer 3 can never
 * block a send or a session ending.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { tokenize } from "./brain-recall"
import { createLogger } from "./logger"

const log = createLogger("brain-episodes")

/** One recorded task. `id` is the session id so re-captures upsert in place. */
export type Episode = {
	id: string
	timestamp: number
	/** The user's original request / session title — what the task WAS. */
	task: string
	outcome: "success" | "failed" | "unknown"
	/** Names of Brain items relevant to the task (best-effort, may be empty). */
	itemsUsed: string[]
	/** One-line takeaway, if any. */
	lesson?: string
}

/** An episode plus the similarity score that earned it a spot. */
export type EpisodeMatch = Episode & { score: number }

/** Hard cap so the append store can never grow unbounded. Keep most recent N. */
const MAX_EPISODES = 500

/** Root of the OpenCode config — same place the Layer 1 catalog (BRAIN.md) lives. */
function configDir(): string {
	return path.join(os.homedir(), ".config", "opencode")
}

/** Absolute path of the append-only episodes store. */
export function getEpisodesPath(): string {
	return path.join(configDir(), "brain-episodes.jsonl")
}

/** Read + parse the JSONL store. Never throws; returns [] on missing/garbage. */
function readEpisodes(): Episode[] {
	let raw: string
	try {
		raw = fs.readFileSync(getEpisodesPath(), "utf8")
	} catch {
		return []
	}
	const out: Episode[] = []
	for (const line of raw.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			const e = JSON.parse(trimmed) as Partial<Episode>
			if (!e || typeof e.id !== "string" || typeof e.task !== "string") continue
			out.push({
				id: e.id,
				timestamp: typeof e.timestamp === "number" ? e.timestamp : 0,
				task: e.task,
				outcome:
					e.outcome === "success" || e.outcome === "failed" ? e.outcome : "unknown",
				itemsUsed: Array.isArray(e.itemsUsed) ? e.itemsUsed.filter((x) => typeof x === "string") : [],
				lesson: typeof e.lesson === "string" && e.lesson.trim() ? e.lesson.trim() : undefined,
			})
		} catch {
			// Skip a single corrupt line rather than dropping the whole store.
		}
	}
	return out
}

/**
 * Record (or update) an episode. Upserts by `id` so repeated captures for the
 * same session refine one row instead of piling up duplicates, then rewrites the
 * store keeping only the most recent MAX_EPISODES. Never throws.
 */
export function recordEpisode(input: {
	id: string
	task: string
	outcome?: Episode["outcome"]
	itemsUsed?: string[]
	lesson?: string
}): void {
	try {
		const id = String(input.id || "").trim()
		const task = String(input.task || "").replace(/\s+/g, " ").trim()
		if (!id || !task) return

		const episode: Episode = {
			id,
			timestamp: Date.now(),
			task: task.slice(0, 500),
			outcome:
				input.outcome === "success" || input.outcome === "failed" ? input.outcome : "unknown",
			itemsUsed: Array.isArray(input.itemsUsed)
				? [...new Set(input.itemsUsed.filter((x) => typeof x === "string" && x.trim()))].slice(0, 12)
				: [],
			lesson: input.lesson?.trim() ? input.lesson.trim().slice(0, 200) : undefined,
		}

		// Upsert by id: drop any prior row for this session, append the fresh one.
		const kept = readEpisodes().filter((e) => e.id !== id)
		kept.push(episode)
		// Cap to the most recent N (episodes are appended in capture order).
		const capped = kept.slice(-MAX_EPISODES)

		const target = getEpisodesPath()
		fs.mkdirSync(path.dirname(target), { recursive: true })
		const body = capped.map((e) => JSON.stringify(e)).join("\n") + "\n"
		const tmp = `${target}.tmp`
		fs.writeFileSync(tmp, body, "utf8")
		fs.renameSync(tmp, target)
		log.debug("Recorded episode", { id, outcome: episode.outcome, total: capped.length })
	} catch (err) {
		log.warn("Failed to record episode (non-fatal)", {
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Most-recent-first list of recorded episodes, for the read-only Brain Vault
 * history view. Local read; never throws.
 */
export function listRecentEpisodes(limit = 50): Episode[] {
	const all = readEpisodes()
	all.sort((a, b) => b.timestamp - a.timestamp)
	return all.slice(0, Math.max(1, limit))
}

// Scoring reuses Layer 2's tokenizer. An episode's `task` is a whole request
// sentence (no name/desc split), so each DISTINCT meaningful token it shares with
// the new task counts equally. One shared MEANINGFUL token (stopwords already
// stripped) is enough to surface a past task — real requests for the same thing
// are often phrased differently ("fix the login bug" vs "the login page is
// broken" share only "login"), and the reminder is a capped, clearly-marked nudge
// rather than an instruction, so a single strong content-word overlap is the right
// floor. More shared tokens simply rank higher.
const TOKEN_WEIGHT = 2
const MIN_SCORE = 2

/**
 * Find past episodes most similar to `taskText`. Local, synchronous, safe:
 * returns [] on an empty store or when nothing meaningfully matches. Default cap 2
 * (episodic reminders should be a nudge, not a wall of history).
 */
export function recallEpisodes(taskText: string, opts?: { limit?: number }): EpisodeMatch[] {
	const text = (taskText || "").trim()
	if (!text) return []

	const taskTokens = new Set(tokenize(text))
	if (taskTokens.size === 0) return []

	const limit = Math.max(1, opts?.limit ?? 2)

	const scored: EpisodeMatch[] = []
	for (const ep of readEpisodes()) {
		const epTokens = new Set(tokenize(ep.task))
		let shared = 0
		for (const t of taskTokens) if (epTokens.has(t)) shared++
		const score = shared * TOKEN_WEIGHT
		if (score >= MIN_SCORE) scored.push({ ...ep, score })
	}

	// Strongest match first; a more recent episode breaks ties (fresher lesson).
	scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
	return scored.slice(0, limit)
}
