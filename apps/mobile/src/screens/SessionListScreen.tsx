import type { DispatchSessionSummary } from "../lib/relay"
import { StatusDot } from "../components/StatusDot"
import { TopBar } from "../components/TopBar"

interface SessionListScreenProps {
	sessions: DispatchSessionSummary[]
	relayConnected: boolean
	hostConnected: boolean
	activeSessionId: string | null
	onSelect: (sessionId: string) => void
	onNewMessage: () => void
	onUnpair: () => void
}

function formatRelative(ms: number): string {
	if (!ms) return ""
	const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000))
	if (seconds < 60) return "now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

export function SessionListScreen({
	sessions,
	relayConnected,
	hostConnected,
	activeSessionId,
	onSelect,
	onNewMessage,
	onUnpair,
}: SessionListScreenProps) {
	return (
		<div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
			<TopBar
				subtitle="Sessions"
				right={<StatusDot relayConnected={relayConnected} hostConnected={hostConnected} />}
			/>
			<div style={{ padding: "0 14px 12px" }}>
				<button
					onClick={onNewMessage}
					style={{
						width: "100%",
						padding: "11px 14px",
						borderRadius: 12,
						border: "none",
						background: "var(--brand-green)",
						color: "#fff",
						fontWeight: 600,
						fontSize: 14,
						cursor: "pointer",
					}}
				>
					+ New message
				</button>
			</div>
			<div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}>
				{!hostConnected && (
					<div
						className="glass-panel-soft"
						style={{ padding: 14, marginBottom: 12, fontSize: 13, color: "var(--muted-foreground)" }}
					>
						Desktop app not running — open Hramble on your Mac to see live sessions.
					</div>
				)}
				{sessions.length === 0 ? (
					<div style={{ padding: 24, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
						No sessions yet. Send a message from below to start one, or open a project on your desktop.
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						{sessions.map((s) => (
							<button
								key={s.id}
								onClick={() => onSelect(s.id)}
								className="glass-panel-soft"
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "flex-start",
									gap: 4,
									padding: "12px 14px",
									textAlign: "left",
									cursor: "pointer",
									border:
										s.id === activeSessionId
											? "1px solid var(--brand-green)"
											: "1px solid var(--glass-border)",
								}}
							>
								<div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>{s.title}</div>
								<div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", gap: 6 }}>
									<span>{s.project}</span>
									<span>·</span>
									<span>{formatRelative(s.lastActiveAt)}</span>
								</div>
							</button>
						))}
					</div>
				)}
			</div>
			<div style={{ padding: "0 14px calc(14px + env(safe-area-inset-bottom))" }}>
				<button
					onClick={onUnpair}
					style={{
						width: "100%",
						padding: "10px 14px",
						borderRadius: 12,
						border: "1px solid var(--border)",
						background: "transparent",
						color: "var(--muted-foreground)",
						fontSize: 13,
						cursor: "pointer",
					}}
				>
					Unpair
				</button>
			</div>
		</div>
	)
}
