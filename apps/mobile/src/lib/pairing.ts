import { Preferences } from "@capacitor/preferences"

const ROOM_TOKEN_KEY = "hramble:roomToken"

export async function getStoredRoomToken(): Promise<string | null> {
	const { value } = await Preferences.get({ key: ROOM_TOKEN_KEY })
	return value ?? null
}

export async function setStoredRoomToken(token: string): Promise<void> {
	await Preferences.set({ key: ROOM_TOKEN_KEY, value: token })
}

export async function clearStoredRoomToken(): Promise<void> {
	await Preferences.remove({ key: ROOM_TOKEN_KEY })
}
