import type { Square } from './types';

/**
 * GM staging: how a ruling's outcome or a chaos event looks on the table. Purely visual:
 * the engine carries it with rulings and chaos events but never applies or checks it.
 * (Tag auras are the exception that stays on the board; see Tag.aura.) docs/SPEC.md, "GM 연출".
 */

export const ELEMENTS = ['fire', 'light', 'water', 'nature', 'darkness', 'lightning', 'ice', 'wind', 'poison', 'arcane', 'earth', 'impact'] as const;
export type Element = (typeof ELEMENTS)[number];

export const ELEMENT_NAME: Record<Element, string> = {
  fire: '불',
  light: '빛',
  water: '물',
  nature: '풀·덩굴',
  darkness: '어둠·연기',
  lightning: '번개',
  ice: '얼음',
  wind: '바람·먼지',
  poison: '독',
  arcane: '마력',
  earth: '흙·돌',
  impact: '충격',
};

export const FX_SHAPES = ['burst', 'beam', 'area', 'trail'] as const;
export type FxShape = (typeof FX_SHAPES)[number];

export const MOTION_STYLES = ['default', 'fly', 'hop', 'slide', 'teleport', 'charge', 'sneak', 'spin', 'burrow'] as const;
export type MotionStyle = (typeof MOTION_STYLES)[number];

export const SPEEDS = ['slow', 'normal', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];

export const ENTRANCES = ['default', 'drop', 'rise', 'materialize'] as const;
export type Entrance = (typeof ENTRANCES)[number];

export const EXITS = ['default', 'knock', 'burn', 'ash', 'vanish', 'sink', 'shatter'] as const;
export type Exit = (typeof EXITS)[number];

export const ACTS = ['hop', 'stagger', 'fall', 'shiver', 'spin'] as const;
export type ActKind = (typeof ACTS)[number];

/** One particle effect. */
export interface Fx {
  element: Element;
  shape: FxShape;
  /** Burst: centre. Beam: start. Area: one corner (null with `to` null = the whole board). Trail: unused. */
  at: Square | null;
  /** Beam: end. Area: the other corner. */
  to: Square | null;
  /** Burst only, in squares (0.5..3). */
  radius: number;
  /** 1..5 */
  strength: number;
  /** Seconds (0.5..5); a trail lasts as long as its piece moves. */
  duration: number;
  /** Starts together with this effect (0-based index); null = counted from the start of the show. Trails follow it. */
  withEffect: number | null;
  /** Seconds after that moment (0..5). */
  delay: number;
}

/** How one rule effect of the outcome is shown. */
export interface Beat {
  /** 0-based index into the outcome's effects. */
  effect: number;
  /** Seconds to wait before this effect shows (0..2). */
  wait: number;
  motion: MotionStyle;
  speed: Speed;
  entrance: Entrance;
  exit: Exit;
}

/** A piece acting on its square without the board changing. */
export interface Act {
  at: Square;
  act: ActKind;
  delay: number;
}

export interface Staging {
  fx: Fx[];
  /** Screen shake 0..3. */
  shake: number;
  beats: Beat[];
  acts: Act[];
}

/** A lasting look on a tagged piece (e.g. "불타는 중" burning until the tag ends). */
export interface Aura {
  element: Element;
  /** 1..3 */
  strength: number;
}

export const STAGING_LIMITS = { fx: 6, seconds: 6, beatWait: 2, fxDelay: 5, minDuration: 0.5, maxDuration: 5, minRadius: 0.5, maxRadius: 3 } as const;

export const EMPTY_STAGING: Staging = { fx: [], shake: 0, beats: [], acts: [] };

export const isElement = (v: unknown): v is Element => ELEMENTS.includes(v as Element);
