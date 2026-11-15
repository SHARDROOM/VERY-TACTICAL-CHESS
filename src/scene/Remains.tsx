import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DodecahedronGeometry, IcosahedronGeometry, LatheGeometry, MeshBasicMaterial, TetrahedronGeometry, Vector2, type BufferGeometry, type Group, type Mesh } from 'three';
import type { Color, PieceType } from '../engine';
import { featureParts } from './pieceGeometry';

/*
 * What is left of a piece beside the board after a staged exit (docs/SPEC.md, "GM 연출"):
 * a heap of ash or of shards, each with the piece's telling part on top so you can still see
 * what it was, and a thread of smoke over a burnt piece.
 */

const LOOK = {
  white: { body: '#efe5cf', accent: '#5a4632' },
  black: { body: '#2e2b31', accent: '#b89a5e' },
} as const;

/** A small seeded random, so a pile looks the same on every screen and after a reload. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const MOUND = new LatheGeometry(
  [[0, 0], [0.4, 0], [0.37, 0.04], [0.28, 0.1], [0.16, 0.15], [0.06, 0.17], [0, 0.175]].map(([r, h]) => new Vector2(r, h)),
  40,
);

/** The telling part, lying tilted on a heap. */
function Feature({ type, color, tint, y, tilt }: { type: PieceType; color: Color; tint: string | null; y: number; tilt: number }) {
  const look = LOOK[color];
  return (
    <group position={[0.04, y, -0.02]} rotation={[tilt, 0.6, tilt * 0.6]}>
      {featureParts(type).map((part, i) => (
        <mesh key={i} geometry={part.geometry} position={part.position} rotation={part.rotation} castShadow>
          <meshStandardMaterial color={tint ?? (part.accent ? look.accent : look.body)} roughness={tint ? 1 : 0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** A grey heap of ash with the piece's telling part sticking out, sooty. */
export function AshPile({ type, color, id }: { type: PieceType; color: Color; id: string }) {
  const rand = useMemo(() => seeded(id), [id]);
  const flecks = useMemo(() => Array.from({ length: 10 }, () => ({ x: (rand() - 0.5) * 0.7, z: (rand() - 0.5) * 0.7, s: 0.02 + rand() * 0.03 })), [rand]);
  const ash = color === 'white' ? '#8d867e' : '#4a4541';
  return (
    <group>
      <mesh geometry={MOUND} castShadow receiveShadow>
        <meshStandardMaterial color={ash} roughness={1} />
      </mesh>
      {flecks.map((f, i) => (
        <mesh key={i} position={[f.x, f.s * 0.5, f.z]} geometry={FLECK}>
          <meshStandardMaterial color={i % 3 ? ash : '#2b2622'} roughness={1} />
        </mesh>
      ))}
      <Feature type={type} color={color} tint={color === 'white' ? '#9c948b' : '#2e2a27'} y={0.08} tilt={0.55} />
    </group>
  );
}

const FLECK = new IcosahedronGeometry(1, 0).scale(0.03, 0.02, 0.03);

const SHARD_SHAPES: BufferGeometry[] = [new TetrahedronGeometry(1, 0), new DodecahedronGeometry(1, 0), new IcosahedronGeometry(1, 0)];

interface Shard {
  geometry: BufferGeometry;
  scale: [number, number, number];
  pile: [number, number, number];
  rotation: [number, number, number];
  burst: [number, number, number];
  accent: boolean;
}

/**
 * A heap of shards with the telling part on top. With `flight`, it first bursts from the
 * piece's square and the shards fly together to the heap (`offset` is from the square to the
 * heap; the group stands on the square until the flight is over).
 */
export function ShardPile({ type, color, id, flight }: { type: PieceType; color: Color; id: string; flight?: { offset: [number, number, number]; start: number; scale: number } | null }) {
  const shards = useMemo<Shard[]>(() => {
    const rand = seeded(`${id}-shards`);
    return Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + rand();
      const r = 0.1 + rand() * 0.22;
      const s = 0.05 + rand() * 0.05;
      return {
        geometry: SHARD_SHAPES[i % SHARD_SHAPES.length],
        scale: [s * (0.8 + rand() * 0.6), s * (0.6 + rand() * 0.5), s * (0.8 + rand() * 0.6)],
        pile: [Math.cos(a) * r, s * 0.6 + (r < 0.18 ? 0.05 : 0), Math.sin(a) * r],
        rotation: [rand() * 3, rand() * 3, rand() * 3],
        burst: [Math.cos(a) * (0.9 + rand()), 1.4 + rand() * 1.4, Math.sin(a) * (0.9 + rand())],
        accent: i % 4 === 3,
      };
    });
  }, [id]);
  const refs = useRef<(Mesh | null)[]>([]);
  const feature = useRef<Group>(null);
  const look = LOOK[color];

  useFrame(() => {
    const f = flight;
    const t = f ? (performance.now() - f.start) / 1000 : Infinity;
    shards.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      if (!f || t >= SHATTER_SECONDS) {
        m.position.set(...s.pile);
        m.scale.set(...s.scale);
        m.rotation.set(...s.rotation);
        return;
      }
      if (t < 0) {
        m.scale.setScalar(0.0001);
        return;
      }
      // Burst out from the square, then gather and fly to the heap.
      const tb = Math.min(t, 0.45);
      const bx = s.burst[0] * tb;
      const bz = s.burst[2] * tb;
      const by = Math.max(0.04, 0.45 + s.burst[1] * tb - 4.9 * tb * tb);
      if (t < 0.55) {
        m.position.set(bx, by, bz);
        m.scale.set(...s.scale);
        m.rotation.set(s.rotation[0] + t * 9, s.rotation[1] + t * 7, s.rotation[2]);
        return;
      }
      const q = Math.min(1, (t - 0.55) / (SHATTER_SECONDS - 0.55));
      const e = q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
      const k = f.scale;
      m.position.set(
        bx + (f.offset[0] + s.pile[0] * k - bx) * e,
        by + (f.offset[1] + s.pile[1] * k - by) * e + Math.sin(Math.PI * q) * 1.1,
        bz + (f.offset[2] + s.pile[2] * k - bz) * e,
      );
      const sc = 1 + (k - 1) * e;
      m.scale.set(s.scale[0] * sc, s.scale[1] * sc, s.scale[2] * sc);
      m.rotation.set(s.rotation[0] + t * 9, s.rotation[1] + t * 7, s.rotation[2]);
    });
    // The telling part rides along with the shards.
    const g = feature.current;
    if (g) {
      if (!f || t >= SHATTER_SECONDS) {
        g.position.set(0, 0, 0);
        g.scale.setScalar(1);
      } else if (t < 0) g.scale.setScalar(0.0001);
      else {
        const q = Math.max(0, Math.min(1, (t - 0.55) / (SHATTER_SECONDS - 0.55)));
        const e = q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
        const tb = Math.min(t, 0.45);
        const by = Math.max(0, 0.6 + 1.6 * tb - 4.9 * tb * tb);
        g.position.set(f.offset[0] * e, by + (f.offset[1] - by) * e + Math.sin(Math.PI * q) * 1.2, f.offset[2] * e);
        g.scale.setScalar(1 + (f.scale - 1) * e);
      }
    }
  });

  return (
    <group>
      {shards.map((s, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} geometry={s.geometry} position={s.pile} scale={s.scale} rotation={s.rotation} castShadow>
          <meshPhysicalMaterial color={s.accent ? look.accent : look.body} roughness={0.35} clearcoat={0.5} flatShading />
        </mesh>
      ))}
      <group ref={feature}>
        <Feature type={type} color={color} tint={null} y={0.1} tilt={0.9} />
      </group>
    </group>
  );
}

/** Seconds a shattering takes: the burst on the square and the flight to the heap. */
export const SHATTER_SECONDS = 1.4;

const PUFF = new IcosahedronGeometry(1, 1);

/** A thin thread of smoke rising from `follow` (a burnt piece). */
export function SmokeWisp({ follow, height }: { follow: React.RefObject<Group | null>; height: number }) {
  const ref = useRef<Group>(null);
  const puffs = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ phase: i / 7, drift: (i % 2 ? 1 : -1) * 0.04, mat: new MeshBasicMaterial({ color: '#6b625a', transparent: true, depthWrite: false }) })), []);
  useFrame(() => {
    const g = ref.current;
    const src = follow.current;
    if (!g || !src) return;
    g.position.copy(src.position);
    g.position.y += height * src.scale.y * 0.5;
    const now = performance.now() / 1000;
    g.children.forEach((c, i) => {
      const p = puffs[i];
      const t = (now * 0.28 + p.phase) % 1;
      c.position.set(Math.sin(now * 1.3 + i) * p.drift + t * 0.06, t * 0.9, Math.cos(now + i) * p.drift * 0.6);
      c.scale.setScalar(0.035 + t * 0.09);
      p.mat.opacity = 0.32 * Math.sin(Math.PI * t);
    });
  });
  return (
    <group ref={ref}>
      {puffs.map((p, i) => (
        <mesh key={i} geometry={PUFF} material={p.mat} />
      ))}
    </group>
  );
}
