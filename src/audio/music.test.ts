import { describe, expect, it } from 'vitest';
import { BEATS_PER_BAR, PROGRESSION, composeBar, drumPattern, inMode } from './music';

/* 배경음악 (사용자 요청): the tune stays in its mode, its range and its bar. */

const seeded = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

describe('the tune', () => {
  it('every note in D Dorian, the melody in its range, nothing past the bar', () => {
    const random = seeded(3);
    let last = 69;
    for (let bar = 0; bar < 64; bar++) {
      const b = composeBar(bar, random, last);
      last = b.last;
      for (const n of [...b.lute, ...b.melody]) {
        expect(inMode(n.midi)).toBe(true);
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.at + 0).toBeLessThan(BEATS_PER_BAR);
      }
      for (const n of b.melody) expect(n.midi).toBeGreaterThanOrEqual(62), expect(n.midi).toBeLessThanOrEqual(81);
      expect(b.melody.reduce((s, n) => s + n.length, 0)).toBeLessThanOrEqual(BEATS_PER_BAR);
    }
  });

  it('never the same twice: two runs differ, while the chords go round the same', () => {
    const a = Array.from({ length: 8 }, (_, i) => composeBar(i, seeded(1), 69).melody.map((n) => n.midi).join());
    const b = Array.from({ length: 8 }, (_, i) => composeBar(i, seeded(2), 69).melody.map((n) => n.midi).join());
    expect(a).not.toEqual(b);
    expect(composeBar(0, seeded(1), 69).lute[0].midi).toBe(PROGRESSION[0][0] - 12);
    expect(composeBar(8, seeded(2), 69).lute[0].midi).toBe(PROGRESSION[0][0] - 12);
  });

  it('the drums: two bars, steady for a check, quicker and rising for a clash', () => {
    const check = drumPattern('check');
    const clash = drumPattern('clash');
    expect(Math.max(...check.map((d) => d.at))).toBeLessThan(2 * BEATS_PER_BAR);
    expect(clash.length).toBeGreaterThan(check.length);
    expect(clash.at(-1)!.strength).toBeGreaterThan(clash[0].strength);
  });
});
