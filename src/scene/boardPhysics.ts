import { Quaternion, Vector3 } from 'three';
import { isAir, type Board, type FallingPiece, type Landing, type PieceType, type Square, type TerrainCell } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { addPieceColliders, ballistic, hullPoints } from './piecePhysics';
import { PIECE_HEIGHT } from './pieceGeometry';
import { AIR_Y, squareToWorld, worldToBoard } from './coords';
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
  /** Whoever rides it, glued on top. */
  rider?: PieceType;
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
/** Grip of a sliding piece on the board (the board's own is 0.55; Rapier averages the two). */
const SLIDE_FRICTION = 1.1;
/** How fast that friction slows a slide (the push is sized to stop it about on its square). */
const SLIDE_DECEL = ((SLIDE_FRICTION + 0.55) / 2) * G;
/** Slides this long (in squares) or longer come in too fast and topple. */
export const TOPPLE_FROM = 3;

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
 * Simulates the move with every piece on the board solid and movable. A sliding piece gets one
 * straight push sized for the board's friction to stop it about on its square (a long slide
 * tips over); a flung piece is thrown high and hard at a spot a little past its square and
 * bounces on. Runs until all is still (a couple of seconds at most) and keeps the tracks of the
 * pieces that moved.
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

    // A weighted base: they rock and often stand back up, but a good shove topples them.
    const hull = (type: PieceType, b: InstanceType<typeof RAPIER.RigidBody>, restitution: number, rider?: PieceType) =>
      addPieceColliders(RAPIER, world, b, type, { rider, friction: 0.5, footFriction: 0.6, restitution, footDensity: 5 });

    const moving = new Set(o.movers.map((m) => m.id));
    const bodies: { id: string; body: InstanceType<typeof RAPIER.RigidBody> }[] = [];
    o.board.forEach((p, sq) => {
      // The air layer floats above it all.
      if (!p || isAir(sq) || moving.has(p.id) || o.exclude?.has(p.id)) return;
      const [x, , z] = squareToWorld(sq);
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).setLinearDamping(0.3).setAngularDamping(0.8).setCcdEnabled(true));
      hull(p.type, b, 0.25, p.rider?.type);
      bodies.push({ id: p.id, body: b });
    });

    // Sliding pieces: given one straight push and left to the friction of the board, which stops
    // a short slide about on its square; a long one comes in too fast and tips over forward.
    for (const m of o.movers.filter((x) => x.mode === 'slide')) {
      const [fx, , fz] = squareToWorld(m.from);
      const [tx, , tz] = squareToWorld(m.to);
      const dx = tx - fx;
      const dz = tz - fz;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d;
      const uz = dz / d;
      // Enough speed to come to rest about on its square against SLIDE_FRICTION.
      const v0 = Math.sqrt(2 * SLIDE_DECEL * d) * (1.02 + random() * 0.08);
      const tip = d >= TOPPLE_FROM ? Math.min(9, 3.5 + 1.1 * (d - TOPPLE_FROM)) : 0;
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(fx, 0.002, fz)
          .setLinvel(ux * v0, 0, uz * v0)
          // A long slide leans forward from the start and goes over (axis up × direction).
          .setAngvel({ x: uz * tip, y: 0, z: -ux * tip })
          .setLinearDamping(0.05)
          .setAngularDamping(0.4)
          .setCcdEnabled(true),
      );
      addPieceColliders(RAPIER, world, b, m.type, { rider: m.rider, friction: SLIDE_FRICTION, restitution: 0.15, footDensity: 5 });
      // Only along its line: no sideways drift unless something knocks it.
      if (!tip) b.setEnabledRotations(false, true, false, true);
      bodies.push({ id: m.id, body: b });
    }

    // Flung pieces: thrown high and hard at a spot a little past their square.
    for (const m of o.movers.filter((x) => x.mode === 'throw')) {
      const [fx, , fz] = squareToWorld(m.from);
      const [tx, , tz] = squareToWorld(m.to);
      const d = Math.hypot(tx - fx, tz - fz) || 1;
      const ux = (tx - fx) / d;
      const uz = (tz - fz) / d;
      const past = 0.45 + random() * 0.45;
      const side = (random() - 0.5) * 0.3;
      const aim = { x: tx + ux * past - uz * side, z: tz + uz * past + ux * side };
      const v = ballistic(new Vector3(fx, 0.05, fz), aim, 0, 7.4 + d * 0.5 + random() * 0.8);
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(fx, 0.05, fz)
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({ x: (random() - 0.5) * 8, y: (random() - 0.5) * 6, z: (random() - 0.5) * 8 })
          .setLinearDamping(0.1)
          .setAngularDamping(0.5)
          .setCcdEnabled(true),
      );
      hull(m.type, b, 0.35, m.rider);
      bodies.push({ id: m.id, body: b });
    }

    const maxSeconds = o.movers.some((m) => m.mode === 'throw') ? 2.6 : 2.2;
    const maxSteps = Math.round(maxSeconds / DT);
    const frames = new Map<string, number[]>(bodies.map((b) => [b.id, []]));
    let steps = 0;
    let still = 0;
    while (steps < maxSteps) {
      world.step();
      for (const { id, body } of bodies) {
        const p = body.translation();
        const q = body.rotation();
        frames.get(id)!.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      }
      steps++;
      // Done when nothing moves any more.
      const moving = bodies.some(({ body }) => {
        if (body.isSleeping()) return false;
        const v = body.linvel();
        const w = body.angvel();
        return Math.hypot(v.x, v.y, v.z) > 0.05 || Math.hypot(w.x, w.y, w.z) > 0.1;
      });
      still = !moving ? still + 1 : 0;
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

/**
 * Where a falling piece starts (world): where it floated on the air layer, or, thrown off a
 * carrier, on top of where the carrier stood (above whoever stands there now, if taller).
 */
export function fallStart(f: FallingPiece, board: Board): [number, number, number] {
  const [x, y, z] = squareToWorld(f.from);
  if (!f.rodeOn) return [x, isAir(f.from) ? y : AIR_Y, z];
  const below = board[f.from];
  const top = Math.max(PIECE_HEIGHT[f.rodeOn], below ? PIECE_HEIGHT[below.type] : 0) - 0.06;
  return [x, y + top, z];
}

export interface FallOptions {
  board: Board;
  terrain?: readonly TerrainCell[];
  falling: readonly FallingPiece[];
  seed: number;
}

/** How tall a piece is (its hull), for where its middle is once it lies down. */
function heightOf(type: PieceType): number {
  const pts = hullPoints(type);
  let top = 0;
  for (let i = 1; i < pts.length; i += 3) top = Math.max(top, pts[i]);
  return top;
}

/**
 * Pieces whose levitation ended drop from the air layer, unsteady (a little drift and spin, from
 * the seed), onto the board and whatever stands on it, and settle. Returns the recording and
 * where each falling piece came to rest (the middle of the piece, in board coordinates), which
 * the rules turn into a square (levitation.ts). The same seed gives the same fall on every screen.
 */
export async function simulateFalls(o: FallOptions): Promise<{ run: BoardRun; landings: Landing[] }> {
  const RAPIER = await loadPhysics();
  const random = seeded(o.seed);
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, TABLE_TOP_Y - 0.3, 0).setFriction(0.7).setRestitution(0.15), fixed);
    const boardH = -TABLE_TOP_Y / 2;
    world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, boardH, 4.6).setTranslation(0, TABLE_TOP_Y + boardH, 0).setFriction(0.55).setRestitution(0.2), fixed);
    for (const c of o.terrain ?? []) {
      if (c.kind !== 'wall') continue;
      const [x, , z] = squareToWorld(c.at);
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.34, 0.46).setTranslation(x, 0.34, z).setFriction(0.6).setRestitution(0.2), fixed);
    }
    const hull = (type: PieceType, b: InstanceType<typeof RAPIER.RigidBody>, restitution: number, rider?: PieceType) =>
      addPieceColliders(RAPIER, world, b, type, { rider, friction: 0.5, footFriction: 0.6, restitution, footDensity: 5 });

    const bodies: { id: string; body: InstanceType<typeof RAPIER.RigidBody> }[] = [];
    o.board.forEach((p, sq) => {
      if (!p || isAir(sq)) return;
      const [x, , z] = squareToWorld(sq);
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).setLinearDamping(0.3).setAngularDamping(0.8).setCcdEnabled(true));
      hull(p.type, b, 0.25, p.rider?.type);
      bodies.push({ id: p.id, body: b });
    });

    const fallers: { id: string; type: PieceType; body: InstanceType<typeof RAPIER.RigidBody> }[] = [];
    for (const f of o.falling) {
      const { piece } = f;
      const [x, y, z] = fallStart(f, o.board);
      // Unsteady to the last: a little tilt, drift and spin as it lets go.
      const tilt = (random() - 0.5) * 0.5;
      const turn = random() * Math.PI * 2;
      let vel = { x: (random() - 0.5) * 1.6, y: 0, z: (random() - 0.5) * 1.6 };
      let spin = { x: (random() - 0.5) * 4, y: (random() - 0.5) * 3, z: (random() - 0.5) * 4 };
      if (f.rodeOn) {
        // Thrown off its carrier: knocked away from the blow (any way, without one), up a little
        // and tumbling over the edge of whatever now stands below it.
        const [px, , pz] = f.push !== undefined ? squareToWorld(f.push) : [x - Math.cos(turn), 0, z - Math.sin(turn)];
        const d = Math.hypot(x - px, z - pz) || 1;
        const ux = (x - px) / d;
        const uz = (z - pz) / d;
        const speed = 1.8 + random() * 0.9;
        vel = { x: ux * speed, y: 1.4 + random() * 0.8, z: uz * speed };
        const roll = 5 + random() * 3;
        spin = { x: uz * roll, y: (random() - 0.5) * 2, z: -ux * roll };
      }
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setRotation({ x: Math.sin(tilt / 2) * Math.cos(turn), y: 0, z: Math.sin(tilt / 2) * Math.sin(turn), w: Math.cos(tilt / 2) })
          .setLinvel(vel.x, vel.y, vel.z)
          .setAngvel(spin)
          .setLinearDamping(0.1)
          .setAngularDamping(0.5)
          .setCcdEnabled(true),
      );
      hull(piece.type, b, 0.3, piece.rider?.type);
      bodies.push({ id: piece.id, body: b });
      fallers.push({ id: piece.id, type: piece.type, body: b });
    }

    const maxSteps = Math.round(3 / DT);
    const frames = new Map<string, number[]>(bodies.map((b) => [b.id, []]));
    let steps = 0;
    let still = 0;
    while (steps < maxSteps) {
      world.step();
      for (const { id, body } of bodies) {
        const p = body.translation();
        const q = body.rotation();
        frames.get(id)!.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      }
      steps++;
      const moving = bodies.some(({ body }) => {
        if (body.isSleeping()) return false;
        const v = body.linvel();
        const w = body.angvel();
        return Math.hypot(v.x, v.y, v.z) > 0.05 || Math.hypot(w.x, w.y, w.z) > 0.1;
      });
      still = !moving ? still + 1 : 0;
      if (still > 12 && steps > 20) break;
    }

    // Where each falling piece rests: its middle (lying down, that is beside its base).
    const landings: Landing[] = fallers.map(({ id, type, body }) => {
      const p = body.translation();
      const q = new Quaternion(body.rotation().x, body.rotation().y, body.rotation().z, body.rotation().w);
      const mid = new Vector3(0, heightOf(type) / 2, 0).applyQuaternion(q);
      return { id, ...worldToBoard(p.x + mid.x, p.z + mid.z) };
    });

    const falling = new Set(fallers.map((f) => f.id));
    const tracks = new Map<string, Float32Array>();
    for (const { id } of bodies) {
      const f = frames.get(id)!;
      const last = f.length - 7;
      const moved = Math.hypot(f[last] - f[0], f[last + 1] - f[1], f[last + 2] - f[2]);
      let swayed = 0;
      for (let i = 0; i < f.length; i += 7) swayed = Math.max(swayed, Math.hypot(f[i] - f[0], f[i + 1] - f[1], f[i + 2] - f[2]), 1 - Math.abs(f[i + 6]));
      if (falling.has(id) || moved > 0.01 || swayed > 0.01) tracks.set(id, Float32Array.from(f));
    }
    return { run: { tracks, steps, dt: DT }, landings };
  } finally {
    world.free();
  }
}
