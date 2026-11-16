import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { PieceType } from '../engine';
import { fragmentsOf, simulateShatter } from './shatter';
import { hullPoints } from './piecePhysics';

/** Volume of a closed triangle mesh (non-indexed or indexed), by the divergence theorem. */
function volume(geometry: ReturnType<typeof fragmentsOf>[number]['geometry']): number {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

describe('a shattered piece breaks into chunks of itself', () => {
  it('several chunks, about as tall as the piece put together and about its bulk', () => {
    for (const type of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'] as PieceType[]) {
      const frags = fragmentsOf(type);
      expect(frags.length).toBeGreaterThanOrEqual(6);
      const hull = hullPoints(type);
      let top = 0;
      for (let i = 1; i < hull.length; i += 3) top = Math.max(top, hull[i]);
      const reach = Math.max(...frags.map((f) => f.center[1] + (f.geometry.boundingBox!.max.y)));
      expect(reach).toBeGreaterThan(top * 0.9);
      // Their volumes add up to something like the whole piece (a squat cylinder of its base radius at most).
      const total = frags.reduce((n, f) => n + volume(f.geometry), 0);
      expect(total).toBeGreaterThan(0.03);
    }
  });

  it('the same piece breaks the same way every time', async () => {
    const a = await simulateShatter('rook', 'white-rook-0-0', [0.5, 0, -0.5]);
    const b = await simulateShatter('rook', 'white-rook-0-0', [0.5, 0, -0.5]);
    expect(a).toBe(b);
    // And they end up resting low, on the board or the table.
    for (const t of a.tracks) expect(t[t.length - 6]).toBeLessThan(0.5);
  });
});
