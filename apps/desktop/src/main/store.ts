// Avatar store backend proxy — mirrors AvatarBox's server.js `apiCall` pattern.
//
// The renderer NEVER talks to the Worker directly: the bootstrap token is a
// server-side secret and stays here in the main process. The renderer calls
// these IPC methods; we forward to the shared Cloudflare Worker
// (api.avatarbox.app) adding `Authorization: Bearer <bootstrapToken>` and, for
// per-user calls, the user's Supabase JWT as `x-user-token`.
//
// Because it hits the same Worker + Supabase as AvatarBox, gems and owned
// avatars are per-email and shared across every app the user signs into.

import { ipcMain } from "electron"
import { STORE_CONFIG as S, storeEnabled } from "./store-config"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function apiCall(
	method: string,
	path: string,
	body?: Json,
	extraHeaders?: Record<string, string>,
): Promise<Json> {
	// Fail fast (and loudly) rather than firing unauthenticated calls at the
	// Worker when no token is configured — e.g. the open-source build.
	if (!storeEnabled()) throw new Error("store-disabled: no AVATAR_BOOTSTRAP_TOKEN configured")
	const headers: Record<string, string> = {
		Authorization: `Bearer ${S.bootstrapToken}`,
		"content-type": "application/json",
		...(extraHeaders || {}),
	}
	const init: RequestInit = { method, headers }
	if (body !== undefined) init.body = JSON.stringify(body)
	const r = await fetch(`${S.apiBase}${path}`, init)
	const data = await r.json().catch(() => ({}))
	if (!r.ok) throw new Error(data?.error || `${method} ${path} → ${r.status}`)
	return data
}

export function registerStore() {
	// Public config for the renderer (Supabase client + Razorpay checkout).
	// The bootstrap token is intentionally NOT included.
	// `enabled` is false in the free/open-source build — the renderer uses this
	// to show the avatar catalogue read-only and hide purchase actions.
	ipcMain.handle("store:config", () => ({
		enabled: storeEnabled(),
		supabaseUrl: S.supabaseUrl,
		supabaseAnonKey: S.supabaseAnonKey,
		razorpayKeyId: S.razorpayKeyId,
	}))

	// Gem balance for an email.
	ipcMain.handle("store:credits", async (_e, email: string) => {
		const em = String(email || "").trim().toLowerCase()
		if (!em) return { credits: 0 }
		try {
			const r = await apiCall("GET", `/v1/credits?email=${encodeURIComponent(em)}`)
			return { credits: r.credits ?? 0 }
		} catch {
			return { credits: 0 }
		}
	})

	// Owned + paid avatar id sets for an email (needs the user JWT to be trusted).
	ipcMain.handle("store:owned", async (_e, email: string, userToken?: string) => {
		const em = String(email || "").trim().toLowerCase()
		if (!em) return { owned: [], paid: [] }
		try {
			const r = await apiCall(
				"GET",
				`/v1/owned-avatars?email=${encodeURIComponent(em)}`,
				undefined,
				userToken ? { "x-user-token": userToken } : undefined,
			)
			return { owned: r.owned ?? [], paid: r.paid ?? [] }
		} catch {
			return { owned: [], paid: [] }
		}
	})

	// Create a Razorpay order (amount in paise, e.g. ₹500 = 50000).
	ipcMain.handle(
		"store:createOrder",
		async (_e, opts: { amount: number; currency?: string; receipt?: string }) => {
			return apiCall("POST", "/v1/razorpay/order", {
				amount: opts.amount,
				currency: opts.currency || "INR",
				receipt: opts.receipt || `hramble_${opts.amount}`,
			})
		},
	)

	// Verify a completed Razorpay payment → credits gems on the Worker side.
	ipcMain.handle(
		"store:verifyPayment",
		async (
			_e,
			p: {
				razorpay_order_id: string
				razorpay_payment_id: string
				razorpay_signature: string
				email: string
				credits_to_add: number
			},
		) => {
			return apiCall("POST", "/v1/razorpay/verify", p)
		},
	)

	// Spend gems to buy an avatar. Passing avatar_id records ownership server-side.
	ipcMain.handle(
		"store:deduct",
		async (
			_e,
			p: { email: string; amount: number; avatarId: string; userToken?: string },
		) => {
			return apiCall(
				"POST",
				"/v1/credits/deduct",
				{ email: String(p.email || "").trim().toLowerCase(), amount: p.amount, avatar_id: p.avatarId || undefined },
				p.userToken ? { "x-user-token": p.userToken } : undefined,
			)
		},
	)
}
