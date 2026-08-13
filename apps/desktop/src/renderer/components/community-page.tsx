/**
 * Community — share what you built (thumbnail, GitHub repo, demo) and let
 * other builders reach out about it. UI-first build: "login" and posts are
 * local-only for now (see atoms/community.ts) — Supabase auth + Cloudflare
 * media storage get wired in once this UI is settled, without changing the
 * components below (they only read/write the atoms).
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hramble/ui/components/dialog"
import { useAtomValue, useSetAtom } from "jotai"
import {
	DownloadIcon,
	GithubIcon,
	HeartIcon,
	ImagePlusIcon,
	LogOutIcon,
	MaximizeIcon,
	MessageCircleIcon,
	MinimizeIcon,
	SearchIcon,
	SparklesIcon,
	XIcon,
} from "lucide-react"
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
	communityAccessTokenAtom,
	communityBackendEnabledAtom,
	type CommunityPost,
	communityPostsAtom,
	type CommunityUser,
	communityUserAtom,
	toggleCommunityLikeAtom,
} from "../atoms/community"
import { browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"
import { formatRelativeTime } from "../hooks/use-agents"
import { createCommunityPost, uploadCommunityImage } from "../lib/community-client"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = () => (window as any).hramble

/** Flat chip mascot — the wired-jack theme for this page, simplified for UI use (no rainbow hair). */
function ChipMascotIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 96 110" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
			<title>Chip mascot</title>
			<rect x="0" y="30" width="14" height="7" rx="2" fill="currentColor" />
			<rect x="0" y="52" width="14" height="7" rx="2" fill="currentColor" />
			<rect x="82" y="30" width="14" height="7" rx="2" fill="currentColor" />
			<rect x="82" y="52" width="14" height="7" rx="2" fill="currentColor" />
			<rect x="34" y="96" width="8" height="12" rx="2" fill="currentColor" />
			<rect x="54" y="96" width="8" height="12" rx="2" fill="currentColor" />
			<rect x="10" y="6" width="76" height="94" rx="16" fill="currentColor" />
			<circle cx="32" cy="40" r="7" fill="var(--background)" />
			<circle cx="64" cy="40" r="7" fill="var(--background)" />
			<rect x="32" y="66" width="32" height="5" rx="2.5" fill="var(--background)" />
		</svg>
	)
}

function LoginGate() {
	const setUser = useSetAtom(communityUserAtom)
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const [name, setName] = useState("")
	const [email, setEmail] = useState("")

	const submit = () => {
		if (!email.trim()) return
		setUser({ email: email.trim(), name: name.trim() || email.split("@")[0] })
	}

	return (
		<div className="flex h-full flex-col items-center justify-start gap-4 px-6 pt-10 text-center">
			<div className="overflow-hidden rounded-xl border border-border shadow-md" style={{ width: 200, height: 120 }}>
				<video
					src="community-hero.mp4"
					autoPlay
					loop
					muted
					playsInline
					className="h-full w-full object-cover"
				/>
			</div>
			<div>
				<div style={{ background: "#000", borderRadius: 8, padding: "6px 16px", display: "inline-block" }}>
					<h1 className="text-4xl" style={{ fontFamily: "'Karmatic Arcade', sans-serif", color: "rgba(220, 240, 20, 0.95)", margin: 0 }}>Wired Jack</h1>
				</div>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">
					Share what you built — a thumbnail, your GitHub repo, a demo — and message other builders about
					their work.
				</p>
			</div>
			{backendEnabled ? (
				<button
					type="button"
					onClick={() => bridge().community.login()}
					className="h-9 w-full max-w-xs rounded-md bg-primary font-medium text-primary-foreground text-sm"
				>
					Continue with Google
				</button>
			) : (
				<>
					<form
						onSubmit={(e) => {
							e.preventDefault()
							submit()
						}}
						className="flex w-full max-w-xs flex-col gap-2"
					>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Your name"
							className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
						/>
						<input
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@gmail.com"
							className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
						/>
						<button
							type="submit"
							disabled={!email.trim()}
							className="mt-1 h-9 rounded-md bg-primary font-medium text-primary-foreground text-sm disabled:opacity-50"
						>
							Continue with Gmail
						</button>
					</form>
					<p className="text-[11px] text-muted-foreground/60">
						Placeholder sign-in for now — real Google login arrives with the backend.
					</p>
				</>
			)}
		</div>
	)
}

function Composer({ user, defaultTag }: { user: CommunityUser; defaultTag?: string }) {
	const setPosts = useSetAtom(communityPostsAtom)
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const accessToken = useAtomValue(communityAccessTokenAtom)
	const [posting, setPosting] = useState(false)
	const [postType, setPostType] = useState<"build" | "skill">("build")

	// "Share a build" fields
	const [caption, setCaption] = useState("")
	const [repoUrl, setRepoUrl] = useState("")
	const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	// "Share a skill" fields — same shape as the agent's own create_skill tool
	const [skillName, setSkillName] = useState("")
	const [skillDescription, setSkillDescription] = useState("")
	const [skillInstructions, setSkillInstructions] = useState("")

	// Shared across both post types — comma-separated so it stays a single
	// plain-text input rather than a full chip-input widget for what's a
	// minor, low-frequency field. Feeds the agent hub pages' filtered feeds
	// (see community-tag-feed.tsx) — e.g. "website" or "browser-game".
	// Pre-filled with `defaultTag` when posting from an embedded, tag-filtered
	// panel (see CommunityPage's `filterTag`) so a build shared from there
	// actually shows up in that same filtered feed without the user having to
	// know/type the tag themselves.
	const [tagsInput, setTagsInput] = useState(defaultTag ?? "")
	const parseTags = () =>
		Array.from(
			new Set(
				tagsInput
					.split(",")
					.map((t) => t.trim().toLowerCase())
					.filter(Boolean),
			),
		)

	const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => setThumbnailDataUrl(reader.result as string)
		reader.readAsDataURL(file)
		e.target.value = ""
	}

	const canPostBuild = caption.trim() || thumbnailDataUrl
	const canPostSkill = skillName.trim() && skillDescription.trim() && skillInstructions.trim()

	const post = async () => {
		const tags = parseTags()
		if (postType === "build") {
			if (!canPostBuild) return
			setPosting(true)
			try {
				let img = thumbnailDataUrl
				if (backendEnabled && thumbnailDataUrl && accessToken) {
					img = (await uploadCommunityImage(thumbnailDataUrl, accessToken)) || thumbnailDataUrl
				}
				if (backendEnabled) {
					const created = await createCommunityPost({
						author: user,
						type: "build",
						caption: caption.trim(),
						img,
						repoUrl: repoUrl.trim() || null,
						tags,
					})
					if (created) setPosts((prev) => [created, ...prev])
				} else {
					const newPost: CommunityPost = {
						id: crypto.randomUUID(),
						author: user,
						type: "build",
						caption: caption.trim(),
						thumbnailDataUrl: img,
						repoUrl: repoUrl.trim() || null,
						createdAt: Date.now(),
						likedByMe: false,
						likeCount: 0,
						tags,
					}
					setPosts((prev) => [newPost, ...prev])
				}
				setCaption("")
				setRepoUrl("")
				setThumbnailDataUrl(null)
				setTagsInput("")
			} finally {
				setPosting(false)
			}
		} else {
			if (!canPostSkill) return
			setPosting(true)
			try {
				const skill = {
					name: skillName.trim(),
					description: skillDescription.trim(),
					instructions: skillInstructions.trim(),
				}
				if (backendEnabled) {
					const created = await createCommunityPost({
						author: user,
						type: "skill",
						caption: "",
						img: null,
						repoUrl: null,
						tags,
						skill,
					})
					if (created) setPosts((prev) => [created, ...prev])
				} else {
					const newPost: CommunityPost = {
						id: crypto.randomUUID(),
						author: user,
						type: "skill",
						caption: "",
						thumbnailDataUrl: null,
						repoUrl: null,
						createdAt: Date.now(),
						likedByMe: false,
						likeCount: 0,
						tags,
						skill,
					}
					setPosts((prev) => [newPost, ...prev])
				}
				setSkillName("")
				setSkillDescription("")
				setSkillInstructions("")
				setTagsInput("")
			} finally {
				setPosting(false)
			}
		}
	}

	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<div className="mb-2 flex gap-1 rounded-lg bg-muted/40 p-1">
				<button
					type="button"
					onClick={() => setPostType("build")}
					className={`flex-1 rounded-md py-1 font-medium text-xs ${postType === "build" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
				>
					Share a build
				</button>
				<button
					type="button"
					onClick={() => setPostType("skill")}
					className={`flex-1 rounded-md py-1 font-medium text-xs ${postType === "skill" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
				>
					Share a skill
				</button>
			</div>

			{postType === "build" ? (
				<>
					<textarea
						value={caption}
						onChange={(e) => setCaption(e.target.value)}
						placeholder="What did you build?"
						rows={2}
						className="w-full resize-none bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
					/>
					{thumbnailDataUrl && (
						<div className="relative mt-2">
							{/* biome-ignore lint: local preview of a user-picked file, not a remote asset */}
							<img src={thumbnailDataUrl} alt="" className="max-h-64 w-full rounded-lg object-cover" />
							<button
								type="button"
								onClick={() => setThumbnailDataUrl(null)}
								className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white"
							>
								<XIcon className="size-3.5" />
							</button>
						</div>
					)}
					<div className="mt-2 flex items-center gap-2 border-border border-t pt-2">
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							title="Add an image or video"
							className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<ImagePlusIcon className="size-4" />
						</button>
						<input
							value={repoUrl}
							onChange={(e) => setRepoUrl(e.target.value)}
							placeholder="GitHub repo link (optional)"
							className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
						/>
						<button
							type="button"
							onClick={post}
							disabled={!canPostBuild || posting}
							className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs disabled:opacity-50"
						>
							{posting ? "Posting…" : "Post"}
						</button>
					</div>
					<input
						value={tagsInput}
						onChange={(e) => setTagsInput(e.target.value)}
						placeholder="Tags, comma-separated (e.g. website, browser-game)"
						className="mt-2 h-7 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
					/>
					<input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={onFileChange} />
				</>
			) : (
				<div className="flex flex-col gap-2">
					<input
						value={skillName}
						onChange={(e) => setSkillName(e.target.value)}
						placeholder="Skill name, e.g. 'changelog-writer'"
						className="h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
					/>
					<input
						value={skillDescription}
						onChange={(e) => setSkillDescription(e.target.value)}
						placeholder="One line: what it does and when to use it"
						className="h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
					/>
					<textarea
						value={skillInstructions}
						onChange={(e) => setSkillInstructions(e.target.value)}
						placeholder="The step-by-step instructions"
						rows={3}
						className="w-full resize-none rounded-md border border-border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					/>
					<input
						value={tagsInput}
						onChange={(e) => setTagsInput(e.target.value)}
						placeholder="Tags, comma-separated (optional)"
						className="h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						onClick={post}
						disabled={!canPostSkill || posting}
						className="self-end rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs disabled:opacity-50"
					>
						{posting ? "Posting…" : "Post skill"}
					</button>
				</div>
			)}
		</div>
	)
}

function repoNameFromUrl(url: string): string {
	try {
		return new URL(url).pathname.replace(/^\//, "")
	} catch {
		return url
	}
}

function SkillInstallButton({ skill }: { skill: NonNullable<CommunityPost["skill"]> }) {
	const [installing, setInstalling] = useState(false)

	const install = async () => {
		setInstalling(true)
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const bridge = (window as any).hramble
			const result = await bridge.installCommunitySkill(skill)
			if (result.ok) {
				toast.success(`Installed "${result.slug}"`, { description: "Available to the agent right away." })
			} else {
				toast.error(result.error || "Failed to install")
			}
		} finally {
			setInstalling(false)
		}
	}

	return (
		<button
			type="button"
			onClick={install}
			disabled={installing}
			className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs disabled:opacity-50"
		>
			<DownloadIcon className="size-3.5" /> {installing ? "Installing…" : "Install"}
		</button>
	)
}

function PostCard({ post }: { post: CommunityPost }) {
	const toggleLike = useSetAtom(toggleCommunityLikeAtom)
	const setBrowserUrl = useSetAtom(browserUrlAtom)
	const setBrowserOpen = useSetAtom(browserPanelOpenAtom)

	const openRepo = () => {
		if (!post.repoUrl) return
		setBrowserUrl(post.repoUrl)
		setBrowserOpen(true)
	}

	if (post.type === "skill" && post.skill) {
		return (
			<div className="rounded-xl border border-border bg-card p-3">
				<div className="flex items-center gap-2">
					<div className="flex size-7 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs">
						{post.author.name.charAt(0).toUpperCase()}
					</div>
					<span className="font-medium text-foreground text-sm">{post.author.name}</span>
					<span className="text-muted-foreground text-xs">· {formatRelativeTime(post.createdAt)}</span>
				</div>
				<div className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5">
					<div className="flex items-center gap-1.5">
						<SparklesIcon className="size-3.5 shrink-0 text-primary" />
						<code className="font-medium text-foreground text-sm">{post.skill.name}</code>
					</div>
					<p className="mt-1 text-muted-foreground text-xs">{post.skill.description}</p>
				</div>
				<div className="mt-2 flex items-center gap-3 border-border border-t pt-2">
					<button
						type="button"
						onClick={() => toggleLike(post.id)}
						className={`flex items-center gap-1.5 text-xs ${post.likedByMe ? "text-red-500" : "text-muted-foreground hover:text-foreground"}`}
					>
						<HeartIcon className={`size-4 ${post.likedByMe ? "fill-current" : ""}`} /> {post.likeCount}
					</button>
					<SkillInstallButton skill={post.skill} />
				</div>
			</div>
		)
	}

	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<div className="flex items-center gap-2">
				<div className="flex size-7 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs">
					{post.author.name.charAt(0).toUpperCase()}
				</div>
				<span className="font-medium text-foreground text-sm">{post.author.name}</span>
				<span className="text-muted-foreground text-xs">· {formatRelativeTime(post.createdAt)}</span>
			</div>
			{post.caption && <p className="mt-2 whitespace-pre-wrap text-foreground text-sm">{post.caption}</p>}
			{post.thumbnailDataUrl && (
				// biome-ignore lint: locally-stored data URL, not a remote asset
				<img src={post.thumbnailDataUrl} alt="" className="mt-2 max-h-96 w-full rounded-lg object-cover" />
			)}
			{post.repoUrl && (
				<button
					type="button"
					onClick={openRepo}
					className="mt-2 flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-muted-foreground text-xs hover:text-foreground"
				>
					<GithubIcon className="size-3.5" /> {repoNameFromUrl(post.repoUrl)}
				</button>
			)}
			<div className="mt-2 flex items-center gap-4 border-border border-t pt-2">
				<button
					type="button"
					onClick={() => toggleLike(post.id)}
					className={`flex items-center gap-1.5 text-xs ${post.likedByMe ? "text-red-500" : "text-muted-foreground hover:text-foreground"}`}
				>
					<HeartIcon className={`size-4 ${post.likedByMe ? "fill-current" : ""}`} /> {post.likeCount}
				</button>
				<button
					type="button"
					onClick={() => toast.info("Messaging isn't wired up yet", { description: "Comes with the backend." })}
					title="Message about this repo or query"
					className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
				>
					<MessageCircleIcon className="size-4" /> Message
				</button>
			</div>
		</div>
	)
}

interface BrowsableSkill {
	slug: string
	name: string
	description: string
	instructions: string
}

// A small curated palette (not a random hue wheel) so cards read as varied
// but still cohesive with the rest of the app. Assignment is deterministic —
// hashed from the skill's slug — so a given skill is always the same color,
// not re-shuffled every render.
const SKILL_PALETTE = [
	{ icon: "text-sky-500", chip: "bg-sky-500/10", border: "hover:border-sky-500/30" },
	{ icon: "text-violet-500", chip: "bg-violet-500/10", border: "hover:border-violet-500/30" },
	{ icon: "text-emerald-500", chip: "bg-emerald-500/10", border: "hover:border-emerald-500/30" },
	{ icon: "text-amber-500", chip: "bg-amber-500/10", border: "hover:border-amber-500/30" },
	{ icon: "text-rose-500", chip: "bg-rose-500/10", border: "hover:border-rose-500/30" },
	{ icon: "text-cyan-500", chip: "bg-cyan-500/10", border: "hover:border-cyan-500/30" },
	{ icon: "text-indigo-500", chip: "bg-indigo-500/10", border: "hover:border-indigo-500/30" },
	{ icon: "text-orange-500", chip: "bg-orange-500/10", border: "hover:border-orange-500/30" },
]

function paletteFor(slug: string) {
	let hash = 0
	for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
	return SKILL_PALETTE[hash % SKILL_PALETTE.length]
}

function SkillsBrowser() {
	const [skills, setSkills] = useState<BrowsableSkill[] | null>(null)
	const [query, setQuery] = useState("")
	const [selected, setSelected] = useState<BrowsableSkill | null>(null)

	useEffect(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bridge = (window as any).hramble
		bridge.listInstalledSkills().then(setSkills)
	}, [])

	const filtered = useMemo(() => {
		if (!skills) return []
		const q = query.trim().toLowerCase()
		if (!q) return skills
		return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
	}, [skills, query])

	return (
		<>
			<div>
				<div className="mb-3 text-center">
					<p className="text-muted-foreground text-xs">
						{skills === null ? "Loading…" : `${skills.length} skills available to the agent`}
					</p>
				</div>
				<div className="relative mb-3">
					<SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search skills…"
						className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-sm outline-none focus:ring-1 focus:ring-ring"
					/>
				</div>
				{skills !== null && filtered.length === 0 && (
					<p className="py-8 text-center text-muted-foreground text-sm">No skills match "{query}"</p>
				)}
				<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
					{filtered.map((s) => {
						const palette = paletteFor(s.slug)
						return (
							<button
								key={s.slug}
								type="button"
								onClick={() => setSelected(s)}
								className={`rounded-xl border border-border bg-card p-3 text-left transition-colors ${palette.border}`}
							>
								<div className="flex items-center gap-2.5">
									<div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${palette.chip}`}>
										<SparklesIcon className={`size-4 ${palette.icon}`} />
									</div>
									<span className="truncate font-semibold text-foreground text-sm">{s.name}</span>
								</div>
								<p className="mt-2 line-clamp-2 text-muted-foreground text-xs leading-relaxed">{s.description}</p>
							</button>
						)
					})}
				</div>
			</div>
			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				<DialogContent className="max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{selected?.name}</DialogTitle>
						<DialogDescription>{selected?.description}</DialogDescription>
					</DialogHeader>
					<pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-foreground text-xs leading-relaxed">
						{selected?.instructions}
					</pre>
				</DialogContent>
			</Dialog>
		</>
	)
}

interface CommunityPageProps {
	/** When set, the feed shows only posts tagged with this (e.g. "website",
	 *  "browser-game") instead of everything — used when embedded in an
	 *  agent hub page's Community panel (see agent-hub-page.tsx). Filters the
	 *  same `communityPostsAtom` the unfiltered page reads (kept fresh
	 *  app-wide by useCommunityAuthSync), so this doesn't duplicate any
	 *  fetch/backend logic — it's the real feed, just narrowed client-side. */
	filterTag?: string
	/** True when rendered inside the agent hub page's right-hand panel
	 *  instead of as the standalone /community route. Adds the panel-only
	 *  expand/close controls next to the page's own header and drops the
	 *  centered max-width so it fills whatever width the panel is given. */
	embedded?: boolean
	/** Current expanded (full-width) state — only meaningful when embedded. */
	expanded?: boolean
	onToggleExpanded?: () => void
	onClose?: () => void
}

export function CommunityPage({
	filterTag,
	embedded = false,
	expanded = false,
	onToggleExpanded,
	onClose,
}: CommunityPageProps = {}) {
	// Auth session is synced app-wide from SidebarLayout — this page only reads the atoms.
	const user = useAtomValue(communityUserAtom)
	const setUser = useSetAtom(communityUserAtom)
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const posts = useAtomValue(communityPostsAtom)
	const [tab, setTab] = useState<"feed" | "skills">("feed")

	if (!user) return <LoginGate />

	const signOut = () => {
		if (backendEnabled) bridge().community.logout()
		else setUser(null)
	}

	const displayedPosts = filterTag ? posts.filter((p) => p.tags.includes(filterTag)) : posts

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<div className={embedded ? "w-full flex-1 px-4 py-4" : "mx-auto w-full max-w-lg flex-1 px-4 py-6"}>
				<div className="mb-4 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div style={{ background: "#000", borderRadius: 8, padding: "4px 12px", display: "inline-block" }}>
						<h1 className="text-lg" style={{ fontFamily: "'Karmatic Arcade', sans-serif", color: "rgba(220, 240, 20, 0.95)", margin: 0 }}>Wired Jack</h1>
					</div>
						{filterTag && (
							<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
								#{filterTag}
							</span>
						)}
					</div>
					<div className="flex items-center gap-0.5">
						{embedded && onToggleExpanded && (
							<button
								type="button"
								onClick={onToggleExpanded}
								className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
								title={expanded ? "Restore panel size" : "Expand to full width"}
							>
								{expanded ? <MinimizeIcon className="size-3.5" /> : <MaximizeIcon className="size-3.5" />}
							</button>
						)}
						{embedded && onClose && (
							<button
								type="button"
								onClick={onClose}
								className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
								title="Close — back to the browser pane"
							>
								<XIcon className="size-3.5" />
							</button>
						)}
						<button
							type="button"
							onClick={signOut}
							title="Sign out"
							className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
						>
							<LogOutIcon className="size-3.5" /> {user.name}
						</button>
					</div>
				</div>
				<div className="mb-4 flex gap-1 rounded-lg bg-muted/40 p-1">
					<button
						type="button"
						onClick={() => setTab("feed")}
						className={`flex-1 rounded-md py-1.5 font-medium text-sm ${tab === "feed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
					>
						Feed
					</button>
					<button
						type="button"
						onClick={() => setTab("skills")}
						className={`flex-1 rounded-md py-1.5 font-medium text-sm ${tab === "skills" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
					>
						Skills
					</button>
				</div>
				{tab === "feed" ? (
					<>
						<Composer user={user} defaultTag={filterTag} />
						<div className="mt-4 flex flex-col gap-3">
							{displayedPosts.length === 0 && filterTag ? (
								<p className="py-8 text-center text-muted-foreground text-xs">
									Nothing tagged "{filterTag}" yet — be the first.
								</p>
							) : (
								displayedPosts.map((post) => <PostCard key={post.id} post={post} />)
							)}
						</div>
					</>
				) : (
					<SkillsBrowser />
				)}
			</div>
		</div>
	)
}
