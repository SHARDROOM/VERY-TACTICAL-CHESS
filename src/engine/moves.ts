import type { Board, Color, Square } from './types';
import { fileOf, rankOf, squareAt } from './squares';

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Squares the piece on `from` can move to under standard movement rules.
 * Moves that leave the mover's own king attacked are included: this game
 * allows them (the king is captured, not mated).
 * Castling, en passant and promotion are not handled yet.
 */
export function movesFrom(board: Board, from: Square): Square[] {
  const piece = board[from];
  if (!piece) return [];
  const f = fileOf(from);
  const r = rankOf(from);
  const out: Square[] = [];

  const canLand = (sq: Square) => board[sq]?.color !== piece.color;

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
        if (sq === null) break;
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
      if (one !== null && !board[one]) {
        out.push(one);
        const two = squareAt(f, r + 2 * dir);
        if (r === startRank && two !== null && !board[two]) out.push(two);
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
export function isAttacked(board: Board, target: Square, by: Color): boolean {
  for (let sq = 0; sq < 64; sq++) {
    if (board[sq]?.color === by && movesFrom(board, sq).includes(target)) return true;
  }
  return false;
}

export function findKing(board: Board, color: Color): Square | null {
  const idx = board.findIndex((p) => p?.type === 'king' && p.color === color);
  return idx === -1 ? null : idx;
}

/** True if `color`'s king is currently attacked by the opponent. */
export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (king === null) return false;
  return isAttacked(board, king, color === 'white' ? 'black' : 'white');
}
