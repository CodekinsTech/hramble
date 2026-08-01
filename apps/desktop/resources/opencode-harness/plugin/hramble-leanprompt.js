// Hramble lean prompt — model-aware system prompt.
//
// Cloud models (Claude, Kimi, …) keep the full ~10K-token professional-coder
// prompt — they digest it effortlessly and it gives Claude-grade behaviour.
//
// Local models (Ollama) can't prefill a 10K-token prompt fast on a laptop —
// they stall for minutes before emitting a single token. So for Ollama models
// we swap in a compact (~1K-token) prompt: the big prompt is dropped, small
// contextual entries (environment, AGENTS.md/HRAMBLE.md) are kept, and this lean
// coding brief is prepended. That takes prefill from ~13K tokens down to ~3–4K,
// which is what makes a local model actually respond.

const LEAN_PROMPT = `You are Hramble, a hands-on AI coding agent working inside the user's project.

Act — don't just talk. Use your tools to read, write, and edit files and to run commands, then briefly say what you did. For a simple request (e.g. "make an index.html for a salon page"), immediately create the file with complete, working code. Do NOT ask for a plan, a todo list, or clarification unless the request is genuinely ambiguous.

Your tools:
- write — create a new file with full contents.
- edit — change part of an existing file (read it first).
- read — read a file's contents.
- list / glob — see files; grep — search code.
- bash — run shell commands (build, test, run). Briefly flag anything risky.

How to work:
- Prefer doing over discussing. Keep replies short and concrete.
- Write complete, runnable code that matches the project's existing style.
- Make the change, then confirm what you did in one or two sentences.
- Never invent file paths or APIs — check with read/list/grep when unsure.`

/** Detect a local Ollama-served model across possible model shapes. */
function isLocal(model) {
	const pid =
		model?.providerID ??
		(typeof model?.provider === "string" ? model.provider : model?.provider?.id) ??
		""
	return String(pid).toLowerCase() === "ollama"
}

async function transform(input, output) {
	if (!isLocal(input?.model)) return // cloud models keep the full rich prompt
	if (!Array.isArray(output?.system)) return
	// Keep small contextual entries (environment, project AGENTS.md/HRAMBLE.md);
	// drop the big professional-coder prompt (~40K chars); prepend the lean one.
	const kept = output.system.filter((s) => typeof s === "string" && s.length < 8000)
	output.system.length = 0
	output.system.push(LEAN_PROMPT, ...kept)
}

export default async () => ({
	// Register both names — stock opencode exposes the experimental one; the
	// plain name is a harmless forward-compat alias.
	"experimental.chat.system.transform": transform,
	"chat.system.transform": transform,
})
