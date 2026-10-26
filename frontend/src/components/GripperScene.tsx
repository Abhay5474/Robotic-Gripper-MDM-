// 3D work-cell: table, pick station, place tray, a SCHEMATIC arm and a detailed two-finger parallel gripper.
//
// What is real vs. schematic:
//   - finger opening, measured force, slip and object detection come from telemetry (or the demo simulation);
//   - the arm pose is derived from operation_state (see lib/kinematics.ts) because no telemetry reports it.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, type DependencyList, type MutableRefObject, type RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CELL, gripHeight, isHeld, MM, phaseDuration, restingStation, solveIK, waypoints, wristTarget, type Vec3 } from '@/lib/kinematics'
import { objectKind } from '@/lib/objects'
import { bottleLabelTexture, canLabelTexture, cardboardTexture, woodTexture } from '@/lib/textures'
import type { ThemeColors } from '@/lib/theme'
import type { ObjectProps } from '@/lib/types'
import { useTheme, useThemeColors } from '@/store/theme'

export type ViewName = 'cell' | 'gripper' | 'front' | 'side' | 'top'

export interface SceneLabels {
  force: RefObject<HTMLDivElement | null>
  pick: RefObject<HTMLDivElement | null>
  place: RefObject<HTMLDivElement | null>
  alert: RefObject<HTMLDivElement | null>
}
export interface SceneApi { snapshot: () => string | null }

export interface SceneProps {
  object: ObjectProps | null
  openingMm: number | null
  maxOpeningMm: number
  state: string | null
  slip: boolean | null
  objectDetected: boolean | null
  measuredForce: number | null
  maxForce: number
  contactLimit: number | null
  /** Progress through the current state (replay). When omitted the view paces itself with the phase durations. */
  progress?: number | null
  view: ViewName
  viewNonce: number
  autoRotate: boolean
  labels: SceneLabels
  onApi?: (api: SceneApi | null) => void
  /** Stop rendering entirely (scrolled out of view). */
  paused?: boolean
}

// gripper geometry (scene units, 1 = 100 mm); pad centre sits CELL.wristToPad below the wrist joint
const PAD_T = 0.06
const FINGER_T = 0.12
const PAD_Y = -CELL.wristToPad

const PRESETS: Record<Exclude<ViewName, 'gripper'>, { pos: Vec3; target: Vec3 }> = {
  cell: { pos: [7.6, 6.4, 9.4], target: [0, 1.6, 0.2] },
  front: { pos: [0, 3.4, 11.5], target: [0, 1.9, 0.3] },
  side: { pos: [11.5, 3.6, 0.8], target: [0, 1.9, 0.3] },
  top: { pos: [0.01, 13.5, 0.9], target: [0, 0, 0.5] },
}
const FOLLOW_OFFSET: Vec3 = [3.3, 1.9, 4.6]
const FOLLOW_LIFT = 0.45 // aim between the pads and the housing

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ------------------------------------------------------------------ helpers
function useGeo<T extends THREE.BufferGeometry>(make: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(make, deps)
  useEffect(() => () => g.dispose(), [g])
  return g
}
const rounded = (w: number, h: number, d: number, r = 0.05, seg = 4) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)))
const lathe = (pts: [number, number][], segs = 56) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), segs)
const zCylinder = (r: number, len: number, segs = 40) => new THREE.CylinderGeometry(r, r, len, segs).rotateX(Math.PI / 2)

// ------------------------------------------------------------------ environment
function SceneEnvironment({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const tex = pmrem.fromScene(room, 0.04).texture
    scene.environment = tex
    return () => { scene.environment = null; tex.dispose(); pmrem.dispose(); room.dispose() }
  }, [gl, scene])
  useEffect(() => { scene.environmentIntensity = intensity }, [scene, intensity])
  return null
}

function TableGrid({ color }: { color: string }) {
  const geo = useGeo(() => {
    const pts: number[] = []
    for (let x = -4.0; x <= 4.0 + 1e-6; x += 0.5) pts.push(x, 0, -2.2, x, 0, 2.8)
    for (let z = -2.2; z <= 2.8 + 1e-6; z += 0.5) pts.push(-4.0, 0, z, 4.0, 0, z)
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }, [])
  return <lineSegments geometry={geo} position={[0, 0.003, 0]}><lineBasicMaterial color={color} transparent opacity={0.55} /></lineSegments>
}

function Workcell({ c }: { c: ThemeColors }) {
  const top = useGeo(() => rounded(8.6, 0.2, 5.4, 0.06), [])
  const band = useGeo(() => rounded(8.64, 0.05, 5.44, 0.02), [])
  const leg = useGeo(() => rounded(0.22, 3.0, 0.22, 0.04), [])
  const tray = useGeo(() => rounded(1.9, CELL.placeSurface, 1.5, 0.05), [])
  const rimX = useGeo(() => rounded(1.9, 0.07, 0.07, 0.025), [])
  const rimZ = useGeo(() => rounded(0.07, 0.07, 1.5, 0.025), [])
  const ring = useGeo(() => new THREE.RingGeometry(0.8, 0.88, 72), [])
  const tick = useGeo(() => new THREE.PlaneGeometry(0.035, 0.34), [])
  const [px, , pz] = CELL.pick
  const [qx, , qz] = CELL.place
  const ps = CELL.placeSurface
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -3.2, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color={c.floor} roughness={0.95} />
      </mesh>
      <mesh geometry={top} position={[0, -0.1, 0.3]} receiveShadow><meshStandardMaterial color={c.table} roughness={0.5} metalness={0.04} /></mesh>
      <mesh geometry={band} position={[0, -0.2, 0.3]}><meshStandardMaterial color={c.tableEdge} roughness={0.6} /></mesh>
      {[[-4.0, -2.2], [4.0, -2.2], [-4.0, 2.8], [4.0, 2.8]].map(([x, z]) => (
        <mesh key={`${x}${z}`} geometry={leg} position={[x, -1.7, z]} castShadow><meshStandardMaterial color={c.leg} roughness={0.5} metalness={0.4} /></mesh>
      ))}
      <TableGrid color={c.sceneGridA} />
      {/* pick station: target ring + ticks */}
      <group position={[px, 0.004, pz]} rotation-x={-Math.PI / 2}>
        <mesh geometry={ring}><meshBasicMaterial color={c.accent} transparent opacity={0.9} toneMapped={false} /></mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} geometry={tick} rotation-z={(i * Math.PI) / 2} position={[Math.cos((i * Math.PI) / 2 + Math.PI / 2) * 1.05, Math.sin((i * Math.PI) / 2 + Math.PI / 2) * 1.05, 0]}>
            <meshBasicMaterial color={c.accent} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {/* place station: tray with a raised rim */}
      <group position={[qx, 0, qz]}>
        <mesh geometry={tray} position={[0, ps / 2, 0]} castShadow receiveShadow><meshStandardMaterial color={c.tray} roughness={0.75} metalness={0.15} /></mesh>
        {[-1, 1].map((s) => <mesh key={`x${s}`} geometry={rimX} position={[0, ps + 0.035, s * 0.715]} castShadow><meshStandardMaterial color={c.accent} roughness={0.4} metalness={0.2} /></mesh>)}
        {[-1, 1].map((s) => <mesh key={`z${s}`} geometry={rimZ} position={[s * 0.915, ps + 0.035, 0]} castShadow><meshStandardMaterial color={c.accent} roughness={0.4} metalness={0.2} /></mesh>)}
      </group>
    </group>
  )
}

/** Dashed carry path of the grasp point, from the pick station over to the tray. */
function CarryPath({ objH, color }: { objH: number; color: string }) {
  const line = useMemo(() => {
    const w = waypoints(objH)
    const down = (p: Vec3) => new THREE.Vector3(p[0], p[1] - CELL.wristToPad, p[2])
    const curve = new THREE.CatmullRomCurve3([w.pickAt, w.pickAbove, w.transportMid, w.placeAbove, w.placeAt].map(down), false, 'centripetal')
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120))
    const l = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.7 }))
    l.computeLineDistances()
    return l
  }, [objH, color])
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose() }, [line])
  return <primitive object={line} />
}

// ------------------------------------------------------------------ work object
function WorkObject({ object, c, groupRef, alert }: { object: ObjectProps; c: ThemeColors; groupRef: RefObject<THREE.Group | null>; alert: MutableRefObject<number> }) {
  const kind = objectKind(object)
  const w = object.width_mm * MM, h = object.height_mm * MM, d = object.depth_mm * MM, r = w / 2
  const mats = useRef<THREE.MeshStandardMaterial[]>([])
  const reg = (m: THREE.MeshStandardMaterial | null) => { if (m && !mats.current.includes(m)) mats.current.push(m) }
  useFrame(() => { for (const m of mats.current) { m.emissive.set(c.bad); m.emissiveIntensity = alert.current } })

  const geo = useGeo(() => {
    switch (kind) {
      case 'bottle': return lathe([[0, 0], [0.9 * r, 0], [r, 0.04 * h], [r, 0.66 * h], [0.9 * r, 0.72 * h], [0.55 * r, 0.8 * h], [0.36 * r, 0.86 * h], [0.34 * r, 0.9 * h], [0, 0.9 * h]])
      case 'can': return lathe([[0, 0], [0.86 * r, 0], [r, 0.05 * h], [r, 0.93 * h], [0.88 * r, 0.98 * h], [0.84 * r, h], [0, h]])
      case 'cup': return lathe([[0, 0], [0.92 * r, 0], [1.06 * r, h], [0.98 * r, h], [0.86 * r, 0.08 * h], [0, 0.08 * h]])
      case 'glass': return lathe([[0, 0], [0.62 * r, 0], [0.72 * r, 0.05 * h], [r, 0.45 * h], [0.86 * r, 0.68 * h], [0.46 * r, 0.86 * h], [0.5 * r, 0.96 * h], [0.6 * r, h], [0.5 * r, h], [0.4 * r, 0.9 * h], [0, 0.88 * h]])
      case 'ball': return new THREE.SphereGeometry(r, 48, 32).translate(0, r, 0)
      default: return rounded(w, h, d, kind === 'box' ? 0.012 : 0.03).translate(0, h / 2, 0)
    }
  }, [kind, w, h, d])
  const label = useGeo(() => new THREE.CylinderGeometry(r * 1.004, r * 1.004, (kind === 'can' ? 0.72 : 0.24) * h, 56, 1, true), [kind, r, h])
  const cap = useGeo(() => new THREE.CylinderGeometry(0.38 * r, 0.38 * r, 0.1 * h, 32), [r, h])
  const handle = useGeo(() => new THREE.TorusGeometry(0.28 * h, 0.045 * h, 14, 40, Math.PI), [h])
  const coffee = useGeo(() => new THREE.CircleGeometry(0.95 * r, 40).rotateX(-Math.PI / 2), [r])
  const seam = useGeo(() => new THREE.TorusGeometry(r * 1.002, 0.012, 8, 64), [r])
  const tape = useGeo(() => new THREE.BoxGeometry(w + 0.004, 0.012, Math.max(0.05, d * 0.24)), [w, d])
  const maps = useMemo(() => ({
    wood: kind === 'block' ? woodTexture() : null,
    card: kind === 'box' ? cardboardTexture() : null,
    can: kind === 'can' ? canLabelTexture() : null,
    bottle: kind === 'bottle' ? bottleLabelTexture() : null,
  }), [kind])

  return (
    <group ref={groupRef}>
      {kind === 'bottle' && (<>
        <mesh geometry={geo} castShadow><meshPhysicalMaterial ref={reg} color="#bfe3f5" roughness={0.05} metalness={0} clearcoat={1} transparent opacity={0.55} /></mesh>
        <mesh geometry={label} position={[0, 0.42 * h, 0]}><meshStandardMaterial ref={reg} map={maps.bottle} roughness={0.5} /></mesh>
        <mesh geometry={cap} position={[0, 0.95 * h, 0]} castShadow><meshStandardMaterial ref={reg} color="#1d4ed8" roughness={0.35} /></mesh>
      </>)}
      {kind === 'can' && (<>
        <mesh geometry={geo} castShadow><meshStandardMaterial ref={reg} color="#dfe3e8" metalness={1} roughness={0.22} /></mesh>
        <mesh geometry={label} position={[0, 0.49 * h, 0]}><meshStandardMaterial ref={reg} map={maps.can} metalness={0.55} roughness={0.3} /></mesh>
      </>)}
      {kind === 'cup' && (<>
        <mesh geometry={geo} castShadow><meshPhysicalMaterial ref={reg} color="#faf7f2" roughness={0.18} clearcoat={0.8} side={THREE.DoubleSide} /></mesh>
        <mesh geometry={coffee} position={[0, 0.8 * h, 0]}><meshStandardMaterial ref={reg} color="#4a2c1a" roughness={0.25} /></mesh>
        <mesh geometry={handle} position={[0, 0.5 * h, r * 0.98]} rotation={[0, -Math.PI / 2, -Math.PI / 2]} castShadow><meshPhysicalMaterial ref={reg} color="#faf7f2" roughness={0.18} clearcoat={0.8} /></mesh>
      </>)}
      {kind === 'glass' && (
        <mesh geometry={geo} castShadow><meshPhysicalMaterial ref={reg} color="#d6f1ff" roughness={0.02} metalness={0} clearcoat={1} transparent opacity={0.38} /></mesh>
      )}
      {kind === 'ball' && (<>
        <mesh geometry={geo} castShadow><meshStandardMaterial ref={reg} color="#e4572e" roughness={0.78} /></mesh>
        <mesh geometry={seam} position={[0, r, 0]} rotation-x={Math.PI / 2}><meshStandardMaterial ref={reg} color="#7c2410" roughness={0.8} /></mesh>
        <mesh geometry={seam} position={[0, r, 0]}><meshStandardMaterial ref={reg} color="#7c2410" roughness={0.8} /></mesh>
      </>)}
      {kind === 'block' && <mesh geometry={geo} castShadow><meshStandardMaterial ref={reg} map={maps.wood} roughness={0.7} /></mesh>}
      {kind === 'box' && (<>
        <mesh geometry={geo} castShadow><meshStandardMaterial ref={reg} map={maps.card} roughness={0.9} /></mesh>
        <mesh geometry={tape} position={[0, h + 0.004, 0]}><meshStandardMaterial ref={reg} color="#e9d8b4" roughness={0.35} transparent opacity={0.85} /></mesh>
      </>)}
      {kind === 'generic' && <mesh geometry={geo} castShadow><meshStandardMaterial ref={reg} color={c.object} roughness={0.5} metalness={0.1} /></mesh>}
    </group>
  )
}

// ------------------------------------------------------------------ gripper
function Finger({ side, groupRef, arrowRef, padMats, c }: {
  side: -1 | 1; groupRef: RefObject<THREE.Group | null>; arrowRef: RefObject<THREE.Group | null>
  padMats: MutableRefObject<THREE.MeshStandardMaterial[]>; c: ThemeColors
}) {
  const carriage = useGeo(() => rounded(0.3, 0.16, 0.52, 0.04), [])
  const finger = useGeo(() => rounded(FINGER_T, 0.75, 0.4, 0.04), [])
  const pad = useGeo(() => rounded(PAD_T, 0.45, 0.36, 0.025), [])
  const shaft = useGeo(() => new THREE.CylinderGeometry(0.028, 0.028, 1, 12).rotateZ(Math.PI / 2), [])
  const head = useGeo(() => new THREE.ConeGeometry(0.075, 0.16, 18), [])
  const regPad = (m: THREE.MeshStandardMaterial | null) => { if (m && !padMats.current.includes(m)) padMats.current.push(m) }
  const fx = side * (PAD_T + FINGER_T / 2)
  return (
    <group ref={groupRef}>
      <mesh geometry={carriage} position={[fx, -0.92, 0]} castShadow><meshStandardMaterial color={c.metal} metalness={0.85} roughness={0.3} /></mesh>
      <mesh geometry={finger} position={[fx, -1.375, 0]} castShadow><meshStandardMaterial color="#c3cad4" metalness={0.8} roughness={0.28} /></mesh>
      <mesh geometry={pad} position={[side * (PAD_T / 2), PAD_Y, 0]}><meshStandardMaterial ref={regPad} color="#2b2f36" roughness={0.92} emissive={c.meas} emissiveIntensity={0} /></mesh>
      <group ref={arrowRef} position={[0, PAD_Y, 0]} userData={{ side }} visible={false}>
        <mesh geometry={shaft}><meshStandardMaterial color={c.meas} emissive={c.meas} emissiveIntensity={0.6} toneMapped={false} /></mesh>
        <mesh geometry={head} rotation-z={(side * Math.PI) / 2}><meshStandardMaterial color={c.meas} emissive={c.meas} emissiveIntensity={0.6} toneMapped={false} /></mesh>
      </group>
    </group>
  )
}

function Gripper({ c, maxOpeningMm, fingerL, fingerR, arrowL, arrowR, padMats, led }: {
  c: ThemeColors; maxOpeningMm: number
  fingerL: RefObject<THREE.Group | null>; fingerR: RefObject<THREE.Group | null>
  arrowL: RefObject<THREE.Group | null>; arrowR: RefObject<THREE.Group | null>
  padMats: MutableRefObject<THREE.MeshStandardMaterial[]>; led: RefObject<THREE.MeshStandardMaterial | null>
}) {
  const housingW = maxOpeningMm * MM + 2 * (PAD_T + FINGER_T) + 0.55
  const flange = useGeo(() => new THREE.CylinderGeometry(0.25, 0.27, 0.16, 40), [])
  const ring = useGeo(() => new THREE.TorusGeometry(0.28, 0.024, 10, 56).rotateX(Math.PI / 2), [])
  const housing = useGeo(() => rounded(housingW, 0.42, 0.62, 0.08), [housingW])
  const band = useGeo(() => rounded(housingW + 0.014, 0.07, 0.634, 0.02), [housingW])
  const rail = useGeo(() => rounded(housingW - 0.16, 0.07, 0.2, 0.02), [housingW])
  const screw = useGeo(() => new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateX(Math.PI / 2), [])
  return (
    <group>
      <mesh geometry={flange} position={[0, -0.3, 0]} castShadow><meshStandardMaterial color={c.metal} metalness={0.9} roughness={0.25} /></mesh>
      <mesh geometry={ring} position={[0, -0.3, 0]}><meshStandardMaterial ref={led} color="#111" emissive={c.axis} emissiveIntensity={1.4} toneMapped={false} /></mesh>
      <mesh geometry={housing} position={[0, -0.59, 0]} castShadow><meshStandardMaterial color="#a7b0bd" metalness={0.82} roughness={0.32} /></mesh>
      <mesh geometry={band} position={[0, -0.59, 0]}><meshStandardMaterial color={c.accent} metalness={0.3} roughness={0.35} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} geometry={screw} position={[s * (housingW / 2 - 0.16), -0.47, 0.315]}><meshStandardMaterial color="#5b6370" metalness={0.9} roughness={0.3} /></mesh>)}
      <mesh geometry={rail} position={[0, -0.835, 0]} castShadow><meshStandardMaterial color="#6b7280" metalness={0.92} roughness={0.22} /></mesh>
      <Finger side={-1} groupRef={fingerL} arrowRef={arrowL} padMats={padMats} c={c} />
      <Finger side={1} groupRef={fingerR} arrowRef={arrowR} padMats={padMats} c={c} />
    </group>
  )
}

// ------------------------------------------------------------------ arm + animation
function Cell({ props, c, follow }: { props: MutableRefObject<SceneProps>; c: ThemeColors; follow: MutableRefObject<THREE.Vector3> }) {
  const yaw = useRef<THREE.Group>(null), shoulder = useRef<THREE.Group>(null), elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null), roll = useRef<THREE.Group>(null)
  const fingerL = useRef<THREE.Group>(null), fingerR = useRef<THREE.Group>(null)
  const arrowL = useRef<THREE.Group>(null), arrowR = useRef<THREE.Group>(null)
  const objRef = useRef<THREE.Group>(null)
  const padMats = useRef<THREE.MeshStandardMaterial[]>([])
  const led = useRef<THREE.MeshStandardMaterial>(null)
  const alert = useRef(0)
  const reduced = useMemo(reducedMotion, [])
  const P0 = props.current
  const sim = useRef({
    state: undefined as string | null | undefined, t0: 0,
    wrist: [...CELL.home] as Vec3, hold: [...CELL.home] as Vec3,
    opening: (P0.openingMm ?? P0.maxOpeningMm) * MM,
    obj: [CELL.pick[0], CELL.pick[1], CELL.pick[2]] as Vec3, vy: 0, spawn: 1,
  })
  const tmp = useMemo(() => new THREE.Vector3(), [])

  const base = useGeo(() => new THREE.CylinderGeometry(0.62, 0.7, 0.36, 48), [])
  const turntable = useGeo(() => new THREE.CylinderGeometry(0.5, 0.52, 0.16, 48), [])
  const column = useGeo(() => rounded(0.66, 1.1, 0.66, 0.14), [])
  const jointS = useGeo(() => zCylinder(0.4, 0.72), [])
  const capS = useGeo(() => zCylinder(0.3, 0.76), [])
  const link1 = useGeo(() => rounded(CELL.l1, 0.44, 0.5, 0.16).translate(CELL.l1 / 2, 0, 0), [])
  const jointE = useGeo(() => zCylinder(0.31, 0.62), [])
  const capE = useGeo(() => zCylinder(0.22, 0.66), [])
  const link2 = useGeo(() => rounded(CELL.l2, 0.34, 0.42, 0.13).translate(CELL.l2 / 2, 0, 0), [])
  const jointW = useGeo(() => zCylinder(0.22, 0.48), [])

  useFrame((state, rawDt) => {
    const P = props.current
    const s = sim.current
    const dt = Math.min(rawDt, 0.1)
    const t = state.clock.elapsedTime
    if (P.state !== s.state) { s.state = P.state; s.t0 = t }
    const progress = P.progress ?? Math.min(1, (t - s.t0) / phaseDuration(P.state))
    const objH = (P.object?.height_mm ?? 50) * MM

    // arm: plan -> smooth -> IK
    const goal = wristTarget(P.state, progress, objH) ?? s.hold
    const kArm = reduced ? 1 : 1 - Math.exp(-dt * 9)
    for (let i = 0; i < 3; i++) s.wrist[i] += (goal[i] - s.wrist[i]) * kArm
    if (P.state !== 'slipped') s.hold = [...s.wrist] as Vec3
    const pose = solveIK(s.wrist)
    if (yaw.current) yaw.current.rotation.y = pose.yaw
    if (shoulder.current) shoulder.current.rotation.z = pose.shoulder
    if (elbow.current) elbow.current.rotation.z = pose.elbow
    if (wrist.current) wrist.current.rotation.z = pose.wrist
    if (roll.current) roll.current.rotation.y = pose.roll

    // fingers follow the measured opening (fully open when the reading is unavailable)
    const open = (P.openingMm ?? P.maxOpeningMm) * MM
    s.opening += (open - s.opening) * (reduced ? 1 : 1 - Math.exp(-dt * 14))
    if (fingerL.current) fingerL.current.position.x = -s.opening / 2
    if (fingerR.current) fingerR.current.position.x = s.opening / 2
    follow.current.set(s.wrist[0], s.wrist[1] - CELL.wristToPad, s.wrist[2]) // pad centre (tool is always vertical)

    // object: carried while actually held, otherwise rests / falls under gravity
    const widthMm = P.object?.width_mm ?? 50
    const held = isHeld({ state: P.state, objectDetected: P.objectDetected, slip: P.slip, openingMm: P.openingMm, widthMm })
    if (held) {
      s.obj = [follow.current.x, follow.current.y - gripHeight(objH), follow.current.z]; s.vy = 0
    } else if (restingStation(P.state) === 'pick') {
      const far = Math.hypot(s.obj[0] - CELL.pick[0], s.obj[1] - CELL.pick[1], s.obj[2] - CELL.pick[2]) > 0.05
      if (far) s.spawn = 0
      s.obj = [CELL.pick[0], CELL.pick[1], CELL.pick[2]]; s.vy = 0
    } else {
      const onTray = Math.abs(s.obj[0] - CELL.place[0]) < 0.95 && Math.abs(s.obj[2] - CELL.place[2]) < 0.75
      const support = onTray ? CELL.placeSurface : 0
      if (s.obj[1] > support + 1e-4) {
        s.vy -= 30 * dt
        s.obj[1] = Math.max(support, s.obj[1] + s.vy * dt)
        if (s.obj[1] <= support) s.vy = 0
      } else { s.obj[1] = support; s.vy = 0 }
    }
    s.spawn = Math.min(1, s.spawn + dt / 0.35)
    const moving = Math.abs(goal[0] - s.wrist[0]) + Math.abs(goal[1] - s.wrist[1]) + Math.abs(goal[2] - s.wrist[2]) > 1e-3
      || Math.abs(open - s.opening) > 1e-4 || s.vy !== 0 || s.spawn < 1
      || (P.progress == null && progress < 1 && P.state != null && P.state !== 'idle')
    if (objRef.current) {
      objRef.current.position.set(s.obj[0], s.obj[1], s.obj[2])
      const k = reduced ? 1 : 0.6 + 0.4 * (1 - (1 - s.spawn) ** 3)
      objRef.current.scale.setScalar(k)
    }

    // alerts: slip, or measured force above the object's contact limit
    const over = P.contactLimit != null && P.measuredForce != null && P.measuredForce > P.contactLimit
    const alerting = P.slip === true || over
    alert.current = alerting ? 0.45 + 0.4 * Math.sin(t * 9) : Math.max(0, alert.current - dt * 3)

    // contact force arrows + pad glow (only from a real measurement, only while in contact)
    const f = P.measuredForce
    const contact = held || (P.objectDetected === true && P.openingMm != null && P.openingMm <= widthMm + 1)
    const ratio = f != null && f > 0.05 && contact ? Math.min(1, f / Math.max(P.maxForce, 1e-6)) : 0
    const len = 0.2 + 0.95 * ratio
    for (const a of [arrowL.current, arrowR.current]) {
      if (!a) continue
      a.visible = ratio > 0
      const side = a.userData.side as number
      const outer = PAD_T + FINGER_T + 0.06
      const [shaftM, headM] = a.children
      shaftM.scale.set(len, 1, 1) // the rotation onto x is baked into the geometry, so length is local x
      shaftM.position.x = side * (outer + 0.16 + len / 2)
      headM.position.x = side * (outer + 0.08)
      for (const m of [shaftM, headM] as THREE.Mesh[]) {
        const mat = m.material as THREE.MeshStandardMaterial
        mat.color.set(over ? c.bad : c.meas); mat.emissive.set(over ? c.bad : c.meas)
      }
    }
    for (const m of padMats.current) { m.emissive.set(over ? c.bad : c.meas); m.emissiveIntensity = ratio * 1.5 }

    // status LED on the flange (pulses only while a cycle is actually running)
    const st = P.state
    const active = !!st && ['approaching', 'closing', 'holding', 'lifting', 'transporting', 'releasing', 'slipped'].includes(st)
    if (led.current) {
      const col = alerting ? c.bad : held ? c.ok : st && ['approaching', 'closing', 'releasing', 'complete'].includes(st) ? c.accent : st === 'aborted' ? c.warn : c.axis
      led.current.emissive.set(col)
      led.current.emissiveIntensity = active ? 1.2 + 0.6 * Math.sin(t * 6) : 0.9
    }
    // demand rendering: ask for another frame only while something is still changing
    if (moving || active || alert.current > 0) state.invalidate()

    // project HTML labels
    const L = P.labels
    const put = (el: HTMLDivElement | null, x: number, y: number, z: number, show: boolean, anchor = '-50%, -50%') => {
      if (!el) return
      tmp.set(x, y, z).project(state.camera)
      const vis = show && tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15
      el.style.opacity = vis ? '1' : '0'
      el.style.transform = `translate(${((tmp.x + 1) / 2) * state.size.width}px, ${((1 - tmp.y) / 2) * state.size.height}px) translate(${anchor})`
    }
    // force tag sits just outside the right finger, at pad height (where the arrows are)
    put(L.force.current, s.wrist[0] + s.opening / 2 + PAD_T + FINGER_T + 0.06 + 0.16 + len + 0.1, follow.current.y, s.wrist[2], ratio > 0, '6px, -50%')
    put(L.pick.current, CELL.pick[0], 0.02, CELL.pick[2] + 1.15, true)
    put(L.place.current, CELL.place[0], CELL.placeSurface + 0.05, CELL.place[2] + 1.0, true)
    put(L.alert.current, s.obj[0], s.obj[1] + objH + 0.35, s.obj[2], alerting)
  })

  const jointMat = <meshStandardMaterial color={c.joint} metalness={0.55} roughness={0.35} />
  const armMat = <meshStandardMaterial color={c.arm} metalness={0.25} roughness={0.32} />
  const capMat = <meshStandardMaterial color={c.accent} metalness={0.35} roughness={0.3} />
  const P = props.current
  return (
    <group>
      {P.object && <WorkObject key={`${P.object.object_id}:${P.object.width_mm}:${P.object.height_mm}:${P.object.depth_mm}`} object={P.object} c={c} groupRef={objRef} alert={alert} />}
      <group position={CELL.base}>
        <mesh geometry={base} position={[0, 0.18, 0]} castShadow receiveShadow>{jointMat}</mesh>
        <group ref={yaw}>
          <mesh geometry={turntable} position={[0, 0.44, 0]} castShadow>{capMat}</mesh>
          <mesh geometry={column} position={[0, 1.07, 0]} castShadow>{armMat}</mesh>
          <group ref={shoulder} position={[0, CELL.shoulderHeight, 0]}>
            <mesh geometry={jointS} castShadow>{jointMat}</mesh>
            <mesh geometry={capS}>{capMat}</mesh>
            <mesh geometry={link1} castShadow>{armMat}</mesh>
            <group ref={elbow} position={[CELL.l1, 0, 0]}>
              <mesh geometry={jointE} castShadow>{jointMat}</mesh>
              <mesh geometry={capE}>{capMat}</mesh>
              <mesh geometry={link2} castShadow>{armMat}</mesh>
              <group ref={wrist} position={[CELL.l2, 0, 0]}>
                <mesh geometry={jointW} castShadow>{jointMat}</mesh>
                <group ref={roll}>
                  <Gripper c={c} maxOpeningMm={P.maxOpeningMm} fingerL={fingerL} fingerR={fingerR} arrowL={arrowL} arrowR={arrowR} padMats={padMats} led={led} />
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

// ------------------------------------------------------------------ camera
function CameraRig({ view, nonce, autoRotate, follow }: { view: ViewName; nonce: number; autoRotate: boolean; follow: MutableRefObject<THREE.Vector3> }) {
  const { camera, gl, invalidate } = useThree()
  const ctl = useRef<OrbitControls | null>(null)
  const tween = useRef<{ fromP: THREE.Vector3; fromT: THREE.Vector3; t: number } | null>(null)
  const reduced = useMemo(reducedMotion, [])
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.minDistance = 2.2
    c.maxDistance = 24
    c.maxPolarAngle = Math.PI * 0.495
    c.autoRotateSpeed = 0.7
    c.target.set(...PRESETS.cell.target)
    const cancel = () => { tween.current = null }
    const onChange = () => invalidate()
    c.addEventListener('start', cancel)
    c.addEventListener('change', onChange)
    ctl.current = c
    return () => { c.removeEventListener('start', cancel); c.removeEventListener('change', onChange); c.dispose() }
  }, [camera, gl, invalidate])
  useEffect(() => {
    if (!ctl.current) return
    tween.current = { fromP: camera.position.clone(), fromT: ctl.current.target.clone(), t: reduced ? 1 : 0 }
    invalidate()
  }, [view, nonce, camera, reduced, invalidate])
  useFrame((state, dt) => {
    const c = ctl.current
    if (!c) return
    const tw = tween.current
    const aim = follow.current.clone().setY(follow.current.y + FOLLOW_LIFT)
    const goalT = view === 'gripper' ? aim : new THREE.Vector3(...PRESETS[view].target)
    const goalP = view === 'gripper' ? aim.clone().add(new THREE.Vector3(...FOLLOW_OFFSET)) : new THREE.Vector3(...PRESETS[view].pos)
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 0.85)
      const e = tw.t * tw.t * (3 - 2 * tw.t)
      camera.position.lerpVectors(tw.fromP, goalP, e)
      c.target.lerpVectors(tw.fromT, goalT, e)
      if (tw.t >= 1) tween.current = null
    } else if (view === 'gripper') {
      // follow the gripper while preserving whatever orbit offset the user chose
      const d = aim.clone().sub(c.target).multiplyScalar(1 - Math.exp(-dt * 6))
      c.target.add(d)
      camera.position.add(d)
    }
    c.autoRotate = autoRotate && !tween.current
    const changed = c.update()
    if (tw || changed || autoRotate || (view === 'gripper' && aim.distanceTo(c.target) > 1e-4)) state.invalidate()
  })
  return null
}

/**
 * Adaptive resolution: if consecutive frames are slow (software rendering, weak GPU), lower the pixel ratio;
 * raise it back when frames are fast again. Keeps the rest of the UI responsive.
 */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr)
  const max = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.75)
  const st = useRef({ dpr: max, avg: 16, n: 0, last: 0 })
  useFrame((state) => {
    const now = performance.now()
    const dt = now - st.current.last
    st.current.last = now
    if (dt <= 0 || dt > 250) return // idle gap between demand frames: not a measurement
    const s = st.current
    s.avg = s.avg * 0.85 + dt * 0.15
    if (++s.n < 12) return
    s.n = 0
    if (s.avg > 42 && s.dpr > 0.5) { s.dpr = Math.max(0.5, +(s.dpr * 0.75).toFixed(2)); setDpr(s.dpr); state.invalidate() }
    else if (s.avg < 18 && s.dpr < max) { s.dpr = Math.min(max, +(s.dpr * 1.25).toFixed(2)); setDpr(s.dpr) }
  })
  return null
}

/** In demand mode a re-render with new telemetry must still produce a frame. */
function InvalidateOnRender() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() })
  return null
}

function SnapshotApi({ onApi }: { onApi?: (api: SceneApi | null) => void }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    onApi?.({ snapshot: () => { try { gl.render(scene, camera); return gl.domElement.toDataURL('image/png') } catch { return null } } })
    return () => onApi?.(null)
  }, [gl, scene, camera, onApi])
  return null
}

// ------------------------------------------------------------------ root
function GripperScene(props: SceneProps) {
  const c = useThemeColors()
  const theme = useTheme((s) => s.resolved)
  const ref = useRef(props)
  ref.current = props
  const follow = useRef(new THREE.Vector3(CELL.home[0], CELL.home[1] - CELL.wristToPad, CELL.home[2]))
  const objH = (props.object?.height_mm ?? 50) * MM
  return (
    <Canvas shadows="percentage" dpr={[1, 1.75]} gl={{ antialias: true }} camera={{ position: PRESETS.cell.pos, fov: 36, near: 0.1, far: 90 }}
      frameloop={props.paused ? 'never' : 'demand'}
      aria-label="3D work-cell: arm, parallel gripper and object" role="img">
      <color attach="background" args={[c.sceneBg]} />
      <fog attach="fog" args={[c.sceneBg, 18, 42]} />
      <SceneEnvironment intensity={theme === 'light' ? 0.85 : 0.55} />
      <hemisphereLight args={[theme === 'light' ? '#ffffff' : '#c7d2fe', c.floor, theme === 'light' ? 0.6 : 0.35]} />
      <directionalLight position={[5, 11, 7]} intensity={theme === 'light' ? 1.7 : 1.35} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7}
        shadow-camera-near={1} shadow-camera-far={32} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <directionalLight position={[-7, 5, -5]} intensity={0.45} color={c.accent} />
      <Workcell c={c} />
      {props.object && <CarryPath objH={objH} color={c.accent} />}
      <Cell props={ref} c={c} follow={follow} />
      <CameraRig view={props.view} nonce={props.viewNonce} autoRotate={props.autoRotate} follow={follow} />
      <SnapshotApi onApi={props.onApi} />
      <InvalidateOnRender />
      <AdaptiveDpr />
    </Canvas>
  )
}

/** Re-render (and therefore draw) only when an input actually changes. */
export default memo(GripperScene)
