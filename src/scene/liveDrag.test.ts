import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { LiveDrag } from './liveDrag';
import { TABLE_TOP_Y } from './WoodTable';

const run = (d: LiveDrag, seconds: number, p: Vector3, q: Quaternion) => {
  let done = false;
  for (let t = 0; t < seconds && !done; t += 1 / 60) done = d.step(1 / 60, p, q);
  return done;
};
const none = { pieces: [], chunks: [] };

describe('a thing held in the hand', () => {
  it('lifted by its top, it hangs below the finger and follows it, lagging and bobbing', async () => {
    const p = new Vector3(8, TABLE_TOP_Y, 5);
    const q = new Quaternion();
    // Picked up by the top of a pawn (0.8 up).
    const d = await LiveDrag.start({ kind: 'piece', type: 'pawn', scale: 1 }, p.clone(), q.clone(), new Vector3(8, TABLE_TOP_Y + 0.8, 5), none, 1);
    d.aim(new Vector3(8, 2, 5));
    const at = new Vector3();
    const turned = new Quaternion();
    // A moment after the finger rose, it is still on its way (it lags).
    d.step(0.1, at, turned);
    expect(at.y).toBeLessThan(2 - 0.8);
    run(d, 3, at, turned);
    // It hangs from the spot it was picked up by, near the finger (its base about 0.8 below).
    expect(at.y).toBeGreaterThan(0.8);
    expect(at.y).toBeLessThan(1.6);
    expect(Math.hypot(at.x - 8, at.z - 5)).toBeLessThan(0.3);
    d.letGo();
    expect(run(d, 6, at, turned)).toBe(true);
    // It fell back onto the table.
    expect(at.y).toBeLessThan(TABLE_TOP_Y + 0.5);
    d.free();
  });

  it('something in the way stops it: it strains toward the finger but does not go through', async () => {
    const p = new Vector3(0.5, 0, 0.5);
    const q = new Quaternion();
    // A row of rooks on the next file, between it and the finger (no way round; too tall to be pulled over).
    const obstacles = { pieces: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5].map((z) => ({ type: 'rook' as const, at: [1.5, 0, z] as [number, number, number] })), chunks: [] };
    const d = await LiveDrag.start({ kind: 'piece', type: 'pawn', scale: 1 }, p.clone(), q.clone(), new Vector3(0.5, 0.4, 0.5), obstacles, 1);
    d.aim(new Vector3(2.5, 0.4, 0.5));
    const at = new Vector3();
    run(d, 2, at, new Quaternion());
    expect(at.x).toBeLessThan(1.2);
    d.free();
  });

  it('a piece moving on the board shoves it out of the way, held or not', async () => {
    // Held by its top, hanging on d4; a rook comes sliding along the 4th rank from a4 to h4.
    const p = new Vector3(-0.5, 0, -0.5);
    const q = new Quaternion();
    const rook = { id: 'r', type: 'rook' as const, p: new Vector3(-3.5, 0, -0.5), q: new Quaternion() };
    const d = await LiveDrag.start({ kind: 'piece', type: 'pawn', scale: 1 }, p.clone(), q.clone(), new Vector3(-0.5, 0.8, -0.5), none, 1, () => [rook]);
    d.aim(new Vector3(-0.5, 0.85, -0.5));
    const at = new Vector3();
    const turned = new Quaternion();
    run(d, 0.5, at, turned);
    expect(Math.hypot(at.x + 0.5, at.z + 0.5)).toBeLessThan(0.2);
    // The rook slides past at 3.5 squares a second, right through where it hangs.
    let farthest = -Infinity;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      rook.p.x = Math.min(3.5, -3.5 + t * 3.5);
      d.step(1 / 60, at, turned);
      farthest = Math.max(farthest, at.x);
      // Never inside the rook: always ahead of it.
      if (rook.p.x > -1) expect(at.x).toBeGreaterThan(rook.p.x + 0.3);
    }
    // Shoved a long way along, straining back toward the finger all the while.
    expect(farthest).toBeGreaterThan(1.5);
    d.free();
  });
});
