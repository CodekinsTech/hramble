import { CheckIcon, PlugIcon, PlusIcon, RefreshCwIcon, TrashIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

// Connectors = MCP servers (integrations like GitHub, browser, Postgres…). This
// panel manages the OpenCode config's `mcp` block from the UI — no JSON editing.
// Changes apply after an OpenCode restart (button provided).

type Installed = { name: string; command: string[]; url?: string; enabled: boolean }
type Preset = { id: string; name: string; command: string[]; note: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).palot

export function ConnectorsSettings() {
	const [installed, setInstalled] = useState<Installed[]>([])
	const [presets, setPresets] = useState<Preset[]>([])
	const [dirty, setDirty] = useState(false)
	const [restarting, setRestarting] = useState(false)
	const [customName, setCustomName] = useState("")
	const [customCmd, setCustomCmd] = useState("")

	const load = useCallback(async () => {
		try {
			const r = await bridge()?.connectors?.list()
			setInstalled(r?.installed ?? [])
			setPresets(r?.presets ?? [])
		} catch {
			/* ignore */
		}
	}, [])

	useEffect(() => {
		load()
	}, [load])

	const installedNames = new Set(installed.map((i) => i.name))

	const addPreset = async (p: Preset) => {
		await bridge()?.connectors?.add({ name: p.id, command: p.command })
		setDirty(true)
		load()
	}
	const addCustom = async () => {
		const name = customName.trim()
		const cmd = customCmd.trim().split(/\s+/).filter(Boolean)
		if (!name || cmd.length === 0) return
		await bridge()?.connectors?.add({ name, command: cmd })
		setCustomName("")
		setCustomCmd("")
		setDirty(true)
		load()
	}
	const remove = async (name: string) => {
		await bridge()?.connectors?.remove(name)
		setDirty(true)
		load()
	}
	const toggle = async (name: string, enabled: boolean) => {
		await bridge()?.connectors?.toggle(name, enabled)
		setDirty(true)
		load()
	}
	const restart = async () => {
		setRestarting(true)
		try {
			await bridge()?.restartOpenCode?.()
			setDirty(false)
		} finally {
			setRestarting(false)
		}
	}

	return (
		<div className="space-y-6">
			<div>
				<h2 className="font-semibold text-xl">Connectors</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Add integrations (MCP servers) — GitHub, a browser, databases, and more. Same mechanism
					Claude uses.
				</p>
			</div>

			{dirty && (
				<div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
					<span className="text-amber-700 text-sm dark:text-amber-400">
						Restart OpenCode to apply your changes.
					</span>
					<button
						type="button"
						onClick={restart}
						disabled={restarting}
						className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white text-xs hover:opacity-90"
					>
						<RefreshCwIcon className={`size-3.5 ${restarting ? "animate-spin" : ""}`} />
						{restarting ? "Restarting…" : "Restart now"}
					</button>
				</div>
			)}

			{/* Installed */}
			<div>
				<h3 className="mb-2 font-medium text-sm">Installed</h3>
				{installed.length === 0 ? (
					<p className="text-muted-foreground text-sm">None yet — add one below.</p>
				) : (
					<div className="divide-y divide-border rounded-lg border border-border">
						{installed.map((c) => (
							<div key={c.name} className="flex items-center gap-3 px-4 py-3">
								<PlugIcon className="size-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<div className="font-medium text-sm">{c.name}</div>
									<div className="truncate text-muted-foreground text-xs">
										{c.command.join(" ") || c.url}
									</div>
								</div>
								<button
									type="button"
									onClick={() => toggle(c.name, !c.enabled)}
									className={`rounded-md px-2 py-1 font-medium text-xs ${c.enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
								>
									{c.enabled ? "On" : "Off"}
								</button>
								<button
									type="button"
									onClick={() => remove(c.name)}
									className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
									title="Remove"
								>
									<TrashIcon className="size-3.5" />
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* One-click presets */}
			<div>
				<h3 className="mb-2 font-medium text-sm">Add a connector</h3>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{presets.map((p) => {
						const added = installedNames.has(p.id)
						return (
							<button
								key={p.id}
								type="button"
								disabled={added}
								onClick={() => addPreset(p)}
								className="flex items-start gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
							>
								<div className="mt-0.5 shrink-0 text-muted-foreground">
									{added ? (
										<CheckIcon className="size-4 text-emerald-500" />
									) : (
										<PlusIcon className="size-4" />
									)}
								</div>
								<div className="min-w-0">
									<div className="font-medium text-sm">{p.name}</div>
									<div className="text-muted-foreground text-xs">{p.note}</div>
								</div>
							</button>
						)
					})}
				</div>
			</div>

			{/* Custom */}
			<div>
				<h3 className="mb-2 font-medium text-sm">Custom (advanced)</h3>
				<div className="flex flex-col gap-2 sm:flex-row">
					<input
						value={customName}
						onChange={(e) => setCustomName(e.target.value)}
						placeholder="name"
						className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-40"
					/>
					<input
						value={customCmd}
						onChange={(e) => setCustomCmd(e.target.value)}
						placeholder="npx -y some-mcp-server"
						className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					/>
					<button
						type="button"
						onClick={addCustom}
						className="h-9 rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm hover:opacity-90"
					>
						Add
					</button>
				</div>
			</div>

			<p className="text-muted-foreground text-xs">
				Skills and plugins are discovered automatically by OpenCode — type <code>/</code> in the
				chat to use a skill.
			</p>
		</div>
	)
}
