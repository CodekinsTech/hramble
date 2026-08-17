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
