import { useState } from "react"
import { scanQrCode } from "../lib/qrScan"
import { extractRoomToken } from "../lib/relay"

interface PairScreenProps {
	onPaired: (roomToken: string) => void
}

/**
 * Pairing: scan the QR code shown on desktop (Settings → General → Dispatch)
 * as the primary path — matches what's actually on that screen — with a
 * paste-link fallback for when the camera isn't available or convenient.
 */
export function PairScreen({ onPaired }: PairScreenProps) {
	const [showPaste, setShowPaste] = useState(false)
	const [value, setValue] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [scanning, setScanning] = useState(false)

	function tryToken(raw: string): boolean {
		const token = extractRoomToken(raw)
		if (!token) {
			setError("That doesn't look like a Dispatch link or token — paste the link from Settings → General → Dispatch.")
			return false
		}
		setError(null)
		onPaired(token)
		return true
	}

	async function handleScan() {
		setError(null)
		setScanning(true)
		try {
			const result = await scanQrCode()
			if (result.status === "scanned") {
				if (!tryToken(result.value)) {
					setError("Scanned code isn't a Hramble Dispatch link — try again or paste the link instead.")
				}
			} else if (result.status === "permission-denied") {
				setError("Camera permission was denied — enable it in system settings, or paste the link instead.")
			} else if (result.status === "unsupported") {
				setError("QR scanning isn't available on this device — paste the link instead.")
				setShowPaste(true)
			} else if (result.status === "error") {
				setError(`Couldn't open the scanner (${result.message}) — paste the link instead.`)
				setShowPaste(true)
			}
			// "cancelled" — user backed out, no error needed.
		} finally {
			setScanning(false)
		}
	}

	function submitPaste() {
		tryToken(value)
	}

	return (
		<div
			style={{
				minHeight: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))",
				gap: 24,
				background:
					"radial-gradient(circle at 20% 15%, rgba(5,189,245,0.12), transparent 55%), radial-gradient(circle at 85% 85%, rgba(18,194,79,0.12), transparent 55%), var(--background)",
			}}
		>
			<div style={{ textAlign: "center" }}>
				<div className="brand-wordmark" style={{ fontSize: 40 }}>
					hramble
				</div>
				<div className="heading" style={{ fontSize: 15, color: "var(--muted-foreground)", marginTop: 6 }}>
					Companion
				</div>
			</div>

			<div className="glass-panel" style={{ width: "100%", maxWidth: 420, padding: 20 }}>
				<div className="heading" style={{ fontSize: 17, marginBottom: 6 }}>
					Pair with your desktop
				</div>
				<p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, marginTop: 0 }}>
					On your Mac, open Hramble → Settings → General → Dispatch, then scan the QR code shown there.
				</p>

				<button
					onClick={handleScan}
					disabled={scanning}
					style={{
						width: "100%",
						marginTop: 8,
						padding: "13px 14px",
						borderRadius: 12,
						border: "none",
						background: "var(--brand-green)",
						color: "#fff",
						fontSize: 15,
						fontWeight: 600,
						cursor: scanning ? "default" : "pointer",
						opacity: scanning ? 0.7 : 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 8,
					}}
				>
					{scanning ? "Opening camera…" : "Scan QR Code"}
				</button>

				{error && <div style={{ color: "var(--destructive)", fontSize: 12, marginTop: 10 }}>{error}</div>}

				<button
					onClick={() => setShowPaste((v) => !v)}
					style={{
						width: "100%",
						marginTop: 12,
						padding: "8px 4px",
						borderRadius: 10,
						border: "none",
						background: "transparent",
						color: "var(--muted-foreground)",
						fontSize: 13,
						textDecoration: "underline",
						cursor: "pointer",
					}}
				>
					{showPaste ? "Hide" : "or paste a link instead"}
				</button>

				{showPaste && (
					<div style={{ marginTop: 4 }}>
						<input
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="Paste Dispatch link or token…"
							style={{
								width: "100%",
								padding: "12px 14px",
								borderRadius: 12,
								border: "1px solid var(--border)",
								background: "var(--card)",
								color: "var(--foreground)",
								fontSize: 14,
								outline: "none",
							}}
						/>
						<button
							onClick={submitPaste}
							disabled={!value.trim()}
							style={{
								width: "100%",
								marginTop: 10,
								padding: "11px 14px",
								borderRadius: 12,
								border: "1px solid var(--border)",
								background: value.trim() ? "var(--accent)" : "transparent",
								color: "var(--foreground)",
								fontSize: 14,
								fontWeight: 600,
								cursor: value.trim() ? "pointer" : "default",
							}}
						>
							Connect
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
