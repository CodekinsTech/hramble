import { contextBridge, ipcRenderer } from "electron"

/**
 * Preload bridge — exposes a typed API from the main process to the renderer.
 *
 * The renderer accesses these via `window.hramble.*`.
 * All methods return Promises (backed by `ipcRenderer.invoke`).
 */
contextBridge.exposeInMainWorld("hramble", {
	/** The host platform: "darwin", "win32", or "linux". */
	platform: process.platform,

	/** Returns app version and dev/production mode. */
	getAppInfo: () => ipcRenderer.invoke("app:info"),
	getHomeDir: (): Promise<string> => ipcRenderer.invoke("home:dir"),
	getBrainDir: (): Promise<string> => ipcRenderer.invoke("brain:dir"),
	/** Everything that's been added to the Brain (skills/repos/software/models), with verify status. */
	getBrainVault: (): Promise<
		Array<{
			name: string
			description: string
			type: "skill" | "repo" | "software" | "docs" | "model"
			verified: boolean
			source?: string
			addedAt: number
			instructions: string
		}>
	> => ipcRenderer.invoke("brain:vault"),
	/** Zips the Brain (skills + registry) to a user-chosen .zip location. */
	exportBrain: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
		ipcRenderer.invoke("brain:export"),
	/** Unpacks a Brain export .zip back into the local skills folder, merging into existing skills. */
	importBrain: (): Promise<{ ok: boolean; imported?: number; error?: string }> =>
		ipcRenderer.invoke("brain:import"),
	/** Clones a git repo locally for the Brain's Git Repo arm, returning its on-disk path. */
	cloneBrainRepo: (url: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
		ipcRenderer.invoke("brain:clone-repo", url),
	/** Regenerates the always-aware Brain catalog (BRAIN.md) from the current on-disk Brain. */
	refreshBrainCatalog: (): Promise<{ ok: boolean }> =>
		ipcRenderer.invoke("brain:refresh-catalog"),
	/** Layer 2 — returns the Brain items most relevant to a task's text (local match; [] when the toggle is off). */
	recallBrain: (
		taskText: string,
		opts?: { limit?: number },
	): Promise<
		Array<{
			name: string
			type: string
			description: string
			verified: boolean
			source?: string
			score: number
		}>
	> => ipcRenderer.invoke("brain:recall", taskText, opts),
	/** Layer 3 — returns the past episodes most similar to a task's text (local match; [] when the toggle is off). */
	recallEpisodes: (
		taskText: string,
		opts?: { limit?: number },
	): Promise<
		Array<{
			id: string
			timestamp: number
			task: string
			outcome: "success" | "failed" | "unknown"
			itemsUsed: string[]
			lesson?: string
			score: number
		}>
	> => ipcRenderer.invoke("brain:recall-episodes", taskText, opts),
	/** Layer 3 — record (or refine) a finished task's episode. No-ops when the toggle is off. */
	recordEpisode: (input: {
		id: string
		task: string
		outcome?: "success" | "failed" | "unknown"
		lesson?: string
	}): Promise<{ ok: boolean }> => ipcRenderer.invoke("brain:record-episode", input),
	/** Layer 3 — read-only list of recorded episodes, most recent first (for the Brain Vault history view). */
	listEpisodes: (opts?: {
		limit?: number
	}): Promise<
		Array<{
			id: string
			timestamp: number
			task: string
			outcome: "success" | "failed" | "unknown"
			itemsUsed: string[]
			lesson?: string
		}>
	> => ipcRenderer.invoke("brain:list-episodes", opts),
	/** The Brain's registry of real CLI tools / local models it has set up. */
	getBrainRegistry: (): Promise<
		Array<{
			id: string
			kind: "tool" | "model"
			name: string
			command: string
			description: string
			verified: boolean
			source?: string
			addedAt: number
		}>
	> => ipcRenderer.invoke("brain:registry"),
	/** Deterministic health check (no AI) for a set of Brain items — URL reachability, git ls-remote, or `which <exe>`. */
	scanBrain: (
		items: Array<{
			id: string
			kind: "skill" | "repo" | "software" | "docs" | "model" | "tool"
			source?: string
			command?: string
		}>,
	): Promise<Array<{ id: string; status: "ok" | "warn" | "dead"; detail: string }>> =>
		ipcRenderer.invoke("brain:scan", items),
	/** "Keep as reference" — copies a whole file into the Brain and registers it as a reference item (SKILL.md, type docs, reference: true) the agent can open in full later. */
	saveBrainReference: (
		filePath: string,
		opts?: { description?: string },
	): Promise<{ ok: boolean; slug?: string; storedPath?: string; error?: string }> =>
		ipcRenderer.invoke("brain:save-reference", filePath, opts),
	/** Removes one Brain item — deletes a skill folder ("skill") or drops a registry entry ("registry"). */
	removeBrainItem: (
		kind: "skill" | "registry",
		id: string,
	): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("brain:remove-item", { kind, id }),
	/** Reads one Brain item's full SKILL.md (raw text) + parsed fields, for the Vault viewer/editor. */
	readBrainItem: (
		id: string,
	): Promise<{
		ok: boolean
		content?: string
		name?: string
		description?: string
		type?: string
		source?: string
		reference?: boolean
		storedPath?: string
		error?: string
	}> => ipcRenderer.invoke("brain:read-item", { id }),
	/** Overwrites one existing Brain item's SKILL.md with edited raw text, then refreshes the Layer-1 catalog. */
	writeBrainItem: (id: string, content: string): Promise<{ ok: boolean; error?: string }> =>
		ipcRenderer.invoke("brain:write-item", { id, content }),
	/** Reveals a reference item's stored original file in the OS file manager (paths inside the Brain only). */
	revealBrainItem: (path: string): Promise<{ ok: boolean; error?: string }> =>
		ipcRenderer.invoke("brain:reveal-item", { path }),
	/** Publishes the selected Brain items to a private GitHub repo (skills + filtered registry + manifest + BRAIN.md, no secrets). */
	publishBrainToGit: (
		items: Array<{ kind: "skill" | "registry"; id: string; name: string; type?: string }>,
		report?: string,
	): Promise<{ ok: boolean; url?: string; error?: string }> =>
		ipcRenderer.invoke("brain:publish-git", { items, report }),
	/** Imports a Brain from a GitHub URL — merges its skills + registry, and returns its manifest + HEALTH.md for the Bring-it-Live setup screen. */
	importBrainFromGit: (
		url: string,
	): Promise<{
		ok: boolean
		imported?: number
		manifest?: {
			generatedAt?: string
			skills?: Array<{ name: string; description?: string; type?: string }>
			tools?: Array<{ name: string; command?: string; source?: string }>
			models?: Array<{ name: string; source?: string }>
			connectors?: Array<{ name?: string; source?: string }>
		} | null
		health?: string | null
		error?: string
	}> => ipcRenderer.invoke("brain:import-git", { url }),
	/** Runs ONE setup command from an imported Brain — only after the user has seen and approved it in the Bring-it-Live screen. */
	runBrainSetupCommand: (
		command: string,
	): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> =>
		ipcRenderer.invoke("brain:run-command", { command }),
	/** A fresh scratch directory for one Design Deck variant — created on demand, never reused across runs. */
	getDesignDeckVariantDir: (runId: string, index: number): Promise<string> =>
		ipcRenderer.invoke("design-deck:variant-dir", runId, index),

	// --- Window chrome / liquid glass ---

	/**
	 * Subscribes to the window chrome tier notification from the main process.
	 * Fired once after the window finishes loading.
	 * Tier values: "liquid-glass" | "vibrancy" | "opaque"
	 */
	onChromeTier: (callback: (tier: string) => void) => {
		const listener = (_event: unknown, tier: string) => callback(tier)
		ipcRenderer.on("chrome-tier", listener)
		return () => {
			ipcRenderer.removeListener("chrome-tier", listener)
		}
	},

	/** Get the current chrome tier (pull-based, avoids race with push event). */
	getChromeTier: () => ipcRenderer.invoke("chrome-tier:get"),

	/** Ensures the OpenCode server is running. Spawns it if not. */
	ensureOpenCode: () => ipcRenderer.invoke("opencode:ensure"),

	/** Gets the URL of the running server, or null. */
	getServerUrl: () => ipcRenderer.invoke("opencode:url"),

	/** Run a shell command in a directory and return its exit code + output.
	 *  Used by Step List verification gates for an objective pass/fail. */
	runShell: (cwd: string, command: string, timeoutMs?: number) =>
		ipcRenderer.invoke("shell:run", cwd, command, timeoutMs),

	// --- Agent-driven browser pane ---
	/** Subscribe to browser commands from the agent (via the main-process bridge). */
	onBrowserCommand: (
		callback: (cmd: { id: string; action: string; url?: string }) => void,
	) => {
		const listener = (_event: unknown, cmd: { id: string; action: string; url?: string }) =>
			callback(cmd)
		ipcRenderer.on("browser:command", listener)
		return () => {
			ipcRenderer.removeListener("browser:command", listener)
		}
	},
	/** Reply to a browser command with its result. */
	sendBrowserResult: (id: string, result: unknown) =>
		ipcRenderer.send("browser:result", { id, result }),

	/** Saves an "Inspect Design" snapshot into the project's design-reference/ folder. */
	saveDesignReference: (input: {
		directory: string
		name: string
		manifest: string
		tokensCss: string
		assets: Array<{ name: string; base64: string }>
	}): Promise<{ ok: boolean; savedPath?: string; error?: string }> =>
		ipcRenderer.invoke("browser:save-design-reference", input),

	/** Installs a skill shared on the Community page into the user's local skills folder. */
	installCommunitySkill: (input: {
		name: string
		description: string
		instructions: string
	}): Promise<{ ok: boolean; slug?: string; error?: string }> =>
		ipcRenderer.invoke("community:install-skill", input),

	/** Lists every skill currently installed (bundled + community-installed). */
	listInstalledSkills: (): Promise<Array<{ slug: string; name: string; description: string; instructions: string }>> =>
		ipcRenderer.invoke("community:list-skills"),

	/** Builds the interactive codebase graph's node/edge data for a project directory. */
	getRepoGraph: (
		directory: string,
	): Promise<{
		nodes: Array<{ id: string; name: string; kind: string; file: string; cluster: string; refCount: number }>
		edges: Array<{ source: string; target: string }>
		fileCount: number
		truncated: boolean
	}> => ipcRenderer.invoke("repo:graph", directory),

	/** Custom window controls for Windows (replaces titleBarOverlay). */
	minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
	maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
	closeWindow: () => ipcRenderer.invoke("window:close"),

	/** Stops the managed OpenCode server. */
	stopOpenCode: () => ipcRenderer.invoke("opencode:stop"),

	/** Restarts the managed OpenCode server (stops and re-starts with current settings). */
	restartOpenCode: () => ipcRenderer.invoke("opencode:restart"),

	// --- Credential storage (safeStorage-backed) ---

	credential: {
		store: (serverId: string, password: string) =>
			ipcRenderer.invoke("credential:store", serverId, password),
		get: (serverId: string) => ipcRenderer.invoke("credential:get", serverId),
		delete: (serverId: string) => ipcRenderer.invoke("credential:delete", serverId),
	},

	/** Test connectivity to a remote OpenCode server. Returns null on success or error message. */
	testServerConnection: (url: string, username?: string, password?: string) =>
		ipcRenderer.invoke("server:test-connection", url, username, password),

	// --- mDNS discovery ---

	mdns: {
		/** Get the current list of discovered servers. */
		getDiscovered: () => ipcRenderer.invoke("mdns:get-discovered"),
		/** Subscribe to discovered server list changes. */
		onChanged: (callback: (servers: unknown[]) => void) => {
			const listener = (_event: unknown, servers: unknown[]) => callback(servers)
			ipcRenderer.on("mdns:servers-changed", listener)
			return () => {
				ipcRenderer.removeListener("mdns:servers-changed", listener)
			}
		},
	},

	/** Reads model state (recent models, favorites, variants). */
	getModelState: () => ipcRenderer.invoke("model-state"),

	/** Updates the recent model list (adds model to front, deduplicates, caps at 10). */
	updateModelRecent: (model: { providerID: string; modelID: string }) =>
		ipcRenderer.invoke("model-state:update-recent", model),

	// --- Auto-updater ---

	/** Gets the current auto-updater state. */
	getUpdateState: () => ipcRenderer.invoke("updater:state"),

	/** Manually triggers an update check. */
	checkForUpdates: () => ipcRenderer.invoke("updater:check"),

	/** Starts downloading the available update. */
	downloadUpdate: () => ipcRenderer.invoke("updater:download"),

	/** Quits the app and installs the downloaded update. */
	installUpdate: () => ipcRenderer.invoke("updater:install"),

	/** Opens the GitHub release page for the current update version. */
	openReleasePage: () => ipcRenderer.invoke("updater:open-release-page"),

	/** Subscribes to update state changes pushed from the main process. */
	onUpdateStateChanged: (callback: (state: unknown) => void) => {
		const listener = (_event: unknown, state: unknown) => callback(state)
		ipcRenderer.on("updater:state-changed", listener)
		return () => {
			ipcRenderer.removeListener("updater:state-changed", listener)
		}
	},

	// --- Git operations ---

	git: {
		listBranches: (directory: string) => ipcRenderer.invoke("git:branches", directory),
		getStatus: (directory: string) => ipcRenderer.invoke("git:status", directory),
		checkout: (directory: string, branch: string) =>
			ipcRenderer.invoke("git:checkout", directory, branch),
		stashAndCheckout: (directory: string, branch: string) =>
			ipcRenderer.invoke("git:stash-and-checkout", directory, branch),
		stashPop: (directory: string) => ipcRenderer.invoke("git:stash-pop", directory),
		getRoot: (directory: string) => ipcRenderer.invoke("git:root", directory),
		diffStat: (directory: string) => ipcRenderer.invoke("git:diff-stat", directory),
		commitAll: (directory: string, message: string) =>
			ipcRenderer.invoke("git:commit-all", directory, message),
		push: (directory: string, remote?: string) => ipcRenderer.invoke("git:push", directory, remote),
		createBranch: (directory: string, branchName: string) =>
			ipcRenderer.invoke("git:create-branch", directory, branchName),
		applyToLocal: (worktreeDir: string, localDir: string) =>
			ipcRenderer.invoke("git:apply-to-local", worktreeDir, localDir),
		applyDiffText: (localDir: string, diffText: string) =>
			ipcRenderer.invoke("git:apply-diff-text", localDir, diffText),
		getRemoteUrl: (directory: string, remote?: string) =>
			ipcRenderer.invoke("git:remote-url", directory, remote),
		mergeBranch: (directory: string, branchName: string) =>
			ipcRenderer.invoke("git:merge-branch", directory, branchName),
	},

	// --- Work-graph store (.hramble/graph) ---

	graph: {
		record: (directory: string, sessionId: string, event: unknown) =>
			ipcRenderer.invoke("graph:record", directory, sessionId, event),
		session: (directory: string, sessionId: string) =>
			ipcRenderer.invoke("graph:session", directory, sessionId),
		sessions: (directory: string) => ipcRenderer.invoke("graph:sessions", directory),
	},

	// --- Window preferences (opaque windows / transparency) ---

	/** Get the persisted opaque windows preference from the main process. */
	getOpaqueWindows: () => ipcRenderer.invoke("prefs:get-opaque-windows"),

	/** Set the opaque windows preference and persist it in the main process. */
	setOpaqueWindows: (value: boolean) => ipcRenderer.invoke("prefs:set-opaque-windows", value),

	/** Relaunch the app (used after toggling transparency, which requires a restart). */
	relaunch: () => ipcRenderer.invoke("app:relaunch"),

	// --- CLI install ---

	cli: {
		/** Checks whether the `hramble` CLI command is installed. */
		isInstalled: () => ipcRenderer.invoke("cli:is-installed"),
		/** Installs the `hramble` CLI command (symlinks to /usr/local/bin). */
		install: () => ipcRenderer.invoke("cli:install"),
		/** Uninstalls the `hramble` CLI command. */
		uninstall: () => ipcRenderer.invoke("cli:uninstall"),
	},

	// --- Open in external app ---

	openIn: {
		getTargets: () => ipcRenderer.invoke("open-in:targets"),
		open: (directory: string, targetId: string, persistPreferred?: boolean) =>
			ipcRenderer.invoke("open-in:open", directory, targetId, persistPreferred),
		setPreferred: (targetId: string) => ipcRenderer.invoke("open-in:set-preferred", targetId),
	},

	// --- Native theme (syncs macOS glass tint to app color scheme) ---

	/** Set the native theme source to control macOS glass tint color. */
	setNativeTheme: (source: string) => ipcRenderer.invoke("theme:set-native", source),

	/** Get the system accent color as an 8-char hex RRGGBBAA string, or null if unavailable. */
	getAccentColor: () => ipcRenderer.invoke("theme:accent-color"),

	/** Subscribe to system accent color changes (fired when the user changes OS accent color). */
	onAccentColorChanged: (callback: (color: string) => void) => {
		const listener = (_event: unknown, color: string) => callback(color)
		ipcRenderer.on("theme:accent-color-changed", listener)
		return () => {
			ipcRenderer.removeListener("theme:accent-color-changed", listener)
		}
	},

	/** Opens a URL in the system's default browser (e.g. real Chrome), not Hramble's embedded browser pane. */
	openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),

	/** Reveals the bundled "Hramble Console Bridge" Chrome extension source in Finder/Explorer, for a manual "Load unpacked" install. */
	revealChromeExtension: (): Promise<void> => ipcRenderer.invoke("shell:reveal-chrome-extension"),

	/** Subscribe to the Mac going to sleep. */
	onPowerSuspend: (callback: () => void) => {
		const listener = () => callback()
		ipcRenderer.on("power:suspend", listener)
		return () => {
			ipcRenderer.removeListener("power:suspend", listener)
		}
	},

	/** Subscribe to the Mac waking up from sleep. */
	onPowerResume: (callback: () => void) => {
		const listener = () => callback()
		ipcRenderer.on("power:resume", listener)
		return () => {
			ipcRenderer.removeListener("power:resume", listener)
		}
	},

	// --- Directory picker ---

	/** Opens a native folder picker dialog. Returns the selected path, or null if cancelled. */
	pickDirectory: () => ipcRenderer.invoke("dialog:open-directory"),

	/** Opens a native file picker for an HTML/SVG page. Returns the selected path, or null if cancelled. */
	pickHtmlFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:open-html-file"),
	/** Opens a file picker for a local document (pdf/txt/md/docx) for the Brain's Docs arm. */
	pickDocFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:open-doc-file"),

	/** Serves a local file's directory over localhost and returns the resulting URL (not file://). */
	servePreviewFile: (filePath: string): Promise<string> => ipcRenderer.invoke("preview:serve-file", filePath),

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	/**
	 * Proxies an HTTP request through the main process using Electron's `net.fetch()`.
	 * This bypasses Chromium's 6-connections-per-origin limit for HTTP/1.1.
	 * The renderer serializes the Request, sends it over IPC, and gets back
	 * a serialized Response.
	 */
	fetch: (req: {
		url: string
		method: string
		headers: Record<string, string>
		body: string | null
	}) => ipcRenderer.invoke("fetch:request", req),

	// --- Notifications ---

	/**
	 * Subscribes to notification navigation events from the main process.
	 * Fired when the user clicks a native OS notification — the renderer
	 * should navigate to the specified session.
	 */
	onNotificationNavigate: (callback: (data: { sessionId: string }) => void) => {
		const listener = (_event: unknown, data: { sessionId: string }) => callback(data)
		ipcRenderer.on("notification:navigate", listener)
		return () => {
			ipcRenderer.removeListener("notification:navigate", listener)
		}
	},

	/** Dismiss any active notification for a session (e.g. when the user navigates to it). */
	dismissNotification: (sessionId: string) => ipcRenderer.invoke("notification:dismiss", sessionId),

	/** Update the dock badge / app badge count. */
	updateBadgeCount: (count: number) => ipcRenderer.invoke("notification:badge", count),

	// --- Settings ---

	/** Get the full app settings object. */
	getSettings: () => ipcRenderer.invoke("settings:get"),

	/** Update settings with a partial object (deep-merged). */
	updateSettings: (partial: Record<string, unknown>) =>
		ipcRenderer.invoke("settings:update", partial),

	/** Subscribe to settings changes pushed from the main process. */
	onSettingsChanged: (callback: (settings: unknown) => void) => {
		const listener = (_event: unknown, settings: unknown) => callback(settings)
		ipcRenderer.on("settings:changed", listener)
		return () => {
			ipcRenderer.removeListener("settings:changed", listener)
		}
	},

	// --- Automations ---

	automation: {
		list: () => ipcRenderer.invoke("automation:list"),
		get: (id: string) => ipcRenderer.invoke("automation:get", id),
		create: (input: unknown) => ipcRenderer.invoke("automation:create", input),
		update: (input: unknown) => ipcRenderer.invoke("automation:update", input),
		delete: (id: string) => ipcRenderer.invoke("automation:delete", id),
		runNow: (id: string) => ipcRenderer.invoke("automation:run-now", id),
		listRuns: (automationId?: string) => ipcRenderer.invoke("automation:list-runs", automationId),
		archiveRun: (runId: string) => ipcRenderer.invoke("automation:archive-run", runId),
		acceptRun: (runId: string) => ipcRenderer.invoke("automation:accept-run", runId),
		markRunRead: (runId: string) => ipcRenderer.invoke("automation:mark-run-read", runId),
		previewSchedule: (rrule: string, timezone: string) =>
			ipcRenderer.invoke("automation:preview-schedule", rrule, timezone),
	},

	onAutomationRunsUpdated: (callback: () => void) => {
		const listener = () => callback()
		ipcRenderer.on("automation:runs-updated", listener)
		return () => {
			ipcRenderer.removeListener("automation:runs-updated", listener)
		}
	},

	// --- Onboarding ---

	onboarding: {
		/** Check if OpenCode CLI is installed and compatible. */
		checkOpenCode: () => ipcRenderer.invoke("onboarding:check-opencode"),
		/** Install OpenCode CLI via the official install script. */
		installOpenCode: () => ipcRenderer.invoke("onboarding:install-opencode"),
		/** Subscribe to install output lines (streamed from the install script). */
		onInstallOutput: (callback: (text: string) => void) => {
			const listener = (_event: unknown, text: string) => callback(text)
			ipcRenderer.on("onboarding:install-output", listener)
			return () => {
				ipcRenderer.removeListener("onboarding:install-output", listener)
			}
		},
		/** Quick detect all supported providers (Claude Code, Cursor, OpenCode). */
		detectProviders: () => ipcRenderer.invoke("onboarding:detect-providers"),
		/** Full scan of a specific provider's configuration. */
		scanProvider: (provider: string) => ipcRenderer.invoke("onboarding:scan-provider", provider),
		/** Dry-run migration preview for a provider. */
		previewMigration: (provider: string, scanResult: unknown, categories: string[]) =>
			ipcRenderer.invoke("onboarding:preview-migration", provider, scanResult, categories),
		/** Execute migration (writes files with backup). */
		executeMigration: (provider: string, scanResult: unknown, categories: string[]) =>
			ipcRenderer.invoke("onboarding:execute-migration", provider, scanResult, categories),
		/** Subscribe to migration progress updates (history writing). */
		onMigrationProgress: (callback: (progress: unknown) => void) => {
			const listener = (_event: unknown, progress: unknown) => callback(progress)
			ipcRenderer.on("onboarding:migration-progress", listener)
			return () => {
				ipcRenderer.removeListener("onboarding:migration-progress", listener)
			}
		},
		/** Restore the most recent migration backup. */
		restoreBackup: () => ipcRenderer.invoke("onboarding:restore-backup"),
	},

	// Perch mode — avatar sits on the edge of the frontmost window.
	perchCheck: () => ipcRenderer.invoke("perch:check"),
	perchStart: (avatar: string, interactive: boolean) =>
		ipcRenderer.invoke("perch:start", avatar, interactive),
	perchStop: () => ipcRenderer.invoke("perch:stop"),
	perchHitRects: (rects: unknown) => ipcRenderer.send("perch:hitrects", rects),
	perchDrag: (action: string, dx: number, dy: number) =>
		ipcRenderer.send("perch:drag", action, dx, dy),
	onPerchZone: (callback: (zone: string) => void) => {
		const listener = (_e: unknown, zone: string) => callback(zone)
		ipcRenderer.on("perch:zone", listener)
		return () => ipcRenderer.removeListener("perch:zone", listener)
	},
	onPerchActive: (callback: (active: boolean) => void) => {
		const listener = (_e: unknown, active: boolean) => callback(active)
		ipcRenderer.on("perch:active", listener)
		return () => ipcRenderer.removeListener("perch:active", listener)
	},

	// --- Connectors (MCP servers) ---
	connectors: {
		list: () => ipcRenderer.invoke("connectors:list"),
		add: (entry: {
			name: string
			command?: string[]
			url?: string
			enabled?: boolean
			environment?: Record<string, string>
		}) => ipcRenderer.invoke("connectors:add", entry),
		remove: (name: string) => ipcRenderer.invoke("connectors:remove", name),
		toggle: (name: string, enabled: boolean) => ipcRenderer.invoke("connectors:toggle", name, enabled),
	},

	// --- Ollama / local models (the free tier) ---
	ollama: {
		/** Is Ollama installed + running, and which models are pulled? */
		status: () => ipcRenderer.invoke("ollama:status"),
		/** Pull a model (defaults to the recommended coder model). */
		pull: (model?: string) => ipcRenderer.invoke("ollama:pull", model),
		/** Subscribe to download progress during a pull. */
		onPullProgress: (
			callback: (p: { status?: string; percent?: number; done?: boolean; error?: string }) => void,
		) => {
			const listener = (_e: unknown, p: never) => callback(p)
			ipcRenderer.on("ollama:pull-progress", listener)
			return () => ipcRenderer.removeListener("ollama:pull-progress", listener)
		},
		/** Open ollama.com/download in the browser. */
		openDownload: () => ipcRenderer.invoke("ollama:openDownload"),
	},

	// --- Avatar store (proxies to the shared Worker; bootstrap token stays in main) ---
	store: {
		/** Public config for the renderer: supabaseUrl, supabaseAnonKey, razorpayKeyId. */
		config: () => ipcRenderer.invoke("store:config"),
		/** Gem balance for an email. */
		credits: (email: string) => ipcRenderer.invoke("store:credits", email),
		/** Owned + paid avatar id sets for an email (userToken = Supabase JWT). */
		owned: (email: string, userToken?: string) => ipcRenderer.invoke("store:owned", email, userToken),
		/** Create a Razorpay order (amount in paise). */
		createOrder: (opts: { amount: number; currency?: string; receipt?: string }) =>
			ipcRenderer.invoke("store:createOrder", opts),
		/** Verify a completed Razorpay payment → credits gems. */
		verifyPayment: (p: {
			razorpay_order_id: string
			razorpay_payment_id: string
			razorpay_signature: string
			email: string
			credits_to_add: number
		}) => ipcRenderer.invoke("store:verifyPayment", p),
		/** Spend gems to buy an avatar (records ownership when avatarId is set). */
		deduct: (p: { email: string; amount: number; avatarId: string; userToken?: string }) =>
			ipcRenderer.invoke("store:deduct", p),
	},

	// --- Community feed (separate Supabase project from the avatar store) ---
	community: {
		/** Public config for the renderer: enabled, supabaseUrl, supabaseAnonKey, apiBase. */
		config: () => ipcRenderer.invoke("community:config"),
		/** Opens the Google sign-in window. Result arrives via onSession, not the return value. */
		login: () => ipcRenderer.invoke("community:login"),
		logout: () => ipcRenderer.invoke("community:logout"),
		/** The persisted session from a previous launch, if any. */
		getSession: () => ipcRenderer.invoke("community:get-session"),
		/** Fires whenever sign-in completes, fails, or sign-out happens (payload is null on sign-out/failure). */
		onSession: (callback: (session: unknown) => void) => {
			const listener = (_event: unknown, session: unknown) => callback(session)
			ipcRenderer.on("community:session", listener)
			return () => ipcRenderer.removeListener("community:session", listener)
		},
	},
})
