/**
 * Permission modes — the Claude-Code-style Plan / Manual / Accept Edits / Auto /
 * Bypass switch. Each mode is a preset over OpenCode's per-session permission
 * ruleset (applied at session.create) plus, for Plan, the read-only `plan` agent.
 *
 * Rulesets are evaluated top-to-bottom; we start from "allow everything" and then
 * override the mutating tools, so a mode is fully self-contained regardless of the
 * agent's defaults.
 */
import { atomWithStorage } from "jotai/utils"

export type ChatMode = "plan" | "manual" | "accept-edits" | "auto" | "bypass"

type PermissionRule = { permission: string; pattern: string; action: "allow" | "deny" | "ask" }

const ALLOW_ALL: PermissionRule = { permission: "*", pattern: "*", action: "allow" }
const ask = (permission: string): PermissionRule => ({ permission, pattern: "*", action: "ask" })

export type ModeSpec = {
	label: string
	blurb: string
	/** Session permission ruleset, or null to use the agent defaults. */
	permission: PermissionRule[] | null
	/** Force an OpenCode agent (Plan mode uses the read-only `plan` agent). */
	agent: string | null
}

export const CHAT_MODES: Record<ChatMode, ModeSpec> = {
	plan: {
		label: "Plan",
		blurb: "Read-only. Explores and proposes a plan — makes no changes.",
		permission: null,
		agent: "plan",
	},
	manual: {
		label: "Manual",
		blurb: "Asks before every edit, file write, and command.",
		permission: [ALLOW_ALL, ask("edit"), ask("write"), ask("patch"), ask("bash")],
		agent: null,
	},
	"accept-edits": {
		label: "Accept Edits",
		blurb: "Applies edits automatically, but asks before running commands.",
		permission: [ALLOW_ALL, ask("bash")],
		agent: null,
	},
	auto: {
		label: "Auto",
		blurb: "Runs edits and commands automatically. Stops only for risky prompts.",
		permission: null,
		agent: null,
	},
	bypass: {
		label: "Bypass",
		blurb: "Runs everything with no confirmations. Use with care.",
		permission: [ALLOW_ALL],
		agent: null,
	},
}

export const CHAT_MODE_ORDER: ChatMode[] = ["plan", "manual", "accept-edits", "auto", "bypass"]

// Default to "auto" — matches the app's existing allow-everything behaviour, so
// nothing changes for current users until they pick a stricter mode.
export const chatModeAtom = atomWithStorage<ChatMode>("hramble:chatMode", "auto")
