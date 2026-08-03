/**
 * Home — a general Claude-style chat page. Nothing to do with Code or Hyperloop:
 * it's a plain assistant conversation powered by the "general" agent in a
 * dedicated home directory (no repo). Reuses SessionView for the actual
 * streaming conversation once a chat has started.
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
import { PlusIcon, SettingsIcon } from "lucide-react"
import { useEffect } from "react"
import { useState } from "react"
import { homeSessionAtom, homeSessionIdsAtom } from "../atoms/home"
import { agentFamily } from "../atoms/derived/agents"
import { workspaceModeAtom } from "../atoms/workspace"
import { useAgentActions } from "../hooks/use-server"
import { HomeConversation } from "./home-conversation"
import { useSetSidebarSlot } from "./sidebar-slot-context"
import { WorkspaceSwitcher } from "./sidebar-layout"

/** Same Settings entry as the default sidebar footer, so it stays reachable from Home. */
function HomeSidebarFooter() {
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

/**
 * A single entry in the Home history list — its own title (from the session,
 * once named), independent of Code/Hyperloop sessions.
 */
function HomeHistoryItem({
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
				<span className="min-w-0 flex-1 truncate text-[13px]">{agent?.name || "Home chat"}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	)
}

/** Home's own sidebar — a plain chat history, no Code/Hyperloop concepts. */
function HomeSidebarContent() {
	const [homeSession, setHomeSession] = useAtom(homeSessionAtom)
	const homeSessionIds = useAtomValue(homeSessionIdsAtom)
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)
	const navigate = useNavigate()
	return (
		<>
			{/* Same Code/Hyperloop switcher as the default sidebar, so Home never
			 * strands the user — picking a mode leaves Home and returns to it. */}
			<WorkspaceSwitcher
				mode="code"
				onChange={(m) => {
					setWorkspaceMode(m)
					navigate({ to: "/" })
				}}
			/>
			<SidebarGroup>
				<SidebarGroupLabel>Home</SidebarGroupLabel>
			<div className="absolute top-3.5 right-3">
				<button
					type="button"
					title="New chat"
					onClick={() => setHomeSession(null)}
					className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
				>
					<PlusIcon className="size-4 shrink-0" />
				</button>
			</div>
			<SidebarGroupContent>
				<SidebarMenu>
					{homeSessionIds.map((id) => (
						<HomeHistoryItem
							key={id}
							id={id}
							isSelected={id === homeSession}
							onSelect={() => setHomeSession(id)}
						/>
					))}
					{homeSessionIds.length === 0 && (
						<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No chats yet</p>
					)}
				</SidebarMenu>
			</SidebarGroupContent>
			</SidebarGroup>
		</>
	)
}

const EXAMPLES = [
	"Explain a concept simply",
	"Draft a friendly email",
	"Brainstorm ideas with me",
	"Summarize some text",
]

export function HomeChat() {
	const [homeSession, setHomeSession] = useAtom(homeSessionAtom)
	const [, setHomeSessionIds] = useAtom(homeSessionIdsAtom)
	const { createSession, sendPrompt } = useAgentActions()
	const { setContent, setFooter } = useSetSidebarSlot()

	// Home is its own surface — while it's open, replace the sidebar with Home's
	// own history (and implicitly hide the Code/Hyperloop mode toggle, which is
	// gated on "no sidebar override"). Restore the default sidebar on leave.
	useEffect(() => {
		setContent(<HomeSidebarContent />)
		setFooter(<HomeSidebarFooter />)
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
			const dir = await window.hramble.getHomeDir()
			const session = await createSession(dir, "Home chat")
			if (!session) return
			// General assistant — no coding harness, no repo focus.
			await sendPrompt(dir, session.id, t, { agent: "general" })
			setHomeSessionIds((prev) => [session.id, ...prev.filter((id) => id !== session.id)].slice(0, 50))
			setHomeSession(session.id)
			setInput("")
		} finally {
			setStarting(false)
		}
	}

	// Active conversation — reuse the full chat surface.
	if (homeSession) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center justify-between border-border border-b px-4 py-2">
					<span className="font-medium text-sm">Home</span>
					<button
						type="button"
						onClick={() => setHomeSession(null)}
						className="rounded-md px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
					>
						New chat
					</button>
				</div>
				<div className="min-h-0 flex-1">
					<HomeConversation sessionId={homeSession} />
				</div>
			</div>
		)
	}

	// Opening screen (claude.ai style).
	return (
		<div className="flex h-full flex-col items-center justify-center gap-6 p-6">
			<div className="text-center">
				<h1 className="text-balance font-semibold text-2xl text-foreground">How can I help?</h1>
				<p className="mt-1 text-muted-foreground text-sm">Ask me anything — a general chat, no code needed.</p>
			</div>
			<div className="w-full max-w-2xl">
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault()
							void start(input)
						}
					}}
					rows={3}
					// biome-ignore lint/a11y/noAutofocus: chat input should be ready to type
					autoFocus
					disabled={starting}
					placeholder="Message Hramble…"
					className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
				/>
				<div className="mt-3 flex flex-wrap justify-center gap-2">
					{EXAMPLES.map((ex) => (
						<button
							key={ex}
							type="button"
							disabled={starting}
							onClick={() => void start(ex)}
							className="rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
						>
							{ex}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
