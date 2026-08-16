// Companion persona phrases — ported from the desktop AvatarBox companion
// (server.js). Three personas: Smart / Buddy / Live. Each has a `hello` set
// (spoken on unmute/greeting) and a `done` set (spoken when a task finishes).
// These phrases are safe to edit — just keep each style's `hello`/`done`
// arrays non-empty.

export type CompanionStyle = "smart" | "buddy" | "live"

/** Ordered list of styles (used for the selector dropdown). */
export const COMPANION_STYLES: CompanionStyle[] = ["smart", "buddy", "live"]

/** Short human-facing labels for each style. */
export const COMPANION_STYLE_LABELS: Record<CompanionStyle, string> = {
	smart: "Smart",
	buddy: "Buddy",
	live: "Live",
}

type PhraseSet = { hello: string[]; done: string[] }

export const COMPANION_PHRASES: Record<CompanionStyle, PhraseSet> = {
	buddy: {
		hello: [
			"Hey! I am here, all ready for you.",
			"Hi there! Just let me know what you need.",
			"Good to see you! I am all set.",
			"Hey! I am here and ready to help.",
			"I am here with you, let's do this!",
		],
		done: [
			"Done! Go ahead and have a look.",
			"All finished! Let me know what you think.",
			"That is done, easy one actually!",
			"All good! I got it done for you.",
			"Done and ready! Have a look when you can.",
			"Finished! That one went smoothly.",
			"Done! Hope that is what you wanted.",
			"That is sorted! Go check it out.",
			"Ready! I think you will like it.",
		],
	},
	smart: {
		hello: ["Ready.", "Online.", "Standing by.", "Ready when you are.", "Systems ready."],
		done: [
			"Task complete.",
			"Done.",
			"All set.",
			"Finished.",
			"Changes applied.",
			"Ready for review.",
			"Complete.",
		],
	},
	live: {
		hello: [
			"Watching your workspace.",
			"Live and watching.",
			"I'm on — watching now.",
			"Session started. Watching.",
			"Online and live.",
		],
		done: [
			"Task complete — ready for you.",
			"Finished — ready for you.",
			"Changes applied. Ready.",
			"All updates done. Ready for you.",
			"Complete — take a look.",
			"Done — ready for review.",
		],
	},
}

/**
 * Turn a live tool event into a short spoken line for the SMART / LIVE personas
 * (e.g. "Editing foo.ts", "Running npm", "Reading utils.js"). Ported from the
 * desktop AvatarBox companion phrasing.
 *
 * Returns `null` for tools that aren't worth narrating (trivial internal tools).
 */
export function narrateToolEvent(
	tool: string,
	opts: { filePath?: string; command?: string },
): string | null {
	const t = (tool || "").toLowerCase()

	// Skip trivial / noisy internal tools — not worth speaking aloud.
	if (t === "todowrite" || t === "todoread" || t === "task" || t === "skill") return null

	// basename of the file path (last path segment), and first word of a command.
	const f = opts.filePath ? opts.filePath.split(/[\\/]/).filter(Boolean).pop() : undefined
	const cmd = opts.command ? opts.command.trim().split(/\s+/)[0] : undefined

	if (t === "edit" || t === "write" || t === "patch" || t === "apply_patch" || t === "replace") {
		return f ? `Editing ${f}.` : "Editing files."
	}
	if (t === "read") {
		return f ? `Reading ${f}.` : "Reading files."
	}
	if (t === "grep" || t === "glob") {
		return f ? `Searching ${f}.` : "Scanning files."
	}
	if (t === "bash" || t === "shell") {
		return cmd ? `Running ${cmd}.` : "Running a command."
	}

	// Fallback for anything else.
	return f ? `Working on ${f}.` : `Using ${tool}.`
}

/**
 * Pick a phrase for a given style + kind. Pass a rotating `index` to mirror the
 * avatar's existing `phraseIdx` behavior (wraps around the set); omit it to get
 * a random phrase.
 */
export function pickPhrase(
	style: CompanionStyle,
	kind: "hello" | "done",
	index?: number,
): string {
	const set = COMPANION_PHRASES[style][kind]
	if (index !== undefined) return set[index % set.length]
	return set[Math.floor(Math.random() * set.length)]
}
