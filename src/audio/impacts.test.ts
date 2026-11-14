import { describe, expect, it } from 'vitest';
import { findImpacts } from './impacts';

/** A ball dropped from 2 units that bounces once and then rests. */
function bounce(dt: number, g: number) {
  const frames: number[] = [];
  let y = 2;
  let vy = 0;
  let bounced = 0;
  for (let i = 0; i < 240; i++) {
    vy -= g * dt;
    y += vy * dt;
    if (y < 0) {
      y = 0;
      vy = bounced++ === 0 ? -vy * 0.5 : 0;
    }
    frames.push(0, y, 0, 0, 0, 0, 1);
  }
  return Float32Array.from(frames);
}

describe('impact timing', () => {
  it('finds the bounce and the final landing, not the free fall', () => {
    const dt = 1 / 60;
    const g = 9.81;
    const hits = findImpacts(bounce(dt, g), dt, g);
    expect(hits.length).toBe(2);
    expect(hits[0].strength).toBeGreaterThan(hits[1].strength);
  });

  it('a body at rest or in free fall makes no sound', () => {
    const dt = 1 / 60;
    const still = Float32Array.from(Array.from({ length: 60 }, () => [1, 0, 1, 0, 0, 0, 1]).flat());
    expect(findImpacts(still, dt, 9.81)).toEqual([]);
    const fall = Float32Array.from(Array.from({ length: 60 }, (_, i) => [0, 10 - 0.5 * 9.81 * (i * dt) ** 2, 0, 0, 0, 0, 1]).flat());
    expect(findImpacts(fall, dt, 9.81)).toEqual([]);
  });
});
