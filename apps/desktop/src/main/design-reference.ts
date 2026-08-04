import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

// Saves an "Inspect Design" snapshot of a reference page into the current
// project's directory, so the coding agent can read real colors/fonts/asset
// URLs off disk instead of guessing. Content here (page title, hostname,
// image filenames) comes from a third-party webpage the user is browsing —
// treated as untrusted for path purposes, so names are slugged/sanitized
// before touching the filesystem.

export interface DesignReferenceAsset {
	name: string
	base64: string
}

export interface SaveDesignReferenceInput {
	directory: string
	name: string
	manifest: string
	tokensCss: string
	assets: DesignReferenceAsset[]
}

export interface SaveDesignReferenceResult {
	ok: boolean
	savedPath?: string
	error?: string
}

function slug(input: string): string {
	const cleaned = input
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
	return cleaned || "site"
}

export async function saveDesignReference(input: SaveDesignReferenceInput): Promise<SaveDesignReferenceResult> {
	const base = path.resolve(input.directory)
	const refDir = path.join(base, "design-reference", slug(input.name))
	if (refDir !== base && !refDir.startsWith(base + path.sep)) {
		return { ok: false, error: "invalid directory" }
	}
	try {
		await mkdir(refDir, { recursive: true })
		await writeFile(path.join(refDir, "reference.json"), input.manifest, "utf8")
		await writeFile(path.join(refDir, "tokens.css"), input.tokensCss, "utf8")
		if (input.assets.length) {
			const assetsDir = path.join(refDir, "assets")
			await mkdir(assetsDir, { recursive: true })
			for (const asset of input.assets) {
				const safeName = path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "asset"
				const dest = path.join(assetsDir, safeName)
				if (dest !== assetsDir && !dest.startsWith(assetsDir + path.sep)) continue
				await writeFile(dest, Buffer.from(asset.base64, "base64"))
			}
		}
		return { ok: true, savedPath: refDir }
	} catch (err) {
		return { ok: false, error: String(err) }
	}
}
