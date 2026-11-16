import { createContext, useContext } from 'react';
import { Plane, Vector3, type Ray } from 'three';
import { isAir, type Board } from '../engine';
import { squareToWorld } from './coords';
import { TABLE_TOP_Y } from './WoodTable';
import { restingChunks } from './debris';
import type { Obstacles } from './shatter';

/*
 * Picking things up off the table (docs/SPEC.md, "만지작거리기"): taken pieces beside the board and
 * the chunks of shattered ones can be dragged about and thrown, to pass the time while the other
 * side thinks. Only on this screen; the rules never see it.
 */

export interface TableHands {
  /** Holds the camera still while something is being dragged (and lets it go again). */
  hold(on: boolean): void;
  /** The board as it is shown now. */
  board(): Board;
}

export const TableContext = createContext<TableHands | null>(null);
export const useTable = () => useContext(TableContext);

const BOARD_HALF = 4.55;
/** How high above the surface a held thing is carried. */
export const LIFT = 0.5;

const plane = new Plane(new Vector3(0, 1, 0), 0);

/** Where the finger's ray meets the height things are carried at there (over the board or the table). */
export function carryPoint(ray: Ray, out: Vector3): boolean {
  plane.constant = -LIFT;
  if (ray.intersectPlane(plane, out) && Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) return true;
  plane.constant = -(TABLE_TOP_Y + LIFT);
  if (!ray.intersectPlane(plane, out)) return false;
  out.x = Math.max(-13, Math.min(13, out.x));
  out.z = Math.max(-8.5, Math.min(8.5, out.z));
  // Back over the board from the table: up onto it.
  if (Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) out.y = LIFT;
  return true;
}

/** The finger's last few points, for how hard it throws when it lets go. */
export class Fling {
  private samples: { p: Vector3; t: number }[] = [];

  add(p: Vector3): void {
    const t = performance.now();
    this.samples.push({ p: p.clone(), t });
    while (this.samples.length > 2 && t - this.samples[0].t > 120) this.samples.shift();
  }

  /** Units a second, a little up, no faster than a hard throw. */
  velocity(): Vector3 {
    const s = this.samples;
    if (s.length < 2) return new Vector3(0, 0, 0);
    const a = s[0];
    const b = s[s.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    const v = b.p.clone().sub(a.p).divideScalar(dt).setY(0);
    if (v.length() > 9) v.setLength(9);
    return v.setY(v.length() > 0.5 ? 1.2 : 0);
  }
}

/** What a thrown thing can hit: the pieces on the board and the chunks lying still (all but `except`'s). */
export function tableObstacles(board: Board, except?: { square?: number; chunkKey?: string }): Obstacles {
  const pieces: Obstacles['pieces'] = [];
  board.forEach((p, sq) => {
    if (!p || isAir(sq) || sq === except?.square) return;
    pieces.push({ type: p.type, ...(p.rider && { rider: p.rider.type }), at: squareToWorld(sq) });
  });
  const chunks = restingChunks()
    .filter((c) => c.key !== except?.chunkKey)
    .map((c) => ({ hull: c.hull, p: c.p.clone(), q: c.q.clone() }));
  return { pieces, chunks };
}
