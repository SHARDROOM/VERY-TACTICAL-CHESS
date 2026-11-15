import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { simulateRoll, simulateRolls } from './simulate';
import { D20_FACES, numberShown, skinRotationFor, topFace } from './d20';

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('physical roll', () => {
  it('settles flat on a face, and the skin rotation puts any chosen number on top', async () => {
    for (let s = 1; s <= 6; s++) {
      const run = await simulateRoll(seeded(s * 7919));
      expect(run.steps).toBeGreaterThan(30);
      // Resting flat: the top face points (almost) straight up.
      const up = D20_FACES[topFace(run.final)].normal.clone().applyQuaternion(run.final);
      expect(up.dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.97);
      // It stayed in the tray and ended near the floor.
      const last = run.frames.slice((run.steps - 1) * 7, run.steps * 7);
      expect(last[1]).toBeGreaterThan(0.2);
      expect(last[1]).toBeLessThan(1);
      for (const n of [1, 7, 13, 20]) expect(numberShown(run.final, skinRotationFor(n, run.final))).toBe(n);
    }
  }, 30_000);
});

describe('two dice for a clash', () => {
  it('both settle flat in the tray, on runs of the same length', async () => {
    for (let s = 1; s <= 3; s++) {
      const runs = await simulateRolls(2, seeded(s * 104729));
      expect(runs).toHaveLength(2);
      expect(runs[0].steps).toBe(runs[1].steps);
      for (const run of runs) {
        const up = D20_FACES[topFace(run.final)].normal.clone().applyQuaternion(run.final);
        expect(up.dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.97);
      }
    }
  }, 30_000);
});
