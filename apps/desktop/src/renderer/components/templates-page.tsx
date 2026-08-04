/**
 * Templates page — pick what you're building, and Hramble sets up the right
 * tools/skills/mode up front instead of leaving the AI to guess (the same
 * problem that caused it to reach for the wrong tool earlier: making the
 * choice explicit beats hoping the model infers it correctly).
 */
import { useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { GamepadIcon, GlobeIcon } from "lucide-react"
import { useState } from "react"
import { setDraftAtom } from "../atoms/preferences"
import { NEW_CHAT_DRAFT_KEY } from "../hooks/use-draft"
import { appStore } from "../atoms/store"
import { pendingHyperGoalAtom, workspaceModeAtom } from "../atoms/workspace"

interface Template {
	id: string
	title: string
	description: string
	icon: typeof GlobeIcon
	mode: "code" | "hyperloop"
	brief: string
	toolsNote: string
	placeholder: string
}

const TEMPLATES: Template[] = [
	{
		id: "website",
		title: "Website",
		description: "Build a site — optionally match the look of a reference page you show it.",
		icon: GlobeIcon,
		mode: "code",
		brief:
			"You're building a website. If the user gives a reference site or asks to match a look, open it in the built-in browser and use the Inspect Design button (palette icon in the browser toolbar) to pick real colors/fonts/assets/CSS from that page — don't guess styles from memory.",
		toolsNote: "Tools: file read/write/edit, dev server, browser (open + Inspect Design on reference sites)",
		placeholder: "e.g. A landing page for a coffee shop, styled like stripe.com",
	},
	{
		id: "browser-game",
		title: "Browser Game",
		description: "Build a playable game — decomposed, built in parallel, and checked before it's called done.",
		icon: GamepadIcon,
		mode: "hyperloop",
		brief:
			"You're building a browser game. Prefer generating everything in code (shapes, textures, sounds) over external asset files, unless the user provides assets. Keep it playable in a single page — no build step required to try it.",
		toolsNote: "Tools: file read/write/edit, dev server · Hyperloop parallel build + verify/repair",
		placeholder: "e.g. A simple kart racer with 3 tracks and a lap timer",
	},
]

export function TemplatesPage() {
	const navigate = useNavigate()
	const setWorkspaceMode = useSetAtom(workspaceModeAtom)
	const setPendingHyperGoal = useSetAtom(pendingHyperGoalAtom)
	const [openId, setOpenId] = useState<string | null>(null)
	const [goal, setGoal] = useState("")

	const start = (template: Template) => {
		if (!goal.trim()) return
		const prompt = `${template.brief}\n\nGoal: ${goal.trim()}`
		setWorkspaceMode(template.mode)
		if (template.mode === "hyperloop") {
			setPendingHyperGoal(prompt)
		} else {
			appStore.set(setDraftAtom, { key: NEW_CHAT_DRAFT_KEY, text: prompt })
		}
		navigate({ to: "/" })
	}

	return (
		<div className="flex h-full flex-col items-center overflow-y-auto p-8">
			<div className="w-full max-w-2xl">
				<h1 className="text-balance text-center font-semibold text-2xl text-foreground">What are you building?</h1>
				<p className="mt-1 text-center text-muted-foreground text-sm">
					Pick a starting point — Hramble sets up the right tools before you begin.
				</p>
				<div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
					{TEMPLATES.map((t) => {
						const Icon = t.icon
						const open = openId === t.id
						return (
							<div
								key={t.id}
								className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${open ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:border-primary/30"}`}
							>
								<button
									type="button"
									onClick={() => {
										setOpenId(open ? null : t.id)
										setGoal("")
									}}
									className="flex items-start gap-3 text-left"
								>
									<Icon className="mt-0.5 size-5 shrink-0 text-primary" />
									<div className="min-w-0 flex-1">
										<div className="font-medium text-foreground text-sm">{t.title}</div>
										<div className="mt-0.5 text-muted-foreground text-xs">{t.description}</div>
									</div>
								</button>
								{open && (
									<div className="flex flex-col gap-2 border-border border-t pt-3">
										<p className="text-[11px] text-muted-foreground/80">{t.toolsNote}</p>
										<textarea
											value={goal}
											onChange={(e) => setGoal(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(t)
											}}
											placeholder={t.placeholder}
											rows={3}
											autoFocus
											className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
										/>
										<button
											type="button"
											onClick={() => start(t)}
											disabled={!goal.trim()}
											className="self-end rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs disabled:opacity-50"
										>
											Start
										</button>
									</div>
								)}
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
