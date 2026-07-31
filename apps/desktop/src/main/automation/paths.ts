/**
 * XDG Base Directory paths for Hramble automation storage.
 *
 * Follows the XDG Base Directory Specification, matching the convention
 * used by OpenCode (see packages/opencode/src/global/index.ts):
 *
 *   Config:  $XDG_CONFIG_HOME/hramble  (default ~/.config/hramble)
 *   Data:    $XDG_DATA_HOME/hramble    (default ~/.local/share/hramble)
 *
 * Automation configs live under config (human-editable JSON + prompt.md).
 * The SQLite database lives under data (machine-managed state).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const APP_NAME = "hramble"
/** Previous app name — used only for the one-time storage migration. */
const LEGACY_APP_NAME = "palot"

function xdgConfigHome(): string {
	return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}
function xdgDataHome(): string {
	return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
}

/**
 * Returns the XDG config directory for Hramble.
 * Automations configs are stored at `<config>/automations/<id>/`.
 */
export function getConfigDir(): string {
	return path.join(xdgConfigHome(), APP_NAME)
}

/**
 * Returns the XDG data directory for Hramble.
 * The SQLite database is stored at `<data>/hramble.db`.
 */
export function getDataDir(): string {
	return path.join(xdgDataHome(), APP_NAME)
}

/**
 * One-time migration from the legacy "palot" storage location to "hramble".
 *
 * Safe by design: only moves when the NEW location does not exist yet, uses an
 * atomic rename, and never throws (worst case the app just starts fresh). Must
 * be called on startup BEFORE any storage is opened (i.e. before initAutomations).
 */
export function migrateLegacyStorage(): void {
	try {
		// Move config dir: ~/.config/palot -> ~/.config/hramble
		const oldConfig = path.join(xdgConfigHome(), LEGACY_APP_NAME)
		const newConfig = getConfigDir()
		if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
			fs.renameSync(oldConfig, newConfig)
		}

		// Move data dir: ~/.local/share/palot -> ~/.local/share/hramble
		const oldData = path.join(xdgDataHome(), LEGACY_APP_NAME)
		const newData = getDataDir()
		if (fs.existsSync(oldData) && !fs.existsSync(newData)) {
			fs.renameSync(oldData, newData)
		}

		// Rename the DB file (+ SQLite sidecars) inside the data dir: palot.db -> hramble.db
		for (const ext of ["", "-wal", "-shm", "-journal"]) {
			const oldDb = path.join(getDataDir(), `palot.db${ext}`)
			const newDb = path.join(getDataDir(), `hramble.db${ext}`)
			if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
				fs.renameSync(oldDb, newDb)
			}
		}
	} catch (err) {
		// Never crash on migration failure.
		console.error("[storage-migration] palot → hramble migration failed (continuing):", err)
	}
}
