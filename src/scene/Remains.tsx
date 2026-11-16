import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DodecahedronGeometry, IcosahedronGeometry, LatheGeometry, MeshBasicMaterial, TetrahedronGeometry, Vector2, type BufferGeometry, type Group, type Mesh } from 'three';
import type { Color, PieceType } from '../engine';
import { featureParts } from './pieceGeometry';

/*
 * What is left of a piece after a staged exit (docs/SPEC.md, "GM 연출"): beside the board a
 * heap of ash (with the piece's telling part on top so you can still see what it was) and a
 * thread of smoke over a burnt piece; for a shattered piece its shards strewn on the board and
 * only its telling part beside it.
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

/** One shard of a shattered piece, lying where it came to rest around its square. */
interface Shard {
  geometry: BufferGeometry;
  scale: [number, number, number];
  /** Where it rests, from the square's centre (on the board, y = half its thickness). */
  rest: [number, number, number];
  rotation: [number, number, number];
  /** Seconds in the air, how high it flies and how much it spins on the way. */
  flight: number;
  lift: number;
  spin: [number, number, number];
  accent: boolean;
}

/** The board's half width: shards that would fly off it stop at its edge. */
const BOARD_EDGE = 3.95;

/**
 * What is left of a shattered piece on its square: shards strewn around it, a few spilling into
 * the squares next door, lying there for the rest of the game (docs/SPEC.md, "부서진 조각").
 * Placed at the square's centre (`center`, in world units, to keep them on the board). With
 * `start` (performance.now() ms), they first burst out of the piece and rain down; without, they
 * simply lie there. Seeded by the piece's id, so every screen strews them alike.
 */
export function ShardScatter({ color, id, center, burst }: { color: Color; id: string; center: [number, number, number]; burst?: { start: number; from: [number, number, number] } | null }) {
  const shards = useMemo<Shard[]>(() => {
    const rand = seeded(`${id}-strewn`);
    return Array.from({ length: 16 }, (_, i) => {
      const big = i < 4;
      const s = big ? 0.1 + rand() * 0.05 : 0.05 + rand() * 0.055;
      const a = rand() * Math.PI * 2;
      const r = (big ? 0.05 : 0.12) + rand() ** 0.8 * (big ? 0.25 : 0.62);
      const x = Math.max(-BOARD_EDGE - center[0], Math.min(BOARD_EDGE - center[0], Math.cos(a) * r));
      const z = Math.max(-BOARD_EDGE - center[2], Math.min(BOARD_EDGE - center[2], Math.sin(a) * r));
      const flat = 0.35 + rand() * 0.3;
      return {
        geometry: SHARD_SHAPES[i % SHARD_SHAPES.length],
        scale: [s * (0.9 + rand() * 0.6), s * flat, s * (0.8 + rand() * 0.6)],
        rest: [x, s * flat * 0.8, z],
        // Lying flat-ish, turned every which way.
        rotation: [(rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5],
        flight: 0.5 + rand() * 0.35,
        lift: 0.25 + rand() * 0.55,
        spin: [(rand() - 0.5) * 18, (rand() - 0.5) * 14, (rand() - 0.5) * 18],
        accent: i % 4 === 3,
      };
    });
  }, [id, center[0], center[2]]);
  const refs = useRef<(Mesh | null)[]>([]);
  const look = LOOK[color];

  useFrame(() => {
    const t = burst ? (performance.now() - burst.start) / 1000 : Infinity;
    const [ox, oy, oz] = burst?.from ?? [0, 0, 0];
    shards.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      if (t < 0) {
        m.scale.setScalar(0.0001);
        return;
      }
      m.scale.set(...s.scale);
      if (t >= s.flight + BOUNCE) {
        m.position.set(...s.rest);
        m.rotation.set(...s.rotation);
        return;
      }
      if (t < s.flight) {
        // Out of the piece's body (about where its middle was), up and down onto the board.
        const u = t / s.flight;
        const out = 1 - (1 - u) ** 2;
        const y = (oy + 0.45) * (1 - u) + s.rest[1] * u + 4 * s.lift * u * (1 - u);
        const w = (1 - u) ** 2;
        m.position.set(ox + (s.rest[0] - ox) * out, y, oz + (s.rest[2] - oz) * out);
        m.rotation.set(s.rotation[0] + s.spin[0] * w, s.rotation[1] + s.spin[1] * w, s.rotation[2] + s.spin[2] * w);
        return;
      }
      // A little skip where it lands.
      const b = (t - s.flight) / BOUNCE;
      m.position.set(s.rest[0], s.rest[1] + 0.04 * Math.sin(Math.PI * b) * (s.lift + 0.3), s.rest[2]);
      m.rotation.set(...s.rotation);
    });
  });

  return (
    <group>
      {shards.map((s, i) => (
        <mesh
          key={i}
          ref={(m) => void (refs.current[i] = m)}
          geometry={s.geometry}
          position={s.rest}
          scale={s.scale}
          rotation={s.rotation}
          castShadow
          // Only to look at: clicks go through to the square underneath.
          raycast={() => null}
        >
          <meshPhysicalMaterial color={s.accent ? look.accent : look.body} roughness={0.35} clearcoat={0.5} flatShading />
        </mesh>
      ))}
    </group>
  );
}

const BOUNCE = 0.18;

/** What stands beside the board for a shattered piece: just its telling part, lying on its side. */
export function Relic({ type, color }: { type: PieceType; color: Color }) {
  return <Feature type={type} color={color} tint={null} y={0.06} tilt={1.2} />;
}

/** Seconds a shattering takes on screen: the shards strewn on the board, the telling part set beside it. */
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
