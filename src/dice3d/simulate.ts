import { Quaternion } from 'three';
import { d20Vertices } from './d20';
import { findImpacts } from '../audio/impacts';

/** Size of the dice tray (inner half-extents, in die-sized units) and of the die. */
export const TRAY = { halfX: 3.2, halfZ: 2.2, wallHeight: 3 };
export const DIE_RADIUS = 0.6;

export interface DiceRun {
  /** 7 numbers per step: position x, y, z, then rotation quaternion x, y, z, w. */
  frames: Float32Array;
  steps: number;
  /** Seconds per recorded step. */
  dt: number;
  final: Quaternion;
  /** Steps where the die hit the felt or a wall, with how hard (0..1): for the clack sounds. */
  impacts: { step: number; strength: number }[];
}

const MAX_STEPS = 60 * 8;
const GRAVITY = 9.81 * 2.2;

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
 * Throws a d20 across the tray with real rigid-body physics (Rapier) and records the
 * whole flight. The engine has already decided the number; the caller only uses the
 * resting orientation to pick which way to put the numbered skin on (see d20.ts).
 * Rapier is loaded lazily so the main bundle stays small.
 */
export async function simulateRoll(random: () => number = Math.random): Promise<DiceRun> {
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
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6).setRestitution(0.3),
        walls,
      );
    }

    const r = () => random() * 2 - 1;
    const start = new Quaternion(r(), r(), r(), r()).normalize();
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(-TRAY.halfX + 0.9, 2.2 + random() * 0.6, r() * (TRAY.halfZ - 0.9))
        .setRotation({ x: start.x, y: start.y, z: start.z, w: start.w })
        .setLinvel(7 + random() * 3, 1 + random() * 2, r() * 2)
        .setAngvel({ x: r() * 18, y: r() * 18, z: r() * 18 })
        .setLinearDamping(0.15)
        .setAngularDamping(0.35)
        .setCcdEnabled(true),
    );
    const points = new Float32Array(d20Vertices(DIE_RADIUS).flatMap((v) => [v.x, v.y, v.z]));
    world.createCollider(RAPIER.ColliderDesc.convexHull(points)!.setFriction(0.5).setRestitution(0.35).setDensity(1), body);

    const frames = new Float32Array(MAX_STEPS * 7);
    let steps = 0;
    while (steps < MAX_STEPS) {
      world.step();
      const p = body.translation();
      const q = body.rotation();
      frames.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], steps * 7);
      steps++;
      if (body.isSleeping()) break;
    }
    const q = body.rotation();
    const recorded = frames.slice(0, steps * 7);
    return {
      frames: recorded,
      steps,
      dt: world.timestep,
      final: new Quaternion(q.x, q.y, q.z, q.w),
      impacts: findImpacts(recorded, world.timestep, GRAVITY, { threshold: 1.2, fullScale: 9 }),
    };
  } finally {
    world.free();
  }
}
