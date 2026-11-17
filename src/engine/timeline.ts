import type { Board, Effect } from './types';
import { STAGING_LIMITS, type ActKind, type Beat, type Exit, type MotionStyle, type Speed, type Staging } from './staging';
import { planeOf } from './squares';

/**
 * When each part of a show happens: the outcome's effects one after another (each after its
 * beat's wait), effects with their particle fx, and in-place acts. Pure, so the authority can
 * add the show's length to the turn clock and every screen plays the same schedule.
 * docs/SPEC.md, "GM 연출" (재생).
 */

export interface Timeline {
  /** Seconds from the start of the show, per effect. */
  effectStarts: number[];
  effectDurations: number[];
  fxStarts: number[];
  fxEnds: number[];
  actStarts: number[];
  actDurations: number[];
  /** When the shake hits (with the first effect, or the first fx if there is no effect). */
  shakeAt: number | null;
  /** Whole show in seconds, at most STAGING_LIMITS.seconds. */
  length: number;
  /** How much everything was squeezed to fit the limit (1 = not at all). */
  scale: number;
}

const SPEED_FACTOR: Record<Speed, number> = { slow: 1.6, normal: 1, fast: 0.6 };

/** Seconds a move takes in each style, for a trip of `d` squares at normal speed. */
export function moveDuration(style: MotionStyle, d: number, speed: Speed = 'normal'): number {
  const base: Record<MotionStyle, number> = {
    default: Math.min(2, 0.9 + 0.08 * d),
    fly: Math.min(2, 0.9 + 0.08 * d),
    hop: 0.45 + 0.06 * d,
    slide: 0.5 + 0.12 * d,
    teleport: 0.9,
    charge: 0.25 + 0.05 * d,
    sneak: Math.min(3, 0.8 + 0.25 * d),
    spin: 0.8 + 0.1 * d,
    burrow: 1.2 + 0.05 * d,
  };
  return base[style] * SPEED_FACTOR[speed];
}

export const ACT_DURATION: Record<ActKind, number> = { hop: 0.7, stagger: 1, fall: 1.6, shiver: 0.8, spin: 0.9 };

/** A plain swap: both pieces lift and cross over each other. */
export const SWAP_DURATION = 1.1;
/** 융합: the piece taken in swirls up into its crown place. */
export const FUSE_DURATION = 1.4;
/** A plain revival: the piece flies back from beside the board to its square. */
export const REVIVE_DURATION = 1.3;

/** Seconds a removal takes on screen, by how the piece leaves. */
export const EXIT_DURATION: Record<Exit, number> = { default: 1, knock: 1, burn: 1.2, ash: 1.3, shatter: 1.4, vanish: 1, sink: 1.1 };

function distance(a: number, b: number): number {
  const p = planeOf(a);
  const q = planeOf(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** How long one effect takes on screen. `board` is the board just before it (for distances). */
export function effectDuration(effect: Effect, beat: Beat | undefined, _board?: Board): number {
  const speed = beat?.speed ?? 'normal';
  switch (effect.type) {
    case 'move':
      return moveDuration(beat?.motion ?? 'default', distance(effect.from, effect.to), speed);
    case 'unboard':
      return moveDuration(beat?.motion === 'default' || !beat ? 'hop' : beat.motion, distance(effect.at, effect.to), speed);
    case 'swap':
      // Both at once, crossing over (a plain swap is a scripted arc, not a physics flight).
      return beat && beat.motion !== 'default' ? moveDuration(beat.motion, distance(effect.a, effect.b), speed) : SWAP_DURATION * (speed === 'slow' ? 1.6 : speed === 'fast' ? 0.6 : 1);
    case 'revive': {
      const entrance = beat?.entrance ?? 'default';
      return entrance === 'rise' ? 1.2 : entrance === 'materialize' ? 1 : REVIVE_DURATION;
    }
    case 'terrain':
      return effect.kind === 'wall' ? 0.9 : 1;
    case 'clearTerrain':
      return 0.7;
    case 'spawn': {
      const entrance = beat?.entrance ?? 'default';
      return entrance === 'rise' ? 0.9 : entrance === 'materialize' ? 0.8 : 1.2;
    }
    case 'remove':
      return EXIT_DURATION[beat?.exit ?? 'default'];
    case 'board':
      return 0.6;
    case 'fuse':
      // The piece taken in spirals in and settles as a crown.
      return FUSE_DURATION;
    case 'split':
      return 0.8;
    case 'transform':
      return 0.6;
    case 'convert':
      return 0.7;
    default:
      return 0.3;
  }
}

/** The schedule of a show. `staging` may be missing (default look: effects in order, no fx). */
export function buildTimeline(staging: Staging | undefined, effects: Effect[]): Timeline {
  const beatFor = (i: number) => staging?.beats.find((b) => b.effect === i);
  const effectStarts: number[] = [];
  const effectDurations: number[] = [];
  let t = 0;
  effects.forEach((e, i) => {
    const beat = beatFor(i);
    t += beat?.wait ?? 0;
    effectStarts.push(t);
    const d = effectDuration(e, beat);
    effectDurations.push(d);
    t += d;
  });

  const fxStarts: number[] = [];
  const fxEnds: number[] = [];
  for (const f of staging?.fx ?? []) {
    const anchor = f.withEffect !== null && f.withEffect < effects.length ? effectStarts[f.withEffect] : 0;
    const start = anchor + f.delay;
    fxStarts.push(start);
    fxEnds.push(f.shape === 'trail' && f.withEffect !== null && f.withEffect < effects.length ? effectStarts[f.withEffect] + effectDurations[f.withEffect] + 0.3 : start + f.duration);
  }

  const actStarts = (staging?.acts ?? []).map((a) => a.delay);
  const actDurations = (staging?.acts ?? []).map((a) => ACT_DURATION[a.act]);

  const ends = [t, ...fxEnds, ...actStarts.map((s, i) => s + actDurations[i])];
  const raw = Math.max(0, ...ends);
  const scale = raw > STAGING_LIMITS.seconds ? STAGING_LIMITS.seconds / raw : 1;
  const s = (x: number) => x * scale;
  const shakeRaw = staging && staging.shake > 0 ? (effects.length ? effectStarts[0] : fxStarts.length ? Math.min(...fxStarts) : 0) : null;
  return {
    effectStarts: effectStarts.map(s),
    effectDurations: effectDurations.map(s),
    fxStarts: fxStarts.map(s),
    fxEnds: fxEnds.map(s),
    actStarts: actStarts.map(s),
    actDurations: actDurations.map(s),
    shakeAt: shakeRaw === null ? null : s(shakeRaw),
    length: s(raw),
    scale,
  };
}
