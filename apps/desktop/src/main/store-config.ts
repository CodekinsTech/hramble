// Avatar store configuration — SAFE TO COMMIT. Contains no secrets.
//
// Everything is read from environment variables at build/run time and defaults
// to empty. That means:
//   • the repo builds for anyone who clones it (no missing-file import error)
//   • no credential is ever baked into open-source code
//   • the store simply stays disabled unless the env vars are supplied
//
// The store is intentionally OFF in the free/open-source build. To enable it in
// a private release, provide:
//   AVATAR_BOOTSTRAP_TOKEN   (server-side secret — main process only)
//   RAZORPAY_KEY_ID          (public checkout key)
//   SUPABASE_URL / SUPABASE_ANON_KEY  (public)
export const STORE_CONFIG = {
	apiBase: process.env.AVATAR_API_BASE || "https://api.avatarbox.app",
	bootstrapToken: process.env.AVATAR_BOOTSTRAP_TOKEN || "",
	razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
	supabaseUrl: process.env.SUPABASE_URL || "",
	supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
}

/** The store only works when a bootstrap token is supplied. */
export function storeEnabled(): boolean {
	return Boolean(STORE_CONFIG.bootstrapToken)
}
