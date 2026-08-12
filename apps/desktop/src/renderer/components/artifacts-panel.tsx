import { CodeIcon, FileTextIcon, ImageIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useSetAtom } from "jotai"
import { MessageResponse } from "@hramble/ui/components/ai-elements/message"
import { useSessionDiff } from "../hooks/use-session-diff"
import { artifactsPanelOpenAtom } from "../atoms/ui"

// Extensions we can actually render a live preview for. Anything else (a
// .ts file, a .json config, etc.) is real work but not an "artifact" in the
// Claude-Artifacts sense — something meant to be looked at, not read as code.
const RENDERABLE = new Set(["html", "htm", "svg", "md", "markdown"])

function extOf(path: string): string {
	const dot = path.lastIndexOf(".")
	return dot === -1 ? "" : path.slice(dot + 1).toLowerCase()
}

function kindOf(ext: string): "html" | "svg" | "markdown" {
	if (ext === "svg") return "svg"
	if (ext === "md" || ext === "markdown") return "markdown"
	return "html"
}

function iconFor(kind: "html" | "svg" | "markdown") {
	if (kind === "svg") return ImageIcon
	if (kind === "markdown") return FileTextIcon
	return CodeIcon
}

/**
 * Artifacts panel — a browsable, rendered gallery of every renderable file
 * (HTML/SVG/Markdown) this session has written or changed, derived from the
 * same diff data the Review panel uses. Unlike the Browser pane, which shows
 * one live URL at a time, this lists everything from the whole session and
 * lets you click between them — closer to how Claude's own Artifacts work.
 */
export function ArtifactsPanel({ sessionId, directory }: { sessionId: string; directory: string }) {
	const { diffs } = useSessionDiff(sessionId, directory)
	const setOpen = useSetAtom(artifactsPanelOpenAtom)
	const [selected, setSelected] = useState<string | null>(null)

	const artifacts = useMemo(
		() =>
			diffs
				.filter((d) => d.status !== "deleted" && RENDERABLE.has(extOf(d.file)))
				.map((d) => ({ file: d.file, kind: kindOf(extOf(d.file)), content: d.after ?? "" })),
		[diffs],
	)

	const active = artifacts.find((a) => a.file === selected) ?? artifacts[0] ?? null

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center justify-between border-border border-b px-3 py-2">
				<span className="font-medium text-sm">Artifacts</span>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Close"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			{artifacts.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-6 text-center">
					<p className="text-muted-foreground text-xs">
						No renderable artifacts yet — HTML, SVG, or Markdown files this session writes will show up
						here, browsable side by side instead of one at a time in the browser pane.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1">
					{/* File list */}
					<div className="w-40 shrink-0 overflow-y-auto border-border border-r">
						{artifacts.map((a) => {
							const Icon = iconFor(a.kind)
							const isActive = active?.file === a.file
							return (
								<button
									key={a.file}
									type="button"
									onClick={() => setSelected(a.file)}
									className={`flex w-full items-start gap-1.5 border-border border-b px-2 py-2 text-left text-xs ${isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
									title={a.file}
								>
									<Icon className="mt-0.5 size-3 shrink-0" />
									<span className="min-w-0 truncate">{a.file.split("/").pop()}</span>
								</button>
							)
						})}
					</div>

					{/* Preview */}
					<div className="min-w-0 flex-1 overflow-auto">
						{active?.kind === "html" && (
							<iframe
								key={active.file}
								title={active.file}
								sandbox="allow-scripts"
								srcDoc={active.content}
								className="h-full w-full border-0"
							/>
						)}
						{active?.kind === "svg" && (
							// biome-ignore lint/security/noDangerouslySetInnerHtml: locally-generated SVG from this session's own files, same trust level as the HTML preview above
							<div className="flex h-full w-full items-center justify-center p-4" dangerouslySetInnerHTML={{ __html: active.content }} />
						)}
						{active?.kind === "markdown" && (
							<div className="p-4 text-sm">
								<MessageResponse>{active.content}</MessageResponse>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
