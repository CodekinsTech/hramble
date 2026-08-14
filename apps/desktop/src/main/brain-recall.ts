/**
 * Layer 2 — Auto-Recall for the Brain.
 *
 * Layer 1 (brain-catalog.ts) makes the agent AWARE of its whole inventory by
 * injecting a static menu into every session. Layer 2 is DYNAMIC: for the task
 * the user just typed, it finds the few Brain items most relevant to THAT text
 * and surfaces only those — so the agent reaches for the right skill/tool
 * without being told, and without loading anything until it's needed.
 *
 * Because it depends on the prompt, it can't be a static file — it's computed
 * per-message. The matcher is a fully LOCAL keyword + entity score (BM25-lite):
 * tokenize the task and each item's name+description, score by overlap (name
 * matches weigh more), and add a boost when an item's name/command appears
 * literally in the task. Good enough for up to a few hundred items with zero
 * network and no dependencies.
 *
 * NOTE: for much larger vaults this string score could be swapped for local
 * embeddings + cosine similarity (e.g. a small on-device model). The IPC shape
 * (`recallRelevant`) is designed so that swap stays behind this module.
 */

import { type BrainCandidate, readBrainCandidates } from "./brain-catalog"

/** One matched item plus the relevance score that earned it a spot. */
export type RecallItem = BrainCandidate & { score: number }

// Common English + coding filler that carries no relevance signal. Kept short
// on purpose — dropping only the highest-frequency words avoids nuking real
// intent tokens.
const STOPWORDS = new Set([
	"the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to", "of",
	"in", "on", "at", "by", "with", "as", "is", "are", "was", "were", "be", "been",
	"being", "do", "does", "did", "done", "can", "could", "should", "would", "will",
	"shall", "may", "might", "must", "have", "has", "had", "this", "that", "these",
	"those", "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "she",
	"they", "them", "their", "not", "no", "so", "up", "out", "get", "got", "make",
	"made", "use", "used", "using", "please", "let", "help", "want", "need", "add",
	"new", "some", "any", "from", "into", "about", "how", "what", "when", "where",
	"which", "who", "why", "just", "like", "also", "than", "too", "very", "there",
	"here", "now", "one", "all", "more", "most", "each", "such", "only", "own",
])

/**
 * Lowercase, split on non-alphanumerics, drop stopwords + 1-char noise.
 * Exported so Layer 3 (brain-episodes.ts) can reuse the exact same tokenizer
 * when scoring a new task against past episodes' task text.
 */
export function tokenize(text: string): string[] {
	return (text || "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

// Scoring weights. A task token hitting an item's NAME is a much stronger
// signal than hitting its description, and a literal name/command mention is
// the strongest of all.
const NAME_TOKEN_WEIGHT = 3
const DESC_TOKEN_WEIGHT = 1
const ENTITY_BOOST = 6
// Below this an item isn't "meaningfully" relevant — one lonely description
// token shouldn't force a weak suggestion. One name-token match (=3), a literal
// mention, or ~3 description tokens all clear it.
const MIN_SCORE = 3

/** Score a single candidate against the pre-tokenized task. Higher = better. */
function scoreCandidate(
	candidate: BrainCandidate,
	taskTokens: Set<string>,
	taskLower: string,
): number {
	const nameTokens = new Set(tokenize(candidate.name))
	const descTokens = new Set(tokenize(candidate.description))

	let score = 0
	// Count each DISTINCT task token once per field so a long description can't
	// snowball its way to the top on repetition alone.
	for (const t of taskTokens) {
		if (nameTokens.has(t)) score += NAME_TOKEN_WEIGHT
		else if (descTokens.has(t)) score += DESC_TOKEN_WEIGHT
	}

	// Entity / phrase boost: the item's own name appears verbatim in the task
	// ("run the pdf-export skill", "use ripgrep"). Guard against 1-char names.
	const nameLower = candidate.name.toLowerCase().trim()
	if (nameLower.length > 1 && taskLower.includes(nameLower)) score += ENTITY_BOOST

	return score
}

/**
 * Find the Brain items most relevant to `taskText`. Local, synchronous, and
 * safe: returns [] on an empty Brain or when nothing meaningfully matches (it
 * never forces a weak suggestion). Default cap 5.
 */
export function recallRelevant(
	taskText: string,
	opts?: { limit?: number },
): RecallItem[] {
	const text = (taskText || "").trim()
	if (!text) return []

	const taskTokens = new Set(tokenize(text))
	if (taskTokens.size === 0) return []

	const taskLower = text.toLowerCase()
	const limit = Math.max(1, opts?.limit ?? 5)

	const scored: RecallItem[] = []
	for (const candidate of readBrainCandidates()) {
		const score = scoreCandidate(candidate, taskTokens, taskLower)
		if (score >= MIN_SCORE) scored.push({ ...candidate, score })
	}

	// Strongest first; verified breaks ties (a tested item is the safer pick).
	scored.sort((a, b) => b.score - a.score || Number(b.verified) - Number(a.verified))
	return scored.slice(0, limit)
}
