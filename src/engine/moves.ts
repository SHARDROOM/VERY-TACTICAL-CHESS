import type { Board, Color, GameState, MoveSpecial, Square, TerrainCell } from './types';
import { fileOf, rankOf, squareAt } from './squares';
import { KING_START, ROOK_START } from './castling';
import { isStunned } from './tags';
import { blockedSquares } from './terrain';

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Basic movement: squares the piece on `from` can reach by its normal movement
 * pattern (no castling, no en passant). This is also what "attacks" means.
 * Moves that leave the mover's own king attacked are included: this game
 * allows them (the king is captured, not mated).
 * Walls and pits (`terrain`) can be neither entered nor passed; knights still jump over them.
 */
export function movesFrom(board: Board, from: Square, terrain?: readonly TerrainCell[]): Square[] {
  const piece = board[from];
  // A stunned piece cannot move, so it attacks nothing either.
  if (!piece || isStunned(piece)) return [];
  const f = fileOf(from);
  const r = rankOf(from);
  const out: Square[] = [];
  const blocked = blockedSquares(terrain);

  const canLand = (sq: Square) => !blocked.has(sq) && board[sq]?.color !== piece.color;

  const steps = (deltas: number[][]) => {
    for (const [df, dr] of deltas) {
      const sq = squareAt(f + df, r + dr);
      if (sq !== null && canLand(sq)) out.push(sq);
    }
  };

  const slides = (dirs: number[][]) => {
    for (const [df, dr] of dirs) {
      for (let i = 1; ; i++) {
        const sq = squareAt(f + df * i, r + dr * i);
        if (sq === null || blocked.has(sq)) break;
        const occupant = board[sq];
        if (!occupant) {
          out.push(sq);
          continue;
        }
        if (occupant.color !== piece.color) out.push(sq);
        break;
      }
    }
  };

  switch (piece.type) {
    case 'knight':
      steps(KNIGHT_STEPS);
      break;
    case 'king':
      steps(KING_STEPS);
      break;
    case 'rook':
      slides(ROOK_DIRS);
      break;
    case 'bishop':
      slides(BISHOP_DIRS);
      break;
    case 'queen':
      slides([...ROOK_DIRS, ...BISHOP_DIRS]);
      break;
    case 'pawn': {
      const dir = piece.color === 'white' ? 1 : -1;
      const startRank = piece.color === 'white' ? 1 : 6;
      const one = squareAt(f, r + dir);
      if (one !== null && !board[one] && !blocked.has(one)) {
        out.push(one);
        const two = squareAt(f, r + 2 * dir);
        if (r === startRank && two !== null && !board[two] && !blocked.has(two)) out.push(two);
      }
      for (const df of [-1, 1]) {
        const diag = squareAt(f + df, r + dir);
        if (diag !== null && board[diag] && board[diag]!.color !== piece.color) out.push(diag);
      }
      break;
    }
  }
  return out;
}

/** True if any piece of `by` could move onto `target`. */
export function isAttacked(board: Board, target: Square, by: Color, terrain?: readonly TerrainCell[]): boolean {
  for (let sq = 0; sq < 64; sq++) {
    if (board[sq]?.color === by && movesFrom(board, sq, terrain).includes(target)) return true;
  }
  return false;
}

export function findKing(board: Board, color: Color): Square | null {
  const idx = board.findIndex((p) => p?.type === 'king' && p.color === color);
  return idx === -1 ? null : idx;
}

/** True if `color`'s king is currently attacked by the opponent (walls and pits block lines). */
export function isInCheck(board: Board, color: Color, terrain?: readonly TerrainCell[]): boolean {
  const king = findKing(board, color);
  if (king === null) return false;
  return isAttacked(board, king, color === 'white' ? 'black' : 'white', terrain);
}

export interface Target {
  to: Square;
  special?: Extract<MoveSpecial, { kind: 'castle' | 'enPassant' }>;
}

/** All normal-move destinations for the piece on `from`, including castling and en passant. */
export function legalTargets(state: GameState, from: Square): Target[] {
  const { board, terrain } = state;
  const piece = board[from];
  if (!piece || isStunned(piece)) return [];
  const out: Target[] = movesFrom(board, from, terrain).map((to) => ({ to }));
  const blocked = blockedSquares(terrain);

  if (piece.type === 'pawn' && state.enPassant !== null) {
    const ep = state.enPassant;
    const dir = piece.color === 'white' ? 1 : -1;
    const victim = squareAt(fileOf(ep), rankOf(ep) - dir);
    const victimPiece = victim === null ? null : board[victim];
    if (
      rankOf(ep) === rankOf(from) + dir &&
      Math.abs(fileOf(ep) - fileOf(from)) === 1 &&
      !board[ep] &&
      !blocked.has(ep) &&
      victimPiece?.type === 'pawn' &&
      victimPiece.color !== piece.color
    ) {
      out.push({ to: ep, special: { kind: 'enPassant' } });
    }
  }

  // Castling ignores check entirely: this game lets a king stand in, pass
  // through, or land on attacked squares (it can then simply be captured).
  if (piece.type === 'king' && from === KING_START[piece.color]) {
    const rights = state.castling[piece.color];
    const rank = rankOf(from);
    const sides = [
      { side: 'king' as const, allowed: rights.kingSide, rook: ROOK_START[piece.color].kingSide, between: [5, 6], kingTo: 6 },
      { side: 'queen' as const, allowed: rights.queenSide, rook: ROOK_START[piece.color].queenSide, between: [1, 2, 3], kingTo: 2 },
    ];
    for (const s of sides) {
      const rook = board[s.rook];
      if (!s.allowed || rook?.type !== 'rook' || rook.color !== piece.color || isStunned(rook)) continue;
      if (s.between.some((f) => board[squareAt(f, rank)!] || blocked.has(squareAt(f, rank)!))) continue;
      out.push({ to: squareAt(s.kingTo, rank)!, special: { kind: 'castle', side: s.side } });
    }
  }
  return out;
}
