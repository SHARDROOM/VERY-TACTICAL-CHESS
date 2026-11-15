import { fileOf, isAir, rankOf, type Square } from '../engine';

/** Height of the air layer (공중부양): a second board floating over the first, clear of the tallest piece. */
export const AIR_Y = 1.45;

/** World position of a square's center: on the board plane (y = 0), or on the air layer above it. White's back rank is at +z. */
export function squareToWorld(sq: Square): [number, number, number] {
  return [fileOf(sq) - 3.5, isAir(sq) ? AIR_Y : 0, 3.5 - rankOf(sq)];
}

/** Continuous board coordinates (a square's centre is its file and rank) of a world point. */
export function worldToBoard(x: number, z: number): { file: number; rank: number } {
  return { file: x + 3.5, rank: 3.5 - z };
}
