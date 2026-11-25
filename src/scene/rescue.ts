import { tableHalf } from './coords';
import { TABLE_TOP_Y } from './WoodTable';

/*
 * Things off the table come back (사용자 요청): a piece, a chunk or a sheet that goes over the
 * table's edge and drops toward the floor is put back above the table, just inside the edge it
 * went over, still, and falls onto it again. Done inside each simulation, so the recording every
 * screen plays shows the same rescue.
 */

/** Below this, a body has gone over the edge (the table top is far above it). */
export const OFF_TABLE_Y = TABLE_TOP_Y - 1.2;
/** How far inside the table's edge a rescued body comes down. */
const INSIDE = 1.4;
/** How high above the table it is let go of again. */
const DROP = 1.0;

interface Body {
  translation(): { x: number; y: number; z: number };
  setTranslation(t: { x: number; y: number; z: number }, wake: boolean): void;
  setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
}

/** Puts a body that went over the table's edge back above the table; whether it did. */
export function rescueFallen(body: Body): boolean {
  const t = body.translation();
  if (t.y > OFF_TABLE_Y) return false;
  const [hw, hd] = tableHalf();
  const x = Math.max(-(hw - INSIDE), Math.min(hw - INSIDE, t.x));
  const z = Math.max(-(hd - INSIDE), Math.min(hd - INSIDE, t.z));
  body.setTranslation({ x, y: TABLE_TOP_Y + DROP, z }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return true;
}
