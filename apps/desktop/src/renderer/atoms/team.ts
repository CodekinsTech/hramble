/**
 * Team Spaces state. Reuses communityBackendEnabledAtom/communityUserAtom
 * from atoms/community.ts — same Supabase project, same signed-in session.
 * No local mock: every atom here is empty/no-op until the backend is
 * enabled and the user is signed in.
 */
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import {
	acceptInvite as acceptInviteRemote,
	createPiece as createPieceRemote,
	createTeam as createTeamRemote,
	fetchMyPendingInvites,
	fetchMyTeams,
	fetchTeamActivity,
	fetchTeamMembers,
	fetchTeamPieces,
	inviteMember as inviteMemberRemote,
	postTeamActivity,
	type PieceStatus,
	setMemberTrust,
	setTeamProjectDirectory,
	type Team,
	type TeamActivityEntry,
	type TeamInvite,
	type TeamMember,
	type TeamPiece,
	updatePiece as updatePieceRemote,
} from "../lib/team-client"
import { communityBackendEnabledAtom, communityUserAtom } from "./community"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

export const teamsAtom = atom<Team[]>([])
export const activeTeamIdAtom = atomWithStorage<string | null>("hramble:activeTeamId", null)
export const teamMembersAtom = atom<TeamMember[]>([])
export const teamPiecesAtom = atom<TeamPiece[]>([])
export const teamActivityAtom = atom<TeamActivityEntry[]>([])
export const myPendingInvitesAtom = atom<TeamInvite[]>([])

/** Master Session's Canvas tab — the last-known shared dev-server URL per team, cached locally so it shows immediately before the live relay connection (lib/master-session-relay.ts) syncs. */
export const masterSessionPreviewUrlAtom = atomWithStorage<Record<string, string>>(
	"hramble:masterSessionPreviewUrl",
	{},
)

export const activeTeamAtom = atom((get) => {
	const id = get(activeTeamIdAtom)
	return get(teamsAtom).find((t) => t.id === id) ?? null
})

/** Fetches the caller's teams and invites. Call on Team page mount / after create/accept. */
export const refreshTeamsAtom = atom(null, async (get, set) => {
	if (!get(communityBackendEnabledAtom)) return
	const [teams, invites] = await Promise.all([fetchMyTeams(), fetchMyPendingInvites()])
	set(teamsAtom, teams)
	set(myPendingInvitesAtom, invites)
	const activeId = get(activeTeamIdAtom)
	if (!activeId && teams.length > 0) set(activeTeamIdAtom, teams[0].id)
	if (activeId && !teams.some((t) => t.id === activeId)) set(activeTeamIdAtom, teams[0]?.id ?? null)
})

/** Fetches members/pieces/activity for the currently active team. */
export const refreshActiveTeamDetailAtom = atom(null, async (get, set) => {
	const team = get(activeTeamAtom)
	if (!team) {
		set(teamMembersAtom, [])
		set(teamPiecesAtom, [])
		set(teamActivityAtom, [])
		return
	}
	const [members, pieces, activity] = await Promise.all([
		fetchTeamMembers(team.id),
		fetchTeamPieces(team.id),
		fetchTeamActivity(team.id),
	])
	set(teamMembersAtom, members)
	set(teamPiecesAtom, pieces)
	set(teamActivityAtom, activity)
})

export const createTeamAtom = atom(null, async (_get, set, name: string) => {
	const teamId = await createTeamRemote(name)
	if (!teamId) return null
	await set(refreshTeamsAtom)
	set(activeTeamIdAtom, teamId)
	await set(refreshActiveTeamDetailAtom)
	return teamId
})

export const inviteMemberAtom = atom(null, async (get, set, email: string) => {
	const team = get(activeTeamAtom)
	if (!team) return
	const user = get(communityUserAtom)
	await inviteMemberRemote(team.id, email)
	if (user) await postTeamActivity(team.id, user.email, "invited", `Invited ${email}`)
	await set(refreshActiveTeamDetailAtom)
})

export const acceptInviteAtom = atom(null, async (_get, set, inviteId: string) => {
	const teamId = await acceptInviteRemote(inviteId)
	if (!teamId) return
	await set(refreshTeamsAtom)
	set(activeTeamIdAtom, teamId)
	await set(refreshActiveTeamDetailAtom)
})

export const createPieceAtom = atom(null, async (get, set, name: string) => {
	const team = get(activeTeamAtom)
	if (!team) return
	const user = get(communityUserAtom)
	const piece = await createPieceRemote(team.id, name)
	if (piece && user) await postTeamActivity(team.id, user.email, "piece_created", `Added piece "${name}"`)
	await set(refreshActiveTeamDetailAtom)
})

export const updatePieceStatusAtom = atom(
	null,
	async (
		get,
		set,
		args: { pieceId: string; status?: PieceStatus; assignedTo?: string | null; branchName?: string | null },
	) => {
		const team = get(activeTeamAtom)
		const user = get(communityUserAtom)
		const piece = await updatePieceRemote(args.pieceId, {
			status: args.status,
			assignedTo: args.assignedTo,
			branchName: args.branchName,
		})
		if (piece && team && user) {
			if (args.status) await postTeamActivity(team.id, user.email, "piece_status", `"${piece.name}" → ${args.status}`)
			if (args.assignedTo !== undefined) {
				await postTeamActivity(
					team.id,
					user.email,
					"piece_assigned",
					args.assignedTo ? `"${piece.name}" assigned to ${args.assignedTo}` : `"${piece.name}" unassigned`,
				)
			}
		}
		await set(refreshActiveTeamDetailAtom)
	},
)

export const setMemberTrustAtom = atom(
	null,
	async (get, set, args: { userId: string; canCombine: boolean }) => {
		const team = get(activeTeamAtom)
		if (!team) return
		const user = get(communityUserAtom)
		const ok = await setMemberTrust(team.id, args.userId, args.canCombine)
		if (ok && user) {
			await postTeamActivity(
				team.id,
				user.email,
				"trust_changed",
				args.canCombine ? `Trusted ${args.userId} to combine directly` : `Revoked ${args.userId}'s combine trust`,
			)
		}
		await set(refreshActiveTeamDetailAtom)
	},
)

export const setProjectDirectoryAtom = atom(null, async (get, set, directory: string) => {
	const team = get(activeTeamAtom)
	if (!team) return
	await setTeamProjectDirectory(team.id, directory)
	await set(refreshTeamsAtom)
})

export interface CombineResult {
	success: boolean
	conflictedFiles: string[]
	error?: string
}

/**
 * The Combine button: merges one piece's branch into the team's project
 * directory via a real `git merge` (git-service.ts's mergeBranch, over the
 * existing git IPC — the same channel Hramble's worktree/branch-picker UI
 * already uses). On success the piece flips to "combined"; on conflict, the
 * merge is aborted (working tree stays clean) and the conflicted files are
 * recorded on the piece so the team can see exactly what needs resolving.
 */
export const combinePieceAtom = atom(null, async (get, set, pieceId: string): Promise<CombineResult> => {
	const team = get(activeTeamAtom)
	const user = get(communityUserAtom)
	const piece = get(teamPiecesAtom).find((p) => p.id === pieceId)

	if (!team?.projectDirectory) return { success: false, conflictedFiles: [], error: "No project folder set for this team yet" }
	if (!piece?.branchName) return { success: false, conflictedFiles: [], error: "This piece has no branch name set" }

	const result = await bridge().git.mergeBranch(team.projectDirectory, piece.branchName)

	if (result.success) {
		await updatePieceRemote(pieceId, { status: "combined", lastCombineError: null })
		if (user) await postTeamActivity(team.id, user.email, "combined", `Combined "${piece.name}" (${piece.branchName})`)
	} else {
		const errorMsg =
			result.conflictedFiles.length > 0
				? `Conflicts in: ${result.conflictedFiles.join(", ")}`
				: (result.error ?? "Merge failed")
		await updatePieceRemote(pieceId, { lastCombineError: errorMsg })
		if (user) await postTeamActivity(team.id, user.email, "combine_failed", `"${piece.name}" — ${errorMsg}`)
	}

	await set(refreshActiveTeamDetailAtom)
	return result
})
