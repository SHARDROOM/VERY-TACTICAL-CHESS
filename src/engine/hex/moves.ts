import type { PieceType } from '../types';
import { HEX_SQUARES, halfOf, hexRank, step, type Dir, type Half } from './geometry';

/*
 * Movement on the three-player board (see geometry.ts). Pieces move as in chess, step by step
 * along the board's seams: a slide follows its line across a seam (and splits in two through the
 * centre), a knight goes two squares straight and one aside (either order), a pawn moves toward
 * the far side of whichever half it stands on: inward on its own half, then down the other half
 * toward that player's back rank, where it promotes.
 */

export type HexColor = 'white' | 'black' | 'red';
export const HEX_COLORS: readonly HexColor[] = ['white', 'black', 'red'];
/** Each player's own half. */
export const homeHalf = (c: HexColor): Half => HEX_COLORS.indexOf(c) as Half;

export interface HexPiece {
  id: string;
  type: PieceType;
  color: HexColor;
}
export type HexBoard = ReadonlyArray<HexPiece | null>;

const ORTHO: Dir[] = [{ df: 1, dr: 0 }, { df: -1, dr: 0 }, { df: 0, dr: 1 }, { df: 0, dr: -1 }];
const DIAG: Dir[] = [{ df: 1, dr: 1 }, { df: 1, dr: -1 }, { df: -1, dr: 1 }, { df: -1, dr: -1 }];

/** Every square a slide along `dir` from `from` passes, splitting through the centre; stops at the first piece. */
function slide(board: HexBoard, from: number, dir: Dir, limit = 8): { sq: number; occupied: boolean }[] {
  const out: { sq: number; occupied: boolean }[] = [];
  let rays = [{ sq: from, dir }];
  for (let i = 0; i < limit && rays.length; i++) {
    const nextRays: typeof rays = [];
    for (const ray of rays) {
      for (const s of step(ray.sq, ray.dir)) {
        const occupied = !!board[s.sq];
        out.push({ sq: s.sq, occupied });
        if (!occupied) nextRays.push(s);
      }
    }
    rays = nextRays;
  }
  return out;
}

/** Where a straight step lands and whether the frame turned round (the seam mirrors it). */
function straight(sq: number, dir: Dir): { sq: number; flip: number } | null {
  const s = step(sq, dir)[0];
  if (!s) return null;
  return { sq: s.sq, flip: s.dir.dr === dir.dr && s.dir.df === dir.df ? 1 : -1 };
}

/** Knight targets: two straight then one aside, or one aside then two straight. */
function knightTargets(from: number): number[] {
  const out = new Set<number>();
  for (const d of ORTHO) {
    for (const e of ORTHO) {
      if (d.df * e.df + d.dr * e.dr !== 0) continue;
      // Two along d, then one along e (turned with the frame if a seam was crossed).
      let a = straight(from, d);
      if (a) {
        const b = straight(a.sq, { df: d.df * a.flip, dr: d.dr * a.flip });
        if (b) {
          const k = a.flip * b.flip;
          const c = straight(b.sq, { df: e.df * k, dr: e.dr * k });
          if (c) out.add(c.sq);
        }
      }
      // One along e, then two along d.
      a = straight(from, e);
      if (a) {
        const b = straight(a.sq, { df: d.df * a.flip, dr: d.dr * a.flip });
        if (b) {
          const k = a.flip * b.flip;
          const c = straight(b.sq, { df: d.df * k, dr: d.dr * k });
          if (c) out.add(c.sq);
        }
      }
    }
  }
  out.delete(from);
  return [...out];
}

/** The way forward for a pawn of `color` standing on `sq`: inward on its own half, outward on the others. */
export const pawnForward = (color: HexColor, sq: number): number => (halfOf(sq) === homeHalf(color) ? 1 : -1);

/** Squares the piece on `from` can move to (or capture on) by its kind's movement. */
export function hexMovesFrom(board: HexBoard, from: number, kinds?: readonly PieceType[]): number[] {
  const piece = board[from];
  if (!piece) return [];
  const out = new Set<number>();
  const mine = (sq: number) => board[sq]?.color === piece.color;
  const slides = (dirs: Dir[], limit?: number) => {
    for (const d of dirs) for (const s of slide(board, from, d, limit)) if (!mine(s.sq)) out.add(s.sq);
  };
  for (const kind of kinds ?? [piece.type]) {
    if (kind === 'rook') slides(ORTHO);
    if (kind === 'bishop') slides(DIAG);
    if (kind === 'queen') slides([...ORTHO, ...DIAG]);
    if (kind === 'king') slides([...ORTHO, ...DIAG], 1);
    if (kind === 'knight') for (const sq of knightTargets(from)) if (!mine(sq)) out.add(sq);
    if (kind === 'pawn') {
      const fwd = pawnForward(piece.color, from);
      const one = step(from, { df: 0, dr: fwd })[0];
      if (one && !board[one.sq]) {
        out.add(one.sq);
        // Two from its starting rank (the 2nd of its own half).
        if (halfOf(from) === homeHalf(piece.color) && hexRank(from) === 1) {
          const two = step(one.sq, one.dir)[0];
          if (two && !board[two.sq]) out.add(two.sq);
        }
      }
      for (const df of [-1, 1]) {
        for (const s of step(from, { df, dr: fwd })) if (board[s.sq] && !mine(s.sq)) out.add(s.sq);
      }
    }
  }
  return [...out];
}

/** A pawn of `color` on `sq` promotes: it reached another player's back rank. */
export const promotes = (color: HexColor, sq: number): boolean => halfOf(sq) !== homeHalf(color) && hexRank(sq) === 0;

/** The starting position: each player's army on its own half, as on a normal board. */
export function hexStartBoard(): (HexPiece | null)[] {
  const board: (HexPiece | null)[] = Array.from({ length: HEX_SQUARES }, () => null);
  const back: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  for (const color of HEX_COLORS) {
    const h = homeHalf(color);
    for (let f = 0; f < 8; f++) {
      board[h * 32 + f] = { id: `${color}-${back[f]}-${f}`, type: back[f], color };
      board[h * 32 + 8 + f] = { id: `${color}-pawn-${f}`, type: 'pawn', color };
    }
  }
  return board;
}
