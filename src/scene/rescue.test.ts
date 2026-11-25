import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { fragmentsOf, simulateChunkThrow } from './shatter';
import { tableHalf } from './coords';
import { TABLE_TOP_Y } from './WoodTable';

/* Things off the table come back (사용자 요청). */

describe('a chunk thrown over the table edge', () => {
  it('comes back and lies on the table, not on the floor', async () => {
    const [chunk] = fragmentsOf('rook');
    const run = await simulateChunkThrow(chunk.hull, new Vector3(9, TABLE_TOP_Y + 1, 0), new Quaternion(), new Vector3(14, 2, 0), 7);
    const f = run.tracks[0];
    const last = (run.steps - 1) * 7;
    const [x, y, z] = [f[last], f[last + 1], f[last + 2]];
    const [hw, hd] = tableHalf();
    // It went over the edge at some point...
    let lowest = Infinity;
    for (let i = 1; i < f.length; i += 7) lowest = Math.min(lowest, f[i]);
    expect(lowest).toBeLessThan(TABLE_TOP_Y);
    // ...and rests on the table again, inside its edges.
    expect(y).toBeGreaterThan(TABLE_TOP_Y - 0.05);
    expect(y).toBeLessThan(TABLE_TOP_Y + 0.6);
    expect(Math.abs(x)).toBeLessThan(hw);
    expect(Math.abs(z)).toBeLessThan(hd);
  });
});
