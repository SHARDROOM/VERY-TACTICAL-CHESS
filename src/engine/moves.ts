import { GRAY, type Board, type Color, type GameState, type MoveSpecial, type Square, type TerrainCell } from './types';
import { SQUARES, backRank, isAir, pawnForward, pawnStart, step, type Dir } from './squares';
import { kingStart, rookStart } from './castling';
import { isStunned, movePatterns, movesReplaced } from './tags';
import { blockedSquares, terrainBlocks } from './terrain';

const ORTHO: Dir[] = [{ df: 1, dr: 0 }, { df: -1, dr: 0 }, { df: 0, dr: 1 }, { df: 0, dr: -1 }];
const DIAG: Dir[] = [{ df: 1, dr: 1 }, { df: 1, dr: -1 }, { df: -1, dr: 1 }, { df: -1, dr: -1 }];

/** Where a straight step lands and whether the frame turned round (a seam of the hexagon mirrors it). */
function straight(sq: Square, dir: Dir): { sq: Square; flip: number } | null {
  const s = step(sq, dir)[0];
  if (!s) return null;
  return { sq: s.sq, flip: s.dir.dr === dir.dr && s.dir.df === dir.df ? 1 : -1 };
}

/** Knight squares: two straight then one aside, or one aside then two straight (the same on a plain board). */
function knightSquares(from: Square): Square[] {
  const out = new Set<Square>();
  const turn = (d: Dir, k: number): Dir => ({ df: d.df * k, dr: d.dr * k });
  for (const d of ORTHO) {
    for (const e of ORTHO) {
      if (d.df * e.df + d.dr * e.dr !== 0) continue;
      const a = straight(from, d);
      const b = a && straight(a.sq, turn(d, a.flip));
      const c = b && straight(b.sq, turn(e, a!.flip * b.flip));
      if (c) out.add(c.sq);
      const a2 = straight(from, e);
      const b2 = a2 && straight(a2.sq, turn(d, a2.flip));
      const c2 = b2 && straight(b2.sq, turn(d, a2!.flip * b2.flip));
      if (c2) out.add(c2.sq);
    }
  }
  out.delete(from);
  return [...out];
}

/**
 * Basic movement: squares the piece on `from` can reach by its normal movement
 * pattern (no castling, no en passant). This is also what "attacks" means.
 * Moves that leave the mover's own king attacked are included: this game
 * allows them (the king is captured, not mated).
 * Walls and pits (`terrain`) can be neither entered nor passed; knights still jump over them.
 * A piece in the air moves (and captures) on the air layer only, over all terrain.
 * A piece whose tag lends it other kinds' moves (moveAs) moves like those instead of itself.
 * On the hexagon lines follow the seams and split through the centre (see squares.ts, step).
 */
export function movesFrom(board: Board, from: Square, terrain?: readonly TerrainCell[]): Square[] {
  const piece = board[from];
  // A stunned piece cannot move, so it attacks nothing either.
  if (!piece || isStunned(piece)) return [];
  const out: Square[] = [];
  // Walls and unbridged pits stop everything; a laddered wall can be crossed but not stood on.
  const { noPass, noLand } = isAir(from) ? terrainBlocks([]) : terrainBlocks(terrain);

  const canLand = (sq: Square) => !noPass.has(sq) && !noLand.has(sq) && board[sq]?.color !== piece.color;

  const slides = (dirs: Dir[], limit = 16) => {
    for (const dir of dirs) {
      let rays = [{ sq: from, dir }];
      for (let i = 0; i < limit && rays.length; i++) {
        const next: typeof rays = [];
        for (const ray of rays) {
          for (const s of step(ray.sq, ray.dir)) {
            if (noPass.has(s.sq)) continue;
            if (noLand.has(s.sq)) {
              next.push(s);
              continue;
            }
            const occupant = board[s.sq];
            if (!occupant) {
              out.push(s.sq);
              next.push(s);
            } else if (occupant.color !== piece.color) out.push(s.sq);
          }
        }
        rays = next;
      }
    }
  };

  for (const kind of movePatterns(piece)) switch (kind) {
    case 'knight':
      for (const sq of knightSquares(from)) if (canLand(sq)) out.push(sq);
      break;
    case 'king':
      for (const d of [...ORTHO, ...DIAG]) for (const s of step(from, d)) if (canLand(s.sq)) out.push(s.sq);
      break;
    case 'rook':
      slides(ORTHO);
      break;
    case 'bishop':
      slides(DIAG);
      break;
    case 'queen':
      slides([...ORTHO, ...DIAG]);
      break;
    case 'pawn': {
      // A gray (wandering) pawn has no side to march toward: it steps one square any way.
      if (piece.color === GRAY) {
        for (const d of [...ORTHO, ...DIAG]) for (const s of step(from, d)) if (canLand(s.sq)) out.push(s.sq);
        break;
      }
      const fwd = pawnForward(piece.color, from);
      const one = step(from, { df: 0, dr: fwd })[0];
      if (one && !board[one.sq] && !noPass.has(one.sq)) {
        if (!noLand.has(one.sq)) out.push(one.sq);
        const two = pawnStart(piece.color, from) ? step(one.sq, one.dir)[0] : undefined;
        if (two && !board[two.sq] && canLand(two.sq)) out.push(two.sq);
      }
      for (const df of [-1, 1]) {
        for (const s of step(from, { df, dr: fwd })) if (board[s.sq] && board[s.sq]!.color !== piece.color) out.push(s.sq);
      }
      break;
    }
  }
  // Two kinds can reach the same square.
  return [...new Set(out)];
}

/** True if any piece of `by` could move onto `target`. */
export function isAttacked(board: Board, target: Square, by: Color, terrain?: readonly TerrainCell[]): boolean {
  for (let sq = 0; sq < SQUARES; sq++) {
    if (board[sq]?.color === by && movesFrom(board, sq, terrain).includes(target)) return true;
  }
  return false;
}

export function findKing(board: Board, color: Color): Square | null {
  const idx = board.findIndex((p) => p?.type === 'king' && p.color === color);
  return idx === -1 ? null : idx;
}

/**
 * True if `color`'s king is currently attacked by anyone else (walls and pits block lines). Only
 * pieces on the king's layer can attack it: a floating king is safe from the ground, and the other way round.
 */
export function isInCheck(board: Board, color: Color, terrain?: readonly TerrainCell[]): boolean {
  const king = findKing(board, color);
  if (king === null) return false;
  for (let sq = 0; sq < SQUARES; sq++) {
    const p = board[sq];
    // Gray wanderers never take a king, so they never give check either.
    if (p && p.color !== color && p.color !== GRAY && movesFrom(board, sq, terrain).includes(king)) return true;
  }
  return false;
}

/**
 * Where the pawn taken en passant stands: one step past the square the capturer lands on (`to`),
 * back the way the capturer was heading (it skipped `to` going the other way).
 */
export function enPassantVictim(from: Square, to: Square): Square {
  for (const df of [-1, 1]) {
    for (const dr of [-1, 1]) {
      const s = step(from, { df, dr }).find((x) => x.sq === to);
      if (s) return step(to, { df: 0, dr: -s.dir.dr })[0]?.sq ?? to;
    }
  }
  return to;
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

  // En passant is a ground move (the skipped square is on the ground), for anything that moves like a pawn:
  // a diagonal step forward onto the square a pawn just skipped, taking the pawn beyond it.
  if (movePatterns(piece).includes('pawn') && state.enPassant !== null && !isAir(from)) {
    const ep = state.enPassant;
    const fwd = pawnForward(piece.color, from);
    const onto = [-1, 1].flatMap((df) => step(from, { df, dr: fwd })).find((s) => s.sq === ep);
    const victim = onto ? step(ep, { df: 0, dr: -onto.dir.dr })[0]?.sq ?? null : null;
    const victimPiece = victim === null ? null : board[victim];
    if (onto && !board[ep] && !blocked.has(ep) && victimPiece?.type === 'pawn' && victimPiece.color !== piece.color) {
      out.push({ to: ep, special: { kind: 'enPassant' } });
    }
  }

  // Castling ignores check entirely: this game lets a king stand in, pass
  // through, or land on attacked squares (it can then simply be captured).
  if (piece.type === 'king' && !movesReplaced(piece) && from === kingStart(piece.color)) {
    const rights = state.castling[piece.color];
    const sides = [
      { side: 'king' as const, allowed: rights.kingSide, rook: rookStart(piece.color, 'king'), between: [5, 6], kingTo: 6 },
      { side: 'queen' as const, allowed: rights.queenSide, rook: rookStart(piece.color, 'queen'), between: [1, 2, 3], kingTo: 2 },
    ];
    for (const s of sides) {
      const rook = board[s.rook];
      if (!s.allowed || rook?.type !== 'rook' || rook.color !== piece.color || isStunned(rook)) continue;
      if (s.between.some((f) => board[backRank(piece.color, f)] || blocked.has(backRank(piece.color, f)))) continue;
      out.push({ to: backRank(piece.color, s.kingTo), special: { kind: 'castle', side: s.side } });
    }
  }
  return out;
}
