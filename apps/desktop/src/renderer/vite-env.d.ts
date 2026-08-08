/** Vite-specific extensions to ImportMeta (renderer process only). */
interface ImportMetaEnv {
	readonly DEV: boolean
	readonly PROD: boolean
	readonly MODE: string
	readonly BASE_URL: string
	readonly SSR: boolean
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

/**
 * Vite resolves `import x from "./foo.png"` to the built asset URL at
 * runtime (see hramble-logo.tsx, agent-hub-page.tsx) — this just tells the
 * type checker the same thing so those imports aren't flagged as missing
 * modules. Pre-existing gap (hramble-logo.tsx/working-mark.tsx already did
 * this import before this file added the declaration); not new behavior.
 */
declare module "*.png" {
	const src: string
	export default src
}
