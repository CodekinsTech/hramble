import { Button } from "@hramble/ui/components/button"
import { Input } from "@hramble/ui/components/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@hramble/ui/components/select"
import { Switch } from "@hramble/ui/components/switch"
import { useAtomValue, useSetAtom } from "jotai"
import { CheckIcon, CopyIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import QRCode from "qrcode"
import { useCallback, useEffect, useState } from "react"
import { browserAutoOpenAtom } from "../../atoms/browser"
import { communityAccessTokenAtom } from "../../atoms/community"
import { dispatchPairTokenAtom, dispatchSessionRefAtom } from "../../atoms/dispatch"
import { type DisplayMode, displayModeAtom, opaqueWindowsAtom } from "../../atoms/preferences"
import { useSettings } from "../../hooks/use-settings"
import { useColorScheme, useSetColorScheme } from "../../hooks/use-theme"
import { shareUrlForRoom } from "../../lib/share-client"
import type { ColorScheme } from "../../lib/themes"
import { fetchOpenInTargets, revealChromeExtension, setOpenInPreferred } from "../../services/backend"
import { SettingsRow } from "./settings-row"
import { SettingsSection } from "./settings-section"

const isElectron = typeof window !== "undefined" && "hramble" in window

export function GeneralSettings() {
	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">General</h2>
			</div>

			<SettingsSection>
				<OpenDestinationRow />
			</SettingsSection>

			<SettingsSection title="Appearance">
				<ThemeRow />
				<OpaqueWindowsRow />
				<DisplayModeRow />
			</SettingsSection>

			<SettingsSection title="Brain">
				<BrainCatalogRow />
				<BrainAutoRecallRow />
				<BrainEpisodicMemoryRow />
			</SettingsSection>

			<SettingsSection title="Browser">
				<BrowserAutoOpenRow />
				<ChromeConsoleAccessRow />
			</SettingsSection>

			<SettingsSection title="Dispatch">
				<DispatchPairingRow />
			</SettingsSection>
		</div>
	)
}

function DispatchPairingRow() {
	const accessToken = useAtomValue(communityAccessTokenAtom)
	const pairToken = useAtomValue(dispatchPairTokenAtom)
	const setPairToken = useSetAtom(dispatchPairTokenAtom)
	const setSessionRef = useSetAtom(dispatchSessionRefAtom)
	const [copied, setCopied] = useState(false)
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

	const shareUrl = pairToken ? shareUrlForRoom(pairToken) : null

	useEffect(() => {
		if (!shareUrl) {
			setQrDataUrl(null)
			return
		}
		let cancelled = false
		QRCode.toDataURL(shareUrl, { width: 160, margin: 1 })
			.then((url) => {
				if (!cancelled) setQrDataUrl(url)
			})
			.catch(() => {
				if (!cancelled) setQrDataUrl(null)
			})
		return () => {
			cancelled = true
		}
	}, [shareUrl])

	const pair = () => setPairToken(crypto.randomUUID())
	const unpair = () => {
		setPairToken(null)
		setSessionRef(null)
	}
	const copyLink = () => {
		if (!shareUrl) return
		navigator.clipboard.writeText(shareUrl)
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}

	if (!accessToken) {
		return (
			<SettingsRow
				label="Pair your phone"
				description="Send tasks to Hramble from your phone and pick up right where you left off. Sign in first (Settings → Account) to pair."
			>
				<span className="text-muted-foreground text-xs">Sign in required</span>
			</SettingsRow>
		)
	}

	return (
		<SettingsRow
			label="Pair your phone"
			description="Hramble will act on your desktop (files, browser) to complete tasks you send from your phone. Only pair a device you own and trust."
		>
			<div className="flex flex-col items-end gap-1.5">
				{pairToken ? (
					<>
						{qrDataUrl && (
							<img
								src={qrDataUrl}
								alt="Scan with your phone's camera to pair"
								className="size-28 rounded-md border border-border"
							/>
						)}
						<p className="max-w-[220px] text-right text-[11px] text-muted-foreground">
							Scan with your phone's camera, or use the link below.
						</p>
						<div className="flex items-center gap-2">
							<Input readOnly value={shareUrl ?? ""} className="w-56 text-xs" onFocus={(e) => e.target.select()} />
							<Button size="sm" variant="outline" onClick={copyLink}>
								{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
							</Button>
						</div>
						<button type="button" onClick={unpair} className="text-[11px] text-muted-foreground hover:text-foreground">
							Unpair
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={pair}
						className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:opacity-90"
					>
						Pair your phone
					</button>
				)}
			</div>
		</SettingsRow>
	)
}

const EXTENSION_STATUS_URL = "http://127.0.0.1:47821/status"

function ChromeConsoleAccessRow() {
	const [connectedTabs, setConnectedTabs] = useState<number | null>(null)

	useEffect(() => {
		let cancelled = false
		const check = () => {
			fetch(EXTENSION_STATUS_URL)
				.then((r) => (r.ok ? r.json() : Promise.reject()))
				.then((data: { connectedTabs?: number }) => {
					if (!cancelled) setConnectedTabs(data.connectedTabs ?? 0)
				})
				.catch(() => {
					if (!cancelled) setConnectedTabs(0)
				})
		}
		check()
		const id = setInterval(check, 5000)
		return () => {
			cancelled = true
			clearInterval(id)
		}
	}, [])

	const connected = (connectedTabs ?? 0) > 0

	return (
		<SettingsRow
			label="Chrome Console Access"
			description="Lets Hramble read a real Chrome tab's console automatically — so it can find and fix errors itself instead of asking you to open DevTools. Requires installing a small Hramble extension (one-time)."
		>
			<div className="flex flex-col items-end gap-1.5">
				<div className="flex items-center gap-1.5 text-xs">
					<span
						className={`size-1.5 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground/40"}`}
					/>
					<span className="text-muted-foreground">
						{connectedTabs === null
							? "Checking…"
							: connected
								? `Connected — ${connectedTabs} tab${connectedTabs === 1 ? "" : "s"}`
								: "Not connected yet"}
					</span>
				</div>
				<button
					type="button"
					onClick={() => revealChromeExtension()}
					className="rounded-md border border-border px-2.5 py-1.5 font-medium text-xs hover:bg-muted"
				>
					Reveal extension files
				</button>
				<p className="max-w-[220px] text-right text-[11px] text-muted-foreground">
					In Chrome: open <span className="font-mono">chrome://extensions</span>, turn on Developer
					mode, then "Load unpacked" and pick the revealed folder.
				</p>
			</div>
		</SettingsRow>
	)
}

function BrainCatalogRow() {
	const { settings, updateSettings } = useSettings()
	// Default ON when the setting hasn't loaded/persisted yet.
	const enabled = settings.brainCatalogInSessions !== false

	return (
		<SettingsRow
			label="Let the Brain know its whole inventory"
			description="Inject a compact menu of everything saved in your Brain (skills, repos, docs, tools, models, connectors) into every session, so the agent always knows what it has. Only names + one-line descriptions are shared — the full item still loads on demand."
		>
			<Switch
				checked={enabled}
				onCheckedChange={(checked) => updateSettings({ brainCatalogInSessions: checked })}
			/>
		</SettingsRow>
	)
}

function BrainAutoRecallRow() {
	const { settings, updateSettings } = useSettings()
	// Default ON when the setting hasn't loaded/persisted yet.
	const enabled = settings.brainAutoRecall !== false

	return (
		<SettingsRow
			label="Auto-suggest relevant Brain items for each task"
			description="For each new task, automatically find the few saved Brain items most relevant to what you asked and point the agent at them — so it uses the right skill or tool without being told. Only a short list of names is surfaced; matching is fully local."
		>
			<Switch
				checked={enabled}
				onCheckedChange={(checked) => updateSettings({ brainAutoRecall: checked })}
			/>
		</SettingsRow>
	)
}

function BrainEpisodicMemoryRow() {
	const { settings, updateSettings } = useSettings()
	// Default ON when the setting hasn't loaded/persisted yet.
	const enabled = settings.brainEpisodicMemory !== false

	return (
		<SettingsRow
			label="Remember past jobs and reuse what worked"
			description="Record each finished task as a short episode (what it was, whether it worked, what helped) and, when a new task looks like a past one, quietly remind the agent — so it reuses what worked and avoids past mistakes. Fully local; only a one-line pointer is surfaced."
		>
			<Switch
				checked={enabled}
				onCheckedChange={(checked) => updateSettings({ brainEpisodicMemory: checked })}
			/>
		</SettingsRow>
	)
}

function BrowserAutoOpenRow() {
	const autoOpen = useAtomValue(browserAutoOpenAtom)
	const setAutoOpen = useSetAtom(browserAutoOpenAtom)

	return (
		<SettingsRow
			label="Auto-open browser panel"
			description="Pop the browser panel open when the agent uses it. Turn off to keep it closed until you open it with the globe button."
		>
			<Switch checked={autoOpen} onCheckedChange={setAutoOpen} />
		</SettingsRow>
	)
}

function OpenDestinationRow() {
	const [targets, setTargets] = useState<{ id: string; label: string; available: boolean }[]>([])
	const [preferred, setPreferred] = useState<string | null>(null)

	useEffect(() => {
		if (!isElectron) return
		fetchOpenInTargets().then((result) => {
			setTargets(result.targets.filter((t) => t.available))
			setPreferred(result.preferredTarget)
		})
	}, [])

	const handleChange = useCallback(async (value: string) => {
		setPreferred(value)
		await setOpenInPreferred(value)
	}, [])

	if (targets.length === 0) return null

	return (
		<SettingsRow
			label="Default open destination"
			description="Where files and folders open by default"
		>
			<Select
				value={preferred ?? undefined}
				onValueChange={(v) => {
					if (v !== null) handleChange(v)
				}}
			>
				<SelectTrigger className="min-w-[180px]">
					<SelectValue placeholder="Select..." />
				</SelectTrigger>
				<SelectContent>
					{targets.map((t) => (
						<SelectItem key={t.id} value={t.id}>
							{t.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingsRow>
	)
}

function ThemeRow() {
	const colorScheme = useColorScheme()
	const setColorScheme = useSetColorScheme()

	const options: { value: ColorScheme; label: string; icon: typeof SunIcon }[] = [
		{ value: "light", label: "Light", icon: SunIcon },
		{ value: "dark", label: "Dark", icon: MoonIcon },
		{ value: "system", label: "System", icon: MonitorIcon },
	]

	return (
		<SettingsRow label="Theme" description="Use light, dark, or match your system">
			<div className="flex items-center rounded-md border border-border">
				{options.map((opt) => {
					const Icon = opt.icon
					const isActive = colorScheme === opt.value
					return (
						<button
							key={opt.value}
							type="button"
							onClick={() => setColorScheme(opt.value)}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors first:rounded-l-md last:rounded-r-md ${
								isActive
									? "bg-accent text-accent-foreground font-medium"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<Icon aria-hidden="true" className="size-3.5" />
							{opt.label}
						</button>
					)
				})}
			</div>
		</SettingsRow>
	)
}

function OpaqueWindowsRow() {
	const opaque = useAtomValue(opaqueWindowsAtom)
	const setOpaque = useSetAtom(opaqueWindowsAtom)

	const handleChange = useCallback(
		async (checked: boolean) => {
			setOpaque(checked)
			if (isElectron) {
				await window.hramble.setOpaqueWindows(checked)
				// Requires relaunch -- prompt or auto-relaunch
				window.hramble.relaunch()
			}
		},
		[setOpaque],
	)

	return (
		<SettingsRow
			label="Use opaque background"
			description="Make windows use a solid background rather than system translucency"
		>
			<Switch checked={opaque} onCheckedChange={handleChange} />
		</SettingsRow>
	)
}

function DisplayModeRow() {
	const displayMode = useAtomValue(displayModeAtom)
	const setDisplayMode = useSetAtom(displayModeAtom)

	return (
		<SettingsRow
			label="Display mode"
			description="Adjust how much detail is shown in conversations"
		>
			<Select
				value={displayMode}
				onValueChange={(v) => setDisplayMode(v as DisplayMode)}
				items={{ default: "Default", verbose: "Verbose" }}
			>
				<SelectTrigger className="min-w-[140px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">Default</SelectItem>
					<SelectItem value="verbose">Verbose</SelectItem>
				</SelectContent>
			</Select>
		</SettingsRow>
	)
}
