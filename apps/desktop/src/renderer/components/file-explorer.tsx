/**
 * File explorer — a lazy-loading project file tree for the session view.
 *
 * Uses the xot engine's /files endpoint to browse the project, and opens a
 * clicked file in the existing diff/review panel (viewFileInDiffPanelAtom). This
 * is the "feels like a real coding tool" piece — you can see and open the code,
 * not just chat about it.
 */
import { ChevronRightIcon, FileIcon, FolderIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useSetAtom } from "jotai"
import { useCallback, useEffect, useState } from "react"
import { viewFileInDiffPanelAtom } from "../atoms/ui"
import { listEngineDir } from "../services/engine-client"

type FileNode = {
	name: string
	path: string
	type: "file" | "directory"
	ignored: boolean
}

async function listDir(directory: string, path: string): Promise<FileNode[]> {
	try {
		// The engine returns entries directory-first; hide dotfiles and noise dirs
		// (node_modules, .git, …, flagged `ignored`) to keep the tree clean.
		const entries = await listEngineDir(directory, path)
		return entries.filter((n) => !n.ignored && !n.name.startsWith("."))
	} catch {
		return []
	}
}

function TreeNode({
	node,
	directory,
	depth,
	onOpenFile,
}: {
	node: FileNode
	directory: string
	depth: number
	onOpenFile: (path: string) => void
}) {
	const [expanded, setExpanded] = useState(false)
	const [children, setChildren] = useState<FileNode[] | null>(null)
	const [loading, setLoading] = useState(false)

	const toggle = useCallback(async () => {
		if (node.type === "file") {
			onOpenFile(node.path)
			return
		}
		const next = !expanded
		setExpanded(next)
		if (next && children === null) {
			setLoading(true)
			setChildren(await listDir(directory, node.path))
			setLoading(false)
		}
	}, [expanded, children, node, directory, onOpenFile])

	return (
		<div>
			<button
				type="button"
				onClick={toggle}
				className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				style={{ paddingLeft: `${depth * 12 + 6}px` }}
			>
				{node.type === "directory" ? (
					<>
						<ChevronRightIcon
							className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
						/>
						<FolderIcon className="size-3.5 shrink-0 text-blue-500/80" />
					</>
				) : (
					<>
						<span className="size-3 shrink-0" />
						<FileIcon className="size-3.5 shrink-0" />
					</>
				)}
				<span className="truncate">{node.name}</span>
				{loading && <Loader2Icon className="ml-auto size-3 animate-spin" />}
			</button>
			{expanded &&
				children?.map((c) => (
					<TreeNode
						key={c.path}
						node={c}
						directory={directory}
						depth={depth + 1}
						onOpenFile={onOpenFile}
					/>
				))}
		</div>
	)
}

export function FileExplorer({ directory }: { directory: string }) {
	const [roots, setRoots] = useState<FileNode[] | null>(null)
	const [loading, setLoading] = useState(true)
	const viewFile = useSetAtom(viewFileInDiffPanelAtom)

	const load = useCallback(async () => {
		setLoading(true)
		setRoots(await listDir(directory, ""))
		setLoading(false)
	}, [directory])

	useEffect(() => {
		load()
	}, [load])

	return (
		<div className="flex h-full flex-col border-border border-r bg-background/40">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Files</span>
				<button
					type="button"
					onClick={load}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					title="Refresh"
				>
					<RefreshCwIcon className="size-3" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-2">
				{loading ? (
					<div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
						<Loader2Icon className="size-3 animate-spin" /> Loading…
					</div>
				) : !roots || roots.length === 0 ? (
					<p className="px-3 py-2 text-muted-foreground text-xs">No files.</p>
				) : (
					roots.map((n) => (
						<TreeNode
							key={n.path}
							node={n}
							directory={directory}
							depth={0}
							onOpenFile={(p) => viewFile(p)}
						/>
					))
				)}
			</div>
		</div>
	)
}
