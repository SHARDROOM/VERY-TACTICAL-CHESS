import type { Color, Square } from './types';

const FILES = 'abcdefgh';

/*
 * The board has two layers: the ground (squares 0..63) and, floating above it, the air
 * (64..127, the same square plus AIR). Only levitating pieces (공중부양) are in the air; the two
 * layers do not meet (see docs/SPEC.md, "공중부양").
 */
export const AIR = 64;
/** Squares on both layers. */
export const SQUARES = 128;
export const isAir = (sq: Square): boolean => sq >= AIR;
/** The ground square under (or at) `sq`. */
export const groundOf = (sq: Square): Square => sq % AIR;
/** The air square above (or at) `sq`. */
export const airOf = (sq: Square): Square => groundOf(sq) + AIR;
export const sameLayer = (a: Square, b: Square): boolean => isAir(a) === isAir(b);

export const fileOf = (sq: Square): number => sq % 8;
/** The rank on either layer. */
export const rankOf = (sq: Square): number => Math.floor(groundOf(sq) / 8);

/** The ground square at this file and rank (add AIR for the air above it). */
export function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return rank * 8 + file;
}

/** "e4", or "e4^" for the air above e4. */
export function squareName(sq: Square): string {
  return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}${isAir(sq) ? '^' : ''}`;
}

/** "e4" (ground) or "e4^" (the air above it). */
export function parseSquare(name: string): Square | null {
  const m = /^([a-h])([1-8])(\^)?$/.exec(name.trim().toLowerCase());
  if (!m) return null;
  const sq = squareAt(FILES.indexOf(m[1]), Number(m[2]) - 1)!;
  return m[3] ? sq + AIR : sq;
}

export const opponent = (c: Color): Color => (c === 'white' ? 'black' : 'white');
