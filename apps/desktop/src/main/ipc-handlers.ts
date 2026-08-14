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
import { writeBrainCatalog } from "./brain-catalog"
import { listRecentEpisodes, recallEpisodes, recordEpisode } from "./brain-episodes"
import { recallRelevant } from "./brain-recall"
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

	// Layer 1 — Always-Aware Brain: regenerate the compact BRAIN.md catalog from
	// the current on-disk Brain, honoring the user's toggle. Called after any
	// Brain-mutating action so the next session's injected inventory is current.
	const refreshBrainCatalog = () => writeBrainCatalog(getSettings().brainCatalogInSessions)

	// Explicit refresh the renderer can call after it changes the Brain (e.g. a
	// vault edit) so the catalog is up to date before the next session starts.
	ipcMain.handle("brain:refresh-catalog", () => {
		refreshBrainCatalog()
		return { ok: true }
	})

	// Layer 2 — Auto-Recall: for the task the user just typed, return the few
	// Brain items most relevant to it (local keyword+entity score, no network).
	// Honors the toggle — returns [] when off — and never throws to the caller.
	ipcMain.handle("brain:recall", (_e, taskText: string, opts?: { limit?: number }) => {
		try {
			if (!getSettings().brainAutoRecall) return []
			return recallRelevant(String(taskText ?? ""), opts)
		} catch {
			return []
		}
	})

	// Layer 3 — Episodic Memory recall: for the task the user just typed, return
	// the most similar PAST episode(s) so the agent can reuse what worked. Honors
	// the independent `brainEpisodicMemory` toggle; never throws to the caller.
	ipcMain.handle("brain:recall-episodes", (_e, taskText: string, opts?: { limit?: number }) => {
		try {
			if (!getSettings().brainEpisodicMemory) return []
			return recallEpisodes(String(taskText ?? ""), opts)
		} catch {
			return []
		}
	})

	// Layer 3 — Episode capture: record (or refine) a finished task's episode.
	// itemsUsed is derived here (best-effort) by re-running the Layer 2 matcher on
	// the task text — i.e. the Brain items that were relevant to this task — so the
	// renderer only needs to pass the raw task + a rough outcome. No-ops when the
	// toggle is off; never throws.
	ipcMain.handle(
		"brain:record-episode",
		(
			_e,
			input: { id: string; task: string; outcome?: "success" | "failed" | "unknown"; lesson?: string },
		) => {
			try {
				if (!getSettings().brainEpisodicMemory) return { ok: false }
				const task = String(input?.task ?? "")
				const itemsUsed = recallRelevant(task, { limit: 6 }).map((m) => m.name)
				recordEpisode({
					id: String(input?.id ?? ""),
					task,
					outcome: input?.outcome,
					itemsUsed,
					lesson: input?.lesson,
				})
				return { ok: true }
			} catch {
				return { ok: false }
			}
		},
	)

	// Layer 3 — read-only list of recorded episodes, most recent first, for the
	// Brain Vault history view. Local read; never throws.
	ipcMain.handle("brain:list-episodes", (_e, opts?: { limit?: number }) => {
		try {
			const limit = Math.max(1, Math.min(200, opts?.limit ?? 50))
			return listRecentEpisodes(limit)
		} catch {
			return []
		}
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
			refreshBrainCatalog()
			return { ok: true, imported }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

	// Import a Brain straight from a GitHub URL — the recipient side of "Share
	// Brain". Shallow-clones the repo into a temp dir under userData, MERGES its
	// skills/ folders into the local skills dir (overwrite same-name, keep the
	// rest), appends any new brain-registry.json entries, and returns the repo's
	// machine-readable manifest.json + HEALTH.md so the UI can drive a
	// "Bring it Live" setup screen. NEVER runs any of the manifest's commands —
	// that stays human-in-the-loop in the renderer. Guarded end to end.
	ipcMain.handle(
		"brain:import-git",
		async (
			_e,
			args: { url: string },
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
		}> => {
			try {
				const url = (args?.url || "").trim()
				if (!url) return { ok: false, error: "No repo URL provided." }

				// Sanitized folder name, same slug approach as brain:clone-repo.
				const last = url.replace(/\/+$/, "").split("/").pop() || "brain"
				const name =
					last.replace(/\.git$/i, "").toLowerCase().replace(/[^a-z0-9-_]/g, "-") || "brain"
				const dest = path.join(app.getPath("userData"), "brain-import", name)

				// Clear any stale checkout so the shallow clone lands in a fresh dir.
				fs.rmSync(dest, { recursive: true, force: true })
				await mkdir(path.dirname(dest), { recursive: true })
				await new Promise<void>((resolve, reject) => {
					execFile(
						"git",
						["clone", "--depth", "1", url, dest],
						{ timeout: 120000 },
						(err) => (err ? reject(err) : resolve()),
					)
				})

				const configDir = path.join(os.homedir(), ".config", "opencode")
				const localSkillsDir = path.join(configDir, "skills")
				await mkdir(localSkillsDir, { recursive: true })

				// Merge skills — copy each incoming skill folder over the top of the
				// local one (same-name overwrites, everything else is left alone).
				const repoSkillsDir = path.join(dest, "skills")
				try {
					const skillEntries = fs.readdirSync(repoSkillsDir, { withFileTypes: true })
					for (const entry of skillEntries) {
						if (!entry.isDirectory()) continue
						try {
							fs.cpSync(
								path.join(repoSkillsDir, entry.name),
								path.join(localSkillsDir, entry.name),
								{ recursive: true, force: true },
							)
						} catch {
							// One bad skill folder shouldn't abort the whole import.
						}
					}
				} catch {
					// No skills/ in the repo — nothing to merge.
				}

				// Merge registry — append incoming entries whose id/name aren't
				// already present locally, leaving existing entries untouched.
				try {
					const incoming = JSON.parse(
						fs.readFileSync(path.join(dest, "brain-registry.json"), "utf8"),
					)
					if (Array.isArray(incoming) && incoming.length > 0) {
						const registryPath = path.join(configDir, "brain-registry.json")
						let local: Array<{ id?: string; name?: string }> = []
						try {
							const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"))
							if (Array.isArray(parsed)) local = parsed
						} catch {
							local = []
						}
						const has = (e: { id?: string; name?: string }) =>
							local.some((x) => (e.id && x.id === e.id) || (e.name && x.name === e.name))
						for (const e of incoming) {
							if (e && typeof e === "object" && !has(e)) local.push(e)
						}
						fs.writeFileSync(registryPath, JSON.stringify(local, null, 2))
					}
				} catch {
					// No brain-registry.json in the repo, or it's malformed — skip.
				}

				// Parse the machine-readable manifest, if the repo shipped one.
				let manifest: {
					generatedAt?: string
					skills?: Array<{ name: string; description?: string; type?: string }>
					tools?: Array<{ name: string; command?: string; source?: string }>
					models?: Array<{ name: string; source?: string }>
					connectors?: Array<{ name?: string; source?: string }>
				} | null = null
				try {
					const parsed = JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8"))
					if (parsed && typeof parsed === "object") manifest = parsed
				} catch {
					manifest = null
				}

				// The incoming health report, if present, so the UI can show what
				// still needs work.
				let health: string | null = null
				try {
					health = fs.readFileSync(path.join(dest, "HEALTH.md"), "utf8")
				} catch {
					health = null
				}

				let imported = 0
				try {
					imported = fs
						.readdirSync(localSkillsDir, { withFileTypes: true })
						.filter((e) => e.isDirectory()).length
				} catch {
					// Skills dir unreadable after merge — leave the count at 0.
				}

				refreshBrainCatalog()
				return { ok: true, imported, manifest, health }
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}
		},
	)

	// Run ONE setup command from an imported Brain's manifest — the installer half
	// of "Bring it Live". Called ONLY from the renderer AFTER the user has seen the
	// exact command on screen and chosen to run it (never auto-run on import). The
	// command came from someone else's Brain, so keeping it human-in-the-loop is
	// the whole security model. Returns the real exit code + output; never throws.
	ipcMain.handle(
		"brain:run-command",
		async (
			_e,
			args: { command: string },
		): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> => {
			const command = (args?.command || "").trim()
			if (!command) {
				return { ok: false, code: 1, stdout: "", stderr: "No command provided." }
			}
			return await new Promise((resolve) => {
				execFile(
					"/bin/sh",
					["-c", command],
					{ timeout: 300000, maxBuffer: 8 * 1024 * 1024, env: process.env },
					(err, stdout, stderr) => {
						const e = err as (Error & { code?: number | string; killed?: boolean }) | null
						const code =
							e && typeof e.code === "number" ? e.code : e?.killed ? 124 : e ? 1 : 0
						resolve({
							ok: code === 0,
							code,
							stdout: String(stdout).slice(-8000),
							stderr: String(stderr).slice(-8000),
						})
					},
				)
			})
		},
	)

	// Deterministic health check for a set of Brain items — NO agent, NO AI.
	// Each item is checked with a fast, objective probe based on what it is:
	//   • has a URL source (docs/repo/model/skill/software) → net.fetch HEAD,
	//     status < 400 = ok, 404/410 = dead, anything else / timeout = warn.
	//   • repo with a git URL → `git ls-remote`, success = ok, failure = dead.
	//   • tool / software with a command → `which <exe>`, found = ok else warn.
	//   • nothing external to check → ok (a local rule can't rot).
	// Never throws across IPC — the whole thing is guarded, and any total
	// failure returns every item as "warn" so the wizard still renders.
	ipcMain.handle(
		"brain:scan",
		async (
			_e,
			items: Array<{
				id: string
				kind: "skill" | "repo" | "software" | "docs" | "model" | "tool"
				source?: string
				command?: string
			}>,
		): Promise<Array<{ id: string; status: "ok" | "warn" | "dead"; detail: string }>> => {
			const list = Array.isArray(items) ? items : []

			// HEAD the source URL; on 405/other HEAD-refusals fall back to a GET.
			const checkUrl = async (
				url: string,
			): Promise<{ status: "ok" | "warn" | "dead"; detail: string }> => {
				const once = async (method: "HEAD" | "GET") => {
					const controller = new AbortController()
					const timer = setTimeout(() => controller.abort(), 8000)
					try {
						const res = await net.fetch(url, { method, signal: controller.signal })
						return res
					} finally {
						clearTimeout(timer)
					}
				}
				try {
					let res = await once("HEAD")
					if (res.status === 405 || res.status === 501) res = await once("GET")
					if (res.status === 404 || res.status === 410) {
						return { status: "dead", detail: `${res.status} ${res.statusText || "Not Found"}` }
					}
					if (res.status < 400) return { status: "ok", detail: `${res.status} OK` }
					return { status: "warn", detail: `${res.status} ${res.statusText || "error"}` }
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					return { status: "warn", detail: msg.includes("abort") ? "timed out" : "unreachable" }
				}
			}

			// `git ls-remote <url>` — a live git URL lists refs, a dead one errors.
			const checkGitRemote = (url: string) =>
				new Promise<{ status: "ok" | "warn" | "dead"; detail: string }>((resolve) => {
					execFile("git", ["ls-remote", url], { timeout: 12000 }, (err) => {
						if (err) resolve({ status: "dead", detail: "repo unreachable" })
						else resolve({ status: "ok", detail: "repo reachable" })
					})
				})

			// `which <exe>` — is the executable on this machine's PATH?
			const checkCommand = (command: string, fallbackName: string) =>
				new Promise<{ status: "ok" | "warn" | "dead"; detail: string }>((resolve) => {
					const exe = ((command || "").trim().split(/\s+/)[0] || fallbackName || "").trim()
					if (!exe) {
						resolve({ status: "ok", detail: "nothing to check" })
						return
					}
					execFile("which", [exe], { timeout: 5000 }, (err) => {
						if (err) resolve({ status: "warn", detail: `${exe} not installed` })
						else resolve({ status: "ok", detail: `${exe} installed` })
					})
				})

			const isHttp = (s?: string): s is string => !!s && /^https?:\/\//i.test(s.trim())
			const isGitUrl = (s?: string): s is string =>
				!!s && (/^(git@|ssh:\/\/|git:\/\/)/i.test(s.trim()) || /\.git$/i.test(s.trim()))

			const results = await Promise.all(
				list.map(async (item) => {
					try {
						// Repos: prefer a git-native probe, else fall back to a URL check.
						if (item.kind === "repo" && item.source) {
							if (isGitUrl(item.source)) {
								const r = await checkGitRemote(item.source)
								return { id: item.id, ...r }
							}
							if (isHttp(item.source)) {
								const r = await checkUrl(item.source)
								return { id: item.id, ...r }
							}
						}
						// Tools / software with a command: is the binary present?
						if ((item.kind === "tool" || item.kind === "software") && item.command) {
							const r = await checkCommand(item.command, item.id)
							return { id: item.id, ...r }
						}
						// Anything with an http(s) source: HEAD it.
						if (isHttp(item.source)) {
							const r = await checkUrl(item.source)
							return { id: item.id, ...r }
						}
						// A git URL living in source without kind "repo".
						if (isGitUrl(item.source)) {
							const r = await checkGitRemote(item.source)
							return { id: item.id, ...r }
						}
						// Nothing external to check — a local skill/rule can't rot.
						return {
							id: item.id,
							status: "ok" as const,
							detail: "nothing external to check",
						}
					} catch {
						return { id: item.id, status: "warn" as const, detail: "could not check" }
					}
				}),
			)
			return results
		},
	)

	// Remove one thing from the Brain — either a skill folder or a registry
	// entry. For "skill" the id is the skill name; we slugify it the same way
	// create_skill does and delete ~/.config/opencode/skills/<slug>. For
	// "registry" we drop the entry whose id or name matches and rewrite the json.
	// Guarded throughout — never throws across IPC.
	ipcMain.handle(
		"brain:remove-item",
		async (
			_e,
			args: { kind: "skill" | "registry"; id: string },
		): Promise<{ ok: boolean; error?: string }> => {
			try {
				const kind = args?.kind
				const id = (args?.id || "").trim()
				if (!id) return { ok: false, error: "No item id provided." }
				const configDir = path.join(os.homedir(), ".config", "opencode")
				if (kind === "skill") {
					const slug =
						id
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-+|-+$/g, "") || id
					fs.rmSync(path.join(configDir, "skills", slug), { recursive: true, force: true })
					refreshBrainCatalog()
					return { ok: true }
				}
				if (kind === "registry") {
					const registryPath = path.join(configDir, "brain-registry.json")
					let registry: Array<{ id?: string; name?: string }> = []
					try {
						const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"))
						if (Array.isArray(parsed)) registry = parsed
					} catch {
						return { ok: true } // No registry on disk — nothing to remove.
					}
					const next = registry.filter((e) => e && e.id !== id && e.name !== id)
					fs.writeFileSync(registryPath, JSON.stringify(next, null, 2))
					refreshBrainCatalog()
					return { ok: true }
				}
				return { ok: false, error: "Unknown item kind." }
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}
		},
	)

	// Publish the selected Brain items to a private GitHub repo — the payoff of
	// the Share Brain wizard. Assembles a fresh publish dir under userData with
	// only the selected skill folders + a filtered registry, then writes a
	// machine-readable manifest.json (tools' install commands, models' source
	// links — NEVER any credentials/tokens) and a human BRAIN.md README, and
	// pushes via the `gh` CLI (creating the repo on first run, plain push after).
	ipcMain.handle(
		"brain:publish-git",
		async (
			_e,
			args: {
				items: Array<{ kind: "skill" | "registry"; id: string; name: string; type?: string }>
				report?: string
			},
		): Promise<{ ok: boolean; url?: string; error?: string }> => {
			try {
				const items = Array.isArray(args?.items) ? args.items : []
				if (items.length === 0) return { ok: false, error: "Nothing selected to publish." }

				const configDir = path.join(os.homedir(), ".config", "opencode")
				const srcSkillsDir = path.join(configDir, "skills")
				const registryPath = path.join(configDir, "brain-registry.json")

				// Full registry, read once — used to filter + to fill the manifest.
				let registry: Array<Record<string, unknown>> = []
				try {
					const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"))
					if (Array.isArray(parsed)) registry = parsed
				} catch {
					registry = []
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
				const slugify = (s: string) =>
					s
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-+|-+$/g, "")

				// Fresh publish dir, but keep any existing .git so re-runs push to
				// the SAME repo. Only the generated content is cleared + rebuilt.
				const publishDir = path.join(app.getPath("userData"), "brain-repo")
				await mkdir(publishDir, { recursive: true })
				for (const stale of [
					"skills",
					"brain-registry.json",
					"manifest.json",
					"BRAIN.md",
					"AGENTS.md",
					"HEALTH.md",
				]) {
					fs.rmSync(path.join(publishDir, stale), { recursive: true, force: true })
				}
				const outSkillsDir = path.join(publishDir, "skills")
				await mkdir(outSkillsDir, { recursive: true })

				const manifest = {
					generatedAt: new Date().toISOString(),
					skills: [] as Array<{ name: string; description: string; type: string }>,
					tools: [] as Array<{ name: string; command: string; source?: string }>,
					models: [] as Array<{ name: string; source?: string }>,
					connectors: [] as unknown[],
				}
				const keptRegistry: Array<Record<string, unknown>> = []

				for (const item of items) {
					if (item.kind === "skill") {
						const slug = slugify(item.id) || item.id
						const src = path.join(srcSkillsDir, slug)
						let description = ""
						let type = item.type || "skill"
						try {
							const content = fs.readFileSync(path.join(src, "SKILL.md"), "utf8")
							description = field(content, "description") || ""
							type = field(content, "type") || type
						} catch {
							// No SKILL.md — still copy whatever's there + list it.
						}
						try {
							fs.cpSync(src, path.join(outSkillsDir, slug), { recursive: true })
						} catch {
							// Folder missing on disk — skip the copy, keep the manifest line.
						}
						manifest.skills.push({ name: item.name, description, type })
					} else if (item.kind === "registry") {
						const entry = registry.find(
							(e) => e && (e.id === item.id || e.name === item.id || e.name === item.name),
						)
						if (!entry) continue
						keptRegistry.push(entry)
						const name = String(entry.name ?? item.name)
						const command = String(entry.command ?? "")
						const source = entry.source ? String(entry.source) : undefined
						if (entry.kind === "model") manifest.models.push({ name, source })
						else manifest.tools.push({ name, command, source })
					}
				}

				fs.writeFileSync(
					path.join(publishDir, "brain-registry.json"),
					JSON.stringify(keptRegistry, null, 2),
				)
				fs.writeFileSync(path.join(publishDir, "manifest.json"), JSON.stringify(manifest, null, 2))

				// Human README — what this is, a one-line count, and a rebuild guide
				// with the tools/models as checklists.
				const md: string[] = []
				md.push("# Hramble Brain")
				md.push("")
				md.push(
					"A shared, portable **Brain** for Hramble Coder — a bundle of reusable skills, CLI tools and local models taught on another machine.",
				)
				md.push("")
				// Split skill items by their frontmatter `type` so a human browsing
				// GitHub can scan skills, absorbed repos and saved docs separately.
				const plainSkills = manifest.skills.filter((s) => (s.type || "skill") === "skill")
				const repoSkills = manifest.skills.filter((s) => s.type === "repo")
				const docSkills = manifest.skills.filter((s) => s.type === "docs")
				md.push(
					`**Contents:** ${plainSkills.length} skills · ${repoSkills.length} repos · ${docSkills.length} docs · ${manifest.tools.length} tools · ${manifest.models.length} models${manifest.connectors.length > 0 ? ` · ${manifest.connectors.length} connectors` : ""}`,
				)
				md.push("")
				md.push("## To bring it live")
				md.push("")
				md.push(
					"Import this repo into Hramble (Brain → Import), then run setup to install the listed tools, download the models, and reconnect any services. Nothing here contains secrets or tokens — you re-authenticate services yourself.",
				)
				md.push("")
				if (plainSkills.length > 0) {
					md.push("## Skills")
					md.push("")
					for (const s of plainSkills) md.push(`- **${s.name}** — ${s.description || s.type}`)
					md.push("")
				}
				if (repoSkills.length > 0) {
					md.push("## Repos absorbed")
					md.push("")
					for (const s of repoSkills) md.push(`- **${s.name}** — ${s.description || s.type}`)
					md.push("")
				}
				if (docSkills.length > 0) {
					md.push("## Docs / references")
					md.push("")
					for (const s of docSkills) md.push(`- **${s.name}** — ${s.description || s.type}`)
					md.push("")
				}
				if (manifest.tools.length > 0) {
					md.push("## Tools to install")
					md.push("")
					for (const t of manifest.tools) {
						md.push(
							`- [ ] **${t.name}**${t.command ? ` — \`${t.command}\`` : ""}${t.source ? ` (${t.source})` : ""}`,
						)
					}
					md.push("")
				}
				if (manifest.models.length > 0) {
					md.push("## Models to download")
					md.push("")
					for (const m of manifest.models) {
						md.push(`- [ ] **${m.name}**${m.source ? ` — ${m.source}` : ""}`)
					}
					md.push("")
				}
				if (manifest.connectors.length > 0) {
					md.push("## Connectors")
					md.push("")
					for (const c of manifest.connectors) {
						const cn = c && typeof c === "object" ? (c as Record<string, unknown>) : undefined
						const name = cn ? String(cn.name ?? cn.id ?? "connector") : String(c)
						const desc = cn && cn.description ? ` — ${String(cn.description)}` : ""
						md.push(`- **${name}**${desc}`)
					}
					md.push("")
				}
				fs.writeFileSync(path.join(publishDir, "BRAIN.md"), md.join("\n"))

				// AGENTS.md — OpenCode auto-loads this as instructions, so it is how the
				// receiving user's AI learns the brain. Built from the same manifest data:
				// a compact menu (names + one-liners + invocation commands), never the full
				// skill bodies (those live in skills/<name>/SKILL.md). No secrets/tokens.
				const ag: string[] = []
				ag.push("# Hramble Brain — agent instructions")
				ag.push("")
				ag.push(
					"This repository is an imported Hramble **Brain** — a bundle of reusable skills, absorbed repos, saved docs, CLI tools, local models, and service connectors that you can use. The full instructions for each skill live in `skills/<name>/SKILL.md`; open the matching one when a task lines up with it instead of re-deriving the work.",
				)
				ag.push("")
				if (plainSkills.length > 0) {
					ag.push("## Skills")
					for (const s of plainSkills) ag.push(`- ${s.name} (${s.type || "skill"}): ${s.description || ""}`.trimEnd())
					ag.push("")
				}
				if (repoSkills.length > 0) {
					ag.push("## Repos")
					for (const s of repoSkills) ag.push(`- ${s.name} (repo): ${s.description || ""}`.trimEnd())
					ag.push("")
				}
				if (docSkills.length > 0) {
					ag.push("## Docs")
					for (const s of docSkills) ag.push(`- ${s.name} (docs): ${s.description || ""}`.trimEnd())
					ag.push("")
				}
				if (manifest.tools.length > 0) {
					ag.push("## Tools")
					ag.push("Installed CLI tools — invoke each via its command:")
					for (const t of manifest.tools) {
						ag.push(`- ${t.name}: run via \`${t.command || t.name}\``)
					}
					ag.push("")
				}
				if (manifest.models.length > 0) {
					ag.push("## Models")
					for (const m of manifest.models) ag.push(`- ${m.name}${m.source ? `: ${m.source}` : ""}`)
					ag.push("")
				}
				if (manifest.connectors.length > 0) {
					ag.push("## Connectors")
					for (const c of manifest.connectors) {
						const cn = c && typeof c === "object" ? (c as Record<string, unknown>) : undefined
						const name = cn ? String(cn.name ?? cn.id ?? "connector") : String(c)
						ag.push(`- ${name}`)
					}
					ag.push("")
				}
				ag.push(
					"When unsure, consult the matching `skills/<name>/SKILL.md` before re-deriving anything.",
				)
				ag.push("")
				fs.writeFileSync(path.join(publishDir, "AGENTS.md"), ag.join("\n"))

				// Ship the health report alongside the brain, so an incomplete brain
				// arrives with a clear "here's what still needs work" checklist.
				if (typeof args?.report === "string" && args.report.trim()) {
					fs.writeFileSync(path.join(publishDir, "HEALTH.md"), args.report)
				}

				// --- Git + gh publish ---
				const run = (cmd: string, cmdArgs: string[], timeout = 120000) =>
					new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
						execFile(
							cmd,
							cmdArgs,
							{ cwd: publishDir, timeout, maxBuffer: 8 * 1024 * 1024 },
							(err, stdout, stderr) => {
								const e = err as (Error & { code?: number | string }) | null
								const code = e && typeof e.code === "number" ? e.code : e ? 1 : 0
								resolve({ code, stdout: String(stdout), stderr: String(stderr) })
							},
						)
					})

				if (!fs.existsSync(path.join(publishDir, ".git"))) {
					await run("git", ["init"])
					await run("git", ["checkout", "-B", "main"])
				}
				await run("git", ["add", "-A"])
				// Commit — a non-zero exit here just means "nothing changed", fine.
				await run("git", ["commit", "-m", `Update brain ${new Date().toISOString()}`])

				// gh must be present + authenticated for the push half.
				const ghVersion = await run("gh", ["--version"], 15000)
				if (ghVersion.code !== 0) {
					return {
						ok: false,
						error: "GitHub CLI (gh) is not installed — install it, then run `gh auth login`.",
					}
				}
				const auth = await run("gh", ["auth", "status"], 15000)
				if (auth.code !== 0) {
					return {
						ok: false,
						error: "GitHub CLI not authenticated — run `gh auth login` in a terminal first.",
					}
				}

				// Already linked to a repo? → just push. Otherwise create + push.
				const view = await run("gh", ["repo", "view", "--json", "url", "-q", ".url"], 30000)
				if (view.code === 0 && view.stdout.trim()) {
					const pushed = await run("git", ["push"], 120000)
					if (pushed.code !== 0) {
						const pushU = await run("git", ["push", "-u", "origin", "HEAD"], 120000)
						if (pushU.code !== 0) {
							return { ok: false, error: pushU.stderr.trim() || "git push failed." }
						}
					}
					return { ok: true, url: view.stdout.trim() }
				}

				const created = await run(
					"gh",
					["repo", "create", "hramble-brain", "--private", "--source=.", "--push"],
					120000,
				)
				if (created.code !== 0) {
					return { ok: false, error: created.stderr.trim() || "Couldn't create the GitHub repo." }
				}
				const url = await run("gh", ["repo", "view", "--json", "url", "-q", ".url"], 30000)
				return { ok: true, url: url.stdout.trim() || undefined }
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}
		},
	)

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

	// Pick a local file for the Brain's Docs arm — any document, code/text file,
	// SVG or image (video is out of scope). Returns the chosen file's path, or
	// null if cancelled.
	ipcMain.handle(
		"dialog:open-doc-file",
		withLogging("dialog:open-doc-file", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openFile"],
				title: "Choose a file for the Brain to read",
				filters: [
					{
						name: "Documents",
						extensions: [
							"pdf",
							"txt",
							"md",
							"markdown",
							"docx",
							"rtf",
							"csv",
							"json",
							"yaml",
							"yml",
							"html",
							"xml",
						],
					},
					{
						name: "Code / text",
						extensions: [
							"js",
							"mjs",
							"cjs",
							"ts",
							"tsx",
							"jsx",
							"py",
							"rb",
							"go",
							"rs",
							"java",
							"kt",
							"c",
							"h",
							"cpp",
							"cc",
							"hpp",
							"cs",
							"php",
							"swift",
							"sh",
							"bash",
							"zsh",
							"sql",
							"toml",
							"ini",
							"cfg",
							"conf",
							"env",
							"example",
							"lua",
							"r",
							"vue",
							"svelte",
						],
					},
					{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
					{ name: "All files", extensions: ["*"] },
				],
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

	ipcMain.handle("settings:update", (_, partial) => {
		const updated = updateSettings(partial)
		// Keep the always-aware Brain catalog in sync with the toggle so a change
		// takes effect for the next session (writes an empty catalog when off).
		if (partial && Object.hasOwn(partial, "brainCatalogInSessions")) {
			writeBrainCatalog(updated.brainCatalogInSessions)
		}
		return updated
	})

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
