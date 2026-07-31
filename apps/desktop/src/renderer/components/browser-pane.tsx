import { useAtom, useSetAtom } from "jotai"
import { ChevronLeftIcon, ChevronRightIcon, RotateCwIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { browserPanelOpenAtom, browserUrlAtom } from "../atoms/browser"

// Electron's <webview> is a real embedded Chromium browser. Its JSX/DOM types
// aren't in React's defaults, so we render it via a cast and type the ref to
// the methods we call. This is the visible browser pane the agent can drive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Webview: any = "webview"

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
	const initialUrl = useRef(url).current
	const [address, setAddress] = useState(url)
	const [loading, setLoading] = useState(false)
	const ref = useRef<WebviewEl | null>(null)

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
						setPanelOpen(true)
						const html = cmd.html ?? ""
						await wv.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
						setAddress(cmd.title ? `artifact: ${cmd.title}` : "artifact")
						reply({ ok: true, title: cmd.title ?? "artifact" })
					} else if (cmd.action === "open") {
						setPanelOpen(true)
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
						setPanelOpen(true)
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
						setPanelOpen(true)
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
						setPanelOpen(true)
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
						setPanelOpen(true)
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
