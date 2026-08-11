/**
 * Real brand marks for the "Connect your tools" cards (agent-hub-page.tsx) —
 * sourced from `simple-icons` (CC0-licensed, official path+color data) rather
 * than hand-drawn, since a mis-remembered logo would look worse than none.
 * IDs match apps/main/connectors.ts PRESETS ids. Categories with no single
 * real-world brand (filesystem, sequential-thinking, generic "Browser
 * (built-in)") fall back to a plain lucide icon — not a fabricated logo.
 */
import { siCloudflare, siDuckduckgo, siFigma, siFirebase, siGithub, siGooglechrome, siPostgresql, siSupabase } from "simple-icons"
import { BrainIcon, FolderIcon, MousePointerClickIcon, PaletteIcon, PlugIcon } from "lucide-react"

type BrandIcon = { title: string; hex: string; path: string }

const BRAND_ICONS: Record<string, BrandIcon> = {
	figma: siFigma,
	github: siGithub,
	supabase: siSupabase,
	cloudflare: siCloudflare,
	postgres: siPostgresql,
	firebase: siFirebase,
	"playwright-chrome": siGooglechrome,
	"chrome-devtools": siGooglechrome,
	"web-search": siDuckduckgo,
}

// GitHub's mark is near-black — always shown on a fixed light chip (the
// conventional "black octocat on white" treatment) so it stays legible
// regardless of the app's own light/dark theme, instead of tinting with its
// own near-black hex (which would just look like a dark smudge in dark mode).
const FIXED_LIGHT_CHIP = new Set(["github"])

const FALLBACK_ICONS: Record<string, { icon: typeof PlugIcon; hex: string }> = {
	filesystem: { icon: FolderIcon, hex: "#8b8b8b" },
	playwright: { icon: MousePointerClickIcon, hex: "#2d9c3f" },
	"sequential-thinking": { icon: BrainIcon, hex: "#8b5cf6" },
	// No official Stitch mark in simple-icons yet — Google blue, not a fabricated logo.
	stitch: { icon: PaletteIcon, hex: "#4285F4" },
}

/** Small colored chip (brand tint background + real mark) for a connector preset id. */
export function ConnectorIcon({ id, className }: { id: string; className?: string }) {
	const brand = BRAND_ICONS[id]
	if (brand) {
		const fixedLight = FIXED_LIGHT_CHIP.has(id)
		return (
			<div
				className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${fixedLight ? "border border-black/10 bg-white" : ""} ${className ?? ""}`}
				style={fixedLight ? undefined : { backgroundColor: `${brand.hex}1f` }}
			>
				<svg viewBox="0 0 24 24" className="size-[18px]" fill={`#${brand.hex}`} aria-hidden>
					<path d={brand.path} />
				</svg>
			</div>
		)
	}
	const fallback = FALLBACK_ICONS[id]
	const Icon = fallback?.icon ?? PlugIcon
	const hex = fallback?.hex ?? "#8b8b8b"
	return (
		<div
			className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${className ?? ""}`}
			style={{ backgroundColor: `${hex}1f` }}
		>
			<Icon className="size-[18px]" style={{ color: hex }} />
		</div>
	)
}
