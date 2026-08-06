import { useEffect, useRef, useState } from "react"
import type { ChatEvent, ScreenContent } from "../lib/relay"
import { StatusDot } from "../components/StatusDot"
import { TopBar } from "../components/TopBar"

interface ChatScreenProps {
	sessionTitle: string
	events: ChatEvent[]
	screen: ScreenContent | null
	relayConnected: boolean
	hostConnected: boolean
	noHostNotice: number
	onSend: (text: string) => void
	onBack: () => void
}

/** Renders the mirrored browser-pane content exactly as the reference web
 *  viewer does: "html" runs live in a sandboxed iframe (no allow-same-origin,
 *  so an artifact can't reach the parent page), "url" loads directly,
 *  "screenshot" falls back to a static image. */
function ScreenMirror({ content }: { content: ScreenContent | null }) {
	if (!content) return null
	return (
		<div
			className="glass-panel-soft"
			style={{
				height: "34vh",
				margin: "0 14px 12px",
				overflow: "hidden",
				background: "#000",
				flexShrink: 0,
			}}
		>
			{content.kind === "html" && (
				<iframe title="Mirrored artifact" sandbox="allow-scripts" srcDoc={content.html} style={frameStyle} />
			)}
			{content.kind === "url" && (
				<iframe
					title="Mirrored page"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
					src={content.url}
					style={frameStyle}
				/>
			)}
			{content.kind === "screenshot" && (
				<img
					src={content.dataUrl}
					alt="Live view of the desktop browser pane"
					style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
				/>
			)}
		</div>
	)
}

const frameStyle: React.CSSProperties = { width: "100%", height: "100%", border: 0, display: "block" }

export function ChatScreen({
	sessionTitle,
	events,
	screen,
	relayConnected,
	hostConnected,
	noHostNotice,
	onSend,
	onBack,
}: ChatScreenProps) {
	const [text, setText] = useState("")
	const feedRef = useRef<HTMLDivElement>(null)
	const [noHostBanner, setNoHostBanner] = useState(false)

	useEffect(() => {
		feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
	}, [events])

	// biome-ignore lint/correctness/useExhaustiveDependencies: fires a transient banner each time the counter increments
	useEffect(() => {
		if (noHostNotice === 0) return
		setNoHostBanner(true)
		const t = setTimeout(() => setNoHostBanner(false), 4000)
		return () => clearTimeout(t)
	}, [noHostNotice])

	function send() {
		const trimmed = text.trim()
		if (!trimmed) return
		onSend(trimmed)
		setText("")
	}

	return (
		<div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
			<TopBar
				title={sessionTitle}
				onBack={onBack}
				right={<StatusDot relayConnected={relayConnected} hostConnected={hostConnected} />}
			/>
			<ScreenMirror content={screen} />
			<div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 10 }}>
				{events.length === 0 ? (
					<div style={{ padding: 24, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
						No messages yet — type below to send the first one.
					</div>
				) : (
					events.map((e) => (
						<div
							key={e.id}
							className="glass-panel-soft"
							style={{
								alignSelf: e.role === "user" ? "flex-end" : "flex-start",
								maxWidth: "85%",
								padding: "8px 12px",
								fontSize: 14,
								lineHeight: 1.5,
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								background: e.role === "user" ? "var(--brand-green)" : "var(--glass-bg-soft)",
								color: e.role === "user" ? "#fff" : "var(--foreground)",
							}}
						>
							<div
								style={{
									fontSize: 11,
									opacity: 0.75,
									marginBottom: 3,
									textTransform: "uppercase",
									letterSpacing: 0.4,
								}}
							>
								{e.role}
							</div>
							{e.text}
						</div>
					))
				)}
				{noHostBanner && (
					<div
						className="glass-panel-soft"
						style={{ alignSelf: "center", padding: "6px 12px", fontSize: 12, color: "var(--destructive)" }}
					>
						Hramble isn't running right now — open the desktop app, then try again.
					</div>
				)}
			</div>
			<div
				style={{
					display: "flex",
					gap: 8,
					padding: "14px 14px calc(14px + env(safe-area-inset-bottom))",
					borderTop: "1px solid var(--border)",
					background: "var(--card)",
				}}
			>
				<input
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && send()}
					placeholder="Send a message into the session…"
					disabled={!relayConnected}
					style={{
						flex: 1,
						padding: "11px 14px",
						borderRadius: 12,
						border: "1px solid var(--border)",
						background: "var(--secondary)",
						color: "var(--foreground)",
						fontSize: 14,
						outline: "none",
					}}
				/>
				<button
					onClick={send}
					disabled={!relayConnected || !text.trim()}
					style={{
						padding: "11px 18px",
						borderRadius: 12,
						border: "none",
						background: relayConnected && text.trim() ? "var(--brand-green)" : "var(--accent)",
						color: relayConnected && text.trim() ? "#fff" : "var(--muted-foreground)",
						fontWeight: 600,
						fontSize: 14,
						cursor: relayConnected && text.trim() ? "pointer" : "default",
					}}
				>
					Send
				</button>
			</div>
		</div>
	)
}
