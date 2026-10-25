import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ObjectProps } from '@/lib/types'
import { useThemeColors } from '@/store/theme'

export interface SceneProps {
  object: ObjectProps | null
  openingMm: number | null
  maxOpeningMm: number
  state: string | null
  slip: boolean | null
  objectDetected: boolean | null
  forceRatio: number // measured / gripper max, 0..1
}

const S = 0.01 // mm -> scene units (1 unit = 100 mm)

/** Drag to orbit, scroll to zoom. Imperative so no extra dependency is needed. */
function Orbit() {
  const { camera, gl } = useThree()
  const ref = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.set(0, 1.2, 0); c.enableDamping = true; c.enablePan = false
    c.minDistance = 3; c.maxDistance = 10; c.maxPolarAngle = Math.PI / 2.02
    ref.current = c
    return () => c.dispose()
  }, [camera, gl])
  useFrame(() => ref.current?.update())
  return null
}

export default function GripperScene({ object, openingMm, maxOpeningMm, state, slip, objectDetected, forceRatio }: SceneProps) {
  const c = useThemeColors()
  const opening = (openingMm ?? maxOpeningMm) * S
  const w = (object?.width_mm ?? 50) * S, h = (object?.height_mm ?? 50) * S, d = (object?.depth_mm ?? 50) * S
  const gripped = objectDetected === true && state !== 'releasing' && state !== 'slipped' && state !== 'complete'
  const lifted = state === 'lifting' || state === 'transporting' ? 0.5 : 0
  const yObj = h / 2 + (gripped ? lifted : 0)
  const xObj = gripped && state === 'transporting' ? 0.4 : 0
  const finger = 0.12
  const objColor = slip ? c.bad : c.object
  const fh = Math.max(h, 0.6) + 0.3, fd = Math.max(d, 0.4)
  const arrow = 0.15 + forceRatio * 0.9 // contact-force arrows grow with the MEASURED force
  return (
    <Canvas camera={{ position: [4.0, 3.0, 5.2], fov: 38, near: 0.1, far: 50 }} dpr={[1, 1.5]} shadows role="img" aria-label="3D gripper visualisation. Drag to rotate, scroll to zoom.">
      <color attach="background" args={[c.sceneBg]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={1.5} castShadow />
      <gridHelper args={[8, 32, c.sceneGridA, c.sceneGridB]} />
      <Orbit />
      <mesh position={[xObj, yObj, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={objColor} metalness={0.05} roughness={0.55} opacity={object ? 0.92 : 0.2} transparent />
      </mesh>
      <group position={[xObj, yObj, 0]}>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * (opening / 2 + finger / 2), 0.1, 0]} castShadow>
              <boxGeometry args={[finger, fh, fd]} />
              <meshStandardMaterial color={c.metal} metalness={0.6} roughness={0.35} emissive={c.meas} emissiveIntensity={forceRatio * 0.9} />
            </mesh>
            {forceRatio > 0.02 && objectDetected !== false && (
              // contact-force arrow: shaft + head pointing at the object
              <group position={[side * (opening / 2 + finger + arrow / 2 + 0.05), 0, 0]} rotation={[0, 0, side * Math.PI / 2]}>
                <mesh><cylinderGeometry args={[0.025, 0.025, arrow, 10]} /><meshStandardMaterial color={c.meas} /></mesh>
                <mesh position={[0, arrow / 2, 0]}><coneGeometry args={[0.07, 0.16, 12]} /><meshStandardMaterial color={c.meas} /></mesh>
              </group>
            )}
          </group>
        ))}
        <mesh position={[0, fh / 2 + 0.1, 0]}>
          <boxGeometry args={[maxOpeningMm * S + finger * 2 + 0.2, 0.2, fd]} />
          <meshStandardMaterial color={c.palm} metalness={0.5} roughness={0.45} />
        </mesh>
        <mesh position={[0, fh / 2 + 0.75, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 1, 16]} />
          <meshStandardMaterial color={c.stem} metalness={0.5} roughness={0.45} />
        </mesh>
      </group>
    </Canvas>
  )
}
