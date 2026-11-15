import type { Element } from '../engine';

/**
 * How each element looks as particles. Colours are fixed per element (docs/SPEC.md, "GM 연출"):
 * the GM picks the element, shape, strength and timing, never the colours.
 */

export type FxLayerKind = 'glow' | 'smoke' | 'chunk';

/** One kind of particle an element is made of (fire = flames + embers + smoke). */
export interface FxPart {
  layer: FxLayerKind;
  /** Share of the element's particles. */
  share: number;
  /** Colour at birth and at death. */
  colors: [string, string];
  life: [number, number];
  /** Diameter at birth, in world units (a square is 1). */
  size: [number, number];
  /** Size at death relative to birth. */
  grow: number;
  /** Outward speed for bursts (times the radius). */
  speed: number;
  /** Initial upward speed. */
  up: number;
  /** Vertical acceleration: + rises (flames), - falls (stones). */
  gravity: number;
  drag: number;
  /** Random extra velocity. */
  jitter: number;
  /** Spin around the emitter's centre (wind, arcane). */
  swirl?: number;
  /** Peak opacity. */
  alpha?: number;
  /** Twinkle. */
  flicker?: boolean;
  /** What happens on reaching the table: bounce (stones) or vanish (drops). Default: rest just above it. */
  ground?: 'bounce' | 'die';
}

export interface ElementLook {
  parts: FxPart[];
  /** Particles per second at strength 3. */
  rate: number;
  /** Flash of light when it starts (null: none). */
  light: string | null;
  /** Lightning bolts. */
  bolts?: boolean;
  /** Area: falls from above like rain instead of rising from the table. */
  rain?: boolean;
  /** Burst: a shockwave ring along the table. */
  ring?: boolean;
  /** Burst: a column of rising light. */
  pillar?: boolean;
}

export const ELEMENT_LOOK: Record<Element, ElementLook> = {
  fire: {
    rate: 150,
    light: '#ff9a3c',
    parts: [
      { layer: 'glow', share: 0.6, colors: ['#ffe08a', '#ff3d12'], life: [0.45, 0.85], size: [0.32, 0.5], grow: 0.25, speed: 0.6, up: 1.1, gravity: 1.8, drag: 1.6, jitter: 0.35, flicker: true },
      { layer: 'glow', share: 0.2, colors: ['#ffc061', '#ff3a0a'], life: [0.9, 1.6], size: [0.05, 0.09], grow: 0.5, speed: 1.2, up: 2, gravity: 0.6, drag: 0.8, jitter: 1, flicker: true },
      { layer: 'smoke', share: 0.2, colors: ['#57483d', '#1c1815'], life: [1.3, 2.1], size: [0.3, 0.45], grow: 2.6, speed: 0.3, up: 0.9, gravity: 0.35, drag: 1, jitter: 0.25, alpha: 0.45 },
    ],
  },
  light: {
    rate: 110,
    light: '#fff1c9',
    pillar: true,
    parts: [
      { layer: 'glow', share: 0.55, colors: ['#fffdf0', '#ffd27a'], life: [0.8, 1.4], size: [0.1, 0.18], grow: 0.4, speed: 0.9, up: 1.4, gravity: 0.5, drag: 1.2, jitter: 0.5, flicker: true },
      { layer: 'glow', share: 0.45, colors: ['#fff6d6', '#ffc85a'], life: [0.5, 0.9], size: [0.5, 0.8], grow: 1.6, speed: 0.2, up: 0.6, gravity: 0, drag: 2, jitter: 0.1, alpha: 0.3 },
    ],
  },
  lightning: {
    rate: 80,
    light: '#a8c8ff',
    bolts: true,
    parts: [
      { layer: 'glow', share: 0.8, colors: ['#f2f7ff', '#5c97ff'], life: [0.25, 0.55], size: [0.05, 0.09], grow: 0.4, speed: 4, up: 2, gravity: -7, drag: 1, jitter: 1.5, flicker: true, ground: 'die' },
      { layer: 'glow', share: 0.2, colors: ['#cfe0ff', '#3f6fd8'], life: [0.2, 0.35], size: [0.5, 0.8], grow: 1.5, speed: 0.1, up: 0, gravity: 0, drag: 3, jitter: 0, alpha: 0.35 },
    ],
  },
  water: {
    rate: 140,
    light: null,
    rain: true,
    parts: [
      { layer: 'smoke', share: 0.65, colors: ['#d6f0ff', '#3f8fd6'], life: [0.6, 1], size: [0.07, 0.12], grow: 0.8, speed: 2.4, up: 3, gravity: -9.8, drag: 0.2, jitter: 0.6, alpha: 0.9, ground: 'die' },
      { layer: 'smoke', share: 0.35, colors: ['#e8f7ff', '#8cc6ec'], life: [0.9, 1.5], size: [0.25, 0.4], grow: 2, speed: 0.6, up: 0.4, gravity: 0, drag: 1.5, jitter: 0.2, alpha: 0.3 },
    ],
  },
  nature: {
    rate: 90,
    light: null,
    parts: [
      { layer: 'chunk', share: 0.6, colors: ['#9ad66f', '#3d8a3a'], life: [1.4, 2.2], size: [0.09, 0.15], grow: 0.8, speed: 1, up: 1.8, gravity: -0.9, drag: 2, jitter: 0.5, swirl: 1.6 },
      { layer: 'glow', share: 0.4, colors: ['#f0ffb0', '#8fd65a'], life: [0.9, 1.5], size: [0.06, 0.1], grow: 0.5, speed: 0.6, up: 0.9, gravity: 0.3, drag: 1.2, jitter: 0.5, flicker: true, swirl: 1 },
    ],
  },
  darkness: {
    rate: 90,
    light: null,
    parts: [
      { layer: 'smoke', share: 0.75, colors: ['#2e2040', '#08060c'], life: [1.4, 2.4], size: [0.38, 0.6], grow: 2.2, speed: 0.6, up: 0.5, gravity: 0.25, drag: 1.2, jitter: 0.3, alpha: 0.8, swirl: 0.7 },
      { layer: 'glow', share: 0.25, colors: ['#9a6bff', '#2a0d5c'], life: [0.8, 1.4], size: [0.05, 0.09], grow: 0.5, speed: 0.8, up: 0.8, gravity: 0.3, drag: 1, jitter: 0.6, flicker: true },
    ],
  },
  ice: {
    rate: 110,
    light: '#cfefff',
    parts: [
      { layer: 'chunk', share: 0.4, colors: ['#f2fdff', '#8fd8ff'], life: [0.8, 1.3], size: [0.06, 0.11], grow: 0.7, speed: 2.4, up: 1.6, gravity: -6, drag: 0.6, jitter: 0.6, ground: 'bounce' },
      { layer: 'glow', share: 0.35, colors: ['#e6f9ff', '#6cc2ff'], life: [1, 1.6], size: [0.12, 0.22], grow: 0.4, speed: 0.6, up: 0.3, gravity: -0.3, drag: 2, jitter: 0.3, alpha: 0.6, flicker: true },
      { layer: 'smoke', share: 0.25, colors: ['#f2fbff', '#b4e2f5'], life: [1.2, 1.8], size: [0.3, 0.45], grow: 2, speed: 0.4, up: 0.1, gravity: -0.1, drag: 1.5, jitter: 0.15, alpha: 0.3 },
    ],
  },
  wind: {
    rate: 130,
    light: null,
    parts: [
      { layer: 'smoke', share: 0.6, colors: ['#ddd1b8', '#9c8f76'], life: [0.9, 1.4], size: [0.16, 0.28], grow: 2, speed: 1.2, up: 0.6, gravity: 0, drag: 0.8, jitter: 0.6, alpha: 0.35, swirl: 4 },
      { layer: 'glow', share: 0.4, colors: ['#ffffff', '#c8d2da'], life: [0.5, 0.9], size: [0.05, 0.08], grow: 0.6, speed: 1.6, up: 0.4, gravity: 0, drag: 0.5, jitter: 0.8, alpha: 0.4, swirl: 5 },
    ],
  },
  poison: {
    rate: 100,
    light: null,
    parts: [
      { layer: 'glow', share: 0.45, colors: ['#d2ff70', '#4cae1c'], life: [1, 1.6], size: [0.09, 0.16], grow: 1.2, speed: 0.6, up: 0.9, gravity: 0.5, drag: 1.4, jitter: 0.4, flicker: true },
      { layer: 'smoke', share: 0.55, colors: ['#6f9c2a', '#263f0e'], life: [1.5, 2.3], size: [0.34, 0.5], grow: 2.2, speed: 0.5, up: 0.3, gravity: 0.1, drag: 1.2, jitter: 0.2, alpha: 0.5 },
    ],
  },
  arcane: {
    rate: 120,
    light: '#c08bff',
    parts: [
      { layer: 'glow', share: 0.7, colors: ['#f6d2ff', '#8a3cff'], life: [0.9, 1.5], size: [0.09, 0.17], grow: 0.4, speed: 0.9, up: 1.1, gravity: 0.35, drag: 1.2, jitter: 0.4, flicker: true, swirl: 3 },
      { layer: 'glow', share: 0.3, colors: ['#ffa6f2', '#5a22c9'], life: [0.5, 0.8], size: [0.4, 0.6], grow: 0.2, speed: 0.2, up: 0.2, gravity: 0, drag: 2, jitter: 0.1, alpha: 0.45 },
    ],
  },
  earth: {
    rate: 110,
    light: null,
    parts: [
      { layer: 'chunk', share: 0.55, colors: ['#8d6c4a', '#5a4330'], life: [1, 1.5], size: [0.08, 0.16], grow: 0.9, speed: 1.8, up: 4, gravity: -9.8, drag: 0.3, jitter: 0.6, ground: 'bounce' },
      { layer: 'smoke', share: 0.45, colors: ['#a88f70', '#6b5a46'], life: [1, 1.7], size: [0.3, 0.45], grow: 2.4, speed: 0.7, up: 0.4, gravity: 0.05, drag: 1.4, jitter: 0.3, alpha: 0.5 },
    ],
  },
  impact: {
    rate: 70,
    light: '#fff0d0',
    ring: true,
    parts: [
      { layer: 'glow', share: 0.3, colors: ['#fff8e6', '#ffcf7a'], life: [0.18, 0.3], size: [0.7, 1], grow: 1.8, speed: 0, up: 0, gravity: 0, drag: 0, jitter: 0, alpha: 0.6 },
      { layer: 'chunk', share: 0.35, colors: ['#7a6550', '#4e3f31'], life: [0.6, 1], size: [0.05, 0.09], grow: 1, speed: 3, up: 2.5, gravity: -9.8, drag: 0.4, jitter: 0.8, ground: 'bounce' },
      { layer: 'smoke', share: 0.35, colors: ['#e2d6bf', '#9e8f78'], life: [0.8, 1.3], size: [0.28, 0.4], grow: 2.2, speed: 1.4, up: 0.3, gravity: 0, drag: 2.2, jitter: 0.3, alpha: 0.45 },
    ],
  },
};
