import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 배경음악 as it plays: a stand-in AudioContext records what the music puts on the clock.
 * Found near the cross-check (its own findings did not hold): turning the music off and on again
 * quickly laid a new bar over the one still ringing, and the first chord came in loud.
 */

type Listener = (s: { enabled: boolean; volume: number; music: boolean; musicVolume: number }) => void;
const sound = vi.hoisted(() => ({
  settings: { enabled: true, volume: 0.7, music: true, musicVolume: 0.25 },
  listeners: new Set<Listener>(),
  out: null as null | { ctx: unknown; noise: unknown },
}));

vi.mock('./sfx', () => ({
  audioOut: () => sound.out,
  getSoundSettings: () => sound.settings,
  onSoundSettings: (l: Listener) => {
    sound.listeners.add(l);
    return () => sound.listeners.delete(l);
  },
}));

class Param {
  value = 1;
  constructor(private ctx: FakeContext) {}
  setValueAtTime(v: number, t: number) {
    if (t <= this.ctx.currentTime) this.value = v;
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  setTargetAtTime(v: number) {
    this.ctx.targets.push({ from: this.value, to: v });
    return this;
  }
}

class Node {
  constructor(protected ctx: FakeContext) {}
  connect<T>(to: T): T {
    if ((to as unknown) === this.ctx.destination) this.ctx.outs.push(this as unknown as Node);
    return to;
  }
}

class Osc extends Node {
  type = 'sine';
  frequency = new Param(this.ctx);
  private f = 0;
  constructor(ctx: FakeContext) {
    super(ctx);
    this.frequency.setValueAtTime = (v: number) => {
      this.f = v;
      return this.frequency;
    };
  }
  start(t: number) {
    this.ctx.started.push({ type: this.type, f: this.f, t });
  }
  stop() {}
}

class FakeContext {
  currentTime = 0;
  destination = {};
  started: { type: string; f: number; t: number }[] = [];
  outs: Node[] = [];
  targets: { from: number; to: number }[] = [];
  createOscillator() {
    return new Osc(this);
  }
  createGain() {
    const g = new Node(this) as Node & { gain: Param };
    g.gain = new Param(this);
    return g;
  }
  createBiquadFilter() {
    const f = new Node(this) as Node & { type: string; frequency: Param };
    f.frequency = new Param(this);
    return f;
  }
  createBufferSource() {
    return Object.assign(new Node(this), { buffer: null, start() {}, stop() {} });
  }
}

const BAR = (60 / 72) * 3;
/** When each bar begins: the lute's low root (a triangle under 100 Hz) is plucked on its first beat. */
const barStarts = (c: FakeContext) => c.started.filter((s) => s.type === 'triangle' && s.f < 100).map((s) => s.t);
const setMusic = (music: boolean) => {
  sound.settings = { ...sound.settings, music };
  sound.listeners.forEach((l) => l(sound.settings));
};

let ctx: FakeContext;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  sound.listeners.clear();
  sound.settings = { enabled: true, volume: 0.7, music: true, musicVolume: 0.25 };
  ctx = new FakeContext();
  sound.out = { ctx, noise: {} };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { hidden: false, addEventListener: () => {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the music on the clock', () => {
  it('off and on again within a bar: the tune goes on, no second bar on top of the one still ringing', async () => {
    const { startMusic } = await import('./music');
    startMusic();
    ctx.currentTime = 1;
    setMusic(false);
    setMusic(true);
    for (let t = 1; t < 12; t += 0.12) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(120);
    }
    const starts = barStarts(ctx);
    expect(starts.length).toBeGreaterThan(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(BAR - 0.01);
  });

  it('after a long rest it starts afresh from now', async () => {
    const { startMusic } = await import('./music');
    startMusic();
    ctx.currentTime = 1;
    setMusic(false);
    ctx.currentTime = 30;
    setMusic(true);
    expect(barStarts(ctx).at(-1)).toBeGreaterThan(30);
  });

  it('comes in from silence, not from full loudness (the first chord was loud)', async () => {
    const { startMusic } = await import('./music');
    startMusic();
    expect(ctx.outs).toHaveLength(1);
    expect(ctx.targets[0].to).toBeCloseTo(0.25 * 0.8);
    expect(ctx.targets[0].from).toBeLessThan(0.01);
  });
});
