/**
 * Team Spaces — a small private group of people working on one project
 * together: invite by email, split the work into pieces, watch each other's
 * progress. Unlike Community's public feed there's no local mock fallback
 * here — this is inherently a real multi-person feature, so it's simply
 * unavailable until the Supabase backend is configured and the user is
 * signed in (same Google session as Community/Settings > Account).
 */
import { Button } from "@hramble/ui/components/button"
import { NativeSelect, NativeSelectOption } from "@hramble/ui/components/native-select"
import { useAtomValue, useSetAtom } from "jotai"
import { CheckIcon, FolderIcon, GitMergeIcon, MailIcon, PlusIcon, UsersIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { communityBackendEnabledAtom, communityUserAtom } from "../atoms/community"
import {
	acceptInviteAtom,
	activeTeamAtom,
	activeTeamIdAtom,
	combinePieceAtom,
	createPieceAtom,
	createTeamAtom,
	inviteMemberAtom,
	myPendingInvitesAtom,
	refreshActiveTeamDetailAtom,
	refreshTeamsAtom,
	setMemberTrustAtom,
	setProjectDirectoryAtom,
	teamActivityAtom,
	teamMembersAtom,
	teamPiecesAtom,
	teamsAtom,
	updatePieceStatusAtom,
} from "../atoms/team"
import { type PieceStatus, subscribeToTeamChanges, type Team, type TeamPiece } from "../lib/team-client"
import { formatRelativeTime } from "../hooks/use-agents"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

const STATUS_LABEL: Record<PieceStatus, string> = {
	not_started: "Not started",
	in_progress: "In progress",
	ready_to_combine: "Ready to combine",
	combined: "Combined",
}

export function GateScreen() {
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)

	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
			<UsersIcon className="size-12 text-ring" />
			<div>
				<h1 className="font-semibold text-foreground text-xl">Team Spaces</h1>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">
					Invite a few people, split the work into pieces, and watch everyone's progress in one place.
				</p>
			</div>
			{backendEnabled ? (
				<Button onClick={() => bridge().community.login()} className="w-full max-w-xs">
					Continue with Google
				</Button>
			) : (
				<p className="text-[11px] text-muted-foreground/60">
					Team Spaces needs the Community backend configured — not available yet.
				</p>
			)}
		</div>
	)
}

export function CreateOrJoinTeam() {
	const [name, setName] = useState("")
	const createTeam = useSetAtom(createTeamAtom)
	const acceptInvite = useSetAtom(acceptInviteAtom)
	const invites = useAtomValue(myPendingInvitesAtom)
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		if (!name.trim() || busy) return
		setBusy(true)
		const id = await createTeam(name.trim())
		setBusy(false)
		if (!id) toast.error("Couldn't create the team — try again")
	}

	return (
		<div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-10">
			<div>
				<h2 className="font-semibold text-foreground text-sm">Start a team</h2>
				<form
					onSubmit={(e) => {
						e.preventDefault()
						submit()
					}}
					className="mt-2 flex gap-2"
				>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Team name"
						className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
					/>
					<Button type="submit" disabled={!name.trim() || busy}>
						Create
					</Button>
				</form>
			</div>

			{invites.length > 0 && (
				<div>
					<h2 className="font-semibold text-foreground text-sm">Invites waiting for you</h2>
					<div className="mt-2 flex flex-col gap-2">
						{invites.map((inv) => (
							<div
								key={inv.id}
								className="flex items-center justify-between rounded-md border border-border px-3 py-2"
							>
								<span className="flex items-center gap-2 text-sm">
									<MailIcon className="size-3.5 text-muted-foreground" />
									Invited by {inv.invitedBy}
								</span>
								<Button size="sm" onClick={() => acceptInvite(inv.id)}>
									Join
								</Button>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

function MembersPanel({ team }: { team: Team }) {
	const members = useAtomValue(teamMembersAtom)
	const inviteMember = useSetAtom(inviteMemberAtom)
	const setMemberTrust = useSetAtom(setMemberTrustAtom)
	const currentUser = useAtomValue(communityUserAtom)
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	const isOwner = currentUser?.email === team.ownerId

	const submit = async () => {
		if (!email.trim() || busy) return
		setBusy(true)
		await inviteMember(email.trim())
		setBusy(false)
		setEmail("")
		toast.success(`Invited ${email.trim()}`)
	}

	return (
		<div className="flex flex-col gap-3">
			<h3 className="font-medium text-foreground text-sm">Members</h3>
			<div className="flex flex-col gap-1.5">
				{members.map((m) => (
					<div key={m.userId} className="flex items-center justify-between text-sm">
						<span>{m.userId}</span>
						<div className="flex items-center gap-2.5">
							<span className="text-muted-foreground text-xs capitalize">{m.role}</span>
							{m.role !== "owner" &&
								(isOwner ? (
									<label className="flex items-center gap-1 text-[11px] text-muted-foreground">
										<input
											type="checkbox"
											checked={m.canCombine}
											onChange={(e) => setMemberTrust({ userId: m.userId, canCombine: e.target.checked })}
											className="size-3"
										/>
										Trusted to combine
									</label>
								) : (
									m.canCombine && (
										<span className="text-[11px] text-emerald-600 dark:text-emerald-400">Trusted to combine</span>
									)
								))}
						</div>
					</div>
				))}
			</div>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					submit()
				}}
				className="flex gap-2"
			>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="teammate@email.com"
					className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
				/>
				<Button size="sm" type="submit" disabled={!email.trim() || busy}>
					Invite
				</Button>
			</form>
			<p className="text-[11px] text-muted-foreground/60" id={`team-${team.id}-invite-hint`}>
				They need a Hramble account with this same email to accept. By default only the owner can combine a
				member's piece — check "Trusted to combine" to let them do it themselves.
			</p>
		</div>
	)
}

function PieceRow({ piece }: { piece: TeamPiece }) {
	const team = useAtomValue(activeTeamAtom)
	const members = useAtomValue(teamMembersAtom)
	const currentUser = useAtomValue(communityUserAtom)
	const updateStatus = useSetAtom(updatePieceStatusAtom)
	const combine = useSetAtom(combinePieceAtom)
	const [branch, setBranch] = useState(piece.branchName ?? "")
	const [combining, setCombining] = useState(false)

	const myMembership = members.find((m) => m.userId === currentUser?.email)
	// Owners can always combine; everyone else needs the owner to have checked "Trusted to combine" for them.
	const canCombineDirectly = myMembership?.role === "owner" || !!myMembership?.canCombine
	const ready = piece.status === "ready_to_combine" && !!piece.branchName && !!team?.projectDirectory
	const canCombine = ready && canCombineDirectly

	const runCombine = async () => {
		setCombining(true)
		const result = await combine(piece.id)
		setCombining(false)
		if (result.success) toast.success(`Combined "${piece.name}"`)
		else toast.error(result.error ?? "Combine failed — see the piece for details")
	}

	return (
		<div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
			<div className="flex items-center gap-2">
				<span className="flex-1 truncate text-sm">{piece.name}</span>
				<span className="text-muted-foreground text-xs">{piece.assignedTo ?? "unassigned"}</span>
				<NativeSelect
					value={piece.status}
					onChange={(e) => updateStatus({ pieceId: piece.id, status: e.target.value as PieceStatus })}
					className="h-7 w-36 text-xs"
				>
					{(Object.keys(STATUS_LABEL) as PieceStatus[]).map((s) => (
						<NativeSelectOption key={s} value={s}>
							{STATUS_LABEL[s]}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			<div className="flex items-center gap-2">
				<input
					value={branch}
					onChange={(e) => setBranch(e.target.value)}
					onBlur={() => {
						if (branch !== (piece.branchName ?? "")) updateStatus({ pieceId: piece.id, branchName: branch || null })
					}}
					placeholder="branch name (e.g. opencode/login-screen)"
					className="h-7 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
				/>
				<Button size="sm" variant="outline" disabled={!canCombine || combining} onClick={runCombine}>
					<GitMergeIcon className="size-3.5" />
					{combining ? "Combining…" : "Combine"}
				</Button>
			</div>
			{ready && !canCombineDirectly && (
				<p className="text-[11px] text-muted-foreground">Ready — waiting for the owner to combine it</p>
			)}
			{piece.lastCombineError && <p className="text-[11px] text-red-500">{piece.lastCombineError}</p>}
		</div>
	)
}

function PiecesBoard() {
	const pieces = useAtomValue(teamPiecesAtom)
	const createPiece = useSetAtom(createPieceAtom)
	const [name, setName] = useState("")

	return (
		<div className="flex flex-col gap-3">
			<h3 className="font-medium text-foreground text-sm">Pieces</h3>
			<div className="flex flex-col gap-2">
				{pieces.map((p) => (
					<PieceRow key={p.id} piece={p} />
				))}
				{pieces.length === 0 && <p className="text-muted-foreground text-xs">No pieces yet — add the first one below.</p>}
			</div>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					if (!name.trim()) return
					createPiece(name.trim())
					setName("")
				}}
				className="flex gap-2"
			>
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. Login screen"
					className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
				/>
				<Button size="sm" type="submit" disabled={!name.trim()}>
					<PlusIcon className="size-3.5" />
					Add piece
				</Button>
			</form>
		</div>
	)
}

function ActivityFeed() {
	const activity = useAtomValue(teamActivityAtom)

	return (
		<div className="flex flex-col gap-2">
			<h3 className="font-medium text-foreground text-sm">Activity</h3>
			<div className="flex flex-col gap-1.5">
				{activity.map((a) => (
					<div key={a.id} className="flex items-start gap-2 text-sm">
						<CheckIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
						<span className="flex-1">
							<span className="text-muted-foreground">{a.userId}</span> — {a.message}
						</span>
						<span className="shrink-0 text-[11px] text-muted-foreground/60">{formatRelativeTime(a.createdAt)}</span>
					</div>
				))}
				{activity.length === 0 && <p className="text-muted-foreground text-xs">Nothing yet.</p>}
			</div>
		</div>
	)
}

/** "3/5 pieces done" + a thin progress bar — the at-a-glance status summary. */
function ProgressSummary() {
	const pieces = useAtomValue(teamPiecesAtom)
	if (pieces.length === 0) return null

	const done = pieces.filter((p) => p.status === "combined").length
	const ready = pieces.filter((p) => p.status === "ready_to_combine").length
	const pct = Math.round((done / pieces.length) * 100)

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between text-muted-foreground text-xs">
				<span>
					{done}/{pieces.length} pieces combined
					{ready > 0 && ` · ${ready} ready to combine`}
				</span>
				<span>{pct}%</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
			</div>
		</div>
	)
}

function ProjectFolderRow({ team }: { team: Team }) {
	const setProjectDirectory = useSetAtom(setProjectDirectoryAtom)

	const pick = async () => {
		const dir = await bridge().pickDirectory()
		if (dir) setProjectDirectory(dir)
	}

	return (
		<button
			type="button"
			onClick={pick}
			className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-xs hover:border-foreground/30 hover:text-foreground"
		>
			<FolderIcon className="size-3.5 shrink-0" />
			{team.projectDirectory ? (
				<span className="truncate font-mono">{team.projectDirectory}</span>
			) : (
				<span>Set project folder — where "Combine" merges pieces into</span>
			)}
		</button>
	)
}

/** The team body — folder, progress, members, pieces, activity. Shared by the standalone Team page and ProForge's Master Session. */
export function TeamWorkspace({ team }: { team: Team }) {
	return (
		<>
			<ProjectFolderRow team={team} />
			<ProgressSummary />
			<MembersPanel team={team} />
			<PiecesBoard />
			<ActivityFeed />
		</>
	)
}

function TeamDashboard() {
	const team = useAtomValue(activeTeamAtom)
	const teams = useAtomValue(teamsAtom)
	const setActiveTeamId = useSetAtom(activeTeamIdAtom)

	if (!team) return null

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
			<div className="flex items-center justify-between">
				<h1 className="font-semibold text-foreground text-xl">{team.name}</h1>
				{teams.length > 1 && (
					<NativeSelect
						value={team.id}
						onChange={(e) => setActiveTeamId(e.target.value)}
						className="h-8 w-48 text-sm"
					>
						{teams.map((t) => (
							<NativeSelectOption key={t.id} value={t.id}>
								{t.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</div>
			<TeamWorkspace team={team} />
		</div>
	)
}

/** Fetches/subscribes teams + active team detail. Shared by the standalone Team page and ProForge's Master Session. */
export function useTeamSpaces() {
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const user = useAtomValue(communityUserAtom)
	const teams = useAtomValue(teamsAtom)
	const activeTeamId = useAtomValue(activeTeamIdAtom)
	const refreshTeams = useSetAtom(refreshTeamsAtom)
	const refreshDetail = useSetAtom(refreshActiveTeamDetailAtom)

	useEffect(() => {
		if (backendEnabled && user) refreshTeams()
	}, [backendEnabled, user, refreshTeams])

	useEffect(() => {
		if (backendEnabled && user) refreshDetail()
	}, [backendEnabled, user, activeTeamId, refreshDetail])

	// Live updates: whenever a teammate changes a piece's status, posts
	// activity, or joins, everyone's dashboard refreshes automatically.
	useEffect(() => {
		if (!backendEnabled || !user || !activeTeamId) return
		let unsubscribe: (() => void) | undefined
		let cancelled = false
		subscribeToTeamChanges(activeTeamId, () => refreshDetail()).then((fn) => {
			if (cancelled) fn()
			else unsubscribe = fn
		})
		return () => {
			cancelled = true
			unsubscribe?.()
		}
	}, [backendEnabled, user, activeTeamId, refreshDetail])

	return { backendEnabled, user, teams }
}

export function TeamPage() {
	const { backendEnabled, user, teams } = useTeamSpaces()

	if (!backendEnabled || !user) return <GateScreen />
	if (teams.length === 0) return <CreateOrJoinTeam />
	return <TeamDashboard />
}
