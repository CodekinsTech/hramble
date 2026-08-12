import { atom } from "jotai"

export interface BridgeMeta {
	title: string
	project: string
}

export interface BridgeEvent {
	role: "user" | "assistant"
	content: string
}

export interface ActiveBridge {
	roomToken: string
	meta: BridgeMeta
	events: BridgeEvent[]
	status: "connecting" | "connected" | "disconnected"
}

export const activeBridgeAtom = atom<ActiveBridge | null>(null)
