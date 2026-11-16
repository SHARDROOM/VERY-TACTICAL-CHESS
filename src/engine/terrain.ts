import { COVER_NAME, type Board, type Color, type FallingPiece, type GameEvent, type Piece, type Square, type TerrainCell } from './types';
import { unseat } from './tags';
import { fileOf, rankOf, squareAt } from './squares';

/**
 * How terrain gets in the way. `noPass`: nothing enters or passes (a wall, a pit); `noLand`:
 * pieces may pass but not stop (a wall with a ladder). A bridged pit is plain ground.
 */
export interface TerrainBlocks {
  noPass: ReadonlySet<Square>;
  noLand: ReadonlySet<Square>;
}

export function terrainBlocks(terrain: readonly TerrainCell[] | undefined): TerrainBlocks {
  const noPass = new Set<Square>();
  const noLand = new Set<Square>();
  for (const c of terrain ?? []) {
    if (c.kind === 'wall') (c.cover?.kind === 'ladder' ? noLand : noPass).add(c.at);
    else if (c.cover?.kind !== 'bridge') noPass.add(c.at);
  }
  return { noPass, noLand };
}

/** The squares a piece may not stop on (walls, ladders included; unbridged pits). */
export function blockedSquares(terrain: readonly TerrainCell[] | undefined): ReadonlySet<Square> {
  const { noPass, noLand } = terrainBlocks(terrain);
  return new Set([...noPass, ...noLand]);
}

export const terrainAt = (terrain: readonly TerrainCell[] | undefined, sq: Square): TerrainCell | null =>
  terrain?.find((c) => c.at === sq) ?? null;

/** Most squares that may hold terrain at once, so the board never walls itself shut. */
export const MAX_TERRAIN = 12;

/**
 * Terrain counts down like a tag: one turn when its owner (the side whose turn it was made on)
 * finishes a turn, except the turn it was made. So do bridges and ladders, each on its own.
 * Called when `color`'s turn `turnNumber` ends. `fallen`: squares whose bridge is gone.
 */
export function tickTerrain(
  terrain: readonly TerrainCell[] | undefined,
  color: Color,
  turnNumber: number,
): { terrain: TerrainCell[]; events: GameEvent[]; fallen: Square[] } {
  const events: GameEvent[] = [];
  const kept: TerrainCell[] = [];
  const fallen: Square[] = [];
  const counts = (c: { owner: Color; turnsLeft: number | null; appliedOnTurn: number }) => c.owner === color && c.turnsLeft !== null && c.appliedOnTurn !== turnNumber;
  for (const cell of terrain ?? []) {
    let c = cell;
    if (c.cover && counts(c.cover)) {
      const left = c.cover.turnsLeft! - 1;
      if (left > 0) c = { ...c, cover: { ...c.cover, turnsLeft: left } };
      else {
        events.push({ type: 'coverGone', at: c.at, kind: c.cover.kind, expired: true });
        if (c.cover.kind === 'bridge') fallen.push(c.at);
        const { cover: _gone, ...bare } = c;
        void _gone;
        c = bare;
      }
    }
    if (!counts(c)) {
      kept.push(c);
      continue;
    }
    const left = c.turnsLeft! - 1;
    if (left > 0) kept.push({ ...c, turnsLeft: left });
    else events.push({ type: 'terrainCleared', at: c.at, kind: c.kind, expired: true });
  }
  return { terrain: kept, events, fallen };
}

/**
 * Whoever stands where a bridge was falls into the pit; a king (never taken but by a normal move)
 * is pushed to the nearest free square instead. Returns the new board and what happened.
 */
export function dropFromBridges(
  board: Board,
  squares: readonly Square[],
  terrain: readonly TerrainCell[],
): { board: (Piece | null)[]; events: GameEvent[]; falling: FallingPiece[] } {
  const next: (Piece | null)[] = [...board];
  const events: GameEvent[] = [];
  const falling: FallingPiece[] = [];
  const blocked = blockedSquares(terrain);
  for (const sq of squares) {
    const piece = next[sq];
    if (!piece) continue;
    // The pit may have gone in the same tick: then there is nothing to fall into.
    if (!terrain.some((c) => c.at === sq && c.kind === 'pit' && !c.cover)) continue;
    if (piece.type === 'king') {
      const to = nearestFree(next, sq, blocked);
      if (to === null) continue;
      next[to] = piece;
      next[sq] = null;
      events.push({ type: 'pushed', pieceId: piece.id, from: sq, to });
      continue;
    }
    next[sq] = null;
    events.push({ type: 'removed', piece, at: sq, cause: 'pit' });
    // Its rider is thrown off as it goes down (and may well follow it in).
    falling.push(...unseat(piece, sq, events));
  }
  return { board: next, events, falling };
}

/** The closest empty square a piece may stand on, nearest rings first, in board order. */
function nearestFree(board: Board, from: Square, blocked: ReadonlySet<Square>): Square | null {
  for (let r = 1; r < 8; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let df = -r; df <= r; df++) {
        if (Math.max(Math.abs(df), Math.abs(dr)) !== r) continue;
        const sq = squareAt(fileOf(from) + df, rankOf(from) + dr);
        if (sq !== null && !board[sq] && !blocked.has(sq)) return sq;
      }
    }
  }
  return null;
}

export const coverName = (kind: keyof typeof COVER_NAME) => COVER_NAME[kind];
