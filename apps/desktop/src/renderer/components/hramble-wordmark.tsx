/**
 * Inline SVG wordmark for "Hrambal code" -- renders at currentColor via SVG
 * <text> so it scales with the className height (h-5, h-4, h-[11px], ...) with
 * no font-loading dependency for layout.
 */
export function HrambleWordmark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 360 80"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			style={{ overflow: "visible" }}
			aria-label="Hrambal code"
		>
			<text
				x="0"
				y="60"
				fill="currentColor"
				fontFamily="Quadrangle, 'Inter Variable', Inter, system-ui, sans-serif"
				fontSize="60"
				fontWeight="400"
			>
				Hramble
			</text>
		</svg>
	)
}
