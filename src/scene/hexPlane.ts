import { hexCorners } from '../engine/hex/geometry';
import { AIR, fileOf, groundOf, halfOf, rankOf, type Square } from '../engine';

/** A hexagon square's corners on the table (x, z), in the order of hexCorners. */
export function squareToWorldPlane(sq: Square): [number, number][] {
  return hexCorners(groundOf(sq)).map((p) => [p.x, -p.y] as [number, number]);
}
export { AIR, fileOf, halfOf, rankOf, type Square };
