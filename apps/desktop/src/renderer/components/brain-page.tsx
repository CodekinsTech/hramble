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
import { ArrowRightIcon, CpuIcon, GitBranchIcon, PackageIcon, PlusIcon, SettingsIcon, SparklesIcon } from "lucide-react"
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

// The four "arms" of the Brain — each a distinct way to feed it, each taking a
// pasted link/path and turning it into a Brain session with the right instruction.
type BrainArm = {
	id: string
	name: string
	icon: typeof PlusIcon
	placeholder: string
	prompt: (link: string) => string
}

const BRAIN_ARMS: BrainArm[] = [
	{
		id: "skill",
		name: "Skill",
		icon: SparklesIcon,
		placeholder: "Paste a skill link…",
		prompt: (l) => `Add this skill to your local library, then tell me in one line what it does: ${l}`,
	},
	{
		id: "repo",
		name: "Git Repo",
		icon: GitBranchIcon,
		placeholder: "Paste a repo URL…",
		prompt: (l) =>
			`Absorb this git repo — read it, then turn it into a reusable skill or a callable tool (whichever fits), and confirm what you saved: ${l}`,
	},
	{
		id: "software",
		name: "Software",
		icon: PackageIcon,
		placeholder: "Paste an app/tool link…",
		prompt: (l) => `Learn to use this software/tool, then save how to use it as a skill: ${l}`,
	},
	{
		id: "model",
		name: "Model",
		icon: CpuIcon,
		placeholder: "Paste a model link…",
		prompt: (l) => `Set up this local model as a capability I can call, and save how to use it: ${l}`,
	},
]

function BrainArmCard({
	arm,
	disabled,
	onSubmit,
	className,
}: {
	arm: BrainArm
	disabled: boolean
	onSubmit: (prompt: string) => void
	className?: string
}) {
	const [val, setVal] = useState("")
	const Icon = arm.icon
	const submit = () => {
		const t = val.trim()
		if (!t || disabled) return
		onSubmit(arm.prompt(t))
		setVal("")
	}
	return (
		<div className={`flex w-48 flex-col gap-2 rounded-xl border border-border bg-card p-3 ${className ?? ""}`}>
			<div className="flex items-center gap-1.5">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Icon className="size-3.5" />
				</div>
				<span className="font-medium text-foreground text-xs">{arm.name}</span>
			</div>
			<div className="flex gap-1">
				<input
					value={val}
					onChange={(e) => setVal(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							submit()
						}
					}}
					disabled={disabled}
					placeholder={arm.placeholder}
					className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
				/>
				<button
					type="button"
					onClick={submit}
					disabled={disabled || !val.trim()}
					className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
				>
					<ArrowRightIcon className="size-3.5" />
				</button>
			</div>
		</div>
	)
}

export function BrainPage() {
	const [brainSession, setBrainSession] = useAtom(brainSessionAtom)
	const [, setBrainSessionIds] = useAtom(brainSessionIdsAtom)
	const { createSession, sendPrompt } = useAgentActions()
	const { setContent, setFooter } = useSetSidebarSlot()

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

	// Opening screen — the brain in a box, with four "arms" (input cards)
	// branching off it, one per way of feeding it (skill / repo / software / model).
	const armCard = (id: string, className: string) => {
		const arm = BRAIN_ARMS.find((a) => a.id === id)
		if (!arm) return null
		return <BrainArmCard arm={arm} disabled={starting} onSubmit={(p) => void start(p)} className={className} />
	}

	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-6">
			<div className="text-center">
				<h1 className="text-balance font-semibold text-2xl text-foreground">Teach your Brain</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					A growing local library of skills and tools — private to this machine.
				</p>
			</div>

			{/* Brain at the centre, four arm-cards around it in a plus/cross layout. */}
			<div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-4">
				<div className="col-start-2 row-start-1">{armCard("skill", "")}</div>
				<div className="col-start-1 row-start-2">{armCard("repo", "")}</div>
				<div className="col-start-2 row-start-2 flex size-48 items-center justify-center rounded-3xl border border-border bg-card">
					<BrainTracedIcon className="h-40 w-40" />
				</div>
				<div className="col-start-3 row-start-2">{armCard("software", "")}</div>
				<div className="col-start-2 row-start-3">{armCard("model", "")}</div>
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
	)
}
