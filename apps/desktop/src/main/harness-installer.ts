/**
 * Installs Hramble's bundled OpenCode "harness" — the Claude-grade coding brain —
 * into a Hramble-managed config directory, and exposes that directory so the
 * OpenCode server can be pointed at it via OPENCODE_CONFIG_DIR (set at spawn in
 * opencode-manager).
 *
 * The harness is what makes any model (GLM 5.2, local, etc.) behave like Claude
 * Code: the ~850-line professional system prompt, the read-only `plan` agent, the
 * `general` subagent, the tool plugins (preview, claude-guard, artifact, memory,
 * …), and the skills.
 *
 * OPENCODE_CONFIG_DIR is ADDITIVE: OpenCode MERGES this directory with the user's
 * own ~/.config/opencode, so we layer the harness on top without ever touching or
 * clobbering the user's personal providers, models, MCP servers, or auth (auth
 * lives in the data dir, not the config dir, so it is unaffected either way).
 *
 * Idempotent and version-stamped: files are re-copied only when the app version
 * changes. In dev (unpackaged) it is a deliberate no-op — the developer's own
 * ~/.config/opencode is used as-is — so this never disturbs a working dev setup.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import { createLogger } from "./logger"

const log = createLogger("harness-installer")

/** Directories/files copied verbatim from the bundle into the managed dir. */
const BUNDLE_DIR_NAME = "opencode-harness"
const TEMPLATE_FILE = "opencode.template.json"
const STAMP_FILE = ".hramble-harness-version"
/** Placeholder in the config template, replaced with the absolute managed dir. */
const HARNESS_DIR_TOKEN = "{{HARNESS_DIR}}"
/**
 * Placeholder replaced with the user's OpenCode config dir (`~/.config/opencode`).
 * Used to point the `instructions` list at the always-aware Brain catalog
 * (`BRAIN.md`), which the app regenerates there from the local Brain.
 */
const CONFIG_DIR_TOKEN = "{{CONFIG_DIR}}"

let managedConfigDir: string | null = null

/**
 * The Hramble-managed OpenCode config directory to hand to OPENCODE_CONFIG_DIR,
 * or null when the harness isn't installed (dev mode, or a failed install — in
 * which case OpenCode simply falls back to its default config).
 */
export function getManagedConfigDir(): string | null {
	return managedConfigDir
}

/**
 * Seeds the managed harness directory from the app bundle. Safe to call once on
 * startup, before the OpenCode server is spawned. Returns the managed dir, or
 * null if it was skipped (dev) or failed (logged; non-fatal).
 */
export function installHarness(): string | null {
	try {
		// Dev: the developer maintains ~/.config/opencode directly. Do nothing so
		// we never double-load plugins or overwrite their working config.
		if (!app.isPackaged) {
			log.info("Dev build — skipping harness install (using ~/.config/opencode as-is)")
			return null
		}

		const bundleDir = path.join(process.resourcesPath, BUNDLE_DIR_NAME)
		const templateSrc = path.join(bundleDir, TEMPLATE_FILE)
		if (!fs.existsSync(templateSrc)) {
			log.warn("Bundled harness not found; OpenCode will use its default config", { bundleDir })
			return null
		}

		const managedDir = path.join(app.getPath("userData"), BUNDLE_DIR_NAME)
		const stampPath = path.join(managedDir, STAMP_FILE)
		const version = app.getVersion()

		// Already installed for this exact app version → reuse, skip the copy.
		if (readStamp(stampPath) === version) {
			managedConfigDir = managedDir
			log.info("Harness already current; reusing", { managedDir, version })
			return managedDir
		}

		// (Re)install: wipe and copy the whole bundle, then resolve the config template.
		fs.rmSync(managedDir, { recursive: true, force: true })
		fs.cpSync(bundleDir, managedDir, { recursive: true })

		const templatePath = path.join(managedDir, TEMPLATE_FILE)
		const template = fs.readFileSync(templatePath, "utf8")
		// JSON-escape the paths so backslashes/quotes are safe in the JSON string context.
		const escapedDir = JSON.stringify(managedDir).slice(1, -1)
		const openCodeConfigDir = path.join(os.homedir(), ".config", "opencode")
		const escapedConfigDir = JSON.stringify(openCodeConfigDir).slice(1, -1)
		const resolved = template
			.split(HARNESS_DIR_TOKEN)
			.join(escapedDir)
			.split(CONFIG_DIR_TOKEN)
			.join(escapedConfigDir)
		JSON.parse(resolved) // fail fast if the resolved config is not valid JSON
		fs.writeFileSync(path.join(managedDir, "opencode.json"), resolved, "utf8")
		fs.rmSync(templatePath, { force: true })

		fs.writeFileSync(stampPath, version, "utf8")
		managedConfigDir = managedDir
		log.info("Installed OpenCode harness", { managedDir, version })
		return managedDir
	} catch (err) {
		// Never let a harness problem block startup — fall back to default config.
		log.error("Failed to install OpenCode harness; using default config", {
			error: err instanceof Error ? err.message : String(err),
		})
		managedConfigDir = null
		return null
	}
}

function readStamp(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8").trim()
	} catch {
		return null
	}
}
