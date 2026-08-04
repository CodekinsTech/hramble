import { useParams } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	CameraIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	FolderDownIcon,
	GitCompareIcon,
	RotateCwIcon,
	XIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { browserAutoOpenAtom, browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"
import { useProjectList } from "../hooks/use-agents"
import { WEB_INSPECTOR_SCRIPT } from "../lib/web-inspector-script"

// Electron's <webview> is a real embedded Chromium browser. Its JSX/DOM types
// aren't in React's defaults, so we render it via a cast and type the ref to
// the methods we call. This is the visible browser pane the agent can drive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Webview: any = "webview"

// "Inspect Design" icon — a stacked-report glyph (bar chart + a checked
// magnifier) instead of a generic palette, since this button reads/audits a
// page rather than picking colors itself. Custom-drawn (mask-based cutouts
// for the bars/lens so it stays transparent against any background/theme)
// rather than a stock icon, and uses `currentColor` so it inherits whatever
// color class the button sets.
function ReportScanIcon({ className }: { className?: string }) {
	// The lens + checkmark were sized to match the reference image's larger
	// canvas and disappeared at real 16-20px toolbar size — enlarged the lens,
	// thickened its strokes, and dropped to 2 (bigger) bars so nothing crowds it.
	return (
		<svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
			<mask id="wbi-toolbar-report-cutouts">
				<rect x="0" y="0" width="24" height="24" fill="white" />
				<rect x="6.3" y="13.6" width="2.2" height="3.4" rx="0.6" fill="black" />
				<rect x="9.3" y="11" width="2.2" height="6" rx="0.6" fill="black" />
			</mask>
			<rect x="2" y="6" width="12.5" height="14.5" rx="2" fill="currentColor" opacity="0.4" />
			<g mask="url(#wbi-toolbar-report-cutouts)">
				<rect x="4.3" y="4" width="12.5" height="14.5" rx="2" fill="currentColor" />
			</g>
			<circle cx="16" cy="7.6" r="4.2" stroke="currentColor" strokeWidth="2" />
			<line x1="18.97" y1="10.57" x2="21.6" y2="13.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
			<path
				d="M14.3 7.6 L15.6 8.9 L18 6.1"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

interface WebviewEl extends HTMLElement {
	loadURL(url: string): Promise<void>
	getURL(): string
	goBack(): void
	goForward(): void
	reload(): void
	stop(): void
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	executeJavaScript(code: string): Promise<any>
	capturePage(): Promise<{ toDataURL(): string }>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	sendInputEvent(event: Record<string, any>): void
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface DesignFont {
	family: string
	role: "Headings" | "Body"
	weights: number[]
}

export interface DesignResult {
	ok: boolean
	url: string
	title: string
	colors: string[]
	fonts: DesignFont[]
	images: string[]
	svgCount: number
	assetCount: number
	elementsScanned: number
}

// Reads the live page's dominant colors and fonts by frequency
// (getComputedStyle over the DOM) — which font is mostly used for headings vs
// body, what weights, plus the image/SVG assets on the page. No extension
// involved; this is the same standard technique any "inspect element" tool
// uses. Shared by the agent's `browser extract_design` action AND the
// dedicated "Inspect Design" button, so both give identical results.
const DESIGN_EXTRACT_SCRIPT = `(() => {
	const HEADING_TAGS = new Set(['H1','H2','H3','H4','H5','H6']);
	const colorCount = new Map();
	const fontData = new Map();
	// Same-origin iframes are reachable; cross-origin ones throw on access
	// (a browser security boundary no page script can cross) and are skipped.
	const frameDocs = [];
	for (const f of document.querySelectorAll('iframe')) {
		try { if (f.contentDocument?.body) frameDocs.push(f.contentDocument); } catch (e) {}
	}
	const els = [...document.querySelectorAll('*'), ...frameDocs.flatMap(d => [...d.querySelectorAll('*')])];
	const limit = Math.min(els.length, 4000);
	for (let i = 0; i < limit; i++) {
		const el = els[i];
		const cs = getComputedStyle(el);
		for (const prop of ['color','backgroundColor','borderColor']) {
			const v = cs[prop];
			if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') {
				colorCount.set(v, (colorCount.get(v) || 0) + 1);
			}
		}
		const family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
		if (family) {
			const entry = fontData.get(family) || { count: 0, weights: new Set(), headingCount: 0, bodyCount: 0 };
			entry.count++;
			entry.weights.add(cs.fontWeight);
			if (HEADING_TAGS.has(el.tagName)) entry.headingCount++; else entry.bodyCount++;
			fontData.set(family, entry);
		}
	}
	function toHex(rgb) {
		const m = rgb.match(/[\\d.]+/g);
		if (!m || m.length < 3) return rgb;
		return '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join('');
	}
	const topColors = [...new Set(
		[...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => toHex(c))
	)];
	const topFonts = [...fontData.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, 6)
		.map(([family, d]) => ({
			family,
			role: d.headingCount > d.bodyCount ? 'Headings' : 'Body',
			weights: [...d.weights].map(Number).sort((a, b) => a - b),
		}));
	const allDocs = [document, ...frameDocs];
	const images = [...new Set(allDocs.flatMap(d => [...d.querySelectorAll('img[src]')]).slice(0, 60).map(img => img.src).filter(Boolean))];
	const svgCount = allDocs.reduce((n, d) => n + d.querySelectorAll('svg').length
		+ d.querySelectorAll('img[src$=".svg"], object[data$=".svg"]').length, 0);
	return {
		ok: true,
		url: location.href,
		title: document.title,
		colors: topColors,
		fonts: topFonts,
		images,
		svgCount,
		assetCount: images.length + svgCount,
		elementsScanned: limit,
	};
})()`

// Turn user input into a URL: pass through http(s), prefix bare domains, else
// treat it as a web search.
function toUrl(input: string): string {
	const t = input.trim()
	if (!t) return ""
	if (/^https?:\/\//i.test(t)) return t
	if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return `https://${t}`
	return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}

export function BrowserPane() {
	const [url, setUrl] = useAtom(browserUrlAtom)
	const setPanelOpen = useSetAtom(browserPanelOpenAtom)
	const autoOpen = useAtomValue(browserAutoOpenAtom)
	const initialUrl = useRef(url).current
	const [address, setAddress] = useState(url)
	const [loading, setLoading] = useState(false)
	const ref = useRef<WebviewEl | null>(null)
	// Dedicated "Inspect Design" button — deterministic, no agent/model involved
	// at all, so it can never pick the wrong tool the way asking the AI can.
	const [designLoading, setDesignLoading] = useState(false)
	const [savingReference, setSavingReference] = useState(false)
	const [screenshotting, setScreenshotting] = useState(false)
	// "Save as project reference" needs to know which project is open — read
	// from the route (present on /project/$projectSlug/*) and look up its
	// directory. Nothing to save into from the home/templates routes.
	const params = useParams({ strict: false })
	const projects = useProjectList()
	const projectDirectory = projects.find((p) => p.slug === params.projectSlug)?.directory ?? null
	// A page saved as a reference is also kept as the diff baseline for
	// "Compare to my site" — both read the same DESIGN_EXTRACT_SCRIPT snapshot.
	const [reference, setReference] = useState<DesignResult | null>(null)

	// Keep the latest auto-open preference in a ref so the long-lived
	// browser-command effect (registered once) always reads the current value.
	const autoOpenRef = useRef(autoOpen)
	autoOpenRef.current = autoOpen
	// Only pop the panel open if the user hasn't disabled auto-open.
	const openPane = () => {
		if (autoOpenRef.current) setPanelOpen(true)
	}

	// Agent-driven control: the agent's `browser` tool routes here via the
	// main-process bridge. Perform the action on the webview and reply.
	useEffect(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bridge = (window as any).hramble
		if (!bridge?.onBrowserCommand) return
		return bridge.onBrowserCommand(
			async (cmd: {
				id: string
				action: string
				url?: string
				selector?: string
				text?: string
				submit?: boolean
				html?: string
				title?: string
				amount?: number
				seconds?: number
				value?: string
			}) => {
				const reply = (result: unknown) => bridge.sendBrowserResult(cmd.id, result)
				const wv = ref.current
				if (!wv) {
					reply({ ok: false, error: "browser pane not ready" })
					return
				}
				try {
					if (cmd.action === "artifact") {
						// Render agent-generated HTML in the visible pane (the "artifact").
						openPane()
						const html = cmd.html ?? ""
						await wv.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
						setAddress(cmd.title ? `artifact: ${cmd.title}` : "artifact")
						reply({ ok: true, title: cmd.title ?? "artifact" })
					} else if (cmd.action === "open") {
						openPane()
						const target = toUrl(cmd.url || "")
						setAddress(target)
						setUrl(target)
						await wv.loadURL(target)
						const info = await wv.executeJavaScript("({url:location.href,title:document.title})")
						reply({ ok: true, ...info })
					} else if (cmd.action === "read") {
						const data = await wv.executeJavaScript(
							"({url:location.href,title:document.title,text:(document.body?document.body.innerText:'').slice(0,20000)})",
						)
						reply({ ok: true, ...data })
					} else if (cmd.action === "click") {
						// Real trusted click: locate the element, then dispatch actual
						// mouse events at its coordinates (isTrusted, like a user click).
						openPane()
						await wait(300) // let the pane lay out so coordinates are valid
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const txt = cmd.text ? JSON.stringify(cmd.text) : "null"
						const loc = await wv.executeJavaScript(`(() => {
							const sel = ${sel}, txt = ${txt};
							let el = sel ? document.querySelector(sel) : null;
							if (!el && txt) {
								const t = txt.trim().toLowerCase();
								el = [...document.querySelectorAll('a,button,[role=button],input[type=submit],input[type=button],[onclick],summary,label')]
									.find(e => (e.innerText||e.value||'').trim().toLowerCase().includes(t)) || null;
							}
							if (!el) return { ok:false, error:'element not found' };
							el.scrollIntoView({ block:'center', inline:'center' });
							const r = el.getBoundingClientRect();
							return { ok:true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
						})()`)
						if (!loc.ok) {
							reply(loc)
							return
						}
						wv.sendInputEvent({ type: "mouseDown", x: loc.x, y: loc.y, button: "left", clickCount: 1 })
						wv.sendInputEvent({ type: "mouseUp", x: loc.x, y: loc.y, button: "left", clickCount: 1 })
						await wait(150)
						const after = await wv.executeJavaScript("({url:location.href})")
						reply({ ok: true, url: after.url })
					} else if (cmd.action === "type") {
						// Real trusted typing: focus the field, then dispatch actual key
						// events (isTrusted) character by character.
						openPane()
						await wait(300)
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const foc = await wv.executeJavaScript(`(() => {
							const sel = ${sel};
							const el = sel ? document.querySelector(sel) : document.activeElement;
							if (!el) return { ok:false, error:'element not found' };
							el.focus();
							if ('value' in el) {
								const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
								if (setter) setter.call(el, ''); else el.value = '';
								el.dispatchEvent(new Event('input', { bubbles:true }));
							}
							return { ok:true };
						})()`)
						if (!foc.ok) {
							reply(foc)
							return
						}
						for (const ch of cmd.text ?? "") {
							wv.sendInputEvent({ type: "char", keyCode: ch })
						}
						if (cmd.submit) {
							wv.sendInputEvent({ type: "keyDown", keyCode: "Enter" })
							wv.sendInputEvent({ type: "keyUp", keyCode: "Enter" })
						}
						await wait(200)
						const after = await wv.executeJavaScript("({url:location.href})")
						reply({ ok: true, url: after.url })
					} else if (cmd.action === "screenshot") {
						openPane()
						await new Promise((r) => setTimeout(r, 250)) // let it paint before capture
						const img = await wv.capturePage()
						const info = await wv.executeJavaScript("({url:location.href,title:document.title})")
						reply({ ok: true, dataUrl: img.toDataURL(), ...info })
					} else if (cmd.action === "scroll") {
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const amt = typeof cmd.amount === "number" ? cmd.amount : 600
						await wv.executeJavaScript(`(() => {
							const sel = ${sel};
							if (sel) { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block:'center' }); }
							else window.scrollBy(0, ${amt});
						})()`)
						await new Promise((r) => setTimeout(r, 150))
						reply({ ok: true })
					} else if (cmd.action === "wait") {
						const secs = typeof cmd.seconds === "number" ? cmd.seconds : 10
						if (cmd.selector) {
							const sel = JSON.stringify(cmd.selector)
							const deadline = Date.now() + secs * 1000
							let found = false
							while (Date.now() < deadline) {
								found = await wv.executeJavaScript(`!!document.querySelector(${sel})`)
								if (found) break
								await new Promise((r) => setTimeout(r, 300))
							}
							reply(found ? { ok: true } : { ok: false, error: `element not found within ${secs}s` })
						} else {
							await new Promise((r) => setTimeout(r, secs * 1000))
							reply({ ok: true })
						}
					} else if (cmd.action === "select") {
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const val = JSON.stringify(cmd.value ?? "")
						reply(
							await wv.executeJavaScript(`(() => {
								const el = document.querySelector(${sel});
								if (!el) return { ok:false, error:'element not found' };
								el.value = ${val};
								el.dispatchEvent(new Event('input', { bubbles:true }));
								el.dispatchEvent(new Event('change', { bubbles:true }));
								return { ok:true };
							})()`),
						)
					} else if (cmd.action === "hover") {
						openPane()
						await new Promise((r) => setTimeout(r, 200))
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const loc = await wv.executeJavaScript(`(() => {
							const el = document.querySelector(${sel});
							if (!el) return { ok:false };
							el.scrollIntoView({ block:'center' });
							const r = el.getBoundingClientRect();
							return { ok:true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
						})()`)
						if (!loc.ok) {
							reply({ ok: false, error: "element not found" })
							return
						}
						wv.sendInputEvent({ type: "mouseMove", x: loc.x, y: loc.y })
						reply({ ok: true })
					} else if (cmd.action === "extract_design") {
						// Same technique + same shared script as the "Inspect Design" button
						// below, just triggered by the agent instead of a click.
						openPane()
						if (cmd.url) {
							const target = toUrl(cmd.url)
							setAddress(target)
							setUrl(target)
							await wv.loadURL(target)
							await wait(400) // let styles/fonts settle before sampling
						}
						const design = await wv.executeJavaScript(DESIGN_EXTRACT_SCRIPT)
						reply(design)
					} else if (cmd.action === "inspect_element") {
						// Read ONE element's full computed style — the programmatic
						// equivalent of clicking an element with DevTools open. Read-only,
						// no navigation, so it never needs a permission prompt.
						const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null"
						const txt = cmd.text ? JSON.stringify(cmd.text) : "null"
						const result = await wv.executeJavaScript(`(() => {
							const sel = ${sel}, txt = ${txt};
							let el = sel ? document.querySelector(sel) : null;
							if (!el && txt) {
								const t = txt.trim().toLowerCase();
								el = [...document.querySelectorAll('*')]
									.find(e => e.children.length === 0 && (e.innerText || '').trim().toLowerCase() === t) || null;
							}
							if (!el) return { ok: false, error: 'element not found' };
							const cs = getComputedStyle(el);
							const r = el.getBoundingClientRect();
							return {
								ok: true,
								tag: el.tagName.toLowerCase(),
								text: (el.innerText || '').slice(0, 200),
								color: cs.color,
								backgroundColor: cs.backgroundColor,
								fontFamily: cs.fontFamily,
								fontSize: cs.fontSize,
								fontWeight: cs.fontWeight,
								padding: cs.padding,
								margin: cs.margin,
								border: cs.border,
								borderRadius: cs.borderRadius,
								boxShadow: cs.boxShadow,
								width: Math.round(r.width),
								height: Math.round(r.height),
							};
						})()`)
						reply(result)
					} else if (cmd.action === "back") {
						wv.goBack()
						await new Promise((r) => setTimeout(r, 300))
						reply({ ok: true, ...(await wv.executeJavaScript("({url:location.href})")) })
					} else if (cmd.action === "forward") {
						wv.goForward()
						await new Promise((r) => setTimeout(r, 300))
						reply({ ok: true, ...(await wv.executeJavaScript("({url:location.href})")) })
					} else {
						reply({ ok: false, error: `unknown action: ${cmd.action}` })
					}
				} catch (e) {
					reply({ ok: false, error: String(e) })
				}
			},
		)
	}, [setPanelOpen, setUrl])

	useEffect(() => {
		const wv = ref.current
		if (!wv) return
		const onStart = () => setLoading(true)
		const onStop = () => setLoading(false)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const onNav = (e: any) => {
			if (e?.url) {
				setAddress(e.url)
				setUrl(e.url)
			}
		}
		wv.addEventListener("did-start-loading", onStart)
		wv.addEventListener("did-stop-loading", onStop)
		wv.addEventListener("did-navigate", onNav)
		wv.addEventListener("did-navigate-in-page", onNav)
		return () => {
			wv.removeEventListener("did-start-loading", onStart)
			wv.removeEventListener("did-stop-loading", onStop)
			wv.removeEventListener("did-navigate", onNav)
			wv.removeEventListener("did-navigate-in-page", onNav)
		}
	}, [setUrl])

	const navigate = (input: string) => {
		const target = toUrl(input)
		if (!target) return
		setAddress(target)
		setUrl(target)
		ref.current?.loadURL(target).catch(() => {})
	}

	// Deterministic "Inspect Design" — no agent/model involved at all. Injects
	// the full inspector tool (element picker, colors, fonts, assets, CSS/JSON/
	// Tailwind export) directly into the loaded page and opens its own panel —
	// richer than a custom drawer would be, and it's the user's own tool.
	const inspectDesign = async () => {
		if (!ref.current) return
		setDesignLoading(true)
		try {
			await ref.current.executeJavaScript(
				`${WEB_INSPECTOR_SCRIPT}; window.WebInspect.init({ accent: '#2D5AB8', name: 'Inspect' }); window.WebInspect.pick();`,
			)
		} finally {
			setDesignLoading(false)
		}
	}

	const extractDesign = async (): Promise<DesignResult | null> => {
		const wv = ref.current
		if (!wv) return null
		const design = await wv.executeJavaScript(DESIGN_EXTRACT_SCRIPT)
		return design?.ok ? design : null
	}

	// "Save as project reference" — the thing a browser extension fundamentally
	// can't do: write the extracted colors/fonts/asset URLs (plus best-effort
	// downloaded images) straight into the open project's folder, so the coding
	// agent can read real values off disk instead of guessing from a screenshot.
	const saveAsReference = async () => {
		if (!ref.current) return
		if (!projectDirectory) {
			toast.error("Open a project first", { description: "There's nowhere to save this reference yet." })
			return
		}
		setSavingReference(true)
		try {
			const design = await extractDesign()
			if (!design) {
				toast.error("Couldn't read this page")
				return
			}
			setReference(design)
			const imageUrls = design.images.slice(0, 12)
			const fetched: Array<{ url: string; base64: string }> = imageUrls.length
				? await ref.current.executeJavaScript(`(async () => {
						const urls = ${JSON.stringify(imageUrls)};
						const out = [];
						for (const url of urls) {
							try {
								const res = await fetch(url);
								const buf = await (await res.blob()).arrayBuffer();
								const bytes = new Uint8Array(buf);
								let binary = '';
								for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
								out.push({ url, base64: btoa(binary) });
							} catch (e) {}
						}
						return out;
					})()`)
				: []
			const assets = fetched.map((f, i) => {
				let name = `asset-${i}`
				try {
					const p = new URL(f.url).pathname.split("/").pop()
					if (p) name = p
				} catch {}
				return { name, base64: f.base64 }
			})
			const manifest = JSON.stringify(
				{
					url: design.url,
					title: design.title,
					savedAt: new Date().toISOString(),
					colors: design.colors,
					fonts: design.fonts,
					images: design.images,
					assetsDownloaded: assets.length,
				},
				null,
				2,
			)
			const tokensCss = [
				":root {",
				...design.colors.map((c, i) => `  --color-${i + 1}: ${c};`),
				...design.fonts.map((f, i) => `  --font-${i + 1}: '${f.family}';`),
				"}",
				"",
			].join("\n")
			let name = design.title || "site"
			try {
				name = new URL(design.url).hostname
			} catch {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const bridge = (window as any).hramble
			const result = await bridge.saveDesignReference({ directory: projectDirectory, name, manifest, tokensCss, assets })
			if (result.ok) {
				toast.success(`Saved to design-reference/${name}`, {
					description: assets.length ? `${assets.length} image(s) downloaded too` : "Colors, fonts & image URLs saved",
				})
			} else {
				toast.error(result.error || "Failed to save")
			}
		} finally {
			setSavingReference(false)
		}
	}

	// Crops the full-page capture down to one element — the host renderer does
	// the click-to-select + crop; the injected inspector tool has no path back
	// out to Electron's capturePage(), so this lives here instead.
	const screenshotElement = async () => {
		const wv = ref.current
		if (!wv) return
		setScreenshotting(true)
		try {
			toast.info("Click an element to screenshot it", { description: "Esc to cancel" })
			const rect = await wv.executeJavaScript(`(() => new Promise((resolve) => {
				const prevCursor = document.body.style.cursor;
				document.body.style.cursor = 'crosshair';
				function cleanup() {
					document.removeEventListener('click', onClick, true);
					document.removeEventListener('keydown', onKey, true);
					document.body.style.cursor = prevCursor;
				}
				function onClick(e) {
					e.preventDefault(); e.stopPropagation();
					cleanup();
					const r = e.target.getBoundingClientRect();
					resolve({ ok: true, x: r.left, y: r.top, width: r.width, height: r.height });
				}
				function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve({ ok: false }); } }
				document.addEventListener('click', onClick, true);
				document.addEventListener('keydown', onKey, true);
			}))()`)
			if (!rect?.ok || rect.width <= 0 || rect.height <= 0) return
			const image = await wv.capturePage()
			const dataUrl = image.toDataURL()
			const cropped = await new Promise<string>((resolve, reject) => {
				const img = new Image()
				img.onload = () => {
					const scaleX = img.naturalWidth / (wv.clientWidth || img.naturalWidth)
					const scaleY = img.naturalHeight / (wv.clientHeight || img.naturalHeight)
					const canvas = document.createElement("canvas")
					canvas.width = Math.max(1, Math.round(rect.width * scaleX))
					canvas.height = Math.max(1, Math.round(rect.height * scaleY))
					const ctx = canvas.getContext("2d")
					if (!ctx) {
						reject(new Error("no 2d context"))
						return
					}
					ctx.drawImage(
						img,
						rect.x * scaleX,
						rect.y * scaleY,
						canvas.width,
						canvas.height,
						0,
						0,
						canvas.width,
						canvas.height,
					)
					resolve(canvas.toDataURL("image/png"))
				}
				img.onerror = () => reject(new Error("failed to load capture"))
				img.src = dataUrl
			})
			const a = document.createElement("a")
			a.href = cropped
			a.download = "element-screenshot.png"
			document.body.appendChild(a)
			a.click()
			a.remove()
			toast.success("Screenshot saved")
		} catch (e) {
			toast.error("Screenshot failed", { description: String(e) })
		} finally {
			setScreenshotting(false)
		}
	}

	// Two-phase: first click on a reference page saves its colors/fonts as the
	// baseline; click again after navigating to your own dev server to diff
	// against it. Shift+click resets the baseline to whatever's loaded now.
	const compareToReference = async (resetBaseline: boolean) => {
		const design = await extractDesign()
		if (!design) {
			toast.error("Couldn't read this page")
			return
		}
		if (!reference || resetBaseline) {
			setReference(design)
			toast.success(
				resetBaseline ? "Reference reset to this page" : "Reference saved — now open your own site and click Compare again",
			)
			return
		}
		const refColors = new Set(reference.colors.map((c) => c.toLowerCase()))
		const curColors = new Set(design.colors.map((c) => c.toLowerCase()))
		const missingColors = [...refColors].filter((c) => !curColors.has(c))
		const refFonts = new Set(reference.fonts.map((f) => f.family.toLowerCase()))
		const curFonts = new Set(design.fonts.map((f) => f.family.toLowerCase()))
		const missingFonts = [...refFonts].filter((f) => !curFonts.has(f))
		if (!missingColors.length && !missingFonts.length) {
			toast.success("Matches the reference", { description: "Same colors & fonts in use." })
		} else {
			toast.warning("Doesn't match the reference yet", {
				description: [
					missingColors.length ? `Missing colors: ${missingColors.slice(0, 5).join(", ")}` : null,
					missingFonts.length ? `Missing fonts: ${missingFonts.slice(0, 3).join(", ")}` : null,
				]
					.filter(Boolean)
					.join(" · "),
				duration: 8000,
			})
		}
	}

	return (
		<div className="flex h-full flex-col bg-background">
			<div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
				<button
					type="button"
					onClick={() => ref.current?.goBack()}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Back"
				>
					<ChevronLeftIcon className="size-4" />
				</button>
				<button
					type="button"
					onClick={() => ref.current?.goForward()}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Forward"
				>
					<ChevronRightIcon className="size-4" />
				</button>
				<button
					type="button"
					onClick={() => (loading ? ref.current?.stop() : ref.current?.reload())}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title={loading ? "Stop" : "Reload"}
				>
					{loading ? <XIcon className="size-4" /> : <RotateCwIcon className="size-4" />}
				</button>
				<form
					onSubmit={(e) => {
						e.preventDefault()
						navigate(address)
					}}
					className="flex-1"
				>
					<input
						value={address}
						onChange={(e) => setAddress(e.target.value)}
						onFocus={(e) => e.currentTarget.select()}
						placeholder="Search or enter a URL"
						className="h-7 w-full rounded-md border border-border bg-muted/40 px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
					/>
				</form>
				<button
					type="button"
					onClick={inspectDesign}
					disabled={designLoading}
					className="rounded-md p-1 text-ring hover:bg-muted disabled:opacity-50"
					title="Inspect Design — colors, fonts, assets & element picker on this page"
				>
					<ReportScanIcon className={`size-4 ${designLoading ? "animate-pulse" : ""}`} />
				</button>
				<button
					type="button"
					onClick={saveAsReference}
					disabled={savingReference || !projectDirectory}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
					title={
						projectDirectory
							? "Save as project reference — writes colors, fonts & images into design-reference/ so the agent can use them"
							: "Save as project reference — open a project first"
					}
				>
					<FolderDownIcon className={`size-4 ${savingReference ? "animate-pulse" : ""}`} />
				</button>
				<button
					type="button"
					onClick={screenshotElement}
					disabled={screenshotting}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
					title="Screenshot an element — click to pick one, saved as a cropped PNG"
				>
					<CameraIcon className={`size-4 ${screenshotting ? "animate-pulse" : ""}`} />
				</button>
				<button
					type="button"
					onClick={(e) => compareToReference(e.shiftKey)}
					className={`rounded-md p-1 hover:bg-muted ${reference ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
					title={
						reference
							? "Compare to reference — diffs this page's colors/fonts against the saved reference. Shift+click to reset the baseline."
							: "Compare to your own site — click a reference page first, then click again on your own site to diff"
					}
				>
					<GitCompareIcon className="size-4" />
				</button>
				<button
					type="button"
					onClick={() => setPanelOpen(false)}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Close browser"
				>
					<XIcon className="size-4" />
				</button>
			</div>
			<Webview
				ref={ref}
				src={initialUrl}
				partition="persist:hramble-browser"
				className="flex-1"
				style={{ width: "100%", height: "100%" }}
			/>
		</div>
	)
}
