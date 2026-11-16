import { createContext, useContext } from 'react';
import { Plane, Vector3, type Ray } from 'three';
import { isAir, squareAt, type Board } from '../engine';
import { squareToWorld, worldToBoard } from './coords';
import { PIECE_HEIGHT } from './pieceGeometry';
import { diceObstacles } from './toys';
import { TABLE_TOP_Y } from './WoodTable';
import { restingChunks } from './debris';
import type { Obstacle, Obstacles } from './piecePhysics';

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
  /** The taken pieces beside the board, where they lie. */
  taken(): Obstacle[];
}

export const TableContext = createContext<TableHands | null>(null);
export const useTable = () => useContext(TableContext);

const BOARD_HALF = 4.55;
/** How high above the surface a held thing is carried. */
export const LIFT = 0.5;

const plane = new Plane(new Vector3(0, 1, 0), 0);

/** How high things are carried over the table beside the board (clear of the dice tray's walls). */
export const TABLE_LIFT = 0.75;

/**
 * Where the finger's ray meets the height things are carried at there: over the board, clear of
 * the piece (and rider) standing on that square; over the table, clear of the tray and the dice.
 */
export function carryPoint(ray: Ray, out: Vector3, board?: Board): boolean {
  const over = (h: number) => {
    plane.constant = -h;
    return ray.intersectPlane(plane, out) !== null;
  };
  if (over(LIFT) && Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) {
    const top = board ? topAt(board, out.x, out.z) : 0;
    if (top + 0.15 > LIFT) over(top + 0.15);
    return true;
  }
  if (!over(TABLE_TOP_Y + TABLE_LIFT)) return false;
  out.x = Math.max(-13, Math.min(13, out.x));
  out.z = Math.max(-8.5, Math.min(8.5, out.z));
  // Back over the board from the table: up onto it.
  if (Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) out.y = Math.max(LIFT, (board ? topAt(board, out.x, out.z) : 0) + 0.15);
  return true;
}

/** How tall what stands on the square under (x, z) is, rider and all (0: nothing). */
function topAt(board: Board, x: number, z: number): number {
  const { file, rank } = worldToBoard(x, z);
  const sq = squareAt(Math.round(file), Math.round(rank));
  const p = sq === null ? null : board[sq];
  if (!p) return 0;
  return p.rider ? PIECE_HEIGHT[p.type] - 0.06 + PIECE_HEIGHT[p.rider.type] : PIECE_HEIGHT[p.type];
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

/**
 * What a thrown thing can hit: the pieces on the board, the chunks lying still, the taken pieces
 * beside the board and the dice (all but `except`: the square a piece bursts on, a chunk or a
 * taken piece being thrown).
 */
export function tableObstacles(hands: TableHands, except?: { square?: number; chunkKey?: string; takenId?: string }): Obstacles {
  const board = hands.board();
  const pieces: Obstacles['pieces'] = [];
  board.forEach((p, sq) => {
    if (!p || isAir(sq) || sq === except?.square) return;
    pieces.push({ type: p.type, ...(p.rider && { rider: p.rider.type }), at: squareToWorld(sq) });
  });
  const chunks = restingChunks()
    .filter((c) => c.key !== except?.chunkKey)
    .map((c) => ({ hull: c.hull, p: c.p.clone(), q: c.q.clone() }));
  return { pieces, chunks, taken: hands.taken().filter((t) => t.id !== except?.takenId), dice: diceObstacles() };
}
