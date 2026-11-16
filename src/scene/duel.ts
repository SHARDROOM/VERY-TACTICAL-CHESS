import { Quaternion, Vector3 } from 'three';
import { DUEL_TIMING, clashSkill, type Board, type GameEvent, type Piece, type PieceType } from '../engine';
import { loadPhysics } from '../dice3d/simulate';
import { addPieceColliders } from './piecePhysics';
import { squareToWorld } from './coords';
import { TABLE_TOP_Y } from './WoodTable';

/*
 * The duel of a clash (합) on screen: the attacker steps up to the defender, they meet as many
 * times as the clash's exchanges with real rigid-body physics (Rapier), and the decisive blow
 * cuts the loser down, knocks it flying, or bursts a shield. Simulated ahead and recorded, like
 * the dice; the pieces play the recording back. docs/SPEC.md, "합과 조형물".
 */

type ClashEvent = Extract<GameEvent, { type: 'clash' }>;

/** How the loser goes: cut down (shatters on the spot), knocked flying, or only its shield bursts. */
export type Finale = 'shatter' | 'knock' | 'shield';

export interface DuelPlan {
  attackerId: string;
  defenderId: string;
  /** Who fights (`rider`: whoever rides it, along for the fight). */
  attacker: { type: PieceType; rider?: PieceType; home: Vector3; stance: Vector3 };
  defender: { type: PieceType; rider?: PieceType; home: Vector3 };
  exchanges: number;
  winner: 'attacker' | 'defender';
  finale: Finale;
}

export interface DuelRun {
  /** 7 numbers per step for each piece: position, then rotation quaternion. */
  attacker: Float32Array;
  defender: Float32Array;
  steps: number;
  dt: number;
  /** When they meet (seconds into the run), how hard, and whether it is the decisive blow. */
  hits: { t: number; strength: number; final: boolean }[];
  /** Where they meet, for the sparks. */
  contact: Vector3;
}

/** Who fights from a square: the carrier (with its rider on top), or the rider itself. */
const fighter = (p: Piece, id: string): { type: PieceType; rider?: PieceType } =>
  p.id === id ? { type: p.type, ...(p.rider && { rider: p.rider.type }) } : { type: (p.rider as Piece).type };

/** The duel for a clash on this board. `maxExchanges` cuts it short (the "light" setting). */
export function planDuel(clash: ClashEvent, board: Board, maxExchanges = 6): DuelPlan | null {
  const a = board[clash.from];
  const d = board[clash.at];
  if (!a || !d) return null;
  const home = new Vector3(...squareToWorld(clash.from));
  const target = new Vector3(...squareToWorld(clash.at));
  // It steps up to just short of the defender (from wherever it came: a rook from across the board).
  const dir = home.clone().sub(target).setY(0);
  const len = dir.length() || 1;
  const stance = target.clone().add(dir.multiplyScalar(Math.min(len, 0.95) / len));
  // A winner with skill (a weapon) cuts the loser down; anyone else knocks it over.
  const finale: Finale =
    clash.winner === 'defender' ? (clashSkill(d) > 1 ? 'shatter' : 'knock') : clash.shield ? 'shield' : clashSkill(a) > 1 ? 'shatter' : 'knock';
  return {
    attackerId: clash.attackerId,
    defenderId: clash.defenderId,
    attacker: { ...fighter(a, clash.attackerId), home, stance },
    defender: { ...fighter(d, clash.defenderId), home: target },
    exchanges: Math.max(1, Math.min(maxExchanges, clash.exchanges)),
    winner: clash.winner,
    finale,
  };
}

const UP = new Quaternion();
const G = 9.81 * 2.5;
const DT = 1 / 60;

/** Collects both pieces' poses step by step. */
class Recorder {
  a: number[] = [];
  d: number[] = [];
  hits: DuelRun['hits'] = [];
  get steps() {
    return this.a.length / 7;
  }
  push(pa: Vector3, qa: Quaternion, pd: Vector3, qd: Quaternion) {
    this.a.push(pa.x, pa.y, pa.z, qa.x, qa.y, qa.z, qa.w);
    this.d.push(pd.x, pd.y, pd.z, qd.x, qd.y, qd.z, qd.w);
  }
  last(which: 'a' | 'd'): { p: Vector3; q: Quaternion } {
    const f = which === 'a' ? this.a : this.d;
    const o = f.length - 7;
    return { p: new Vector3(f[o], f[o + 1], f[o + 2]), q: new Quaternion(f[o + 3], f[o + 4], f[o + 5], f[o + 6]) };
  }
  /** Glides both from where they are to `pa`/`pd`, standing up, over `seconds`. */
  glide(pa: Vector3, pd: Vector3, seconds: number, lift = 0) {
    const from = { a: this.last('a'), d: this.last('d') };
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const hop = Math.sin(Math.PI * t) * lift;
      this.push(
        from.a.p.clone().lerp(pa, e).setY(from.a.p.y + (pa.y - from.a.p.y) * e + hop),
        from.a.q.clone().slerp(UP, e),
        from.d.p.clone().lerp(pd, e),
        from.d.q.clone().slerp(UP, e),
      );
    }
  }
  run(contact: Vector3): DuelRun {
    return { attacker: Float32Array.from(this.a), defender: Float32Array.from(this.d), steps: this.steps, dt: DT, hits: this.hits, contact };
  }
}

/** Seconds each part of the duel takes (the camera's part is the screen's). */
const T = DUEL_TIMING;

/**
 * Simulates the duel with Rapier: between exchanges the two are stood back up on their spots;
 * each exchange both lunge and meet; in the last one the winner strikes and the loser goes
 * as the finale says. Falls back to a scripted duel if physics cannot run.
 */
export async function simulateDuel(plan: DuelPlan): Promise<DuelRun> {
  let RAPIER: Awaited<ReturnType<typeof loadPhysics>>;
  try {
    RAPIER = await loadPhysics();
  } catch {
    return scriptedDuel(plan);
  }
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // The board (top at y = 0) and the table around it.
    world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, 0.1, 4.6).setTranslation(0, -0.1, 0).setFriction(0.7).setRestitution(0.15), fixed);
    // A fight in the air (공중부양) stands on the air layer.
    const floor = plan.defender.home.y;
    if (floor > 0.5) world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.05, 4).setTranslation(0, floor - 0.05, 0).setFriction(0.7).setRestitution(0.15), fixed);
    world.createCollider(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, TABLE_TOP_Y - 0.3, 0).setFriction(0.7).setRestitution(0.15), fixed);
    // A weighted base: they rock and stand rather than topple at every touch; a rider rides along, glued on.
    const body = (side: { type: PieceType; rider?: PieceType }, at: Vector3) => {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setLinearDamping(0.2).setAngularDamping(1.2).setCcdEnabled(true));
      addPieceColliders(RAPIER, world, b, side.type, { rider: side.rider, friction: 0.5, footFriction: 0.6, restitution: 0.45, footDensity: 8 });
      return b;
    };
    const { attacker: A, defender: D } = plan;
    const ba = body(A, A.home);
    const bd = body(D, D.home);
    const toward = D.home.clone().sub(A.stance).setY(0).normalize();
    const contact = A.stance.clone().lerp(D.home, 0.5);
    const rec = new Recorder();
    rec.push(A.home, UP, D.home, UP);

    const place = (b: typeof ba, p: Vector3, q: Quaternion = UP) => {
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };
    const pose = (b: typeof ba) => {
      const p = b.translation();
      const q = b.rotation();
      return { p: new Vector3(p.x, p.y, p.z), q: new Quaternion(q.x, q.y, q.z, q.w) };
    };
    /** Steps the world for up to `seconds`, recording; stops early once they have met and parted. */
    const lunge = (seconds: number, final: boolean, after?: () => void) => {
      const n = Math.round(seconds / DT);
      let met = false;
      for (let i = 0; i < n; i++) {
        const before = ba.linvel().x * toward.x + ba.linvel().z * toward.z - (bd.linvel().x * toward.x + bd.linvel().z * toward.z);
        world.step();
        const now = ba.linvel().x * toward.x + ba.linvel().z * toward.z - (bd.linvel().x * toward.x + bd.linvel().z * toward.z);
        const pa = pose(ba);
        const pd = pose(bd);
        rec.push(pa.p, pa.q, pd.p, pd.q);
        if (!met && before > 0.5 && now < before * 0.4) {
          met = true;
          rec.hits.push({ t: rec.steps * DT, strength: Math.min(1, before / 7), final });
          after?.();
          if (!final) n > i + 12 && (i = n - 12); // part for a moment, then stand back up
        }
      }
      return met;
    };

    // Step up to the defender.
    rec.glide(A.stance, D.home, T.approach, 0.15);
    for (let k = 0; k < plan.exchanges; k++) {
      const final = k === plan.exchanges - 1;
      place(ba, A.stance);
      place(bd, D.home);
      if (!final) {
        // Both lunge and meet; then they are stood back up on their spots.
        ba.setLinvel({ x: toward.x * 3.4, y: 1.3, z: toward.z * 3.4 }, true);
        bd.setLinvel({ x: -toward.x * 3.4, y: 1.3, z: -toward.z * 3.4 }, true);
        lunge(T.exchange * 0.6, false);
        rec.glide(A.stance, D.home, T.exchange * 0.4);
        continue;
      }
      // The decisive blow: the winner strikes, the loser barely moves.
      const winnerBody = plan.winner === 'attacker' ? ba : bd;
      const loserBody = plan.winner === 'attacker' ? bd : ba;
      const sign = plan.winner === 'attacker' ? 1 : -1;
      winnerBody.setLinvel({ x: toward.x * 5.2 * sign, y: 1.6, z: toward.z * 5.2 * sign }, true);
      loserBody.setLinvel({ x: -toward.x * 0.8 * sign, y: 0.4, z: -toward.z * 0.8 * sign }, true);
      const hit = () => {
        if (plan.finale === 'knock') {
          // Knocked flying, tumbling away from the winner.
          loserBody.setLinvel({ x: toward.x * 4.2 * sign, y: 4.5, z: toward.z * 4.2 * sign }, true);
          loserBody.setAngvel({ x: toward.z * 9 * sign, y: 2, z: -toward.x * 9 * sign }, true);
        } else if (plan.finale === 'shield') {
          // The shield takes it: the defender reels, the attacker bounces off.
          ba.setLinvel({ x: -toward.x * 3, y: 1.5, z: -toward.z * 3 }, true);
          bd.setLinvel({ x: toward.x * 1.2, y: 0.6, z: toward.z * 1.2 }, true);
        }
      };
      lunge(plan.finale === 'knock' ? T.finale : T.finale * 0.55, true, hit);
      if (plan.finale !== 'knock') {
        // Cut down where it stands (the shards come next), or both settle after the shield burst.
        const last = { a: rec.last('a'), d: rec.last('d') };
        rec.glide(plan.winner === 'attacker' && plan.finale === 'shatter' ? A.stance : last.a.p.setY(0), last.d.p.setY(0), T.finale * 0.45);
      }
    }
    if (!rec.hits.some((h) => h.final)) rec.hits.push({ t: rec.steps * DT * 0.8, strength: 0.8, final: true });
    return rec.run(contact);
  } catch {
    return scriptedDuel(plan);
  } finally {
    world.free();
  }
}

/** The same duel without physics: lunges and a scripted finish. */
export function scriptedDuel(plan: DuelPlan): DuelRun {
  const { attacker: A, defender: D } = plan;
  const contact = A.stance.clone().lerp(D.home, 0.5);
  const rec = new Recorder();
  rec.push(A.home, UP, D.home, UP);
  rec.glide(A.stance, D.home, T.approach, 0.15);
  const meet = (strike: number, final: boolean) => {
    rec.glide(A.stance.clone().lerp(contact, strike), D.home.clone().lerp(contact, final ? 0.2 : strike), T.exchange * 0.3, 0.2);
    rec.hits.push({ t: rec.steps * DT, strength: final ? 1 : 0.6, final });
    rec.glide(A.stance, D.home, T.exchange * 0.3);
  };
  for (let k = 0; k < plan.exchanges - 1; k++) meet(0.55, false);
  meet(0.7, true);
  if (plan.finale === 'knock') {
    const away = (plan.winner === 'attacker' ? D.home.clone().sub(A.stance) : A.stance.clone().sub(D.home)).setY(0).normalize().multiplyScalar(1.6);
    if (plan.winner === 'attacker') rec.glide(A.stance, D.home.clone().add(away), T.finale * 0.6, 0.8);
    else rec.glide(A.stance.clone().add(away), D.home, T.finale * 0.6, 0.8);
  }
  return rec.run(contact);
}

/** The pose of a piece `seconds` into a duel run (the last pose once it is over). */
export function duelPose(run: DuelRun, who: 'attacker' | 'defender', seconds: number, out: { p: Vector3; q: Quaternion }) {
  const f = who === 'attacker' ? run.attacker : run.defender;
  const step = Math.max(0, Math.min(run.steps - 1, Math.floor(seconds / run.dt)));
  const o = step * 7;
  out.p.set(f[o], f[o + 1], f[o + 2]);
  out.q.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
  return out;
}

export const duelLength = (run: DuelRun) => run.steps * run.dt;
