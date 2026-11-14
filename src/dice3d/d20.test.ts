import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { D20_FACES, d20Vertices, faceWithNumber, numberShown, skinRotationFor, symmetryTaking, topFace } from './d20';

/** Deterministic pseudo-random orientations. */
function orientations(count: number): Quaternion[] {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: count }, () => {
    const u1 = rnd(), u2 = rnd(), u3 = rnd();
    return new Quaternion(
      Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
      Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
      Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
      Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
    ).normalize();
  });
}

describe('d20 geometry', () => {
  it('has 20 faces numbered 1..20 once each, opposite faces adding up to 21', () => {
    expect(D20_FACES).toHaveLength(20);
    expect(D20_FACES.map((f) => f.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const f of D20_FACES) {
      const opposite = D20_FACES.find((g) => g.normal.dot(f.normal) < -0.999)!;
      expect(f.number + opposite.number).toBe(21);
    }
  });

  it('faces point outward', () => {
    for (const f of D20_FACES) expect(f.normal.dot(f.centroid)).toBeGreaterThan(0);
  });

  it('every face-to-face map is a true symmetry (vertices land on vertices)', () => {
    const verts = d20Vertices(1);
    for (let from = 0; from < 20; from++)
      for (let to = 0; to < 20; to++) {
        const q = symmetryTaking(from, to);
        for (const v of verts) {
          const moved = v.clone().applyQuaternion(q);
          expect(Math.min(...verts.map((w) => w.distanceTo(moved)))).toBeLessThan(1e-9);
        }
        expect(D20_FACES[from].normal.clone().applyQuaternion(q).distanceTo(D20_FACES[to].normal)).toBeLessThan(1e-9);
      }
  });
});

describe('landing on a chosen number', () => {
  it('for every number 1..20 and any resting orientation, the chosen number ends up on top', () => {
    for (const final of orientations(200)) {
      for (let n = 1; n <= 20; n++) {
        expect(numberShown(final, skinRotationFor(n, final))).toBe(n);
      }
    }
  });

  it('topFace finds the face pointing up', () => {
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < 20; i++) {
      const q = new Quaternion().setFromUnitVectors(D20_FACES[i].normal, up);
      expect(topFace(q)).toBe(i);
    }
    expect(D20_FACES[faceWithNumber(20)].number).toBe(20);
  });
});
