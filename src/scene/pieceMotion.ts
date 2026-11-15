import type { ActKind, Entrance, MotionStyle, Square } from '../engine';

/**
 * Poses for staged piece motion: where a piece is, how it leans and turns, at a moment of a
 * styled trip, an entrance or an act. Pure (no three.js objects), so it is easy to test;
 * PieceMesh turns a pose into its transform. docs/SPEC.md, "GM 연출" (움직임).
 */

/** How one piece should move during a show (absolute times are performance.now() ms). */
export interface PieceDirection {
  /** Its trips across the board in this show, in order. */
  motions: { style: MotionStyle; duration: number }[];
  /** A piece created by the show: how it appears. */
  entrance?: { style: Entrance; duration: number };
  /** Acting in place. */
  acts: { kind: ActKind; start: number; duration: number }[];
  /** Turns into another piece (glows and changes shape). */
  morph?: boolean;
  /** Changes sides (colours swirl). */
  swirl?: boolean;
  /** Hops onto a carrier from this square. */
  boardFrom?: Square;
  /** Jumps off the carrier standing on this square. */
  appearFrom?: Square;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical axis (radians). */
  yaw: number;
  /** Lean toward the direction of travel (radians, + = forward). */
  lean: number;
  /** Tip sideways (radians), for falls and staggers. */
  roll: number;
  /** Overall size factor. */
  scale: number;
  /** Squash (1 = none, < 1 crouched). */
  squashY: number;
}

type P3 = { x: number; y: number; z: number };

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Overshoots a little, then settles at 1. */
const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

const pose = (at: P3, extra: Partial<Pose> = {}): Pose => ({ x: at.x, y: at.y, z: at.z, yaw: 0, lean: 0, roll: 0, scale: 1, squashY: 1, ...extra });
const mix = (a: P3, b: P3, t: number): P3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/**
 * A styled trip from `from` to `to` at progress `p` (0..1). `height` is the piece's height
 * (for burrowing out of sight). 'default' and 'fly' are physics flights and not handled here.
 */
export function stylePose(style: MotionStyle, from: P3, to: P3, p: number, height: number): Pose {
  p = clamp01(p);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const ux = dist > 1e-6 ? dx / dist : 0;
  const uz = dist > 1e-6 ? dz / dist : 0;
  switch (style) {
    case 'hop': {
      const hops = Math.max(1, Math.round(dist / 1.1));
      const q = p * hops;
      const k = Math.min(hops - 1, Math.floor(q));
      const f = q - k;
      const at = mix(from, to, (k + easeInOut(f)) / hops);
      // A little squash as it lands and pushes off.
      const squash = 1 - 0.18 * Math.max(0, 1 - Math.sin(Math.PI * f) * 3);
      return pose({ ...at, y: at.y + Math.sin(Math.PI * f) * (0.32 + 0.05 * Math.min(4, dist / hops)) }, { lean: 0.12 * Math.sin(Math.PI * f), squashY: p >= 1 ? 1 : squash });
    }
    case 'slide': {
      const at = mix(from, to, easeInOut(p));
      return pose(at, { lean: 0.16 * Math.sin(Math.PI * p), roll: 0.05 * Math.sin(Math.PI * 4 * p) * Math.sin(Math.PI * p) });
    }
    case 'teleport': {
      if (p < 0.4) {
        const q = p / 0.4;
        return pose({ ...from, y: from.y + 0.4 * q }, { scale: 1 - easeIn(q), yaw: q * Math.PI });
      }
      if (p < 0.55) return pose(to, { scale: 0 });
      const q = (p - 0.55) / 0.45;
      return pose({ ...to, y: to.y + 0.4 * (1 - easeOut(q)) }, { scale: Math.max(0, easeOutBack(q)), yaw: Math.PI + q * Math.PI });
    }
    case 'charge': {
      const back = 0.2;
      const start = { x: from.x - ux * back, y: from.y, z: from.z - uz * back };
      const past = { x: to.x + ux * 0.12, y: to.y, z: to.z + uz * 0.12 };
      if (p < 0.25) {
        const q = easeOut(p / 0.25);
        return pose(mix(from, start, q), { lean: -0.28 * q, squashY: 1 - 0.1 * q });
      }
      if (p < 0.85) {
        const q = (p - 0.25) / 0.6;
        return pose(mix(start, past, easeIn(q)), { lean: -0.28 + 0.63 * Math.min(1, q * 3) });
      }
      const q = (p - 0.85) / 0.15;
      return pose(mix(past, to, easeOut(q)), { lean: 0.35 * (1 - q) });
    }
    case 'sneak': {
      const at = mix(from, to, easeInOut(p));
      const steps = Math.max(3, Math.round(dist * 2.5));
      const bob = Math.abs(Math.sin(Math.PI * steps * p));
      const edge = Math.min(1, p * 8, (1 - p) * 8);
      return pose({ ...at, y: at.y + 0.04 * bob * edge }, { squashY: 1 - 0.18 * edge, roll: 0.07 * Math.sin(Math.PI * steps * p) * edge, lean: 0.12 * edge });
    }
    case 'spin': {
      const e = easeInOut(p);
      const at = mix(from, to, e);
      const turns = 2 + Math.floor(dist / 2);
      return pose({ ...at, y: at.y + Math.sin(Math.PI * p) * (0.5 + 0.15 * dist) }, { yaw: e * turns * Math.PI * 2, lean: 0.2 * Math.sin(Math.PI * p) });
    }
    case 'burrow': {
      const deep = height + 0.15;
      if (p < 0.3) {
        const q = easeIn(p / 0.3);
        return pose({ ...from, y: from.y - deep * q }, { yaw: q * Math.PI, roll: 0.06 * Math.sin(q * 40) });
      }
      if (p < 0.7) return pose({ ...mix(from, to, (p - 0.3) / 0.4), y: -deep - 0.2 }, { scale: 0 });
      const q = easeOut((p - 0.7) / 0.3);
      return pose({ ...to, y: to.y - deep * (1 - q) }, { yaw: Math.PI + q * Math.PI, roll: 0.06 * Math.sin(q * 40) * (1 - q) });
    }
    default: {
      const at = mix(from, to, easeInOut(p));
      return pose({ ...at, y: at.y + Math.sin(Math.PI * p) * 0.4 });
    }
  }
}

/** A piece appearing on `at` (progress p 0..1). 'default' and 'drop' are physics drops. */
export function entrancePose(style: Entrance, at: P3, p: number, height: number): Pose {
  p = clamp01(p);
  if (style === 'rise') {
    // Up out of the board, wobbling as it settles.
    const q = easeOutBack(p);
    return pose({ ...at, y: at.y - (height + 0.05) * (1 - q) }, { roll: 0.12 * Math.sin(p * 18) * (1 - p) });
  }
  // materialize: from a point of light, growing and turning.
  return pose({ ...at, y: at.y + 0.3 * (1 - easeOut(p)) }, { scale: Math.max(0, easeOutBack(p)), yaw: (1 - easeOut(p)) * Math.PI * 2 });
}

/** An act in place at progress q (0..1); `t` is seconds, for jitter. The piece ends where it began. */
export function actPose(kind: ActKind, q: number, t: number): Pose {
  q = clamp01(q);
  const fade = q >= 1 ? 0 : 1;
  switch (kind) {
    case 'hop':
      return pose({ x: 0, y: Math.abs(Math.sin(Math.PI * 2 * q)) * 0.32, z: 0 }, { squashY: 1 - 0.12 * Math.max(0, 1 - Math.abs(Math.sin(Math.PI * 2 * q)) * 4) * fade });
    case 'stagger':
      return pose({ x: 0.09 * Math.sin(Math.PI * 3 * q) * (1 - q), y: 0, z: 0 }, { roll: 0.32 * Math.sin(Math.PI * 4 * q) * (1 - q) });
    case 'fall': {
      // Topples over fast, lies there, then gets back up.
      const down = q < 0.25 ? easeIn(q / 0.25) : q < 0.6 ? 1 : 1 - easeInOut((q - 0.6) / 0.4);
      const bounce = q >= 0.25 && q < 0.35 ? 0.06 * Math.sin(((q - 0.25) / 0.1) * Math.PI) : 0;
      return pose({ x: 0, y: 0.28 * down + bounce, z: 0 }, { roll: (Math.PI / 2) * down });
    }
    case 'shiver': {
      const a = 0.03 * Math.sin(Math.PI * q) * fade;
      return pose({ x: a * Math.sin(t * 97), y: 0, z: a * Math.sin(t * 83 + 1) }, { roll: 0.04 * Math.sin(t * 71) * Math.sin(Math.PI * q) * fade });
    }
    case 'spin':
      return pose({ x: 0, y: 0.12 * Math.sin(Math.PI * q), z: 0 }, { yaw: easeInOut(q) * Math.PI * 2 * fade });
  }
}
