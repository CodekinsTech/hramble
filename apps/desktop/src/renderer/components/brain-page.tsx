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
	FolderIcon,
	GitBranchIcon,
	ListChecksIcon,
	PackageIcon,
	PlugIcon,
	PlusIcon,
	SettingsIcon,
	SparklesIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { agentFamily } from "../atoms/derived/agents"
import { brainSessionAtom, brainSessionIdsAtom } from "../atoms/brain"
import { workspaceModeAtom } from "../atoms/workspace"
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
function BrainVaultView() {
	const [entries, setEntries] = useState<BrainVaultEntry[] | null>(null)
	const [registry, setRegistry] = useState<BrainRegistryEntry[]>([])
	const [filter, setFilter] = useState<"all" | BrainVaultEntry["type"]>("all")

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const list = (await bridge()?.getBrainVault?.()) as BrainVaultEntry[] | undefined
				if (!cancelled) setEntries(list ?? [])
			} catch {
				// No Electron bridge (e.g. dev:web preview) or IPC failure — show
				// the empty state rather than spinning on "Loading…" forever.
				if (!cancelled) setEntries([])
			}
			try {
				const list = (await bridge()?.getBrainRegistry?.()) as BrainRegistryEntry[] | undefined
				if (!cancelled) setRegistry(list ?? [])
			} catch {
				if (!cancelled) setRegistry([])
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	if (!entries) {
		return <p className="py-10 text-center text-muted-foreground text-sm">Loading the vault…</p>
	}

	if (entries.length === 0) {
		return (
			<p className="py-10 text-center text-muted-foreground text-sm">
				Nothing in the vault yet — add something from the Teach tab.
			</p>
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
			<p className="text-muted-foreground text-sm">{summary}</p>

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
				<BrainVaultView />
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
