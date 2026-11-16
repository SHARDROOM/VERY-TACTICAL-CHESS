import { Quaternion, Vector3 } from 'three';
import type { PieceType } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { G, addObstacles, addPieceColliders, addTable, type Obstacles } from './piecePhysics';

/*
 * A thing in the player's hand, simulated as it happens (docs/SPEC.md, "만지작거리기"): it hangs by
 * the spot where it was picked up, swinging under its own weight, and is tied to the finger by a
 * soft, springy band: it lags behind, overshoots and bobs. Whatever is in its way (the board's
 * pieces, chunks, taken pieces, the dice, the tray, the table) stops it: it strains toward the
 * finger but cannot get through. Let go of, it flies on as it was moving, falls and comes to rest.
 * The board's pieces follow where they are shown, frame by frame: one moving past (a move, a romp,
 * a throw) shoves the thing out of its way, held or not (사용자 요청).
 */

export type HeldThing = { kind: 'piece'; type: PieceType; scale: number } | { kind: 'chunk'; hull: Float32Array };

/** A piece on the board where it is shown right now (with whoever rides it). */
export interface ShownPiece {
  id: string;
  type: PieceType;
  riders?: PieceType[];
  p: Vector3;
  q: Quaternion;
}

type Rapier = Awaited<ReturnType<typeof loadPhysics>>;

const DT = 1 / 60;
/** The band: how stiff (per unit mass, s^-2: it springs about twice a second) and how damped (a little). */
const STIFF = 150;
const DAMPING_RATIO = 0.28;
/** It pulls no harder than this many times the thing's weight (so it strains against what blocks it). */
const MAX_PULL = 5;
/** Let go of, it is done once it has been still this long (steps), or after this long anyway (s). */
const STILL_STEPS = 20;
const MAX_AFTER = 5;

export class LiveDrag {
  private target: Vector3;
  private released = false;
  private acc = 0;
  private still = 0;
  private after = 0;
  private freed = false;
  /** The board's pieces, moved to where they are shown (kinematic: they push, nothing pushes them). */
  private readonly movers = new Map<string, { body: InstanceType<Rapier['RigidBody']>; from: Vector3; fromQ: Quaternion; to: Vector3; toQ: Quaternion }>();

  private constructor(
    private readonly RAPIER: Rapier,
    private readonly world: InstanceType<Rapier['World']>,
    private readonly body: InstanceType<Rapier['RigidBody']>,
    /** The spot it was picked up by, in its own frame. */
    private readonly anchor: Vector3,
    grab: Vector3,
    private readonly shown?: () => readonly ShownPiece[],
  ) {
    this.target = grab.clone();
  }

  /**
   * Picks up `thing`, lying at `p`, `q` (world), by the spot `grab` (world), among `obstacles` on a
   * table whose dice tray is on `diceSide`. With `shown`, the board's pieces are taken from it every
   * frame (where they are shown) instead of standing still where `obstacles` has them.
   */
  static async start(
    thing: HeldThing,
    p: Vector3,
    q: Quaternion,
    grab: Vector3,
    obstacles: Obstacles,
    diceSide: 1 | -1,
    shown?: () => readonly ShownPiece[],
  ): Promise<LiveDrag> {
    const RAPIER = await loadPhysics();
    const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    world.timestep = DT;
    const fixed = addTable(RAPIER, world, diceSide);
    addObstacles(RAPIER, world, fixed, shown ? { ...obstacles, pieces: [] } : obstacles);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.5)
        .setAngularDamping(1.6)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    if (thing.kind === 'piece') addPieceColliders(RAPIER, world, body, thing.type, { scale: thing.scale, friction: 0.5, restitution: 0.25, footDensity: 6 });
    else world.createCollider(RAPIER.ColliderDesc.convexHull(thing.hull)!.setDensity(1).setFriction(0.5).setRestitution(0.3), body);
    const anchor = grab.clone().sub(p).applyQuaternion(q.clone().invert());
    const drag = new LiveDrag(RAPIER, world, body, anchor, grab, shown);
    drag.follow();
    return drag;
  }

  /** Where the finger is now (world). */
  aim(target: Vector3): void {
    this.target.copy(target);
  }

  /** Let go of: no more pull; it flies on and falls. */
  letGo(): void {
    if (this.released) return;
    this.released = true;
    this.body.setLinearDamping(0.1);
    this.body.setAngularDamping(0.45);
  }

  get letGoOf(): boolean {
    return this.released;
  }

  /** Moves on by `dt` seconds and writes where it is into `p`, `q`; true once let go of and at rest. */
  step(dt: number, p: Vector3, q: Quaternion): boolean {
    if (this.freed) return true;
    this.acc += Math.min(dt, 0.1);
    const steps = Math.min(6, Math.floor(this.acc / DT));
    if (steps > 0) this.follow();
    for (let n = 0; n < steps; n++) {
      this.acc -= DT;
      this.moveMovers((n + 1) / steps);
      if (!this.released) this.pull();
      this.world.step();
      if (this.released) {
        this.after += DT;
        const v = this.body.linvel();
        const w = this.body.angvel();
        this.still = Math.hypot(v.x, v.y, v.z) < 0.05 && Math.hypot(w.x, w.y, w.z) < 0.08 ? this.still + 1 : 0;
      }
    }
    const t = this.body.translation();
    const r = this.body.rotation();
    p.set(t.x, t.y, t.z);
    q.set(r.x, r.y, r.z, r.w);
    return this.released && (this.still >= STILL_STEPS || this.after >= MAX_AFTER);
  }

  /**
   * Where the board's pieces are shown now: each is moved there over the coming steps. A piece new
   * to the board gets a body; one gone from it loses its own.
   */
  private follow(): void {
    if (!this.shown) return;
    const RAPIER = this.RAPIER;
    const seen = new Set<string>();
    for (const s of this.shown()) {
      seen.add(s.id);
      const m = this.movers.get(s.id);
      if (m) {
        const t = m.body.translation();
        const r = m.body.rotation();
        m.from.set(t.x, t.y, t.z);
        m.fromQ.set(r.x, r.y, r.z, r.w);
        m.to.copy(s.p);
        m.toQ.copy(s.q);
        continue;
      }
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.p.x, s.p.y, s.p.z).setRotation({ x: s.q.x, y: s.q.y, z: s.q.z, w: s.q.w }),
      );
      addPieceColliders(RAPIER, this.world, body, s.type, { riders: s.riders, friction: 0.5, restitution: 0.25, footDensity: 1 });
      this.movers.set(s.id, { body, from: s.p.clone(), fromQ: s.q.clone(), to: s.p.clone(), toQ: s.q.clone() });
    }
    for (const [id, m] of this.movers) {
      if (seen.has(id)) continue;
      this.world.removeRigidBody(m.body);
      this.movers.delete(id);
    }
  }

  /** The board's pieces `f` of the way from where they were to where they are shown. */
  private moveMovers(f: number): void {
    for (const m of this.movers.values()) {
      const p = m.from.clone().lerp(m.to, f);
      const q = m.fromQ.clone().slerp(m.toQ, f);
      m.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      m.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  /** The band's pull at the spot it is held by: springy, a little damped, never too strong. */
  private pull(): void {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    const at = this.anchor.clone().applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w)).add(new Vector3(t.x, t.y, t.z));
    const com = b.worldCom();
    const v = b.linvel();
    const w = b.angvel();
    const arm = new Vector3(at.x - com.x, at.y - com.y, at.z - com.z);
    const vAt = new Vector3(v.x, v.y, v.z).add(new Vector3(w.x, w.y, w.z).cross(arm));
    const m = b.mass();
    const k = STIFF * m;
    const c = 2 * DAMPING_RATIO * Math.sqrt(k * m);
    const force = this.target.clone().sub(at).multiplyScalar(k).sub(vAt.multiplyScalar(c));
    const most = MAX_PULL * m * G;
    if (force.length() > most) force.setLength(most);
    force.multiplyScalar(DT);
    b.applyImpulseAtPoint({ x: force.x, y: force.y, z: force.z }, { x: at.x, y: at.y, z: at.z }, true);
  }

  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }
}
