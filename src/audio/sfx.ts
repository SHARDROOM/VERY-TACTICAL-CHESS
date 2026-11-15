/**
 * Small sound effects, synthesised with the Web Audio API (no audio files to download).
 * Browsers only allow audio after a user gesture, so the context is created lazily on
 * the first click/tap and every call is a no-op until then or while muted.
 */

import type { Element } from '../engine';

export type SfxName =
  | 'click'
  | 'turn'
  | 'move'
  | 'knock'
  | 'land'
  | 'check'
  | 'diceHit'
  | 'coinWhoosh'
  | 'coinClink'
  | 'coinCollect'
  | 'carve'
  | 'chat'
  | 'ruling'
  | 'critSuccess'
  | 'critFailure'
  | 'chaos'
  | 'timeout'
  | 'tick';

export interface SoundSettings {
  enabled: boolean;
  /** 0..1 */
  volume: number;
}

const KEY = 'vtc.sound';
let settings: SoundSettings = loadSettings();
const listeners = new Set<(s: SoundSettings) => void>();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let voices = 0;

function loadSettings(): SoundSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.enabled === 'boolean' && typeof raw.volume === 'number') {
      return { enabled: raw.enabled, volume: Math.min(1, Math.max(0, raw.volume)) };
    }
  } catch {
    // no storage: defaults
  }
  return { enabled: true, volume: 0.7 };
}

export function getSoundSettings(): SoundSettings {
  return settings;
}

export function setSoundSettings(next: Partial<SoundSettings>): void {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // a remembered preference is only a convenience
  }
  if (master) master.gain.value = settings.volume;
  listeners.forEach((l) => l(settings));
}

export function onSoundSettings(listener: (s: SoundSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call from a user gesture (click/tap) so the browser lets us make sound. */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.volume;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

// ---- building blocks ---------------------------------------------------------

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(t: number, freq: number, opts: { type?: OscillatorType; peak: number; attack?: number; decay: number; to?: number; detune?: number }) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.attack ?? 0.005) + opts.decay);
  if (opts.detune) o.detune.value = opts.detune;
  env(g, t, opts.peak, opts.attack ?? 0.005, opts.decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + (opts.attack ?? 0.005) + opts.decay + 0.05);
}

function burst(t: number, opts: { freq: number; q: number; peak: number; attack?: number; decay: number; type?: BiquadFilterType; sweepTo?: number }) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq, t);
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + (opts.attack ?? 0.003) + opts.decay);
  f.Q.value = opts.q;
  const g = c.createGain();
  env(g, t, opts.peak, opts.attack ?? 0.003, opts.decay);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + (opts.attack ?? 0.003) + opts.decay + 0.05);
}

// ---- the sounds ---------------------------------------------------------------

const SOUNDS: Record<SfxName, (t: number, s: number) => void> = {
  click: (t) => {
    tone(t, 1500, { type: 'triangle', peak: 0.06, decay: 0.035, to: 900 });
    burst(t, { freq: 4000, q: 2, peak: 0.02, decay: 0.02 });
  },
  turn: (t) => {
    tone(t, 659, { peak: 0.09, attack: 0.01, decay: 0.45 });
    tone(t + 0.09, 988, { peak: 0.08, attack: 0.01, decay: 0.55 });
    tone(t + 0.09, 1976, { peak: 0.015, attack: 0.01, decay: 0.3 });
  },
  // A felted wooden piece set down on the board.
  move: (t, s) => {
    tone(t, 190, { peak: 0.28 * s, decay: 0.11, to: 120 });
    burst(t, { freq: 950, q: 1.4, peak: 0.12 * s, decay: 0.05 });
  },
  // A captured piece knocked off its square.
  knock: (t, s) => {
    burst(t, { freq: 1600, q: 3, peak: 0.2 * s, decay: 0.06 });
    tone(t, 330, { peak: 0.2 * s, decay: 0.09, to: 180 });
  },
  // A small piece landing on the table at the side.
  land: (t, s) => {
    tone(t, 240, { peak: 0.12 * s, decay: 0.07, to: 150 });
    burst(t, { freq: 1200, q: 1.5, peak: 0.06 * s, decay: 0.04 });
  },
  check: (t) => {
    tone(t, 880, { type: 'triangle', peak: 0.07, decay: 0.15 });
    tone(t + 0.14, 880, { type: 'triangle', peak: 0.07, decay: 0.2 });
  },
  // Resin die hitting felt or the tray wall.
  diceHit: (t, s) => {
    burst(t, { freq: 2600 + Math.random() * 900, q: 5, peak: 0.25 * s, decay: 0.035 + 0.03 * s });
    tone(t, 620 + Math.random() * 200, { peak: 0.05 * s, decay: 0.04 });
  },
  coinWhoosh: (t, s) => {
    burst(t, { freq: 500, q: 0.8, peak: 0.05 * s, attack: 0.08, decay: 0.25, sweepTo: 2200 });
  },
  // A heavy gold coin: a low thud of its weight, then a lower, longer metallic ring.
  coinClink: (t, s) => {
    tone(t, 170 + Math.random() * 40, { peak: 0.22 * s, decay: 0.07, to: 95 });
    burst(t, { freq: 900, q: 1.2, peak: 0.07 * s, decay: 0.035 });
    const base = 1350 + Math.random() * 350;
    [1, 1.5, 2.26, 2.9].forEach((m, i) => tone(t, base * m, { peak: (0.075 / (i + 1)) * s, decay: 0.22 + 0.3 / (i + 1) }));
    burst(t, { freq: 4800, q: 2, peak: 0.025 * s, decay: 0.02 });
  },
  coinCollect: (t) => {
    for (let i = 0; i < 4; i++) SOUNDS.coinClink(t + i * 0.06 + Math.random() * 0.02, 0.6);
    burst(t, { freq: 700, q: 0.8, peak: 0.04, attack: 0.05, decay: 0.3, sweepTo: 2500 });
  },
  // A knife scoring wood: a rough, scratchy noise.
  carve: (t) => {
    for (let i = 0; i < 9; i++) burst(t + i * 0.045, { freq: 3200 + Math.random() * 1500, q: 2.5, peak: 0.05 + Math.random() * 0.03, decay: 0.04 });
  },
  // Chaos: a gust of wind over a low, rolling rumble.
  chaos: (t) => {
    burst(t, { freq: 300, q: 0.7, peak: 0.12, attack: 0.25, decay: 1.1, sweepTo: 1800 });
    tone(t, 70, { type: 'sawtooth', peak: 0.06, attack: 0.15, decay: 1.2, to: 45 });
    tone(t + 0.35, 523, { type: 'triangle', peak: 0.04, decay: 0.5, to: 392, detune: 15 });
  },
  // Time is up: two falling notes.
  timeout: (t) => {
    tone(t, 660, { type: 'square', peak: 0.04, decay: 0.18 });
    tone(t + 0.2, 440, { type: 'square', peak: 0.04, decay: 0.3 });
  },
  // A clock tick for the last seconds.
  tick: (t) => {
    burst(t, { freq: 3500, q: 6, peak: 0.08, decay: 0.02 });
    tone(t, 1800, { peak: 0.03, decay: 0.03 });
  },
  chat: (t) => {
    tone(t, 988, { peak: 0.06, decay: 0.12 });
    tone(t + 0.07, 1319, { peak: 0.05, decay: 0.16 });
  },
  // A parchment unrolled: the GM's ruling arrives.
  ruling: (t) => {
    burst(t, { freq: 2500, q: 0.6, peak: 0.05, attack: 0.03, decay: 0.2, type: 'highpass' });
    tone(t + 0.05, 392, { type: 'triangle', peak: 0.05, decay: 0.3 });
  },
  critSuccess: (t) => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(t + i * 0.08, f, { peak: 0.08, decay: 0.5 }));
  },
  critFailure: (t) => {
    tone(t, 196, { type: 'sawtooth', peak: 0.06, attack: 0.02, decay: 0.6, to: 82 });
    tone(t, 98, { peak: 0.12, attack: 0.02, decay: 0.7, to: 55 });
  },
};

// ---- element sounds for GM fx -----------------------------------------------------

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const ELEMENT_SOUNDS: Record<Element, (t: number, s: number) => void> = {
  // A whoosh of flame, then crackling.
  fire: (t, s) => {
    burst(t, { freq: 300, q: 0.8, peak: 0.16 * s, attack: 0.06, decay: 0.8, type: 'lowpass', sweepTo: 1400 });
    for (let i = 0; i < 7; i++) burst(t + rand(0.05, 0.9), { freq: rand(2500, 5000), q: 3, peak: rand(0.03, 0.07) * s, decay: 0.02 });
  },
  // A bright, soft chord with a shimmer.
  light: (t, s) => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(t + i * 0.03, f, { peak: 0.045 * s, attack: 0.06, decay: 1.1 }));
    burst(t, { freq: 7000, q: 0.8, peak: 0.025 * s, attack: 0.1, decay: 0.9, type: 'highpass' });
  },
  // A crack, then thunder.
  lightning: (t, s) => {
    burst(t, { freq: 3000, q: 0.5, peak: 0.3 * s, decay: 0.09 });
    burst(t + 0.04, { freq: 220, q: 0.6, peak: 0.22 * s, attack: 0.05, decay: 1.5, type: 'lowpass', sweepTo: 70 });
    tone(t + 0.03, 55, { type: 'sawtooth', peak: 0.07 * s, attack: 0.04, decay: 1.2, to: 38 });
  },
  water: (t, s) => {
    burst(t, { freq: 900, q: 1, peak: 0.16 * s, decay: 0.3, sweepTo: 400 });
    for (let i = 0; i < 3; i++) tone(t + 0.05 + i * rand(0.05, 0.12), rand(350, 600), { peak: 0.06 * s, decay: 0.08, to: rand(800, 1200) });
  },
  // Leaves rustling, a soft woody knock.
  nature: (t, s) => {
    for (let i = 0; i < 8; i++) burst(t + i * rand(0.05, 0.1), { freq: rand(2500, 4500), q: 1.2, peak: rand(0.03, 0.06) * s, decay: 0.06 });
    tone(t, 330, { type: 'triangle', peak: 0.06 * s, decay: 0.2, to: 260 });
  },
  // A low drone and a breath drawn in.
  darkness: (t, s) => {
    tone(t, 70, { type: 'sawtooth', peak: 0.06 * s, attack: 0.2, decay: 1.3, to: 44 });
    burst(t, { freq: 1600, q: 0.7, peak: 0.08 * s, attack: 0.35, decay: 0.7, sweepTo: 220 });
  },
  // Glassy chimes and a crackle of frost.
  ice: (t, s) => {
    [2093, 2637, 3136, 3951].forEach((f) => tone(t + rand(0, 0.25), f, { type: 'triangle', peak: 0.04 * s, decay: rand(0.3, 0.6) }));
    for (let i = 0; i < 5; i++) burst(t + rand(0, 0.5), { freq: rand(5000, 8000), q: 4, peak: 0.03 * s, decay: 0.015 });
  },
  wind: (t, s) => {
    burst(t, { freq: 400, q: 0.9, peak: 0.13 * s, attack: 0.3, decay: 1, sweepTo: 1700 });
    burst(t + 0.2, { freq: 900, q: 1.5, peak: 0.05 * s, attack: 0.2, decay: 0.8, sweepTo: 500 });
  },
  // Bubbles and a hiss.
  poison: (t, s) => {
    for (let i = 0; i < 6; i++) tone(t + rand(0, 0.7), rand(280, 520), { peak: 0.05 * s, decay: 0.07, to: rand(700, 1000) });
    burst(t, { freq: 4000, q: 0.7, peak: 0.05 * s, attack: 0.1, decay: 0.7, type: 'highpass' });
  },
  // A rising, wavering shimmer.
  arcane: (t, s) => {
    tone(t, 440, { type: 'triangle', peak: 0.05 * s, attack: 0.1, decay: 0.9, to: 880, detune: 12 });
    tone(t, 660, { type: 'sine', peak: 0.04 * s, attack: 0.1, decay: 0.9, to: 1320, detune: -12 });
    for (let i = 0; i < 4; i++) tone(t + 0.1 + i * 0.12, rand(1800, 2600), { peak: 0.025 * s, decay: 0.15 });
  },
  // A rumble and stones clattering.
  earth: (t, s) => {
    burst(t, { freq: 160, q: 0.7, peak: 0.25 * s, attack: 0.03, decay: 0.9, type: 'lowpass', sweepTo: 70 });
    for (let i = 0; i < 5; i++) burst(t + rand(0.1, 0.7), { freq: rand(900, 1600), q: 3, peak: rand(0.05, 0.1) * s, decay: 0.04 });
  },
  impact: (t, s) => {
    tone(t, 95, { peak: 0.35 * s, decay: 0.35, to: 40 });
    burst(t, { freq: 600, q: 0.6, peak: 0.2 * s, decay: 0.15, type: 'lowpass', sweepTo: 150 });
  },
};

/** The sound of a GM fx, louder for stronger ones (strength 1..5). */
export function playFxSound(element: Element, strength: number, delay = 0): void {
  if (!settings.enabled || !ctx || !master || ctx.state !== 'running' || voices > 40) return;
  voices++;
  setTimeout(() => voices--, 1200);
  try {
    ELEMENT_SOUNDS[element](ctx.currentTime + delay + 0.005, Math.min(1, 0.45 + 0.13 * strength));
  } catch {
    // never let a sound break the game
  }
}

/** Plays a sound now (or `delay` seconds from now). `strength` scales loudness, 0..1. */
export function playSfx(name: SfxName, options: { strength?: number; delay?: number } = {}): void {
  if (!settings.enabled || !ctx || !master || ctx.state !== 'running') return;
  if (voices > 40) return; // a pile-up of impacts is noise, not information
  const s = Math.min(1, Math.max(0.05, options.strength ?? 1));
  voices++;
  setTimeout(() => voices--, 700);
  try {
    SOUNDS[name](ctx.currentTime + (options.delay ?? 0) + 0.005, s);
  } catch {
    // never let a sound break the game
  }
}
