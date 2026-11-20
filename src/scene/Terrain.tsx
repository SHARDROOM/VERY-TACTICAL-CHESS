import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, CanvasTexture, CircleGeometry, DodecahedronGeometry, RingGeometry, SRGBColorSpace, type Group } from 'three';
import { COVER_NAME, buildingLook, type Building, type Prop, type Square, type TerrainCell, type TerrainCover, type TerrainKind } from '../engine';
import { squareToWorld } from './coords';
import { TurnBadges, type Chip } from './TagEffects';
import { PropMesh } from './PropMesh';

/*
 * Walls and pits on the board (docs/SPEC.md, "지형"). A wall rises out of its square and sinks
 * back when it goes; a pit opens like a hole in the board and closes again. Each shows the
 * turns it has left.
 */

const WALL_HEIGHT = 0.62;
const RISE_SECONDS = 0.9;
const GONE_SECONDS = 0.7;
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** A small seeded random, so every screen builds the same wall. */
function seeded(n: number): () => number {
  let h = 2166136261 ^ n;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const STONE = new BoxGeometry(1, 1, 1);

/** Three courses of dry-laid stones, offset like masonry, with a cap on top. */
function Wall({ at }: { at: Square }) {
  const stones = useMemo(() => {
    const rand = seeded(at * 7919 + 13);
    const out: { pos: [number, number, number]; size: [number, number, number]; rot: number; shade: string }[] = [];
    const course = WALL_HEIGHT / 3;
    for (let row = 0; row < 3; row++) {
      const split = row % 2 ? [-0.23, 0.23] : [-0.3, 0.12, 0.38];
      const widths = row % 2 ? [0.45, 0.45] : [0.3, 0.48, 0.16];
      split.forEach((x, i) => {
        const shade = ['#8b8278', '#7c746b', '#958c80', '#6f6860'][Math.floor(rand() * 4)];
        out.push({
          pos: [x, course * row + course / 2, (rand() - 0.5) * 0.03],
          size: [widths[i] - 0.03, course - 0.025, 0.86 - rand() * 0.06],
          rot: (rand() - 0.5) * 0.06,
          shade,
        });
      });
    }
    return out;
  }, [at]);
  return (
    <group>
      {stones.map((s, i) => (
        <mesh key={i} geometry={STONE} position={s.pos} scale={s.size} rotation={[0, s.rot, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={s.shade} roughness={0.95} />
        </mesh>
      ))}
      <mesh geometry={STONE} position={[0, WALL_HEIGHT + 0.03, 0]} scale={[0.94, 0.06, 0.92]} castShadow receiveShadow>
        <meshStandardMaterial color="#a39a8d" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** The dark of a hole: black in the middle, earth at the rim. */
function holeTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#020101');
  g.addColorStop(0.55, '#070504');
  g.addColorStop(0.82, '#1c130d');
  g.addColorStop(1, '#3a2a1c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let hole: CanvasTexture | null = null;
const HOLE = new CircleGeometry(0.43, 40);
const RIM = new RingGeometry(0.41, 0.5, 40);
const CLOD = new DodecahedronGeometry(1, 0);

/** A hole in the board with a ring of broken earth around it. */
function Pit({ at }: { at: Square }) {
  hole ??= holeTexture();
  const clods = useMemo(() => {
    const rand = seeded(at * 104729 + 7);
    return Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.5;
      const r = 0.44 + rand() * 0.05;
      const s = 0.035 + rand() * 0.035;
      return { pos: [Math.cos(a) * r, s * 0.5, Math.sin(a) * r] as [number, number, number], s, rot: rand() * 3 };
    });
  }, [at]);
  return (
    <group>
      <mesh geometry={HOLE} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <meshBasicMaterial map={hole} />
      </mesh>
      <mesh geometry={RIM} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <meshStandardMaterial color="#4a3626" roughness={1} />
      </mesh>
      {clods.map((c, i) => (
        <mesh key={i} geometry={CLOD} position={c.pos} scale={c.s} rotation={[c.rot, c.rot * 2, 0]} castShadow>
          <meshStandardMaterial color={i % 2 ? '#5b4330' : '#6e5440'} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

interface Shown {
  cell: TerrainCell;
  /** performance.now() when it appeared or (if `gone`) started to go. */
  since: number;
  gone: boolean;
  /** Already there when the scene opened: no rising. */
  still: boolean;
}

/** One wall or pit, rising or opening when it comes and sinking or closing when it goes. */
function TerrainPiece({ shown }: { shown: Shown }) {
  const ref = useRef<Group>(null);
  const { cell } = shown;
  const [x, , z] = squareToWorld(cell.at);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = (performance.now() - shown.since) / 1000;
    if (cell.kind === 'wall') {
      // Up out of the board with a little overshoot and rumble; down again when it goes.
      const q = shown.gone ? 1 - Math.min(1, t / GONE_SECONDS) : shown.still ? 1 : Math.min(1, Math.max(0, t / RISE_SECONDS));
      const lift = shown.gone ? q * q : easeOutBack(q);
      g.position.set(x + (q < 1 && !shown.gone ? Math.sin(t * 60) * 0.015 * (1 - q) : 0), -(WALL_HEIGHT + 0.08) * (1 - lift), z);
      g.visible = q > 0.001;
    } else {
      // A hole opening from a crack: grows, overshoots a little; shrinks shut when it goes.
      const q = shown.gone ? 1 - Math.min(1, t / GONE_SECONDS) : shown.still ? 1 : Math.min(1, Math.max(0, t / RISE_SECONDS));
      const s = shown.gone ? q : Math.max(0.0001, easeOutBack(q));
      g.position.set(x, 0, z);
      g.scale.set(s, 1, s);
      g.visible = q > 0.001;
    }
  });
  const chips: Chip[] = [];
  if (cell.building) chips.push({ text: buildingLabel(cell.building), tone: 'building' });
  if (cell.turnsLeft !== null) chips.push({ text: `${cell.building ? cell.building.name : cell.kind === 'wall' ? '벽' : '구덩이'} ${cell.turnsLeft}`, tone: 'terrain' });
  if (cell.cover?.turnsLeft != null) chips.push({ text: `${COVER_NAME[cell.cover.kind]} ${cell.cover.turnsLeft}`, tone: 'terrain' });
  // A building always looks like one (one saved without a look gets its own now).
  const prop = cell.prop ?? (cell.building ? buildingLook(cell.building) : undefined);
  const top = cell.kind === 'wall' ? (prop ? 1 : WALL_HEIGHT) + 0.32 : 0.3;
  return (
    <group ref={ref} position={[x, 0, z]}>
      {cell.kind === 'wall' ? (
        // A wall the GM gave a look (a barricade, a statue) is that; otherwise dry stones.
        prop ? <PropMesh prop={prop} maxReach={cell.building ? 0.95 : 0.75} /> : <Wall at={cell.at} />
      ) : (
        <>
          <Pit at={cell.at} />
          {cell.prop && <PropMesh prop={cell.prop} maxReach={0.7} />}
        </>
      )}
      {!shown.gone && <Cover cover={cell.cover ?? null} onWall={cell.kind === 'wall'} />}
      {chips.length > 0 && !shown.gone && <TurnBadges chips={chips} y={top} />}
    </group>
  );
}

/** A building's label: its name, what it helps with in a word or two, and the bonus ("대포 원거리 +2"). */
const SHORT_ABOUT: Record<Exclude<Building['kind'], 'custom'>, string> = { cannon: '원거리', church: '소생', forge: '무기' };
function buildingLabel(b: Building): string {
  const about = b.kind === 'custom' ? (b.about.length > 8 ? `${b.about.slice(0, 8)}…` : b.about) : SHORT_ABOUT[b.kind];
  return `${b.name} ${about} +${b.bonus}`;
}

const BRIDGE: Prop = { preset: 'bridge', parts: [], attach: 'feet', scale: 1 };
const LADDER: Prop = { preset: 'ladder', parts: [], attach: 'feet', scale: 1 };
const COVER_SECONDS = 0.7;

/**
 * A bridge laid over a pit (it drops into place) or a ladder leaning on a wall from its maker's
 * side (it tips onto the wall). When it goes it drops into the pit or falls away.
 */
function Cover({ cover, onWall }: { cover: TerrainCover | null; onWall: boolean }) {
  const ref = useRef<Group>(null);
  const [shown, setShown] = useState<{ cover: TerrainCover; since: number; gone: boolean } | null>(cover ? { cover, since: -1e9, gone: false } : null);
  useEffect(() => {
    const now = performance.now();
    if (cover) setShown((old) => (old && !old.gone && old.cover.kind === cover.kind ? { ...old, cover } : { cover, since: now, gone: false }));
    else setShown((old) => (old && !old.gone ? { ...old, since: now, gone: true } : old));
  }, [cover]);
  useEffect(() => {
    if (!shown?.gone) return;
    const t = setTimeout(() => setShown(null), COVER_SECONDS * 1000 + 50);
    return () => clearTimeout(t);
  }, [shown]);
  useFrame(() => {
    const g = ref.current;
    if (!g || !shown) return;
    const q = Math.min(1, (performance.now() - shown.since) / 1000 / COVER_SECONDS);
    const e = shown.gone ? q * q : easeOutBack(q);
    if (onWall) {
      const s = shown.cover.owner === 'white' ? 1 : -1;
      // Tips onto the wall from flat, leaning in at the top; falls back away when it goes.
      const lean = shown.gone ? -0.3 * s + 1.2 * s * e : 1.3 * s - 1.6 * s * e;
      g.rotation.set(lean, 0, 0);
      g.position.set(0, 0, 0.56 * s);
      g.visible = !(shown.gone && q >= 1);
    } else {
      // Drops onto the pit; sinks into it when it goes.
      g.position.set(0, shown.gone ? -0.5 * e : 0.6 * (1 - Math.min(1, e)), 0);
      g.visible = !(shown.gone && q >= 1);
    }
  });
  if (!shown) return null;
  const prop = shown.cover.prop ?? (onWall ? LADDER : BRIDGE);
  return (
    <group ref={ref}>
      <PropMesh prop={prop} maxReach={onWall ? 0.8 : 0.85} />
    </group>
  );
}

const keyOf = (c: { at: Square; kind: TerrainKind }) => `${c.at}:${c.kind}`;

/** Every wall and pit on the board, coming and going. */
export function TerrainLayer({ terrain }: { terrain: readonly TerrainCell[] }) {
  const first = useRef(true);
  const [shown, setShown] = useState<Map<string, Shown>>(() => {
    const now = performance.now();
    return new Map(terrain.map((c) => [keyOf(c), { cell: c, since: now, gone: false, still: true }]));
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const now = performance.now();
    setShown((old) => {
      const next = new Map<string, Shown>();
      const live = new Set(terrain.map(keyOf));
      for (const c of terrain) {
        const was = old.get(keyOf(c));
        next.set(keyOf(c), was && !was.gone ? { ...was, cell: c } : { cell: c, since: now, gone: false, still: false });
      }
      for (const [k, s] of old) if (!live.has(k)) next.set(k, s.gone ? s : { ...s, gone: true, since: now, still: false });
      return next;
    });
  }, [terrain]);
  // Forget what has finished going.
  useEffect(() => {
    if (![...shown.values()].some((s) => s.gone)) return;
    const t = setTimeout(() => setShown((old) => new Map([...old].filter(([, s]) => !s.gone || performance.now() - s.since < GONE_SECONDS * 1000))), GONE_SECONDS * 1000 + 50);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <>
      {[...shown.entries()].map(([k, s]) => (
        <TerrainPiece key={k} shown={s} />
      ))}
    </>
  );
}
