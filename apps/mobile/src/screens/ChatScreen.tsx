import { useEffect, useRef, useState } from "react"
import { StatusDot } from "../components/StatusDot"
import { TopBar } from "../components/TopBar"
import { type PendingFileAttachment, pickAndReadFile } from "../lib/attachFile"
import type {
	ChatEvent,
	OutgoingFileAttachment,
	PermissionRequest,
	ScreenContent,
} from "../lib/relay"
import { startVoiceListening, stopVoiceListening } from "../lib/voiceInput"

interface ChatScreenProps {
	sessionTitle: string
	events: ChatEvent[]
	screen: ScreenContent | null
	relayConnected: boolean
	hostConnected: boolean
	noHostNotice: number
	permissionRequest: PermissionRequest | null
	onRespondPermission: (sessionId: string, permissionId: string, decision: "allow" | "deny") => void
	/** Only set when the mirrored session actually exists and is running — drives the header's Stop action. */
	activeSessionId: string | null
	sessionStatus?: string
	onStop: (sessionId: string) => void
	onSend: (text: string, files?: OutgoingFileAttachment[]) => void
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
				<iframe
					title="Mirrored artifact"
					sandbox="allow-scripts"
					srcDoc={content.html}
					style={frameStyle}
				/>
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

/** Inline Allow/Deny card for a permission ask mirrored from the desktop's own
 *  permission card (chat-permission.tsx) — blocks the session on desktop, so
 *  it needs to be impossible to miss here too. Sits above the composer,
 *  not buried in the scrolling feed. */
function PermissionCard({
	request,
	onDecision,
}: {
	request: PermissionRequest
	onDecision: (decision: "allow" | "deny") => void
}) {
	const tool =
		typeof request.metadata?.tool === "string" ? (request.metadata.tool as string) : undefined
	const commandRaw = request.metadata?.command
	const command = typeof commandRaw === "string" ? commandRaw : undefined

	return (
		<div
			className="glass-panel-soft"
			style={{ margin: "0 14px 12px", padding: "12px 14px", flexShrink: 0 }}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 13,
					fontWeight: 600,
					color: "var(--foreground)",
				}}
			>
				<span aria-hidden="true">🛡️</span>
				<span>Hramble wants to: {request.permission}</span>
			</div>
			{(tool || command) && (
				<code
					className="mono"
					style={{
						display: "block",
						marginTop: 6,
						fontSize: 12,
						color: "var(--muted-foreground)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{tool}
					{tool && command ? " " : ""}
					{command && (command.length > 80 ? `${command.slice(0, 80)}…` : command)}
				</code>
			)}
			<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
				<button
					type="button"
					onClick={() => onDecision("deny")}
					style={{
						flex: 1,
						padding: "9px 12px",
						borderRadius: 10,
						border: "1px solid var(--border)",
						background: "transparent",
						color: "var(--muted-foreground)",
						fontSize: 13,
						fontWeight: 600,
						cursor: "pointer",
					}}
				>
					Deny
				</button>
				<button
					type="button"
					onClick={() => onDecision("allow")}
					style={{
						flex: 1,
						padding: "9px 12px",
						borderRadius: 10,
						border: "none",
						background: "var(--brand-green)",
						color: "#fff",
						fontSize: 13,
						fontWeight: 600,
						cursor: "pointer",
					}}
				>
					Allow
				</button>
			</div>
		</div>
	)
}

const frameStyle: React.CSSProperties = {
	width: "100%",
	height: "100%",
	border: 0,
	display: "block",
}

export function ChatScreen({
	sessionTitle,
	events,
	screen,
	relayConnected,
	hostConnected,
	noHostNotice,
	permissionRequest,
	onRespondPermission,
	activeSessionId,
	sessionStatus,
	onStop,
	onSend,
	onBack,
}: ChatScreenProps) {
	const [text, setText] = useState("")
	const feedRef = useRef<HTMLDivElement>(null)
	const [noHostBanner, setNoHostBanner] = useState(false)
	const [listening, setListening] = useState(false)
	const [voiceError, setVoiceError] = useState<string | null>(null)
	const [pendingFile, setPendingFile] = useState<PendingFileAttachment | null>(null)
	const [attachError, setAttachError] = useState<string | null>(null)

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

	// Stop the mic if the user navigates away mid-dictation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup, deliberately not re-running on `listening` changes
	useEffect(() => {
		return () => {
			if (listening) stopVoiceListening()
		}
	}, [])

	function send() {
		const trimmed = text.trim()
		if (!trimmed && !pendingFile) return
		onSend(trimmed, pendingFile ? [pendingFile] : undefined)
		setText("")
		setPendingFile(null)
	}

	async function handleAttach() {
		setAttachError(null)
		const outcome = await pickAndReadFile()
		if (outcome === "cancelled") {
			return
		}
		if (outcome === "too-large") {
			setAttachError("That file is over 700 KB — pick a smaller one.")
			return
		}
		if (outcome === "permission-denied") {
			setAttachError("File access permission was denied — enable it in system settings.")
			return
		}
		if ("error" in outcome) {
			setAttachError(`Couldn't attach that file (${outcome.error}).`)
			return
		}
		setPendingFile(outcome.file)
	}

	async function toggleMic() {
		if (listening) {
			await stopVoiceListening()
			setListening(false)
			return
		}
		setVoiceError(null)
		const outcome = await startVoiceListening((partial) => setText(partial))
		if (outcome === "listening") {
			setListening(true)
		} else if (outcome === "unsupported") {
			setVoiceError("Voice input isn't available on this device.")
		} else if (outcome === "permission-denied") {
			setVoiceError("Microphone permission was denied — enable it in system settings.")
		} else {
			setVoiceError(`Couldn't start listening (${outcome.error}).`)
		}
	}

	const showStop = !!activeSessionId && (sessionStatus === "running" || sessionStatus === "waiting")

	return (
		<div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
			<TopBar
				title={sessionTitle}
				onBack={onBack}
				right={
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<StatusDot relayConnected={relayConnected} hostConnected={hostConnected} />
						{showStop && (
							<button
								type="button"
								onClick={() => activeSessionId && onStop(activeSessionId)}
								style={{
									padding: "6px 10px",
									borderRadius: 999,
									border: "1px solid var(--destructive)",
									background: "transparent",
									color: "var(--destructive)",
									fontSize: 12,
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Stop
							</button>
						)}
					</div>
				}
			/>
			<ScreenMirror content={screen} />
			<div
				ref={feedRef}
				style={{
					flex: 1,
					overflowY: "auto",
					padding: "0 14px",
					display: "flex",
					flexDirection: "column",
					gap: 10,
				}}
			>
				{events.length === 0 ? (
					<div
						style={{
							padding: 24,
							textAlign: "center",
							color: "var(--muted-foreground)",
							fontSize: 13,
						}}
					>
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
						style={{
							alignSelf: "center",
							padding: "6px 12px",
							fontSize: 12,
							color: "var(--destructive)",
						}}
					>
						Hramble isn't running right now — open the desktop app, then try again.
					</div>
				)}
			</div>
			{permissionRequest && (
				<PermissionCard
					request={permissionRequest}
					onDecision={(decision) =>
						onRespondPermission(permissionRequest.sessionId, permissionRequest.id, decision)
					}
				/>
			)}
			{listening && (
				<div
					style={{
						margin: "0 14px 10px",
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 12,
						color: "var(--brand-green)",
						fontWeight: 600,
					}}
				>
					<span
						style={{
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: "var(--brand-green)",
							animation: "hramble-pulse 1s ease-in-out infinite",
						}}
					/>
					Listening… speak, then tap the mic again
				</div>
			)}
			{voiceError && !listening && (
				<div style={{ margin: "0 14px 10px", fontSize: 12, color: "var(--destructive)" }}>
					{voiceError}
				</div>
			)}
			{attachError && (
				<div style={{ margin: "0 14px 10px", fontSize: 12, color: "var(--destructive)" }}>
					{attachError}
				</div>
			)}
			{pendingFile && (
				<div
					className="glass-panel-soft"
					style={{
						margin: "0 14px 10px",
						padding: "8px 12px",
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 12,
					}}
				>
					<span aria-hidden="true">📎</span>
					<span
						style={{
							flex: 1,
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							color: "var(--foreground)",
						}}
					>
						{pendingFile.filename ?? "Attached file"}
					</span>
					<button
						type="button"
						onClick={() => setPendingFile(null)}
						aria-label="Remove attachment"
						style={{
							flexShrink: 0,
							width: 22,
							height: 22,
							borderRadius: "50%",
							border: "none",
							background: "var(--secondary)",
							color: "var(--muted-foreground)",
							fontSize: 13,
							lineHeight: 1,
							cursor: "pointer",
						}}
					>
						×
					</button>
				</div>
			)}
			<div
				style={{
					display: "flex",
					gap: 8,
					padding: "14px 14px calc(14px + env(safe-area-inset-bottom))",
					borderTop: "1px solid var(--border)",
					background: "var(--card)",
				}}
			>
				<button
					type="button"
					onClick={handleAttach}
					aria-label="Attach a file"
					disabled={!relayConnected}
					style={{
						width: 44,
						height: 44,
						flexShrink: 0,
						borderRadius: 12,
						border: pendingFile ? "1px solid var(--brand-green)" : "1px solid var(--border)",
						background: "var(--secondary)",
						color: "var(--foreground)",
						fontSize: 18,
						cursor: relayConnected ? "pointer" : "default",
					}}
				>
					📎
				</button>
				<button
					type="button"
					onClick={toggleMic}
					aria-label={listening ? "Stop listening" : "Start voice input"}
					disabled={!relayConnected}
					style={{
						width: 44,
						height: 44,
						flexShrink: 0,
						borderRadius: 12,
						border: listening ? "1px solid var(--brand-green)" : "1px solid var(--border)",
						background: listening ? "var(--brand-green)" : "var(--secondary)",
						color: listening ? "#fff" : "var(--foreground)",
						fontSize: 18,
						cursor: relayConnected ? "pointer" : "default",
					}}
				>
					🎤
				</button>
				<input
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && send()}
					placeholder={listening ? "Listening…" : "Send a message into the session…"}
					disabled={!relayConnected}
					style={{
						flex: 1,
						minWidth: 0,
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
					type="button"
					onClick={send}
					disabled={!relayConnected || (!text.trim() && !pendingFile)}
					style={{
						flexShrink: 0,
						padding: "11px 18px",
						borderRadius: 12,
						border: "none",
						background:
							relayConnected && (text.trim() || pendingFile)
								? "var(--brand-green)"
								: "var(--accent)",
						color:
							relayConnected && (text.trim() || pendingFile) ? "#fff" : "var(--muted-foreground)",
						fontWeight: 600,
						fontSize: 14,
						cursor: relayConnected && (text.trim() || pendingFile) ? "pointer" : "default",
					}}
				>
					Send
				</button>
			</div>
		</div>
	)
}
