import type { CastlingRights, Color, Square } from './types';
import { backRank, playersOf } from './squares';

/** Where a king starts (e1 of its own side). */
export const kingStart = (c: Color): Square => backRank(c, 4);
/** Where a rook starts, on the king's side (h1) or the queen's (a1). */
export const rookStart = (c: Color, side: 'king' | 'queen'): Square => backRank(c, side === 'king' ? 7 : 0);

const both = { kingSide: true, queenSide: true };
export const FULL_CASTLING: CastlingRights = { white: both, black: both, red: both };
export const NO_CASTLING: CastlingRights = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false }, red: { kingSide: false, queenSide: false } };

/**
 * Revoke rights for every start square that a change touched. Works for any board
 * change (normal moves, captures, and later special-action effects): if a king or
 * rook leaves its start square, or anything lands on it, the right is gone.
 */
export function revokeCastling(rights: CastlingRights, touched: Square[]): CastlingRights {
  const next = { ...rights } as CastlingRights;
  for (const color of playersOf()) {
    const own = { ...(rights[color] ?? { kingSide: false, queenSide: false }) };
    if (touched.includes(kingStart(color))) {
      own.kingSide = false;
      own.queenSide = false;
    }
    if (touched.includes(rookStart(color, 'king'))) own.kingSide = false;
    if (touched.includes(rookStart(color, 'queen'))) own.queenSide = false;
    next[color] = own;
  }
  return next;
}
