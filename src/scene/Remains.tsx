import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { IcosahedronGeometry, LatheGeometry, MeshBasicMaterial, Vector2, type Group, type Mesh } from 'three';
import type { Color, PieceType } from '../engine';
import { featureParts } from './pieceGeometry';
import { fragmentsOf, simulateShatter, type ShatterRun } from './shatter';

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

/**
 * What is left of a shattered piece on the board: the piece itself in chunks (shatter.ts), burst
 * apart by the physics and lying where they came to rest, for the rest of the game. Placed in a
 * group at the square's centre `center` (world). With `burst` (from performance.now() ms `start`)
 * the burst plays; without, they simply lie there. Nothing shows until the physics is ready.
 */
export function ShardScatter({ type, color, id, center, burst }: { type: PieceType; color: Color; id: string; center: [number, number, number]; burst?: { start: number } | null }) {
  const fragments = useMemo(() => fragmentsOf(type), [type]);
  const [cx, cy, cz] = center;
  const [run, setRun] = useState<ShatterRun | null>(null);
  useEffect(() => {
    let alive = true;
    simulateShatter(type, id, [cx, cy, cz])
      .then((r) => alive && setRun(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [type, id, cx, cy, cz]);
  const refs = useRef<(Mesh | null)[]>([]);
  const look = LOOK[color];

  useFrame(() => {
    if (!run) return;
    const t = burst ? (performance.now() - burst.start) / 1000 : Infinity;
    const step = t < 0 ? -1 : Math.min(run.steps - 1, Math.floor(t / run.dt));
    run.tracks.forEach((f, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.visible = step >= 0;
      if (step < 0) return;
      const k = step * 7;
      m.position.set(f[k] - cx, f[k + 1] - cy, f[k + 2] - cz);
      m.quaternion.set(f[k + 3], f[k + 4], f[k + 5], f[k + 6]);
    });
  });

  if (!run) return null;
  return (
    <group>
      {fragments.map((f, i) => (
        <mesh
          key={i}
          ref={(m) => void (refs.current[i] = m)}
          geometry={f.geometry}
          visible={false}
          castShadow
          receiveShadow
          // Only to look at: clicks go through to the square underneath.
          raycast={() => null}
        >
          <meshPhysicalMaterial color={f.accent ? look.accent : look.body} roughness={0.38} clearcoat={0.5} flatShading />
        </mesh>
      ))}
    </group>
  );
}

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
