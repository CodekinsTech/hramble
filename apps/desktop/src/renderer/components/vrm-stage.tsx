import { useEffect, useRef } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm"
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation"
import floraUrl from "../avatars/flora.vrm?url"
import liboUrl from "../avatars/libo.vrm?url"
import idleUrl from "../avatars/idle_stand1.vrma?url"
import { lipsync } from "../tts/supertonic"

export type StageMode = "box" | "float"

// Per-avatar framing. box = half-body (docked); float = full-body (floating).
export const AVATARS = {
	flora: {
		url: floraUrl,
		offsetY: 0,
		name: "Flora",
		voice: "F1",
		lang: "en",
		box: { camY: 1.1, camDist: 2.6 },
		float: { camY: 0.9, camDist: 3.9 },
	},
	libo: {
		url: liboUrl,
		offsetY: -0.2,
		name: "Libo",
		voice: "F7-gb",
		lang: "en",
		box: { camY: 1.05, camDist: 2.36 },
		float: { camY: 0.85, camDist: 3.5 },
	},
} as const

export type AvatarKey = keyof typeof AVATARS

function trimClip(clip: THREE.AnimationClip, trimStart: number, trimEnd: number) {
	const end = clip.duration - trimEnd
	for (const track of clip.tracks) {
		const times = track.times
		const values = track.values
		const stride = values.length / times.length
		const nt: number[] = []
		const nv: number[] = []
		for (let i = 0; i < times.length; i++) {
			const t = times[i]
			if (t >= trimStart && t <= end) {
				nt.push(t - trimStart)
				for (let s = 0; s < stride; s++) nv.push(values[i * stride + s])
			}
		}
		if (nt.length) {
			track.times = new Float32Array(nt)
			track.values = new Float32Array(nv)
		}
	}
	clip.duration = Math.max(0.1, end - trimStart)
}

export function VrmStage({ avatar, mode }: { avatar: AvatarKey; mode: StageMode }) {
	const mountRef = useRef<HTMLDivElement>(null)
	// Live framing targets — updated on mode/avatar change without reloading the VRM.
	const target = useRef({ y: AVATARS[avatar][mode].camY, dist: AVATARS[avatar][mode].camDist })
	const modeRef = useRef<StageMode>(mode)

	// Update the camera framing target whenever avatar or mode changes (no reload).
	useEffect(() => {
		const f = AVATARS[avatar][mode]
		target.current.y = f.camY
		target.current.dist = f.camDist
		modeRef.current = mode
	}, [avatar, mode])

	// Set up scene + load VRM. Reloads only when the avatar changes.
	useEffect(() => {
		const cfg = AVATARS[avatar]
		const mount = mountRef.current
		if (!mount) return
		let raf = 0
		let disposed = false

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
		renderer.domElement.style.width = "100%"
		renderer.domElement.style.height = "100%"
		renderer.domElement.style.display = "block"
		mount.appendChild(renderer.domElement)

		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
		scene.add(new THREE.AmbientLight(0xffffff, 0.85))
		const key = new THREE.DirectionalLight(0xffffff, 1.5)
		key.position.set(1, 2, 2)
		scene.add(key)
		const fill = new THREE.DirectionalLight(0xdde4f0, 0.5)
		fill.position.set(-1, 0, 1)
		scene.add(fill)

		const setSize = () => {
			const w = mount.clientWidth || 120
			const h = mount.clientHeight || 150
			renderer.setSize(w, h, false)
			camera.aspect = w / h
			camera.updateProjectionMatrix()
		}
		setSize()
		const ro = new ResizeObserver(setSize)
		ro.observe(mount)

		// Cursor controls (box mode only): wheel = zoom, drag = move avatar up/down.
		const dom = renderer.domElement
		const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
		let panning = false
		let lastY = 0
		const onWheel = (e: WheelEvent) => {
			if (modeRef.current !== "box") return
			e.preventDefault()
			target.current.dist = clamp(target.current.dist + e.deltaY * 0.003, 1.2, 6)
		}
		const onDown = (e: PointerEvent) => {
			if (modeRef.current !== "box") return
			panning = true
			lastY = e.clientY
			e.stopPropagation()
			try {
				dom.setPointerCapture(e.pointerId)
			} catch {
				/* ignore */
			}
		}
		const onMove = (e: PointerEvent) => {
			if (!panning) return
			const dy = e.clientY - lastY
			lastY = e.clientY
			target.current.y = clamp(target.current.y + dy * 0.006, 0.3, 1.7)
		}
		const onUp = () => {
			panning = false
		}
		dom.addEventListener("wheel", onWheel, { passive: false })
		dom.addEventListener("pointerdown", onDown)
		dom.addEventListener("pointermove", onMove)
		dom.addEventListener("pointerup", onUp)
		dom.addEventListener("pointercancel", onUp)

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let vrm: any = null
		let mixer: THREE.AnimationMixer | null = null
		let bTimer = 0
		let bState: "open" | "closing" | "opening" = "open"
		let bT = 0
		// Smoothly eased current framing.
		let curY = target.current.y
		let curDist = target.current.dist
		const clock = new THREE.Clock()

		const loader = new GLTFLoader()
		loader.register((p) => new VRMLoaderPlugin(p))
		loader.load(cfg.url, async (gltf) => {
			if (disposed) return
			vrm = gltf.userData.vrm
			VRMUtils.removeUnnecessaryVertices(gltf.scene)
			const isVRM1 = vrm.meta?.metaVersion === "1"
			vrm.scene.rotation.y = isVRM1 ? 0 : Math.PI
			const bb = new THREE.Box3().setFromObject(vrm.scene)
			const cx = (bb.min.x + bb.max.x) / 2
			if (Math.abs(cx) > 0.01) vrm.scene.position.x -= cx
			if (cfg.offsetY) vrm.scene.position.y += cfg.offsetY
			scene.add(vrm.scene)

			try {
				const aLoader = new GLTFLoader()
				aLoader.register((p) => new VRMAnimationLoaderPlugin(p))
				const ag = await aLoader.loadAsync(idleUrl)
				const vrmAnim = ag.userData.vrmAnimations?.[0]
				if (vrmAnim && !disposed) {
					const clip = createVRMAnimationClip(vrmAnim, vrm)
					clip.tracks = clip.tracks.filter((t) => !t.name.endsWith(".position"))
					trimClip(clip, 1.0, 4.0)
					mixer = new THREE.AnimationMixer(vrm.scene)
					mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY).play()
				}
			} catch {
				/* idle optional */
			}
		})

		const animate = () => {
			raf = requestAnimationFrame(animate)
			const dt = clock.getDelta()
			// Ease camera toward the current framing target (smooth dock <-> float).
			curY += (target.current.y - curY) * Math.min(1, dt * 8)
			curDist += (target.current.dist - curDist) * Math.min(1, dt * 8)
			camera.position.set(0, curY, curDist)
			camera.lookAt(0, curY, 0)
			if (vrm) {
				bTimer += dt
				if (bState === "open" && bTimer > 3 + Math.random() * 3) {
					bState = "closing"
					bT = 0
				}
				if (bState === "closing") {
					bT += dt / 0.07
					const v = Math.min(bT, 1)
					for (const n of ["blink", "blinkLeft", "blinkRight"]) vrm.expressionManager?.setValue(n, v)
					if (bT >= 1) {
						bState = "opening"
						bT = 0
					}
				} else if (bState === "opening") {
					bT += dt / 0.1
					const v = 1 - Math.min(bT, 1)
					for (const n of ["blink", "blinkLeft", "blinkRight"]) vrm.expressionManager?.setValue(n, v)
					if (bT >= 1) {
						bState = "open"
						bTimer = 0
					}
				}
				// Lipsync: open the mouth to the current speech amplitude
				vrm.expressionManager?.setValue("aa", lipsync.level)
				mixer?.update(dt)
				vrm.update(dt)
			}
			renderer.render(scene, camera)
		}
		animate()

		return () => {
			disposed = true
			cancelAnimationFrame(raf)
			ro.disconnect()
			dom.removeEventListener("wheel", onWheel)
			dom.removeEventListener("pointerdown", onDown)
			dom.removeEventListener("pointermove", onMove)
			dom.removeEventListener("pointerup", onUp)
			dom.removeEventListener("pointercancel", onUp)
			if (vrm) VRMUtils.deepDispose(vrm.scene)
			renderer.dispose()
			renderer.domElement.remove()
		}
	}, [avatar])

	return <div ref={mountRef} className="hramble-vrm-stage" />
}
