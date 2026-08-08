/**
 * Compact, read-only feed embedded in an agent hub page (agent-hub-page.tsx)
 * — deliberately smaller than the full Community page's feed (community-page.tsx):
 * no composer, no like-toggling, just "here's what people tagged for this
 * agent." Pulls from the real backend when it's configured (see
 * fetchCommunityPostsByTag in lib/community-client.ts), falling back to the
 * same local atom the rest of Community mocks against when it isn't.
 */
import { useAtomValue, useSetAtom } from "jotai"
import { GithubIcon, HeartIcon, SparklesIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"
import { communityBackendEnabledAtom, type CommunityPost, communityPostsAtom } from "../atoms/community"
import { formatRelativeTime } from "../hooks/use-agents"
import { fetchCommunityPostsByTag } from "../lib/community-client"

function repoNameFromUrl(url: string): string {
	try {
		return new URL(url).pathname.replace(/^\//, "")
	} catch {
		return url
	}
}

function CompactPostCard({ post }: { post: CommunityPost }) {
	const setBrowserUrl = useSetAtom(browserUrlAtom)
	const setBrowserOpen = useSetAtom(browserPanelOpenAtom)

	const openRepo = () => {
		if (!post.repoUrl) return
		setBrowserUrl(post.repoUrl)
		setBrowserOpen(true)
	}

	return (
		<div className="rounded-lg border border-border bg-card p-2.5">
			<div className="flex items-center gap-1.5">
				<div className="flex size-5 items-center justify-center rounded-full bg-primary/10 font-semibold text-[10px] text-primary">
					{post.author.name.charAt(0).toUpperCase()}
				</div>
				<span className="font-medium text-foreground text-xs">{post.author.name}</span>
				<span className="text-[10px] text-muted-foreground">· {formatRelativeTime(post.createdAt)}</span>
			</div>
			{post.type === "skill" && post.skill ? (
				<div className="mt-1.5 flex items-center gap-1.5">
					<SparklesIcon className="size-3 shrink-0 text-primary" />
					<code className="truncate text-foreground text-xs">{post.skill.name}</code>
				</div>
			) : (
				post.caption && <p className="mt-1.5 line-clamp-2 text-foreground text-xs">{post.caption}</p>
			)}
			<div className="mt-1.5 flex items-center gap-3">
				<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
					<HeartIcon className="size-3" /> {post.likeCount}
				</span>
				{post.repoUrl && (
					<button
						type="button"
						onClick={openRepo}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
					>
						<GithubIcon className="size-3" /> {repoNameFromUrl(post.repoUrl)}
					</button>
				)}
			</div>
		</div>
	)
}

export function CommunityTagFeed({ tag }: { tag: string }) {
	const backendEnabled = useAtomValue(communityBackendEnabledAtom)
	const localPosts = useAtomValue(communityPostsAtom)
	const [remotePosts, setRemotePosts] = useState<CommunityPost[] | null>(null)
	const [loading, setLoading] = useState(backendEnabled)

	useEffect(() => {
		if (!backendEnabled) return
		let cancelled = false
		setLoading(true)
		fetchCommunityPostsByTag(tag).then((posts) => {
			if (!cancelled) {
				setRemotePosts(posts)
				setLoading(false)
			}
		})
		return () => {
			cancelled = true
		}
	}, [backendEnabled, tag])

	const posts = backendEnabled ? remotePosts ?? [] : localPosts.filter((p) => p.tags.includes(tag))

	if (loading) {
		return <p className="py-4 text-center text-muted-foreground text-xs">Loading…</p>
	}

	if (posts.length === 0) {
		return <p className="py-4 text-center text-muted-foreground text-xs">Nothing tagged "{tag}" yet — be the first.</p>
	}

	return (
		<div className="flex flex-col gap-2">
			{posts.map((post) => (
				<CompactPostCard key={post.id} post={post} />
			))}
		</div>
	)
}
