// Hramble repo map — gives the model codebase awareness in one call.
//
// Registers a `repo_map` tool that scans the project and returns a compact
// map: each source file with its top-level symbols (functions, classes,
// exports, types). Same idea as aider's repo map / Claude's codebase sense —
// the model gets the shape of the codebase without reading every file.
//
// Language-agnostic and dependency-free: symbols are pulled with lightweight
// per-language regexes, so it never needs tree-sitter or a build step. Output
// is capped to a token budget so it stays cheap to feed to a model.

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
const MAX_OUTPUT_CHARS = 14_000 // keep the map affordable to feed to a model

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

export default async ({ directory }) => {
	return {
		tool: {
			repo_map: tool({
				description:
					"Get a compact map of the codebase: source files with their top-level symbols (functions, classes, exports, types). Call this at the start of a task to understand the project's structure before reading individual files. Language-agnostic (TS/JS, Python, Go, Rust, Java, and more).",
				args: {
					path: z
						.string()
						.optional()
						.describe("Subdirectory to map, relative to the project root. Omit to map the whole project."),
				},
				execute: async (args) => {
					const base = args.path ? path.join(directory, args.path) : directory
					if (!base.startsWith(directory)) return "Path is outside the project."
					const files = []
					walk(directory, base, files)
					if (!files.length) return "No source files found."

					// Group by directory for a readable tree, sorted.
					files.sort()
					const parts = []
					let chars = 0
					let shown = 0
					let truncated = false
					for (const f of files) {
						let text
						try {
							const st = fs.statSync(f)
							if (st.size > MAX_FILE_BYTES) continue
							text = fs.readFileSync(f, "utf8")
						} catch {
							continue
						}
						const rel = path.relative(directory, f)
						const syms = extractSymbols(path.extname(f).toLowerCase(), text)
						const block = syms.length
							? `${rel}\n${syms.map((s) => `  ${s}`).join("\n")}\n`
							: `${rel}\n`
						if (chars + block.length > MAX_OUTPUT_CHARS) {
							truncated = true
							break
						}
						parts.push(block)
						chars += block.length
						shown++
					}
					let header = `Repo map — ${shown} file${shown === 1 ? "" : "s"}`
					if (truncated) header += ` (truncated to fit; ${files.length} total — narrow with the "path" arg)`
					return `${header}\n\n${parts.join("")}`
				},
			}),
		},
	}
}
