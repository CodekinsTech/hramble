// Hramble safety classifier — a last-line backstop that blocks catastrophic,
// irreversible shell commands *before they run*, in every mode (including
// Bypass). This complements the per-mode permission policy: the modes decide
// when to *ask*; this decides what should never run unattended at all.
//
// It is a fast, rule-based risk classifier (no per-command model call, so no
// latency tax) tuned for HIGH PRECISION — it only blocks commands that are
// almost never intentional in a coding session (wiping the disk/root/home, fork
// bombs, formatting a filesystem, raw-device writes). Everyday risky-but-normal
// commands (a scoped `rm -rf ./build`, `git reset --hard`) are intentionally NOT
// blocked here — those are handled by the permission modes, which can ask.
//
// The command text is read from the bash tool's own args (`output.args.command`),
// so detection sees exactly what will execute — not a paraphrase.

/** High-confidence "never run this unattended" patterns. Each has a reason. */
const CATASTROPHIC = [
	{ re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(?:--\s+)?(?:\/|\/\*|~|\$HOME|\.\s*\/?)(?:\s|$)/i, why: "recursive delete of / , ~ , or the whole tree" },
	{ re: /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+(?:--\s+)?(?:\/|\/\*|~|\$HOME)(?:\s|$)/i, why: "recursive force-delete of / or home" },
	{ re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
	{ re: /\bmkfs(\.[a-z0-9]+)?\b/i, why: "formatting a filesystem" },
	{ re: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|disk|hd|vd)/i, why: "raw write to a disk device" },
	{ re: />\s*\/dev\/(?:sd|nvme|disk|hd|vd)[a-z0-9]*/i, why: "redirect over a disk device" },
	{ re: /\b(?:chmod|chown)\s+-[a-z]*R[a-z]*\s+[^\n]*\s\/(?:\s|$)/i, why: "recursive permission/owner change on /" },
	{ re: /\bwipefs\b/i, why: "wiping filesystem signatures" },
	{ re: /\bshred\b[^\n]*\/dev\//i, why: "shredding a device" },
]

/** Classify a shell command. Returns the matched reason, or null if it's fine. */
function classify(command) {
	const cmd = String(command || "")
	if (!cmd.trim()) return null
	for (const rule of CATASTROPHIC) {
		if (rule.re.test(cmd)) return rule.why
	}
	return null
}

export default async () => ({
	"tool.execute.before": async (input, output) => {
		// Only the shell tool can run these; everything else is out of scope.
		if (input?.tool !== "bash") return
		const command = output?.args?.command
		const reason = classify(command)
		if (reason) {
			// Throwing here stops the tool from executing and surfaces the reason to
			// the agent, which then explains it / asks the user to run it manually.
			throw new Error(
				`Blocked by Hramble safety: this command looks catastrophic (${reason}). ` +
					`It was not run. If you genuinely intend this, ask the user to run it themselves.`,
			)
		}
	},
})
