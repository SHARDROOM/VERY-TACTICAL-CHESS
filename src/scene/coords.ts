import { isAir, isHex, planeOf, squareAtPoint, type Color, type Square } from '../engine';

/*
 * Where the board is on the table, for either board (docs/SPEC.md, "3인 육각 맵"): the classic
 * 8×8 (a square is 1 wide, white's back rank at +z) or the three-player hexagon (its plane is the
 * engine's, white at +z, black to the right and away, red to the left and away).
 */

/** Height of the air layer (공중부양): where floating pieces stand, well clear of the tallest piece below. */
export const AIR_Y = 2.3;

/** World position of a square's center: on the board plane (y = 0), or on the air layer above it. White's back rank is at +z. */
export function squareToWorld(sq: Square): [number, number, number] {
  const p = planeOf(sq);
  const y = isAir(sq) ? AIR_Y : 0;
  return isHex() ? [p.x, y, -p.y] : [p.x - 3.5, y, 3.5 - p.y];
}

/** The board's plane coordinates of a world point (classic: a square's centre is its file and rank; see planeOf). */
export function worldToBoard(x: number, z: number): { file: number; rank: number } {
  return isHex() ? { file: x, rank: -z } : { file: x + 3.5, rank: 3.5 - z };
}

/** The ground square under a world point, or null off the board. */
export function worldToSquare(x: number, z: number): Square | null {
  const b = worldToBoard(x, z);
  return squareAtPoint(b.file, b.rank);
}

/** The hexagon's outer edge (its frame included), from its centre to a corner. */
export const HEX_FRAME_R = 8.75;
const COS30 = Math.cos(Math.PI / 6);

/** Whether a world point is over the board (its frame included), `margin` further out. */
export function overBoard(x: number, z: number, margin = 0): boolean {
  if (!isHex()) return Math.abs(x) < 4.55 + margin && Math.abs(z) < 4.55 + margin;
  const a = (HEX_FRAME_R - 0.2 + margin) * COS30;
  return Math.abs(z) <= a && Math.abs(x) * COS30 + Math.abs(z) * 0.5 <= a;
}

/** The way from the board's centre toward a player's own side (world x, z). */
export function sideDir(color: Color): [number, number] {
  if (!isHex()) return color === 'black' ? [0, -1] : [0, 1];
  if (color === 'black') return [COS30, -0.5];
  if (color === 'red') return [-COS30, -0.5];
  return [0, 1];
}

/**
 * The side of the table (world x: -1 or +1) the dice tray is on; the coin dishes are across from it.
 * The same on every screen (사용자 제보: white looked at the dice and black's screen showed it looking
 * at the coin dish, for each screen had put the tray on its own player's left): one table for all.
 */
export const tableDiceSide = (): 1 | -1 => (isHex() ? 1 : -1);

/** How big the table is (it grows for the hexagon), half its width and depth. */
export const tableHalf = (): [number, number] => (isHex() ? [17, 11.5] : [13, 8.5]);
