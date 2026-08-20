/**
 * Worktree service layer.
 *
 * Provides worktree lifecycle operations (create, list, remove, reset) via
 * the OpenCode experimental worktree API. Works for both local and remote
 * OpenCode servers without any upstream code changes.
 */


// ============================================================
// Types
// ============================================================

/** Result shaped for the existing Hramble UI (compatible with new-chat.tsx flow) */
export interface WorktreeResult {
	/** Absolute path to the worktree root (git worktree directory) */
	worktreeRoot: string
	/**
	 * Workspace path within the worktree, accounting for monorepo subdirectories.
	 * If the source was /repo/packages/app, this points to /worktree/packages/app.
	 */
	worktreeWorkspace: string
	/** The branch name created (e.g. "opencode/fix-auth-bug") */
	branchName: string
}

/** Result from the remote apply-to-local operation */
export interface RemoteApplyResult {
	success: boolean
	message: string
	error?: string
}

// ============================================================
// Name generation
// ============================================================

/** Space-themed word lists for friendly worktree names (29 x 31 = 899 combos). */
const ADJECTIVES = [
	"astral",
	"binary",
	"blazing",
	"crimson",
	"cryo",
	"dark",
	"drifting",
	"fading",
	"frozen",
	"hyper",
	"ionic",
	"laser",
	"liquid",
	"lunar",
	"magnetic",
	"molten",
	"neon",
	"nova",
	"orbital",
	"phantom",
	"plasma",
	"polar",
	"pulse",
	"quantum",
	"radiant",
	"silent",
	"solar",
	"void",
	"warp",
] as const

const NOUNS = [
	"apex",
	"array",
	"atlas",
	"beacon",
	"bolt",
	"comet",
	"core",
	"cosmos",
	"cruiser",
	"drift",
	"eclipse",
	"flare",
	"flux",
	"forge",
	"gate",
	"horizon",
	"meteor",
	"nebula",
	"orbit",
	"photon",
	"probe",
	"pulsar",
	"quasar",
	"reactor",
	"relay",
	"rift",
	"shard",
	"signal",
	"spark",
	"vortex",
	"zenith",
] as const

function pick<const T extends readonly string[]>(list: T): string {
	return list[Math.floor(Math.random() * list.length)]
}

/**
 * Generates a friendly random worktree name using an adjective-noun pair.
 * Examples: "brave-falcon", "neon-pixel", "cosmic-meadow".
 *
 * The server handles collision checking and will append its own suffix if needed,
 * so we don't need to deduplicate on the client side.
 */
export function randomWorktreeName(): string {
	return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

// ============================================================
// Worktree operations (inert)
//
// Worktrees were backed by OpenCode's experimental worktree API. The zyot engine
// has no worktree support, and the UI hides worktree mode when the engine is the
// backend, so these are inert stubs: a clear error / empty result if ever reached.
// ============================================================

const WORKTREE_UNSUPPORTED = "Worktrees are not supported by the engine."

export async function createWorktree(
	_projectDir: string,
	_sourceDir: string,
	_sessionSlug: string,
): Promise<WorktreeResult> {
	throw new Error(WORKTREE_UNSUPPORTED)
}

export async function listWorktrees(_projectDir: string): Promise<string[]> {
	return []
}

export async function removeWorktree(_projectDir: string, _worktreeDir: string): Promise<void> {
	throw new Error(WORKTREE_UNSUPPORTED)
}

export async function resetWorktree(_projectDir: string, _worktreeDir: string): Promise<void> {
	throw new Error(WORKTREE_UNSUPPORTED)
}

export async function applyRemoteDiffToLocal(
	_projectDir: string,
	_sessionId: string,
	_localDir: string,
): Promise<RemoteApplyResult> {
	return { success: false, message: "", error: WORKTREE_UNSUPPORTED }
}
