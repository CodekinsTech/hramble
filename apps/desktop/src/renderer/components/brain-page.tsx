/**
 * Brain — a local, growing library of skills and tools, private to this
 * machine. Same shape as Home Chat: a dedicated session, own directory, own
 * landing screen — reuses HomeConversation for the actual chat surface since
 * it's already generic (session id in, streaming chat out, nothing Home-specific).
 */
import {
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@hramble/ui/components/sidebar"
import { useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	ArchiveIcon,
	ArrowRightIcon,
	BookOpenIcon,
	CheckIcon,
	ChevronDownIcon,
	CpuIcon,
	DownloadIcon,
	ExternalLinkIcon,
	EyeIcon,
	FileTextIcon,
	FolderIcon,
	GitBranchIcon,
	GithubIcon,
	HistoryIcon,
	ListChecksIcon,
	Loader2Icon,
	PackageIcon,
	PlugIcon,
	PlusIcon,
	SettingsIcon,
	Share2Icon,
	SparklesIcon,
	Trash2Icon,
	UploadIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { agentFamily } from "../atoms/derived/agents"
import { brainSessionAtom, brainSessionIdsAtom, brainSessionListAtom } from "../atoms/brain"
import {
	communityBackendEnabledAtom,
	type CommunityPost,
	communityPostsAtom,
	communityUserAtom,
} from "../atoms/community"
import { workspaceModeAtom } from "../atoms/workspace"
import { createCommunityPost } from "../lib/community-client"
import brainNeural from "../brain-neural.png"
import { BrainTracedIcon } from "./brain-traced-icon"
import { useAgentActions } from "../hooks/use-server"
import { HomeConversation } from "./home-conversation"
import { useSetSidebarSlot } from "./sidebar-slot-context"
import { WorkspaceSwitcher } from "./sidebar-layout"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

/** Same Settings entry as the default sidebar footer, so it stays reachable from Brain. */
function BrainSidebarFooter() {
	const navigate = useNavigate()
	return (
		<SidebarFooter className="space-y-0 p-2">
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton
						tooltip="Settings"
						onClick={() => navigate({ to: "/settings" })}
						className="text-muted-foreground"
					>
						<SettingsIcon className="size-4" />
						<span>Settings</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarFooter>
	)
}

function BrainHistoryItem({
	id,
	isSelected,
	onSelect,
}: {
	id: string
	isSelected: boolean
	onSelect: () => void
}) {
	const agent = useAtomValue(agentFamily(id))
	return (
		<SidebarMenuItem>
			<SidebarMenuButton isActive={isSelected} tooltip={agent?.name} onClick={onSelect}>
				<span className="min-w-0 flex-1 truncate text-[13px]">{agent?.name || "Brain session"}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	)
}

/** Brain's own sidebar — a plain session history, no Code/Hyperloop concepts. */
function BrainSidebarContent() {
	const [brainSession, setBrainSession] = useAtom(brainSessionAtom)
	const brainSessionIds = useAtomValue(brainSessionListAtom)
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)
	const navigate = useNavigate()
	return (
		<>
			<WorkspaceSwitcher
				mode="code"
				onChange={(m) => {
					setWorkspaceMode(m)
					navigate({ to: "/" })
				}}
			/>
			<SidebarGroup>
				<SidebarGroupLabel>Brain</SidebarGroupLabel>
				<div className="absolute top-3.5 right-3">
					<button
						type="button"
						title="New session"
						onClick={() => setBrainSession(null)}
						className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
					>
						<PlusIcon className="size-4 shrink-0" />
					</button>
				</div>
				<SidebarGroupContent>
					<SidebarMenu>
						{brainSessionIds.map((id) => (
							<BrainHistoryItem
								key={id}
								id={id}
								isSelected={id === brainSession}
								onSelect={() => setBrainSession(id)}
							/>
						))}
						{brainSessionIds.length === 0 && (
							<p className="px-2 py-1.5 text-xs text-muted-foreground/60">Nothing taught yet</p>
						)}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</>
	)
}

/** One thing that's been added to the Brain (mirrors the brain:vault IPC shape). */
export type BrainVaultEntry = {
	name: string
	description: string
	type: "skill" | "repo" | "software" | "docs" | "model"
	verified: boolean
	source?: string
	addedAt: number
	/** The skill's full body (everything after the frontmatter) — what gets shared to the Community feed. */
	instructions: string
}

// Per-type presentation for the Vault — icon + accent colour + how it's counted
// in the summary strip. Reuses the same lucide icons as the arm cards.
const VAULT_TYPE_META: Record<
	BrainVaultEntry["type"],
	{ label: string; plural: string; icon: typeof PlusIcon; color: string }
> = {
	skill: { label: "Skills", plural: "skills", icon: SparklesIcon, color: "text-blue-500" },
	repo: { label: "Repos", plural: "repos", icon: GitBranchIcon, color: "text-green-500" },
	software: { label: "Tools", plural: "tools", icon: PackageIcon, color: "text-purple-500" },
	docs: { label: "Docs", plural: "docs", icon: BookOpenIcon, color: "text-sky-500" },
	model: { label: "Models", plural: "models", icon: CpuIcon, color: "text-amber-500" },
}

const VAULT_TYPE_ORDER: BrainVaultEntry["type"][] = ["skill", "repo", "software", "docs", "model"]

// The vault list is organised into type "folders". `docs` is split further by
// the extension of its source file, so PDFs and images get their own folders.
// Tools/Models also fold in the registry entries (see the sections render).
type VaultCategory = "Skills" | "Repos" | "Docs" | "PDFs" | "Images" | "Tools" | "Models"

// Image/vector extensions that route a `docs` entry into the Images folder.
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]

// Order the folders render in when non-empty.
const VAULT_CATEGORY_ORDER: VaultCategory[] = [
	"Skills",
	"Repos",
	"Docs",
	"PDFs",
	"Images",
	"Tools",
	"Models",
]

// Which folder a vault entry belongs to — from its type, and for `docs` from the
// lowercased extension of its source (pdf / image → own folder; else Docs).
function categoryOf(entry: BrainVaultEntry): VaultCategory {
	switch (entry.type) {
		case "skill":
			return "Skills"
		case "repo":
			return "Repos"
		case "software":
			return "Tools"
		case "model":
			return "Models"
		default: {
			const src = (entry.source || "").toLowerCase()
			if (src.endsWith(".pdf")) return "PDFs"
			if (IMAGE_EXTS.some((ext) => src.endsWith(ext))) return "Images"
			return "Docs"
		}
	}
}

/** One entry in the Brain's tool/model registry (mirrors the brain:registry IPC shape). */
export type BrainRegistryEntry = {
	id: string
	kind: "tool" | "model"
	name: string
	command: string
	description: string
	verified: boolean
	source?: string
	addedAt: number
}

/** One past job the Brain remembers (mirrors the brain:list-episodes IPC shape). */
export type BrainEpisode = {
	id: string
	timestamp: number
	task: string
	outcome: "success" | "failed" | "unknown"
	itemsUsed: string[]
	lesson?: string
}

/** Short, human relative time ("just now", "3h ago", "2d ago") for episode rows. */
function relativeTime(ts: number): string {
	const diff = Date.now() - ts
	if (!Number.isFinite(diff) || diff < 0) return ""
	const min = Math.floor(diff / 60000)
	if (min < 1) return "just now"
	if (min < 60) return `${min}m ago`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h ago`
	const day = Math.floor(hr / 24)
	if (day < 30) return `${day}d ago`
	return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// --- Share Brain wizard types ---
type ScanStatus = "ok" | "warn" | "dead"

// --- Clean (dead / duplicate removal) types ---
// One thing the Clean panel proposes removing — either a scan-broken item or a
// duplicate of an item we're keeping. `kind`+`id` are exactly what removeBrainItem takes.
type CleanCandidate = {
	key: string
	name: string
	kind: "skill" | "registry"
	id: string
	reason: string
}

// One selectable/scannable thing in the wizard — a vault entry OR a registry
// entry, normalised to a common shape. `item` is exactly what's sent to
// `brain:scan`; `metaType` drives the icon/colour (registry tools → "tool").
type ScanTarget = {
	key: string
	name: string
	metaType: BrainVaultEntry["type"] | "tool"
	item: {
		id: string
		kind: "skill" | "repo" | "software" | "docs" | "model" | "tool"
		source?: string
		command?: string
	}
}

// Icon/colour for a wizard row — reuses VAULT_TYPE_META, with a "tool" fallback
// that matches the software accent so registry tools read consistently.
const scanMeta = (t: BrainVaultEntry["type"] | "tool") =>
	t === "tool"
		? { label: "Tools", plural: "tools", icon: PackageIcon, color: "text-purple-500" }
		: VAULT_TYPE_META[t]

const SCAN_TYPE_ORDER: (BrainVaultEntry["type"] | "tool")[] = [
	"skill",
	"repo",
	"software",
	"docs",
	"model",
	"tool",
]

// The four "arms" of the Brain — each a distinct way to feed it, each taking a
// pasted link/path and turning it into a Brain session with the right instruction.
type BrainArm = {
	id: string
	name: string
	icon: typeof PlusIcon
	// Input arms: a text/link field + prompt. Action arms: a button that runs
	// an app-side action (folder-pick / navigate), no free-text input.
	placeholder?: string
	prompt?: (value: string) => string
	// Optional async work run BEFORE the session starts (e.g. cloning a repo),
	// returning the final prompt. Falls back to `prompt(value)` when absent.
	preprocess?: (value: string) => Promise<string>
	// Present on action arms — the card renders as a button with this label,
	// handled by id in the Brain page (Connect navigates, Files picks a folder).
	action?: "connect" | "files"
	actionLabel?: string
	// Input arms may also offer a "browse for a local file" affordance (e.g. Docs
	// can take a pasted URL OR a local pdf/txt/md file). `filePrompt` builds the
	// session prompt from the picked file path.
	browseFile?: boolean
	filePrompt?: (filePath: string) => string
	// Shown as a hover note near the arrow so the user knows what the arrow will
	// do before clicking. `verb` is the short action, `hint` the one-line what-happens.
	verb?: string
	hint?: string
}

// Builds the Docs arm's session prompt for a picked local file, branching on the
// file's extension so each kind of file is handled the smart way: SVGs and images
// carry reusable knowledge that plain "read the doc" misses. Everything else keeps
// the original read-the-document behaviour.
function docsFilePrompt(p: string): string {
	const ext = (p.split(".").pop() || "").toLowerCase()
	if (ext === "svg") {
		return `The file at ${p} is an SVG (it's just text/XML — read it directly). Study what it draws and how it's built (shapes, groups, gradients, viewBox, key paths) and extract the reusable knowledge: what the graphic depicts, its structure, and how to reuse or adapt it in future work. Save it with create_skill using type: "docs" and source: "${p}", so future sessions can rebuild or tweak it without starting over. Then tell me in one line what it is.`
	}
	if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
		return `LOOK AT the image at ${p} and extract the reusable knowledge from it. If it's a UI mockup / design, describe the layout, components, spacing and styling precisely enough to rebuild it in code; if it's a diagram, capture its structure and relationships; otherwise capture whatever is reusable about it. NOTE: this needs a vision-capable model — if you can't actually see images, say so plainly and stop rather than guessing or hallucinating what's in it. If you can see it, save what you learned with create_skill using type: "docs" and source: "${p}". Then tell me in one line what it shows.`
	}
	return `Read the document at ${p} (a local file — a document, or a code/text file) and extract the key, reusable knowledge from it. Save it with create_skill using type: "docs" and source: "${p}", so future sessions can use it without re-reading the whole file. Then tell me in one line what it covers.`
}

const BRAIN_ARMS: BrainArm[] = [
	{
		id: "skill",
		name: "Skill",
		icon: SparklesIcon,
		placeholder: "Paste a skill link…",
		verb: "Get & add",
		hint: "Fetch it, test it once, add to your Brain if it works",
		prompt: (l) =>
			`Add this skill to your local library: ${l}\n\nThen actually try it once on a small test to confirm it genuinely works. Only if the test passes, call create_skill with type: "skill", source: "${l}", and verified: true. If the test fails, tell me exactly what went wrong and save it with verified: false (or not at all) — do not claim success. Finally, tell me in one line what it does.`,
	},
	{
		id: "repo",
		name: "Git Repo",
		icon: GitBranchIcon,
		placeholder: "Paste a repo URL…",
		verb: "Absorb",
		hint: "Clone → set up → test → save as a skill or tool",
		prompt: (l) =>
			`Absorb this git repo — read it and set it up as a reusable skill or callable tool (whichever fits): ${l}\n\nThen actually run it once on a small test to confirm it genuinely works. Only if that passes, call create_skill with type: "repo", source: "${l}", and verified: true. If it fails, explain what went wrong and save with verified: false (or not at all) rather than claiming success. Then confirm what you saved.`,
		preprocess: async (l) => {
			const res = await bridge()?.cloneBrainRepo?.(l)
			if (res?.ok && res.path) {
				return `The repo is already cloned locally at ${res.path} — read it there, set it up as a reusable skill or callable tool (whichever fits), then actually run it once on a small test to confirm it genuinely works. Only if that passes, call create_skill with type: "repo", source: "${l}", and verified: true, AND — if it's a runnable tool — also call register_brain_tool (kind: "tool") with the real invocation command. If it fails, explain what went wrong and save with verified: false (or not at all) rather than claiming success. Then confirm what you saved.`
			}
			// Clone failed (or no bridge) — fall back to letting the agent clone it.
			return `Absorb this git repo — read it and set it up as a reusable skill or callable tool (whichever fits): ${l}\n\nThen actually run it once on a small test to confirm it genuinely works. Only if that passes, call create_skill with type: "repo", source: "${l}", and verified: true. If it fails, explain what went wrong and save with verified: false (or not at all) rather than claiming success. Then confirm what you saved.`
		},
	},
	{
		id: "tool",
		name: "Tool",
		icon: PackageIcon,
		placeholder: "Name a CLI tool (e.g. ffmpeg)…",
		verb: "Install",
		hint: "Install the CLI, run it once to confirm it works",
		prompt: (v) =>
			`Install the command-line tool "${v}" using whatever package manager fits this machine (brew, npm, cargo, pip, etc.). Then actually run it once on a small test to confirm it genuinely works. Only if that passes, call create_skill with type: "software", source: "${v}", and verified: true, saving how to use it — AND also call register_brain_tool with kind: "tool" and the real invocation command (e.g. how you actually ran it). If you can't install it or the test fails, tell me exactly what went wrong and don't claim success.`,
	},
	{
		id: "docs",
		name: "Docs",
		icon: BookOpenIcon,
		placeholder: "Paste a URL — or feed any file →",
		verb: "Read & save",
		hint: "Feed a doc, code, SVG or image — extract the knowledge, save it for later",
		prompt: (l) =>
			`Read the documentation / reference at ${l} and extract the key, reusable knowledge from it (how the API/tool/library actually works, the important endpoints/options/gotchas). Save it with create_skill using type: "docs" and source: "${l}", so future sessions can use it without guessing. Then tell me in one line what it covers.`,
		browseFile: true,
		filePrompt: (p) => docsFilePrompt(p),
	},
	{
		id: "connect",
		name: "Connect",
		icon: PlugIcon,
		action: "connect",
		actionLabel: "Add a connector",
	},
	{
		id: "files",
		name: "Files",
		icon: FolderIcon,
		action: "files",
		actionLabel: "Pick a folder",
	},
	{
		id: "rules",
		name: "Rules",
		icon: ListChecksIcon,
		placeholder: "Type a standing rule…",
		verb: "Save rule",
		hint: "Always follow this from now on",
		prompt: (v) =>
			`Save this as a standing rule you always follow from now on: "${v}". Store it with create_skill (type: "skill", named like a rule) so it's applied in future sessions, then confirm it's saved.`,
	},
]

function BrainArmCard({
	arm,
	disabled,
	onSubmit,
	onAction,
	onBrowse,
	className,
}: {
	arm: BrainArm
	disabled: boolean
	onSubmit: (prompt: string) => void
	onAction?: () => void | Promise<void>
	onBrowse?: () => void | Promise<void>
	className?: string
}) {
	const [val, setVal] = useState("")
	const [busy, setBusy] = useState(false)
	const Icon = arm.icon
	const isDisabled = disabled || busy
	const browse = async () => {
		if (isDisabled || !onBrowse) return
		setBusy(true)
		try {
			await onBrowse()
		} finally {
			setBusy(false)
		}
	}
	const submit = async () => {
		const t = val.trim()
		if (!t || isDisabled) return
		setBusy(true)
		try {
			const prompt = arm.preprocess ? await arm.preprocess(t) : (arm.prompt?.(t) ?? t)
			onSubmit(prompt)
			setVal("")
		} finally {
			setBusy(false)
		}
	}
	const runAction = async () => {
		if (isDisabled || !onAction) return
		setBusy(true)
		try {
			await onAction()
		} finally {
			setBusy(false)
		}
	}
	return (
		<div className={`flex w-48 flex-col gap-2 rounded-xl border border-border bg-card p-3 ${className ?? ""}`}>
			<div className="flex items-center gap-1.5">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Icon className="size-3.5" />
				</div>
				<span className="font-medium text-foreground text-xs">{arm.name}</span>
			</div>
			{arm.action ? (
				<button
					type="button"
					onClick={() => void runAction()}
					disabled={isDisabled}
					className="flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					{arm.actionLabel}
					<ArrowRightIcon className="size-3" />
				</button>
			) : (
				<div className="flex gap-1">
					<input
						value={val}
						onChange={(e) => setVal(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								void submit()
							}
						}}
						disabled={isDisabled}
						placeholder={arm.placeholder}
						className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
					/>
					{arm.browseFile && (
						<button
							type="button"
							title="Pick a local file (doc, code, SVG or image)"
							onClick={() => void browse()}
							disabled={isDisabled}
							className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
						>
							<FolderIcon className="size-3.5" />
						</button>
					)}
					<div className="group/arrow relative shrink-0">
						<button
							type="button"
							onClick={() => void submit()}
							disabled={isDisabled || !val.trim()}
							className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
						>
							<ArrowRightIcon className="size-3.5" />
						</button>
						{(arm.verb || arm.hint) && (
							<div className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 hidden w-48 rounded-lg border border-border bg-popover p-2 text-left shadow-md group-hover/arrow:block">
								{arm.verb && <div className="font-medium text-[11px] text-foreground">{arm.verb}</div>}
								{arm.hint && <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug">{arm.hint}</div>}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

// The machine-readable manifest that ships inside a shared Brain repo (mirrors
// what brain:publish-git writes + brain:import-git returns). Every field is
// optional so a partial / hand-edited manifest never crashes the setup screen.
export type BrainManifest = {
	generatedAt?: string
	skills?: Array<{ name: string; description?: string; type?: string }>
	tools?: Array<{ name: string; command?: string; source?: string }>
	models?: Array<{ name: string; source?: string }>
	connectors?: Array<{ name?: string; source?: string }>
}

// Per-command install state on the Bring-it-Live screen.
type InstallState = "idle" | "busy" | "ok" | "fail"

/**
 * Bring-it-Live — the setup screen shown after importing a shared Brain that
 * carries extra bits to wire up (CLI tools, local models, service connectors).
 *
 * SECURITY: the install commands came from someone ELSE's Brain, so this screen
 * is strictly human-in-the-loop — every command is ALWAYS printed on screen
 * before it can run, and running one is a deliberate click (there's an
 * "Install all", but only over commands already visible). Models are never
 * auto-downloaded: we only surface a link to Open. Nothing runs on import.
 */
function BringItLiveView({
	manifest,
	health,
	onDone,
}: {
	manifest: BrainManifest
	health: string | null
	onDone: () => void
}) {
	const navigate = useNavigate()
	const tools = manifest.tools ?? []
	const models = manifest.models ?? []
	const connectors = manifest.connectors ?? []
	const [showHealth, setShowHealth] = useState(false)
	const [state, setState] = useState<Record<number, InstallState>>({})
	const [installingAll, setInstallingAll] = useState(false)

	// Run ONE tool's command — only ever from a user click here. Reflects the
	// real exit code back as a ✓/✗, and surfaces stderr on failure.
	const runOne = async (i: number, command: string): Promise<boolean> => {
		const fn = bridge()?.runBrainSetupCommand
		if (typeof fn !== "function") {
			toast.error("Running setup needs the desktop app.")
			return false
		}
		setState((p) => ({ ...p, [i]: "busy" }))
		try {
			const res = await fn(command)
			const ok = !!res?.ok
			setState((p) => ({ ...p, [i]: ok ? "ok" : "fail" }))
			if (!ok) toast.error(res?.stderr?.trim() || `Command exited ${res?.code ?? 1}`)
			return ok
		} catch {
			setState((p) => ({ ...p, [i]: "fail" }))
			toast.error("Couldn't run that command.")
			return false
		}
	}

	// Runs every tool command in order — the commands are already on screen, so
	// this only saves clicks, it doesn't hide anything.
	const installAll = async () => {
		setInstallingAll(true)
		try {
			for (let i = 0; i < tools.length; i++) {
				const cmd = (tools[i].command || "").trim()
				if (!cmd) continue
				await runOne(i, cmd)
			}
		} finally {
			setInstallingAll(false)
		}
	}

	// Open a model's download page in the real browser — NEVER auto-download.
	const openModel = (source?: string) => {
		if (!source) return
		const ext = bridge()?.openExternal
		if (typeof ext === "function") void ext(source)
		else window.open(source, "_blank", "noopener")
	}

	const statusMark = (s: InstallState) => {
		if (s === "busy") return <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
		if (s === "ok") return <CheckIcon className="size-4 text-emerald-500" />
		if (s === "fail") return <XIcon className="size-4 text-red-500" />
		return null
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-foreground text-lg">Bring this Brain live on your machine</h2>
				<p className="text-muted-foreground text-sm">
					Its skills, docs and rules are already active. These are the extra bits to set up.
				</p>
			</div>

			{health && (
				<div className="rounded-xl border border-border bg-card">
					<button
						type="button"
						onClick={() => setShowHealth((v) => !v)}
						className="flex w-full items-center justify-between gap-2 p-3 text-left"
					>
						<span className="font-medium text-foreground text-sm">What still needs work</span>
						<ChevronDownIcon
							className={`size-4 shrink-0 text-muted-foreground transition-transform ${showHealth ? "rotate-180" : ""}`}
						/>
					</button>
					{showHealth && (
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap border-border border-t p-3 font-mono text-[11px] text-muted-foreground">
							{health}
						</pre>
					)}
				</div>
			)}

			{tools.length > 0 && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<h3 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">TOOLS</h3>
						<button
							type="button"
							onClick={() => void installAll()}
							disabled={installingAll}
							className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
						>
							{installingAll ? "Installing…" : "Install all"}
						</button>
					</div>
					<div className="flex flex-col gap-2">
						{tools.map((t, i) => {
							const cmd = (t.command || "").trim()
							const s = state[i] ?? "idle"
							return (
								<div
									key={`${t.name}-${i}`}
									className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
								>
									<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
										<PackageIcon className="size-4 text-purple-500" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate font-medium text-foreground text-sm">{t.name}</div>
										{cmd && (
											<code className="mt-0.5 inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
												{cmd}
											</code>
										)}
									</div>
									{statusMark(s)}
									<button
										type="button"
										onClick={() => void runOne(i, cmd)}
										disabled={!cmd || s === "busy" || installingAll}
										className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
									>
										Install
									</button>
								</div>
							)
						})}
					</div>
				</div>
			)}

			{models.length > 0 && (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">MODELS</h3>
					<div className="flex flex-col gap-2">
						{models.map((m, i) => (
							<div
								key={`${m.name}-${i}`}
								className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
							>
								<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
									<CpuIcon className="size-4 text-amber-500" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium text-foreground text-sm">{m.name}</div>
									{m.source && (
										<div className="truncate text-muted-foreground text-xs">{m.source}</div>
									)}
								</div>
								{m.source && (
									<button
										type="button"
										onClick={() => openModel(m.source)}
										className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-primary/40"
									>
										<ExternalLinkIcon className="size-3.5" /> Open
									</button>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{connectors.length > 0 && (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">CONNECTORS</h3>
					<div className="flex flex-col gap-2">
						{connectors.map((c, i) => (
							<div
								key={`${c.name ?? "connector"}-${i}`}
								className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
							>
								<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
									<PlugIcon className="size-4 text-sky-500" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium text-foreground text-sm">
										{c.name || "Connector"}
									</div>
								</div>
								<button
									type="button"
									onClick={() => navigate({ to: "/settings/connectors" })}
									className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-primary/40"
								>
									Connect
								</button>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="flex items-center justify-end">
				<button
					type="button"
					onClick={onDone}
					className="flex h-8 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground"
				>
					Done
				</button>
			</div>
		</div>
	)
}

/** The Vault — a browsable record of everything that's been added to the Brain. */
function BrainVaultView({
	onTeach,
	vaultAction,
	onVaultActionHandled,
}: {
	onTeach: (prompt: string) => void
	// When the hero toolbar routes here, it names the flow to auto-open (share /
	// import / clean; "open" = just land on the vault). Optional so the vault can
	// still be rendered without the hero driving it.
	vaultAction?: null | "open" | "share" | "import" | "clean"
	onVaultActionHandled?: () => void
}) {
	const [entries, setEntries] = useState<BrainVaultEntry[] | null>(null)
	const [registry, setRegistry] = useState<BrainRegistryEntry[]>([])
	const [filter, setFilter] = useState<"all" | BrainVaultEntry["type"]>("all")
	const [busy, setBusy] = useState(false)
	// Share Brain wizard — a two-step (Select → Report) flow that replaces the
	// vault list inline. null = not open. See renderWizard below.
	const [wizardStep, setWizardStep] = useState<null | "select" | "report">(null)
	const [checked, setChecked] = useState<Record<string, boolean>>({})
	const [scanning, setScanning] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)
	const [report, setReport] = useState<Array<{ id: string; status: ScanStatus; detail: string }> | null>(null)
	const [scanned, setScanned] = useState<ScanTarget[]>([])
	// Save-to-GitHub state for the report step.
	const [publishing, setPublishing] = useState(false)
	const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
	const user = useAtomValue(communityUserAtom)
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const setPosts = useSetAtom(communityPostsAtom)
	// Import-from-GitHub — an inline URL field toggled open next to Import Brain.
	const [gitImportOpen, setGitImportOpen] = useState(false)
	const [gitUrl, setGitUrl] = useState("")
	const [gitImporting, setGitImporting] = useState(false)
	// Bring-it-Live setup screen — set from the imported manifest when it carries
	// tools/models/connectors to wire up; null = not showing it.
	const [liveManifest, setLiveManifest] = useState<BrainManifest | null>(null)
	const [liveHealth, setLiveHealth] = useState<string | null>(null)
	// Episode History — a read-only, collapsible list of past jobs. Lazily
	// fetched on first expand; null = not fetched yet.
	const [historyOpen, setHistoryOpen] = useState(false)
	const [episodes, setEpisodes] = useState<BrainEpisode[] | null>(null)
	// Clean panel — computes a dead/duplicate cleanup list from a fresh scan and
	// lets the user remove the ones they approve. null list = still scanning.
	const [cleanOpen, setCleanOpen] = useState(false)
	const [cleanScanning, setCleanScanning] = useState(false)
	const [cleanList, setCleanList] = useState<CleanCandidate[] | null>(null)
	const [cleanChecked, setCleanChecked] = useState<Record<string, boolean>>({})
	const [cleanRemoving, setCleanRemoving] = useState(false)
	// Item viewer — read / edit / delete a saved item's SKILL.md without opening a
	// chat. `viewing` = the vault entry whose panel is open (null = closed). The
	// full raw SKILL.md + parsed reference metadata are fetched on open.
	const [viewing, setViewing] = useState<BrainVaultEntry | null>(null)
	const [viewContent, setViewContent] = useState<string | null>(null)
	const [viewMeta, setViewMeta] = useState<{ reference?: boolean; storedPath?: string; type?: string } | null>(null)
	const [viewLoading, setViewLoading] = useState(false)
	const [viewError, setViewError] = useState(false)
	const [editing, setEditing] = useState(false)
	const [editText, setEditText] = useState("")
	const [savingEdit, setSavingEdit] = useState(false)

	// Reloads the vault + registry from the main process. Reused after an
	// import so newly-restored skills appear without a page switch.
	const refresh = useCallback(async () => {
		try {
			const list = (await bridge()?.getBrainVault?.()) as BrainVaultEntry[] | undefined
			setEntries(list ?? [])
		} catch {
			// No Electron bridge (e.g. dev:web preview) or IPC failure — show
			// the empty state rather than spinning on "Loading…" forever.
			setEntries([])
		}
		try {
			const list = (await bridge()?.getBrainRegistry?.()) as BrainRegistryEntry[] | undefined
			setRegistry(list ?? [])
		} catch {
			setRegistry([])
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh])

	// Shares one skill to the Community feed, reusing the exact flow the
	// Community page's composer uses (createCommunityPost when the backend is
	// live, otherwise the local mock feed). Needs a signed-in user either way.
	const shareSkill = async (entry: BrainVaultEntry) => {
		if (!user) {
			toast("Sign in on the Community page to share skills.")
			return
		}
		const skill = {
			name: entry.name,
			description: entry.description,
			instructions: entry.instructions,
		}
		try {
			if (backendEnabled) {
				const created = await createCommunityPost({
					author: user,
					type: "skill",
					caption: "",
					img: null,
					repoUrl: null,
					tags: [],
					skill,
				})
				if (!created) {
					toast.error("Couldn't share to Community — try again.")
					return
				}
				setPosts((prev) => [created, ...prev])
			} else {
				const newPost: CommunityPost = {
					id: crypto.randomUUID(),
					author: user,
					type: "skill",
					caption: "",
					thumbnailDataUrl: null,
					repoUrl: null,
					createdAt: Date.now(),
					likedByMe: false,
					likeCount: 0,
					tags: [],
					skill,
				}
				setPosts((prev) => [newPost, ...prev])
			}
			toast.success("Shared to Community")
		} catch {
			toast.error("Couldn't share to Community — try again.")
		}
	}

	const exportBrain = async () => {
		setBusy(true)
		try {
			const res = await bridge()?.exportBrain?.()
			if (res?.ok) toast.success("Brain exported")
			else if (res?.error) toast.error(res.error)
			// res undefined (no bridge) or a cancelled dialog — stay quiet.
		} catch {
			toast.error("Couldn't export the Brain.")
		} finally {
			setBusy(false)
		}
	}

	const importBrain = async () => {
		setBusy(true)
		try {
			const res = await bridge()?.importBrain?.()
			if (res?.ok) {
				toast.success(
					typeof res.imported === "number"
						? `Brain imported — ${res.imported} skills now available`
						: "Brain imported",
				)
				await refresh()
			} else if (res?.error) {
				toast.error(res.error)
			}
		} catch {
			toast.error("Couldn't import a Brain.")
		} finally {
			setBusy(false)
		}
	}

	// Imports a Brain straight from a GitHub URL (clone + merge skills/registry),
	// then — if the returned manifest carries tools/models/connectors — opens the
	// Bring-it-Live setup screen so the user can wire them up.
	const importFromGit = async () => {
		const url = gitUrl.trim()
		if (!url || gitImporting) return
		setGitImporting(true)
		try {
			const fn = bridge()?.importBrainFromGit
			if (typeof fn !== "function") {
				toast.error("Importing from GitHub needs the desktop app.")
				return
			}
			const res = await fn(url)
			if (res?.ok) {
				toast.success(
					typeof res.imported === "number"
						? `Brain imported — ${res.imported} skills now available`
						: "Brain imported",
				)
				setGitImportOpen(false)
				setGitUrl("")
				await refresh()
				const m = res.manifest
				const setupCount =
					(m?.tools?.length ?? 0) + (m?.models?.length ?? 0) + (m?.connectors?.length ?? 0)
				if (m && setupCount > 0) {
					setLiveManifest(m)
					setLiveHealth(res.health ?? null)
				}
			} else if (res?.error) {
				toast.error(res.error)
			}
		} catch {
			toast.error("Couldn't import from GitHub.")
		} finally {
			setGitImporting(false)
		}
	}

	// Flattens the vault + registry into one list of selectable/scannable
	// targets. Software vault entries store the tool name in `source`, so we pass
	// it as a `command` (unless it's a URL) to get a real `which` binary check.
	const buildTargets = useCallback((): ScanTarget[] => {
		const targets: ScanTarget[] = []
		for (const e of entries ?? []) {
			const isHttp = !!e.source && /^https?:\/\//i.test(e.source)
			targets.push({
				key: `vault:${e.name}`,
				name: e.name,
				metaType: e.type,
				item: {
					id: e.name,
					kind: e.type,
					source: e.source,
					command: e.type === "software" && e.source && !isHttp ? e.source : undefined,
				},
			})
		}
		for (const r of registry) {
			targets.push({
				key: `reg:${r.id}`,
				name: r.name,
				metaType: r.kind === "model" ? "model" : "tool",
				item: {
					id: r.id,
					kind: r.kind === "model" ? "model" : "tool",
					source: r.source,
					command: r.command,
				},
			})
		}
		return targets
	}, [entries, registry])

	const targets = buildTargets()
	const anyChecked = targets.some((t) => checked[t.key])

	const openWizard = () => {
		const init: Record<string, boolean> = {}
		for (const t of buildTargets()) init[t.key] = true
		setChecked(init)
		setReport(null)
		setScanError(null)
		setPublishedUrl(null)
		setWizardStep("select")
	}

	const closeWizard = () => {
		setWizardStep(null)
		setReport(null)
		setScanError(null)
	}

	// Runs the deterministic scan over the checked targets and moves to the
	// report step. Results are aligned to `scanned` by array order.
	const startScan = async () => {
		const selected = buildTargets().filter((t) => checked[t.key])
		setScanned(selected)
		setReport(null)
		setScanError(null)
		setPublishedUrl(null)
		setWizardStep("report")
		setScanning(true)
		try {
			const fn = bridge()?.scanBrain
			if (typeof fn !== "function") {
				setScanError("Scanning isn't available here (needs the desktop app).")
				return
			}
			const res = (await fn(selected.map((t) => t.item))) as
				| Array<{ id: string; status: ScanStatus; detail: string }>
				| undefined
			setReport(Array.isArray(res) ? res : [])
		} catch {
			setScanError("Couldn't scan — try again.")
		} finally {
			setScanning(false)
		}
	}

	// Removes one flagged item from the Brain (skill folder or registry entry),
	// then drops its row from the report so the list reflects reality.
	const removeRow = async (t: ScanTarget) => {
		const kind = t.key.startsWith("reg:") ? "registry" : "skill"
		try {
			const res = await bridge()?.removeBrainItem?.(kind, t.item.id)
			if (res?.ok) {
				toast.success(`Removed ${t.name}`)
				setScanned((prev) => prev.filter((x) => x.key !== t.key))
				void refresh()
			} else {
				toast.error(res?.error || "Couldn't remove that item.")
			}
		} catch {
			toast.error("Couldn't remove that item.")
		}
	}

	// Expands/collapses the read-only History section. Lazily loads the episode
	// list on first open — wrapped so a missing bridge (dev:web) just shows the
	// empty state instead of hanging.
	const toggleHistory = async () => {
		const next = !historyOpen
		setHistoryOpen(next)
		if (next && episodes === null) {
			try {
				const list = (await bridge()?.listEpisodes?.()) as BrainEpisode[] | undefined
				setEpisodes(Array.isArray(list) ? list : [])
			} catch {
				setEpisodes([])
			}
		}
	}

	// Opens the Clean panel: runs one deterministic scan over every Brain item,
	// then computes the cleanup list = (a) items the scan flags broken PLUS (b)
	// duplicates (same normalized name or same source URL — first one kept). All
	// candidates start checked; the user unticks anything they want to keep.
	const openClean = async () => {
		setCleanOpen(true)
		setCleanList(null)
		setCleanChecked({})
		setCleanScanning(true)
		const all = buildTargets()
		try {
			// Scan every item (best-effort — skip if there's no desktop bridge).
			const statusByKey = new Map<string, { status: ScanStatus; detail: string }>()
			const fn = bridge()?.scanBrain
			if (typeof fn === "function") {
				const res = (await fn(all.map((t) => t.item))) as
					| Array<{ id: string; status: ScanStatus; detail: string }>
					| undefined
				if (Array.isArray(res)) {
					all.forEach((t, i) => {
						const r = res[i] ?? res.find((x) => x.id === t.item.id)
						if (r) statusByKey.set(t.key, r)
					})
				}
			}

			// Duplicate detection (client-side): the first item under a given
			// normalized name / source is the keeper; later matches are dups of it.
			const nameRep = new Map<string, ScanTarget>()
			const sourceRep = new Map<string, ScanTarget>()
			const dupOf = new Map<string, string>()
			for (const t of all) {
				const nName = t.name.trim().toLowerCase()
				const nSrc = t.item.source ? t.item.source.trim().toLowerCase().replace(/\/+$/, "") : ""
				const rep =
					(nName && nameRep.get(nName)) || (nSrc && sourceRep.get(nSrc)) || undefined
				if (rep) {
					dupOf.set(t.key, rep.name)
				} else {
					if (nName) nameRep.set(nName, t)
					if (nSrc) sourceRep.set(nSrc, t)
				}
			}

			const candidates: CleanCandidate[] = []
			for (const t of all) {
				const broken = statusByKey.get(t.key)
				const isBroken = !!broken && broken.status !== "ok"
				const dup = dupOf.get(t.key)
				if (!isBroken && !dup) continue
				const reason = isBroken
					? `broken: ${broken?.detail || (broken?.status === "dead" ? "dead" : "needs repair")}`
					: `duplicate of ${dup}`
				candidates.push({
					key: t.key,
					name: t.name,
					kind: t.key.startsWith("reg:") ? "registry" : "skill",
					id: t.item.id,
					reason,
				})
			}
			setCleanList(candidates)
			const init: Record<string, boolean> = {}
			for (const c of candidates) init[c.key] = true
			setCleanChecked(init)
		} catch {
			setCleanList([])
		} finally {
			setCleanScanning(false)
		}
	}

	const closeClean = () => {
		setCleanOpen(false)
		setCleanList(null)
		setCleanChecked({})
	}

	// Hero toolbar bridge — when the Teach hero routes here with a named action,
	// auto-open the matching existing flow, then clear it so it fires only once.
	// "open" needs nothing extra (just being on the vault is enough). Guarded so
	// the vault still works when rendered without these props.
	useEffect(() => {
		if (!vaultAction) return
		if (vaultAction === "share") openWizard()
		else if (vaultAction === "clean") void openClean()
		else if (vaultAction === "import") setGitImportOpen(true)
		// "open" → nothing extra.
		onVaultActionHandled?.()
		// Only react to a new action; the flow openers are stable enough here and
		// re-adding them would just re-fire the same one-shot.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vaultAction])

	// Removes each checked cleanup candidate one at a time, swallowing per-item
	// errors so one failure doesn't abort the rest, then refreshes the vault.
	const removeCleanSelected = async () => {
		const targets = (cleanList ?? []).filter((c) => cleanChecked[c.key])
		if (targets.length === 0) return
		setCleanRemoving(true)
		let removed = 0
		try {
			for (const c of targets) {
				try {
					const res = await bridge()?.removeBrainItem?.(c.kind, c.id)
					if (res?.ok) removed++
				} catch {
					// swallow — keep going through the rest of the list
				}
			}
			if (removed > 0) toast.success(`Cleaned ${removed} item${removed === 1 ? "" : "s"}`)
			await refresh()
		} finally {
			setCleanRemoving(false)
			closeClean()
		}
	}

	// Publishes the scanned set to a private GitHub repo (skills + registry +
	// manifest + BRAIN.md). Surfaces the repo URL on success, the error on fail.
	const publish = async (reportMarkdown?: string) => {
		setPublishing(true)
		setPublishedUrl(null)
		try {
			const items = scanned.map((t) => ({
				kind: (t.key.startsWith("reg:") ? "registry" : "skill") as "skill" | "registry",
				id: t.item.id,
				name: t.name,
				type: t.metaType,
			}))
			const res = await bridge()?.publishBrainToGit?.(items, reportMarkdown)
			if (res?.ok) {
				setPublishedUrl(res.url ?? null)
				toast.success("Brain published to GitHub")
			} else {
				toast.error(res?.error || "Couldn't publish the Brain.")
			}
		} catch {
			toast.error("Couldn't publish the Brain.")
		} finally {
			setPublishing(false)
		}
	}

	const copyUrl = async () => {
		if (!publishedUrl) return
		try {
			await navigator.clipboard.writeText(publishedUrl)
			toast.success("Link copied")
		} catch {
			toast.error("Couldn't copy the link.")
		}
	}

	// Export/Import controls — shown above the vault (and in the empty state so
	// a fresh machine can still import a Brain).
	const actions = (
		<div className="flex flex-col items-end gap-2">
			<div className="flex flex-wrap items-center justify-end gap-2">
				<button
					type="button"
					onClick={openWizard}
					disabled={busy}
					className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					<Share2Icon className="size-3.5" /> Share Brain
				</button>
				<button
					type="button"
					onClick={() => void openClean()}
					disabled={busy}
					className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					<Trash2Icon className="size-3.5" /> Clean
				</button>
				<button
					type="button"
					onClick={() => void exportBrain()}
					disabled={busy}
					className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					<DownloadIcon className="size-3.5" /> Export Brain
				</button>
				<button
					type="button"
					onClick={() => void importBrain()}
					disabled={busy}
					className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					<UploadIcon className="size-3.5" /> Import Brain
				</button>
				<button
					type="button"
					onClick={() => setGitImportOpen((v) => !v)}
					disabled={busy}
					className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
				>
					<GithubIcon className="size-3.5" /> Import from GitHub
				</button>
			</div>
			{gitImportOpen && (
				<div className="flex items-center gap-1.5">
					<input
						value={gitUrl}
						onChange={(e) => setGitUrl(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								void importFromGit()
							}
						}}
						disabled={gitImporting}
						placeholder="https://github.com/user/hramble-brain"
						className="h-7 w-72 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
					/>
					<button
						type="button"
						onClick={() => void importFromGit()}
						disabled={gitImporting || !gitUrl.trim()}
						className="flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40"
					>
						{gitImporting ? "Importing…" : "Import"}
					</button>
				</div>
			)}
		</div>
	)

	// --- Share Brain wizard (inline, replaces the vault list) ---
	const renderWizard = () => {
		// Group the targets by type for the Select step, in a stable order.
		const groups = SCAN_TYPE_ORDER.map((t) => ({
			type: t,
			items: targets.filter((x) => x.metaType === t),
		})).filter((g) => g.items.length > 0)

		if (wizardStep === "select") {
			return (
				<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="font-semibold text-foreground text-lg">Share your Brain</h2>
						<p className="text-muted-foreground text-sm">
							Choose what to include — untick anything you don't want to share.
						</p>
					</div>

					{targets.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-sm">
							Nothing in the Brain to share yet.
						</p>
					) : (
						<div className="flex flex-col gap-5">
							{groups.map((group) => {
								const meta = scanMeta(group.type)
								const Icon = meta.icon
								return (
									<div key={group.type} className="flex flex-col gap-2">
										<h3 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">
											{meta.label.toUpperCase()}
										</h3>
										<div className="flex flex-col gap-2">
											{group.items.map((t) => (
												<label
													key={t.key}
													className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3"
												>
													<input
														type="checkbox"
														checked={!!checked[t.key]}
														onChange={() =>
															setChecked((prev) => ({ ...prev, [t.key]: !prev[t.key] }))
														}
														className="size-4 shrink-0 accent-primary"
													/>
													<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
														<Icon className={`size-4 ${meta.color}`} />
													</div>
													<div className="min-w-0 flex-1">
														<div className="truncate font-medium text-foreground text-sm">
															{t.name}
														</div>
														{t.item.source && (
															<div className="truncate text-muted-foreground text-xs">
																{t.item.source}
															</div>
														)}
													</div>
												</label>
											))}
										</div>
									</div>
								)
							})}
						</div>
					)}

					<div className="flex items-center justify-end gap-2">
						<button
							type="button"
							onClick={closeWizard}
							className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void startScan()}
							disabled={!anyChecked}
							className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-40"
						>
							Scan selected <ArrowRightIcon className="size-3.5" />
						</button>
					</div>
				</div>
			)
		}

		// Report step.
		const pill = (status: ScanStatus) => {
			if (status === "ok")
				return (
					<span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
						✅ Working
					</span>
				)
			if (status === "warn")
				return (
					<span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 dark:text-amber-400">
						⚠️ Needs repair
					</span>
				)
			return (
				<span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-[11px] text-red-600 dark:text-red-400">
					❌ Dead
				</span>
			)
		}

		const statusFor = (i: number, id: string): { status: ScanStatus; detail: string } => {
			const byIndex = report?.[i]
			if (byIndex) return byIndex
			const byId = report?.find((r) => r.id === id)
			return byId ?? { status: "warn", detail: "could not check" }
		}

		const okCount = scanned.filter((t, i) => statusFor(i, t.item.id).status === "ok").length
		const warnCount = scanned.filter((t, i) => statusFor(i, t.item.id).status === "warn").length
		const deadCount = scanned.filter((t, i) => statusFor(i, t.item.id).status === "dead").length

		// Repair/publish are only meaningful once a real report is in.
		const canAct = !scanning && !scanError && !!report
		const anyFlagged = canAct && warnCount + deadCount > 0
		const anyDead = canAct && deadCount > 0

		// One instruction that lists every flagged item + its issue, handed to a
		// Brain session to actually fix (update the real skill/registry entries).
		const buildRepairPrompt = () => {
			const flagged = scanned
				.map((t, i) => ({ t, r: statusFor(i, t.item.id) }))
				.filter((x) => x.r.status !== "ok")
			const list = flagged
				.map(({ t, r }) => {
					const where = t.item.source || t.item.command || ""
					return `- ${t.name} (${t.metaType}${where ? `, ${where}` : ""}): ${r.status === "dead" ? "DEAD" : "needs repair"} — ${r.detail}`
				})
				.join("\n")
			return `Some items in my Brain failed a health check. Work through each one and fix it:\n\n${list}\n\nFor each item:\n- If a DOC or MODEL link is dead (404/moved), actively SEARCH THE WEB for where it lives now — a new URL, a HuggingFace repo/mirror, or an official replacement — and update the source to the working link. Don't just flag it dead if a live equivalent exists.\n- If a TOOL/install command changed or the binary is missing, refresh it to the current working install command.\n- Otherwise re-verify the item still works.\n\nUpdate the ACTUAL skill files and registry entries — call create_skill (for skills/docs/repos/software) or register_brain_tool (for tools/models) with the corrected source/command, and mark verified: true ONLY after you actually confirm the new link/command works. If something genuinely can't be found anywhere anymore, say so plainly and leave it unverified — do NOT invent success or claim you fixed something you didn't. When done, tell me what you re-linked, what you fixed, and what you couldn't.`
		}

		// A shareable, plain-English health report — what works, what needs repair,
		// and what's dead. Sent alongside an incomplete Brain so the recipient knows
		// exactly what to finish. Also written into the published repo as HEALTH.md.
		const buildReportMarkdown = () => {
			const lines = [
				"# Brain Health Report",
				"",
				`Generated ${new Date().toISOString().slice(0, 10)}`,
				"",
				`**${okCount} working · ${warnCount} need repair · ${deadCount} dead**`,
				"",
			]
			const section = (title: string, statuses: ScanStatus[]) => {
				const rows = scanned
					.map((t, i) => ({ t, r: statusFor(i, t.item.id) }))
					.filter((x) => statuses.includes(x.r.status))
				if (rows.length === 0) return
				lines.push(`## ${title}`, "")
				for (const { t, r } of rows) {
					const where = t.item.source || t.item.command || ""
					lines.push(`- **${t.name}** (${t.metaType}${where ? `, \`${where}\`` : ""})${r.detail ? ` — ${r.detail}` : ""}`)
				}
				lines.push("")
			}
			section("❌ Dead — needs removing or replacing", ["dead"])
			section("⚠️ Needs repair", ["warn"])
			section("✅ Working", ["ok"])
			return lines.join("\n")
		}

		const shareReport = async () => {
			try {
				await navigator.clipboard.writeText(buildReportMarkdown())
				toast.success("Report copied — paste it anywhere to share")
			} catch {
				toast.error("Couldn't copy the report")
			}
		}

		return (
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-foreground text-lg">Brain health report</h2>
					{scanning ? (
						<p className="text-muted-foreground text-sm">Scanning…</p>
					) : scanError ? (
						<p className="text-muted-foreground text-sm">{scanError}</p>
					) : (
						<p className="text-muted-foreground text-sm">
							{okCount} working · {warnCount} need repair · {deadCount} dead
						</p>
					)}
				</div>

				{!scanning && !scanError && (
					<div className="flex flex-col gap-2">
						{scanned.map((t, i) => {
							const meta = scanMeta(t.metaType)
							const Icon = meta.icon
							const r = statusFor(i, t.item.id)
							return (
								<div
									key={t.key}
									className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
								>
									<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
										<Icon className={`size-4 ${meta.color}`} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate font-medium text-foreground text-sm">{t.name}</div>
										{r.status !== "ok" && r.detail && (
											<div className="truncate text-muted-foreground text-xs">{r.detail}</div>
										)}
									</div>
									{pill(r.status)}
									{r.status !== "ok" && (
										<button
											type="button"
											title="Remove from Brain"
											onClick={() => void removeRow(t)}
											className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400"
										>
											Remove
										</button>
									)}
								</div>
							)
						})}
					</div>
				)}

				{publishedUrl && (
					<div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
						<span className="shrink-0 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
							Published
						</span>
						<code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
							{publishedUrl}
						</code>
						<button
							type="button"
							onClick={() => void copyUrl()}
							className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/40"
						>
							Copy
						</button>
						<button
							type="button"
							onClick={() => void bridge()?.openExternal?.(publishedUrl)}
							className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/40"
						>
							Open
						</button>
					</div>
				)}

				{anyDead && !publishedUrl && (
					<p className="text-[11px] text-amber-600 dark:text-amber-400">
						Some items are dead — remove or repair them first?
					</p>
				)}

				<div className="flex items-start justify-between gap-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setWizardStep("select")}
							className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
						>
							Back
						</button>
						<button
							type="button"
							onClick={() => void shareReport()}
							disabled={!canAct}
							className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
						>
							<Share2Icon className="size-3.5" />
							Share report
						</button>
					</div>
					<div className="flex flex-col items-end gap-1">
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => onTeach(buildRepairPrompt())}
								disabled={!anyFlagged}
								className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
							>
								Repair flagged
							</button>
							<button
								type="button"
								onClick={() => void publish(buildReportMarkdown())}
								disabled={publishing || !canAct}
								className="flex h-8 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-60"
							>
								{publishing ? "Publishing…" : "Save to GitHub"}
							</button>
						</div>
						<span className="max-w-xs text-right text-[11px] text-muted-foreground/60">
							Opens a Brain session to fix the flagged items; re-scan after to confirm.
						</span>
					</div>
				</div>
			</div>
		)
	}

	// --- Item viewer (inline, replaces the vault list) ---
	// Opens the viewer for one vault entry and loads its full SKILL.md. The vault
	// list only carries the body, so we read the raw file here for read + edit.
	const openViewer = async (entry: BrainVaultEntry) => {
		setViewing(entry)
		setEditing(false)
		setViewContent(null)
		setViewMeta(null)
		setViewError(false)
		setViewLoading(true)
		try {
			const res = await bridge()?.readBrainItem?.(entry.name)
			if (res?.ok && typeof res.content === "string") {
				setViewContent(res.content)
				setEditText(res.content)
				setViewMeta({ reference: res.reference, storedPath: res.storedPath, type: res.type })
			} else {
				setViewError(true)
			}
		} catch {
			setViewError(true)
		} finally {
			setViewLoading(false)
		}
	}

	const closeViewer = () => {
		setViewing(null)
		setViewContent(null)
		setViewMeta(null)
		setEditing(false)
		setViewError(false)
	}

	// Saves the edited raw SKILL.md back to disk, then refreshes the viewer + vault.
	const saveEdit = async () => {
		if (!viewing) return
		setSavingEdit(true)
		try {
			const res = await bridge()?.writeBrainItem?.(viewing.name, editText)
			if (res?.ok) {
				toast.success("Saved")
				setViewContent(editText)
				setEditing(false)
				await refresh()
			} else {
				toast.error(res?.error || "Couldn't save the edit.")
			}
		} catch {
			toast.error("Couldn't save the edit.")
		} finally {
			setSavingEdit(false)
		}
	}

	// Deletes the item being viewed, then closes the viewer + refreshes the vault.
	const deleteViewing = async () => {
		if (!viewing) return
		try {
			const res = await bridge()?.removeBrainItem?.("skill", viewing.name)
			if (res?.ok) {
				toast.success(`Removed ${viewing.name}`)
				closeViewer()
				await refresh()
			} else {
				toast.error(res?.error || "Couldn't remove that item.")
			}
		} catch {
			toast.error("Couldn't remove that item.")
		}
	}

	const openOriginal = async () => {
		const p = viewMeta?.storedPath
		if (!p) return
		try {
			const res = await bridge()?.revealBrainItem?.(p)
			if (res && !res.ok) toast.error(res.error || "Couldn't open the file.")
		} catch {
			toast.error("Couldn't open the file.")
		}
	}

	const renderViewer = () => {
		if (!viewing) return null
		const displayType = (viewMeta?.type as BrainVaultEntry["type"]) || viewing.type
		const meta = VAULT_TYPE_META[displayType] ?? VAULT_TYPE_META.skill
		const Icon = meta.icon
		return (
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="flex items-start gap-3">
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
						<Icon className={`size-4 ${meta.color}`} />
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="truncate font-semibold text-foreground text-lg">{viewing.name}</h2>
						<p className="text-muted-foreground text-xs">
							{meta.label.replace(/s$/, "")}
							{viewMeta?.reference ? " · reference" : ""}
						</p>
						{viewing.description && (
							<p className="mt-1 text-muted-foreground text-sm">{viewing.description}</p>
						)}
					</div>
				</div>

				{viewLoading ? (
					<div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
						<Loader2Icon className="size-4 animate-spin" /> Loading…
					</div>
				) : viewError || viewContent === null ? (
					<p className="py-8 text-center text-muted-foreground text-sm">Couldn't load content.</p>
				) : editing ? (
					<textarea
						value={editText}
						onChange={(e) => setEditText(e.target.value)}
						spellCheck={false}
						className="min-h-[16rem] w-full resize-y rounded-xl border border-border bg-card px-3 py-2 font-mono text-[12px] text-foreground leading-relaxed outline-none focus:ring-1 focus:ring-primary"
					/>
				) : (
					<pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-3 font-mono text-[12px] text-muted-foreground leading-relaxed">
						{viewContent}
					</pre>
				)}

				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={closeViewer}
							className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
						>
							Close
						</button>
						{viewMeta?.reference && viewMeta.storedPath && (
							<button
								type="button"
								onClick={() => void openOriginal()}
								className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
							>
								<FileTextIcon className="size-3.5" /> Open original file
							</button>
						)}
					</div>
					<div className="flex items-center gap-2">
						{!viewLoading && !viewError && viewContent !== null && (
							<>
								{editing ? (
									<>
										<button
											type="button"
											onClick={() => {
												setEditing(false)
												setEditText(viewContent)
											}}
											className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
										>
											Cancel
										</button>
										<button
											type="button"
											onClick={() => void saveEdit()}
											disabled={savingEdit}
											className="flex h-8 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-60"
										>
											{savingEdit ? "Saving…" : "Save"}
										</button>
									</>
								) : (
									<button
										type="button"
										onClick={() => setEditing(true)}
										className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
									>
										Edit
									</button>
								)}
							</>
						)}
						<button
							type="button"
							onClick={() => void deleteViewing()}
							className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400"
						>
							<Trash2Icon className="size-3.5" /> Delete
						</button>
					</div>
				</div>
			</div>
		)
	}

	// --- Clean panel (inline, replaces the vault list) ---
	const renderClean = () => {
		const anyCleanChecked = (cleanList ?? []).some((c) => cleanChecked[c.key])
		return (
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-foreground text-lg">Clean your Brain</h2>
					<p className="text-muted-foreground text-sm">
						{cleanScanning
							? "Scanning for dead and duplicate items…"
							: "Broken and duplicate items found. Untick anything you want to keep."}
					</p>
				</div>

				{cleanScanning ? (
					<div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
						<Loader2Icon className="size-4 animate-spin" /> Scanning…
					</div>
				) : (cleanList?.length ?? 0) === 0 ? (
					<p className="py-8 text-center text-muted-foreground text-sm">Nothing to clean 🎉</p>
				) : (
					<div className="flex flex-col gap-2">
						{(cleanList ?? []).map((c) => (
							<label
								key={c.key}
								className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3"
							>
								<input
									type="checkbox"
									checked={!!cleanChecked[c.key]}
									onChange={() =>
										setCleanChecked((prev) => ({ ...prev, [c.key]: !prev[c.key] }))
									}
									className="size-4 shrink-0 accent-primary"
								/>
								<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
									<Trash2Icon className="size-4 text-muted-foreground" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium text-foreground text-sm">{c.name}</div>
									<div className="truncate text-muted-foreground text-xs">{c.reason}</div>
								</div>
								<span
									className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] ${
										c.reason.startsWith("broken")
											? "bg-red-500/10 text-red-600 dark:text-red-400"
											: "bg-amber-500/10 text-amber-600 dark:text-amber-400"
									}`}
								>
									{c.reason.startsWith("broken") ? "broken" : "duplicate"}
								</span>
							</label>
						))}
					</div>
				)}

				<div className="flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={closeClean}
						className="flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40"
					>
						Cancel
					</button>
					{(cleanList?.length ?? 0) > 0 && (
						<button
							type="button"
							onClick={() => void removeCleanSelected()}
							disabled={cleanRemoving || !anyCleanChecked}
							className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-40"
						>
							<Trash2Icon className="size-3.5" />
							{cleanRemoving ? "Removing…" : "Remove selected"}
						</button>
					)}
				</div>
			</div>
		)
	}

	if (!entries) {
		return <p className="py-10 text-center text-muted-foreground text-sm">Loading the vault…</p>
	}

	// The Bring-it-Live setup screen (after a GitHub import) takes over the vault
	// surface until the user is done.
	if (liveManifest) {
		return (
			<BringItLiveView
				manifest={liveManifest}
				health={liveHealth}
				onDone={() => {
					setLiveManifest(null)
					setLiveHealth(null)
				}}
			/>
		)
	}

	// Share Brain wizard takes over the whole vault surface while open.
	if (wizardStep) {
		return renderWizard()
	}

	// Clean panel takes over the vault surface while open.
	if (cleanOpen) {
		return renderClean()
	}

	// Item viewer takes over the vault surface while open.
	if (viewing) {
		return renderViewer()
	}

	if (entries.length === 0) {
		return (
			<div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4">
				{actions}
				<p className="py-6 text-center text-muted-foreground text-sm">
					Nothing in the vault yet — add something from the Teach tab.
				</p>
			</div>
		)
	}

	// Summary strip — counts per type, only types that actually have entries.
	const counts = VAULT_TYPE_ORDER.map((t) => ({
		type: t,
		count: entries.filter((e) => e.type === t).length,
	})).filter((c) => c.count > 0)
	const summary = counts
		.map((c) => `${c.count} ${VAULT_TYPE_META[c.type].plural}`)
		.join(" · ")

	const filtered = filter === "all" ? entries : entries.filter((e) => e.type === filter)

	// Group into type "folders" (newest-first within each). `docs` splits
	// further into Docs / PDFs / Images by source extension via categoryOf.
	const sorted = [...filtered].sort((a, b) => b.addedAt - a.addedAt)
	const byCategory = new Map<VaultCategory, BrainVaultEntry[]>()
	for (const entry of sorted) {
		const cat = categoryOf(entry)
		const bucket = byCategory.get(cat)
		if (bucket) bucket.push(entry)
		else byCategory.set(cat, [entry])
	}

	// Registry tools/models fold into the Tools / Models folders. Gate them by
	// the active filter chip so filtering stays consistent (registry only has
	// tool/model kinds, no skill/docs).
	const regTools = registry.filter((r) => r.kind !== "model")
	const regModels = registry.filter((r) => r.kind === "model")
	const regToolsVisible = filter === "all" || filter === "software"
	const regModelsVisible = filter === "all" || filter === "model"

	const chips: { id: "all" | BrainVaultEntry["type"]; label: string }[] = [
		{ id: "all", label: "All" },
		...VAULT_TYPE_ORDER.map((t) => ({ id: t, label: VAULT_TYPE_META[t].label })),
	]

	// One vault-entry row — unchanged markup, extracted so every folder renders
	// it the same way. Icon/colour still keyed off the entry's own type.
	const vaultRow = (entry: BrainVaultEntry, key: string) => {
		const meta = VAULT_TYPE_META[entry.type]
		const Icon = meta.icon
		return (
			<div
				key={key}
				className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
			>
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
					<Icon className={`size-4 ${meta.color}`} />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium text-foreground text-sm">{entry.name}</div>
					{entry.description && (
						<div className="truncate text-muted-foreground text-xs">{entry.description}</div>
					)}
				</div>
				<button
					type="button"
					title="View / edit / delete"
					onClick={() => void openViewer(entry)}
					className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<EyeIcon className="size-4" />
				</button>
				{entry.type === "skill" && (
					<button
						type="button"
						title="Share to Community"
						onClick={() => void shareSkill(entry)}
						className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Share2Icon className="size-4" />
					</button>
				)}
				{entry.verified ? (
					<span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
						✓ verified
					</span>
				) : (
					<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
						unverified
					</span>
				)}
			</div>
		)
	}

	// One registry (tool/model) row — unchanged markup from the old
	// TOOLS & MODELS block, reused inside the Tools / Models folders.
	const registryRow = (entry: BrainRegistryEntry) => {
		const Icon = entry.kind === "model" ? CpuIcon : PackageIcon
		return (
			<div
				key={entry.id}
				className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
			>
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
					<Icon className="size-4 text-primary" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium text-foreground text-sm">{entry.name}</div>
					<code className="mt-0.5 inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
						{entry.command}
					</code>
				</div>
				{entry.verified ? (
					<span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
						✓ verified
					</span>
				) : (
					<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
						unverified
					</span>
				)}
			</div>
		)
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">{summary}</p>
				{actions}
			</div>

			<div className="flex flex-wrap items-center gap-1.5">
				{chips.map((chip) => {
					const active = filter === chip.id
					return (
						<button
							key={chip.id}
							type="button"
							onClick={() => setFilter(chip.id)}
							className={`rounded-full border px-3 py-1 text-xs transition-colors ${
								active
									? "border-primary text-primary"
									: "border-border text-muted-foreground hover:text-foreground"
							}`}
						>
							{chip.label}
						</button>
					)
				})}
			</div>

			<div className="flex flex-col gap-5">
				{VAULT_CATEGORY_ORDER.map((cat) => {
					const vaultItems = byCategory.get(cat) ?? []
					// Tools/Models folders also carry the registry entries (gated by
					// the active filter chip); every other folder is vault-only.
					const regItems =
						cat === "Tools"
							? regToolsVisible
								? regTools
								: []
							: cat === "Models"
								? regModelsVisible
									? regModels
									: []
								: []
					const count = vaultItems.length + regItems.length
					if (count === 0) return null
					return (
						<div key={cat} className="flex flex-col gap-2">
							<h2 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">
								{cat.toUpperCase()} · {count}
							</h2>
							{/* TODO: thumbnails once originals are preserved — the source
							    images aren't copied into the vault, so there's nothing to
							    preview yet. Until then the Images folder just lists rows
							    (a touch more compact) like every other folder. */}
							<div className={`flex flex-col ${cat === "Images" ? "gap-1.5" : "gap-2"}`}>
								{vaultItems.map((entry, i) => vaultRow(entry, `${entry.name}-${i}`))}
								{regItems.map((entry) => registryRow(entry))}
							</div>
						</div>
					)
				})}
			</div>

			{/* History — read-only, collapsible list of past jobs (episodes). */}
			<div className="flex flex-col gap-2 border-border/60 border-t pt-4">
				<button
					type="button"
					onClick={() => void toggleHistory()}
					className="flex items-center justify-between gap-2 text-left"
				>
					<span className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground/70 tracking-wider">
						<HistoryIcon className="size-3.5" /> HISTORY
					</span>
					<ChevronDownIcon
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${historyOpen ? "rotate-180" : ""}`}
					/>
				</button>
				{historyOpen &&
					(episodes === null ? (
						<p className="px-1 py-2 text-muted-foreground/60 text-xs">Loading…</p>
					) : episodes.length === 0 ? (
						<p className="px-1 py-2 text-muted-foreground/60 text-xs">
							No past jobs remembered yet.
						</p>
					) : (
						<div className="flex flex-col gap-2">
							{episodes.map((ep) => (
								<div
									key={ep.id}
									className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3"
								>
									<div className="flex items-center gap-2">
										<span className="min-w-0 flex-1 truncate text-foreground text-sm">
											{ep.task || "Untitled job"}
										</span>
										<span
											className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] ${
												ep.outcome === "success"
													? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
													: ep.outcome === "failed"
														? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
														: "bg-muted text-muted-foreground"
											}`}
										>
											{ep.outcome}
										</span>
										<span className="shrink-0 text-[11px] text-muted-foreground/60">
											{relativeTime(ep.timestamp)}
										</span>
									</div>
									{ep.lesson && (
										<p className="text-muted-foreground text-xs leading-snug">{ep.lesson}</p>
									)}
								</div>
							))}
						</div>
					))}
			</div>
		</div>
	)
}

// The brain at the centre with feed-cards flanking both sides, joined by curved
// SVG lines drawn from the brain's edge to each card. Positions are measured
// from the real DOM (and re-measured on resize), so the lines stay attached
// however the layout wraps.
type BrainLine = { d: string; cx: number; cy: number; ax: number; ay: number }

function BrainCluster({ renderArm, pulse = 0 }: { renderArm: (id: string) => React.ReactNode; pulse?: number }) {
	const clusterRef = useRef<HTMLDivElement>(null)
	const brainRef = useRef<HTMLDivElement>(null)
	const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
	const [lines, setLines] = useState<BrainLine[]>([])
	const [flowing, setFlowing] = useState(true)
	// Loop: the cube plays its full traced motion, very slowly dissolves into the
	// neural brain, holds, then dissolves back to the cube. Reduced-motion rests
	// on the brain.
	const [showBrain, setShowBrain] = useState(false)
	useEffect(() => {
		if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setShowBrain(true)
			return
		}
		let timer: ReturnType<typeof setTimeout>
		let brain = false
		const tick = () => {
			brain = !brain
			setShowBrain(brain)
			// cube phase = one full traced-motion cycle; brain phase = a calm hold
			timer = setTimeout(tick, brain ? 5000 : 8710)
		}
		// Start on the cube; flip to the brain after it completes a full cycle.
		timer = setTimeout(tick, 8710)
		return () => clearTimeout(timer)
	}, [])
	const left = ["skill", "tool", "rules", "files"]
	const right = ["repo", "docs", "connect"]

	// Fan the cards: the further a card sits from its column's middle, the
	// further it's nudged out horizontally, so each column bows toward the brain
	// instead of standing as a flat stack.
	const offsetFor = (col: string[], i: number, dir: 1 | -1) => {
		const center = (col.length - 1) / 2
		return dir * (10 + Math.abs(i - center) * 20)
	}

	useEffect(() => {
		const compute = () => {
			const cluster = clusterRef.current
			const brain = brainRef.current
			if (!cluster || !brain) return
			const c = cluster.getBoundingClientRect()
			const b = brain.getBoundingClientRect()
				const brainTop = b.top - c.top
				const faceH = b.height
				const next: BrainLine[] = []
				// Fan each column's lines out of DISTINCT points along the brain's edge
				// so they never stack at the centre, then draw a smooth S-curve.
				const build = (ids: string[], isLeft: boolean) => {
					const brainX = (isLeft ? b.left : b.right) - c.left
					const n = ids.length
					ids.forEach((id, i) => {
						const el = cardRefs.current[id]
						if (!el) return
						const r = el.getBoundingClientRect()
						const cardX = (isLeft ? r.right : r.left) - c.left
						const cardY = r.top + r.height / 2 - c.top
						const t = n === 1 ? 0.5 : 0.2 + 0.6 * (i / (n - 1))
						const anchorY = brainTop + faceH * t
						const dx = Math.max(30, Math.abs(cardX - brainX) * 0.5)
						const c1x = isLeft ? brainX - dx : brainX + dx
						const c2x = isLeft ? cardX + dx : cardX - dx
						const d = `M ${brainX.toFixed(1)} ${anchorY.toFixed(1)} C ${c1x.toFixed(1)} ${anchorY.toFixed(1)} ${c2x.toFixed(1)} ${cardY.toFixed(1)} ${cardX.toFixed(1)} ${cardY.toFixed(1)}`
						next.push({ d, cx: cardX, cy: cardY, ax: brainX, ay: anchorY })
					})
				}
				build(left, true)
				build(right, false)
				setLines(next)
		}
		const raf = requestAnimationFrame(compute)
		const ro = new ResizeObserver(compute)
		if (clusterRef.current) ro.observe(clusterRef.current)
		window.addEventListener("resize", compute)
		return () => {
			cancelAnimationFrame(raf)
			ro.disconnect()
			window.removeEventListener("resize", compute)
		}
	}, [])

	// Pulse the "current" on mount and every time the brain is fed, then settle.
	useEffect(() => {
		setFlowing(true)
		const t = setTimeout(() => setFlowing(false), 5000)
		return () => clearTimeout(t)
	}, [pulse])

	const col = (ids: string[], dir: 1 | -1) => (
		<div className="relative z-10 flex flex-col gap-6">
			{ids.map((id, i) => (
				<div
					key={id}
					ref={(el) => {
						cardRefs.current[id] = el
					}}
					style={{ transform: `translateX(${offsetFor(ids, i, dir)}px)` }}
				>
					{renderArm(id)}
				</div>
			))}
		</div>
	)

	return (
		<div ref={clusterRef} className="relative flex flex-wrap items-center justify-center gap-12">
			<svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
				<title>Brain connections</title>
				<defs>
					<linearGradient id="brain-line" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0%" stopColor="#2B6CFF" stopOpacity={0.15} />
						<stop offset="50%" stopColor="#2B6CFF" stopOpacity={0.55} />
						<stop offset="100%" stopColor="#2B6CFF" stopOpacity={0.15} />
					</linearGradient>
				</defs>
				{/* soft glow underlay */}
				{lines.map((l, i) => (
					<path key={`g${i}`} d={l.d} fill="none" stroke="#2B6CFF" strokeWidth={6} strokeOpacity={0.06} strokeLinecap="round" strokeLinejoin="round" />
				))}
				{/* base line */}
				{lines.map((l, i) => (
					<path key={`b${i}`} d={l.d} fill="none" stroke="url(#brain-line)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
				))}
				{/* flowing current — a bright dash travelling toward the brain, only while active */}
				{flowing &&
					lines.map((l, i) => (
						<path key={`c${i}`} d={l.d} fill="none" stroke="#2B6CFF" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="5 260">
							<animate attributeName="stroke-dashoffset" from={0} to={265} dur="1.4s" repeatCount="indefinite" />
							<animate attributeName="stroke-opacity" values="0;0.9;0" dur="1.4s" repeatCount="indefinite" />
						</path>
					))}
				{/* connection dots at each card */}
				{lines.map((l, i) => (
					<circle key={`d${i}`} cx={l.cx} cy={l.cy} r={2.5} fill="#2B6CFF" fillOpacity={0.7} />
				))}
					{/* anchor dots at the brain edge */}
					{lines.map((l, i) => (
						<circle key={`a${i}`} cx={l.ax} cy={l.ay} r={2} fill="#2B6CFF" fillOpacity={0.5} />
					))}
			</svg>
			{col(left, -1)}
			<div
				ref={brainRef}
				className="relative z-10 flex size-36 items-center justify-center"
			>
				<BrainTracedIcon
						className={`absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-[4000ms] ${showBrain ? "opacity-0" : "opacity-100"}`}
					/>
					<div
						className={`absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-[4000ms] ${showBrain ? "opacity-100" : "opacity-0"}`}
					>
						<img
							src={brainNeural}
							alt=""
							draggable={false}
							className="brain-glow-pulse h-full w-full object-contain"
						/>
						{/* Light "current" travelling over the brain's blue lines. */}
						<div
							aria-hidden="true"
							className="brain-current-sweep pointer-events-none absolute inset-0"
							style={{ WebkitMaskImage: `url(${brainNeural})`, maskImage: `url(${brainNeural})` }}
						/>
					</div>
			</div>
			{col(right, 1)}
		</div>
	)
}

export function BrainPage() {
	const [brainSession, setBrainSession] = useAtom(brainSessionAtom)
	const [, setBrainSessionIds] = useAtom(brainSessionIdsAtom)
	const { createSession, sendPrompt } = useAgentActions()
	const { setContent, setFooter } = useSetSidebarSlot()
	const navigate = useNavigate()

	useEffect(() => {
		setContent(<BrainSidebarContent />)
		setFooter(<BrainSidebarFooter />)
		return () => {
			setContent(null)
			setFooter(null)
		}
	}, [setContent, setFooter])
	const [input, setInput] = useState("")
	const [starting, setStarting] = useState(false)
	const [tab, setTab] = useState<"teach" | "vault">("teach")
	// Which vault flow the hero toolbar asked to open on landing (null = none).
	// Consumed + cleared by BrainVaultView via onVaultActionHandled.
	const [vaultAction, setVaultAction] = useState<null | "open" | "share" | "import" | "clean">(null)
	// Bumped whenever the brain is fed, so the connector "current" pulses.
	const [feedPulse, setFeedPulse] = useState(0)
	// Folder chosen for the Files arm, held pending confirmation before a scan starts.
	const [pendingScanDir, setPendingScanDir] = useState<string | null>(null)
	// Local file picked in the Docs arm, held so the user first chooses Extract vs
	// Keep-as-reference (no chat opens until they pick). null = no choice pending.
	const [pendingDocFile, setPendingDocFile] = useState<string | null>(null)
	const [savingRef, setSavingRef] = useState(false)
	const [refError, setRefError] = useState<string | null>(null)
	// Slug of the last file saved as a reference — shown briefly, then cleared.
	const [refSaved, setRefSaved] = useState<string | null>(null)

	const start = async (text: string) => {
		const t = text.trim()
		if (!t || starting) return
		setFeedPulse((p) => p + 1)
		setStarting(true)
		try {
			const dir = await bridge().getBrainDir()
			const session = await createSession(dir, "Brain session")
			if (!session) return
			await sendPrompt(dir, session.id, t, { agent: "general" })
			setBrainSessionIds((prev) => [session.id, ...prev.filter((id) => id !== session.id)].slice(0, 50))
			setBrainSession(session.id)
			setInput("")
		} finally {
			setStarting(false)
		}
	}

	// Active conversation — reuse the full chat surface (already generic).
	if (brainSession) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center justify-between border-border border-b px-4 py-2">
					<span className="font-medium text-sm">Brain</span>
					<button
						type="button"
						onClick={() => setBrainSession(null)}
						className="rounded-md px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
					>
						New session
					</button>
				</div>
				<div className="min-h-0 flex-1">
					<HomeConversation sessionId={brainSession} />
				</div>
			</div>
		)
	}

	// The app-side action for an "action" arm (button cards, no free-text input).
	const runArmAction = async (action: "connect" | "files") => {
		if (action === "connect") {
			navigate({ to: "/settings/connectors" })
			return
		}
		// Files — pick a local folder, then confirm before kicking off a scan session.
		const dir = await bridge().pickDirectory()
		if (!dir) return
		setPendingScanDir(dir)
	}

	// Prompt run once the user confirms the picked folder scan.
	const startScan = (dir: string) => {
		setPendingScanDir(null)
		void start(
			`Look through the files in ${dir} to learn my coding style, conventions, and patterns. Save what you learn with create_skill (type: "skill", named like a style guide) so future sessions match how I write. Then summarise in one line what you picked up.`,
		)
	}

	// Browse for a local document (Docs arm). Instead of opening a chat straight
	// away, hold the picked path so the user first chooses how to feed it (extract
	// the knowledge into a skill, or keep the whole file as a reference).
	const browseArmFile = async (_arm: BrainArm) => {
		const p = await bridge()?.pickDocFile?.()
		if (!p) return
		setRefError(null)
		setRefSaved(null)
		setPendingDocFile(p)
	}

	// Extract choice — the original behaviour: open a chat that reads the file and
	// extracts its reusable knowledge into a skill.
	const extractPendingDoc = () => {
		const p = pendingDocFile
		setPendingDocFile(null)
		if (p) void start(docsFilePrompt(p))
	}

	// Keep-as-reference choice — copy the whole file into the Brain verbatim, no
	// chat. The vault refreshes on its own when the user switches to that tab.
	const keepPendingDocAsReference = async () => {
		const p = pendingDocFile
		if (!p || savingRef) return
		setSavingRef(true)
		setRefError(null)
		try {
			const res = await bridge()?.saveBrainReference?.(p)
			if (res?.ok) {
				setPendingDocFile(null)
				setRefSaved(res.slug || "reference")
				window.setTimeout(() => setRefSaved(null), 6000)
			} else {
				setRefError(res?.error || "Couldn't save to Brain.")
			}
		} catch {
			setRefError("Couldn't save to Brain.")
		} finally {
			setSavingRef(false)
		}
	}

	// Auto-detect when the free-text bar holds JUST a link or JUST a path, and
	// route it through the same verified prompt the matching arm uses — instead
	// of firing it off as plain free-form text. A sentence with real words is
	// respected as-is (falls back to `start`).
	const routeFreeText = async (raw: string) => {
		const token = raw.trim()
		if (!token) return
		// Only treat it as a "lone token" when there's no internal whitespace —
		// one URL or one path, nothing else. Otherwise honour the user's words.
		if (/\s/.test(token)) {
			void start(raw)
			return
		}

		// (a) Git repo URL — a *.git link, or a github/gitlab/bitbucket /user/repo.
		const isGitHost = /^(https?:\/\/)?(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+/i.test(token)
		if (/\.git($|\?)/.test(token) || isGitHost) {
			const arm = BRAIN_ARMS.find((a) => a.id === "repo")
			if (arm) {
				const prompt = arm.preprocess ? await arm.preprocess(token) : (arm.prompt?.(token) ?? token)
				void start(prompt)
				return
			}
		}

		// Local path (absolute, home-relative, or file://). Strip a file:// prefix.
		const isFileUrl = /^file:\/\//i.test(token)
		const localPath = isFileUrl ? token.replace(/^file:\/\//i, "") : token
		const isLocalPath = isFileUrl || /^[~/]/.test(token)
		if (isLocalPath) {
			// (b) Doc file — an absolute path ending in a known document extension.
			if (/\.(pdf|txt|md|markdown|docx|rtf)$/i.test(localPath)) {
				const arm = BRAIN_ARMS.find((a) => a.id === "docs")
				if (arm?.filePrompt) {
					void start(arm.filePrompt(localPath))
					return
				}
			}
			// (c) Folder — no file extension, or a trailing slash. Reuse the guard.
			setPendingScanDir(localPath)
			setInput("")
			return
		}

		// (d) Any other http(s) URL — unsure if it's a skill, docs, or a tool.
		// Route through a universal "absorb this link" verified prompt.
		if (/^https?:\/\//i.test(token)) {
			void start(
				`Absorb this link and add it to my Brain: ${token}\n\nFirst figure out what it actually is — a reusable skill, a documentation/reference page, or an installable tool — then set it up appropriately. If it's runnable, actually run it once on a small test to confirm it genuinely works. Then save it with create_skill using the correct type ("skill" | "docs" | "software") and source: "${token}", marking verified: true ONLY if a real test passed (otherwise verified: false and tell me exactly what failed). If it turned out to be a runnable tool, also call register_brain_tool with the real invocation command. Finally, tell me in one line what you saved.`,
			)
			return
		}

		// (e) Anything else — bare text that isn't a URL/path. Respect the words.
		void start(raw)
	}

	// Opening screen — the brain in a box with its "arms" (feed cards) flanking it.
	const armCard = (id: string) => {
		const arm = BRAIN_ARMS.find((a) => a.id === id)
		if (!arm) return null
		return (
			<BrainArmCard
				arm={arm}
				disabled={starting}
				onSubmit={(p) => void start(p)}
				onAction={arm.action ? () => runArmAction(arm.action as "connect" | "files") : undefined}
				onBrowse={arm.browseFile ? () => browseArmFile(arm) : undefined}
			/>
		)
	}

	return (
		<div className="flex h-full flex-col items-center gap-8 overflow-y-auto p-6">
			{/* Teach (the four arms) vs Vault (what's already been added). */}
			<div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
				<button
					type="button"
					onClick={() => setTab("teach")}
					className={`rounded-md px-3 py-1 font-medium text-xs transition-colors ${
						tab === "teach" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
					}`}
				>
					Teach
				</button>
				<button
					type="button"
					onClick={() => setTab("vault")}
					className={`rounded-md px-3 py-1 font-medium text-xs transition-colors ${
						tab === "vault" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
					}`}
				>
					Vault
				</button>
			</div>

			{tab === "vault" ? (
				<BrainVaultView
					onTeach={(p) => void start(p)}
					vaultAction={vaultAction}
					onVaultActionHandled={() => setVaultAction(null)}
				/>
			) : (
				<div className="flex w-full flex-1 flex-col items-center justify-center gap-8">
					<div className="text-center">
						<h1 className="text-balance font-semibold text-2xl text-foreground">Teach your Brain</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							A growing local library of skills, tools and connections — private to this machine.
						</p>
					</div>

					{/* Brain at the centre, connected to its feed-arms by curved lines. */}
					<BrainCluster renderArm={armCard} pulse={feedPulse} />

					{/* Quick toolbar — jumps to the Vault tab and opens the matching
					    existing flow (Vault list / Share wizard / GitHub import / Clean). */}
					<div className="flex flex-wrap items-center justify-center gap-2">
						{(
							[
								{ action: "open", label: "Vault", icon: ArchiveIcon },
								{ action: "share", label: "Share", icon: Share2Icon },
								{ action: "import", label: "Import", icon: DownloadIcon },
								{ action: "clean", label: "Clean", icon: Trash2Icon },
							] as const
						).map(({ action, label, icon: Icon }) => (
							<button
								key={action}
								type="button"
								onClick={() => {
									setVaultAction(action)
									setTab("vault")
								}}
								className="flex h-9 items-center gap-1.5 rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] font-medium text-foreground transition-colors hover:border-[#5B8FFF] hover:text-[#5B8FFF] dark:border-border dark:bg-card"
							>
								<Icon className="size-4 text-[#5B8FFF]" />
								{label}
							</button>
						))}
					</div>

					{/* Docs arm — after a LOCAL file is picked, choose how to feed it
					    before any chat opens: extract its knowledge, or keep it whole. */}
					{pendingDocFile && (
						<div className="w-full max-w-xl rounded-2xl border border-border bg-popover p-4 shadow-sm">
							<div className="flex items-center gap-2">
								<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
									<BookOpenIcon className="size-3.5" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground text-sm">How should the Brain take this in?</div>
									<div className="truncate text-muted-foreground text-xs" title={pendingDocFile}>
										{pendingDocFile.split(/[\\/]/).pop()}
									</div>
								</div>
								<button
									type="button"
									title="Cancel"
									onClick={() => {
										setPendingDocFile(null)
										setRefError(null)
									}}
									disabled={savingRef}
									className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
								>
									<XIcon className="size-4" />
								</button>
							</div>
							<div className="mt-3 flex items-center gap-2">
								<button
									type="button"
									onClick={extractPendingDoc}
									disabled={savingRef}
									className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
								>
									<SparklesIcon className="size-3.5" /> Extract knowledge
								</button>
								<button
									type="button"
									onClick={() => void keepPendingDocAsReference()}
									disabled={savingRef}
									className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
								>
									{savingRef ? (
										<>
											<Loader2Icon className="size-3.5 animate-spin" /> Saving…
										</>
									) : (
										<>
											<BookOpenIcon className="size-3.5" /> Keep as reference
										</>
									)}
								</button>
							</div>
							<div className="mt-2 text-[11px] text-muted-foreground/70 leading-snug">
								Extract opens a chat that reads it and saves what it learns. Keep as reference
								copies the whole file into your Brain — no chat.
							</div>
							{refError && <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{refError}</div>}
						</div>
					)}

					{/* Brief confirmation after a file is kept as a reference. */}
					{refSaved && !pendingDocFile && (
						<div className="flex w-full max-w-xl items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
							<CheckIcon className="size-4 shrink-0 text-emerald-500" />
							<span className="min-w-0 flex-1 truncate text-emerald-700 text-xs dark:text-emerald-400">
								Saved to Brain: {refSaved}
							</span>
							<span className="shrink-0 text-[11px] text-muted-foreground/70">See it in the Vault tab</span>
						</div>
					)}

					{/* Still allow free-form teaching by chat, secondary to the cards. */}
					<div className="w-full max-w-xl">
						<textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault()
									void routeFreeText(input)
								}
							}}
							rows={2}
							disabled={starting}
							placeholder="…or just teach the Brain something in your own words"
							className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
						/>
					</div>
				</div>
			)}

			{/* Confirm guard so a mis-picked folder doesn't kick off a big scan session. */}
			{pendingScanDir && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
					<div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-popover p-5 text-foreground shadow-xl">
						<h2 className="font-semibold text-base">Learn coding style from this folder?</h2>
						<p
							className="mt-2 truncate rounded-lg border border-border bg-card px-3 py-2 font-mono text-muted-foreground text-xs"
							title={pendingScanDir}
						>
							{pendingScanDir}
						</p>
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setPendingScanDir(null)}
								className="rounded-lg px-3 py-1.5 font-medium text-muted-foreground text-sm hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => startScan(pendingScanDir)}
								className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:bg-primary/90"
							>
								Start
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
