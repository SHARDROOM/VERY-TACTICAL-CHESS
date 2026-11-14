import type { Color, Square } from './types';

const FILES = 'abcdefgh';

export const fileOf = (sq: Square): number => sq % 8;
export const rankOf = (sq: Square): number => Math.floor(sq / 8);

export function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return rank * 8 + file;
}

export function squareName(sq: Square): string {
  return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

export function parseSquare(name: string): Square | null {
  const m = /^([a-h])([1-8])$/.exec(name.trim().toLowerCase());
  if (!m) return null;
  return squareAt(FILES.indexOf(m[1]), Number(m[2]) - 1);
}

export const opponent = (c: Color): Color => (c === 'white' ? 'black' : 'white');
