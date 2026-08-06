/**
 * Team Spaces — lives in the same Supabase project as Community (see
 * supabase/migrations/0002_team_spaces_schema.sql), reuses the same
 * getClient()/auth session from community-client.ts. There is no local mock
 * fallback here (unlike Community's public feed): Team Spaces is inherently
 * a real multi-person feature, so it's simply unavailable when the backend
 * isn't configured — see communityBackendEnabledAtom.
 */
import { getClient } from "./community-client"

export interface Team {
	id: string
	name: string
	ownerId: string
	createdAt: number
	/** Local repo this team's pieces combine into — set once via "Set project folder." */
	projectDirectory: string | null
}

export interface TeamMember {
	teamId: string
	userId: string
	role: "owner" | "member"
	joinedAt: number
}

export interface TeamInvite {
	id: string
	teamId: string
	email: string
	invitedBy: string
	status: "pending" | "accepted" | "declined"
	createdAt: number
}

export type PieceStatus = "not_started" | "in_progress" | "ready_to_combine" | "combined"

export interface TeamPiece {
	id: string
	teamId: string
	name: string
	assignedTo: string | null
	status: PieceStatus
	branchName: string | null
	lastCombineError: string | null
	createdAt: number
	updatedAt: number
}

export interface TeamActivityEntry {
	id: string
	teamId: string
	userId: string
	type: string
	message: string | null
	createdAt: number
}

function rowToTeam(r: { id: string; name: string; owner_id: string; created_at: string; project_directory: string | null }): Team {
	return {
		id: r.id,
		name: r.name,
		ownerId: r.owner_id,
		createdAt: new Date(r.created_at).getTime(),
		projectDirectory: r.project_directory,
	}
}

function rowToMember(r: { team_id: string; user_id: string; role: "owner" | "member"; joined_at: string }): TeamMember {
	return { teamId: r.team_id, userId: r.user_id, role: r.role, joinedAt: new Date(r.joined_at).getTime() }
}

function rowToInvite(r: {
	id: string
	team_id: string
	email: string
	invited_by: string
	status: "pending" | "accepted" | "declined"
	created_at: string
}): TeamInvite {
	return {
		id: r.id,
		teamId: r.team_id,
		email: r.email,
		invitedBy: r.invited_by,
		status: r.status,
		createdAt: new Date(r.created_at).getTime(),
	}
}

function rowToPiece(r: {
	id: string
	team_id: string
	name: string
	assigned_to: string | null
	status: PieceStatus
	branch_name: string | null
	last_combine_error: string | null
	created_at: string
	updated_at: string
}): TeamPiece {
	return {
		id: r.id,
		teamId: r.team_id,
		name: r.name,
		assignedTo: r.assigned_to,
		status: r.status,
		branchName: r.branch_name,
		lastCombineError: r.last_combine_error,
		createdAt: new Date(r.created_at).getTime(),
		updatedAt: new Date(r.updated_at).getTime(),
	}
}

function rowToActivity(r: { id: string; team_id: string; user_id: string; type: string; message: string | null; created_at: string }): TeamActivityEntry {
	return {
		id: r.id,
		teamId: r.team_id,
		userId: r.user_id,
		type: r.type,
		message: r.message,
		createdAt: new Date(r.created_at).getTime(),
	}
}

/** Creates a team and makes the caller its owner (via the create_team RPC — see migration). Returns the new team's id, or null on failure. */
export async function createTeam(name: string): Promise<string | null> {
	const c = await getClient()
	if (!c) return null
	const { data, error } = await c.rpc("create_team", { p_name: name })
	if (error) {
		console.error("[team-client] create_team failed", error.message, error.code, error.details, error.hint)
		return null
	}
	return data as string
}

/** RLS scopes this to only teams the caller is already a member of. */
export async function fetchMyTeams(): Promise<Team[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c.from("teams").select("*").order("created_at", { ascending: false })
	if (error || !data) return []
	return data.map(rowToTeam)
}

export async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c.from("team_members").select("*").eq("team_id", teamId).order("joined_at")
	if (error || !data) return []
	return data.map(rowToMember)
}

/** Invites an email to the team (via the invite_member RPC). Returns the invite id, or null on failure. */
export async function inviteMember(teamId: string, email: string): Promise<string | null> {
	const c = await getClient()
	if (!c) return null
	const { data, error } = await c.rpc("invite_member", { p_team_id: teamId, p_email: email })
	if (error) return null
	return data as string
}

/** Invites addressed to the signed-in user's own email, still pending. */
export async function fetchMyPendingInvites(): Promise<TeamInvite[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c.from("team_invites").select("*").eq("status", "pending").order("created_at", { ascending: false })
	if (error || !data) return []
	return data.map(rowToInvite)
}

/** Accepts an invite (via the accept_invite RPC). Returns the team id joined, or null on failure. */
export async function acceptInvite(inviteId: string): Promise<string | null> {
	const c = await getClient()
	if (!c) return null
	const { data, error } = await c.rpc("accept_invite", { p_invite_id: inviteId })
	if (error) return null
	return data as string
}

export async function fetchTeamPieces(teamId: string): Promise<TeamPiece[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c.from("team_pieces").select("*").eq("team_id", teamId).order("created_at")
	if (error || !data) return []
	return data.map(rowToPiece)
}

export async function createPiece(teamId: string, name: string): Promise<TeamPiece | null> {
	const c = await getClient()
	if (!c) return null
	const { data, error } = await c.from("team_pieces").insert({ team_id: teamId, name }).select().single()
	if (error || !data) return null
	return rowToPiece(data)
}

export async function updatePiece(
	pieceId: string,
	patch: {
		status?: PieceStatus
		assignedTo?: string | null
		branchName?: string | null
		lastCombineError?: string | null
	},
): Promise<TeamPiece | null> {
	const c = await getClient()
	if (!c) return null
	const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
	if (patch.status) update.status = patch.status
	if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo
	if (patch.branchName !== undefined) update.branch_name = patch.branchName
	if (patch.lastCombineError !== undefined) update.last_combine_error = patch.lastCombineError
	const { data, error } = await c.from("team_pieces").update(update).eq("id", pieceId).select().single()
	if (error || !data) return null
	return rowToPiece(data)
}

/** Sets the local repo directory this team's pieces combine into. */
export async function setTeamProjectDirectory(teamId: string, directory: string): Promise<void> {
	const c = await getClient()
	if (!c) return
	await c.from("teams").update({ project_directory: directory }).eq("id", teamId)
}

export async function fetchTeamActivity(teamId: string, limit = 50): Promise<TeamActivityEntry[]> {
	const c = await getClient()
	if (!c) return []
	const { data, error } = await c
		.from("team_activity")
		.select("*")
		.eq("team_id", teamId)
		.order("created_at", { ascending: false })
		.limit(limit)
	if (error || !data) return []
	return data.map(rowToActivity)
}

/** userId must be the caller's own email — enforced by RLS (team_activity_insert_own). */
export async function postTeamActivity(teamId: string, userId: string, type: string, message?: string): Promise<void> {
	const c = await getClient()
	if (!c) return
	await c.from("team_activity").insert({ team_id: teamId, user_id: userId, type, message: message ?? null })
}

/**
 * Live-updates the dashboard for every team member: subscribes to
 * team_pieces/team_activity/team_members changes for one team (requires
 * Realtime enabled on those tables — see 0004_team_realtime.sql) and calls
 * `onChange` whenever any of them fire. Returns an unsubscribe function.
 */
export async function subscribeToTeamChanges(teamId: string, onChange: () => void): Promise<() => void> {
	const c = await getClient()
	if (!c) return () => {}

	const channel = c
		.channel(`team-${teamId}`)
		.on("postgres_changes", { event: "*", schema: "public", table: "team_pieces", filter: `team_id=eq.${teamId}` }, onChange)
		.on("postgres_changes", { event: "*", schema: "public", table: "team_activity", filter: `team_id=eq.${teamId}` }, onChange)
		.on("postgres_changes", { event: "*", schema: "public", table: "team_members", filter: `team_id=eq.${teamId}` }, onChange)
		.subscribe()

	return () => {
		c.removeChannel(channel)
	}
}
