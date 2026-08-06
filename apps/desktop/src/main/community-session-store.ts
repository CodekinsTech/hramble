/**
 * Encrypted persistence for the Community feed's Supabase session (access +
 * refresh token), so signing in survives an app restart without redoing the
 * Google OAuth dance every launch. Same safeStorage + userData JSON pattern
 * as credential-store.ts.
 */

import fs from "node:fs"
import path from "node:path"
import { app, safeStorage } from "electron"
import { createLogger } from "./logger"

const log = createLogger("community-session-store")

export interface CommunitySession {
	accessToken: string
	refreshToken: string
	email: string
	name: string
	/** epoch ms */
	expiresAt: number
}

let session: CommunitySession | null = null
let sessionPath: string | null = null

export function initCommunitySessionStore(): void {
	sessionPath = path.join(app.getPath("userData"), "community-session.json")
	try {
		if (fs.existsSync(sessionPath)) {
			const raw = fs.readFileSync(sessionPath, "utf-8")
			const { encrypted } = JSON.parse(raw) as { encrypted: string }
			const decoded = safeStorage.isEncryptionAvailable()
				? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
				: Buffer.from(encrypted, "base64").toString("utf-8")
			session = JSON.parse(decoded)
			log.info("Community session loaded", { email: session?.email })
		}
	} catch (err) {
		log.error("Failed to load community session, starting signed out", err)
		session = null
	}
}

export function getCommunitySession(): CommunitySession | null {
	return session
}

export function storeCommunitySession(next: CommunitySession): void {
	session = next
	persist()
}

export function clearCommunitySession(): void {
	session = null
	if (sessionPath && fs.existsSync(sessionPath)) {
		try {
			fs.unlinkSync(sessionPath)
		} catch (err) {
			log.error("Failed to delete community session file", err)
		}
	}
}

function persist(): void {
	if (!sessionPath || !session) return
	try {
		const plain = JSON.stringify(session)
		const encrypted = safeStorage.isEncryptionAvailable()
			? safeStorage.encryptString(plain).toString("base64")
			: Buffer.from(plain, "utf-8").toString("base64")
		const tmpPath = `${sessionPath}.tmp`
		fs.writeFileSync(tmpPath, JSON.stringify({ encrypted }), "utf-8")
		fs.renameSync(tmpPath, sessionPath)
	} catch (err) {
		log.error("Failed to persist community session", err)
	}
}
