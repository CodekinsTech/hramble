/**
 * Shared helpers for OpenCode's default session title.
 *
 * OpenCode names an un-renamed session "New session - <ISO timestamp>". This
 * pattern is used in two places that must stay in sync:
 *  - `components/sidebar.tsx` hides the timestamp from the visible label
 *    (shows just "New session"), keeping it in the row's tooltip instead.
 *  - `atoms/actions/auto-title-session.ts` uses it to detect sessions that
 *    still carry the untouched default, so it knows when it's safe to
 *    silently replace the title with a short AI-generated one.
 *
 * Keep this the single source of truth for the pattern — don't redefine a
 * slightly different regex elsewhere.
 */
export const DEFAULT_SESSION_NAME_RE = /^New session - (.+)$/i

/**
 * Splits a session name into a display label and (if it matches the default
 * pattern) a human-readable "created at" string for use in a tooltip.
 */
export function splitDefaultSessionName(name: string): {
	display: string
	createdAtLabel: string | null
} {
	const match = DEFAULT_SESSION_NAME_RE.exec(name)
	if (!match) return { display: name, createdAtLabel: null }
	const parsed = new Date(match[1])
	const createdAtLabel = Number.isNaN(parsed.getTime()) ? match[1] : parsed.toLocaleString()
	return { display: "New session", createdAtLabel }
}
