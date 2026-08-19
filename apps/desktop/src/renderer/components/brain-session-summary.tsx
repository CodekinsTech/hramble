import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { type BrainContribution, brainContributionFamily } from "../atoms/brain-contribution"

const BRAND_BLUE = "#5B8FFF"
const MAX_CHIPS = 5

/** A single blue puzzle piece, filled brand blue. Docked = the Brain, shrunk. */
function PuzzleBadge({ size = 46 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M10.5 3a1.5 1.5 0 0 1 3 0c0 .3-.1.6-.2.9-.15.4.05.85.5.85H16a1 1 0 0 1 1 1v1.8c0 .45.45.65.85.5.3-.1.6-.2.9-.2a1.5 1.5 0 0 1 0 3c-.3 0-.6-.1-.9-.2-.4-.15-.85.05-.85.5V16a1 1 0 0 1-1 1h-2.2c-.45 0-.65.45-.5.85.1.3.2.6.2.9a1.5 1.5 0 0 1-3 0c0-.3.1-.6.2-.9.15-.4-.05-.85-.5-.85H8a1 1 0 0 1-1-1v-2.2c0-.45-.45-.65-.85-.5-.3.1-.6.2-.9.2a1.5 1.5 0 0 1 0-3c.3 0 .6.1.9.2.4.15.85-.05.85-.5V6a1 1 0 0 1 1-1h1.8c.45 0 .65-.45.5-.85-.1-.3-.2-.6-.2-.9Z"
				fill={BRAND_BLUE}
			/>
		</svg>
	)
}

/** Human label for a contribution kind. */
function kindLabel(kind: BrainContribution["kind"]): string {
	switch (kind) {
		case "repo":
			return "repo"
		case "docs":
			return "docs"
		case "tool":
			return "tool"
		case "model":
			return "model"
		case "connector":
			return "connector"
		case "episode":
			return "past job"
		default:
			return "skill"
	}
}

/** A white pill chip: blue dot + "<kind> · <label>", tiny ✓ for past jobs. */
function ContributionChip({ item }: { item: BrainContribution }) {
	return (
		<span
			className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium text-[#1f2430]"
			style={{ borderColor: "#cdddff" }}
			title={item.detail ? `${kindLabel(item.kind)} · ${item.label} — ${item.detail}` : item.label}
		>
			{item.kind === "episode" ? (
				<span className="text-[10px] font-bold" style={{ color: BRAND_BLUE }}>
					✓
				</span>
			) : (
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{ backgroundColor: BRAND_BLUE }}
					aria-hidden="true"
				/>
			)}
			<span className="truncate">
				<span className="text-[#6b7280]">{kindLabel(item.kind)}</span>
				<span className="text-[#6b7280]"> · </span>
				<span>{item.label}</span>
			</span>
		</span>
	)
}

/**
 * Brain, docked into an active chat: shrunk to a blue puzzle badge with a
 * summary of what it actually contributed (auto-recalled skills/tools + a
 * similar past job). Reads the per-session `brainContributionFamily` atom that
 * use-server.ts fills on the first message. Empty → a slim "aware of your whole
 * library" line. Clicking the badge expands the full Brain page.
 */
export function BrainSessionSummary({ sessionId }: { sessionId: string }) {
	const navigate = useNavigate()
	const contributions = useAtomValue(brainContributionFamily(sessionId))
	const items = Array.isArray(contributions) ? contributions : []

	// The empty "aware of your library" line is just reassurance — auto-collapse it
	// after a few seconds so it doesn't sit atop the chat forever. Real contribution
	// chips always stay. Resets per session and whenever contributions arrive.
	const [emptyHidden, setEmptyHidden] = useState(false)
	useEffect(() => {
		setEmptyHidden(false)
		if (items.length > 0) return
		const t = setTimeout(() => setEmptyHidden(true), 6000)
		return () => clearTimeout(t)
	}, [items.length, sessionId])

	const openBrain = () => {
		void navigate({ to: "/brain" })
	}

	// Empty state — no per-task items, but the Brain is still docked & aware.
	if (items.length === 0) {
		return (
			<div
				className={`flex items-center gap-2.5 overflow-hidden border-[#e3e7ee] bg-white transition-all duration-500 ${
					emptyHidden
						? "max-h-0 border-b-0 px-4 py-0 opacity-0"
						: "max-h-16 border-b px-4 py-2 opacity-100"
				}`}
			>
				<button
					type="button"
					onClick={openBrain}
					className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-80"
					aria-label="Expand Brain"
				>
					<PuzzleBadge size={28} />
				</button>
				<button
					type="button"
					onClick={openBrain}
					className="text-left text-xs text-[#6b7280] transition-colors hover:text-[#1f2430]"
				>
					Brain is aware of your whole library
				</button>
			</div>
		)
	}

	const shown = items.slice(0, MAX_CHIPS)
	const overflow = items.length - shown.length

	return (
		<div className="flex items-start gap-3 border-b border-[#e3e7ee] bg-white px-4 py-2.5">
			{/* Docked Brain — puzzle badge + label, click to expand */}
			<button
				type="button"
				onClick={openBrain}
				className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-1 pt-0.5 transition-opacity hover:opacity-80"
				aria-label="Expand Brain"
			>
				<PuzzleBadge size={46} />
				<span className="text-[11px] font-semibold leading-none text-[#1f2430]">Brain</span>
				<span className="text-[9px] leading-none text-[#9aa3b2]">tap to expand</span>
			</button>

			{/* What the Brain added to this chat */}
			<div
				className="min-w-0 flex-1 rounded-lg border px-3 py-2"
				style={{ backgroundColor: "#f2f6ff", borderColor: "#cdddff" }}
			>
				<div className="mb-1.5 text-[11px] font-semibold" style={{ color: BRAND_BLUE }}>
					Brain added to this chat
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{shown.map((item, i) => (
						<ContributionChip key={`${item.kind}-${item.label}-${i}`} item={item} />
					))}
					{overflow > 0 && (
						<span className="text-[11px] font-medium text-[#6b7280]">+{overflow} more</span>
					)}
				</div>
			</div>
		</div>
	)
}
