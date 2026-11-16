import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { D6_FACES, d6Corners, faceWithNumber, numberShown, skinRotationFor, symmetryTaking, topFace } from './d6';

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

describe('d6 geometry', () => {
  it('has 6 faces numbered 1..6 once each, opposite faces adding up to 7', () => {
    expect(D6_FACES).toHaveLength(6);
    expect(D6_FACES.map((f) => f.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const f of D6_FACES) {
      const opposite = D6_FACES.find((g) => g.normal.dot(f.normal) < -0.999)!;
      expect(f.number + opposite.number).toBe(7);
    }
  });

  it('faces point outward, their corners on the face, counter-clockwise from outside', () => {
    const verts = d6Corners(1);
    for (const f of D6_FACES) {
      expect(f.normal.dot(f.centroid)).toBeGreaterThan(0);
      for (const i of f.corners) expect(verts[i].dot(f.normal)).toBeCloseTo(1);
      const [a, b, c] = f.corners.map((i) => verts[i]);
      expect(b.clone().sub(a).cross(c.clone().sub(a)).dot(f.normal)).toBeGreaterThan(0);
    }
  });

  it('every face-to-face map is a true symmetry (corners land on corners)', () => {
    const verts = d6Corners(1);
    for (let from = 0; from < 6; from++)
      for (let to = 0; to < 6; to++) {
        const q = symmetryTaking(from, to);
        for (const v of verts) {
          const moved = v.clone().applyQuaternion(q);
          expect(Math.min(...verts.map((w) => w.distanceTo(moved)))).toBeLessThan(1e-9);
        }
        expect(D6_FACES[from].normal.clone().applyQuaternion(q).distanceTo(D6_FACES[to].normal)).toBeLessThan(1e-9);
      }
  });
});

describe('landing on a chosen number', () => {
  it('for every number 1..6 and any resting orientation, the chosen number ends up on top', () => {
    for (const final of orientations(200)) {
      for (let n = 1; n <= 6; n++) {
        expect(numberShown(final, skinRotationFor(n, final))).toBe(n);
      }
    }
  });

  it('topFace finds the face pointing up', () => {
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) {
      const q = new Quaternion().setFromUnitVectors(D6_FACES[i].normal, up);
      expect(topFace(q)).toBe(i);
    }
    expect(D6_FACES[faceWithNumber(6)].number).toBe(6);
  });
});
