/**
 * Fixed, hand-laid-out vertical node graph for the Website and Browser Game
 * hub pages (see agent-hub-page.tsx) — replaces their old stack-of-cards
 * layout with a spine + colored dots so the build path reads top-to-bottom.
 * Deliberately NOT an auto-layout/force-directed graph (see graph-view.tsx's
 * layered-by-depth approach for why this app avoids hairballs) — node order
 * and count are fixed per page, laid out by hand in agent-hub-page.tsx.
 */
import type { ReactNode } from "react"

export type GraphNodeKind = "required" | "optional" | "final"

const DOT_STYLES: Record<GraphNodeKind, string> = {
	required: "border-chart-2 bg-chart-2/10 text-chart-2",
	optional: "border-chart-1 bg-chart-1/10 text-chart-1",
	final: "border-foreground bg-foreground text-background",
}

const TAG_STYLES: Record<GraphNodeKind, string> = {
	required: "bg-chart-2/10 text-chart-2",
	optional: "bg-chart-1/10 text-chart-1",
	final: "bg-foreground/10 text-foreground",
}

/** Vertical connecting line — spans from the first dot's center to the last dot's center (22px = half the 44px dot). */
export function GraphSpine() {
	return <div aria-hidden className="absolute top-[22px] bottom-[22px] left-[21px] w-0.5 bg-border" />
}

export function GraphNode({
	kind,
	icon,
	title,
	tag,
	isLast,
	children,
}: {
	kind: GraphNodeKind
	icon: ReactNode
	title: string
	tag?: string
	isLast?: boolean
	children?: ReactNode
}) {
	return (
		<div className={`relative flex gap-4 ${isLast ? "" : "pb-6"}`}>
			<div
				className={`z-10 flex size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] ${DOT_STYLES[kind]}`}
			>
				{icon}
			</div>
			<div className="min-w-0 flex-1 rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold text-foreground text-sm">{title}</h2>
					{tag && (
						<span
							className={`rounded-full px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide ${TAG_STYLES[kind]}`}
						>
							{tag}
						</span>
					)}
				</div>
				{children}
			</div>
		</div>
	)
}

/** Two side-by-side sub-options inside a single node (e.g. template vs. Design Studio) — see mockup's `.fork`. */
export function GraphFork({ children }: { children: ReactNode }) {
	return <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
}

export function GraphForkOption({
	title,
	description,
	onClick,
}: {
	title: string
	description: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="rounded-lg border border-border border-dashed p-3 text-left transition-colors hover:border-foreground/30"
		>
			<div className="font-semibold text-foreground text-xs">{title}</div>
			<div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div>
		</button>
	)
}
