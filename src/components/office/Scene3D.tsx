'use client'

import { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, RoundedBox, Text, Html, Float, Environment } from '@react-three/drei'
import * as THREE from 'three'

/* ═══════════════════ TYPES ═════════════════ */
export interface Agent3D {
  id: string; name: string; role: string; avatar: string; brain?: string
  status: string; tasks: { id: string; title: string; status: string; progress: number; priority: string }[]
}

/* ═══════════════════ PALETTES ═════════════════ */
const COLORS = [
  { shirt: '#6366f1', pants: '#4338ca', hair: '#2d1b0e', skin: '#f4c7a3' },
  { shirt: '#10b981', pants: '#047857', hair: '#1a1a2e', skin: '#e8b58a' },
  { shirt: '#f43f5e', pants: '#be123c', hair: '#4a2c17', skin: '#d4956b' },
  { shirt: '#0ea5e9', pants: '#0369a1', hair: '#8b4513', skin: '#fcd5b0' },
  { shirt: '#a855f7', pants: '#7e22ce', hair: '#2c1810', skin: '#c07840' },
  { shirt: '#f59e0b', pants: '#b45309', hair: '#1a1a2e', skin: '#fde8d0' },
  { shirt: '#ec4899', pants: '#be185d', hair: '#3d2b1f', skin: '#e0b090' },
]
function getC(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

const STATUS_COLOR: Record<string, string> = {
  working: '#22c55e', thinking: '#eab308', waiting: '#3b82f6', idle: '#71717a', error: '#ef4444',
}

/* ═══════════════════ BRAIN TYPES ═════════════════ */
const BRAIN_TYPES: Record<string, { name: string; color: string; glow: string; size: number; speed: number; desc: string }> = {
  'claude-opus':    { name: 'Claude Opus',    color: '#d97706', glow: '#fbbf24', size: 1.0,  speed: 0.8,  desc: 'Pensamiento profundo' },
  'claude-sonnet':  { name: 'Claude Sonnet',  color: '#818cf8', glow: '#a78bfa', size: 0.85, speed: 1.0,  desc: 'Equilibrado y versatil' },
  'claude-haiku':   { name: 'Claude Haiku',   color: '#34d399', glow: '#6ee7b7', size: 0.7,  speed: 1.5,  desc: 'Rapido y agil' },
  'gpt-4o':         { name: 'GPT-4o',         color: '#10b981', glow: '#34d399', size: 0.9,  speed: 1.1,  desc: 'Multimodal' },
  'gemini-pro':     { name: 'Gemini Pro',     color: '#3b82f6', glow: '#60a5fa', size: 0.85, speed: 1.0,  desc: 'Contexto largo' },
  'llama-3':        { name: 'Llama 3',        color: '#a855f7', glow: '#c084fc', size: 0.75, speed: 1.3,  desc: 'Open source' },
  'mistral':        { name: 'Mistral',        color: '#f43f5e', glow: '#fb7185', size: 0.8,  speed: 1.2,  desc: 'Eficiente' },
}
function getBrain(id: string) { return BRAIN_TYPES[id] || BRAIN_TYPES['claude-sonnet'] }

/* ═══════════════════ FLOOR ═════════════════ */
function OfficeFloor() {
  return (
    <group>
      {/* Base subfloor (dark) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[22, 16]} />
        <meshStandardMaterial color="#111118" roughness={0.95} />
      </mesh>

      {/* Main office carpet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1, -0.02, 0]} receiveShadow>
        <planeGeometry args={[20, 14]} />
        <meshStandardMaterial color="#252538" roughness={0.92} />
      </mesh>

      {/* Carpet tile grid - subtle lines */}
      {Array.from({ length: 17 }).map((_, i) => (
        <mesh key={`gx${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-8 + i, 0.0, 0]}>
          <planeGeometry args={[0.015, 12]} />
          <meshStandardMaterial color="#2a2a40" transparent opacity={0.4} />
        </mesh>
      ))}
      {Array.from({ length: 13 }).map((_, i) => (
        <mesh key={`gz${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, -6 + i]}>
          <planeGeometry args={[16, 0.015]} />
          <meshStandardMaterial color="#2a2a40" transparent opacity={0.4} />
        </mesh>
      ))}

      {/* Walking aisle between rows (slightly lighter carpet) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -1.1]} receiveShadow>
        <planeGeometry args={[15, 0.9]} />
        <meshStandardMaterial color="#2d2d45" roughness={0.9} />
      </mesh>

      {/* Per-desk area rugs (subtle color zones) */}
      {[
        [-4.5, -3.5], [-1.5, -3.5], [1.5, -3.5], [4.5, -3.5],
        [-3, 0.5], [0, 0.5], [3, 0.5],
      ].map(([x, z], i) => (
        <mesh key={`rug${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.005, z]} receiveShadow>
          <planeGeometry args={[2.1, 1.5]} />
          <meshStandardMaterial color="#28283f" roughness={0.95} />
        </mesh>
      ))}

      {/* Floor cable channels (dark lines along desk rows) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -3.5]}>
        <planeGeometry args={[12, 0.06]} />
        <meshStandardMaterial color="#1a1a28" roughness={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0.5]}>
        <planeGeometry args={[9, 0.06]} />
        <meshStandardMaterial color="#1a1a28" roughness={0.8} />
      </mesh>
    </group>
  )
}

/* ═══════════════════ WALLS ═════════════════ */
function OfficeWalls() {
  const wallColor = '#e8e4df'
  const accentWall = '#3b3b5c'
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 2.5, -5.5]} receiveShadow>
        <boxGeometry args={[16, 5, 0.15]} />
        <meshStandardMaterial color={accentWall} roughness={0.9} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-7.75, 2.5, 0]} receiveShadow>
        <boxGeometry args={[0.15, 5, 11]} />
        <meshStandardMaterial color={accentWall} roughness={0.9} />
      </mesh>

      {/* Right wall (partial) */}
      <mesh position={[7.75, 2.5, -1.5]} receiveShadow>
        <boxGeometry args={[0.15, 5, 8]} />
        <meshStandardMaterial color={accentWall} roughness={0.9} />
      </mesh>



      {/* ---- Windows on back wall ---- */}
      {[-4.5, -1.5, 1.5, 4.5].map((x, i) => (
        <group key={`win${i}`}>
          {/* Window frame */}
          <mesh position={[x, 3.2, -5.4]}>
            <boxGeometry args={[2.4, 2.2, 0.12]} />
            <meshStandardMaterial color="#1a1a3a" />
          </mesh>
          {/* Glass - sky glow */}
          <mesh position={[x, 3.2, -5.32]}>
            <planeGeometry args={[2.1, 1.9]} />
            <meshStandardMaterial
              color="#1a2a4a"
              emissive="#0a1530"
              emissiveIntensity={2}
              transparent
              opacity={0.85}
            />
          </mesh>
          {/* Window cross frame */}
          <mesh position={[x, 3.2, -5.36]}>
            <boxGeometry args={[0.05, 1.9, 0.02]} />
            <meshStandardMaterial color="#2a2a4a" />
          </mesh>
          <mesh position={[x, 3.2, -5.36]}>
            <boxGeometry args={[2.1, 0.05, 0.02]} />
            <meshStandardMaterial color="#2a2a4a" />
          </mesh>
        </group>
      ))}

      {/* No ceiling — open top view */}

      {/* ---- Clock on left wall ---- */}
      <group position={[-7.65, 3.2, -2]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.45, 0.45, 0.06, 32]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
        <mesh position={[0.04, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <circleGeometry args={[0.4, 32]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
      </group>

      {/* ---- Whiteboard on back wall ---- */}
      <group position={[0, 2.8, -5.35]}>
        <mesh>
          <boxGeometry args={[3, 1.8, 0.05]} />
          <meshStandardMaterial color="#f5f5f0" roughness={0.3} />
        </mesh>
        {/* Whiteboard frame */}
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[3.15, 1.95, 0.02]} />
          <meshStandardMaterial color="#555" />
        </mesh>
        {/* Fake content lines */}
        {[0.3, 0, -0.3].map((y, i) => (
          <mesh key={`wbl${i}`} position={[-0.8 + i * 0.3, y, 0.03]}>
            <boxGeometry args={[0.8 + i * 0.2, 0.06, 0.001]} />
            <meshStandardMaterial color={i === 0 ? '#e74c3c' : i === 1 ? '#3498db' : '#2ecc71'} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ═══════════════════ DESK ═════════════════ */
function Desk({ position = [0, 0, 0], rotation = 0, status = 'idle' }: {
  position?: [number, number, number]; rotation?: number; status?: string
}) {
  const sc = STATUS_COLOR[status] || '#71717a'
  const legH = 0.72
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Desk top - modern dark wood */}
      <RoundedBox args={[1.6, 0.05, 0.8]} radius={0.02} position={[0, legH + 0.025, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#2c2c3e" roughness={0.6} metalness={0.1} />
      </RoundedBox>

      {/* Desk legs - metal */}
      {[
        [-0.7, legH / 2, 0.3], [0.7, legH / 2, 0.3],
        [-0.7, legH / 2, -0.3], [0.7, legH / 2, -0.3]
      ].map(([x, y, z], i) => (
        <mesh key={`leg${i}`} position={[x, y, z]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, legH, 8]} />
          <meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}

      {/* Monitor - tilted slightly back for top-down visibility */}
      <group position={[0, legH + 0.05 + 0.2, -0.2]} rotation={[-0.35, 0, 0]}>
        {/* Monitor stand */}
        <mesh position={[0, -0.08, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.04, 0.16, 8]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Monitor base */}
        <mesh position={[0, -0.17, 0.03]} castShadow>
          <boxGeometry args={[0.2, 0.01, 0.12]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Screen bezel */}
        <RoundedBox args={[0.7, 0.42, 0.025]} radius={0.015} castShadow>
          <meshStandardMaterial color="#111" roughness={0.5} />
        </RoundedBox>
        {/* Screen display */}
        <mesh position={[0, 0, 0.015]}>
          <planeGeometry args={[0.62, 0.35]} />
          <meshStandardMaterial
            color="#0f1729"
            emissive="#1a2744"
            emissiveIntensity={1}
          />
        </mesh>
        {/* Fake code lines on screen */}
        {[0.08, 0.02, -0.04, -0.1].map((y, i) => (
          <mesh key={`cl${i}`} position={[-0.15 + i * 0.04, y, 0.018]}>
            <boxGeometry args={[0.15 + (i % 3) * 0.06, 0.018, 0.001]} />
            <meshStandardMaterial color={i === 0 ? '#6366f1' : i === 2 ? '#22c55e' : '#445566'} transparent opacity={0.5} />
          </mesh>
        ))}
        {/* Screen glow */}
        <pointLight position={[0, 0, 0.3]} intensity={0.25} color="#4466aa" distance={2} decay={2} />
      </group>

      {/* Keyboard */}
      <RoundedBox args={[0.35, 0.012, 0.12]} radius={0.005} position={[0, legH + 0.06, 0.05]}>
        <meshStandardMaterial color="#222" roughness={0.8} metalness={0.2} />
      </RoundedBox>

      {/* Mouse */}
      <mesh position={[0.32, legH + 0.068, 0.1]} castShadow>
        <boxGeometry args={[0.05, 0.02, 0.08]} />
        <meshStandardMaterial color="#222" roughness={0.8} />
      </mesh>

      {/* Status LED on desk edge */}
      <mesh position={[0.72, legH + 0.01, 0.35]}>
        <sphereGeometry args={[0.02, 12, 12]} />
        <meshStandardMaterial color={sc} emissive={sc} emissiveIntensity={3} />
      </mesh>
      {/* Status light glow */}
      <pointLight position={[0.72, legH + 0.05, 0.35]} intensity={0.2} color={sc} distance={1.5} decay={2} />

      {/* Coffee mug (only when waiting) */}
      {status === 'waiting' && (
        <group position={[0.55, legH + 0.065, 0.15]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.035, 0.03, 0.07, 12]} />
            <meshStandardMaterial color="#f5f5f0" roughness={0.5} />
          </mesh>
          {/* Handle */}
          <mesh position={[0.045, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.02, 0.005, 8, 12, Math.PI]} />
            <meshStandardMaterial color="#f5f5f0" roughness={0.5} />
          </mesh>
          {/* Coffee inside */}
          <mesh position={[0, 0.025, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.01, 12]} />
            <meshStandardMaterial color="#3e2723" />
          </mesh>
        </group>
      )}
    </group>
  )
}

/* ═══════════════════ CHAIR ═════════════════ */
function Chair({ position = [0, 0, 0], rotation = 0 }: {
  position?: [number, number, number]; rotation?: number
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat */}
      <RoundedBox args={[0.45, 0.06, 0.42]} radius={0.015} position={[0, 0.48, 0]} castShadow>
        <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
      </RoundedBox>
      {/* Backrest */}
      <RoundedBox args={[0.44, 0.5, 0.05]} radius={0.015} position={[0, 0.76, -0.18]} castShadow>
        <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
      </RoundedBox>
      {/* Center post */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 0.3, 8]} />
        <meshStandardMaterial color="#444" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Base star */}
      {[0, 1.2, 2.4, 3.6, 4.8].map((angle, i) => (
        <mesh key={`arm${i}`} position={[
          Math.sin(angle) * 0.22, 0.04, Math.cos(angle) * 0.22
        ]} rotation={[Math.PI / 2, 0, angle]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.22, 6]} />
          <meshStandardMaterial color="#444" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* Wheels */}
      {[0, 1.2, 2.4, 3.6, 4.8].map((angle, i) => (
        <mesh key={`wheel${i}`} position={[
          Math.sin(angle) * 0.32, 0.025, Math.cos(angle) * 0.32
        ]} castShadow>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial color="#222" roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/* ═══════════════════ 3D BRAIN ═════════════════ */
function Brain3D({ brainId, status }: { brainId: string; status: string }) {
  const brain = getBrain(brainId)
  const glowRef = useRef<THREE.Mesh>(null)
  const pulseRef = useRef<THREE.PointLight>(null)
  const s = brain.size * 0.08
  const isActive = status === 'working' || status === 'thinking'

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const speed = brain.speed
    if (glowRef.current) {
      const pulse = isActive ? 0.15 + Math.sin(t * speed * 4) * 0.08 : 0.1
      glowRef.current.scale.setScalar(1 + pulse)
    }
    if (pulseRef.current) {
      pulseRef.current.intensity = isActive ? 0.6 + Math.sin(t * speed * 5) * 0.3 : 0.15
    }
  })

  return (
    <Float speed={2} floatIntensity={0.15} rotationIntensity={0.1}>
      <group position={[0, 0.35, 0]}>
        {/* Outer glow sphere */}
        <mesh ref={glowRef}>
          <sphereGeometry args={[s * 2.2, 16, 16]} />
          <meshStandardMaterial color={brain.glow} transparent opacity={isActive ? 0.12 : 0.05} emissive={brain.glow} emissiveIntensity={0.5} />
        </mesh>

        {/* Brain - left hemisphere */}
        <mesh position={[-s * 0.35, 0, 0]}>
          <sphereGeometry args={[s, 12, 12]} />
          <meshStandardMaterial color={brain.color} roughness={0.4} metalness={0.2} emissive={brain.color} emissiveIntensity={isActive ? 0.8 : 0.2} />
        </mesh>
        {/* Brain - right hemisphere */}
        <mesh position={[s * 0.35, 0, 0]}>
          <sphereGeometry args={[s, 12, 12]} />
          <meshStandardMaterial color={brain.color} roughness={0.4} metalness={0.2} emissive={brain.color} emissiveIntensity={isActive ? 0.8 : 0.2} />
        </mesh>
        {/* Brain - center bridge */}
        <mesh position={[0, 0, 0]} scale={[0.5, 0.85, 0.8]}>
          <sphereGeometry args={[s * 0.9, 10, 10]} />
          <meshStandardMaterial color={brain.color} roughness={0.4} metalness={0.2} emissive={brain.color} emissiveIntensity={isActive ? 0.8 : 0.2} />
        </mesh>

        {/* Brain wrinkles / folds */}
        {[
          { pos: [-s * 0.2, s * 0.3, s * 0.5] as [number, number, number], rot: [0, 0, 0.3] as [number, number, number], sc: 0.6 },
          { pos: [s * 0.3, -s * 0.1, s * 0.4] as [number, number, number], rot: [0, 0, -0.4] as [number, number, number], sc: 0.5 },
          { pos: [-s * 0.1, -s * 0.3, s * 0.45] as [number, number, number], rot: [0.3, 0, 0.2] as [number, number, number], sc: 0.45 },
          { pos: [s * 0.15, s * 0.15, s * 0.55] as [number, number, number], rot: [-0.2, 0, -0.3] as [number, number, number], sc: 0.4 },
          { pos: [0, s * 0.4, s * 0.3] as [number, number, number], rot: [0.5, 0, 0] as [number, number, number], sc: 0.35 },
        ].map((w, i) => (
          <mesh key={i} position={w.pos} rotation={w.rot} scale={[w.sc, w.sc, 0.3]}>
            <torusGeometry args={[s * 0.35, s * 0.04, 6, 12, Math.PI * 0.6]} />
            <meshStandardMaterial color={brain.glow} emissive={brain.glow} emissiveIntensity={isActive ? 0.5 : 0.1} transparent opacity={0.6} />
          </mesh>
        ))}

        {/* Brain stem */}
        <mesh position={[0, -s * 0.7, 0]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[s * 0.15, s * 0.08, s * 0.5, 6]} />
          <meshStandardMaterial color={brain.color} roughness={0.5} emissive={brain.color} emissiveIntensity={isActive ? 0.4 : 0.1} />
        </mesh>

        {/* Neural sparks (only when active) */}
        {isActive && (
          <>
            {[0, 1.2, 2.4, 3.6, 4.8].map((phase, i) => (
              <mesh key={`spark${i}`} position={[
                Math.sin(phase) * s * 0.8,
                Math.cos(phase * 1.3) * s * 0.4,
                s * 0.3
              ]}>
                <sphereGeometry args={[s * 0.06, 6, 6]} />
                <meshStandardMaterial color="#ffffff" emissive={brain.glow} emissiveIntensity={3} transparent opacity={0.8} />
              </mesh>
            ))}
          </>
        )}

        {/* Point light */}
        <pointLight ref={pulseRef} color={brain.glow} distance={2} decay={2} intensity={0.15} />

        {/* Brain label */}
        <Text
          position={[0, -s * 1.4, 0]}
          fontSize={0.065}
          color={brain.glow}
          anchorX="center"
          anchorY="top"
          font={undefined}
        >
          {brain.name}
        </Text>
      </group>
    </Float>
  )
}

/* ═══════════════════ AGENT CHARACTER ═════════════════ */
function AgentCharacter({ agent, position, deskRotation = 0, onClick, scale = 1 }: {
  agent: Agent3D; position: [number, number, number]; deskRotation?: number; scale?: number; onClick?: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)
  const bodyBobRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  const c = getC(agent.id)
  const brain = getBrain(agent.brain || 'claude-sonnet')
  const status = agent.status || 'idle'
  const isWorking = status === 'working'
  const isThinking = status === 'thinking'
  const isWaiting = status === 'waiting'
  const isError = status === 'error'
  const task = agent.tasks?.find(t => t.status === 'in_progress')

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const sp = brain.speed // brain-dependent speed multiplier

    // Body bob
    if (bodyBobRef.current) {
      if (isWorking) {
        bodyBobRef.current.position.y = Math.sin(t * 8 * sp) * 0.008
      } else if (isThinking) {
        bodyBobRef.current.position.y = Math.sin(t * 1.5 * sp) * 0.015
      } else if (isWaiting) {
        bodyBobRef.current.position.y = Math.sin(t * 0.8) * 0.01
        bodyBobRef.current.rotation.x = Math.sin(t * 0.5) * 0.05
      } else {
        bodyBobRef.current.position.y = Math.sin(t * 1.2) * 0.003
        bodyBobRef.current.rotation.x = 0
      }
    }

    // Head
    if (headRef.current) {
      if (isThinking) {
        headRef.current.rotation.z = Math.sin(t * 2 * sp) * 0.12
        headRef.current.rotation.y = Math.sin(t * 1.3 * sp) * 0.08
      } else if (isError) {
        headRef.current.rotation.z = Math.sin(t * 6) * 0.08
      } else if (isWorking) {
        headRef.current.rotation.y = Math.sin(t * 0.5) * 0.03
        headRef.current.rotation.z = 0
      } else {
        headRef.current.rotation.y = Math.sin(t * 0.3) * 0.02
        headRef.current.rotation.z = 0
      }
    }

    // Arms
    if (isWorking) {
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 10 * sp) * 0.25
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 10 * sp + Math.PI) * 0.25
    } else if (isThinking) {
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.3
      if (rightArmRef.current) {
        rightArmRef.current.rotation.x = -0.6
        rightArmRef.current.rotation.z = 0.3
      }
    } else if (isWaiting) {
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.15
      if (rightArmRef.current) rightArmRef.current.rotation.x = -0.15
    } else {
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 0.5) * 0.02
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 0.5 + 0.5) * 0.02
    }

    // Hover scale
    if (groupRef.current) {
      const target = hovered ? 1.06 : 1
      groupRef.current.scale.lerp(new THREE.Vector3(target, target, target), 0.1)
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, deskRotation, 0]}
      scale={[scale, scale, scale]}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      <group ref={bodyBobRef}>
        {/* ---- BODY (torso) ---- */}
        <group position={[0, 0.58, 0]}>
          {/* Torso */}
          <mesh castShadow>
            <capsuleGeometry args={[0.14, 0.18, 8, 12]} />
            <meshStandardMaterial color={c.shirt} roughness={0.7} />
          </mesh>

          {/* Collar detail */}
          <mesh position={[0, 0.12, 0.08]}>
            <boxGeometry args={[0.1, 0.04, 0.01]} />
            <meshStandardMaterial color={c.shirt} roughness={0.7} />
          </mesh>

          {/* ---- ARMS ---- */}
          {/* Left arm */}
          <group position={[-0.18, 0.04, 0]} ref={leftArmRef}>
            <mesh castShadow>
              <capsuleGeometry args={[0.04, 0.15, 4, 8]} />
              <meshStandardMaterial color={c.shirt} roughness={0.7} />
            </mesh>
            {/* Left hand */}
            <mesh position={[0, -0.12, 0]}>
              <sphereGeometry args={[0.04, 8, 8]} />
              <meshStandardMaterial color={c.skin} roughness={0.8} />
            </mesh>
          </group>

          {/* Right arm */}
          <group position={[0.18, 0.04, 0]} ref={rightArmRef}>
            <mesh castShadow>
              <capsuleGeometry args={[0.04, 0.15, 4, 8]} />
              <meshStandardMaterial color={c.shirt} roughness={0.7} />
            </mesh>
            {/* Right hand */}
            <mesh position={[0, -0.12, 0]}>
              <sphereGeometry args={[0.04, 8, 8]} />
              <meshStandardMaterial color={c.skin} roughness={0.8} />
            </mesh>
          </group>
        </group>

        {/* ---- HEAD ---- */}
        <group position={[0, 0.96, 0]} ref={headRef}>
          {/* Neck */}
          <mesh position={[0, -0.06, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.08, 8]} />
            <meshStandardMaterial color={c.skin} roughness={0.8} />
          </mesh>
          {/* Head sphere */}
          <mesh castShadow>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color={c.skin} roughness={0.8} />
          </mesh>
          {/* Hair */}
          <mesh position={[0, 0.06, -0.02]} castShadow>
            <sphereGeometry args={[0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={c.hair} roughness={0.9} />
          </mesh>
          {/* Eyes */}
          <mesh position={[-0.05, -0.01, 0.13]}>
            <sphereGeometry args={[0.025, 10, 10]} />
            <meshStandardMaterial color="#1a1a2e" />
          </mesh>
          <mesh position={[0.05, -0.01, 0.13]}>
            <sphereGeometry args={[0.025, 10, 10]} />
            <meshStandardMaterial color="#1a1a2e" />
          </mesh>
          {/* Eye highlights */}
          <mesh position={[-0.043, 0.005, 0.15]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0.057, 0.005, 0.15]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
          </mesh>
          {/* Mouth */}
          {isError ? (
            <mesh position={[0, -0.06, 0.135]} rotation={[0.3, 0, 0]}>
              <torusGeometry args={[0.02, 0.005, 6, 12, Math.PI]} />
              <meshStandardMaterial color="#cc3333" />
            </mesh>
          ) : (
            <mesh position={[0, -0.06, 0.14]}>
              <boxGeometry args={[0.04, 0.008, 0.005]} />
              <meshStandardMaterial color="#c0392b" />
            </mesh>
          )}

          {/* Glasses (for some agents) */}
          {agent.role === 'architect' && (
            <group position={[0, 0, 0.14]}>
              <mesh position={[-0.05, 0, 0]}>
                <torusGeometry args={[0.03, 0.004, 6, 16]} />
                <meshStandardMaterial color="#333" metalness={0.6} />
              </mesh>
              <mesh position={[0.05, 0, 0]}>
                <torusGeometry args={[0.03, 0.004, 6, 16]} />
                <meshStandardMaterial color="#333" metalness={0.6} />
              </mesh>
              <mesh position={[0, 0.005, 0]}>
                <boxGeometry args={[0.04, 0.004, 0.004]} />
                <meshStandardMaterial color="#333" metalness={0.6} />
              </mesh>
            </group>
          )}

          {/* Thinking indicator - lightbulb above head */}
          {isThinking && (
            <Float speed={3} floatIntensity={0.3} rotationIntensity={0.2}>
              <group position={[0, 0.25, 0]}>
                <mesh>
                  <sphereGeometry args={[0.04, 8, 8]} />
                  <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={2} />
                </mesh>
                <pointLight intensity={0.3} color="#fbbf24" distance={1} decay={2} />
              </group>
            </Float>
          )}

          {/* Error indicator - red exclamation */}
          {isError && (
            <Float speed={4} floatIntensity={0.2}>
              <group position={[0, 0.28, 0]}>
                <mesh>
                  <coneGeometry args={[0.025, 0.06, 3]} />
                  <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} />
                </mesh>
                <pointLight intensity={0.3} color="#ef4444" distance={1} decay={2} />
              </group>
            </Float>
          )}

          {/* ---- BRAIN ---- */}
          <Brain3D brainId={agent.brain || 'claude-sonnet'} status={status} />
        </group>

        {/* ---- SHADOW on floor ---- */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.1]} scale={[1, 0.6, 1]}>
          <circleGeometry args={[0.2, 16]} />
          <meshStandardMaterial color="#000" transparent opacity={0.15} />
        </mesh>
      </group>
    </group>
  )
}

/* ═══════════════════ PLANTS ═════════════════ */
function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Pot */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.12, 0.3, 12]} />
        <meshStandardMaterial color="#6b4226" roughness={0.9} />
      </mesh>
      {/* Soil */}
      <mesh position={[0, 0.31, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.03, 12]} />
        <meshStandardMaterial color="#3e2723" />
      </mesh>
      {/* Leaves */}
      {[0, 0.8, 1.6, 2.4, 3.2, 4.0].map((angle, i) => (
        <group key={i} position={[
          Math.sin(angle) * 0.06, 0.38 + i * 0.04, Math.cos(angle) * 0.06
        ]} rotation={[0.2 * (i % 2 === 0 ? 1 : -1), angle, 0.3 * (i % 2 === 0 ? 1 : -1)]}>
          <mesh>
            <coneGeometry args={[0.05, 0.12, 6]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#2d5a27' : '#3a7d32'} roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ═══════════════════ BOOKSHELF ═════════════════ */
function Bookshelf({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Shelf frame */}
      <RoundedBox args={[0.8, 1.6, 0.3]} radius={0.01} castShadow>
        <meshStandardMaterial color="#3e2a1a" roughness={0.8} />
      </RoundedBox>
      {/* Inner dark */}
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[0.7, 1.5, 0.01]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
      {/* Shelf boards */}
      {[-0.5, -0.15, 0.2, 0.55].map((y, i) => (
        <RoundedBox key={i} args={[0.72, 0.02, 0.28]} radius={0.005} position={[0, y, 0]}>
          <meshStandardMaterial color="#4a3422" roughness={0.8} />
        </RoundedBox>
      ))}
      {/* Books */}
      {[
        { y: -0.33, colors: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'] },
        { y: 0.02, colors: ['#9b59b6', '#1abc9c', '#e67e22'] },
        { y: 0.37, colors: ['#2c3e50', '#c0392b', '#27ae60', '#2980b9', '#8e44ad'] },
      ].map((shelf, si) =>
        shelf.colors.map((color, ci) => (
          <mesh key={`b${si}${ci}`} position={[-0.25 + ci * 0.13, shelf.y + 0.1, 0.04]} castShadow>
            <boxGeometry args={[0.08, 0.2, 0.18]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        ))
      )}
    </group>
  )
}

/* ═══════════════════ WATER COOLER ═════════════════ */
function WaterCooler({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Base */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.2, 0.6, 12]} />
        <meshStandardMaterial color="#ddd" roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Water bottle */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <capsuleGeometry args={[0.12, 0.2, 8, 12]} />
        <meshStandardMaterial color="#88ccff" transparent opacity={0.5} roughness={0.1} metalness={0.1} />
      </mesh>
      {/* Cap */}
      <mesh position={[0, 0.98, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.06, 12]} />
        <meshStandardMaterial color="#4488bb" roughness={0.5} />
      </mesh>
    </group>
  )
}

/* ═══════════════════ AGENT FLOOR ZONE (top-down presence indicator) ═════════════════ */
function AgentFloorZone({ agent, position, onClick }: {
  agent: Agent3D; position: [number, number, number]; onClick?: () => void
}) {
  const ringRef = useRef<THREE.Mesh>(null)
  const c = getC(agent.id)
  const sc = STATUS_COLOR[agent.status] || '#71717a'
  const isWorking = agent.status === 'working'
  const isThinking = agent.status === 'thinking'

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshStandardMaterial
      if (isWorking) {
        mat.opacity = 0.5 + Math.sin(t * 3) * 0.2
        mat.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.5
      } else if (isThinking) {
        mat.opacity = 0.4 + Math.sin(t * 1.5) * 0.15
        mat.emissiveIntensity = 1.0 + Math.sin(t * 1.5) * 0.3
      } else {
        mat.opacity = 0.35
        mat.emissiveIntensity = 0.8
      }
    }
  })

  return (
    <group position={position}>
      {/* Outer pulsing ring */}
      <mesh
        ref={ringRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
      >
        <ringGeometry args={[0.8, 1.0, 48]} />
        <meshBasicMaterial
          color={sc}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Soft outer glow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[1.0, 1.2, 48]} />
        <meshBasicMaterial
          color={sc}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Inner zone fill */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onClick={(e) => { e.stopPropagation(); onClick?.() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'default' }}
      >
        <circleGeometry args={[0.78, 48]} />
        <meshBasicMaterial
          color={c.shirt}
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Status point light */}
      <pointLight position={[0, 0.5, 0]} intensity={0.6} color={sc} distance={3} decay={2} />
    </group>
  )
}

/* ═══════════════════ FLOATING AVATAR MARKER (visible from above) ═════════════════ */
function AvatarMarker({ agent, position, onClick }: {
  agent: Agent3D; position: [number, number, number]; onClick?: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const c = getC(agent.id)
  const sc = STATUS_COLOR[agent.status] || '#71717a'

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = 1.45 + Math.sin(state.clock.elapsedTime * 1.5) * 0.04
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'default' }}
    >
      {/* Colored disc / token */}
      <mesh castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.08, 24]} />
        <meshBasicMaterial color={c.shirt} />
      </mesh>
      {/* Status ring around disc */}
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.19, 0.24, 24]} />
        <meshBasicMaterial color={sc} />
      </mesh>
      {/* Name label (HTML for crisp text) */}
      <Html position={[0, 0.3, 0]} center transform scale={0.55}>
        <div style={{
          background: 'rgba(0,0,0,0.85)', borderRadius: '6px', padding: '3px 10px',
          color: 'white', fontSize: '10px', fontFamily: 'system-ui', fontWeight: 700,
          whiteSpace: 'nowrap', border: `1.5px solid ${sc}`,
          boxShadow: `0 2px 12px ${sc}60`, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: '5px',
          letterSpacing: '0.02em'
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%', background: sc,
            boxShadow: `0 0 6px ${sc}`,
          }} />
          {agent.name}
        </div>
      </Html>
    </group>
  )
}

/* ═══════════════════ WORKSTATION (desk + chair + agent + floor zone) ═════════════════ */
function Workstation({ agent, deskPos, chairPos, rotation, onClick }: {
  agent: Agent3D; deskPos: [number, number, number]; chairPos: [number, number, number]
  rotation: number; onClick?: () => void
}) {
  const zonePos: [number, number, number] = [
    (deskPos[0] + chairPos[0]) / 2,
    0,
    (deskPos[2] + chairPos[2]) / 2,
  ]
  const markerPos: [number, number, number] = [chairPos[0], 1.45, chairPos[2]]
  return (
    <group>
      <AgentFloorZone agent={agent} position={zonePos} onClick={onClick} />
      <AvatarMarker agent={agent} position={markerPos} onClick={onClick} />
      <Desk position={deskPos} rotation={rotation} status={agent.status} />
      <Chair position={chairPos} rotation={rotation} />
      <AgentCharacter agent={agent} position={[chairPos[0], 0, chairPos[2]]} deskRotation={rotation} onClick={onClick} scale={1.15} />
    </group>
  )
}

/* ═══════════════════ MEETING ROOM (always visible) ═════════════════ */
function MeetingRoom() {
  return (
    <group>
      {/* Meeting room floor - slightly warmer carpet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[4, 0.005, 3]} receiveShadow>
        <planeGeometry args={[6.5, 5.5]} />
        <meshStandardMaterial color="#28283f" roughness={0.9} />
      </mesh>
      {/* Area rug under table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[4, 0.008, 3]}>
        <planeGeometry args={[5, 3.5]} />
        <meshStandardMaterial color="#2a2a45" roughness={0.95} />
      </mesh>

      {/* ─── GLASS WALLS ─── */}
      {/* Left glass partition */}
      <mesh position={[1.0, 1.5, 3]}>
        <boxGeometry args={[0.06, 3, 5.5]} />
        <meshStandardMaterial color="#88aacc" transparent opacity={0.1} roughness={0.05} metalness={0.4} />
      </mesh>
      {/* Left frame - top beam */}
      <mesh position={[1.0, 3, 3]}>
        <boxGeometry args={[0.08, 0.06, 5.5]} />
        <meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Left frame - verticals */}
      <mesh position={[1.0, 1.5, 0.25]}><boxGeometry args={[0.08, 3, 0.06]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[1.0, 1.5, 5.75]}><boxGeometry args={[0.08, 3, 0.06]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      {/* Left frame - mid horizontal */}
      <mesh position={[1.0, 1.5, 3]}><boxGeometry args={[0.08, 0.04, 5.5]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} transparent opacity={0.3} /></mesh>

      {/* Back glass wall */}
      <mesh position={[4, 1.5, 5.75]}>
        <boxGeometry args={[6.5, 3, 0.06]} />
        <meshStandardMaterial color="#88aacc" transparent opacity={0.1} roughness={0.05} metalness={0.4} />
      </mesh>
      {/* Back frame - top */}
      <mesh position={[4, 3, 5.75]}><boxGeometry args={[6.5, 0.06, 0.08]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      {/* Back frame - verticals */}
      <mesh position={[1.0, 1.5, 5.75]}><boxGeometry args={[0.06, 3, 0.08]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[7.0, 1.5, 5.75]}><boxGeometry args={[0.06, 3, 0.08]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>

      {/* Right wall (partial, shorter) */}
      <mesh position={[7.0, 1.5, 4.5]}>
        <boxGeometry args={[0.06, 3, 2.5]} />
        <meshStandardMaterial color="#3b3b5c" roughness={0.9} />
      </mesh>
      <mesh position={[7.0, 3, 4.5]}><boxGeometry args={[0.08, 0.06, 2.5]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>

      {/* Front opening - door frame pillars */}
      <mesh position={[1.0, 1.5, 0.25]}><boxGeometry args={[0.1, 3, 0.1]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[7.0, 1.5, 0.25]}><boxGeometry args={[0.1, 3, 0.1]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[4, 3, 0.25]}><boxGeometry args={[6, 0.06, 0.1]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>

      {/* ─── CONFERENCE TABLE ─── */}
      {/* Tabletop */}
      <RoundedBox args={[4.2, 0.06, 1.5]} radius={0.15} position={[4, 0.76, 3]} castShadow receiveShadow>
        <meshStandardMaterial color="#1e1e30" roughness={0.4} metalness={0.15} />
      </RoundedBox>
      {/* Table edge highlight */}
      <mesh position={[4, 0.74, 3]}>
        <boxGeometry args={[4.15, 0.01, 1.45]} />
        <meshStandardMaterial color="#2a2a42" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Table legs - metal pedestal base */}
      <mesh position={[4, 0.15, 3]}>
        <cylinderGeometry args={[0.5, 0.6, 0.08, 16]} />
        <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Table center column */}
      <mesh position={[4, 0.42, 3]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.62, 8]} />
        <meshStandardMaterial color="#444" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* ─── 7 MEETING CHAIRS (always there) ─── */}
      {[
        // Left side - 3 chairs facing right (+X)
        { pos: [2.0, 0, 2.1] as [number,number,number], rot: -Math.PI/2 },
        { pos: [2.0, 0, 3.0] as [number,number,number], rot: -Math.PI/2 },
        { pos: [2.0, 0, 3.9] as [number,number,number], rot: -Math.PI/2 },
        // Right side - 3 chairs facing left (-X)
        { pos: [6.0, 0, 2.1] as [number,number,number], rot: Math.PI/2 },
        { pos: [6.0, 0, 3.0] as [number,number,number], rot: Math.PI/2 },
        { pos: [6.0, 0, 3.9] as [number,number,number], rot: Math.PI/2 },
        // Head of table - 1 chair facing the room (-Z)
        { pos: [4, 0, 4.6] as [number,number,number], rot: Math.PI },
      ].map((mc, i) => (
        <Chair key={`mr-chair-${i}`} position={mc.pos} rotation={mc.rot + Math.PI} />
      ))}

      {/* ─── SCREEN / MONITOR on back wall ─── */}
      <group position={[4, 1.6, 5.55]}>
        {/* Bezel */}
        <mesh>
          <boxGeometry args={[2.8, 1.6, 0.06]} />
          <meshStandardMaterial color="#111" roughness={0.5} />
        </mesh>
        {/* Screen */}
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.6, 1.4]} />
          <meshStandardMaterial color="#0d1f35" emissive="#162d4a" emissiveIntensity={0.4} />
        </mesh>
        {/* Screen content - header bar */}
        <mesh position={[0, 0.55, 0.04]}>
          <boxGeometry args={[2.4, 0.08, 0.001]} />
          <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={1} transparent opacity={0.4} />
        </mesh>
        {/* Screen content - data lines */}
        {[-0.15, 0.05, 0.25].map((y, i) => (
          <mesh key={`scr-${i}`} position={[0, y, 0.04]}>
            <boxGeometry args={[1.8 - i * 0.3, 0.05, 0.001]} />
            <meshStandardMaterial color={i === 0 ? '#60a5fa' : i === 1 ? '#34d399' : '#fbbf24'} emissive={i === 0 ? '#60a5fa' : i === 1 ? '#34d399' : '#fbbf24'} emissiveIntensity={0.8} transparent opacity={0.35} />
          </mesh>
        ))}
        {/* Small green "LIVE" dot */}
        <mesh position={[1.1, 0.55, 0.04]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={2} />
        </mesh>
      </group>

      {/* ─── WHITEBOARD on left wall ─── */}
      <group position={[1.15, 1.6, 4.5]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <boxGeometry args={[1.6, 1.1, 0.04]} />
          <meshStandardMaterial color="#f5f5f0" roughness={0.3} />
        </mesh>
        {/* Frame */}
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[1.7, 1.2, 0.02]} />
          <meshStandardMaterial color="#555" />
        </mesh>
        {/* Marker lines */}
        {[0.25, 0.05, -0.15].map((y, i) => (
          <mesh key={`wb-${i}`} position={[-0.3, y, 0.025]}>
            <boxGeometry args={[0.8, 0.04, 0.001]} />
            <meshStandardMaterial color={i === 0 ? '#e74c3c' : i === 1 ? '#3498db' : '#f39c12'} />
          </mesh>
        ))}
      </group>

      {/* ─── DECORATIONS ─── */}
      {/* Plant in corner */}
      <Plant position={[6.5, 0, 5.2]} />
      {/* Water jug on table */}
      <mesh position={[5.5, 0.82, 3.2]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.12, 8]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.5} roughness={0.1} metalness={0.1} />
      </mesh>
      {/* Papers on table */}
      {[
        { pos: [3.2, 0.8, 2.8] as [number,number,number], rot: 0.1 },
        { pos: [3.4, 0.795, 3.1] as [number,number,number], rot: -0.15 },
        { pos: [3.1, 0.79, 3.3] as [number,number,number], rot: 0.25 },
      ].map((p, i) => (
        <mesh key={`paper-${i}`} position={p.pos} rotation={[-Math.PI/2, 0, p.rot]}>
          <planeGeometry args={[0.22, 0.3]} />
          <meshStandardMaterial color="#e8e8e0" roughness={0.9} />
        </mesh>
      ))}
      {/* Laptops on table (2) */}
      {[
        { pos: [3.0, 0.79, 3.5] as [number,number,number], rot: 0.2 },
        { pos: [5.0, 0.79, 2.5] as [number,number,number], rot: -0.3 },
      ].map((p, i) => (
        <group key={`laptop-${i}`} position={p.pos} rotation={[-Math.PI/2, 0, p.rot]}>
          <mesh>
            <boxGeometry args={[0.25, 0.16, 0.01]} />
            <meshStandardMaterial color="#222" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.08, -0.005]}>
            <planeGeometry args={[0.23, 0.14]} />
            <meshStandardMaterial color="#0a0f1a" emissive="#1a2a3a" emissiveIntensity={0.3} />
          </mesh>
        </group>
      ))}

      {/* ─── OVERHEAD LIGHT ─── */}
      <pointLight position={[4, 3.2, 3]} intensity={1.2} color="#e8f0ff" distance={8} decay={1.5} />
      {/* Second light for back of room */}
      <pointLight position={[4, 2.8, 5]} intensity={0.5} color="#f0f4ff" distance={5} decay={2} />

      {/* ─── FLOOR LABEL ─── */}
      <Text position={[4, 0.02, 5.3]} fontSize={0.1} color="rgba(255,255,255,0.25)" anchorX="center" anchorY="middle" rotation={[-Math.PI / 2, 0, 0]}>
        SALA DE REUNIONES
      </Text>
    </group>
  )
}

/* ═══════════════════ REST / BREAK ROOM ═════════════════ */
function RestRoom() {
  const tvRef = useRef<THREE.Mesh>(null)
  const gameScreenRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // TV color flicker
    if (tvRef.current) {
      const mat = tvRef.current.material as THREE.MeshStandardMaterial
      const hue = (Math.sin(t * 0.3) * 0.5 + 0.5) * 0.3
      mat.emissiveIntensity = 0.6 + Math.sin(t * 2) * 0.15
    }
    // Game screen pulse
    if (gameScreenRef.current) {
      const mat = gameScreenRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.8 + Math.sin(t * 4) * 0.2
    }
  })

  return (
    <group>
      {/* Rest room floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-5, 0.005, 3.8]} receiveShadow>
        <planeGeometry args={[6, 4.8]} />
        <meshStandardMaterial color="#222238" roughness={0.92} />
      </mesh>
      {/* Warmer area rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-5, 0.008, 3.8]}>
        <planeGeometry args={[5.5, 4.2]} />
        <meshStandardMaterial color="#262645" roughness={0.95} />
      </mesh>

      {/* ─── GLASS PARTITIONS ─── */}
      {/* Right partition (separates from main office) */}
      <mesh position={[-1.8, 1.5, 3.8]}>
        <boxGeometry args={[0.06, 3, 4.8]} />
        <meshStandardMaterial color="#88aacc" transparent opacity={0.08} roughness={0.05} metalness={0.4} />
      </mesh>
      <mesh position={[-1.8, 3, 3.8]}>
        <boxGeometry args={[0.08, 0.06, 4.8]} />
        <meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-1.8, 1.5, 1.4]}><boxGeometry args={[0.08, 3, 0.06]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[-1.8, 1.5, 6.2]}><boxGeometry args={[0.08, 3, 0.06]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>
      {/* Mid horizontal bar */}
      <mesh position={[-1.8, 1.5, 3.8]}><boxGeometry args={[0.08, 0.04, 4.8]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} transparent opacity={0.3} /></mesh>

      {/* Front partition (partial, with opening for entry) */}
      <mesh position={[-5.8, 1.5, 1.4]}>
        <boxGeometry args={[2.4, 3, 0.06]} />
        <meshStandardMaterial color="#88aacc" transparent opacity={0.08} roughness={0.05} metalness={0.4} />
      </mesh>
      <mesh position={[-5.8, 3, 1.4]}>
        <boxGeometry args={[2.4, 0.06, 0.08]} />
        <meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-4.6, 1.5, 1.4]}><boxGeometry args={[0.06, 3, 0.08]} /><meshStandardMaterial color="#445566" metalness={0.7} roughness={0.3} /></mesh>

      {/* ─── TV AREA ─── */}
      {/* TV stand / console */}
      <RoundedBox args={[2.2, 0.5, 0.4]} radius={0.03} position={[-5, 0.25, 5.6]} castShadow>
        <meshStandardMaterial color="#1a1a2e" roughness={0.6} metalness={0.2} />
      </RoundedBox>
      {/* TV Screen bezel */}
      <mesh position={[-5, 1.5, 5.7]} castShadow>
        <boxGeometry args={[2.6, 1.45, 0.07]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* TV display */}
      <mesh position={[-5, 1.5, 5.655]} ref={tvRef}>
        <planeGeometry args={[2.4, 1.28]} />
        <meshStandardMaterial color="#0a1628" emissive="#1a3050" emissiveIntensity={0.6} />
      </mesh>
      {/* TV content - landscape scene (colorful rectangles) */}
      <mesh position={[-5.3, 1.65, 5.66]}>
        <boxGeometry args={[1.2, 0.7, 0.001]} />
        <meshStandardMaterial color="#2563eb" emissive="#2563eb" emissiveIntensity={0.6} transparent opacity={0.25} />
      </mesh>
      <mesh position={[-4.6, 1.35, 5.66]}>
        <circleGeometry args={[0.35, 16]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.4} transparent opacity={0.2} />
      </mesh>
      <mesh position={[-5, 1.2, 5.66]}>
        <boxGeometry args={[2.0, 0.15, 0.001]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.3} transparent opacity={0.15} />
      </mesh>
      {/* TV glow */}
      <pointLight position={[-5, 1.5, 4.8]} intensity={0.6} color="#4488cc" distance={4} decay={2} />

      {/* ─── SOFA (facing TV) ─── */}
      <group position={[-5, 0, 3.2]}>
        {/* Sofa base */}
        <RoundedBox args={[2.4, 0.32, 0.75]} radius={0.06} position={[0, 0.22, 0]} castShadow>
          <meshStandardMaterial color="#2d1b4e" roughness={0.9} />
        </RoundedBox>
        {/* Sofa back */}
        <RoundedBox args={[2.4, 0.5, 0.15]} radius={0.04} position={[0, 0.5, -0.3]} castShadow>
          <meshStandardMaterial color="#2d1b4e" roughness={0.9} />
        </RoundedBox>
        {/* Left armrest */}
        <RoundedBox args={[0.15, 0.25, 0.75]} radius={0.04} position={[-1.15, 0.38, 0]} castShadow>
          <meshStandardMaterial color="#2d1b4e" roughness={0.9} />
        </RoundedBox>
        {/* Right armrest */}
        <RoundedBox args={[0.15, 0.25, 0.75]} radius={0.04} position={[1.15, 0.38, 0]} castShadow>
          <meshStandardMaterial color="#2d1b4e" roughness={0.9} />
        </RoundedBox>
        {/* Seat cushions */}
        <mesh position={[-0.45, 0.42, 0.03]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.5]} />
          <meshStandardMaterial color="#3a2560" roughness={0.95} />
        </mesh>
        <mesh position={[0.45, 0.42, 0.03]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.5]} />
          <meshStandardMaterial color="#3a2560" roughness={0.95} />
        </mesh>
        {/* Throw pillows */}
        <mesh position={[-0.85, 0.52, -0.1]} rotation={[0.1, 0.3, 0.2]}>
          <boxGeometry args={[0.2, 0.2, 0.08]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.95} />
        </mesh>
        <mesh position={[0.85, 0.52, -0.1]} rotation={[-0.1, -0.2, -0.15]}>
          <boxGeometry args={[0.2, 0.2, 0.08]} />
          <meshStandardMaterial color="#ef4444" roughness={0.95} />
        </mesh>
      </group>

      {/* Coffee table */}
      <RoundedBox args={[0.9, 0.04, 0.5]} radius={0.02} position={[-5, 0.35, 4.4]} castShadow>
        <meshStandardMaterial color="#1e1e30" roughness={0.4} metalness={0.3} />
      </RoundedBox>
      {[-0.35, 0.35].map((x, i) => (
        <mesh key={`ctl${i}`} position={[-5 + x, 0.18, 4.4]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
          <meshStandardMaterial color="#444" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      {/* Magazine on table */}
      <mesh position={[-5.15, 0.38, 4.35]} rotation={[-Math.PI/2, 0, 0.3]}>
        <planeGeometry args={[0.2, 0.28]} />
        <meshStandardMaterial color="#e74c3c" roughness={0.9} />
      </mesh>
      {/* Remote control */}
      <mesh position={[-4.85, 0.38, 4.4]} rotation={[-Math.PI/2, 0, -0.1]}>
        <boxGeometry args={[0.06, 0.15, 0.015]} />
        <meshStandardMaterial color="#222" roughness={0.7} />
      </mesh>

      {/* ─── GAMING AREA ─── */}
      {/* Gaming monitor on left wall */}
      <mesh position={[-7.55, 1.35, 4.8]}>
        <boxGeometry args={[0.07, 1.15, 1.65]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[-7.47, 1.35, 4.8]} ref={gameScreenRef}>
        <planeGeometry args={[1.45, 1.0]} />
        <meshStandardMaterial color="#0a1628" emissive="#0f2840" emissiveIntensity={0.8} />
      </mesh>
      {/* Game content on screen */}
      <mesh position={[-7.46, 1.5, 4.8]}>
        <boxGeometry args={[0.9, 0.45, 0.001]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.5} transparent opacity={0.2} />
      </mesh>
      <mesh position={[-7.46, 1.1, 4.5]}>
        <boxGeometry args={[0.35, 0.35, 0.001]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.4} transparent opacity={0.15} />
      </mesh>
      {/* Game screen glow */}
      <pointLight position={[-7.0, 1.35, 4.8]} intensity={0.5} color="#22c55e" distance={3.5} decay={2} />

      {/* Game console under screen */}
      <RoundedBox args={[0.32, 0.08, 0.24]} radius={0.02} position={[-7.1, 0.3, 4.8]} castShadow>
        <meshStandardMaterial color="#111" roughness={0.5} metalness={0.3} />
      </RoundedBox>
      {/* Console LED */}
      <mesh position={[-7.0, 0.35, 4.8]}>
        <sphereGeometry args={[0.012, 6, 6]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={4} />
      </mesh>
      {/* Controller on floor near bean bag */}
      <mesh position={[-5.8, 0.02, 5.0]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.16, 0.04, 0.1]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.7} />
      </mesh>
      <mesh position={[-5.72, 0.05, 5.0]}>
        <sphereGeometry args={[0.02, 6, 6]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[-5.88, 0.05, 5.0]}>
        <sphereGeometry args={[0.02, 6, 6]} />
        <meshStandardMaterial color="#333" />
      </mesh>

      {/* Bean bag chair */}
      <group position={[-6.3, 0, 4.8]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <sphereGeometry args={[0.38, 14, 10]} />
          <meshStandardMaterial color="#1e40af" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.95} />
        </mesh>
      </group>

      {/* ─── READING CORNER ─── */}
      {/* Armchair */}
      <group position={[-3.2, 0, 5.3]} rotation={[0, Math.PI + 0.5, 0]}>
        {/* Chair seat */}
        <RoundedBox args={[0.6, 0.28, 0.55]} radius={0.06} position={[0, 0.24, 0]} castShadow>
          <meshStandardMaterial color="#7c2d12" roughness={0.9} />
        </RoundedBox>
        {/* Backrest */}
        <RoundedBox args={[0.6, 0.45, 0.12]} radius={0.04} position={[0, 0.5, -0.22]} castShadow>
          <meshStandardMaterial color="#7c2d12" roughness={0.9} />
        </RoundedBox>
        {/* Armrests */}
        <RoundedBox args={[0.12, 0.2, 0.55]} radius={0.03} position={[-0.26, 0.38, 0]} castShadow>
          <meshStandardMaterial color="#7c2d12" roughness={0.9} />
        </RoundedBox>
        <RoundedBox args={[0.12, 0.2, 0.55]} radius={0.03} position={[0.26, 0.38, 0]} castShadow>
          <meshStandardMaterial color="#7c2d12" roughness={0.9} />
        </RoundedBox>
        {/* Cushion */}
        <mesh position={[0, 0.42, 0.02]} castShadow>
          <boxGeometry args={[0.4, 0.08, 0.35]} />
          <meshStandardMaterial color="#92400e" roughness={0.95} />
        </mesh>
      </group>

      {/* Floor lamp */}
      <group position={[-2.5, 0, 4.5]}>
        <mesh position={[0, 0.03, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.06, 12]} />
          <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.0, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 1.9, 6]} />
          <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 2.0, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.25, 0.3, 12, 1, true]} />
          <meshStandardMaterial color="#f5e6d0" roughness={0.8} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
        <pointLight position={[0, 1.8, 0]} intensity={0.7} color="#ffeedd" distance={4} decay={2} />
      </group>

      {/* Side table */}
      <RoundedBox args={[0.35, 0.04, 0.35]} radius={0.02} position={[-2.7, 0.4, 5.6]} castShadow>
        <meshStandardMaterial color="#3e2a1a" roughness={0.8} />
      </RoundedBox>
      <mesh position={[-2.7, 0.2, 5.6]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.36, 6]} />
        <meshStandardMaterial color="#444" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Open book on table */}
      <group position={[-2.7, 0.44, 5.58]} rotation={[-Math.PI/2, 0, 0.2]}>
        <mesh position={[-0.06, 0, 0]} rotation={[0, 0, -0.1]}>
          <boxGeometry args={[0.1, 0.14, 0.01]} />
          <meshStandardMaterial color="#fef3c7" roughness={0.8} />
        </mesh>
        <mesh position={[0.06, 0, 0]} rotation={[0, 0, 0.1]}>
          <boxGeometry args={[0.1, 0.14, 0.01]} />
          <meshStandardMaterial color="#fef9ee" roughness={0.8} />
        </mesh>
        {/* Text lines on pages */}
        {[-0.03, 0, 0.03].map((y, i) => (
          <mesh key={`rpt${i}`} position={[-0.06, y, 0.006]}>
            <boxGeometry args={[0.06, 0.005, 0.001]} />
            <meshStandardMaterial color="#666" transparent opacity={0.3} />
          </mesh>
        ))}
        {[-0.03, 0.01, 0.04].map((y, i) => (
          <mesh key={`rpt2${i}`} position={[0.06, y, 0.006]}>
            <boxGeometry args={[0.06, 0.005, 0.001]} />
            <meshStandardMaterial color="#666" transparent opacity={0.3} />
          </mesh>
        ))}
      </group>
      {/* Cup on table */}
      <mesh position={[-2.6, 0.44, 5.65]} castShadow>
        <cylinderGeometry args={[0.03, 0.025, 0.06, 8]} />
        <meshStandardMaterial color="#f5f5f0" roughness={0.5} />
      </mesh>
      <mesh position={[-2.6, 0.44, 5.65]}>
        <cylinderGeometry args={[0.025, 0.025, 0.01, 8]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>

      {/* ─── OVERHEAD LIGHTS ─── */}
      <pointLight position={[-5, 2.8, 3.8]} intensity={0.9} color="#ffeedd" distance={6} decay={1.5} />
      <pointLight position={[-3.5, 2.5, 5.2]} intensity={0.4} color="#f0e0cc" distance={4} decay={2} />
      <pointLight position={[-6.5, 2.5, 4.8]} intensity={0.3} color="#d0ffe0" distance={3} decay={2} />

      {/* ─── EXTRA REST SPOTS ─── */}
      {/* Floor cushion facing the TV */}
      <group position={[-5.8, 0, 4.0]}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.3, 0.14, 16]} />
          <meshStandardMaterial color="#7c2d92" roughness={0.9} />
        </mesh>
      </group>
      {/* Second gaming bean bag */}
      <group position={[-6.9, 0, 3.9]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <sphereGeometry args={[0.36, 14, 10]} />
          <meshStandardMaterial color="#0f766e" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.27, 0]}>
          <sphereGeometry args={[0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
          <meshStandardMaterial color="#115e59" roughness={0.95} />
        </mesh>
      </group>
      {/* Reading nook floor cushion near the plant */}
      <group position={[-7.0, 0, 5.0]}>
        <mesh position={[0, 0.07, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.32, 0.12, 16]} />
          <meshStandardMaterial color="#92400e" roughness={0.9} />
        </mesh>
      </group>

      {/* ─── DECORATIONS ─── */}
      <Plant position={[-7.3, 0, 5.8]} />
      {/* Cozy carpet under TV area */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-5, 0.01, 4.5]}>
        <planeGeometry args={[3.2, 2.2]} />
        <meshStandardMaterial color="#1a1a35" roughness={0.95} />
      </mesh>
      {/* Poster on right partition */}
      <mesh position={[-1.75, 1.8, 3.8]} rotation={[0, Math.PI/2, 0]}>
        <boxGeometry args={[0.5, 0.7, 0.01]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      <mesh position={[-1.73, 1.85, 3.8]} rotation={[0, Math.PI/2, 0]}>
        <planeGeometry args={[0.4, 0.55]} />
        <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.3} transparent opacity={0.4} />
      </mesh>

      {/* ─── FLOOR LABEL ─── */}
      <Text position={[-5, 0.02, 6.0]} fontSize={0.09} color="rgba(255,255,255,0.18)" anchorX="center" anchorY="middle" rotation={[-Math.PI / 2, 0, 0]}>
        SALA DE DESCANSO
      </Text>
    </group>
  )
}

/* ═══════════════════ MEETING CHAIR LAYOUT ═════════════════ */
const MEETING_CHAIRS: { pos: [number, number, number]; rot: number }[] = [
  // Left side (3 chairs, facing +X toward table)
  { pos: [2.0, 0, 2.1], rot: -Math.PI / 2 },
  { pos: [2.0, 0, 3.0], rot: -Math.PI / 2 },
  { pos: [2.0, 0, 3.9], rot: -Math.PI / 2 },
  // Right side (3 chairs, facing -X toward table)
  { pos: [6.0, 0, 2.1], rot: Math.PI / 2 },
  { pos: [6.0, 0, 3.0], rot: Math.PI / 2 },
  { pos: [6.0, 0, 3.9], rot: Math.PI / 2 },
  // Head of table (spokesperson, facing -Z toward others)
  { pos: [4, 0, 4.6], rot: Math.PI },
]

/* ═══════════════════ MEETING AGENT (walks + sits + talks) ═══════════════════ */
type MeetingPhase = 'walking' | 'seated' | 'discussing' | 'reporting' | 'returning' | 'idle'
function MeetingAgent({ agent, deskPos, meetingChair, phase, isSpokesperson, reportLines, onClick }: {
  agent: Agent3D; deskPos: [number, number, number]; meetingChair: { pos: [number, number, number]; rot: number }
  phase: MeetingPhase
  isSpokesperson: boolean; reportLines?: string[]; onClick?: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const posRef = useRef(new THREE.Vector3(deskPos[0], deskPos[1], deskPos[2]))
  const arrived = useRef(false)
  const talkOffset = useRef(Math.random() * Math.PI * 2)
  const brain = getBrain(agent.brain || 'claude-sonnet')

  const isWalking = phase === 'walking' || phase === 'returning'
  const isAtMeeting = phase === 'seated' || phase === 'discussing' || phase === 'reporting'
  const target = phase === 'returning'
    ? new THREE.Vector3(deskPos[0], deskPos[1], deskPos[2])
    : new THREE.Vector3(meetingChair.pos[0], meetingChair.pos[1], meetingChair.pos[2])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (!groupRef.current) return

    if (isWalking) {
      // Lerp toward target
      posRef.current.lerp(target, 0.018)
      groupRef.current.position.x = posRef.current.x
      groupRef.current.position.z = posRef.current.z
      // Walking bob
      groupRef.current.position.y = Math.abs(Math.sin(t * 8 * brain.speed)) * 0.04
      // Rotate toward target
      const dx = target.x - posRef.current.x
      const dz = target.z - posRef.current.z
      if (Math.abs(dx) > 0.3 || Math.abs(dz) > 0.3) {
        groupRef.current.rotation.y = Math.atan2(dx, dz)
      }
      arrived.current = false
    } else if (isAtMeeting) {
      // Snap to meeting chair
      groupRef.current.position.set(meetingChair.pos[0], 0, meetingChair.pos[2])
      groupRef.current.rotation.y = meetingChair.rot + Math.PI
      arrived.current = true
    } else {
      // Idle at desk
      groupRef.current.position.set(deskPos[0], 0, deskPos[2])
    }
  })

  // Determine what animation state to pass to AgentCharacter
  const effectiveStatus = isWalking ? 'working' : isAtMeeting ? (phase === 'reporting' && isSpokesperson ? 'working' : 'thinking') : agent.status

  return (
    <group ref={groupRef}>
      <AgentCharacter
        agent={agent}
        position={[0, 0, 0]}
        deskRotation={groupRef.current?.rotation.y || 0}
        onClick={onClick}
        scale={1.1}
      />
      {/* Speech bubble for spokesperson during reporting */}
      {isSpokesperson && phase === 'reporting' && reportLines && reportLines.length > 0 && (
        <Float speed={1.5} floatIntensity={0.1}>
          <Html
            position={[0, 1.8, 0]}
            center
            distanceFactor={8}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px',
              padding: '8px 14px', minWidth: '180px', maxWidth: '240px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontFamily: 'system-ui',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: getBrain(agent.brain || 'claude-sonnet').glow, boxShadow: `0 0 8px ${getBrain(agent.brain || 'claude-sonnet').glow}` }} />
                <span style={{ fontSize: '9px', fontWeight: 600, color: getBrain(agent.brain || 'claude-sonnet').glow, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {agent.name}
                </span>
              </div>
              {reportLines.map((line, i) => (
                <div key={i} style={{
                  fontSize: '10px', color: i === 0 ? '#fff' : 'rgba(255,255,255,0.7)',
                  lineHeight: '1.4', marginBottom: '2px',
                  animation: `fadeIn 0.3s ease ${i * 0.5}s both`,
                }}>
                  {line}
                </div>
              ))}
            </div>
          </Html>
        </Float>
      )}
      {/* Small talking indicators for other agents during discussion */}
      {!isSpokesperson && (phase === 'discussing' || phase === 'reporting') && (
        <group position={[0, 1.35, 0]}>
          <mesh>
            <sphereGeometry args={[0.03, 6, 6]} />
            <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={2} transparent opacity={0.7} />
          </mesh>
          <pointLight intensity={0.1} color="#fff" distance={0.5} decay={3} />
        </group>
      )}
    </group>
  )
}

/* ═══════════════════ REST POSITIONS ═════════════════ */
// 7 distinct spots — one per agent, so a full idle team never overlaps.
const REST_POSITIONS: { pos: [number, number, number]; rot: number; activity: 'tv' | 'reading' | 'gaming' }[] = [
  // TV sofa - 2 spots facing the TV, + 1 floor cushion in front
  { pos: [-5.4, 0, 3.2], rot: 0, activity: 'tv' },
  { pos: [-4.6, 0, 3.2], rot: 0, activity: 'tv' },
  { pos: [-5.8, 0, 4.0], rot: 0, activity: 'tv' },
  // Gaming - 2 bean bags facing left wall screen
  { pos: [-6.3, 0, 4.8], rot: -Math.PI / 2, activity: 'gaming' },
  { pos: [-6.9, 0, 3.9], rot: -Math.PI / 3, activity: 'gaming' },
  // Reading - armchair + a floor cushion nook
  { pos: [-3.2, 0, 5.3], rot: Math.PI + 0.5, activity: 'reading' },
  { pos: [-7.0, 0, 5.0], rot: Math.PI / 2, activity: 'reading' },
]

/* ═══════════════════ REST AGENT (walks to break room + does activities) ═══════════════════ */
function RestAgent({ agent, deskPos, restSpot, onClick }: {
  agent: Agent3D
  deskPos: [number, number, number]
  restSpot: { pos: [number, number, number]; rot: number; activity: 'tv' | 'reading' | 'gaming' }
  onClick?: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const posRef = useRef(new THREE.Vector3(deskPos[0], deskPos[1], deskPos[2]))
  const [isArrived, setIsArrived] = useState(false)
  const brain = getBrain(agent.brain || 'claude-sonnet')
  const target = useMemo(() => new THREE.Vector3(restSpot.pos[0], restSpot.pos[1], restSpot.pos[2]), [restSpot.pos])

  // Map activity to effective status for AgentCharacter animations
  const effectiveStatus =
    restSpot.activity === 'gaming' ? 'working' :
    restSpot.activity === 'reading' ? 'thinking' :
    'waiting' // TV watching = relaxed/waiting

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (!groupRef.current) return

    const dist = posRef.current.distanceTo(target)
    if (dist > 0.3) {
      // Walking to rest room
      posRef.current.lerp(target, 0.018)
      groupRef.current.position.x = posRef.current.x
      groupRef.current.position.z = posRef.current.z
      groupRef.current.position.y = Math.abs(Math.sin(t * 8 * brain.speed)) * 0.04
      const dx = target.x - posRef.current.x
      const dz = target.z - posRef.current.z
      if (Math.abs(dx) > 0.3 || Math.abs(dz) > 0.3) {
        groupRef.current.rotation.y = Math.atan2(dx, dz)
      }
      if (isArrived) setIsArrived(false)
    } else {
      // Arrived at rest spot
      groupRef.current.position.set(restSpot.pos[0], 0, restSpot.pos[2])
      groupRef.current.rotation.y = restSpot.rot
      if (!isArrived) setIsArrived(true)
    }
  })

  const activityLabels: Record<string, string> = {
    tv: 'Mirando TV',
    reading: 'Leyendo',
    gaming: 'Jugando',
  }

  return (
    <group ref={groupRef}>
      <AgentCharacter
        agent={{ ...agent, status: effectiveStatus }}
        position={[0, 0, 0]}
        deskRotation={groupRef.current?.rotation.y || restSpot.rot}
        onClick={onClick}
        scale={1.1}
      />

      {/* Activity-specific props */}
      {isArrived && restSpot.activity === 'reading' && (
        <group position={[0.12, 0.62, 0.12]} rotation={[0.4, 0, -0.2]}>
          <mesh>
            <boxGeometry args={[0.1, 0.14, 0.015]} />
            <meshStandardMaterial color="#3b82f6" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0.008]}>
            <boxGeometry args={[0.08, 0.1, 0.001]} />
            <meshStandardMaterial color="#fef3c7" />
          </mesh>
        </group>
      )}
      {isArrived && restSpot.activity === 'gaming' && (
        <group position={[0, 0.52, 0.15]} rotation={[-0.3, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.14, 0.05, 0.08]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.6} />
          </mesh>
          <mesh position={[-0.04, 0.035, 0]}>
            <sphereGeometry args={[0.022, 6, 6]} />
            <meshStandardMaterial color="#111" roughness={0.7} />
          </mesh>
          <mesh position={[0.04, 0.035, 0]}>
            <sphereGeometry args={[0.022, 6, 6]} />
            <meshStandardMaterial color="#111" roughness={0.7} />
          </mesh>
        </group>
      )}

      {/* Activity label */}
      {isArrived && (
        <Html
          position={[0, 1.6, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
            padding: '2px 8px', fontFamily: 'system-ui',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{
              fontSize: '8px',
              color: restSpot.activity === 'tv' ? '#60a5fa' :
                     restSpot.activity === 'gaming' ? '#4ade80' : '#fbbf24',
            }}>
              {restSpot.activity === 'tv' && '📺 '}
              {restSpot.activity === 'gaming' && '🎮 '}
              {restSpot.activity === 'reading' && '📖 '}
              {activityLabels[restSpot.activity]}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}

/* ═══════════════════ MAIN SCENE ═════════════════ */
export default function OfficeScene({
  agents, onAgentClick, meetingPhase = 'idle', spokespersonId, reportLines
}: {
  agents: Agent3D[]; onAgentClick?: (agent: Agent3D) => void
  meetingPhase?: string; spokespersonId?: string; reportLines?: string[]
}) {
  // Desk positions for up to 8 agents in an office layout
  const deskLayout: { pos: [number, number, number]; chair: [number, number, number]; rot: number }[] = useMemo(() => [
    // Back row (facing -z, agents face +z toward monitors)
    { pos: [-4.5, 0, -3.5], chair: [-4.5, 0, -2.7], rot: Math.PI },
    { pos: [-1.5, 0, -3.5], chair: [-1.5, 0, -2.7], rot: Math.PI },
    { pos: [1.5, 0, -3.5], chair: [1.5, 0, -2.7], rot: Math.PI },
    { pos: [4.5, 0, -3.5], chair: [4.5, 0, -2.7], rot: Math.PI },
    // Front row (facing +z, agents face -z toward monitors)
    { pos: [-3, 0, 0.5], chair: [-3, 0, -0.3], rot: 0 },
    { pos: [0, 0, 0.5], chair: [0, 0, -0.3], rot: 0 },
    { pos: [3, 0, 0.5], chair: [3, 0, -0.3], rot: 0 },
  ], [])

  // Idle agents periodically rotate through rest-room activities so they
  // feel like they have their own life instead of freezing in one spot.
  const [restRotation, setRestRotation] = useState(0)
  useEffect(() => {
    let cancelled = false
    const scheduleNext = () => {
      const delay = 25000 + Math.random() * 20000
      const timeout = setTimeout(() => {
        if (cancelled) return
        setRestRotation(r => r + 1 + Math.floor(Math.random() * 2))
        scheduleNext()
      }, delay)
      return timeout
    }
    const timeout = scheduleNext()
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [])

  return (
    <Canvas
      shadows
      camera={{ position: [0.5, 20, 0.5], fov: 38, near: 0.1, far: 100 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.6 }}
      style={{ background: '#0a0a16' }}
    >
      {/* Lighting - strong overhead for top-down feel */}
      <ambientLight intensity={0.7} color="#d0d8f0" />
      <directionalLight
        position={[0, 20, 3]}
        intensity={2}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={12}
        shadow-camera-bottom={-8}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
        shadow-bias={-0.002}
      />
      <directionalLight position={[8, 12, -5]} intensity={0.5} color="#8899cc" />
      <directionalLight position={[-8, 12, 5]} intensity={0.4} color="#cc9988" />
      <hemisphereLight args={['#b0c4de', '#1a1a2e', 0.3]} />

      {/* Controls - top-down overhead view */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 4}
        minAzimuthAngle={-Infinity}
        maxAzimuthAngle={Infinity}
        minDistance={8}
        maxDistance={35}
        target={[1, 0, -0.5]}
        autoRotate
        autoRotateSpeed={0.2}
      />

      {/* Office environment */}
      <OfficeFloor />
      <OfficeWalls />
      <MeetingRoom />
      <RestRoom />

      {/* Decorations */}
      <Plant position={[-7, 0, -4]} />
      <Plant position={[7, 0, -4]} />
      <Plant position={[-7, 0, 4]} />
      <Plant position={[6.5, 0, 4]} />
      <Bookshelf position={[-7.2, 0.8, 3]} rotation={Math.PI / 2} />
      <WaterCooler position={[7, 0, -2]} />

      {/* ═══ MEETING MODE ═══ */}
      {meetingPhase !== 'idle' ? (
        <>
          {/* Empty desks (no agents) */}
          {deskLayout.slice(0, agents.length).map((layout, i) => (
            <group key={`edesk${i}`}>
              <Desk position={layout.pos} rotation={layout.rot} status="idle" />
              <Chair position={layout.chair} rotation={layout.rot} />
            </group>
          ))}
          {/* Agents walking / sitting / talking */}
          {agents.map((agent, i) => {
            const layout = deskLayout[i % deskLayout.length]
            const mc = MEETING_CHAIRS[i % MEETING_CHAIRS.length]
            return (
              <MeetingAgent
                key={agent.id}
                agent={agent}
                deskPos={layout.chair}
                meetingChair={mc}
                phase={meetingPhase as MeetingPhase}
                isSpokesperson={agent.id === spokespersonId}
                reportLines={agent.id === spokespersonId ? reportLines : undefined}
                onClick={() => onAgentClick?.(agent)}
              />
            )
          })}
        </>
      ) : (
        <>
          {/* ═══ NORMAL MODE ═══ */}
          {agents.map((agent, i) => {
            const layout = deskLayout[i % deskLayout.length]
            const isIdle = agent.status === 'idle'

            if (isIdle) {
              // Calculate which rest spot this idle agent gets — rotates
              // over time (restRotation) so idle agents cycle through
              // different activities instead of freezing in one spot.
              const idleAgentsBefore = agents.slice(0, i).filter(a => a.status === 'idle').length
              const restSpot = REST_POSITIONS[(idleAgentsBefore + restRotation) % REST_POSITIONS.length]

              return (
                <group key={agent.id}>
                  {/* Empty desk where they should be */}
                  <Desk position={layout.pos} rotation={layout.rot} status="idle" />
                  <Chair position={layout.chair} rotation={layout.rot} />
                  {/* Agent walking to / resting in break room */}
                  <RestAgent
                    agent={agent}
                    deskPos={layout.chair}
                    restSpot={restSpot}
                    onClick={() => onAgentClick?.(agent)}
                  />
                </group>
              )
            }

            return (
              <Workstation
                key={agent.id}
                agent={agent}
                deskPos={layout.pos}
                chairPos={layout.chair}
                rotation={layout.rot}
                onClick={() => onAgentClick?.(agent)}
              />
            )
          })}

          {/* Empty desks for unused positions */}
          {agents.length < deskLayout.length && (
            <>
              {deskLayout.slice(agents.length).map((layout, i) => (
                <group key={`empty${i}`}>
                  <Desk position={layout.pos} rotation={layout.rot} status="idle" />
                  <Chair position={layout.chair} rotation={layout.rot} />
                </group>
              ))}
            </>
          )}
        </>
      )}
    </Canvas>
  )
}