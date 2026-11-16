import type { Color, Square } from './types';
import { HEX_SQUARES, halfOf as hexHalf, hexCenter, hexDistance, hexRank, hexSquare, hexSquareAt, step as hexStep, type Dir, type Half } from './hex/geometry';

const FILES = 'abcdefgh';

/*
 * The board a game is played on (docs/SPEC.md, "3인 육각 맵"): the classic 8×8 board for two, or
 * the three-player hexagon. Each has two layers: the ground (0..AIR-1) and, floating above it,
 * the air (AIR..SQUARES-1, the same square plus AIR). Only levitating pieces (공중부양) are in the
 * air; the two layers do not meet (see docs/SPEC.md, "공중부양").
 *
 * One game is played at a time, so the map is set once for it (setBoardMap, from the game's
 * state) and every square helper follows it. AIR and SQUARES change with it (live bindings).
 */
export type BoardMap = 'classic' | 'hex3';
let MAP: BoardMap = 'classic';
export let AIR = 64;
/** Squares on both layers. */
export let SQUARES = 128;

/** Plays on `map` from now on (a game's state names its map; missing is the classic board). */
export function setBoardMap(map: BoardMap | undefined): void {
  MAP = map ?? 'classic';
  AIR = MAP === 'hex3' ? HEX_SQUARES : 64;
  SQUARES = AIR * 2;
}
export const boardMap = (): BoardMap => MAP;
export const isHex = (): boolean => MAP === 'hex3';

/** The players on this board, in turn order. */
export const playersOf = (map: BoardMap = MAP): Color[] => (map === 'hex3' ? ['white', 'black', 'red'] : ['white', 'black']);
/** A player's own half of the hexagon (0 on the classic board). */
export const homeHalf = (c: Color): Half => (c === 'white' ? 0 : c === 'black' ? 1 : 2);

export const isAir = (sq: Square): boolean => sq >= AIR;
/** The ground square under (or at) `sq`. */
export const groundOf = (sq: Square): Square => sq % AIR;
/** The air square above (or at) `sq`. */
export const airOf = (sq: Square): Square => groundOf(sq) + AIR;
export const sameLayer = (a: Square, b: Square): boolean => isAir(a) === isAir(b);

export const fileOf = (sq: Square): number => groundOf(sq) % 8;
/** The rank on either layer (on the hexagon: within its half, 0..3). */
export const rankOf = (sq: Square): number => (MAP === 'hex3' ? hexRank(groundOf(sq)) : Math.floor(groundOf(sq) / 8));
/** The half of the hexagon a square is on (0 on the classic board). */
export const halfOf = (sq: Square): Half => (MAP === 'hex3' ? hexHalf(groundOf(sq)) : 0);

/** The ground square at this file and rank (of this half, on the hexagon); add AIR for the air above it. */
export function squareAt(file: number, rank: number, half: Half = 0): Square | null {
  if (MAP === 'hex3') {
    if (file < 0 || file > 7 || rank < 0 || rank > 3) return null;
    return hexSquare(half, file, rank);
  }
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return rank * 8 + file;
}

/** A player's back-rank square on this file (rank 1 of its own side). */
export const backRank = (c: Color, file: number): Square => (MAP === 'hex3' ? hexSquare(homeHalf(c), file, 0) : (c === 'black' ? 7 : 0) * 8 + file);

/**
 * One step from `sq` in direction `dir`, on its layer. On the classic board a direction is the
 * same everywhere (files right, ranks up toward black); on the hexagon it is in the frame of the
 * half the square is on and may turn round across a seam, or split through the centre.
 */
export function step(sq: Square, dir: Dir): { sq: Square; dir: Dir }[] {
  const layer = isAir(sq) ? AIR : 0;
  if (MAP === 'hex3') return hexStep(groundOf(sq), dir).map((s) => ({ sq: s.sq + layer, dir: s.dir }));
  const to = squareAt(fileOf(sq) + dir.df, rankOf(sq) + dir.dr);
  return to === null ? [] : [{ sq: to + layer, dir }];
}

/** How many king steps apart two squares are (the air above a square is one more). */
export function distance(a: Square, b: Square): number {
  const layers = isAir(a) === isAir(b) ? 0 : 1;
  if (MAP === 'hex3') return Math.max(hexDistance(groundOf(a), groundOf(b)), layers);
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)), layers);
}

/**
 * A square's centre on the board's plane (the classic board: its file and rank; the hexagon: board
 * units from its centre, white at the bottom). The screens and falling pieces use it.
 */
export function planeOf(sq: Square): { x: number; y: number } {
  if (MAP === 'hex3') return hexCenter(groundOf(sq));
  return { x: fileOf(sq), y: rankOf(sq) };
}
/** The ground square under a point of the board's plane (see planeOf), or null off the board. */
export function squareAtPoint(x: number, y: number): Square | null {
  if (MAP === 'hex3') return hexSquareAt(x, y);
  return squareAt(Math.round(x), Math.round(y));
}

/** The pawn's way forward on `sq` (a rank step): toward the far side, which on the hexagon turns at the seam. */
export function pawnForward(c: Color, sq: Square): number {
  if (MAP === 'hex3') return halfOf(sq) === homeHalf(c) ? 1 : -1;
  return c === 'black' ? -1 : 1;
}
/** A pawn of `c` on `sq` stands where it starts (and may step two). */
export const pawnStart = (c: Color, sq: Square): boolean =>
  !isAir(sq) && (MAP === 'hex3' ? halfOf(sq) === homeHalf(c) && rankOf(sq) === 1 : rankOf(sq) === (c === 'black' ? 6 : 1));
/** A pawn of `c` reaching `sq` promotes: the far side's back rank (on the hexagon, any other player's). */
export const promotesOn = (c: Color, sq: Square): boolean =>
  c !== 'gray' &&
  (MAP === 'hex3' ? halfOf(sq) !== homeHalf(c) && rankOf(sq) === 0 : rankOf(sq) === (c === 'black' ? 0 : 7));

const SIDE_NAME = '백흑적';
/** "e4", or "e4^" for the air above e4; on the hexagon "흑e4" (the half's owner, then the square as they name it). */
export function squareName(sq: Square): string {
  const half = MAP === 'hex3' ? SIDE_NAME[halfOf(sq)] : '';
  return `${half}${FILES[fileOf(sq)]}${rankOf(sq) + 1}${isAir(sq) ? '^' : ''}`;
}

/** The pattern of a square name on this board (for finding names in text). */
export const SQUARE_PATTERN = (): string => (MAP === 'hex3' ? '(?:[백흑적]|[wbr]-?)\\s?[a-h][1-4]\\^?' : '[a-h][1-8]\\^?');

/** "e4" (ground) or "e4^" (the air above it); on the hexagon "흑e4", "흑 e4" or "b-e4". */
export function parseSquare(name: string): Square | null {
  const text = name.trim().toLowerCase();
  if (MAP === 'hex3') {
    const m = /^([백흑적]|[wbr])-?\s?([a-h])([1-4])(\^)?$/.exec(text);
    if (!m) return null;
    const half = (('백흑적'.includes(m[1]) ? '백흑적'.indexOf(m[1]) : 'wbr'.indexOf(m[1])) as Half);
    const sq = hexSquare(half, FILES.indexOf(m[2]), Number(m[3]) - 1);
    return m[4] ? sq + AIR : sq;
  }
  const m = /^([a-h])([1-8])(\^)?$/.exec(text);
  if (!m) return null;
  const sq = squareAt(FILES.indexOf(m[1]), Number(m[2]) - 1)!;
  return m[3] ? sq + AIR : sq;
}

/** The other player on the classic board (on the hexagon: the next in turn order). */
export const opponent = (c: Color): Color => {
  const all = playersOf();
  return all[(all.indexOf(c) + 1) % all.length];
};

/** Every square on the ground, nearest to `from` first (ties in board order). */
export function byDistance(from: Square): Square[] {
  const g = groundOf(from);
  return Array.from({ length: AIR }, (_, s) => s)
    .filter((s) => s !== g)
    .sort((a, b) => distance(g, a) - distance(g, b) || a - b);
}
export type { Dir, Half };
