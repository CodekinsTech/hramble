/**
 * Account — the same Google sign-in used by the Community page, surfaced
 * here too so signing in isn't something you stumble into only from Community.
 * One session, shared everywhere (see hooks/use-community-auth-sync.ts).
 */
import { useAtomValue } from "jotai"
import { LogOutIcon } from "lucide-react"
import { communityBackendEnabledAtom, communityUserAtom } from "../../atoms/community"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

export function AccountSettings() {
	const user = useAtomValue(communityUserAtom)
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)

	return (
		<div className="space-y-6">
			<div>
				<h2 className="font-semibold text-xl">Account</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Sign in with Google to post and install skills in Community. The same account is used everywhere in
					the app.
				</p>
			</div>

			{!backendEnabled ? (
				<p className="text-muted-foreground text-sm">Sign-in isn't configured in this build.</p>
			) : user ? (
				<div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-sm">
							{user.name.charAt(0).toUpperCase()}
						</div>
						<div>
							<div className="font-medium text-foreground text-sm">{user.name}</div>
							<div className="text-muted-foreground text-xs">{user.email}</div>
						</div>
					</div>
					<button
						type="button"
						onClick={() => bridge().community.logout()}
						className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
					>
						<LogOutIcon className="size-3.5" />
						Sign out
					</button>
				</div>
			) : (
				<div className="rounded-xl border border-border bg-card p-4">
					<button
						type="button"
						onClick={() => bridge().community.login()}
						className="h-9 w-full rounded-md bg-primary font-medium text-primary-foreground text-sm"
					>
						Continue with Google
					</button>
				</div>
			)}
		</div>
	)
}
