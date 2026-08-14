/**
 * Type definitions for the Electron preload bridge.
 *
 * These types are shared between the preload script and the renderer.
 * The renderer accesses these via `window.hramble`.
 */

export interface OpenCodeServerInfo {
	url: string
	pid: number | null
	managed: boolean
}

export interface ModelRef {
	providerID: string
	modelID: string
}

export interface ModelState {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

export interface UpdateState {
	status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"
	version?: string
	releaseNotes?: string
	progress?: {
		percent: number
		bytesPerSecond: number
		transferred: number
		total: number
	}
	error?: string
	/** Whether the app can auto-install updates (false on unsigned macOS builds). */
	canAutoInstall: boolean
}

// ============================================================
// Git types
// ============================================================

export type GraphNodeKind =
	| "command"
	| "decide"
	| "option"
	| "plan"
	| "implement"
	| "verify"
	| "repair"
	| "integrate"
	| "done"

export type GraphNodeStatus = "queued" | "working" | "done" | "failed" | "repair" | "rejected"

export interface GraphNode {
	id: string
	parent?: string
	refs?: string[]
	kind: GraphNodeKind
	title: string
	status: GraphNodeStatus
	ts: number
	files?: string[]
	commit?: string
	summary?: string
}

export type GraphEvent = Partial<GraphNode> & { id: string }

export interface GraphSessionSummary {
	session: string
	title: string
	ts: number
	nodeCount: number
	status: GraphNodeStatus
}

export interface GitBranchInfo {
	current: string
	detached: boolean
	local: string[]
	remote: string[]
}

export interface GitStatusInfo {
	isClean: boolean
	staged: number
	modified: number
	untracked: number
	conflicted: number
	summary: string
}

export interface GitCheckoutResult {
	success: boolean
	error?: string
}

export interface GitStashResult {
	success: boolean
	stashed: boolean
	error?: string
}

export interface GitDiffStat {
	filesChanged: number
	insertions: number
	deletions: number
	files: { path: string; insertions: number; deletions: number }[]
}

export interface GitCommitResult {
	success: boolean
	commitHash?: string
	error?: string
}

export interface GitPushResult {
	success: boolean
	error?: string
}

export interface GitApplyResult {
	success: boolean
	filesApplied: string[]
	error?: string
}

export interface GitMergeResult {
	success: boolean
	conflictedFiles: string[]
	error?: string
}

// ============================================================
// Open-in-targets types
// ============================================================

export interface OpenInTarget {
	id: string
	label: string
	available: boolean
	/** Base64-encoded PNG icon data URL, resolved at runtime from the installed app. */
	iconDataUrl?: string
}

export interface OpenInTargetsResult {
	targets: OpenInTarget[]
	availableTargets: string[]
	preferredTarget: string | null
}

// ============================================================
// Server config types (shared between main process and renderer)
// ============================================================

/** Built-in local server, auto-managed by Hramble via OpenCodeManager. */
export interface LocalServerConfig {
	id: "local"
	name: string
	type: "local"
	/** Hostname the local server binds to (default "127.0.0.1"). Use "0.0.0.0" to expose on the network. */
	hostname?: string
	/** Port the local server listens on (default 4101). */
	port?: number
	/** Whether a password is configured for the local server (stored in safeStorage). */
	hasPassword?: boolean
	/** Enable mDNS service discovery so this server is advertised on the local network. */
	mdns?: boolean
	/** Custom mDNS domain name (default "opencode.local"). Only used when mdns is enabled. */
	mdnsDomain?: string
}

/** Remote server reachable over HTTP(S). */
export interface RemoteServerConfig {
	id: string
	name: string
	type: "remote"
	/** Full base URL, e.g. "https://opencode.example.com:4096" */
	url: string
	/** Basic Auth username (defaults to "opencode" if omitted). */
	username?: string
	/** Whether a password is stored in safeStorage (never stored in settings.json). */
	hasPassword?: boolean
}

/** SSH tunnel server (future -- type is defined now to avoid config migration later). */
export interface SshServerConfig {
	id: string
	name: string
	type: "ssh"
	sshHost: string
	sshPort?: number
	sshUser: string
	sshAuthMethod: "key" | "password" | "agent"
	sshKeyPath?: string
	/** Where OpenCode listens on the remote machine (default 127.0.0.1). */
	remoteHost?: string
	remotePort: number
	/** Basic Auth username for the OpenCode server (defaults to "opencode"). */
	username?: string
	hasPassword?: boolean
}

export type ServerConfig = LocalServerConfig | RemoteServerConfig | SshServerConfig

// ============================================================
// mDNS discovery types
// ============================================================

/** A server discovered via mDNS on the local network. */
export interface DiscoveredMdnsServer {
	/** Unique key derived from host:port. */
	id: string
	/** Service name from mDNS (e.g. "opencode-4096"). */
	name: string
	/** Resolved hostname or IP address. */
	host: string
	/** Port the OpenCode server is listening on. */
	port: number
	/** IP addresses reported by the service. */
	addresses: string[]
}

/** The default built-in local server entry (defined in server-config.ts). */
export declare const DEFAULT_LOCAL_SERVER: LocalServerConfig

export interface ServerSettings {
	/** Ordered list of configured servers. The local server is always first. */
	servers: ServerConfig[]
	/** ID of the currently active server. */
	activeServerId: string
}

// ============================================================
// Settings types (shared between main process and renderer)
// ============================================================

export type CompletionNotificationMode = "off" | "unfocused" | "always"

export interface NotificationSettings {
	completionMode: CompletionNotificationMode
	permissions: boolean
	questions: boolean
	errors: boolean
	dockBadge: boolean
}

export interface AppSettings {
	notifications: NotificationSettings
	/** Whether the user prefers opaque (solid) windows. Read at window creation time. */
	opaqueWindows: boolean
	/**
	 * Layer 1 — Always-Aware Brain. When on (default), a compact catalog of the
	 * user's saved Brain (skills, repos, docs, tools, models, connectors) is
	 * injected into every session so the agent always knows its inventory.
	 */
	brainCatalogInSessions: boolean
	/**
	 * Layer 2 — Auto-Recall. When on (default), each new task is matched against
	 * the saved Brain and the few most relevant items (skills, tools, models,
	 * connectors, …) are surfaced to the agent for that task. Independent of the
	 * Layer 1 `brainCatalogInSessions` toggle.
	 */
	brainAutoRecall: boolean
	/**
	 * Layer 3 — Episodic Memory. When on (default), each finished task is recorded
	 * as a compact episode (request, outcome, relevant Brain items, optional
	 * lesson), and each new task is matched against those past episodes so the
	 * agent is reminded of a similar past job — reusing what worked and avoiding
	 * past mistakes. Independent of the Layer 1/2 toggles; when off, both capture
	 * and recall are skipped.
	 */
	brainEpisodicMemory: boolean
	/** Server connection configuration. */
	servers: ServerSettings
}

// ============================================================
// CLI install types
// ============================================================

export interface CliInstallResult {
	success: boolean
	error?: string
}

// ============================================================
// Onboarding types
// ============================================================

export interface OpenCodeCheckResult {
	installed: boolean
	version: string | null
	path: string | null
	compatible: boolean
	compatibility: "ok" | "too-old" | "too-new" | "blocked" | "unknown"
	message: string | null
}

/** Supported migration source providers. */
export type MigrationProvider = "claude-code" | "cursor" | "opencode"

/** Detection result for a single provider. */
export interface ProviderDetection {
	provider: MigrationProvider
	found: boolean
	label: string
	summary: string
	mcpServerCount: number
	agentCount: number
	commandCount: number
	ruleCount: number
	skillCount: number
	projectCount: number
	hasGlobalSettings: boolean
	hasPermissions: boolean
	hasHooks: boolean
	totalSessions: number
	totalMessages: number
}

export interface MigrationCategoryPreview {
	category: string
	itemCount: number
	files: MigrationFilePreview[]
}

export interface MigrationFilePreview {
	path: string
	status: "new" | "modified" | "skipped"
	lineCount: number
	content?: string
}

export interface MigrationPreview {
	categories: MigrationCategoryPreview[]
	warnings: string[]
	manualActions: string[]
	errors: string[]
	fileCount: number
	sessionCount: number
	sessionProjectCount: number
}

export interface MigrationResult {
	success: boolean
	filesWritten: string[]
	filesSkipped: string[]
	backupDir: string | null
	warnings: string[]
	manualActions: string[]
	errors: string[]
	/** Number of history sessions that were skipped as duplicates */
	historyDuplicatesSkipped: number
}

export interface MigrationProgress {
	phase: string
	current: number
	total: number
	duplicatesSkipped: number
}

export interface AppInfo {
	version: string
	isDev: boolean
}

export type WindowChromeTier = "liquid-glass" | "vibrancy" | "opaque"

// ============================================================
// Automation types
// ============================================================

export interface AutomationSchedule {
	rrule: string
	timezone: string
}

export type PermissionPreset = "default" | "allow-all" | "read-only"

export interface ExecutionConfig {
	/** Model to use in "providerID/modelID" format (e.g. "anthropic/claude-opus-4-5"). Defaults to server default. */
	model?: string
	/** Agent name to use (e.g. "build", "research"). Defaults to server default agent. */
	agent?: string
	/** Model variant name (e.g. "extended" for extended thinking). Defaults to model default. */
	variant?: string
	effort: "low" | "medium" | "high"
	timeout: number
	retries: number
	retryDelay: number
	parallelWorkspaces: boolean
	approvalPolicy: "never" | "auto-edit"
	/** Whether to run in an isolated git worktree (default: true) */
	useWorktree: boolean
	/** Permission preset controlling agent tool access */
	permissionPreset: PermissionPreset
}

export type AutomationStatus = "active" | "paused" | "archived"

export interface Automation {
	id: string
	name: string
	prompt: string
	status: AutomationStatus
	schedule: AutomationSchedule
	workspaces: string[]
	execution: ExecutionConfig
	nextRunAt: number | null
	lastRunAt: number | null
	runCount: number
	consecutiveFailures: number
	createdAt: number
	updatedAt: number
}

export type AutomationRunStatus =
	| "queued"
	| "running"
	| "pending_review"
	| "accepted"
	| "archived"
	| "failed"

export interface AutomationRun {
	id: string
	automationId: string
	workspace: string
	status: AutomationRunStatus
	attempt: number
	sessionId: string | null
	worktreePath: string | null
	startedAt: number | null
	completedAt: number | null
	timeoutAt: number | null
	resultTitle: string | null
	resultSummary: string | null
	resultHasActionable: boolean | null
	resultBranch: string | null
	resultPrUrl: string | null
	errorMessage: string | null
	archivedReason: string | null
	archivedAssistantMessage: string | null
	readAt: number | null
	createdAt: number
	updatedAt: number
}

export interface CreateAutomationInput {
	name: string
	prompt: string
	schedule: { rrule: string; timezone?: string }
	workspaces: string[]
	execution?: Partial<ExecutionConfig>
}

export interface UpdateAutomationInput {
	id: string
	name?: string
	prompt?: string
	status?: AutomationStatus
	schedule?: { rrule: string; timezone?: string }
	workspaces?: string[]
	execution?: Partial<ExecutionConfig>
}

export interface HrambleAPI {
	/** The host platform: "darwin", "win32", or "linux". */
	platform: NodeJS.Platform
	getAppInfo: () => Promise<AppInfo>
	getHomeDir: () => Promise<string>

	/**
	 * Layer 2 — Auto-Recall. Returns the saved Brain items most relevant to a
	 * task's text (local keyword+entity match). Resolves to [] when the
	 * `brainAutoRecall` toggle is off or nothing meaningfully matches.
	 */
	recallBrain?: (
		taskText: string,
		opts?: { limit?: number },
	) => Promise<
		Array<{
			name: string
			type: string
			description: string
			verified: boolean
			source?: string
			score: number
		}>
	>

	/**
	 * Layer 3 — Episodic Memory. Returns the past episodes most similar to a task's
	 * text (local match). Resolves to [] when the `brainEpisodicMemory` toggle is
	 * off or nothing meaningfully matches.
	 */
	recallEpisodes?: (
		taskText: string,
		opts?: { limit?: number },
	) => Promise<
		Array<{
			id: string
			timestamp: number
			task: string
			outcome: "success" | "failed" | "unknown"
			itemsUsed: string[]
			lesson?: string
			score: number
		}>
	>

	/**
	 * Layer 3 — record (or refine) a finished task's episode. No-ops when the
	 * `brainEpisodicMemory` toggle is off. Best-effort; never rejects.
	 */
	recordEpisode?: (input: {
		id: string
		task: string
		outcome?: "success" | "failed" | "unknown"
		lesson?: string
	}) => Promise<{ ok: boolean }>

	/** Layer 3 — read-only list of recorded episodes, most recent first. */
	listEpisodes?: (opts?: { limit?: number }) => Promise<
		Array<{
			id: string
			timestamp: number
			task: string
			outcome: "success" | "failed" | "unknown"
			itemsUsed: string[]
			lesson?: string
		}>
	>

	/**
	 * "Keep as reference" — copy a whole file into the Brain, verbatim, registered
	 * as a reference item the agent can open in full later (as opposed to the
	 * extract-into-a-skill flow). Writes skills/<slug>/SKILL.md (type: docs,
	 * verified: true, reference: true) next to a copy of the original file.
	 * Guarded in the main process; resolves with the outcome and never rejects.
	 */
	saveBrainReference?: (
		filePath: string,
		opts?: { description?: string },
	) => Promise<{ ok: boolean; slug?: string; storedPath?: string; error?: string }>

	/**
	 * Reads one Brain skill-backed item's full SKILL.md (raw frontmatter + body)
	 * plus its parsed fields, so the Vault viewer can show and edit exactly what's
	 * on disk. Resolves the folder from the item's name (same slug approach as the
	 * rest of the Brain). `storedPath` is the copied original file for a reference
	 * item. Guarded in main; resolves with the outcome and never rejects.
	 */
	readBrainItem?: (id: string) => Promise<{
		ok: boolean
		content?: string
		name?: string
		description?: string
		type?: string
		source?: string
		reference?: boolean
		storedPath?: string
		error?: string
	}>

	/**
	 * Overwrites one EXISTING Brain item's SKILL.md with edited raw text (the
	 * Vault viewer's Edit → Save), then refreshes the Layer-1 catalog so the edit
	 * shows in the next session's inventory. Never creates a new item. Guarded.
	 */
	writeBrainItem?: (id: string, content: string) => Promise<{ ok: boolean; error?: string }>

	/**
	 * Reveals a reference item's stored original file in the OS file manager.
	 * Only reveals paths inside the Brain's skills dir. Guarded; never rejects.
	 */
	revealBrainItem?: (path: string) => Promise<{ ok: boolean; error?: string }>

	/** Subscribe to chrome tier notification (fired once on load). */
	onChromeTier: (callback: (tier: WindowChromeTier) => void) => () => void
	/** Get the current chrome tier (pull-based, avoids race with push event). */
	getChromeTier: () => Promise<WindowChromeTier>

	ensureOpenCode: () => Promise<OpenCodeServerInfo>
	getServerUrl: () => Promise<string | null>
	/** Run a shell command in `cwd`; resolves with its exit code + captured output. */
	runShell: (
		cwd: string,
		command: string,
		timeoutMs?: number,
	) => Promise<{ code: number; stdout: string; stderr: string }>
	stopOpenCode: () => Promise<boolean>
	restartOpenCode: () => Promise<OpenCodeServerInfo>
	getModelState: () => Promise<ModelState>
	updateModelRecent: (model: ModelRef) => Promise<ModelState>

	// Credential storage (safeStorage-backed, passwords never leave main process in plain text)
	credential: {
		/** Store an encrypted password for a server. */
		store: (serverId: string, password: string) => Promise<void>
		/** Retrieve a decrypted password for a server (only returns to renderer for auth headers). */
		get: (serverId: string) => Promise<string | null>
		/** Delete a stored password. */
		delete: (serverId: string) => Promise<void>
	}

	/** Test connectivity to a remote OpenCode server. Returns null on success or an error message. */
	testServerConnection: (
		url: string,
		username?: string,
		password?: string,
	) => Promise<string | null>

	// mDNS discovery
	mdns: {
		/** Get the current list of discovered servers. */
		getDiscovered: () => Promise<DiscoveredMdnsServer[]>
		/** Subscribe to discovered server list changes. Returns an unsubscribe function. */
		onChanged: (callback: (servers: DiscoveredMdnsServer[]) => void) => () => void
	}

	// Auto-updater
	getUpdateState: () => Promise<UpdateState>
	checkForUpdates: () => Promise<void>
	downloadUpdate: () => Promise<void>
	installUpdate: () => Promise<void>
	/** Opens the GitHub release page for the current update version (fallback for unsigned macOS). */
	openReleasePage: () => Promise<void>
	onUpdateStateChanged: (callback: (state: UpdateState) => void) => () => void

	// Git operations
	git: {
		listBranches: (directory: string) => Promise<GitBranchInfo>
		getStatus: (directory: string) => Promise<GitStatusInfo>
		checkout: (directory: string, branch: string) => Promise<GitCheckoutResult>
		stashAndCheckout: (directory: string, branch: string) => Promise<GitStashResult>
		stashPop: (directory: string) => Promise<GitStashResult>
		getRoot: (directory: string) => Promise<string | null>
		diffStat: (directory: string) => Promise<GitDiffStat>
		commitAll: (directory: string, message: string) => Promise<GitCommitResult>
		push: (directory: string, remote?: string) => Promise<GitPushResult>
		createBranch: (directory: string, branchName: string) => Promise<GitCheckoutResult>
		applyToLocal: (worktreeDir: string, localDir: string) => Promise<GitApplyResult>
		applyDiffText: (localDir: string, diffText: string) => Promise<GitApplyResult>
		getRemoteUrl: (directory: string, remote?: string) => Promise<string | null>
		mergeBranch: (directory: string, branchName: string) => Promise<GitMergeResult>
	}

	// Work-graph store (.hramble/graph) — the persistent record behind the Graph view.
	graph: {
		record: (directory: string, sessionId: string, event: GraphEvent) => Promise<{ ok: boolean }>
		session: (directory: string, sessionId: string) => Promise<GraphNode[]>
		sessions: (directory: string) => Promise<GraphSessionSummary[]>
	}

	// Custom window controls (Windows only — replaces titleBarOverlay)
	minimizeWindow?: () => Promise<void>
	maximizeWindow?: () => Promise<void>
	closeWindow?: () => Promise<void>

	// Window preferences (opaque windows / transparency)
	/** Get the persisted opaque windows preference from the main process. */
	getOpaqueWindows: () => Promise<boolean>
	/** Set the opaque windows preference and persist it in the main process. */
	setOpaqueWindows: (value: boolean) => Promise<{ success: boolean }>
	/** Relaunch the app (used after toggling transparency). */
	relaunch: () => Promise<void>

	// CLI install
	cli: {
		isInstalled: () => Promise<boolean>
		install: () => Promise<CliInstallResult>
		uninstall: () => Promise<CliInstallResult>
	}

	// Open in external app
	openIn: {
		getTargets: () => Promise<OpenInTargetsResult>
		open: (directory: string, targetId: string, persistPreferred?: boolean) => Promise<void>
		setPreferred: (targetId: string) => Promise<{ success: boolean }>
	}

	// Native theme (syncs macOS glass tint to app color scheme)
	/** Set the native theme source ("light" | "dark" | "system") to control macOS glass tint. */
	setNativeTheme: (source: string) => Promise<void>

	// System accent color
	/** Get the system accent color as an 8-char hex RRGGBBAA string, or null if unavailable. */
	getAccentColor: () => Promise<string | null>
	/** Subscribe to system accent color changes. Returns an unsubscribe function. */
	onAccentColorChanged: (callback: (color: string) => void) => () => void

	/** Opens a URL in the system's default browser (e.g. real Chrome), not Hramble's embedded browser pane. */
	openExternal: (url: string) => Promise<void>
	/** Reveals the bundled "Hramble Console Bridge" Chrome extension source in Finder/Explorer, for a manual "Load unpacked" install. */
	revealChromeExtension: () => Promise<void>

	/** Subscribe to the Mac going to sleep. */
	onPowerSuspend: (callback: () => void) => () => void
	/** Subscribe to the Mac waking up from sleep. */
	onPowerResume: (callback: () => void) => () => void

	// Directory picker
	pickDirectory: () => Promise<string | null>
	/** Opens a native file picker for an HTML/SVG page. Returns the selected path, or null if cancelled. */
	pickHtmlFile: () => Promise<string | null>
	/** Serves a local file's directory over localhost and returns the resulting URL (not file://). */
	servePreviewFile: (filePath: string) => Promise<string>

	// Fetch proxy (bypasses Chromium connection limits)
	fetch: (req: {
		url: string
		method: string
		headers: Record<string, string>
		body: string | null
	}) => Promise<{
		status: number
		statusText: string
		headers: Record<string, string>
		body: string | null
	}>

	// Notifications
	/** Subscribe to navigation events from native OS notification clicks. */
	onNotificationNavigate: (callback: (data: { sessionId: string }) => void) => () => void
	/** Dismiss any active notification for a session. */
	dismissNotification: (sessionId: string) => Promise<void>
	/** Update the dock badge / app badge count. */
	updateBadgeCount: (count: number) => Promise<void>

	// Settings
	/** Get the full app settings object. */
	getSettings: () => Promise<AppSettings>
	/** Update settings with a partial object (deep-merged). Returns the updated settings. */
	updateSettings: (partial: Record<string, unknown>) => Promise<AppSettings>
	/** Subscribe to settings changes pushed from the main process. */
	onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

	// Onboarding
	// Automations
	automation: {
		list: () => Promise<Automation[]>
		get: (id: string) => Promise<Automation | null>
		create: (input: CreateAutomationInput) => Promise<Automation>
		update: (input: UpdateAutomationInput) => Promise<Automation | null>
		delete: (id: string) => Promise<boolean>
		runNow: (id: string) => Promise<boolean>
		listRuns: (automationId?: string) => Promise<AutomationRun[]>
		archiveRun: (runId: string) => Promise<boolean>
		acceptRun: (runId: string) => Promise<boolean>
		markRunRead: (runId: string) => Promise<boolean>
		previewSchedule: (rrule: string, timezone: string) => Promise<string[]>
	}
	/** Subscribe to automation run state changes. */
	onAutomationRunsUpdated: (callback: () => void) => () => void

	onboarding: {
		checkOpenCode: () => Promise<OpenCodeCheckResult>
		installOpenCode: () => Promise<{ success: boolean; error?: string }>
		onInstallOutput: (callback: (text: string) => void) => () => void
		/** Quick-detect all supported providers (Claude Code, Cursor, OpenCode). */
		detectProviders: () => Promise<ProviderDetection[]>
		/** Full scan of a specific provider's configuration. */
		scanProvider: (
			provider: MigrationProvider,
		) => Promise<{ detection: ProviderDetection; scanResult: unknown }>
		/** Dry-run migration preview for a provider. */
		previewMigration: (
			provider: MigrationProvider,
			scanResult: unknown,
			categories: string[],
		) => Promise<MigrationPreview>
		/** Execute migration (writes files with backup). */
		executeMigration: (
			provider: MigrationProvider,
			scanResult: unknown,
			categories: string[],
		) => Promise<MigrationResult>
		/** Subscribe to migration progress updates (history writing). */
		onMigrationProgress: (callback: (progress: MigrationProgress) => void) => () => void
		/** Restore the most recent migration backup. */
		restoreBackup: () => Promise<{
			success: boolean
			restored: string[]
			removed: string[]
			errors: string[]
		}>
	}
}

declare global {
	interface Window {
		hramble: HrambleAPI
	}
}
