import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { ridersOf, type Piece, type PieceType } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { TRAY } from '../dice3d/simulate';
import { TRAY_SCALE, trayCenterX } from '../dice3d/DiceTray';
import { findImpacts } from '../audio/impacts';
import { PIECE_HEIGHT, pieceParts } from './pieceGeometry';
import { TABLE_TOP_Y } from './WoodTable';

export interface BodyPose {
  position: Vector3;
  quaternion: Quaternion;
}

/** A recorded flight: 7 numbers per step (position, then rotation quaternion). */
export interface PieceRun {
  frames: Float32Array;
  steps: number;
  dt: number;
  final: BodyPose;
  impacts: { step: number; strength: number }[];
}

export interface Obstacle {
  /** Whose (a taken piece's id), when it matters. */
  id?: string;
  type: PieceType;
  scale: number;
  pose: BodyPose;
}

/**
 * Pieces are heavy little things: strong gravity (for the scene's scale) makes them fall and
 * settle briskly, and a weighted base keeps their centre of mass low, like a real Staunton set.
 */
export const G = 9.81 * 2.5;
const BOARD_HALF = 4.6;

const hullCache = new Map<PieceType, Float32Array>();

/** Convex hull points of a piece (in its own frame, unscaled), sampled from its rendered parts. */
export function hullPoints(type: PieceType): Float32Array {
  let pts = hullCache.get(type);
  if (pts) return pts;
  const out: number[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  for (const part of pieceParts(type)) {
    const pos = part.geometry.getAttribute('position');
    m.compose(
      new Vector3(...(part.position ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]))),
      new Vector3(1, 1, 1),
    );
    // Lathes are dense; every few vertices is plenty for a hull.
    const stride = Math.max(1, Math.floor(pos.count / 300));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
  }
  pts = Float32Array.from(out);
  hullCache.set(type, pts);
  return pts;
}

const scaled = (pts: Float32Array, s: number) => pts.map((x) => x * s);

/** Where a rider's feet are on its carrier: on the carrier's top (unscaled; the same as drawn). */
export const riderBase = (carrier: PieceType) => PIECE_HEIGHT[carrier] - 0.06;

/** The kinds riding a piece, bottom first (for the physics). */
export const riderTypes = (p: Piece): PieceType[] => ridersOf(p).map((r) => r.type);

/** How tall a piece stands with everyone riding it. */
export function stackHeight(p: Piece): number {
  let h = 0;
  let below: Piece = p;
  for (const r of ridersOf(p)) {
    h += riderBase(below.type);
    below = r;
  }
  return h + PIECE_HEIGHT[below.type];
}

type Rapier = Awaited<ReturnType<typeof loadPhysics>>;

/**
 * A piece's colliders on `body`: its hull, a weighted foot that keeps its centre of mass low,
 * and whoever rides it glued on top (its hull at the carrier's top), so the pair rocks, topples
 * and bumps as one, top-heavy as it is.
 */
export function addPieceColliders(
  RAPIER: Rapier,
  world: InstanceType<Rapier['World']>,
  body: InstanceType<Rapier['RigidBody']>,
  type: PieceType,
  o: { riders?: readonly PieceType[]; scale?: number; friction: number; restitution: number; footDensity: number; footFriction?: number },
): void {
  const k = o.scale ?? 1;
  world.createCollider(RAPIER.ColliderDesc.convexHull(scaled(hullPoints(type), k))!.setDensity(1).setFriction(o.friction).setRestitution(o.restitution), body);
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.04 * k, 0.28 * k).setTranslation(0, 0.05 * k, 0).setDensity(o.footDensity).setFriction(o.footFriction ?? o.friction).setRestitution(o.restitution),
    body,
  );
  // Whoever rides it, stacked up: each stands on the top of the one below.
  let below = type;
  let base = 0;
  for (const r of o.riders ?? []) {
    base += riderBase(below);
    world.createCollider(
      RAPIER.ColliderDesc.convexHull(scaled(hullPoints(r), k))!.setTranslation(0, base * k, 0).setDensity(1).setFriction(o.friction).setRestitution(o.restitution),
      body,
    );
    below = r;
  }
}

/**
 * Things on the table a thrown piece or chunk can hit, solid but not moving: pieces on the board
 * (with their riders), chunks of shattered pieces, taken pieces beside the board, the dice.
 */
export interface Obstacles {
  pieces: { type: PieceType; riders?: PieceType[]; at: [number, number, number] }[];
  chunks: { hull: Float32Array; p: Vector3; q: Quaternion }[];
  taken?: Obstacle[];
  dice?: { hull: Float32Array; p: Vector3; q: Quaternion }[];
}

/** The obstacles as fixed colliders (on `fixed`, or bodies of their own for the pieces). */
export function addObstacles(RAPIER: Rapier, world: InstanceType<Rapier['World']>, fixed: InstanceType<Rapier['RigidBody']>, o: Obstacles): void {
  for (const p of o.pieces) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...p.at));
    addPieceColliders(RAPIER, world, b, p.type, { riders: p.riders, friction: 0.5, restitution: 0.25, footDensity: 1 });
  }
  const at = (hull: ReturnType<typeof RAPIER.ColliderDesc.convexHull>, p: Vector3, q: Quaternion, friction: number, restitution: number) => {
    if (hull) world.createCollider(hull.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(friction).setRestitution(restitution), fixed);
  };
  for (const c of o.chunks) at(RAPIER.ColliderDesc.convexHull(c.hull), c.p, c.q, 0.6, 0.2);
  for (const t of o.taken ?? []) at(RAPIER.ColliderDesc.convexHull(scaled(hullPoints(t.type), t.scale)), t.pose.position, t.pose.quaternion, 0.5, 0.25);
  for (const d of o.dice ?? []) at(RAPIER.ColliderDesc.convexHull(d.hull), d.p, d.q, 0.5, 0.35);
}

/** The table top, the board raised on it and the dice tray's walls, fixed; returns their body. */
export function addTable(RAPIER: Rapier, world: InstanceType<Rapier['World']>, diceSide: 1 | -1): InstanceType<Rapier['RigidBody']> {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const solid = (desc: InstanceType<typeof RAPIER.ColliderDesc>, friction = 0.6, restitution = 0.2) =>
    world.createCollider(desc.setFriction(friction).setRestitution(restitution), fixed);
  solid(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, TABLE_TOP_Y - 0.3, 0), 0.7, 0.15);
  const boardH = -TABLE_TOP_Y / 2;
  solid(RAPIER.ColliderDesc.cuboid(BOARD_HALF, boardH, BOARD_HALF).setTranslation(0, TABLE_TOP_Y + boardH, 0), 0.55, 0.2);
  const tx = trayCenterX(diceSide);
  const hx = TRAY.halfX * TRAY_SCALE;
  const hz = TRAY.halfZ * TRAY_SCALE;
  const rim = 0.3 * TRAY_SCALE;
  const wallH = 0.4 * TRAY_SCALE;
  for (const [x, z, w, d] of [
    [tx, hz + rim / 2, hx + rim, rim / 2],
    [tx, -hz - rim / 2, hx + rim, rim / 2],
    [tx + hx + rim / 2, 0, rim / 2, hz],
    [tx - hx - rim / 2, 0, rim / 2, hz],
  ]) {
    solid(RAPIER.ColliderDesc.cuboid(w, wallH / 2, d).setTranslation(x, TABLE_TOP_Y + wallH / 2, z));
  }
  return fixed;
}

export interface SimOptions {
  type: PieceType;
  /** Whoever rides it (bottom first), glued on top. */
  riders?: PieceType[];
  scale: number;
  start: BodyPose;
  velocity: Vector3;
  spin: Vector3;
  /** Pieces already lying beside the board, solid but not moving. */
  obstacles?: Obstacle[];
  /** Anything else it can hit (the board's pieces, chunks, the dice). */
  extra?: Obstacles;
  diceSide: 1 | -1;
  maxSeconds?: number;
  /** How lively the piece is on landing (defaults suit a piece knocked across the table). */
  bounce?: { restitution: number; friction: number; angularDamping: number };
}

/**
 * Throws one piece with rigid-body physics (Rapier) across the table: the table top, the
 * raised board, the dice tray and any obstacles are solid. Simulated ahead and recorded,
 * like the dice and the coins.
 */
export async function simulatePiece(o: SimOptions): Promise<PieceRun> {
  const RAPIER = await loadPhysics();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  try {
    const fixed = addTable(RAPIER, world, o.diceSide);
    const solid = (desc: InstanceType<typeof RAPIER.ColliderDesc>, friction = 0.6, restitution = 0.2) =>
      world.createCollider(desc.setFriction(friction).setRestitution(restitution), fixed);
    if (o.extra) addObstacles(RAPIER, world, fixed, o.extra);
    for (const ob of o.obstacles ?? []) {
      const hull = RAPIER.ColliderDesc.convexHull(scaled(hullPoints(ob.type), ob.scale));
      if (!hull) continue;
      const q = ob.pose.quaternion;
      solid(hull.setTranslation(ob.pose.position.x, ob.pose.position.y, ob.pose.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    }

    const q = o.start.quaternion;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(o.start.position.x, o.start.position.y, o.start.position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(o.velocity.x, o.velocity.y, o.velocity.z)
        .setAngvel({ x: o.spin.x, y: o.spin.y, z: o.spin.z })
        .setLinearDamping(0.08)
        .setAngularDamping(o.bounce?.angularDamping ?? 0.6)
        .setCcdEnabled(true),
    );
    const restitution = o.bounce?.restitution ?? 0.22;
    const friction = o.bounce?.friction ?? 0.6;
    addPieceColliders(RAPIER, world, body, o.type, { riders: o.riders, scale: o.scale, friction, restitution, footDensity: 6 });

    const maxSteps = Math.round(60 * (o.maxSeconds ?? 4));
    const frames: number[] = [];
    let steps = 0;
    let still = 0;
    while (steps < maxSteps) {
      world.step();
      const p = body.translation();
      const r = body.rotation();
      frames.push(p.x, p.y, p.z, r.x, r.y, r.z, r.w);
      steps++;
      if (body.isSleeping()) break;
      const v = body.linvel();
      const w = body.angvel();
      still = Math.hypot(v.x, v.y, v.z) < 0.05 && Math.hypot(w.x, w.y, w.z) < 0.08 ? still + 1 : 0;
      if (still > 20) break;
    }
    const recorded = Float32Array.from(frames);
    const n = (steps - 1) * 7;
    return {
      frames: recorded,
      steps,
      dt: world.timestep,
      final: {
        position: new Vector3(recorded[n], recorded[n + 1], recorded[n + 2]),
        quaternion: new Quaternion(recorded[n + 3], recorded[n + 4], recorded[n + 5], recorded[n + 6]),
      },
      impacts: findImpacts(recorded, world.timestep, G, { threshold: 1.5, fullScale: 8 }),
    };
  } finally {
    world.free();
  }
}

/**
 * Launch velocity for a throw from `from` that comes down on `to` (at height `toY`),
 * going up at `vy` first. Spin tumbles it about a horizontal axis across the throw.
 */
export function ballistic(from: Vector3, to: { x: number; z: number }, toY: number, vy: number): Vector3 {
  const drop = from.y - toY;
  const t = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * drop))) / G;
  return new Vector3((to.x - from.x) / t, vy, (to.z - from.z) / t);
}

export function tumble(velocity: Vector3, amount: number, random: () => number = Math.random): Vector3 {
  const across = new Vector3(velocity.z, 0, -velocity.x).normalize();
  if (!Number.isFinite(across.x)) across.set(1, 0, 0);
  return across.multiplyScalar(amount * (0.7 + random() * 0.6)).add(new Vector3(0, (random() - 0.5) * amount * 0.6, 0));
}
