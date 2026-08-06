interface StatusDotProps {
	relayConnected: boolean
	hostConnected: boolean
}

/** Two independent facts, same as the reference web viewer: connected to the
 *  relay at all, and — separately — whether the Hramble desktop app is
 *  actually there. Never collapse these into one "connected" boolean. */
export function StatusDot({ relayConnected, hostConnected }: StatusDotProps) {
	let color = "#b7c0cc"
	let label = "Reconnecting…"
	if (relayConnected && hostConnected) {
		color = "var(--brand-green)"
		label = "Live"
	} else if (relayConnected && !hostConnected) {
		color = "#ffc300"
		label = "Desktop app not running"
	}
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)" }}>
			<span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
			{label}
		</div>
	)
}
