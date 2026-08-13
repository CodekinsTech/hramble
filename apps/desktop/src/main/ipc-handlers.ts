import { execFile } from "node:child_process"
import fs from "node:fs"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, shell, systemPreferences } from "electron"
import {
	acceptRun,
	archiveRun,
	createAutomation,
	deleteAutomation,
	getAutomation,
	listAutomations,
	listRuns,
	markRunRead,
	previewSchedule,
	runNow,
	updateAutomation,
} from "./automation"
import type { CreateAutomationInput, UpdateAutomationInput } from "./automation/types"
import { installCli, isCliInstalled, uninstallCli } from "./cli-install"
import { installCommunitySkill, type InstallCommunitySkillInput, listInstalledSkills } from "./community-skills"
import { buildRepoGraph } from "./repo-graph"
import { servePreviewFile } from "./static-preview-server"
import { deleteCredential, getCredential, storeCredential } from "./credential-store"
import { saveDesignReference, type SaveDesignReferenceInput } from "./design-reference"
import {
	applyChangesToLocal,
	applyDiffTextToLocal,
	checkout,
	commitAll,
	createBranch,
	getDiffStat,
	getGitRoot,
	getRemoteUrl,
	getStatus,
	listBranches,
	mergeBranch,
	push,
	stashAndCheckout,
	stashPop,
} from "./git-service"
import { getResolvedChromeTier } from "./liquid-glass"
import { createLogger } from "./logger"
import { getDiscoveredServers } from "./mdns-scanner"

import { readModelState, updateModelRecent } from "./model-state"
import { dismissNotification, updateBadgeCount } from "./notifications"
import type { MigrationProvider } from "./onboarding"
import {
	checkOpenCodeInstallation,
	detectProviders,
	executeMigration,
	installOpenCode,
	previewMigration,
	restoreMigrationBackup,
	scanProvider,
} from "./onboarding"
import { getOpenInTargets, openInTarget, setPreferredTarget } from "./open-in-targets"
import { ensureServer, getServerUrl, restartServer, stopServer } from "./opencode-manager"
import { getOpaqueWindows, getSettings, onSettingsChanged, updateSettings } from "./settings-store"
import {
	checkForUpdates,
	downloadUpdate,
	getUpdateState,
	installUpdate,
	openReleasePage,
} from "./updater"

const log = createLogger("ipc")

// ESM equivalent for __dirname (this file has no __dirname/__filename globals).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Read the opaque windows preference for use at window creation time. */
export { getOpaqueWindows as getOpaqueWindowsPref } from "./settings-store"

// ============================================================
// Serialized fetch types — used to pass Request/Response over IPC
// ============================================================

interface SerializedRequest {
	url: string
	method: string
	headers: Record<string, string>
	body: string | null
}

interface SerializedResponse {
	status: number
	statusText: string
	headers: Record<string, string>
	body: string | null
}

/**
 * Generic fetch proxy handler for the renderer process.
 *
 * The renderer serializes a Request into a plain object, sends it over IPC,
 * and the main process performs the actual HTTP request using `net.fetch()`
 * (Electron's network stack, which has no connection-per-origin limits).
 * The response is serialized back to the renderer.
 *
 * This bypasses Chromium's 6-connections-per-origin HTTP/1.1 limit, which
 * causes severe queueing when many parallel requests hit the OpenCode server.
 */
async function handleFetchProxy(
	_event: Electron.IpcMainInvokeEvent,
	req: SerializedRequest,
): Promise<SerializedResponse> {
	log.info("IPC fetch proxy →", { method: req.method, url: req.url })
	const start = Date.now()
	const response = await net.fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body ?? undefined,
	})

	const body = await response.text()
	const headers: Record<string, string> = {}
	response.headers.forEach((value, key) => {
		headers[key] = value
	})
	const durationMs = Date.now() - start

	log.info("IPC fetch proxy ←", {
		method: req.method,
		url: req.url,
		status: response.status,
		bodyLength: body.length,
		durationMs,
	})

	return {
		status: response.status,
		statusText: response.statusText,
		headers,
		body,
	}
}

/**
 * Wraps an IPC handler to log errors before they propagate to the renderer.
 * Without this, errors thrown in handlers are silently serialized across IPC
 * and the main process log shows nothing.
 */
function withLogging<TArgs extends unknown[], TResult>(
	channel: string,
	handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
	return async (...args: TArgs) => {
		const start = Date.now()
		try {
			const result = await handler(...args)
			const durationMs = Date.now() - start
			if (durationMs > 500) {
				log.warn(`Handler "${channel}" slow`, { durationMs })
			}
			return result
		} catch (err) {
			log.error(`Handler "${channel}" failed`, { durationMs: Date.now() - start }, err)
			throw err
		}
	}
}

/**
 * Registers all IPC handlers that the renderer can invoke via contextBridge.
 *
 * Each handler corresponds to an endpoint that was previously served by
 * the Bun + Hono server on port 3100. Now they run in-process in Electron's
 * main process, communicating via IPC instead of HTTP.
 */
export function registerIpcHandlers(): void {
	// --- App info ---

	ipcMain.handle("app:info", () => ({
		version: app.getVersion(),
		isDev: !app.isPackaged,
	}))

	// Working directory for the Home chat (general assistant, no repo). A stable
	// folder under userData so the OpenCode session has a real cwd but isn't tied
	// to any of the user's code projects.
	ipcMain.handle("home:dir", async () => {
		const dir = path.join(app.getPath("userData"), "home-chat")
		await mkdir(dir, { recursive: true })
		return dir
	})

	// Working directory for the Brain page — same idea as home:dir (a stable
	// folder under userData, not tied to any project), but this is where taught
	// skills/context live going forward, kept separate from Home chat.
	ipcMain.handle("brain:dir", async () => {
		const dir = path.join(app.getPath("userData"), "brain-chat")
		await mkdir(dir, { recursive: true })
		return dir
	})

	// Everything that's been added to the Brain — one entry per skill folder
	// under ~/.config/opencode/skills (same place create_skill writes). Reads
	// the SKILL.md frontmatter, including the newer verify-before-trust fields
	// (type / verified / source), so the Brain Vault can show what's been
	// taught and whether it was actually tested.
	ipcMain.handle("brain:vault", () => {
		const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills")
		let entries: fs.Dirent[]
		try {
			entries = fs.readdirSync(skillsDir, { withFileTypes: true })
		} catch {
			return []
		}
		const field = (content: string, key: string) => {
			const raw = (content.match(new RegExp(`^${key}:\\s*(.*)$`, "m")) || [])[1]?.trim()
			if (!raw) return undefined
			if (
				raw.length >= 2 &&
				((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"))
			) {
				return raw.slice(1, -1)
			}
			return raw
		}
		const vault: {
			name: string
			description: string
			type: string
			verified: boolean
			source?: string
			addedAt: number
			instructions: string
		}[] = []
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			try {
				const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md")
				const content = fs.readFileSync(skillMdPath, "utf8")
				const type = field(content, "type") || "skill"
				// Body = everything after the closing frontmatter "---" line, same
				// extraction as community-skills.ts — the skill's actual content, so
				// the Vault can share a whole skill to the Community feed.
				const frontmatterEnd = content.indexOf("\n---", content.indexOf("---") + 3)
				const instructions =
					frontmatterEnd >= 0 ? content.slice(frontmatterEnd + 4).trim() : content.trim()
				vault.push({
					name: field(content, "name") || entry.name,
					description: field(content, "description") || "",
					type: ["skill", "repo", "software", "model"].includes(type) ? type : "skill",
					verified: field(content, "verified") === "true",
					source: field(content, "source"),
					addedAt: fs.statSync(skillMdPath).mtimeMs,
					instructions,
				})
			} catch {
				// No SKILL.md / malformed frontmatter — skip, never crash the list.
			}
		}
		return vault
	})

	// Clones a git repo for the Brain's "Git Repo" arm, so the agent reads a
	// real local checkout instead of hoping it clones the URL itself. Shallow
	// clone into userData; if the destination already exists, treat it as done.
	ipcMain.handle("brain:clone-repo", async (_e, url: string) => {
		try {
			const trimmed = (url || "").trim()
			if (!trimmed) return { ok: false, error: "No repo URL provided." }
			const last = trimmed.replace(/\/+$/, "").split("/").pop() || "repo"
			const name = last.replace(/\.git$/i, "").toLowerCase().replace(/[^a-z0-9-_]/g, "-") || "repo"
			const dest = path.join(app.getPath("userData"), "brain-chat", "repos", name)
			if (fs.existsSync(dest)) return { ok: true, path: dest }
			await mkdir(path.dirname(dest), { recursive: true })
			await new Promise<void>((resolve, reject) => {
				execFile(
					"git",
					["clone", "--depth", "1", trimmed, dest],
					{ timeout: 120000 },
					(err) => (err ? reject(err) : resolve()),
				)
			})
			return { ok: true, path: dest }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

	// The Brain's tool/model registry — real CLI tools and local models the
	// agent has set up (written by the register_brain_tool plugin tool). Reads
	// the same brain-registry.json both sides compute from os.homedir().
	ipcMain.handle("brain:registry", () => {
		try {
			const registryPath = path.join(os.homedir(), ".config", "opencode", "brain-registry.json")
			const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"))
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	})

	// Export the whole Brain — the skills dir + the registry json — as one .zip
	// the user picks a location for. Lets a Brain be backed up or moved to
	// another machine, restored via brain:import below.
	// NOTE: uses the system `zip` (present on the Mac we target); a Windows
	// build would need a JS zip lib (e.g. jszip/archiver) as a follow-up.
	ipcMain.handle("brain:export", async () => {
		try {
			const configDir = path.join(os.homedir(), ".config", "opencode")
			const skillsDir = path.join(configDir, "skills")
			const registryPath = path.join(configDir, "brain-registry.json")
			const hasSkills = fs.existsSync(skillsDir)
			const hasRegistry = fs.existsSync(registryPath)
			if (!hasSkills && !hasRegistry) {
				return { ok: false, error: "Nothing in the Brain to export yet." }
			}
			const result = await dialog.showSaveDialog({
				title: "Export Brain",
				defaultPath: "brain-export.zip",
				filters: [{ name: "Zip archive", extensions: ["zip"] }],
			})
			if (result.canceled || !result.filePath) return { ok: false }
			const dest = result.filePath
			// Remove any stale file at dest so `zip` writes a fresh archive instead
			// of appending into an existing one.
			try {
				fs.rmSync(dest)
			} catch {
				// Nothing there yet — fine.
			}
			// Paths are relative to the opencode config dir so they restore to the
			// same place on import.
			const args = ["-r", dest]
			if (hasSkills) args.push("skills")
			if (hasRegistry) args.push("brain-registry.json")
			await new Promise<void>((resolve, reject) => {
				execFile("zip", args, { cwd: configDir }, (err) => (err ? reject(err) : resolve()))
			})
			return { ok: true, path: dest }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

	// Import a Brain export .zip — unpacks it back into ~/.config/opencode,
	// MERGING into whatever skills already exist (colliding files overwrite, the
	// rest are left alone) and restoring brain-registry.json if the archive has
	// one. Returns how many skills exist afterwards.
	// NOTE: uses the system `unzip`; a Windows build would need a JS zip lib.
	ipcMain.handle("brain:import", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Import Brain",
				properties: ["openFile"],
				filters: [{ name: "Zip archive", extensions: ["zip"] }],
			})
			if (result.canceled || result.filePaths.length === 0) return { ok: false }
			const src = result.filePaths[0]
			const configDir = path.join(os.homedir(), ".config", "opencode")
			await mkdir(path.join(configDir, "skills"), { recursive: true })
			await new Promise<void>((resolve, reject) => {
				execFile("unzip", ["-o", src, "-d", configDir], (err) => (err ? reject(err) : resolve()))
			})
			let imported = 0
			try {
				imported = fs
					.readdirSync(path.join(configDir, "skills"), { withFileTypes: true })
					.filter((e) => e.isDirectory()).length
			} catch {
				// Skills dir unreadable after import — leave the count at 0.
			}
			return { ok: true, imported }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

	// A fresh, isolated scratch directory for one Design Deck variant. Each
	// (runId, index) pair gets its own folder under userData so parallel
	// variant sessions never write over each other or the user's real projects.
	ipcMain.handle("design-deck:variant-dir", async (_e, runId: string, index: number) => {
		const dir = path.join(app.getPath("userData"), "design-deck", runId, `variant-${index}`)
		await mkdir(dir, { recursive: true })
		return dir
	})

	// --- Objective shell run (for Step List verification gates) ---
	// Runs a command in a project directory and returns its real exit code +
	// output. Unlike agent tool calls, this is a plain process, so a step's
	// "done when" check is objective (exit 0 = pass), not the model's opinion.
	ipcMain.handle(
		"shell:run",
		async (_e, cwd: string, command: string, timeoutMs?: number) => {
			const { execFile } = await import("node:child_process")
			return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
				execFile(
					"/bin/sh",
					["-c", command],
					{
						cwd,
						timeout: timeoutMs && timeoutMs > 0 ? timeoutMs : 120_000,
						maxBuffer: 8 * 1024 * 1024,
						env: process.env,
					},
					(err, stdout, stderr) => {
						const e = err as (Error & { code?: number | string; killed?: boolean }) | null
						const code =
							e && typeof e.code === "number" ? e.code : e?.killed ? 124 : e ? 1 : 0
						resolve({
							code,
							stdout: String(stdout).slice(-8000),
							stderr: String(stderr).slice(-8000),
						})
					},
				)
			})
		},
	)

	// --- OpenCode server lifecycle ---

	ipcMain.handle(
		"opencode:ensure",
		withLogging("opencode:ensure", async () => await ensureServer()),
	)

	ipcMain.handle("opencode:url", () => getServerUrl())

	ipcMain.handle(
		"opencode:stop",
		withLogging("opencode:stop", () => stopServer()),
	)

	ipcMain.handle(
		"opencode:restart",
		withLogging("opencode:restart", async () => await restartServer()),
	)

	// --- Model state ---

	ipcMain.handle(
		"model-state",
		withLogging("model-state", async () => await readModelState()),
	)

	ipcMain.handle(
		"model-state:update-recent",
		withLogging(
			"model-state:update-recent",
			async (_, model: { providerID: string; modelID: string }) => await updateModelRecent(model),
		),
	)

	// --- Auto-updater ---

	ipcMain.handle("updater:state", () => getUpdateState())

	ipcMain.handle("updater:check", async () => await checkForUpdates())

	ipcMain.handle("updater:download", async () => await downloadUpdate())

	ipcMain.handle("updater:install", async () => await installUpdate())

	ipcMain.handle("updater:open-release-page", async () => await openReleasePage())

	// --- Git operations ---

	ipcMain.handle(
		"git:branches",
		withLogging("git:branches", async (_, directory: string) => await listBranches(directory)),
	)

	ipcMain.handle(
		"git:status",
		withLogging("git:status", async (_, directory: string) => await getStatus(directory)),
	)

	ipcMain.handle(
		"git:checkout",
		withLogging(
			"git:checkout",
			async (_, directory: string, branch: string) => await checkout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-and-checkout",
		withLogging(
			"git:stash-and-checkout",
			async (_, directory: string, branch: string) => await stashAndCheckout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-pop",
		withLogging("git:stash-pop", async (_, directory: string) => await stashPop(directory)),
	)

	ipcMain.handle(
		"git:diff-stat",
		withLogging("git:diff-stat", async (_, directory: string) => await getDiffStat(directory)),
	)

	ipcMain.handle(
		"git:commit-all",
		withLogging(
			"git:commit-all",
			async (_, directory: string, message: string) => await commitAll(directory, message),
		),
	)

	ipcMain.handle(
		"git:push",
		withLogging(
			"git:push",
			async (_, directory: string, remote?: string) => await push(directory, remote),
		),
	)

	ipcMain.handle(
		"git:create-branch",
		withLogging(
			"git:create-branch",
			async (_, directory: string, branchName: string) => await createBranch(directory, branchName),
		),
	)

	ipcMain.handle(
		"git:apply-to-local",
		withLogging(
			"git:apply-to-local",
			async (_, worktreeDir: string, localDir: string) =>
				await applyChangesToLocal(worktreeDir, localDir),
		),
	)

	ipcMain.handle(
		"git:apply-diff-text",
		withLogging(
			"git:apply-diff-text",
			async (_, localDir: string, diffText: string) =>
				await applyDiffTextToLocal(localDir, diffText),
		),
	)

	ipcMain.handle(
		"git:merge-branch",
		withLogging(
			"git:merge-branch",
			async (_, directory: string, branchName: string) => await mergeBranch(directory, branchName),
		),
	)

	ipcMain.handle(
		"git:root",
		withLogging("git:root", async (_, directory: string) => await getGitRoot(directory)),
	)

	ipcMain.handle(
		"git:remote-url",
		withLogging(
			"git:remote-url",
			async (_, directory: string, remote?: string) => await getRemoteUrl(directory, remote),
		),
	)

	// --- Open a URL in the system's default browser (not Hramble's embedded pane) ---

	ipcMain.handle(
		"shell:open-external",
		withLogging("shell:open-external", async (_, url: string) => {
			if (!/^https?:\/\//i.test(url)) return
			await shell.openExternal(url)
		}),
	)

	// --- Pick + serve a local HTML file (so "Open in your browser" works even
	// when nothing's being previewed yet — see static-preview-server.ts) ---

	ipcMain.handle(
		"dialog:open-html-file",
		withLogging("dialog:open-html-file", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openFile"],
				title: "Choose a page to preview",
				filters: [{ name: "Web pages", extensions: ["html", "htm", "svg"] }],
			})
			if (result.canceled || result.filePaths.length === 0) return null
			return result.filePaths[0]
		}),
	)

	ipcMain.handle(
		"preview:serve-file",
		withLogging("preview:serve-file", async (_, filePath: string) => await servePreviewFile(filePath)),
	)

	// --- Reveal the bundled "Hramble Console Bridge" Chrome extension source,
	// so the user can load it unpacked (Settings → Chrome Console Access) ---

	ipcMain.handle(
		"shell:reveal-chrome-extension",
		withLogging("shell:reveal-chrome-extension", async () => {
			const resourcesPath = app.isPackaged
				? process.resourcesPath
				: path.join(__dirname, "../../resources")
			shell.showItemInFolder(path.join(resourcesPath, "chrome-extension", "manifest.json"))
		}),
	)

	// --- Directory picker ---

	ipcMain.handle(
		"dialog:open-directory",
		withLogging("dialog:open-directory", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select a project folder",
			})
			if (result.canceled || result.filePaths.length === 0) return null
			return result.filePaths[0]
		}),
	)

	// --- Design reference save (from the browser pane's Inspect Design tool) ---

	ipcMain.handle(
		"browser:save-design-reference",
		withLogging(
			"browser:save-design-reference",
			async (_, input: SaveDesignReferenceInput) => await saveDesignReference(input),
		),
	)

	// --- Community skill install (writes to the same place create_skill does) ---

	ipcMain.handle(
		"community:install-skill",
		withLogging(
			"community:install-skill",
			async (_, input: InstallCommunitySkillInput) => await installCommunitySkill(input),
		),
	)

	ipcMain.handle("community:list-skills", withLogging("community:list-skills", async () => await listInstalledSkills()))

	// --- Codebase graph (interactive view, separate from the agent's repo_map tool) ---

	ipcMain.handle(
		"repo:graph",
		withLogging("repo:graph", async (_, directory: string) => await buildRepoGraph(directory)),
	)

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	ipcMain.handle("fetch:request", withLogging("fetch:request", handleFetchProxy))

	// --- CLI install ---

	ipcMain.handle("cli:is-installed", () => isCliInstalled())

	ipcMain.handle("cli:install", () => installCli())

	ipcMain.handle("cli:uninstall", () => uninstallCli())

	// --- Open in external app ---

	ipcMain.handle("open-in:targets", () => getOpenInTargets())

	ipcMain.handle(
		"open-in:open",
		withLogging(
			"open-in:open",
			async (_, directory: string, targetId: string, persistPreferred?: boolean) =>
				await openInTarget(directory, targetId, { persistPreferred }),
		),
	)

	ipcMain.handle("open-in:set-preferred", (_, targetId: string) => {
		setPreferredTarget(targetId)
		return { success: true }
	})

	// --- Chrome tier (pull-based, avoids race with push-based "chrome-tier" event) ---

	ipcMain.handle("chrome-tier:get", () => getResolvedChromeTier())

	// --- Window preferences (opaque windows) ---

	ipcMain.handle("prefs:get-opaque-windows", () => {
		return getOpaqueWindows()
	})

	ipcMain.handle("prefs:set-opaque-windows", (_, value: boolean) => {
		updateSettings({ opaqueWindows: value })
		return { success: true }
	})

	ipcMain.handle("app:relaunch", () => {
		app.relaunch()
		app.exit(0)
	})

	// --- Notifications ---

	ipcMain.handle("notification:dismiss", (_, sessionId: string) => {
		dismissNotification(sessionId)
	})

	ipcMain.handle("notification:badge", (_, count: number) => {
		updateBadgeCount(count)
	})

	// --- Settings ---

	ipcMain.handle("settings:get", () => getSettings())

	ipcMain.handle("settings:update", (_, partial) => updateSettings(partial))

	// --- Credential storage (safeStorage-backed) ---

	ipcMain.handle(
		"credential:store",
		withLogging("credential:store", (_, serverId: string, password: string) => {
			storeCredential(serverId, password)
		}),
	)

	ipcMain.handle("credential:get", (_, serverId: string) => getCredential(serverId))

	ipcMain.handle(
		"credential:delete",
		withLogging("credential:delete", (_, serverId: string) => {
			deleteCredential(serverId)
		}),
	)

	// --- mDNS discovery ---

	ipcMain.handle("mdns:get-discovered", () => getDiscoveredServers())

	// --- Remote server connectivity test ---

	ipcMain.handle(
		"server:test-connection",
		withLogging(
			"server:test-connection",
			async (_, url: string, username?: string, password?: string) => {
				try {
					const headers: Record<string, string> = {}
					if (password) {
						const user = username || "opencode"
						headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
					}
					const res = await net.fetch(`${url}/session`, {
						method: "GET",
						headers,
						signal: AbortSignal.timeout(5000),
					})
					if (res.ok) return null
					if (res.status === 401) return "Authentication failed. Check username and password."
					return `Server responded with HTTP ${res.status} ${res.statusText}`
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					if (msg.includes("ECONNREFUSED")) return "Connection refused. Is the server running?"
					if (msg.includes("ENOTFOUND")) return "Host not found. Check the URL."
					if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) return "Connection timed out."
					if (msg.includes("CERT")) return `TLS/certificate error: ${msg}`
					return `Connection failed: ${msg}`
				}
			},
		),
	)

	// --- Native theme (controls macOS glass tint color) ---

	ipcMain.handle("theme:set-native", (_, source: string) => {
		if (source === "light" || source === "dark") {
			nativeTheme.themeSource = source
		} else {
			nativeTheme.themeSource = "system"
		}
	})

	// --- System accent color (macOS / Windows) ---

	ipcMain.handle("theme:accent-color", () => {
		try {
			return systemPreferences.getAccentColor()
		} catch {
			return null
		}
	})

	// Broadcast accent color changes to all renderer windows
	systemPreferences.on("accent-color-changed", (_event, newColor) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("theme:accent-color-changed", newColor)
		}
	})

	// --- Onboarding ---

	ipcMain.handle(
		"onboarding:check-opencode",
		withLogging("onboarding:check-opencode", async () => await checkOpenCodeInstallation()),
	)

	ipcMain.handle(
		"onboarding:install-opencode",
		withLogging("onboarding:install-opencode", async () => await installOpenCode()),
	)

	ipcMain.handle(
		"onboarding:detect-providers",
		withLogging("onboarding:detect-providers", async () => await detectProviders()),
	)

	ipcMain.handle(
		"onboarding:scan-provider",
		withLogging(
			"onboarding:scan-provider",
			async (_, provider: MigrationProvider) => await scanProvider(provider),
		),
	)

	ipcMain.handle(
		"onboarding:preview-migration",
		withLogging(
			"onboarding:preview-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await previewMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:execute-migration",
		withLogging(
			"onboarding:execute-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await executeMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:restore-backup",
		withLogging("onboarding:restore-backup", async () => await restoreMigrationBackup()),
	)

	// --- Automations ---

	ipcMain.handle(
		"automation:list",
		withLogging("automation:list", () => listAutomations()),
	)

	ipcMain.handle(
		"automation:get",
		withLogging("automation:get", (_, id: string) => getAutomation(id)),
	)

	ipcMain.handle(
		"automation:create",
		withLogging("automation:create", async (_, input: CreateAutomationInput) => {
			const result = await createAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:update",
		withLogging("automation:update", async (_, input: UpdateAutomationInput) => {
			const result = await updateAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:delete",
		withLogging("automation:delete", async (_, id: string) => {
			const result = await deleteAutomation(id)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:run-now",
		withLogging("automation:run-now", async (_, id: string) => {
			// runNow is fire-and-forget: it returns immediately after validating
			// the automation exists. Execution happens in the background, and
			// broadcastRunsUpdated() is called from within executeAutomation.
			return runNow(id)
		}),
	)

	ipcMain.handle(
		"automation:list-runs",
		withLogging("automation:list-runs", (_, automationId?: string) => listRuns(automationId)),
	)

	ipcMain.handle(
		"automation:archive-run",
		withLogging("automation:archive-run", async (_, runId: string) => {
			const result = await archiveRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:accept-run",
		withLogging("automation:accept-run", async (_, runId: string) => {
			const result = await acceptRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:mark-run-read",
		withLogging("automation:mark-run-read", async (_, runId: string) => {
			const result = await markRunRead(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:preview-schedule",
		withLogging("automation:preview-schedule", (_, rrule: string, timezone: string) =>
			previewSchedule(rrule, timezone),
		),
	)

	// --- Settings push channel (main -> renderer) ---
	// Notify all renderer windows when settings change so they can update reactively.

	onSettingsChanged((settings) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("settings:changed", settings)
		}
	})

	// --- Custom window controls (Windows — replaces titleBarOverlay) ---

	ipcMain.handle("window:minimize", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.minimize()
	})

	ipcMain.handle("window:maximize", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender)
		if (!win) return
		if (win.isMaximized()) win.unmaximize()
		else win.maximize()
	})

	ipcMain.handle("window:close", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.close()
	})
}
