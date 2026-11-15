import type { Color, GameEvent, Square, TerrainCell } from './types';

/** Walls and pits as a lookup: the squares nothing may enter or pass through. */
export function blockedSquares(terrain: readonly TerrainCell[] | undefined): ReadonlySet<Square> {
  return new Set((terrain ?? []).map((c) => c.at));
}

export const terrainAt = (terrain: readonly TerrainCell[] | undefined, sq: Square): TerrainCell | null =>
  terrain?.find((c) => c.at === sq) ?? null;

/** Most squares that may hold terrain at once, so the board never walls itself shut. */
export const MAX_TERRAIN = 12;

/**
 * Terrain counts down like a tag: one turn when its owner (the side whose turn it was made on)
 * finishes a turn, except the turn it was made. Called when `color`'s turn `turnNumber` ends.
 */
export function tickTerrain(terrain: readonly TerrainCell[] | undefined, color: Color, turnNumber: number): { terrain: TerrainCell[]; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const kept: TerrainCell[] = [];
  for (const c of terrain ?? []) {
    if (c.owner !== color || c.turnsLeft === null || c.appliedOnTurn === turnNumber) {
      kept.push(c);
      continue;
    }
    const left = c.turnsLeft - 1;
    if (left > 0) kept.push({ ...c, turnsLeft: left });
    else events.push({ type: 'terrainCleared', at: c.at, kind: c.kind, expired: true });
  }
  return { terrain: kept, events };
}
