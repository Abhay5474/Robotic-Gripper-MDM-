import { Canvas } from '@react-three/fiber'
import type { ObjectProps } from '@/lib/types'

export interface SceneProps {
  object: ObjectProps | null
  openingMm: number | null
  maxOpeningMm: number
  state: string | null
  slip: boolean | null
  objectDetected: boolean | null
  forceRatio: number // 0..1 for tint
}

const S = 0.01 // mm -> scene units (1 unit = 100 mm)

export default function GripperScene({ object, openingMm, maxOpeningMm, state, slip, objectDetected, forceRatio }: SceneProps) {
  const opening = (openingMm ?? maxOpeningMm) * S
  const w = (object?.width_mm ?? 50) * S, h = (object?.height_mm ?? 50) * S, d = (object?.depth_mm ?? 50) * S
  const lifted = state === 'lifting' || state === 'transporting' || state === 'holding' ? (state === 'holding' ? 0 : 0.5) : 0
  const gripped = objectDetected === true && state !== 'releasing' && state !== 'slipped'
  const yObj = h / 2 + (gripped ? lifted : state === 'slipped' ? 0 : 0)
  const xObj = state === 'transporting' ? 0.4 : 0
  const finger = 0.12
  const objColor = slip ? '#f87171' : `hsl(${190 - forceRatio * 150}, 70%, 55%)`
  const yGrip = (gripped ? lifted : 0) + h / 2
  return (
    <Canvas camera={{ position: [3.2, 2.4, 4.0], fov: 38, near: 0.1, far: 50 }} dpr={[1, 1.5]} aria-label="3D gripper visualisation" role="img">
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 2]} intensity={1.6} />
      <gridHelper args={[6, 24, '#27355a', '#18223d']} />
      <mesh position={[xObj, yObj, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={objColor} metalness={0.1} roughness={0.6} opacity={object ? 1 : 0.2} transparent />
      </mesh>
      <group position={[xObj, yGrip, 0]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (opening / 2 + finger / 2), 0.1, 0]}>
            <boxGeometry args={[finger, Math.max(h, 0.6) + 0.3, Math.max(d, 0.4)]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        <mesh position={[0, Math.max(h, 0.6) / 2 + 0.35, 0]}>
          <boxGeometry args={[maxOpeningMm * S + finger * 2 + 0.2, 0.2, Math.max(d, 0.4)]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, Math.max(h, 0.6) / 2 + 0.95, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 1, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    </Canvas>
  )
}
