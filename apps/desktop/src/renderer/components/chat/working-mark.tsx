import catUrl from "../../hramble-cat.png"

/**
 * Running-task indicator — Hramble's answer to Claude's spinning logo.
 *
 * The Hramble cat mascot sits inside a thin ring that rotates while the agent
 * works. The whole mark shares the brand `hramble-hue` animation (green → blue
 * → amber → white, 10s) via a parent `filter: hue-rotate`, so the ring and cat
 * colour-cycle in unison with the Hramble logo instead of sitting on a flat blue.
 */
export function WorkingMark({ className }: { className?: string }) {
	return (
		<span
			className={"relative inline-flex size-4 shrink-0 items-center justify-center " + (className ?? "")}
			// Same hue-cycle the logo uses; applied to the parent so ring + cat rotate together.
			style={{ animation: "hramble-hue 10s ease-in-out infinite" }}
		>
			{/* Spinning arc ring — green base so hue-rotate 0deg matches the logo's start colour */}
			<span
				className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
				style={{ borderTopColor: "#12c24f", borderRightColor: "#12c24f55" }}
			/>
			{/* Mascot, gently breathing */}
			<img
				src={catUrl}
				alt=""
				className="size-2.5 rounded-full object-cover animate-pulse"
				draggable={false}
			/>
		</span>
	)
}
