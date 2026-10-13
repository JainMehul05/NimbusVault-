'use client'

import { OrbitControls, Sparkles, Torus, Float, Text } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'

function VaultObject() {
  const group = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const shards = useMemo(() => Array.from({ length: 14 }, (_, index) => ({
    angle: (index / 14) * Math.PI * 2,
    radius: 2.15 + (index % 3) * 0.22,
    height: ((index * 37) % 100) / 100 * 2 - 1,
    scale: 0.035 + (index % 4) * 0.014,
  })), [])

  useFrame((state, delta) => {
    if (!group.current || !core.current) return
    const targetX = state.pointer.y * -0.16
    const targetY = state.pointer.x * 0.28
    group.current.rotation.y += (targetY + delta * 0.12 - group.current.rotation.y) * 0.045
    group.current.rotation.x += (targetX + Math.sin(state.clock.elapsedTime * 0.35) * 0.08 - group.current.rotation.x) * 0.045
    core.current.rotation.z -= delta * 0.24
  })

  return <group ref={group} rotation={[0.15, -0.35, 0.1]}>
    <Float speed={1.4} rotationIntensity={0.18} floatIntensity={0.3}>
      <mesh ref={core} scale={1.12}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshBasicMaterial color="#ff4f16" wireframe toneMapped={false} />
      </mesh>
      <mesh scale={0.84}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshBasicMaterial color="#351207" transparent opacity={0.94} toneMapped={false} />
      </mesh>
      <mesh scale={0.52}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshBasicMaterial color="#ff6b36" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh scale={0.2}>
        <sphereGeometry args={[1.35, 24, 24]} />
        <meshBasicMaterial color="#fff7f2" toneMapped={false} />
      </mesh>
      <Torus args={[1.72, 0.014, 8, 96]} rotation={[Math.PI / 2.4, 0, 0]}><meshBasicMaterial color="#ff6933" transparent opacity={0.88} /></Torus>
      <Torus args={[2.02, 0.008, 8, 96]} rotation={[0, Math.PI / 2.2, 0]}><meshBasicMaterial color="#9ceeff" transparent opacity={0.52} /></Torus>
      {shards.map((shard, index) => <mesh key={index} position={[Math.cos(shard.angle) * shard.radius, shard.height, Math.sin(shard.angle) * shard.radius]} scale={shard.scale} rotation={[shard.height, shard.angle, 0]}>
        <octahedronGeometry args={[1, 0]} /><meshBasicMaterial color={index % 3 === 0 ? '#9ceeff' : '#ff5100'} emissive={index % 3 === 0 ? '#6bdcf5' : '#ff5100'} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>)}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, 0]}>
        <circleGeometry args={[3.2, 64]} /><meshBasicMaterial color="#ff5100" transparent opacity={0.08} wireframe />
      </mesh>
      <group position={[0, 0, 1.08]}>
        <Text fontSize={0.38} color="#fff0e8" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#ff5100">NV</Text>
        <Text position={[0, -0.26, 0]} fontSize={0.075} color="#ffb49d" anchorX="center" anchorY="middle" letterSpacing={0.12} >SECURE CORE</Text>
      </group>
    </Float>
  </group>
}

export function HeroScene() {
  return <div className="hero-scene" aria-label="Interactive 3D NimbusVault secure data core" role="img">
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 0, 5], fov: 42 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.32} />
      <hemisphereLight color="#b9f2ff" groundColor="#100604" intensity={0.5} />
      <pointLight color="#ff5100" intensity={22} distance={8} position={[2, 2, 3]} />
      <pointLight color="#7c3aed" intensity={12} distance={7} position={[-3, 1, 1]} />
      <pointLight color="#6bdcf5" intensity={8} distance={6} position={[0, -2, -2]} />
      <VaultObject />
      <Sparkles count={60} scale={5} size={2} speed={0.25} color="#ff8b66" />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate={false} minPolarAngle={1.15} maxPolarAngle={2} />
    </Canvas>
    <div className="scene-core-mark" aria-hidden="true"><strong>NV</strong><span>SECURE CORE</span></div>
    <div className="scene-readout"><span className="pulse-dot" /> SYSTEM ONLINE <b>12.8 GB INDEXED</b></div>
  </div>
}
