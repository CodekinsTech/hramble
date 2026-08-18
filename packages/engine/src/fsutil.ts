import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { nanoid } from "nanoid"

/**
 * Atomic file write: write to a temp file in the same directory, then rename
 * over the target. rename is atomic within a filesystem, so a crash/kill mid-
 * write can never leave the target truncated or half-written.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
	const dir = path.dirname(filePath)
	await fsp.mkdir(dir, { recursive: true })
	const tmp = path.join(dir, `.${path.basename(filePath)}.${nanoid(8)}.tmp`)
	try {
		await fsp.writeFile(tmp, content, "utf-8")
		await fsp.rename(tmp, filePath)
	} catch (err) {
		try {
			await fsp.rm(tmp, { force: true })
		} catch {
			// ignore cleanup failure
		}
		throw err
	}
}

/** Directories never worth showing in a file tree — noise that floods the view. */
const ALWAYS_IGNORE = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"target",
	".venv",
	"__pycache__",
	".turbo",
	".cache",
])

export interface DirEntry {
	name: string
	type: "directory" | "file"
	/** Path relative to the project root, forward-slashed. */
	path: string
	ignored: boolean
}

/**
 * List one level of a directory, relative to a project root. `relPath` is a
 * project-relative sub-path ("" for the root). Refuses to escape `root` (path
 * traversal), so a crafted `..` sub-path can't read outside the open project.
 * Directories are returned before files, each alphabetically.
 */
export async function listDirectory(root: string, relPath = ""): Promise<DirEntry[]> {
	const abs = path.resolve(root, relPath)
	const rel = path.relative(root, abs)
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("path escapes project root")
	}
	const dirents = await fsp.readdir(abs, { withFileTypes: true })
	const entries: DirEntry[] = dirents.map((d) => {
		const isDir = d.isDirectory()
		return {
			name: d.name,
			type: isDir ? ("directory" as const) : ("file" as const),
			path: path.join(rel, d.name).replace(/\\/g, "/"),
			ignored: ALWAYS_IGNORE.has(d.name),
		}
	})
	entries.sort((a, b) =>
		a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
	)
	return entries
}

/** Synchronous atomic write (for the hot persistence path). */
export function atomicWriteSync(filePath: string, content: string): void {
	const dir = path.dirname(filePath)
	fs.mkdirSync(dir, { recursive: true })
	const tmp = path.join(dir, `.${path.basename(filePath)}.${nanoid(8)}.tmp`)
	try {
		fs.writeFileSync(tmp, content, "utf-8")
		fs.renameSync(tmp, filePath)
	} catch (err) {
		try {
			fs.rmSync(tmp, { force: true })
		} catch {
			// ignore
		}
		throw err
	}
}
