interface TopBarProps {
	title?: string
	subtitle?: string
	right?: React.ReactNode
	onBack?: () => void
}

/** Shared header across every screen — brand wordmark + optional back/right slot,
 *  in the same glass-panel language as the desktop app's chrome. */
export function TopBar({ title, subtitle, right, onBack }: TopBarProps) {
	return (
		<header
			className="glass-panel-soft"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 10,
				margin: "0 0 12px",
				padding: "calc(10px + env(safe-area-inset-top)) 14px 10px",
				borderRadius: 0,
				borderLeft: "none",
				borderRight: "none",
				borderTop: "none",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
				{onBack && (
					<button
						onClick={onBack}
						aria-label="Back"
						style={{
							background: "var(--accent)",
							color: "var(--foreground)",
							border: "none",
							borderRadius: 999,
							width: 30,
							height: 30,
							fontSize: 16,
							cursor: "pointer",
							flexShrink: 0,
						}}
					>
						←
					</button>
				)}
				<div style={{ minWidth: 0 }}>
					<div className="brand-wordmark" style={{ fontSize: 20, lineHeight: 1 }}>
						hramble
					</div>
					{(title || subtitle) && (
						<div
							style={{
								fontSize: 12,
								color: "var(--muted-foreground)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{title}
							{title && subtitle ? " · " : ""}
							{subtitle}
						</div>
					)}
				</div>
			</div>
			{right}
		</header>
	)
}
