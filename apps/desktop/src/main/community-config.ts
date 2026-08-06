// Community feed configuration — SAFE TO COMMIT. Contains no secrets.
//
// The Supabase URL + anon key below are PUBLIC by design (same as
// AvatarBox's own SUPABASE_PUBLISHABLE_KEY, which is baked directly into its
// shipped client code) — Row Level Security in
// supabase/migrations/0001_community_schema.sql is the actual security
// boundary, not secrecy of these values. Still overridable via env vars for
// local dev against a different project.
//
// Deliberately a SEPARATE Supabase project from the Avatar Store's
// SUPABASE_URL/SUPABASE_ANON_KEY (store-config.ts) — Hramble's Community
// users/posts are kept apart from AvatarBox's, even though both are Supabase
// projects in the same overall Supabase account. See memory
// project_hramble_community_backend.
//
export const COMMUNITY_CONFIG = {
	supabaseUrl: process.env.COMMUNITY_SUPABASE_URL || "https://sojiexeracwwhxhsgvys.supabase.co",
	supabaseAnonKey:
		process.env.COMMUNITY_SUPABASE_ANON_KEY ||
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvamlleGVyYWN3d2h4aHNndnlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NjAxMjUsImV4cCI6MjEwMTQzNjEyNX0.dlhPBdFdLSpyaPJfbyxZBdMlu5eduWNQ36Bt6RMoBho",
	apiBase: process.env.COMMUNITY_API_BASE || "https://hramble-community-api.hramble-community-api.workers.dev",
}

/** Community only works once a Supabase project is actually configured. */
export function communityEnabled(): boolean {
	return Boolean(COMMUNITY_CONFIG.supabaseUrl && COMMUNITY_CONFIG.supabaseAnonKey)
}
