import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { fragmentsOf, simulateChunkThrow } from './shatter';
import { simulatePiece } from './piecePhysics';
import { tableDiceSide } from './coords';
import { coinLayout } from '../coins/layout';
import { DISH } from '../coins/coinSim';
import { TABLE_TOP_Y } from './WoodTable';

/*
 * The coin dishes are solid (사용자 제보: things went through the dish), where every screen draws
 * them (one table for all: tableDiceSide).
 */

const dish = (color: 'white' | 'black') => coinLayout(tableDiceSide() === 1 ? -1 : 1).dish[color];
/** Past the rim, toward the dish's middle. */
const inside = (x: number, dx: number) => Math.abs(x - dx) < DISH.radius;

describe('the coin dishes', () => {
  it('stop a chunk rolling at them: it stays outside the rim', async () => {
    const [chunk] = fragmentsOf('pawn');
    for (const color of ['white', 'black'] as const) {
      const [dx, dz] = dish(color);
      const out = Math.sign(dx);
      for (const seed of [1, 2, 3]) {
        const run = await simulateChunkThrow(chunk.hull, new Vector3(dx + out * 1.6, TABLE_TOP_Y + 0.2, dz), new Quaternion(), new Vector3(-out * 6, 0, 0), seed);
        const f = run.tracks[0];
        const last = (run.steps - 1) * 7;
        expect(inside(f[last], dx), `${color} seed ${seed}: x ${f[last].toFixed(2)} vs dish ${dx}`).toBe(false);
      }
    }
  }, 60_000);

  it('stop a taken piece knocked at them', async () => {
    const [dx, dz] = dish('white');
    const out = Math.sign(dx);
    const run = await simulatePiece({ type: 'pawn', scale: 0.62, start: { position: new Vector3(dx + out * 1.7, TABLE_TOP_Y + 0.02, dz), quaternion: new Quaternion() }, velocity: new Vector3(-out * 7, 0, 0), spin: new Vector3(), diceSide: tableDiceSide() });
    expect(inside(run.final.position.x, dx), `x ${run.final.position.x.toFixed(2)} vs dish ${dx}`).toBe(false);
  }, 60_000);
});
