// Hramble notify — send a desktop notification to the user. Uses the OS's native
// notifier via a shell command (no cloud): osascript on macOS, notify-send on Linux,
// PowerShell toast on Windows. Args are passed to execFile directly (no shell
// interpolation) so the message can't break the command.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { execFileSync } from "node:child_process"

export default async () => ({
	tool: {
		notify: tool({
			description:
				"Send a desktop notification to the user. Use to get their attention when something finishes or needs input while they're away from the window — a long task completed, a background job hit a decision, a monitor fired. Keep it short.",
			args: {
				message: z.string().describe("The notification body (keep it short)"),
				title: z.string().optional().describe("Optional title (default: Hramble)"),
			},
			execute: async (args) => {
				const title = args.title ?? "Hramble"
				try {
					if (process.platform === "darwin") {
						const script = `display notification ${JSON.stringify(args.message)} with title ${JSON.stringify(title)}`
						execFileSync("osascript", ["-e", script], { timeout: 8000 })
					} else if (process.platform === "linux") {
						execFileSync("notify-send", [title, args.message], { timeout: 8000 })
					} else if (process.platform === "win32") {
						const ps = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms');$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;$n.BalloonTipTitle=${JSON.stringify(title)};$n.BalloonTipText=${JSON.stringify(args.message)};$n.Visible=$true;$n.ShowBalloonTip(6000)`
						execFileSync("powershell", ["-NoProfile", "-Command", ps], { timeout: 8000 })
					} else {
						return "Desktop notifications aren't supported on this platform."
					}
					return "Notification sent."
				} catch (e) {
					return `Could not send the notification: ${String(e).slice(0, 120)}`
				}
			},
		}),
	},
})
