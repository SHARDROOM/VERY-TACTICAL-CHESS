import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { ballistic, simulatePiece, tumble } from './piecePhysics';
import { TABLE_TOP_Y } from './WoodTable';
import type { PieceType } from '../engine';

const upright = () => new Quaternion();

describe('piece physics', () => {
  it('a captured piece knocked off its square comes to rest on the table beside the board', async () => {
    for (const type of ['pawn', 'knight', 'queen', 'king'] as PieceType[]) {
      const start = new Vector3(-1.5, 0.02, 2.5);
      const target = { x: -6.5, z: 3.2 };
      const velocity = ballistic(start, target, TABLE_TOP_Y, 5);
      const run = await simulatePiece({ type, scale: 0.62, start: { position: start, quaternion: upright() }, velocity, spin: tumble(velocity, 7, () => 0.5), diceSide: -1 });
      const p = run.final.position;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      // Off the board, on the table, roughly where it was thrown.
      expect(Math.abs(p.x) > 4.6 || Math.abs(p.z) > 4.6).toBe(true);
      expect(p.y).toBeGreaterThan(TABLE_TOP_Y - 0.05);
      expect(p.y).toBeLessThan(TABLE_TOP_Y + 0.8);
      expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(3);
      expect(run.impacts.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('a piece dropped onto its square lands on the board near it', async () => {
    const run = await simulatePiece({
      type: 'rook',
      scale: 1,
      start: { position: new Vector3(0.5, 2.4, 0.5), quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3) },
      velocity: new Vector3(0, -1, 0),
      spin: new Vector3(0.5, 0.5, 0),
      diceSide: -1,
      maxSeconds: 2.5,
    });
    const p = run.final.position;
    expect(p.y).toBeGreaterThan(-0.05);
    expect(p.y).toBeLessThan(0.6);
    expect(Math.hypot(p.x - 0.5, p.z - 0.5)).toBeLessThan(1.5);
  }, 30_000);

  it('a flung piece comes down around its target square', async () => {
    const from = new Vector3(-2.5, 0.02, 3.5);
    const to = new Vector3(1.5, 0, -0.5);
    const velocity = ballistic(from, to, 0, 3 + 5.6 * 0.45);
    const run = await simulatePiece({ type: 'knight', scale: 1, start: { position: from, quaternion: upright() }, velocity, spin: tumble(velocity, 4, () => 0.5), diceSide: -1, maxSeconds: 2.5 });
    // Where it first touched down (its first impact) is close to the target.
    const first = run.impacts[0].step * 7;
    expect(Math.hypot(run.frames[first] - to.x, run.frames[first + 2] - to.z)).toBeLessThan(1.2);
  }, 30_000);
});
