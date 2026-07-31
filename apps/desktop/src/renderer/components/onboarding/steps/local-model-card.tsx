/**
 * Onboarding: local model (Ollama) option.
 *
 * The zero-cost, zero-signup path — the user runs a coding model on their own
 * machine, so there's no API key and no inference bill. Shown alongside the
 * hosted providers so people who want offline/free can start immediately.
 *
 * We recommend a MoE model (30B total / ~3B active): small dense models are
 * fast but unreliable at tool calling, which silently breaks the agent loop.
 */

import { Button } from "@hramble/ui/components/button"
import { CheckIcon, DownloadIcon, HardDriveIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

type OllamaStatus = {
	installed: boolean
	running: boolean
	models: { name: string; size: number }[]
	hasRecommended: boolean
	recommended: string
}

type PullProgress = { status?: string; percent?: number; done?: boolean; error?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble?.ollama

export function LocalModelCard() {
	const [status, setStatus] = useState<OllamaStatus | null>(null)
	const [checking, setChecking] = useState(true)
	const [pulling, setPulling] = useState(false)
	const [progress, setProgress] = useState<PullProgress>({})
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setChecking(true)
		try {
			setStatus(await bridge()?.status())
		} catch {
			setStatus(null)
		} finally {
			setChecking(false)
		}
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	useEffect(() => {
		return bridge()?.onPullProgress?.((p: PullProgress) => {
			if (p.error) {
				setError(p.error)
				setPulling(false)
				return
			}
			if (p.done) {
				setPulling(false)
				refresh()
				return
			}
			setProgress(p)
		})
	}, [refresh])

	const startPull = async () => {
		setError(null)
		setProgress({})
		setPulling(true)
		const res = await bridge()?.pull()
		if (res && !res.ok) {
			setError(res.error || "Download failed")
			setPulling(false)
		}
	}

	// Not an Electron build (or bridge missing) — hide entirely.
	if (!checking && status === null) return null

	const hasModels = status?.running && status.models.length > 0

	return (
		<div className="rounded-xl border border-border bg-background p-4 text-left">
			<div className="flex items-start gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
					<HardDriveIcon className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="font-medium text-sm">Run a model on this Mac</span>
						<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-[10px] text-emerald-600 uppercase tracking-wider dark:text-emerald-400">
							Free
						</span>
					</div>
					<p className="mt-0.5 text-muted-foreground text-xs">
						No account or API key. Works offline. Needs ~19&nbsp;GB disk and 16&nbsp;GB+ RAM.
					</p>

					<div className="mt-3">
						{checking ? (
							<span className="flex items-center gap-2 text-muted-foreground text-xs">
								<Loader2Icon className="size-3.5 animate-spin" /> Checking for Ollama…
							</span>
						) : hasModels ? (
							<div className="space-y-2">
								<span className="flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400">
									<CheckIcon className="size-3.5" />
									Ready — {status?.models.length} model
									{(status?.models.length ?? 0) > 1 ? "s" : ""} installed
								</span>
								<div className="flex flex-wrap gap-1.5">
									{status?.models.slice(0, 5).map((m) => (
										<span key={m.name} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
											{m.name}
										</span>
									))}
								</div>
							</div>
						) : pulling ? (
							<div>
								<span className="flex items-center gap-2 text-xs">
									<Loader2Icon className="size-3.5 animate-spin" />
									{progress.status || "Starting…"}
									{progress.percent != null && ` — ${progress.percent}%`}
								</span>
								<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-primary transition-all"
										style={{ width: `${progress.percent ?? 0}%` }}
									/>
								</div>
								<p className="mt-1.5 text-[11px] text-muted-foreground">
									~19&nbsp;GB — this takes a while, and you can keep using the app.
								</p>
							</div>
						) : !status?.installed ? (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-muted-foreground text-xs">
									Ollama isn't installed — it's the free runtime that runs the model.
								</span>
								<Button size="sm" variant="outline" onClick={() => bridge()?.openDownload()}>
									Get Ollama
								</Button>
								<Button size="sm" variant="ghost" onClick={refresh}>
									<RefreshCwIcon className="size-3.5" />
								</Button>
							</div>
						) : !status.running ? (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-muted-foreground text-xs">
									Ollama is installed but not running. Start it, then re-check.
								</span>
								<Button size="sm" variant="outline" onClick={refresh}>
									<RefreshCwIcon className="mr-1 size-3.5" /> Re-check
								</Button>
							</div>
						) : (
							<Button size="sm" onClick={startPull}>
								<DownloadIcon className="mr-1.5 size-3.5" />
								Download {status.recommended}
							</Button>
						)}
					</div>

					{error && <p className="mt-2 text-destructive text-xs">{error}</p>}
				</div>
			</div>
		</div>
	)
}
