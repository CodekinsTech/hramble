/**
 * Bridge Panel — shown when the user has joined an incoming session bridge.
 * Displays the remote session's live transcript and lets the user send prompts
 * back into it via the relay, same as a viewer in Live Share.
 */
import { Button } from "@hramble/ui/components/button"
import { Input } from "@hramble/ui/components/input"
import { useAtom } from "jotai"
import { LinkIcon, SendIcon, WifiIcon, WifiOffIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { activeBridgeAtom } from "../atoms/bridge"
import { connectBridge } from "../lib/bridge-client"

export function BridgePanel() {
	const [bridge, setBridge] = useAtom(activeBridgeAtom)
	const [input, setInput] = useState("")
	const clientRef = useRef<ReturnType<typeof connectBridge> | null>(null)
	const bottomRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!bridge) return

		const client = connectBridge(
			bridge.roomToken,
			(events) => setBridge((prev) => prev ? { ...prev, events } : prev),
			(status) => setBridge((prev) => prev ? { ...prev, status } : prev),
		)
		clientRef.current = client

		return () => {
			client.stop()
			clientRef.current = null
		}
	}, [bridge?.roomToken, setBridge])

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [bridge?.events.length])

	const send = useCallback(() => {
		const text = input.trim()
		if (!text || !clientRef.current) return
		clientRef.current.sendMessage(text)
		setInput("")
	}, [input])

	const dismiss = useCallback(() => {
		clientRef.current?.stop()
		clientRef.current = null
		setBridge(null)
	}, [setBridge])

	if (!bridge) return null

	const StatusIcon = bridge.status === "connected" ? WifiIcon : WifiOffIcon
	const statusColor =
		bridge.status === "connected"
			? "text-green-500"
			: bridge.status === "connecting"
				? "text-yellow-500"
				: "text-muted-foreground"

	return (
		<div className="flex h-full flex-col border-l border-border bg-background">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<p className="truncate text-xs font-semibold leading-none">{bridge.meta.title}</p>
					<p className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground">
						{bridge.meta.project}
					</p>
				</div>
				<StatusIcon className={`size-3.5 shrink-0 ${statusColor}`} />
				<button
					type="button"
					onClick={dismiss}
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			{/* Transcript */}
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
				{bridge.events.length === 0 ? (
					<p className="text-center text-xs text-muted-foreground">
						{bridge.status === "connecting" ? "Connecting…" : "Waiting for messages…"}
					</p>
				) : (
					<div className="flex flex-col gap-3">
						{bridge.events.map((event) => (
							<div
								key={event.id}
								className={`flex flex-col gap-1 ${event.role === "user" ? "items-end" : "items-start"}`}
							>
								<span className="text-[10px] text-muted-foreground capitalize">{event.role}</span>
								<div
									className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap ${
										event.role === "user"
											? "bg-primary text-primary-foreground"
											: "bg-muted text-foreground"
									}`}
								>
									{event.text}
								</div>
							</div>
						))}
						<div ref={bottomRef} />
					</div>
				)}
			</div>

			{/* Send input */}
			<div className="shrink-0 border-t border-border p-2">
				<div className="flex gap-2">
					<Input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault()
								send()
							}
						}}
						placeholder="Send a message…"
						className="text-xs"
						disabled={bridge.status !== "connected"}
					/>
					<Button
						size="sm"
						variant="outline"
						onClick={send}
						disabled={!input.trim() || bridge.status !== "connected"}
					>
						<SendIcon className="size-3.5" />
					</Button>
				</div>
			</div>
		</div>
	)
}
