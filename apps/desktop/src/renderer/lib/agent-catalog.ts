/**
 * Single source of truth for the per-agent "hub" pages (/agent/$agentId) and
 * the Templates nav tiles that link to them. Keeping name/tagline/brief/color
 * here — instead of scattered across templates-page.tsx and agent-hub-page.tsx
 * — means renaming a codename or retuning a brief is a one-line edit.
 */
import {
	BracesIcon,
	DatabaseIcon,
	GamepadIcon,
	GlobeIcon,
	type LucideIcon,
	PuzzleIcon,
	SmartphoneIcon,
	TerminalIcon,
} from "lucide-react"

export interface QuickLink {
	name: string
	url: string
}

export interface EngineOption {
	id: string
	label: string
	/** Appended to the brief when this option is selected at Start — see agent-hub-page.tsx's start(). */
	briefNote: string
}

export interface Agent {
	id: string
	/** Nav tile title on /templates, e.g. "Website". */
	title: string
	/** Nav tile one-liner on /templates. */
	description: string
	icon: LucideIcon
	/** Accent key — see ACCENT_STYLES below for the literal Tailwind classes each one maps to. */
	accent: "chart-1" | "chart-2" | "chart-3" | "chart-5" | "teal" | "rose" | "slate"
	/** Codename shown at the top of the hub page. Website's is fixed per spec; others are placeholders — rename freely. */
	agentName: string
	tagline: string
	mode: "code" | "hyperloop"
	brief: string
	toolsNote: string
	placeholder: string
	/** Lowercase Community tag this agent's feed box filters by (see atoms/community.ts). Only Website/Browser Game have one for now. */
	communityTag?: string
	communityFeedLabel?: string
	/**
	 * A row of chips that open in the browser pane — reference sites for
	 * Website, reference games for Browser Game. Title/hint default to the
	 * Website copy (Inspect Design applies there); Browser Game overrides both
	 * since Inspect Design doesn't mean anything for a game's feel/gameplay.
	 */
	referenceSites?: QuickLink[]
	referenceSitesTitle?: string
	referenceSitesHint?: string
	/** Browser Game only: Kenney.nl / OpenGameArt.org-style free sprite/sound sources — same browser-pane mechanism as referenceSites. */
	assetLinks?: QuickLink[]
	/** Browser Game only: e.g. jsfxr — also opened in the browser pane so it's actually usable, not just a bookmark. */
	soundToolLink?: QuickLink
	/** Browser Game only: engine/library choice baked into the brief at Start — see agent-hub-page.tsx. */
	enginePicker?: EngineOption[]
	/** Defaults to true. Browser Game sets this false — Penpot doesn't fit game dev; see livePreviewNote instead. */
	showDesignStudio?: boolean
	/** Replaces the Design Studio slot with a static callout when set (Browser Game: emphasizes playtesting over a design tool). */
	livePreviewNote?: string
	/**
	 * IDs into the REAL MCP connector presets (apps/main/connectors.ts PRESETS) —
	 * not a separate list. agent-hub-page.tsx fetches the live preset/installed
	 * data via bridge().connectors.list() and filters to these ids, so "already
	 * connected" here can never drift out of sync with Settings → Connectors.
	 */
	connectorIds?: string[]
	/**
	 * Real, verified repos (checked via `gh api` before adding, never guessed)
	 * worth a look for this agent's kind of build — reference/study, not
	 * necessarily "clone this exact thing." Shown in a "Suggested Git Repo"
	 * section on the hub page; more get added over time.
	 */
	suggestedRepos?: { name: string; url: string; note: string }[]
}

export const AGENTS: Agent[] = [
	{
		id: "website",
		title: "Website",
		description: "Build a site — optionally match the look of a reference page you show it.",
		icon: GlobeIcon,
		accent: "chart-1",
		agentName: "Tron-K",
		tagline: "I'm Tron-K, specialized in web design.",
		mode: "code",
		brief:
			"You're building a website. If the user gives a reference site or asks to match a look, open it in the built-in browser and use the Inspect Design button (palette icon in the browser toolbar) to pick real colors/fonts/assets/CSS from that page — don't guess styles from memory.",
		toolsNote: "Tools: file read/write/edit, dev server, browser (open + Inspect Design on reference sites)",
		placeholder: "e.g. A landing page for a coffee shop, styled like stripe.com",
		communityTag: "website",
		communityFeedLabel: "See community website designs",
		referenceSitesTitle: "Reference sites",
		referenceSitesHint: "Open one in the browser pane, then use Inspect Design (palette icon) to pull its real colors/fonts.",
		referenceSites: [
			{ name: "Stripe", url: "https://stripe.com" },
			{ name: "Linear", url: "https://linear.app" },
			{ name: "Vercel", url: "https://vercel.com" },
			{ name: "Apple", url: "https://www.apple.com" },
			{ name: "Notion", url: "https://www.notion.com" },
			{ name: "Airbnb", url: "https://www.airbnb.com" },
		],
		connectorIds: ["figma", "stitch", "github", "supabase"],
		suggestedRepos: [
			{
				name: "1.5K Developer Portfolio Collection",
				url: "https://github.com/MalayBhunia/1.5K_Developer_Portfolio_Collection./",
				note: "1500+ real portfolio site examples to pick a look from",
			},
			{
				name: "Open React Template",
				url: "https://github.com/cruip/open-react-template",
				note: "Free Next.js/Tailwind landing page template",
			},
			{
				name: "shadcn/ui",
				url: "https://github.com/shadcn-ui/ui",
				note: "The component set most modern sites are built from",
			},
		],
	},
	{
		id: "browser-game",
		title: "Browser Game",
		description: "Build a playable game — decomposed, built in parallel, and checked before it's called done.",
		icon: GamepadIcon,
		accent: "chart-2",
		// Placeholder codename — rename freely, "Tron-K" was the only name the spec fixed.
		agentName: "Byte-V",
		tagline: "I'm Byte-V, specialized in browser games.",
		mode: "hyperloop",
		brief:
			"You're building a browser game. Prefer generating everything in code (shapes, textures, sounds) over external asset files, unless the user provides assets. Keep it playable in a single page — no build step required to try it.",
		toolsNote: "Tools: file read/write/edit, dev server · Hyperloop parallel build + verify/repair",
		placeholder: "e.g. A simple kart racer with 3 tracks and a lap timer",
		communityTag: "browser-game",
		communityFeedLabel: "See community game builds",
		referenceSitesTitle: "Reference games",
		referenceSitesHint: "Open one in the browser pane to see how it plays and feels.",
		// Keeps the small/simple examples (2048, Pac-Man clone) alongside a
		// couple of bigger, more ambitious ones — a 3D kart/stunt racer and a
		// 3D shooter — so this row doesn't undersell what's actually buildable
		// here. The racer matches this agent's own placeholder brief below
		// ("a simple kart racer with 3 tracks and a lap timer").
		referenceSites: [
			{ name: "2048", url: "https://play2048.co" },
			{ name: "Pac-Man clone", url: "https://freepacman.org" },
			{ name: "Celeste Classic (itch.io)", url: "https://mattmakesgames.itch.io/celesteclassic" },
			{ name: "Madalin Stunt Cars 2 (3D racing)", url: "https://www.crazygames.com/game/madalin-stunt-cars-2" },
			{ name: "Krunker.io (3D shooter)", url: "https://krunker.io" },
		],
		assetLinks: [
			{ name: "Kenney.nl (free sprites/sounds)", url: "https://kenney.nl/assets" },
			{ name: "OpenGameArt.org", url: "https://opengameart.org" },
		],
		soundToolLink: { name: "jsfxr (8-bit sound effect generator)", url: "https://sfxr.me" },
		enginePicker: [
			{
				id: "vanilla",
				label: "Vanilla Canvas",
				briefNote: "Engine: plain HTML5 Canvas, no framework/library dependency.",
			},
			{
				id: "phaser",
				label: "Phaser.js",
				briefNote: "Engine: Phaser.js (load via CDN or npm) for scene/sprite/physics management.",
			},
			{
				id: "kaplay",
				label: "Kaplay",
				briefNote: "Engine: Kaplay (formerly Kaboom.js) for a lightweight, code-first game loop.",
			},
			{
				id: "playcanvas",
				label: "PlayCanvas (3D)",
				briefNote: "Engine: PlayCanvas (npm install playcanvas) — WebGL/WebGPU 3D, entity-component API, for real 3D games like a racer or shooter.",
			},
		],
		showDesignStudio: false,
		livePreviewNote:
			"No build step — once the dev server's running, open the browser pane and actually play it as you go, not just read the code.",
		connectorIds: ["github", "playwright", "filesystem"],
		suggestedRepos: [
			{
				name: "Phaser",
				url: "https://github.com/phaserjs/phaser",
				note: "The Phaser.js engine option above — read its examples for real patterns",
			},
			{
				name: "Kaplay",
				url: "https://github.com/kaplayjs/kaplay",
				note: "The Kaplay engine option above — lightweight, code-first game loop",
			},
			{
				name: "PlayCanvas Engine",
				url: "https://github.com/playcanvas/engine",
				note: "The PlayCanvas engine option above — WebGL/WebGPU 3D for a racer, shooter, or anything real-3D",
			},
		],
	},
	{
		id: "backend",
		title: "Backend Manager",
		description: "Stand up servers, APIs, databases, and auth — production-shaped from the start.",
		icon: DatabaseIcon,
		accent: "chart-3",
		// Placeholder codename — rename freely.
		agentName: "Nex-B",
		tagline: "I'm Nex-B, specialized in backend systems.",
		mode: "code",
		brief:
			"You're building a backend: servers, REST/GraphQL APIs, databases, auth, and deployment config. Reach for the terminal to run migrations, start the dev server, and inspect the database directly rather than guessing at schema or endpoint behavior — verify against real responses, not assumptions.",
		toolsNote: "Tools: file read/write/edit, dev server, terminal/process management, database inspection",
		placeholder: "e.g. A REST API for a todo app with JWT auth and a Postgres database",
		connectorIds: ["supabase", "postgres", "cloudflare"],
		suggestedRepos: [
			{
				name: "Hono",
				url: "https://github.com/honojs/hono",
				note: "Fast, modern backend web framework — a solid base for a real API",
			},
			{
				name: "Drizzle ORM",
				url: "https://github.com/drizzle-team/drizzle-orm",
				note: "Type-safe SQL ORM for the database layer",
			},
			{
				name: "Openship",
				url: "https://github.com/oblien/openship",
				note: "Self-hostable deploy platform — build, ship, and TLS-route the backend from a repo",
			},
		],
	},
	{
		id: "mobile",
		title: "Mobile App",
		description: "Build a Capacitor/React Native app that actually runs on a device or emulator.",
		icon: SmartphoneIcon,
		accent: "chart-5",
		// Placeholder codename — rename freely.
		agentName: "Pix-M",
		tagline: "I'm Pix-M, specialized in mobile apps.",
		mode: "code",
		brief:
			"You're building a mobile app (Capacitor or React Native). Use the terminal for native build commands (e.g. `npx cap sync`, platform builds) and verify changes actually run on a simulator/emulator or device — don't assume a web build behaves the same natively.",
		toolsNote: "Tools: file read/write/edit, dev server, terminal (native build commands like `npx cap sync`)",
		placeholder: "e.g. A habit tracker app with local notifications, for iOS and Android",
		connectorIds: ["firebase", "supabase", "github"],
		suggestedRepos: [
			{
				name: "Capacitor",
				url: "https://github.com/ionic-team/capacitor",
				note: "Cross-platform native runtime — matches the Capacitor option above",
			},
			{
				name: "React Native",
				url: "https://github.com/react/react-native",
				note: "Build native apps with React — matches the React Native option above",
			},
		],
	},
	{
		id: "data-automation",
		title: "Data & Automation",
		description: "Scripts, scrapers, pipelines, and cron-style jobs that keep running unattended.",
		icon: BracesIcon,
		accent: "teal",
		// Placeholder codename — rename freely.
		agentName: "Flo-D",
		tagline: "I'm Flo-D, specialized in data & automation.",
		mode: "code",
		brief:
			"You're building a data or automation script: scrapers, CSV/file processing, pipelines, or scheduled jobs. Use the terminal to run and re-run the script against real input as you go — a pipeline that only works in theory isn't done.",
		toolsNote: "Tools: file read/write/edit, terminal",
		placeholder: "e.g. A script that scrapes daily prices from a site and appends them to a CSV",
		connectorIds: ["postgres", "filesystem", "web-search"],
		suggestedRepos: [
			{
				name: "n8n",
				url: "https://github.com/n8n-io/n8n",
				note: "Visual workflow automation, 400+ integrations",
			},
			{
				name: "n8n Workflows Collection",
				url: "https://github.com/Zie619/n8n-workflows",
				note: "4,343 real, ready-to-import n8n workflows across 365 integrations — searchable examples, not just the bare engine",
			},
			{
				name: "Scrapy",
				url: "https://github.com/scrapy/scrapy",
				note: "Python web crawling & scraping framework",
			},
		],
	},
	{
		id: "browser-extension",
		title: "Browser Extension",
		description: "Chrome/Firefox extensions — manifest, content scripts, and the unpacked-load loop.",
		icon: PuzzleIcon,
		accent: "rose",
		// Placeholder codename — rename freely.
		agentName: "Hex-E",
		tagline: "I'm Hex-E, specialized in browser extensions.",
		mode: "code",
		brief:
			"You're building a browser extension (Manifest V3). Use the built-in browser to load and test the unpacked extension as you iterate — don't just read the manifest and assume it works, actually load it and check the content script/popup behavior on a real page.",
		toolsNote: "Tools: file read/write/edit, browser (load/test unpacked extension), dev server if needed",
		placeholder: "e.g. A Chrome extension that highlights all links on a page",
		connectorIds: ["chrome-devtools", "playwright-chrome", "github"],
		suggestedRepos: [
			{
				name: "Plasmo",
				url: "https://github.com/PlasmoHQ/plasmo",
				note: "The standard modern browser extension framework",
			},
			{
				name: "Chrome Extension Boilerplate (React)",
				url: "https://github.com/lxieyang/chrome-extension-boilerplate-react",
				note: "React + Webpack boilerplate to start from",
			},
		],
	},
	{
		id: "cli-tools",
		title: "CLI & Dev Tools",
		description: "Command-line tools and npm packages, built and run from the terminal end to end.",
		icon: TerminalIcon,
		accent: "slate",
		// Placeholder codename — rename freely.
		agentName: "Cmd-X",
		tagline: "I'm Cmd-X, specialized in CLI tools.",
		mode: "code",
		brief:
			"You're building a CLI tool or npm package. Use the terminal constantly — run the command for real after every change instead of reading the code and assuming the output is right, and check `--help` output and exit codes as you go.",
		toolsNote: "Tools: file read/write/edit, terminal",
		placeholder: "e.g. A CLI that renames files in a folder based on a pattern",
		connectorIds: ["filesystem", "github", "sequential-thinking"],
		suggestedRepos: [
			{
				name: "Commander.js",
				url: "https://github.com/tj/commander.js",
				note: "The standard for building Node CLI interfaces",
			},
			{
				name: "oclif",
				url: "https://github.com/oclif/oclif",
				note: "Salesforce's framework for larger, multi-command CLIs",
			},
		],
	},
]

export function getAgent(id: string | undefined): Agent | undefined {
	return AGENTS.find((a) => a.id === id)
}

/**
 * Precomputed literal class strings per accent, keyed so every className
 * Tailwind needs to see is written out in full somewhere in this file —
 * `text-${accent}`-style interpolation at the call site would be invisible
 * to Tailwind's static scanner and silently emit no CSS. chart-1/2/3/5 are
 * this app's own theme tokens (globals.css); chart-4 (purple) is skipped and
 * teal/rose/slate are plain Tailwind swatches, same pattern community-page.tsx
 * already uses for its SKILL_PALETTE — kept non-purple per house style.
 */
export const ACCENT_STYLES: Record<
	Agent["accent"],
	{ icon: string; chip: string; border: string; solid: string; ring: string }
> = {
	"chart-1": {
		icon: "text-chart-1",
		chip: "bg-chart-1/10",
		border: "hover:border-chart-1/40",
		solid: "bg-chart-1 text-white hover:bg-chart-1/90",
		ring: "ring-chart-1/30",
	},
	"chart-2": {
		icon: "text-chart-2",
		chip: "bg-chart-2/10",
		border: "hover:border-chart-2/40",
		solid: "bg-chart-2 text-white hover:bg-chart-2/90",
		ring: "ring-chart-2/30",
	},
	"chart-3": {
		icon: "text-chart-3",
		chip: "bg-chart-3/10",
		border: "hover:border-chart-3/40",
		solid: "bg-chart-3 text-white hover:bg-chart-3/90",
		ring: "ring-chart-3/30",
	},
	"chart-5": {
		icon: "text-chart-5",
		chip: "bg-chart-5/10",
		border: "hover:border-chart-5/40",
		solid: "bg-chart-5 text-white hover:bg-chart-5/90",
		ring: "ring-chart-5/30",
	},
	teal: {
		icon: "text-teal-500",
		chip: "bg-teal-500/10",
		border: "hover:border-teal-500/40",
		solid: "bg-teal-500 text-white hover:bg-teal-500/90",
		ring: "ring-teal-500/30",
	},
	rose: {
		icon: "text-rose-500",
		chip: "bg-rose-500/10",
		border: "hover:border-rose-500/40",
		solid: "bg-rose-500 text-white hover:bg-rose-500/90",
		ring: "ring-rose-500/30",
	},
	slate: {
		icon: "text-slate-500",
		chip: "bg-slate-500/10",
		border: "hover:border-slate-500/40",
		solid: "bg-slate-500 text-white hover:bg-slate-500/90",
		ring: "ring-slate-500/30",
	},
}

/**
 * Per-accent hue-rotate + saturate filter to tint the shared mecha-cat badge
 * (hramble-cat.png) toward each agent's accent instead of every card showing
 * the same flat green. Degrees are computed, not eyeballed: sampled the PNG's
 * actual average opaque-pixel color at runtime (~hsl(128°, 27%, 42%)) and
 * solved `rotation = targetHue - 128` for each accent's real hex value (the
 * app's live --chart-N tokens, read via getComputedStyle — they differ from
 * globals.css's :root defaults because a named theme overrides them). A flat
 * "eyeballed" guess here previously turned the blue card purple and the
 * yellow card blue — hue-rotate is a true color-wheel rotation, not a tint,
 * so it has to start from the source's actual hue or the target hue is wrong.
 */
export const ACCENT_CAT_FILTERS: Record<Agent["accent"], string> = {
	"chart-1": "hue-rotate(83deg) saturate(2.5) brightness(1.15)", // blue #007AFF (target hue ~211°)
	"chart-2": "hue-rotate(16deg) saturate(1.3)", // green #04b84c (target hue ~144°, close to native ~128°)
	"chart-3": "hue-rotate(-108deg) saturate(2.5) brightness(1.05)", // orange #fb6a22 (target hue ~20°)
	"chart-5": "hue-rotate(-82deg) saturate(2.2) brightness(1.25)", // gold #ffc300 (target hue ~46°)
	teal: "hue-rotate(45deg) saturate(1.8) brightness(1.05)", // teal-500 #14b8a6 (target hue ~173°)
	rose: "hue-rotate(221deg) saturate(2.2) brightness(1.05)", // rose-500 #f43f5e (target hue ~350°)
	slate: "hue-rotate(87deg) saturate(0.4) brightness(0.95)", // slate-500 #64748b, deliberately desaturated
}
