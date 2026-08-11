/**
 * Inline SVG wordmark for "Hramble Coder" -- renders at currentColor via SVG
 * <text> so it scales with the className height (h-5, h-4, h-[11px], ...) with
 * no font-loading dependency for layout. viewBox width widened from the
 * original 360 (tuned for "Hramble" alone) to fit the longer "Hramble Coder".
 */
export function HrambleWordmark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 620 80"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			style={{ overflow: "visible" }}
			aria-label="Hramble Coder"
		>
			<text
				x="0"
				y="60"
				fill="currentColor"
				fontFamily="Quadrangle, 'Inter Variable', Inter, system-ui, sans-serif"
				fontSize="60"
				fontWeight="400"
			>
				Hramble Coder
			</text>
		</svg>
	)
}
