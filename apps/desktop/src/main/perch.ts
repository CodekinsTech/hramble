// Perch mode — a separate transparent always-on-top window that renders the VRM
// avatar and SITS on the top edge of the frontmost window (or the dock), following
// it as it moves. Ported/adapted from AvatarBox (electron-main.js perch section)
// to a dedicated window (Hramble's main coder window is untouched).

import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { BrowserWindow, ipcMain, screen, systemPreferences } from "electron"

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Exact AvatarBox perch geometry. The 480×528 window + the fixed VRM camera
// framing (camY 0.96, camDist 4.1) is what plants the feet ~10px from the
// window's bottom, which the positioning math below relies on.
const PERCH_POLL_MS = 120
const PERCH_FEET_OFFSET = 10
const PERCH_STAND_MS = 7000
const PERCH_W = 480
const PERCH_H = 528

type Rect = { x: number; y: number; w: number; h: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

let deps: { preloadPath: string; rendererUrl?: string; rendererFile?: string } | null = null
let perchWin: BrowserWindow | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wb: any = null
let tickTimer: NodeJS.Timeout | null = null
let hitTimer: NodeJS.Timeout | null = null
let hitRects: Rect[] = []
let snappedWin: Win = null
let snapTime = 0
let sitMode = false
let snapFraction = 0.5
let lastWillMove = 0

function loadWb() {
	if (wb) return wb
	const tries = [
		path.join(__dirname, "../../native/window-bounds/index.js"),
		path.join(process.cwd(), "native/window-bounds/index.js"),
		path.join(process.cwd(), "apps/desktop/native/window-bounds/index.js"),
	]
	for (const p of tries) {
		try {
			const mod = require(p)
			if (mod && typeof mod.getFocusedWindow === "function") {
				wb = mod
				return wb
			}
		} catch {
			/* try next */
		}
	}
	wb = { __error: "addon-not-found" }
	return wb
}

function isTrusted(prompt = false): boolean {
	if (process.platform !== "darwin") return true
	try {
		return !!systemPreferences.isTrustedAccessibilityClient(prompt)
	} catch {
		return false
	}
}

function dockEdge() {
	const d = screen.getPrimaryDisplay()
	const sc = d.bounds
	const wa = d.workArea
	const leftGap = wa.x - sc.x
	const rightGap = sc.x + sc.width - (wa.x + wa.width)
	if (leftGap > 10) return { dockTop: wa.y + wa.height }
	if (rightGap > 10) return { dockTop: wa.y + wa.height }
	return { dockTop: wa.y + wa.height }
}

function moveTo(x: number, y: number) {
	if (!perchWin || perchWin.isDestroyed()) return
	try {
		perchWin.setPosition(Math.round(x), Math.round(y))
	} catch {
		/* ignore */
	}
}

function readWindows(): Win[] {
	const n = loadWb()
	if (!n || n.__error || !isTrusted(false)) return []
	try {
		const all = typeof n.getAllWindows === "function" ? n.getAllWindows() : []
		if (Array.isArray(all) && all.length) return all
		const f = n.getFocusedWindow()
		return f ? [f] : []
	} catch {
		return []
	}
}

function tick() {
	if (!perchWin || perchWin.isDestroyed()) return
	const now = Date.now()
	const cur = perchWin.getBounds()
	const w = cur.width
	const h = cur.height
	const avatarCX = cur.x + w / 2
	// While she's being dragged, never reposition (free drag). This is purely a
	// timestamp — it auto-expires after 400ms so the loop can never dead-lock.
	if (now - lastWillMove < 400) return

	const allWins = readWindows()
	const { dockTop } = dockEdge()

	// Follow the snapped window if it's still around.
	if (snappedWin) {
		let found: Win = null
		for (const f of allWins) {
			if (
				f.app === snappedWin.app &&
				Math.abs(f.x - snappedWin.x) < 80 &&
				Math.abs(f.w - snappedWin.w) < 80
			) {
				found = f
				break
			}
		}
		if (found) {
			snappedWin = found
			if (!snapTime) snapTime = now
			const sitting = sitMode || now - snapTime >= PERCH_STAND_MS
			sitMode = sitting
			const targetX = Math.max(
				found.x,
				Math.min(found.x + found.w - w, found.x + Math.round(snapFraction * found.w) - Math.round(w / 2)),
			)
			const targetY = sitting ? found.y - Math.round(h * 0.55) : found.y - h + PERCH_FEET_OFFSET
			if (Math.abs(targetX - cur.x) > 1 || Math.abs(targetY - cur.y) > 1) moveTo(targetX, targetY)
			sendZone(sitting ? "sit" : "stand")
			return
		}
		snappedWin = null
	}

	// Find nearest window top edge (probe at the feet).
	const probeY = cur.y + h - PERCH_FEET_OFFSET
	let best: { win: Win; targetX: number; targetY: number; dist: number } | null = null
	for (const f of allWins) {
		if (f.w < 100 || f.h < 40) continue
		if (avatarCX < f.x || avatarCX > f.x + f.w) continue
		const dist = Math.abs(probeY - f.y)
		const snapX = Math.max(f.x, Math.min(f.x + f.w - w, Math.round(avatarCX - w / 2)))
		if (!best || dist < best.dist) best = { win: f, targetX: snapX, targetY: f.y - h + PERCH_FEET_OFFSET, dist }
	}
	const dockDist = Math.abs(probeY - dockTop)
	if (!best || dockDist < best.dist) {
		best = { win: null, targetX: cur.x, targetY: dockTop - h + PERCH_FEET_OFFSET, dist: dockDist }
	}

	if (best.win) {
		if (!snapTime) snapTime = now
		const sitting = sitMode || now - snapTime >= PERCH_STAND_MS
		sitMode = sitting
		best.targetY = sitting ? best.win.y - Math.round(h * 0.55) : best.win.y - h + PERCH_FEET_OFFSET
		snappedWin = { ...best.win }
		snapFraction = Math.max(0, Math.min(1, (avatarCX - best.win.x) / Math.max(1, best.win.w)))
		sendZone(sitting ? "sit" : "stand")
	} else {
		snappedWin = null
		sendZone("dock")
	}
	if (Math.abs(best.targetX - cur.x) > 1 || Math.abs(best.targetY - cur.y) > 1) moveTo(best.targetX, best.targetY)
}

function sendZone(zone: string) {
	try {
		perchWin?.webContents.send("perch:zone", zone)
	} catch {
		/* ignore */
	}
}

// Click-through: interactive only when the cursor is over the avatar's hit rects.
function hitTest() {
	if (!perchWin || perchWin.isDestroyed() || !tickTimer) return
	if (!hitRects.length) return
	try {
		const cur = screen.getCursorScreenPoint()
		const wbnds = perchWin.getBounds()
		const rx = cur.x - wbnds.x
		const ry = cur.y - wbnds.y
		let over = false
		for (const r of hitRects) {
			if (rx >= r.x && rx <= r.x + r.w && ry >= r.y && ry <= r.y + r.h) {
				over = true
				break
			}
		}
		perchWin.setIgnoreMouseEvents(!over, { forward: true })
	} catch {
		/* ignore */
	}
}

function createPerchWindow(avatar: string) {
	if (!deps) return
	perchWin = new BrowserWindow({
		width: PERCH_W,
		height: PERCH_H,
		frame: false,
		transparent: true,
		hasShadow: false,
		resizable: false,
		movable: true,
		skipTaskbar: true,
		backgroundColor: "#00000000",
		alwaysOnTop: true,
		webPreferences: {
			preload: deps.preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	try {
		perchWin.setAlwaysOnTop(true, "screen-saver")
	} catch {
		/* ignore */
	}
	// Start centered with feet on the dock.
	const sa = screen.getPrimaryDisplay().workArea
	const { dockTop } = dockEdge()
	perchWin.setBounds({
		x: sa.x + Math.round((sa.width - PERCH_W) / 2),
		y: dockTop - PERCH_H + PERCH_FEET_OFFSET,
		width: PERCH_W,
		height: PERCH_H,
	})

	const q = `perch=1&avatar=${encodeURIComponent(avatar)}`
	if (deps.rendererUrl) perchWin.loadURL(`${deps.rendererUrl}?${q}`)
	else if (deps.rendererFile) perchWin.loadFile(deps.rendererFile, { search: q })

	try {
		perchWin.setTitle("Hramble")
		// Fully interactive so the avatar is always draggable (click-through re-tuned later).
		perchWin.setIgnoreMouseEvents(false)
	} catch {
		/* ignore */
	}

	// Diagnostics — surface perch renderer logs/crashes in the main log.
	perchWin.webContents.on("console-message", (_e, _lvl, message) => {
		console.log(`[perch] ${message}`)
	})
	perchWin.webContents.on("render-process-gone", (_e, details) => {
		console.error("[perch] render process gone:", details.reason)
	})
	perchWin.webContents.on("unresponsive", () => console.error("[perch] renderer UNRESPONSIVE"))

	perchWin.on("closed", () => {
		perchWin = null
	})
}

function broadcastActive(active: boolean) {
	for (const w of BrowserWindow.getAllWindows()) {
		if (w === perchWin) continue
		try {
			w.webContents.send("perch:active", active)
		} catch {
			/* ignore */
		}
	}
}

function stopPerch() {
	if (tickTimer) clearInterval(tickTimer)
	if (hitTimer) clearInterval(hitTimer)
	tickTimer = null
	hitTimer = null
	hitRects = []
	snappedWin = null
	snapTime = 0
	sitMode = false
	if (perchWin && !perchWin.isDestroyed()) perchWin.close()
	perchWin = null
	broadcastActive(false)
}

export function registerPerch(d: NonNullable<typeof deps>) {
	deps = d

	ipcMain.handle("perch:check", () => ({ trusted: isTrusted(false) }))

	ipcMain.handle("perch:start", (_e, avatar = "flora", interactive = false) => {
		const trusted = isTrusted(false)
		console.log(`[perch] start requested — accessibility trusted=${trusted}, avatar=${avatar}`)
		if (process.platform === "darwin" && !trusted) {
			if (interactive) isTrusted(true) // opens System Settings > Accessibility
			console.log("[perch] BLOCKED — grant Electron in System Settings > Accessibility, then restart")
			return { ok: false, error: "accessibility-permission-required" }
		}
		if (perchWin && !perchWin.isDestroyed()) {
			perchWin.focus()
			return { ok: true, note: "already-running" }
		}
		try {
			createPerchWindow(String(avatar))
			tick()
			tickTimer = setInterval(tick, PERCH_POLL_MS)
			// Click-through hit-test disabled for now so the avatar is reliably draggable.
			// hitTimer = setInterval(hitTest, 60)
			void hitTest
			broadcastActive(true)
			console.log("[perch] window created")
			return { ok: true }
		} catch (e) {
			console.error("[perch] failed to create window:", e)
			return { ok: false, error: String(e) }
		}
	})

	ipcMain.handle("perch:stop", () => {
		stopPerch()
		return { ok: true }
	})

	ipcMain.on("perch:hitrects", (_e, rects) => {
		hitRects = Array.isArray(rects) ? rects : []
	})

	// Exact match to AvatarBox's perch:drag handler. No latching flag — the
	// dragging state is the lastWillMove timestamp only, so a missed "end" can
	// never freeze her (the 400ms window in tick() self-heals).
	ipcMain.on("perch:drag", (_e, action: string, dx?: number, dy?: number) => {
		if (!perchWin || perchWin.isDestroyed()) return
		if (action === "start") {
			sitMode = false // force STAND immediately
			snappedWin = null
			snapTime = 0
			lastWillMove = Date.now()
		} else if (action === "move") {
			const b = perchWin.getBounds()
			perchWin.setPosition(b.x + Math.round(dx || 0), b.y + Math.round(dy || 0))
			lastWillMove = Date.now()
			snapTime = 0 // reset the stand→sit countdown while carried
			sitMode = false
			snappedWin = null
		} else if (action === "end") {
			lastWillMove = 0
			snappedWin = null
			snapTime = 0 // fresh STAND on drop
			sitMode = false
			tick() // snap to the nearest edge NOW (no 400ms wait)
		}
	})
}
