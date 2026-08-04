// Hramble repo map — gives the model codebase awareness in one call.
//
// Registers a `repo_map` tool that scans the project and returns a compact
// map: each source file with its top-level symbols (functions, classes,
// exports, types), PLUS which symbols reference which others across files —
// a lightweight relationship graph, not just a flat list. Same idea as
// aider's repo map / Claude's codebase sense, extended with the useful half
// of tools like graphify (github.com/Graphify-Labs/graphify): real
// relationships + a disk cache so repeat calls don't re-read unchanged files.
//
// Deliberately does NOT do what graphify's multimodal side does (Claude
// vision over docs/PDFs/images) — that needs an Anthropic key and costs real
// money on every call, which would break for anyone not using Claude. This
// stays fully local and free: relationships are found by matching known
// symbol names against each file's identifier tokens, not a real type-aware
// AST (no tree-sitter — that would mean bundling per-language WASM grammars
// inside a plugin, real complexity for marginal gain over this heuristic).
//
// This is meant to be QUERIED, not looked at — it's for the agent, not a
// human staring at a picture. Pass `symbol` to get one thing's relationships
// instead of the whole map.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"
import path from "node:path"

// Directories we never want in a code map.
const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".turbo",
	"coverage", "vendor", ".venv", "venv", "__pycache__", "target",
	".opencode", ".hramble", ".cache", "tmp", ".idea", ".vscode",
])

// Source extensions we know how to extract symbols from.
const CODE_EXT = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
	".java", ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs",
	".swift", ".kt", ".vue", ".svelte",
])

const MAX_FILE_BYTES = 250_000 // don't read huge/generated files
const MAX_SYMBOLS_PER_FILE = 40
const MAX_TOKENS_PER_FILE = 600 // cap what we cache per file so the cache stays small
const MAX_OUTPUT_CHARS = 14_000 // keep the map affordable to feed to a model
const CACHE_VERSION = 1

// Per-language symbol patterns. Each returns "kind name" strings.
function extractSymbols(ext, text) {
	const out = []
	const push = (kind, name) => {
		if (name && !out.some((s) => s.endsWith(` ${name}`))) out.push(`${kind} ${name}`)
	}
	const lines = text.split("\n")
	const scan = (re, kind, idx = 1) => {
		for (const line of lines) {
			const m = re.exec(line)
			if (m) push(kind, m[idx])
			re.lastIndex = 0
		}
	}

	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(ext)) {
		scan(/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, "fn")
		scan(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, "fn")
		scan(/^\s*export\s+(?:default\s+)?class\s+([A-Za-z0-9_$]+)/, "class")
		scan(/^\s*class\s+([A-Za-z0-9_$]+)/, "class")
		scan(/^\s*export\s+(?:abstract\s+)?interface\s+([A-Za-z0-9_$]+)/, "interface")
		scan(/^\s*export\s+type\s+([A-Za-z0-9_$]+)/, "type")
		scan(/^\s*export\s+enum\s+([A-Za-z0-9_$]+)/, "enum")
		// exported const/let, incl. arrow-fn components/hooks
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
		scan(/^\s*(?:pub\s+)?enum\s+([A-Za-z0-9_]+)/, "enum")
		scan(/^\s*(?:pub\s+)?trait\s+([A-Za-z0-9_]+)/, "trait")
	} else if ([".java", ".cs", ".kt", ".swift"].includes(ext)) {
		scan(/^\s*(?:public|private|protected|internal|open|final|static|\s)*class\s+([A-Za-z0-9_]+)/, "class")
		scan(/^\s*(?:public|private|protected|internal|\s)*interface\s+([A-Za-z0-9_]+)/, "interface")
		scan(/^\s*(?:public|private|protected|internal|open|override|static|func|fun|\s)+([A-Za-z0-9_]+)\s*\(/, "fn")
	} else if (ext === ".rb") {
		scan(/^\s*def\s+([A-Za-z0-9_?!]+)/, "def")
		scan(/^\s*class\s+([A-Za-z0-9_:]+)/, "class")
		scan(/^\s*module\s+([A-Za-z0-9_:]+)/, "module")
	} else if (ext === ".php") {
		scan(/^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z0-9_]+)/, "fn")
		scan(/^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z0-9_]+)/, "class")
	} else if ([".c", ".cc", ".cpp", ".h", ".hpp"].includes(ext)) {
		scan(/^\s*(?:class|struct)\s+([A-Za-z0-9_]+)/, "type")
	}
	return out.slice(0, MAX_SYMBOLS_PER_FILE)
}

// Every identifier-looking word in the file — used to detect which OTHER
// files' symbols this file references. Not a real parser (doesn't know if a
// match is a call, a comment, or a coincidence), but cheap and dependency-free,
// and good enough for "does this file mention that symbol at all."
function extractTokens(text) {
	const seen = new Set()
	const re = /\b[A-Za-z_][A-Za-z0-9_]*\b/g
	let m
	while ((m = re.exec(text)) && seen.size < MAX_TOKENS_PER_FILE) {
		seen.add(m[0])
	}
	return [...seen]
}

function walk(root, dir, files) {
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const e of entries) {
		if (e.name.startsWith(".") && e.name !== ".") {
			// allow dotfiles but skip dot-dirs unless they're clearly source
			if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
		}
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue
			walk(root, path.join(dir, e.name), files)
		} else if (e.isFile()) {
			const ext = path.extname(e.name).toLowerCase()
			if (!CODE_EXT.has(ext)) continue
			files.push(path.join(dir, e.name))
		}
		if (files.length > 4000) return // hard cap on file discovery
	}
}

function cachePath(directory) {
	return path.join(directory, ".hramble", "repo-graph-cache.json")
}

function loadCache(directory) {
	try {
		const raw = fs.readFileSync(cachePath(directory), "utf8")
		const data = JSON.parse(raw)
		if (data.version !== CACHE_VERSION) return {}
		return data.files || {}
	} catch {
		return {}
	}
}

function saveCache(directory, files) {
	try {
		fs.mkdirSync(path.join(directory, ".hramble"), { recursive: true })
		fs.writeFileSync(cachePath(directory), JSON.stringify({ version: CACHE_VERSION, files }), "utf8")
	} catch {
		// Best-effort — a failed cache write shouldn't break the tool.
	}
}

// Walks the project, extracting (or reusing cached) symbols + tokens per
// file, then cross-references every symbol against every other file's token
// set to build a lightweight "who references whom" graph. Unchanged files
// (same mtime as last run) skip re-reading and re-parsing entirely.
function buildGraph(directory, base) {
	const files = []
	walk(directory, base, files)
	files.sort()

	const cache = loadCache(directory)
	const nextCache = {}
	const perFile = [] // { rel, symbols: [{kind,name}], tokens: Set }

	for (const f of files) {
		let st
		try {
			st = fs.statSync(f)
		} catch {
			continue
		}
		if (st.size > MAX_FILE_BYTES) continue
		const rel = path.relative(directory, f)
		const cached = cache[rel]

		let symbolLines, tokens
		if (cached && cached.mtimeMs === st.mtimeMs) {
			symbolLines = cached.symbols
			tokens = cached.tokens
		} else {
			let text
			try {
				text = fs.readFileSync(f, "utf8")
			} catch {
				continue
			}
			symbolLines = extractSymbols(path.extname(f).toLowerCase(), text)
			tokens = extractTokens(text)
		}
		nextCache[rel] = { mtimeMs: st.mtimeMs, symbols: symbolLines, tokens }
		perFile.push({
			rel,
			symbols: symbolLines.map((s) => {
				const sp = s.indexOf(" ")
				return { kind: s.slice(0, sp), name: s.slice(sp + 1) }
			}),
			tokenSet: new Set(tokens),
		})
	}

	saveCache(directory, nextCache)

	// symbolIndex: name -> defining file. References: for each file, which
	// OTHER files' symbols show up in its token set.
	const symbolIndex = new Map()
	for (const pf of perFile) {
		for (const s of pf.symbols) {
			if (!symbolIndex.has(s.name)) symbolIndex.set(s.name, pf.rel)
		}
	}

	const referenceCount = new Map() // symbol name -> how many OTHER files mention it
	const referencesByFile = new Map() // rel -> Set of symbol names it references (defined elsewhere)
	for (const pf of perFile) {
		const refs = new Set()
		for (const [name, definingFile] of symbolIndex) {
			if (definingFile === pf.rel) continue
			if (pf.tokenSet.has(name)) {
				refs.add(name)
				referenceCount.set(name, (referenceCount.get(name) || 0) + 1)
			}
		}
		referencesByFile.set(pf.rel, refs)
	}

	return { perFile, symbolIndex, referenceCount, referencesByFile }
}

export default async ({ directory }) => {
	return {
		tool: {
			repo_map: tool({
				description:
					"Get a compact map of the codebase: source files with their top-level symbols (functions, classes, exports, types) AND which symbols are referenced across files — a lightweight relationship graph, not just a flat list. Call this at the start of a task to understand the project's structure before reading individual files. Pass `symbol` to look up one specific thing's relationships instead of the whole map (cheaper, more precise). Language-agnostic (TS/JS, Python, Go, Rust, Java, and more). Cached — repeat calls only re-scan files that changed since last time.",
				args: {
					path: z
						.string()
						.optional()
						.describe("Subdirectory to map, relative to the project root. Omit to map the whole project."),
					symbol: z
						.string()
						.optional()
						.describe(
							"Look up one symbol by exact name instead of the whole map — returns where it's defined and every file that references it.",
						),
				},
				execute: async (args) => {
					const base = args.path ? path.join(directory, args.path) : directory
					if (!base.startsWith(directory)) return "Path is outside the project."
					const graph = buildGraph(directory, base)
					if (!graph.perFile.length) return "No source files found."

					if (args.symbol) {
						const definedIn = graph.symbolIndex.get(args.symbol)
						if (!definedIn) return `"${args.symbol}" isn't a known top-level symbol in this project.`
						const referencedIn = [...graph.referencesByFile.entries()]
							.filter(([, refs]) => refs.has(args.symbol))
							.map(([rel]) => rel)
						return (
							`${args.symbol}\n  defined in: ${definedIn}\n` +
							(referencedIn.length
								? `  referenced in (${referencedIn.length}):\n${referencedIn.map((r) => `    ${r}`).join("\n")}`
								: "  referenced in: nowhere else found")
						)
					}

					// "God nodes" — the few most cross-referenced symbols, same idea as
					// graphify's GRAPH_REPORT.md, cheap to compute since we already have counts.
					const topRefs = [...graph.referenceCount.entries()]
						.sort((a, b) => b[1] - a[1])
						.slice(0, 6)
						.filter(([, count]) => count > 1)
					const topSection = topRefs.length
						? `Most-referenced symbols:\n${topRefs.map(([name, count]) => `  ${name} — used in ${count} other file${count === 1 ? "" : "s"}`).join("\n")}\n\n`
						: ""

					const parts = []
					let chars = topSection.length
					let shown = 0
					let truncated = false
					for (const pf of graph.perFile) {
						const symLines = pf.symbols.map((s) => `${s.kind} ${s.name}`)
						const block = symLines.length
							? `${pf.rel}\n${symLines.map((s) => `  ${s}`).join("\n")}\n`
							: `${pf.rel}\n`
						if (chars + block.length > MAX_OUTPUT_CHARS) {
							truncated = true
							break
						}
						parts.push(block)
						chars += block.length
						shown++
					}
					let header = `Repo map — ${shown} file${shown === 1 ? "" : "s"}`
					if (truncated) {
						header += ` (truncated to fit; ${graph.perFile.length} total — narrow with the "path" arg)`
					}
					return `${header}\n\n${topSection}${parts.join("")}`
				},
			}),
		},
	}
}
