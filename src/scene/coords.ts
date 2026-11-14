import { fileOf, rankOf, type Square } from '../engine';

/** World position of a square's center on the board plane (y = 0). White's back rank is at +z. */
export function squareToWorld(sq: Square): [number, number, number] {
  return [fileOf(sq) - 3.5, 0, 3.5 - rankOf(sq)];
}
