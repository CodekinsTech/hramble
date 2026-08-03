/**
 * Home conversation — a clean, claude.ai-style chat surface for the Home page.
 *
 * Reuses the exact message rendering (ChatTurnComponent) and streaming data
 * (useSessionChat) from the coding chat, but WITHOUT any of the coding chrome
 * (model/agent/mode pickers, tool toolbars) — just a centered message column and
 * a simple input, like a normal assistant chat.
 */
import { useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"
import { agentFamily } from "../atoms/derived/agents"
import { useSessionChat } from "../hooks/use-session-chat"
import { useAgentActions } from "../hooks/use-server"
import { ChatTurnComponent } from "./chat/chat-turn"

export function HomeConversation({ sessionId }: { sessionId: string }) {
	const agent = useAtomValue(agentFamily(sessionId))
	const { sendPrompt, abort } = useAgentActions()
	const isActive = agent?.status === "running" || agent?.status === "waiting"
	const { turns, loading } = useSessionChat(
		agent?.directory ?? null,
		agent?.sessionId ?? null,
		isActive,
	)
	const [input, setInput] = useState("")
	const scrollRef = useRef<HTMLDivElement>(null)

	// Keep the newest message in view as the conversation grows / streams.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scroll on new turns/stream
	useEffect(() => {
		const el = scrollRef.current
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
	}, [turns.length, isActive])

	const send = async () => {
		const t = input.trim()
		if (!t || !agent || isActive) return
		setInput("")
		// General assistant — no coding harness.
		await sendPrompt(agent.directory, agent.sessionId, t, { agent: "general" })
	}

	return (
		<div className="flex h-full flex-col">
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
					{turns.map((turn, i) => (
						<ChatTurnComponent
							key={turn.id}
							turn={turn}
							isLast={i === turns.length - 1}
							isWorking={isActive}
						/>
					))}
					{turns.length === 0 && !loading && (
						<p className="py-10 text-center text-muted-foreground text-sm">Say hello 👋</p>
					)}
				</div>
			</div>
			<div className="border-border border-t bg-background/60 px-4 py-3">
				<div className="mx-auto flex w-full max-w-3xl items-end gap-2">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault()
								void send()
							}
						}}
						rows={1}
						placeholder="Reply to Hramble…"
						className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
					/>
					{isActive ? (
						<button
							type="button"
							onClick={() => agent && abort(agent.directory, agent.sessionId)}
							className="rounded-xl border border-border px-4 py-3 text-muted-foreground text-sm hover:text-foreground"
						>
							Stop
						</button>
					) : (
						<button
							type="button"
							onClick={() => void send()}
							disabled={!input.trim()}
							className="rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground text-sm disabled:opacity-50"
						>
							Send
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
