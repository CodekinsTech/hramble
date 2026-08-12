import { SearchIcon, SparklesIcon } from "lucide-react"
import { useSetAtom } from "jotai"
import { useEffect, useMemo, useState } from "react"
import { companionActivatedAtom, companionCollapsedAtom } from "../../atoms/preferences"

// The avatar catalog (id, name, price in gems, description, tags…) is served from
// public/store-avatars.json; thumbnails live in public/store-images/<id>.png.
// Same catalog + pricing as the AvatarBox store (1 gem = ₹1).
type StoreAvatar = {
	id: string
	name: string
	type?: string
	price: number
	badge?: string
	desc?: string
	downloads?: number
	tags?: string[]
	body?: string
	mood?: string
}

export function StoreSettings() {
	const [avatars, setAvatars] = useState<StoreAvatar[] | null>(null)
	const [error, setError] = useState(false)
	const [query, setQuery] = useState("")
	const setCompanionCollapsed = useSetAtom(companionCollapsedAtom)
	const setCompanionActivated = useSetAtom(companionActivatedAtom)

	useEffect(() => {
		let alive = true
		fetch("/store-avatars.json")
			.then((r) => r.json())
			.then((j) => {
				// VRM avatars only for now — drop the GLB / 3D ones.
				const all = (j.avatars ?? j) as StoreAvatar[]
				if (alive) setAvatars(all.filter((a) => (a.type ?? "vrm").toLowerCase() !== "glb"))
			})
			.catch(() => alive && setError(true))
		return () => {
			alive = false
		}
	}, [])

	const list = useMemo(() => {
		if (!avatars) return []
		const s = query.trim().toLowerCase()
		return avatars
			.filter(
				(a) =>
					!s ||
					a.name.toLowerCase().includes(s) ||
					(a.tags ?? []).some((t) => t.toLowerCase().includes(s)),
			)
			.slice()
			.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
	}, [avatars, query])

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-xl font-semibold">Store</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Browse the avatar library. Buy avatars with gems to use them in the box and perch companion.
						<span className="ml-1 text-foreground/70">1 gem = ₹1.</span>
					</p>
				</div>
				<button
					type="button"
					onClick={() => {
						setCompanionActivated(true)
						setCompanionCollapsed(false)
					}}
					title="Show the companion box"
					className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-xs hover:bg-muted"
				>
					<SparklesIcon className="size-3.5" />
					Get your AI assistant
				</button>
			</div>

			<div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-4">
				<img
					src="/avatarbox-companion.png"
					alt="The avatar companion box — a live 3D character you can talk to"
					className="w-full max-w-xs rounded-lg"
				/>
				<p className="text-[11px] text-muted-foreground">Powered by AvatarBox — a Codekins product.</p>
			</div>

			<div className="relative">
				<SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search avatars…"
					className="h-9 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-ring"
				/>
			</div>

			{error ? (
				<p className="text-sm text-muted-foreground">Couldn't load the avatar catalog.</p>
			) : !avatars ? (
				<p className="text-sm text-muted-foreground">Loading avatars…</p>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{list.map((a) => (
						<AvatarCard key={a.id} avatar={a} />
					))}
				</div>
			)}
		</div>
	)
}

function AvatarCard({ avatar }: { avatar: StoreAvatar }) {
	const [imgOk, setImgOk] = useState(true)
	const free = avatar.price <= 0
	const subtitle = avatar.desc || `${avatar.body === "M" ? "♂ Male" : "♀ Female"} · ${avatar.mood ?? "happy"}`

	return (
		<div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
			<div className="relative h-32 bg-gradient-to-b from-[#dde8ff] to-[#c8d8f8]">
				{imgOk ? (
					// biome-ignore lint/a11y/useAltText: alt provided
					<img
						src={`/store-images/${avatar.id}.png`}
						alt={avatar.name}
						loading="lazy"
						onError={() => setImgOk(false)}
						className="h-full w-full object-cover object-top [image-rendering:auto]"
						style={{ filter: "saturate(1.2)" }}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center font-bold text-3xl text-white/70">
						{avatar.name.charAt(0)}
					</div>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1 p-2.5">
				<div className="truncate font-semibold text-foreground text-xs">{avatar.name}</div>
				<div className="line-clamp-2 text-[10px] text-muted-foreground leading-snug">{subtitle}</div>
				<div className="mt-auto pt-1.5">
					<button
						type="button"
						className={`w-full rounded-md py-1.5 font-bold text-[11px] text-white transition-shadow hover:shadow-md ${free ? "bg-gradient-to-br from-blue-700 to-blue-500" : "bg-gradient-to-br from-violet-600 to-violet-400"}`}
					>
						{free ? "Free" : `💎 ${avatar.price} gems`}
					</button>
				</div>
			</div>
		</div>
	)
}
