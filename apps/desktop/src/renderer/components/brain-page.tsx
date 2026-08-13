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
	ArrowRightIcon,
	BookOpenIcon,
	CpuIcon,
	DownloadIcon,
	FolderIcon,
	GitBranchIcon,
	ListChecksIcon,
	PackageIcon,
	PlugIcon,
	PlusIcon,
	SettingsIcon,
	Share2Icon,
	SparklesIcon,
	UploadIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { agentFamily } from "../atoms/derived/agents"
import { brainSessionAtom, brainSessionIdsAtom } from "../atoms/brain"
import {
	communityBackendEnabledAtom,
	type CommunityPost,
	communityPostsAtom,
	communityUserAtom,
} from "../atoms/community"
import { workspaceModeAtom } from "../atoms/workspace"
import { createCommunityPost } from "../lib/community-client"
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
	const brainSessionIds = useAtomValue(brainSessionIdsAtom)
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

// --- Share Brain wizard types ---
type ScanStatus = "ok" | "warn" | "dead"

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
}

const BRAIN_ARMS: BrainArm[] = [
	{
		id: "skill",
		name: "Skill",
		icon: SparklesIcon,
		placeholder: "Paste a skill link…",
		prompt: (l) =>
			`Add this skill to your local library: ${l}\n\nThen actually try it once on a small test to confirm it genuinely works. Only if the test passes, call create_skill with type: "skill", source: "${l}", and verified: true. If the test fails, tell me exactly what went wrong and save it with verified: false (or not at all) — do not claim success. Finally, tell me in one line what it does.`,
	},
	{
		id: "repo",
		name: "Git Repo",
		icon: GitBranchIcon,
		placeholder: "Paste a repo URL…",
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
		prompt: (v) =>
			`Install the command-line tool "${v}" using whatever package manager fits this machine (brew, npm, cargo, pip, etc.). Then actually run it once on a small test to confirm it genuinely works. Only if that passes, call create_skill with type: "software", source: "${v}", and verified: true, saving how to use it — AND also call register_brain_tool with kind: "tool" and the real invocation command (e.g. how you actually ran it). If you can't install it or the test fails, tell me exactly what went wrong and don't claim success.`,
	},
	{
		id: "docs",
		name: "Docs",
		icon: BookOpenIcon,
		placeholder: "Paste a doc / API / page URL…",
		prompt: (l) =>
			`Read the documentation / reference at ${l} and extract the key, reusable knowledge from it (how the API/tool/library actually works, the important endpoints/options/gotchas). Save it with create_skill using type: "docs" and source: "${l}", so future sessions can use it without guessing. Then tell me in one line what it covers.`,
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
		prompt: (v) =>
			`Save this as a standing rule you always follow from now on: "${v}". Store it with create_skill (type: "skill", named like a rule) so it's applied in future sessions, then confirm it's saved.`,
	},
]

function BrainArmCard({
	arm,
	disabled,
	onSubmit,
	onAction,
	className,
}: {
	arm: BrainArm
	disabled: boolean
	onSubmit: (prompt: string) => void
	onAction?: () => void | Promise<void>
	className?: string
}) {
	const [val, setVal] = useState("")
	const [busy, setBusy] = useState(false)
	const Icon = arm.icon
	const isDisabled = disabled || busy
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
					<button
						type="button"
						onClick={() => void submit()}
						disabled={isDisabled || !val.trim()}
						className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
					>
						<ArrowRightIcon className="size-3.5" />
					</button>
				</div>
			)}
		</div>
	)
}

/** The Vault — a browsable record of everything that's been added to the Brain. */
function BrainVaultView({ onTeach }: { onTeach: (prompt: string) => void }) {
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
		<div className="flex items-center gap-2">
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
			return `Some items in my Brain failed a health check. Work through each one and fix it:\n\n${list}\n\nFor each item: find the doc/tool's new location or URL if it moved, refresh a changed or missing install command, or otherwise re-verify it works. Update the ACTUAL skill files and registry entries — call create_skill (for skills/docs/repos/software) or register_brain_tool (for tools/models) with the corrected source/command, and mark verified: true ONLY after you actually confirm it works. If something genuinely can't be fixed (permanently gone), say so plainly and leave it unverified — do NOT invent success or claim you fixed something you didn't. When done, tell me what you fixed and what you couldn't.`
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

	if (!entries) {
		return <p className="py-10 text-center text-muted-foreground text-sm">Loading the vault…</p>
	}

	// Share Brain wizard takes over the whole vault surface while open.
	if (wizardStep) {
		return renderWizard()
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

	// Group by month, newest first.
	const sorted = [...filtered].sort((a, b) => b.addedAt - a.addedAt)
	const groups: { key: string; label: string; items: BrainVaultEntry[] }[] = []
	for (const entry of sorted) {
		const d = new Date(entry.addedAt)
		const key = `${d.getFullYear()}-${d.getMonth()}`
		const label = d.toLocaleString("en-US", { month: "long", year: "numeric" }).toUpperCase()
		const group = groups.find((g) => g.key === key)
		if (group) group.items.push(entry)
		else groups.push({ key, label, items: [entry] })
	}

	const chips: { id: "all" | BrainVaultEntry["type"]; label: string }[] = [
		{ id: "all", label: "All" },
		...VAULT_TYPE_ORDER.map((t) => ({ id: t, label: VAULT_TYPE_META[t].label })),
	]

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
				{groups.map((group) => (
					<div key={group.key} className="flex flex-col gap-2">
						<h2 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">
							{group.label}
						</h2>
						<div className="flex flex-col gap-2">
							{group.items.map((entry, i) => {
								const meta = VAULT_TYPE_META[entry.type]
								const Icon = meta.icon
								return (
									<div
										key={`${entry.name}-${i}`}
										className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
									>
										<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
											<Icon className={`size-4 ${meta.color}`} />
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium text-foreground text-sm">{entry.name}</div>
											{entry.description && (
												<div className="truncate text-muted-foreground text-xs">
													{entry.description}
												</div>
											)}
										</div>
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
							})}
						</div>
					</div>
				))}
			</div>

			{registry.length > 0 && (
				<div className="flex flex-col gap-2">
					<h2 className="font-medium text-[11px] text-muted-foreground/70 tracking-wider">TOOLS & MODELS</h2>
					<div className="flex flex-col gap-2">
						{registry.map((entry) => {
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
						})}
					</div>
				</div>
			)}
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

	const start = async (text: string) => {
		const t = text.trim()
		if (!t || starting) return
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
		// Files — pick a local folder for the Brain to learn the user's style from.
		const dir = await bridge().pickDirectory()
		if (!dir) return
		await start(
			`Look through the files in ${dir} to learn my coding style, conventions, and patterns. Save what you learn with create_skill (type: "skill", named like a style guide) so future sessions match how I write. Then summarise in one line what you picked up.`,
		)
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
				<BrainVaultView onTeach={(p) => void start(p)} />
			) : (
				<div className="flex w-full flex-1 flex-col items-center justify-center gap-8">
					<div className="text-center">
						<h1 className="text-balance font-semibold text-2xl text-foreground">Teach your Brain</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							A growing local library of skills, tools and connections — private to this machine.
						</p>
					</div>

					{/* Brain at the centre with its feed-arms flanking both sides. */}
					<div className="flex flex-wrap items-center justify-center gap-5">
						<div className="flex flex-col gap-4">
							{armCard("skill")}
							{armCard("tool")}
							{armCard("rules")}
							{armCard("files")}
						</div>
						<div className="flex size-48 items-center justify-center rounded-3xl border border-border bg-card">
							<BrainTracedIcon className="h-40 w-40" />
						</div>
						<div className="flex flex-col gap-4">
							{armCard("repo")}
							{armCard("docs")}
							{armCard("connect")}
						</div>
					</div>

					{/* Still allow free-form teaching by chat, secondary to the cards. */}
					<div className="w-full max-w-xl">
						<textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault()
									void start(input)
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
		</div>
	)
}
