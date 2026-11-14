import { describe, expect, it } from 'vitest';
import { simulateCoinThrow, DISH, type Pose } from './coinSim';
import { TABLE_TOP_Y } from '../scene/WoodTable';

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('dealer throws coins', () => {
  it('coins land and come to rest inside the dish, piling on top of the ones already there', async () => {
    const dishX = 6.9;
    const dishZ = 1.5;
    let pile: Pose[] = [];
    for (let round = 0; round < 8; round++) {
      const t = await simulateCoinThrow({ count: 1, dishX, dishZ, fromX: 11.9, pile, random: seeded(round * 31 + 7) });
      for (const c of t.coins) {
        const { x, y, z } = c.final.position;
        expect(Math.hypot(x - dishX, z - dishZ)).toBeLessThan(DISH.radius);
        expect(y).toBeGreaterThan(TABLE_TOP_Y);
        expect(y).toBeLessThan(TABLE_TOP_Y + 0.6);
        pile = [...pile, c.final];
      }
    }
    expect(pile).toHaveLength(8);
  }, 60_000);

  it('throws several coins in one go, one after another', async () => {
    const t = await simulateCoinThrow({ count: 3, dishX: -6.9, dishZ: -1.9, fromX: -11.9, pile: [], random: seeded(99) });
    expect(t.coins.map((c) => c.start)).toEqual([0, 9, 18]);
    for (const c of t.coins) expect(Math.hypot(c.final.position.x + 6.9, c.final.position.z + 1.9)).toBeLessThan(DISH.radius);
  }, 60_000);
});
