import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { IcosahedronGeometry, LatheGeometry, MeshBasicMaterial, Quaternion, Vector2, Vector3, type Group, type Mesh } from 'three';
import type { Color, PieceType } from '../engine';
import { featureParts } from './pieceGeometry';
import { fragmentsOf, simulateChunkThrow, simulateShatter } from './shatter';
import { CHUNK, addChunk, chunkKey, chunkPose, chunkWaiting, chunksOf, getChunk, playChunk, removeChunks, type Chunk } from './debris';
import { newSeed, onToy, poseOf, readPose, tellToy } from './toys';
import type { Pose } from '../session/toy';
import { Fling, carryPoint, tableObstacles, useTable } from './tableDrag';

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
 * What is left of a shattered piece: the piece itself in chunks (shatter.ts), burst apart by the
 * physics, bouncing off the pieces around, and lying where they came to rest for the rest of the
 * game, in the chunk registry (debris.ts): pieces moving past push them about, and the player can
 * drag and throw them. The square's centre is `center` (world); with `burst` (from
 * performance.now() ms `start`) the burst plays, without it they just lie there. Drawn in world
 * space. A tap on a chunk goes through to the square under it.
 */
export function ShardScatter({ type, color, id, center, square, burst }: {
  type: PieceType;
  color: Color;
  id: string;
  center: [number, number, number];
  square: number;
  burst?: { start: number } | null;
}) {
  const fragments = useMemo(() => fragmentsOf(type), [type]);
  const table = useTable();
  const [cx, cy, cz] = center;
  const [ready, setReady] = useState(() => chunksOf(id).length > 0);
  useEffect(() => {
    // Already lying about (shown before): they stay where they are.
    if (chunksOf(id).length) return setReady(true);
    let alive = true;
    simulateShatter(type, id, [cx, cy, cz], table ? tableObstacles(table, { square }) : undefined)
      .then((run) => {
        if (!alive) return;
        if (!chunksOf(id).length) {
          fragments.forEach((f, i) => {
            const frames = run.tracks[i];
            if (!frames) return;
            const c = { key: chunkKey(id, i), pieceId: id, index: i, hull: f.hull, p: new Vector3(), q: new Quaternion() };
            playChunk(c, frames, run.steps, run.dt, burst?.start ?? 0);
            addChunk(c);
          });
        }
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // The burst's moment is read once, when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, cx, cy, cz]);
  const refs = useRef<(Mesh | null)[]>([]);
  const look = LOOK[color];
  const drag = useRef<{ key: string; x: number; y: number; moved: boolean; fling: Fling } | null>(null);
  /** Where another screen is carrying a chunk (it is eased there). */
  const carried = useRef(new Map<string, { p: Vector3; q: Quaternion }>());

  /** Lets a chunk go from where it is held: it falls, or flies as thrown, and comes to rest. */
  const drop = (c: Chunk, velocity: Vector3, seed: number, final?: Pose) => {
    const from = { p: c.p.clone(), q: c.q.clone() };
    return simulateChunkThrow(c.hull, from.p, from.q, velocity, seed, table ? tableObstacles(table, { chunkKey: c.key }) : undefined)
      .then((run) => {
        c.held = false;
        playChunk(c, run.tracks[0], run.steps, run.dt, performance.now());
        // Thrown on another screen: it ends where that screen says, whatever small difference ours made.
        if (final) readPose(final, c.p, c.q);
        return { from, run };
      })
      .catch(() => {
        c.held = false;
        return null;
      });
  };

  // Other screens playing with these chunks.
  useEffect(() => {
    if (!ready) return;
    const offs = fragments.map((_, i) => {
      const key = chunkKey(id, i);
      return onToy(CHUNK + key, (op) => {
        const c = getChunk(key);
        if (!c) return;
        if (op.op === 'hold') {
          c.held = true;
          c.track = undefined;
          const at = carried.current.get(key) ?? { p: c.p.clone(), q: c.q.clone() };
          readPose(op.pose, at.p, at.q);
          carried.current.set(key, at);
          return;
        }
        carried.current.delete(key);
        c.held = true;
        readPose(op.pose, c.p, c.q);
        void drop(c, new Vector3(...op.velocity), op.seed, op.final);
      });
    });
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id, fragments]);

  useFrame(() => {
    if (!ready) return;
    const now = performance.now();
    fragments.forEach((_, i) => {
      const m = refs.current[i];
      const c = getChunk(chunkKey(id, i));
      if (!m) return;
      m.visible = !!c && !chunkWaiting(c, now);
      if (!c || !m.visible) return;
      const away = carried.current.get(c.key);
      if (away && c.held) {
        c.p.lerp(away.p, 0.3);
        c.q.slerp(away.q, 0.3);
      }
      if (c.held) {
        m.position.copy(c.p);
        m.quaternion.copy(c.q);
      } else chunkPose(c, now, m.position, m.quaternion);
    });
  });

  if (!ready) return null;
  const down = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    const c = getChunk(chunkKey(id, i));
    // Still flying (its burst, a shove), or in someone else's hand: it cannot be caught.
    if (!c || c.held || (c.track && performance.now() < c.track.start + c.track.steps * c.track.dt * 1000)) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    table?.hold(true);
    drag.current = { key: c.key, x: e.clientX, y: e.clientY, moved: false, fling: new Fling() };
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    const c = d && getChunk(d.key);
    if (!d || !c) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    c.held = true;
    if (carryPoint(e.ray, TMP_P, table?.board())) {
      c.p.copy(TMP_P);
      d.fling.add(TMP_P);
      tellToy({ op: 'hold', id: CHUNK + c.key, pose: poseOf(c.p, c.q) });
    }
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    drag.current = null;
    table?.hold(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const c = d && getChunk(d.key);
    if (!d || !c || !d.moved) return;
    const velocity = d.fling.velocity();
    const seed = newSeed();
    void drop(c, velocity, seed).then((done) => {
      if (!done) return;
      const k = (done.run.steps - 1) * 7;
      const f = done.run.tracks[0];
      tellToy({
        op: 'drop',
        id: CHUNK + c.key,
        pose: poseOf(done.from.p, done.from.q),
        velocity: [velocity.x, velocity.y, velocity.z],
        seed,
        final: poseOf(new Vector3(f[k], f[k + 1], f[k + 2]), new Quaternion(f[k + 3], f[k + 4], f[k + 5], f[k + 6])),
      });
    });
  };
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
          onPointerDown={down(i)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <meshPhysicalMaterial color={f.accent ? look.accent : look.body} roughness={0.38} clearcoat={0.5} flatShading />
        </mesh>
      ))}
    </group>
  );
}

const TMP_P = new Vector3();

/** Seconds the chunks of a revived piece take to fly back together. */
export const GATHER_SECONDS = 1.0;

/**
 * A shattered piece revived: its chunks fly back from wherever they lie and fit together again
 * on `to` (world), turned `turn` about the vertical; then they are gone and the piece stands there.
 * From performance.now() ms `start`, over `seconds`.
 */
export function ShardGather({ type, color, id, to, turn, start, seconds }: {
  type: PieceType;
  color: Color;
  id: string;
  to: [number, number, number];
  turn: number;
  start: number;
  seconds: number;
}) {
  const fragments = useMemo(() => fragmentsOf(type), [type]);
  // Where each chunk is now (taken out of the registry: from here on they are this piece's again).
  const from = useMemo(() => {
    const now = performance.now();
    const out = fragments.map((f, i) => {
      const c = getChunk(chunkKey(id, i));
      const p = new Vector3();
      const q = new Quaternion();
      if (c) chunkPose(c, now, p, q);
      else p.set(to[0] + f.center[0] * 3, to[1], to[2] + f.center[2] * 3);
      return { p, q };
    });
    removeChunks(id);
    return out;
  }, [id, fragments, to]);
  const targets = useMemo(() => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn);
    return fragments.map((f) => ({ p: new Vector3(...f.center).applyQuaternion(q).add(new Vector3(...to)), q }));
  }, [fragments, to, turn]);
  const refs = useRef<(Mesh | null)[]>([]);
  const look = LOOK[color];

  useFrame(() => {
    const t = (performance.now() - start) / 1000;
    fragments.forEach((_, i) => {
      const m = refs.current[i];
      if (!m) return;
      // Each sets off a moment after the last, and they all click into place together.
      const begin = (i / fragments.length) * 0.25 * seconds;
      const u = Math.max(0, Math.min(1, (t - begin) / (seconds * 0.85 - begin)));
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      m.visible = t < seconds * 0.9;
      m.position.lerpVectors(from[i].p, targets[i].p, e);
      m.position.y += Math.sin(Math.PI * e) * (0.6 + 0.08 * i);
      m.quaternion.slerpQuaternions(from[i].q, targets[i].q, e);
    });
  });

  return (
    <group>
      {fragments.map((f, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} geometry={f.geometry} castShadow raycast={() => null}>
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
