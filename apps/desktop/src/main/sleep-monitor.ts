import { BrowserWindow, powerMonitor } from "electron"

/**
 * Forwards macOS sleep/wake events to every renderer window. The actual
 * "was anything interrupted?" logic lives in the renderer (atoms/sleep-recovery.ts)
 * since it's the renderer that owns the session/Hyperloop state needed to
 * answer that — this file only bridges the OS-level signal across.
 */
export function registerSleepMonitor(): void {
	powerMonitor.on("suspend", () => broadcast("power:suspend"))
	powerMonitor.on("resume", () => broadcast("power:resume"))
}

function broadcast(channel: string): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(channel)
	}
}
