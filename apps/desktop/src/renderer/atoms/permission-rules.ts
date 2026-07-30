/**
 * Durable permission rules — the persistent, user-editable layer that makes the
 * permission system Claude-grade.
 *
 * The Plan/Manual/Accept-Edits/Auto/Bypass modes (see `chat-mode.ts`) are the
 * per-session *base*. These rules sit on top of that base and **survive
 * restarts**, so a "Always allow" decision (or a rule the user writes in
 * Settings) keeps applying to every future session — instead of re-asking each
 * time.
 *
 * Precedence is last-match-wins in the array we hand to `session.create`:
 *
 *     [ ...mode base , ...user-scope rules , ...project-scope rules ]
 *       lowest                                          highest
 *
 * so a project rule overrides a user rule, which overrides the mode default —
 * the hierarchy Claude Code gets from enterprise/project/user settings files.
 */
import { atomWithStorage } from "jotai/utils"

export type PermissionAction = "allow" | "ask" | "deny"
export type PermissionScope = "user" | "project"

/** A durable, user-managed permission rule. Persisted across sessions. */
export interface UserPermissionRule {
	id: string
	/** Permission type: edit | write | patch | bash | webfetch | external_directory | browser | * */
	permission: string
	/** Glob-ish pattern the engine matches against (e.g. "*npm test*", "*"). */
	pattern: string
	action: PermissionAction
	/** "user" applies everywhere; "project" only within `directory`. */
	scope: PermissionScope
	/** Project directory this rule is scoped to (when scope === "project"). */
	directory?: string
	/** Optional human note shown in Settings (e.g. "allow test runs"). */
	note?: string
	createdAt: number
}

/** The engine's per-session rule shape (what `session.create` expects). */
export interface SessionPermissionRule {
	permission: string
	pattern: string
	action: PermissionAction
}

/** The permission types the engine understands, for the Settings dropdown. */
export const PERMISSION_TYPES = [
	"bash",
	"edit",
	"write",
	"patch",
	"webfetch",
	"external_directory",
	"browser",
	"*",
] as const

/** Persistent store (localStorage-backed). One flat list; scope lives per-rule. */
export const permissionRulesAtom = atomWithStorage<UserPermissionRule[]>(
	"hramble:permissionRules",
	[],
)

/** Collision-resistant id without pulling in a uuid dependency. */
export function newRuleId(seed = "rule"): string {
	return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const toSessionRule = (r: UserPermissionRule): SessionPermissionRule => ({
	permission: r.permission,
	pattern: r.pattern || "*",
	action: r.action,
})

/**
 * Layer the durable rules on top of a mode's base ruleset.
 *
 * Returns `undefined` when there is no base (e.g. Plan mode, which runs a
 * read-only agent) so persistent *allow* rules can never quietly weaken a
 * read-only session.
 */
export function mergeSessionPermission(
	base: readonly SessionPermissionRule[] | null | undefined,
	directory: string,
	rules: readonly UserPermissionRule[],
): SessionPermissionRule[] | undefined {
	if (!base) return undefined
	const userRules = rules.filter((r) => r.scope === "user").map(toSessionRule)
	const projectRules = rules
		.filter((r) => r.scope === "project" && r.directory === directory)
		.map(toSessionRule)
	return [...base, ...userRules, ...projectRules]
}
