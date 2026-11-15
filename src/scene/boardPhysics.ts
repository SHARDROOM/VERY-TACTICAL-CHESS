import { Vector3 } from 'three';
import type { Board, PieceType, Square, TerrainCell } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { ballistic, hullPoints } from './piecePhysics';
import { squareToWorld } from './coords';
import { TABLE_TOP_Y } from './WoodTable';

/*
 * A move as a romp: the moving piece is shoved along its way (or flung in a rough arc), and
 * whatever it bumps rocks, topples or skids; everything is simulated together with Rapier and
 * recorded, then played back. Afterwards every piece eases back to where the rules put it
 * (PieceMesh). Purely a look: the game state never depends on it.
 */

export interface Mover {
  id: string;
  type: PieceType;
  from: Square;
  to: Square;
  /** Shoved along the board (sliders, kings, pawns) or flung through the air (knights, flights). */
  mode: 'slide' | 'throw';
}

export interface BoardRun {
  /** 7 numbers per step (position, rotation quaternion) for every piece that moved. */
  tracks: Map<string, Float32Array>;
  steps: number;
  dt: number;
}

export const runLength = (run: BoardRun) => run.steps * run.dt;

const G = 9.81 * 2.5;
const DT = 1 / 60;

/** A small seeded random, so a move looks the same on every screen. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RompOptions {
  board: Board;
  movers: Mover[];
  /** Pieces left out (they go their own way, e.g. a victim with a staged exit). */
  exclude?: ReadonlySet<string>;
  terrain?: readonly TerrainCell[];
  seed: number;
}

/**
 * Simulates the move with every piece on the board solid and movable. A sliding piece is pushed
 * along a slightly wobbly line a little past its square (it cannot be stopped); a flung piece is
 * thrown hard at roughly its square and bounces where it lands. Runs until all is still (at most
 * a couple of seconds) and keeps the tracks of the pieces that moved.
 */
export async function simulateRomp(o: RompOptions): Promise<BoardRun> {
  const RAPIER = await loadPhysics();
  const random = seeded(o.seed);
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, TABLE_TOP_Y - 0.3, 0).setFriction(0.7).setRestitution(0.15), fixed);
    const boardH = -TABLE_TOP_Y / 2;
    world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, boardH, 4.6).setTranslation(0, TABLE_TOP_Y + boardH, 0).setFriction(0.55).setRestitution(0.2), fixed);
    // Walls are solid; pieces bounce off them.
    for (const c of o.terrain ?? []) {
      if (c.kind !== 'wall') continue;
      const [x, , z] = squareToWorld(c.at);
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.34, 0.46).setTranslation(x, 0.34, z).setFriction(0.6).setRestitution(0.2), fixed);
    }

    const hull = (type: PieceType, b: InstanceType<typeof RAPIER.RigidBody>, restitution: number) => {
      world.createCollider(RAPIER.ColliderDesc.convexHull(hullPoints(type))!.setDensity(1).setFriction(0.5).setRestitution(restitution), b);
      // A weighted base: they rock and often stand back up, but a good shove topples them.
      world.createCollider(RAPIER.ColliderDesc.cylinder(0.04, 0.28).setTranslation(0, 0.05, 0).setDensity(5).setFriction(0.6).setRestitution(restitution), b);
    };

    const moving = new Set(o.movers.map((m) => m.id));
    const bodies: { id: string; body: InstanceType<typeof RAPIER.RigidBody> }[] = [];
    o.board.forEach((p, sq) => {
      if (!p || moving.has(p.id) || o.exclude?.has(p.id)) return;
      const [x, , z] = squareToWorld(sq);
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).setLinearDamping(0.3).setAngularDamping(0.8).setCcdEnabled(true));
      hull(p.type, b, 0.25);
      bodies.push({ id: p.id, body: b });
    });

    /** Where a sliding piece is at time t: shoved fast, past its square, with a wobble. */
    const slides = o.movers
      .filter((m) => m.mode === 'slide')
      .map((m) => {
        const [fx, , fz] = squareToWorld(m.from);
        const [tx, , tz] = squareToWorld(m.to);
        const dx = tx - fx;
        const dz = tz - fz;
        const d = Math.hypot(dx, dz) || 1;
        const over = 0.5 + random() * 0.3;
        const end = { x: tx + (dx / d) * over, z: tz + (dz / d) * over };
        const sway = (random() < 0.5 ? -1 : 1) * (0.12 + random() * 0.12);
        const seconds = 0.18 + 0.075 * d;
        const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(fx, 0, fz));
        hull(m.type, b, 0.2);
        bodies.push({ id: m.id, body: b });
        return { body: b, seconds, at: (t: number) => {
          const q = Math.min(1, t / seconds);
          const e = 1 - (1 - q) ** 2;
          const wobble = Math.sin(Math.PI * q) * sway;
          return { x: fx + (end.x - fx) * e - (dz / d) * wobble, z: fz + (end.z - fz) * e + (dx / d) * wobble };
        } };
      });

    // Flung pieces: thrown hard at roughly their square.
    for (const m of o.movers.filter((x) => x.mode === 'throw')) {
      const [fx, , fz] = squareToWorld(m.from);
      const [tx, , tz] = squareToWorld(m.to);
      const d = Math.hypot(tx - fx, tz - fz);
      const aim = { x: tx + (random() - 0.5) * 0.7, z: tz + (random() - 0.5) * 0.7 };
      const v = ballistic(new Vector3(fx, 0.05, fz), aim, 0, 5.2 + d * 0.45 + random());
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(fx, 0.05, fz)
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({ x: (random() - 0.5) * 8, y: (random() - 0.5) * 6, z: (random() - 0.5) * 8 })
          .setLinearDamping(0.1)
          .setAngularDamping(0.5)
          .setCcdEnabled(true),
      );
      hull(m.type, b, 0.35);
      bodies.push({ id: m.id, body: b });
    }

    const maxSeconds = o.movers.some((m) => m.mode === 'throw') ? 2.4 : 1.7;
    const maxSteps = Math.round(maxSeconds / DT);
    const frames = new Map<string, number[]>(bodies.map((b) => [b.id, []]));
    let steps = 0;
    let still = 0;
    while (steps < maxSteps) {
      const t = (steps + 1) * DT;
      for (const s of slides) {
        const p = s.at(t);
        s.body.setNextKinematicTranslation({ x: p.x, y: 0, z: p.z });
      }
      world.step();
      for (const { id, body } of bodies) {
        const p = body.translation();
        const q = body.rotation();
        frames.get(id)!.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      }
      steps++;
      // Done when the shoves are over and nothing moves any more.
      const shoving = slides.some((s) => t < s.seconds);
      const moving = bodies.some(({ body }) => {
        if (body.isKinematic() || body.isSleeping()) return false;
        const v = body.linvel();
        const w = body.angvel();
        return Math.hypot(v.x, v.y, v.z) > 0.05 || Math.hypot(w.x, w.y, w.z) > 0.1;
      });
      still = !shoving && !moving ? still + 1 : 0;
      if (still > 12) break;
    }

    // Keep the pieces that actually moved (and every mover).
    const tracks = new Map<string, Float32Array>();
    for (const { id } of bodies) {
      const f = frames.get(id)!;
      const last = f.length - 7;
      const moved = Math.hypot(f[last] - f[0], f[last + 1] - f[1], f[last + 2] - f[2]);
      let swayed = 0;
      for (let i = 0; i < f.length; i += 7) swayed = Math.max(swayed, Math.hypot(f[i] - f[0], f[i + 1] - f[1], f[i + 2] - f[2]), 1 - Math.abs(f[i + 6]));
      if (moving.has(id) || moved > 0.01 || swayed > 0.01) tracks.set(id, Float32Array.from(f));
    }
    return { tracks, steps, dt: DT };
  } finally {
    world.free();
  }
}
