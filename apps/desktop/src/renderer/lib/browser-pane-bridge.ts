/**
 * Browser pane bridge — lets renderer-only code (Live Share, Dispatch) see
 * what's currently shown in the in-app browser pane without needing a ref to
 * its component instance. `browser-pane.tsx` registers a getter on mount;
 * callers just await `getBrowserPaneContent()`.
 *
 * Three kinds, in order of preference:
 * - "html": an `artifact`-rendered page (self-contained, loaded via a
 *   data: URL) — the raw HTML is sent so the viewer runs it live in its own
 *   sandboxed frame. A 3D/WebGL scene keeps animating and stays interactive
 *   on the remote side, not just a still image of it.
 * - "url": a real, publicly-reachable page the pane navigated to — the
 *   viewer just loads the same URL itself.
 * - "screenshot": fallback for anything local-only (e.g. a 127.0.0.1 preview
 *   server the remote viewer can't reach) — a flat image, refreshed
 *   periodically by the caller.
 */
export type BrowserPaneContent =
	| { kind: "html"; html: string }
	| { kind: "url"; url: string }
	| { kind: "screenshot"; dataUrl: string }

type GetContent = () => Promise<BrowserPaneContent | null>

let getContentFn: GetContent | null = null

export function registerBrowserPaneContent(fn: GetContent | null): void {
	getContentFn = fn
}

export async function getBrowserPaneContent(): Promise<BrowserPaneContent | null> {
	if (!getContentFn) return null
	try {
		return await getContentFn()
	} catch {
		return null
	}
}
