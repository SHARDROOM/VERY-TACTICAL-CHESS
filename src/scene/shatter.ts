import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { PieceType } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { pieceParts } from './pieceGeometry';
import { addPieceColliders } from './piecePhysics';
import { seeded } from './boardPhysics';
import { TABLE_TOP_Y } from './WoodTable';

/*
 * A shattered piece breaks into chunks of itself (docs/SPEC.md, "부서진 조각"): its own shape cut
 * into bands up its height and each band into wedges around it, every chunk the solid hull of the
 * piece's surface in that cell, so together they are about the whole piece, mass and all. They
 * burst apart with Rapier and come to rest on the board (or tumble off onto the table), for the
 * rest of the game. Seeded by the piece's id: every screen, and every reload, strews them alike.
 */

export interface Fragment {
  /** Centred on its own middle. */
  geometry: BufferGeometry;
  /** Where its middle was in the whole piece (piece frame, base at 0). */
  center: [number, number, number];
  /** Hull points around its middle, for the physics. */
  hull: Float32Array;
  /** Mostly the piece's detail (accent) material. */
  accent: boolean;
}

/** Bands up the piece (fractions of its height) and how many wedges each breaks into. */
const BANDS: [number, number, number][] = [
  [0, 0.2, 4],
  [0.2, 0.45, 3],
  [0.45, 0.72, 3],
  [0.72, 1.01, 2],
];
/** Bands overlap a little, so the chunks meet without gaps (the physics pushes them apart). */
const OVERLAP = 0.012;

const fragmentCache = new Map<PieceType, Fragment[]>();

/** The chunks a piece of this kind breaks into (shared by every piece of the kind). */
export function fragmentsOf(type: PieceType): Fragment[] {
  const cached = fragmentCache.get(type);
  if (cached) return cached;
  // The piece's surface as a cloud of points, each knowing whether it is detail.
  const cloud: { p: Vector3; accent: boolean }[] = [];
  const m = new Matrix4();
  for (const part of pieceParts(type)) {
    const pos = part.geometry.getAttribute('position');
    m.compose(new Vector3(...(part.position ?? [0, 0, 0])), new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1));
    const stride = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += stride) cloud.push({ p: new Vector3().fromBufferAttribute(pos, i).applyMatrix4(m), accent: !!part.accent });
  }
  const height = Math.max(...cloud.map((c) => c.p.y));
  const out: Fragment[] = [];
  BANDS.forEach(([lo, hi, wedges], band) => {
    const y0 = lo * height;
    const y1 = Math.min(hi, 1) * height;
    // Each band's cracks run at their own angle, so the chunks do not stack in neat columns.
    const turn = band * 0.9 + 0.3;
    const cells: { p: Vector3; accent: boolean }[][] = Array.from({ length: wedges }, () => []);
    for (const c of cloud) {
      if (c.p.y < y0 - OVERLAP || c.p.y > y1 + OVERLAP) continue;
      const a = (Math.atan2(c.p.z, c.p.x) + turn + Math.PI * 4) % (Math.PI * 2);
      cells[Math.min(wedges - 1, Math.floor((a / (Math.PI * 2)) * wedges))].push(c);
    }
    for (const cell of cells) {
      if (cell.length < 6) continue;
      // Solid to the middle: the axis is in every chunk.
      const pts = [...cell.map((c) => c.p), new Vector3(0, Math.max(0, y0), 0), new Vector3(0, Math.min(height, y1), 0)];
      const geometry = new ConvexGeometry(pts);
      geometry.computeBoundingBox();
      const mid = geometry.boundingBox!.getCenter(new Vector3());
      geometry.translate(-mid.x, -mid.y, -mid.z);
      const hull = Float32Array.from(pts.flatMap((p) => [p.x - mid.x, p.y - mid.y, p.z - mid.z]));
      out.push({ geometry, center: [mid.x, mid.y, mid.z], hull, accent: cell.filter((c) => c.accent).length * 2 > cell.length });
    }
  });
  fragmentCache.set(type, out);
  return out;
}

/** How the chunks flew: 7 numbers per step per chunk (world position, rotation quaternion). */
export interface ShatterRun {
  tracks: Float32Array[];
  steps: number;
  dt: number;
}

const G = 9.81 * 2.5;
const DT = 1 / 60;
const runCache = new Map<string, Promise<ShatterRun>>();

/** A number from a piece's id, to seed its shattering. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What else is on the table, solid but not moving: pieces on the board, and chunks already lying about. */
export interface Obstacles {
  pieces: { type: PieceType; rider?: PieceType; at: [number, number, number] }[];
  chunks: { hull: Float32Array; p: Vector3; q: Quaternion }[];
}

type Rapier = Awaited<ReturnType<typeof loadPhysics>>;

/** The table, the raised board and the obstacles, all fixed. */
function solids(RAPIER: Rapier, world: InstanceType<Rapier['World']>, o?: Obstacles): void {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, TABLE_TOP_Y - 0.3, 0).setFriction(0.8).setRestitution(0.15), fixed);
  const boardH = -TABLE_TOP_Y / 2;
  world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, boardH, 4.6).setTranslation(0, TABLE_TOP_Y + boardH, 0).setFriction(0.7).setRestitution(0.2), fixed);
  for (const p of o?.pieces ?? []) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...p.at));
    addPieceColliders(RAPIER, world, b, p.type, { rider: p.rider, friction: 0.5, restitution: 0.25, footDensity: 1 });
  }
  for (const c of o?.chunks ?? []) {
    const hull = RAPIER.ColliderDesc.convexHull(c.hull);
    if (!hull) continue;
    world.createCollider(hull.setTranslation(c.p.x, c.p.y, c.p.z).setRotation({ x: c.q.x, y: c.q.y, z: c.q.z, w: c.q.w }).setFriction(0.6).setRestitution(0.2), fixed);
  }
}

/**
 * The piece `id` of kind `type`, standing on the board at `at` (world), bursts into its chunks:
 * each flies out from the middle and up, spinning, bouncing off the pieces around it, and they
 * settle on the board and the table. The same piece always breaks the same way on a screen
 * (cached per piece and place; the obstacles are those of the first call).
 */
export function simulateShatter(type: PieceType, id: string, at: [number, number, number], obstacles?: Obstacles): Promise<ShatterRun> {
  const key = `${type}|${id}|${at.join(',')}`;
  let run = runCache.get(key);
  if (!run) {
    run = shatter(type, seedOf(id), at, obstacles);
    runCache.set(key, run);
    run.catch(() => runCache.delete(key));
  }
  return run;
}

async function shatter(type: PieceType, seed: number, at: [number, number, number], obstacles?: Obstacles): Promise<ShatterRun> {
  const RAPIER = await loadPhysics();
  const random = seeded(seed);
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    solids(RAPIER, world, obstacles);
    const spin = random() * Math.PI * 2;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spin);
    const bodies = fragmentsOf(type).map((f) => {
      const c = new Vector3(...f.center).applyQuaternion(turn);
      // Out from the middle of the piece (a little up the higher it was), with a twist.
      const out = Math.hypot(c.x, c.z) > 0.01 ? new Vector3(c.x, 0, c.z).normalize() : new Vector3(Math.cos(spin), 0, Math.sin(spin));
      const speed = 1.6 + random() * 1.9;
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(at[0] + c.x, at[1] + c.y + 0.01, at[2] + c.z)
          .setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w })
          .setLinvel(out.x * speed, 0.9 + c.y * 1.4 + random() * 1.4, out.z * speed)
          .setAngvel({ x: (random() - 0.5) * 9, y: (random() - 0.5) * 7, z: (random() - 0.5) * 9 })
          .setLinearDamping(0.12)
          .setAngularDamping(0.45)
          .setCcdEnabled(true),
      );
      world.createCollider(RAPIER.ColliderDesc.convexHull(f.hull)!.setDensity(1).setFriction(0.5).setRestitution(0.25), b);
      return b;
    });
    const frames: number[][] = bodies.map(() => []);
    const maxSteps = Math.round(3.5 / DT);
    let steps = 0;
    let still = 0;
    while (steps < maxSteps) {
      world.step();
      bodies.forEach((b, i) => {
        const p = b.translation();
        const q = b.rotation();
        frames[i].push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      });
      steps++;
      const moving = bodies.some((b) => {
        if (b.isSleeping()) return false;
        const v = b.linvel();
        const w = b.angvel();
        return Math.hypot(v.x, v.y, v.z) > 0.04 || Math.hypot(w.x, w.y, w.z) > 0.08;
      });
      still = moving ? 0 : still + 1;
      if (still > 15 && steps > 30) break;
    }
    return { tracks: frames.map((f) => Float32Array.from(f)), steps, dt: DT };
  } finally {
    world.free();
  }
}

/**
 * A chunk thrown from the player's finger: from `p`, `q` at `velocity`, spinning, onto the table
 * and the board, off the obstacles, until it lies still.
 */
export async function simulateChunkThrow(hull: Float32Array, p: Vector3, q: Quaternion, velocity: Vector3, obstacles?: Obstacles): Promise<ShatterRun> {
  const RAPIER = await loadPhysics();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    solids(RAPIER, world, obstacles);
    const speed = velocity.length();
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: velocity.z * 1.5 + (Math.random() - 0.5) * speed, y: (Math.random() - 0.5) * 3, z: -velocity.x * 1.5 })
        .setLinearDamping(0.12)
        .setAngularDamping(0.45)
        .setCcdEnabled(true),
    );
    world.createCollider(RAPIER.ColliderDesc.convexHull(hull)!.setDensity(1).setFriction(0.5).setRestitution(0.3), b);
    const frames: number[] = [];
    let steps = 0;
    let still = 0;
    while (steps < Math.round(4 / DT)) {
      world.step();
      const t = b.translation();
      const r = b.rotation();
      frames.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
      steps++;
      const v = b.linvel();
      const w = b.angvel();
      still = b.isSleeping() || (Math.hypot(v.x, v.y, v.z) < 0.04 && Math.hypot(w.x, w.y, w.z) < 0.08) ? still + 1 : 0;
      if (still > 15) break;
    }
    return { tracks: [Float32Array.from(frames)], steps, dt: DT };
  } finally {
    world.free();
  }
}
