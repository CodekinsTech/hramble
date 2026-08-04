import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

// Builds the same file/symbol/reference data as the agent's own repo_map
// tool (opencode-harness/plugin/hramble-repomap.js), but for the renderer's
// interactive graph view instead of the model's text output. Kept as a
// separate, simpler implementation on purpose — this runs in Electron's main
// process, a different runtime than the plugin (which loads inside the
// separately-installed `opencode` binary), so there's no easy shared import
// between the two. No caching here — the UI re-scans on open, which is fine
// for a view opened occasionally rather than every agent turn.

const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".turbo",
	"coverage", "vendor", ".venv", "venv", "__pycache__", "target",
	".opencode", ".hramble", ".cache", "tmp", ".idea", ".vscode",
])

const CODE_EXT = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
	".java", ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs",
	".swift", ".kt", ".vue", ".svelte",
])

const MAX_FILE_BYTES = 250_000
const MAX_SYMBOLS_PER_FILE = 40
const MAX_NODES = 600 // keep the rendered graph readable and the layout fast
const MAX_TOKENS_PER_FILE = 600

function extractSymbols(ext: string, text: string): Array<{ kind: string; name: string }> {
	const out: Array<{ kind: string; name: string }> = []
	const push = (kind: string, name: string | undefined) => {
		if (name && !out.some((s) => s.name === name)) out.push({ kind, name })
	}
	const lines = text.split("\n")
	const scan = (re: RegExp, kind: string) => {
		for (const line of lines) {
			const m = re.exec(line)
			if (m) push(kind, m[1])
			re.lastIndex = 0
		}
	}

	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(ext)) {
		scan(/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, "fn")
		scan(/^\s*export\s+(?:default\s+)?class\s+([A-Za-z0-9_$]+)/, "class")
		scan(/^\s*export\s+(?:abstract\s+)?interface\s+([A-Za-z0-9_$]+)/, "interface")
		scan(/^\s*export\s+type\s+([A-Za-z0-9_$]+)/, "type")
		scan(/^\s*export\s+(?:const|let)\s+([A-Za-z0-9_$]+)/, "const")
	} else if (ext === ".py") {
		scan(/^\s*def\s+([A-Za-z0-9_]+)/, "def")
		scan(/^\s*class\s+([A-Za-z0-9_]+)/, "class")
	} else if (ext === ".go") {
		scan(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/, "func")
		scan(/^\s*type\s+([A-Za-z0-9_]+)/, "type")
	} else if (ext === ".rs") {
		scan(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/, "fn")
		scan(/^\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/, "struct")
	} else if ([".java", ".cs", ".kt", ".swift"].includes(ext)) {
		scan(/^\s*(?:public|private|protected|internal|open|final|static|\s)*class\s+([A-Za-z0-9_]+)/, "class")
	} else if (ext === ".rb") {
		scan(/^\s*def\s+([A-Za-z0-9_?!]+)/, "def")
		scan(/^\s*class\s+([A-Za-z0-9_:]+)/, "class")
	} else if (ext === ".php") {
		scan(/^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z0-9_]+)/, "fn")
		scan(/^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z0-9_]+)/, "class")
	}
	return out.slice(0, MAX_SYMBOLS_PER_FILE)
}

function extractTokens(text: string): Set<string> {
	const seen = new Set<string>()
	const re = /\b[A-Za-z_][A-Za-z0-9_]*\b/g
	let m: RegExpExecArray | null
	// biome-ignore lint: standard exec-loop pattern
	while ((m = re.exec(text)) && seen.size < MAX_TOKENS_PER_FILE) {
		seen.add(m[0])
	}
	return seen
}

function walk(dir: string, files: string[]): void {
	let entries: Dirent[]
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const e of entries) {
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue
			walk(path.join(dir, e.name), files)
		} else if (e.isFile()) {
			const ext = path.extname(e.name).toLowerCase()
			if (CODE_EXT.has(ext)) files.push(path.join(dir, e.name))
		}
		if (files.length > 4000) return
	}
}

export interface RepoGraphNode {
	id: string
	name: string
	kind: string
	file: string
	/** Top-level folder under the project root — used as the cluster label. */
	cluster: string
	refCount: number
}

export interface RepoGraphEdge {
	source: string
	target: string
}

export interface RepoGraphData {
	nodes: RepoGraphNode[]
	edges: RepoGraphEdge[]
	fileCount: number
	truncated: boolean
}

export async function buildRepoGraph(directory: string): Promise<RepoGraphData> {
	const files: string[] = []
	walk(directory, files)
	files.sort()

	const perFile: Array<{ rel: string; cluster: string; symbols: Array<{ kind: string; name: string }>; tokens: Set<string> }> = []

	for (const f of files) {
		let st: ReturnType<typeof statSync>
		try {
			st = statSync(f)
		} catch {
			continue
		}
		if (st.size > MAX_FILE_BYTES) continue
		let text: string
		try {
			text = readFileSync(f, "utf8")
		} catch {
			continue
		}
		const rel = path.relative(directory, f)
		const cluster = rel.split(path.sep)[0] || rel
		perFile.push({
			rel,
			cluster,
			symbols: extractSymbols(path.extname(f).toLowerCase(), text),
			tokens: extractTokens(text),
		})
	}

	// symbolIndex: name -> node id (first definition wins if the same name appears twice)
	const symbolIndex = new Map<string, string>()
	const nodes: RepoGraphNode[] = []
	for (const pf of perFile) {
		for (const s of pf.symbols) {
			const id = `${pf.rel}::${s.name}`
			if (symbolIndex.has(s.name)) continue
			symbolIndex.set(s.name, id)
			nodes.push({ id, name: s.name, kind: s.kind, file: pf.rel, cluster: pf.cluster, refCount: 0 })
		}
	}

	const edges: RepoGraphEdge[] = []
	for (const pf of perFile) {
		for (const [name, targetId] of symbolIndex) {
			if (targetId.startsWith(`${pf.rel}::`)) continue // don't edge a file to its own symbol
			if (pf.tokens.has(name)) {
				// Represent the referencing file's most-central symbol (or the file
				// itself if it has none) as the edge source, so files with no
				// top-level symbols still show up as a connected node.
				const sourceId = perFile.find((p) => p.rel === pf.rel)?.symbols[0]
					? `${pf.rel}::${perFile.find((p) => p.rel === pf.rel)?.symbols[0]?.name}`
					: `file::${pf.rel}`
				if (sourceId === targetId) continue
				edges.push({ source: sourceId, target: targetId })
				const node = nodes.find((n) => n.id === targetId)
				if (node) node.refCount++
			}
		}
	}

	// Files with no extracted top-level symbol still need a node to attach
	// their outgoing edges to.
	const referencedFileNodeIds = new Set(edges.map((e) => e.source).filter((id) => id.startsWith("file::")))
	for (const fileId of referencedFileNodeIds) {
		const rel = fileId.slice("file::".length)
		const pf = perFile.find((p) => p.rel === rel)
		if (pf) nodes.push({ id: fileId, name: path.basename(rel), kind: "file", file: rel, cluster: pf.cluster, refCount: 0 })
	}

	const truncated = nodes.length > MAX_NODES
	const trimmedNodes = truncated
		? [...nodes].sort((a, b) => b.refCount - a.refCount).slice(0, MAX_NODES)
		: nodes
	const keepIds = new Set(trimmedNodes.map((n) => n.id))
	const trimmedEdges = edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target))

	return { nodes: trimmedNodes, edges: trimmedEdges, fileCount: perFile.length, truncated }
}
