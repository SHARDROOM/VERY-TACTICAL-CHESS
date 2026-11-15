import { describe, expect, it } from 'vitest';
import { ACTS, MOTION_STYLES } from '../engine';
import { actPose, entrancePose, stylePose, swapPose, swerve } from './pieceMotion';

const from = { x: -2.5, y: 0, z: 3.5 };
const to = { x: 0.5, y: 0, z: -0.5 };

describe('styled trips', () => {
  for (const style of MOTION_STYLES.filter((s) => s !== 'default' && s !== 'fly')) {
    it(`${style} starts on its square and ends standing on the target`, () => {
      const start = stylePose(style, from, to, 0, 1);
      expect(start.x).toBeCloseTo(from.x, 1);
      expect(start.z).toBeCloseTo(from.z, 1);
      const end = stylePose(style, from, to, 1, 1);
      expect(end).toMatchObject({ x: expect.closeTo(to.x, 5), y: expect.closeTo(0, 5), z: expect.closeTo(to.z, 5), scale: expect.closeTo(1, 5), squashY: 1, lean: expect.closeTo(0, 5), roll: expect.closeTo(0, 5) });
      expect(Math.cos(end.yaw)).toBeCloseTo(1, 5);
    });
  }

  it('the styles really differ halfway', () => {
    const mid = MOTION_STYLES.filter((s) => s !== 'default' && s !== 'fly').map((s) => stylePose(s, from, to, 0.5, 1));
    const keys = new Set(mid.map((p) => [p.x, p.y, p.z, p.yaw, p.scale].map((v) => v.toFixed(2)).join()));
    expect(keys.size).toBe(mid.length);
  });

  it('teleporting vanishes in the middle; burrowing goes out of sight under the board', () => {
    expect(stylePose('teleport', from, to, 0.5, 1).scale).toBe(0);
    expect(stylePose('burrow', from, to, 0.5, 1).y).toBeLessThan(-1);
  });
});

describe('entrances and acts', () => {
  it('rising starts under the board and materializing starts from nothing; both end in place', () => {
    const at = { x: 1.5, y: 0, z: -0.5 };
    expect(entrancePose('rise', at, 0, 1).y).toBeLessThan(-1);
    expect(entrancePose('materialize', at, 0, 1).scale).toBe(0);
    for (const style of ['rise', 'materialize'] as const) {
      expect(entrancePose(style, at, 1, 1)).toMatchObject({ x: at.x, y: expect.closeTo(0, 5), z: at.z, scale: expect.closeTo(1, 5) });
    }
  });

  for (const kind of ACTS) {
    it(`${kind} leaves the piece where it was`, () => {
      const end = actPose(kind, 1, 3.3);
      expect(end).toMatchObject({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5), z: expect.closeTo(0, 5), roll: expect.closeTo(0, 5), squashY: expect.closeTo(1, 5) });
      expect(Math.cos(end.yaw)).toBeCloseTo(1, 5);
    });
  }

  it('falling really tips the piece over', () => {
    expect(actPose('fall', 0.4, 0).roll).toBeCloseTo(Math.PI / 2);
  });
});

describe('swapping', () => {
  it('two pieces trading squares, each swerving right, pass on opposite sides and land exactly', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 4, y: 0, z: 0 };
    const one = swapPose(a, b, 0.5, 1);
    const other = swapPose(b, a, 0.5, 1);
    expect(Math.abs(one.z - other.z)).toBeGreaterThan(0.6);
    expect(one.y).toBeGreaterThan(0.5);
    const end = swapPose(a, b, 1, 1);
    expect(end.x).toBeCloseTo(4);
    expect(end.y).toBeCloseTo(0);
    expect(end.z).toBeCloseTo(0);
    expect(swerve(0)).toBe(0);
    expect(swerve(1)).toBeCloseTo(0);
  });
});
