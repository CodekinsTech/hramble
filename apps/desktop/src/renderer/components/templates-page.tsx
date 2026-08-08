/**
 * Templates page — pick what you're building. Each card is now a plain nav
 * tile to that agent's dedicated hub page (/agent/$agentId), which is where
 * the goal input + "Start session" step now lives (see agent-hub-page.tsx) —
 * this page's only job is picking the right specialist.
 */
import { useNavigate } from "@tanstack/react-router"
import catUrl from "../hramble-cat.png"
import { ACCENT_CAT_FILTERS, ACCENT_STYLES, AGENTS } from "../lib/agent-catalog"

export function TemplatesPage() {
	const navigate = useNavigate()

	return (
		<div className="flex h-full flex-col items-center overflow-y-auto p-8">
			<div className="w-full max-w-3xl">
				<h1 className="text-balance text-center font-semibold text-2xl text-foreground">What are you building?</h1>
				<p className="mt-1 text-center text-muted-foreground text-sm">
					Pick a starting point — Hramble sets up the right tools before you begin.
				</p>
				<div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
					{AGENTS.map((agent) => {
						const styles = ACCENT_STYLES[agent.accent]
						return (
							<button
								key={agent.id}
								type="button"
								onClick={() => navigate({ to: "/agent/$agentId", params: { agentId: agent.id } })}
								className={`flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors ${styles.border}`}
							>
								<div className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full ${styles.chip}`}>
									<img
										src={catUrl}
										alt=""
										className="size-7 object-contain"
										style={{ filter: ACCENT_CAT_FILTERS[agent.accent] }}
									/>
								</div>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground text-sm">{agent.title}</div>
									<div className="mt-0.5 text-muted-foreground text-xs">{agent.description}</div>
								</div>
							</button>
						)
					})}
				</div>
			</div>
		</div>
	)
}
