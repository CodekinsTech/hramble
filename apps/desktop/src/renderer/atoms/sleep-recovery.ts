/**
 * "Your Mac went to sleep — want to continue?" — snapshots whatever's
 * actively running (a Code session or a Hyperloop step) the moment the Mac
 * suspends, then re-checks after waking. Only surfaces items that are
 * *still* stuck after a grace period (some in-flight work finishes fine on
 * its own right after waking — that's not an interruption worth a prompt).
 */
import { atom } from "jotai"
import { agentsAtom } from "./derived/agents"
import { appStore } from "./store"
import { type HyperloopRun, hyperloopRunsAtom } from "./workspace"

export interface InterruptedItem {
	kind: "session" | "hyperloop"
	id: string
	label: string
	projectSlug?: string
	sessionId?: string
}

/** How long to wait after waking before deciding something is genuinely stuck, not just still finishing up. */
const RESUME_GRACE_MS = 8000

export const interruptedWorkAtom = atom<InterruptedItem[]>([])

let preSleepSnapshot: InterruptedItem[] = []

function snapshotActiveWork(): InterruptedItem[] {
	const items: InterruptedItem[] = []
	for (const agent of appStore.get(agentsAtom)) {
		if (agent.status === "running") {
			items.push({
				kind: "session",
				id: agent.sessionId,
				label: agent.name || "Untitled session",
				projectSlug: agent.projectSlug,
				sessionId: agent.sessionId,
			})
		}
	}
	for (const run of appStore.get(hyperloopRunsAtom)) {
		if (run.steps.some((s) => s.status === "running" || s.status === "repairing")) {
			items.push({ kind: "hyperloop", id: run.id ?? run.goal, label: run.goal })
		}
	}
	return items
}

function isStillStuck(item: InterruptedItem): boolean {
	if (item.kind === "session") {
		const agent = appStore.get(agentsAtom).find((a) => a.sessionId === item.sessionId)
		return agent?.status === "running"
	}
	const run = appStore.get(hyperloopRunsAtom).find((r: HyperloopRun) => (r.id ?? r.goal) === item.id)
	return !!run?.steps.some((s) => s.status === "running" || s.status === "repairing")
}

export function handleSuspend(): void {
	preSleepSnapshot = snapshotActiveWork()
}

export function handleResume(): void {
	if (preSleepSnapshot.length === 0) return
	const toCheck = preSleepSnapshot
	preSleepSnapshot = []
	setTimeout(() => {
		const stillStuck = toCheck.filter(isStillStuck)
		if (stillStuck.length > 0) appStore.set(interruptedWorkAtom, stillStuck)
	}, RESUME_GRACE_MS)
}

export const dismissInterruptedWorkAtom = atom(null, (_get, set) => {
	set(interruptedWorkAtom, [])
})

/** Dismisses just one interrupted item — used by the inline per-session/per-run notice. */
export const resolveInterruptedItemAtom = atom(null, (_get, set, id: string) => {
	set(interruptedWorkAtom, (prev) => prev.filter((i) => i.id !== id))
})
