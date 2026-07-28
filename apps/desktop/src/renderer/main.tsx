import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import { PerchApp } from "./components/perch-app"
import "./index.css"

const isPerch = new URLSearchParams(location.search).get("perch") === "1"

// The perch window has no StartupOverlay to clear the inline "Palot" splash, so
// strip it here — synchronously, before React renders — so it never flashes.
if (isPerch) {
	document.getElementById("splash")?.remove()
	document.documentElement.style.background = "transparent"
	document.body.style.background = "transparent"
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>{isPerch ? <PerchApp /> : <App />}</StrictMode>,
)
