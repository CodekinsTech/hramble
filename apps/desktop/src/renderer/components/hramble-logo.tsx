import catUrl from "../hramble-cat.png"

/**
 * Hramble brand logo — the animated "second logo" from the brand preview:
 * cat (colour-cycles green → blue → amber → white, blinks, forehead glow),
 * "Hramble" wordmark (Quadrangle, colour-cycling) + grey "code".
 */
export function HrambleLogo({ subtitle = "Coder" }: { subtitle?: string }) {
	return (
		<div className="hramble-logo">
			<div className="hramble-stage">
				<img src={catUrl} alt="Hramble" />
				<span className="hramble-dim left" />
				<span className="hramble-dim right" />
				<span className="hramble-glow" />
				<span className="hramble-lid left" />
				<span className="hramble-lid right" />
			</div>
			<div className="hramble-mark">
				<span className="hramble-word">Hramble</span>
				<span className="hramble-code">{subtitle}</span>
			</div>
		</div>
	)
}

/** Compact, static-green brand lockup for the sidebar top. */
export function HrambleSidebarLogo() {
	return (
		<div className="hramble-side">
			<div className="hramble-side-cat">
				<img src={catUrl} alt="" />
				<span className="dim l" />
				<span className="dim r" />
				<span className="g" />
				<span className="lid l" />
				<span className="lid r" />
			</div>
			<span className="hramble-side-word">Hramble</span>
		</div>
	)
}
