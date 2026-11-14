import { Quaternion, Vector3 } from 'three';
import { loadPhysics } from '../dice3d/simulate';
import { TABLE_TOP_Y } from '../scene/WoodTable';
import { findImpacts } from '../audio/impacts';

/** A gold coin: radius and half thickness, in board squares. */
export const COIN = { radius: 0.27, halfHeight: 0.032 };
/** The shallow wooden dish each player's coins land in. */
export const DISH = { radius: 1.05, rimHeight: 0.34, rimThickness: 0.12, baseHeight: 0.04 };

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

export interface CoinThrow {
  /** Steps of `dt` seconds. */
  dt: number;
  steps: number;
  /** Per new coin: the step it leaves the dealer's hand, and 7 numbers per step from then on. */
  coins: { start: number; frames: Float32Array; final: Pose; impacts: { step: number; strength: number }[] }[];
}

const MAX_STEPS = 60 * 7;
const G = 9.81 * 1.6;
/** How far before the dish centre a throw is aimed (coins skid on after landing). */
const AIM_SHORT = 0.3;

/**
 * Throws `count` coins from a dealer standing off the table edge (`fromX`) into the dish
 * at (`dishX`, `dishZ`). Coins already in the dish are solid but stay put. Rigid-body
 * physics (Rapier), simulated ahead of time and recorded for playback.
 */
export async function simulateCoinThrow(options: {
  count: number;
  dishX: number;
  dishZ: number;
  fromX: number;
  pile: Pose[];
  random?: () => number;
}): Promise<CoinThrow> {
  const { count, dishX, dishZ, fromX, pile } = options;
  const random = options.random ?? Math.random;
  const RAPIER = await loadPhysics();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const top = TABLE_TOP_Y;
    // Table top.
    world.createCollider(RAPIER.ColliderDesc.cuboid(14, 0.3, 9).setTranslation(0, top - 0.3, 0).setFriction(0.7).setRestitution(0.1), fixed);
    // Board frame, so a wild coin bounces off it instead of landing among the pieces.
    world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, 0.12, 4.6).setTranslation(0, top + 0.1, 0).setFriction(0.5), fixed);
    // The dish: a base and a ring of rim segments.
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(DISH.baseHeight / 2, DISH.radius).setTranslation(dishX, top + DISH.baseHeight / 2, dishZ).setFriction(1).setRestitution(0),
      fixed,
    );
    const segments = 24;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const r = DISH.radius + DISH.rimThickness / 2;
      const seg = (2 * Math.PI * r) / segments / 2 + 0.02;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(DISH.rimThickness / 2, DISH.rimHeight / 2, seg)
          .setTranslation(dishX + Math.cos(a) * r, top + DISH.rimHeight / 2, dishZ + Math.sin(a) * r)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.6)
          .setRestitution(0.1),
        fixed,
      );
    }
    // Coins already there: solid, but not part of this throw.
    for (const p of pile) {
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(COIN.halfHeight, COIN.radius)
          .setTranslation(p.position.x, p.position.y, p.position.z)
          .setRotation({ x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w })
          .setFriction(0.8),
        fixed,
      );
    }

    const r = () => random() * 2 - 1;
    const dir = Math.sign(dishX - fromX);
    const spacing = 9; // steps between coins leaving the hand
    const bodies: { start: number; body: ReturnType<typeof world.createRigidBody> | null; frames: number[] }[] = Array.from(
      { length: count },
      (_, i) => ({ start: i * spacing, body: null, frames: [] }),
    );

    let step = 0;
    for (; step < MAX_STEPS; step++) {
      for (const c of bodies) {
        if (c.start !== step) continue;
        const tilt = new Quaternion().setFromAxisAngle(new Vector3(r(), 0.2, r()).normalize(), r() * 1.2);
        // Aim: a gentle arc whose flight time we solve for, landing a little short of the
        // dish centre (coins skid forward a bit after touching down).
        const y0 = top + 2.4 + random() * 0.4;
        const z0 = dishZ + r() * 0.4;
        const vy = 6 + random() * 0.8;
        const drop = y0 - (top + 0.12);
        const t = (vy + Math.sqrt(vy * vy + 2 * G * drop)) / G;
        const aimX = dishX - dir * AIM_SHORT;
        c.body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(fromX, y0, z0)
            .setRotation({ x: tilt.x, y: tilt.y, z: tilt.z, w: tilt.w })
            .setLinvel(((aimX - fromX) / t) * (0.98 + random() * 0.04), vy, ((dishZ - z0) / t) * 0.9)
            .setAngvel({ x: r() * 12, y: r() * 5, z: r() * 12 })
            .setLinearDamping(0.05)
            .setAngularDamping(2.2)
            .setCcdEnabled(true),
        );
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(COIN.halfHeight, COIN.radius).setDensity(8).setFriction(0.95).setRestitution(0.05),
          c.body,
        );
      }
      world.step();
      for (const c of bodies) {
        if (!c.body) continue;
        const p = c.body.translation();
        const q = c.body.rotation();
        c.frames.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      }
      const allOut = bodies.every((c) => c.body);
      if (allOut && step > bodies[bodies.length - 1].start + 30 && bodies.every((c) => c.body!.isSleeping())) break;
    }

    return {
      dt: world.timestep,
      steps: step + 1,
      coins: bodies.map((c) => {
        const f = c.frames;
        const n = f.length - 7;
        const frames = Float32Array.from(f);
        return {
          start: c.start,
          frames,
          impacts: findImpacts(frames, world.timestep, G, { threshold: 1, fullScale: 7 }),
          final: {
            position: new Vector3(f[n], f[n + 1], f[n + 2]),
            quaternion: new Quaternion(f[n + 3], f[n + 4], f[n + 5], f[n + 6]),
          },
        };
      }),
    };
  } finally {
    world.free();
  }
}
