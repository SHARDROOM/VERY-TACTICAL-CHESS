import { audioOut, getSoundSettings, onSoundSettings } from './sfx';

/*
 * 배경음악 (사용자 요청): made in code, no files. A slow tune in three in D Dorian, the way a
 * tavern lute and a harpsichord might play it: plucked chords on every beat, a melody that wanders
 * the mode (never quite the same twice), a quiet drone under it. A check or a clash brings in a
 * frame drum for two bars. Its own switch and volume (sfx.ts SoundSettings.music), apart from the
 * effects; starts quiet, after the first tap (browsers allow sound only then), and rests while the
 * tab is hidden.
 */

export const BPM = 72;
const BEAT = 60 / BPM;
export const BEATS_PER_BAR = 3;
/** D Dorian, as MIDI note numbers from D. */
const MODE = [0, 2, 3, 5, 7, 9, 10];
const D3 = 50;

/** The chords, a bar each (roots in D Dorian: Dm C Dm Am F C G Dm), as MIDI notes around D3. */
export const PROGRESSION: number[][] = [
  [50, 53, 57], // Dm
  [48, 52, 55], // C
  [50, 53, 57], // Dm
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [48, 52, 55], // C
  [43, 47, 50], // G
  [50, 53, 57], // Dm
];

export interface Note {
  /** Beats from the bar's start. */
  at: number;
  midi: number;
  /** Beats it rings (plucked: a guide for its decay). */
  length: number;
  velocity: number;
}

/** Whether a MIDI note is in D Dorian. */
export const inMode = (midi: number) => MODE.includes((((midi - D3) % 12) + 12) % 12);

const RHYTHMS: number[][] = [
  [1, 1, 1],
  [2, 1],
  [1, 0.5, 0.5, 1],
  [1.5, 0.5, 1],
  [3],
];

/**
 * One bar of the tune: the lute's chord, plucked low then up (an arpeggio on the beats), and the
 * melody over it, a few notes walking the mode near the chord (`last`: the melody's last note, to
 * walk on from). `random` makes it new every time around.
 */
export function composeBar(bar: number, random: () => number, last: number): { lute: Note[]; melody: Note[]; last: number } {
  const chord = PROGRESSION[bar % PROGRESSION.length];
  const lute: Note[] = [
    { at: 0, midi: chord[0] - 12, length: 3, velocity: 0.9 },
    { at: 1, midi: chord[1], length: 1, velocity: 0.55 },
    { at: 2, midi: chord[2], length: 1, velocity: 0.5 },
  ];
  if (random() < 0.5) lute.push({ at: 2.5, midi: chord[1] + 12, length: 0.5, velocity: 0.35 });
  // The last bar of the loop rests the melody now and then (a breath).
  if (bar % PROGRESSION.length === PROGRESSION.length - 1 && random() < 0.4) return { lute, melody: [], last };
  const rhythm = RHYTHMS[Math.floor(random() * RHYTHMS.length)];
  const scale: number[] = [];
  for (let m = 62; m <= 81; m++) if (inMode(m)) scale.push(m);
  let at = 0;
  let idx = Math.max(0, scale.indexOf(last));
  const melody: Note[] = [];
  rhythm.forEach((len, i) => {
    // Downbeats lean on the chord; the rest step by one or two.
    const chordTones = scale.filter((m) => chord.some((c) => (m - c) % 12 === 0));
    if (i === 0 && random() < 0.7) {
      const near = chordTones.reduce((a, b) => (Math.abs(b - scale[idx]) < Math.abs(a - scale[idx]) ? b : a), chordTones[0]);
      idx = scale.indexOf(near);
    } else {
      const step = [-2, -1, -1, 1, 1, 2][Math.floor(random() * 6)];
      idx = Math.min(scale.length - 1, Math.max(0, idx + step));
    }
    melody.push({ at, midi: scale[idx], length: len, velocity: i === 0 ? 0.7 : 0.55 });
    at += len;
  });
  return { lute, melody, last: scale[idx] };
}

/** The frame drum's two bars after a check (steady) or a clash (quicker, rising), in beats from now. */
export function drumPattern(kind: 'check' | 'clash'): { at: number; strength: number }[] {
  if (kind === 'check') return [0, 2, 3, 3.5, 5].map((at) => ({ at, strength: at === 0 || at === 3 ? 1 : 0.6 }));
  return Array.from({ length: 12 }, (_, i) => ({ at: i * 0.5, strength: 0.4 + (i / 11) * 0.6 }));
}

// ---- playing it --------------------------------------------------------------------

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let out: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextBarAt = 0;
let bar = 0;
let last = 69;
let drums: { at: number; strength: number }[] = [];

function voice(c: AudioContext, t: number, f: number, opts: { type: OscillatorType; gain: number; decay: number; cutoff: number; to?: number }): void {
  const o = c.createOscillator();
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  o.type = opts.type;
  o.frequency.setValueAtTime(f, t);
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(opts.cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, opts.to ?? opts.cutoff * 0.25), t + opts.decay);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  o.connect(lp).connect(g).connect(out!);
  o.start(t);
  o.stop(t + opts.decay + 0.05);
}

/** A plucked lute string: a bright attack that dulls as it rings. */
function lute(c: AudioContext, t: number, n: Note): void {
  const f = freq(n.midi);
  const ring = Math.min(2.4, 0.9 + n.length * BEAT * 0.6);
  voice(c, t, f, { type: 'triangle', gain: 0.16 * n.velocity, decay: ring, cutoff: 2600 });
  voice(c, t, f * 2, { type: 'sawtooth', gain: 0.035 * n.velocity, decay: ring * 0.5, cutoff: 3200, to: 500 });
}

/** A harpsichord's quill: thin, bright, quick to fade. */
function harpsichord(c: AudioContext, t: number, n: Note): void {
  const f = freq(n.midi);
  const ring = Math.min(1.6, 0.5 + n.length * BEAT * 0.5);
  voice(c, t, f, { type: 'square', gain: 0.045 * n.velocity, decay: ring, cutoff: 4200, to: 900 });
  voice(c, t, f * 2.005, { type: 'sawtooth', gain: 0.02 * n.velocity, decay: ring * 0.6, cutoff: 5000, to: 1200 });
}

/** The drone under it all: D and A, very soft, swelling in over a bar. */
function drone(c: AudioContext, t: number, length: number): void {
  for (const [midi, gain] of [[38, 0.05], [45, 0.03]] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq(midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + BEAT * 2);
    g.gain.setValueAtTime(gain, t + length - BEAT);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.4);
    o.connect(g).connect(out!);
    o.start(t);
    o.stop(t + length + 0.5);
  }
}

/** A frame drum: a low thump that drops in pitch, and the skin's rattle. */
function drum(c: AudioContext, noise: AudioBuffer, t: number, strength: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(52, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + 0.4);
  const s = c.createBufferSource();
  const ng = c.createGain();
  const bp = c.createBiquadFilter();
  s.buffer = noise;
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.12 * strength, t + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  s.connect(bp).connect(ng).connect(out!);
  s.start(t);
  s.stop(t + 0.15);
}

/** Puts the next bars on the clock, a little ahead (the browser plays them on time). */
function schedule(): void {
  const a = audioOut();
  if (!a || !out) return;
  const { ctx: c, noise } = a;
  if (nextBarAt < c.currentTime) nextBarAt = c.currentTime + 0.1;
  while (nextBarAt < c.currentTime + 0.6) {
    const t = nextBarAt;
    const music = composeBar(bar, Math.random, last);
    last = music.last;
    if (bar % PROGRESSION.length === 0) drone(c, t, BEAT * BEATS_PER_BAR * PROGRESSION.length);
    for (const n of music.lute) lute(c, t + n.at * BEAT, n);
    for (const n of music.melody) harpsichord(c, t + n.at * BEAT, n);
    nextBarAt += BEAT * BEATS_PER_BAR;
    bar++;
  }
  // The drums wait for the next beat, so they fall in with the tune.
  if (drums.length) {
    const beat = Math.ceil((c.currentTime + 0.05 - (nextBarAt - BEAT * BEATS_PER_BAR)) / BEAT);
    const start = nextBarAt - BEAT * BEATS_PER_BAR + beat * BEAT;
    for (const d of drums) drum(c, noise, start + d.at * BEAT, d.strength);
    drums = [];
  }
}

function play(): void {
  const a = audioOut();
  const s = getSoundSettings();
  if (!a || !s.music || timer || document.hidden) return;
  if (!out) {
    out = a.ctx.createGain();
    out.connect(a.ctx.destination);
  }
  out.gain.setTargetAtTime(s.musicVolume * 0.8, a.ctx.currentTime, 0.3);
  nextBarAt = a.ctx.currentTime + 0.2;
  timer = setInterval(schedule, 120);
  schedule();
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  const a = audioOut();
  if (a && out) out.gain.setTargetAtTime(0.0001, a.ctx.currentTime, 0.2);
}

let wired = false;
/** Starts the music if it is on (call after a gesture has unlocked the audio); follows its settings from then on. */
export function startMusic(): void {
  if (typeof window === 'undefined') return;
  if (!wired) {
    wired = true;
    onSoundSettings((s) => {
      const a = audioOut();
      if (a && out) out.gain.setTargetAtTime(s.music ? s.musicVolume * 0.8 : 0.0001, a.ctx.currentTime, 0.2);
      if (s.music) play();
      else stop();
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
  }
  play();
}

/** A check or a clash: the frame drum comes in for two bars (only while the music plays). */
export function musicAccent(kind: 'check' | 'clash'): void {
  if (!timer) return;
  drums = drumPattern(kind);
}
