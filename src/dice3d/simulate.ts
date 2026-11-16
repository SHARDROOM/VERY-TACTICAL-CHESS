import { Quaternion } from 'three';
import { findImpacts } from '../audio/impacts';

/** Size of the dice tray (inner half-extents, in die-sized units) and of the die. */
/** `rim`: how high the tray's wooden rim stands (drawn; hard throws hit it high). `wallHeight`: the
 * invisible walls above it that keep a die in. */
export const TRAY = { halfX: 3.2, halfZ: 2.2, wallHeight: 3, rim: 1.0 };
/** The die is a cube with rounded edges: its faces are DIE_HALF from its centre. */
export const DIE_HALF = 0.42;
export const DIE_ROUNDING = 0.07;

export interface DiceRun {
  /** 7 numbers per step: position x, y, z, then rotation quaternion x, y, z, w. */
  frames: Float32Array;
  steps: number;
  /** Seconds per recorded step on screen (the playback is slowed, see PLAYBACK). */
  dt: number;
  final: Quaternion;
  /** Steps where the die hit the felt or a wall, with how hard (0..1): for the clack sounds. */
  impacts: { step: number; strength: number }[];
}

const MAX_STEPS = 60 * 8;
/**
 * How hard a die is thrown (사용자 요청: harder): across the tray at 12–16 per second, a little
 * up, spinning fast. It slams into the far wall and comes back before it settles.
 */
const THROW = { height: [1.0, 0.4], speed: [12, 4], up: [-1, 1.5], side: 3, spin: 32 } as const;
/** How lively the die and the tray's walls and felt are. */
const DIE_BOUNCE = 0.4;
const WALL_BOUNCE = 0.42;
const GRAVITY = 9.81 * 2.2;
/**
 * The recorded throw plays back at this speed (사용자 요청: it rolled too briefly): the same path,
 * a little slower, so the die looks bigger and heavier and rolls for about three seconds (2.2–5.3). Slowing
 * the playback rather than the physics keeps it inside the tray's rim.
 */
const PLAYBACK = 0.6;

let physics: Promise<typeof import('@dimforge/rapier3d-compat').default> | null = null;

/** Loads and initialises the physics engine once (safe to call early, e.g. while the player thinks). */
export function loadPhysics() {
  physics ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    await m.default.init();
    return m.default;
  });
  return physics;
}

/**
 * Throws a d6 across the tray with real rigid-body physics (Rapier) and records the
 * whole flight. The engine has already decided the number; the caller only uses the
 * resting orientation to pick which way to put the pipped skin on (see d6.ts).
 * Rapier is loaded lazily so the main bundle stays small.
 */
export async function simulateRoll(random: () => number = Math.random): Promise<DiceRun> {
  return (await simulateRolls(1, random))[0];
}

/**
 * Throws `count` dice together: they fly side by side, can knock into each other, and are
 * recorded until all of them rest, so every run has the same number of steps.
 */
export async function simulateRolls(count: number, random: () => number = Math.random): Promise<DiceRun[]> {
  return throwDice(count, random);
}

/**
 * Throws `count` dice one after another (a clash: the attacker's, then the defender's): each is
 * thrown in its own lane once the ones before it rest, and lands among them (they stay put).
 */
export async function simulateRollsInTurn(count: number, random: () => number = Math.random): Promise<DiceRun[]> {
  const runs: DiceRun[] = [];
  for (let i = 0; i < count; i++) {
    const resting = runs.map((r) => {
      const o = (r.steps - 1) * 7;
      return { position: [r.frames[o], r.frames[o + 1], r.frames[o + 2]] as [number, number, number], rotation: r.final };
    });
    runs.push((await throwDice(1, random, { lane: ((i + 0.5) / count - 0.5) * (TRAY.halfZ * 1.4), resting }))[0]);
  }
  return runs;
}

/** How squarely a die in orientation `q` lies on a face: 1 flat, less when tilted (its most upward axis' height). */
function uprightness(q: { x: number; y: number; z: number; w: number }): number {
  const { x, y, z, w } = q;
  // The y components of the die's own x, y and z axes turned by q.
  return Math.max(Math.abs(2 * (x * y + w * z)), Math.abs(1 - 2 * (x * x + z * z)), Math.abs(2 * (y * z - w * x)));
}

async function throwDice(
  count: number,
  random: () => number,
  opts: { lane?: number; resting?: { position: [number, number, number]; rotation: Quaternion }[] } = {},
): Promise<DiceRun[]> {
  const RAPIER = await loadPhysics();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  try {
    const walls = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const t = 0.25;
    const { halfX, halfZ, wallHeight } = TRAY;
    const boxes: [number, number, number, number, number, number][] = [
      [0, -t, 0, halfX + t, t, halfZ + t], // floor
      [halfX + t, wallHeight / 2, 0, t, wallHeight / 2, halfZ + t],
      [-halfX - t, wallHeight / 2, 0, t, wallHeight / 2, halfZ + t],
      [0, wallHeight / 2, halfZ + t, halfX + t, wallHeight / 2, t],
      [0, wallHeight / 2, -halfZ - t, halfX + t, wallHeight / 2, t],
    ];
    for (const [x, y, z, hx, hy, hz] of boxes) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6).setRestitution(WALL_BOUNCE),
        walls,
      );
    }

    const r = () => random() * 2 - 1;
    const core = DIE_HALF - DIE_ROUNDING;
    const cube = () => RAPIER.ColliderDesc.roundCuboid(core, core, core, DIE_ROUNDING);
    // Dice already thrown lie where they came to rest.
    for (const d of opts.resting ?? []) {
      const still = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(...d.position)
          .setRotation({ x: d.rotation.x, y: d.rotation.y, z: d.rotation.z, w: d.rotation.w }),
      );
      world.createCollider(cube().setFriction(0.5).setRestitution(0.35), still);
    }
    const bodies = Array.from({ length: count }, (_, i) => {
      const start = new Quaternion(r(), r(), r(), r()).normalize();
      const height = THROW.height[0] + random() * THROW.height[1];
      // One die: anywhere across; several: each in its own lane.
      const lane =
        opts.lane !== undefined
          ? opts.lane + r() * 0.2
          : count === 1
            ? r() * (TRAY.halfZ - 0.9)
            : ((i + 0.5) / count - 0.5) * (TRAY.halfZ * 1.4) + r() * 0.2;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(-TRAY.halfX + 0.9, height, lane)
          .setRotation({ x: start.x, y: start.y, z: start.z, w: start.w })
          .setLinvel(THROW.speed[0] + random() * THROW.speed[1], THROW.up[0] + random() * THROW.up[1], r() * THROW.side)
          .setAngvel({ x: r() * THROW.spin, y: r() * THROW.spin, z: r() * THROW.spin })
          .setLinearDamping(0.08)
          .setAngularDamping(0.2)
          .setCcdEnabled(true),
      );
      world.createCollider(cube().setFriction(0.5).setRestitution(DIE_BOUNCE).setDensity(1), body);
      return body;
    });

    const frames = bodies.map(() => new Float32Array(MAX_STEPS * 7));
    let steps = 0;
    let nudges = 0;
    while (steps < MAX_STEPS) {
      world.step();
      bodies.forEach((body, i) => {
        const p = body.translation();
        const q = body.rotation();
        frames[i].set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], steps * 7);
      });
      steps++;
      if (!bodies.every((b) => b.isSleeping())) continue;
      // One came to rest leaning on a wall (a cocked die: no clear face up): nudge it off and on.
      const cocked = bodies.filter((b) => uprightness(b.rotation()) < 0.97);
      if (!cocked.length || nudges >= 4) break;
      nudges++;
      for (const b of cocked) {
        const p = b.translation();
        const m = b.mass();
        b.wakeUp();
        b.applyImpulse({ x: -Math.sign(p.x) * 1.2 * m, y: 2.2 * m, z: -Math.sign(p.z) * 1.2 * m }, true);
        b.applyTorqueImpulse({ x: r() * 0.15 * m, y: 0, z: r() * 0.15 * m }, true);
      }
    }
    return bodies.map((body, i) => {
      const q = body.rotation();
      const recorded = frames[i].slice(0, steps * 7);
      return {
        frames: recorded,
        steps,
        dt: world.timestep / PLAYBACK,
        final: new Quaternion(q.x, q.y, q.z, q.w),
        impacts: findImpacts(recorded, world.timestep, GRAVITY, { threshold: 1.2, fullScale: 9 }),
      };
    });
  } finally {
    world.free();
  }
}
