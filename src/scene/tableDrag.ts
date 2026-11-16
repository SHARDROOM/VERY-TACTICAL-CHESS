import { createContext, useContext } from 'react';
import { Plane, Vector3, type Camera, type Ray } from 'three';
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
  /** Which side of the board the dice tray is on. */
  diceSide(): 1 | -1;
}

export const TableContext = createContext<TableHands | null>(null);
export const useTable = () => useContext(TableContext);

const BOARD_HALF = 4.55;
/** How high above the surface a thing slid along it is held (and above whatever stands there). */
export const LIFT = 0.12;
/** How high above the table a thing slid along it is held (clear of the tray's floor). */
export const TABLE_LIFT = 0.12;
/** Highest a thing can be held up (the camera is not much higher). */
const CEILING = 5;

const flat = new Plane(new Vector3(0, 1, 0), 0);

/** The lowest a held thing may be at (x, z): just above the board (and what stands there) or the table. */
function floorAt(x: number, z: number, board?: Board): number {
  if (Math.abs(x) < BOARD_HALF && Math.abs(z) < BOARD_HALF) {
    const top = board ? topAt(board, x, z) : 0;
    return top > 0 ? top + 0.15 : LIFT;
  }
  return TABLE_TOP_Y + TABLE_LIFT;
}

/** Where the finger's ray meets the surface (board or table) at its holding height there. */
export function carryPoint(ray: Ray, out: Vector3, board?: Board): boolean {
  const over = (h: number) => {
    flat.constant = -h;
    return ray.intersectPlane(flat, out) !== null;
  };
  if (over(LIFT) && Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) {
    const min = floorAt(out.x, out.z, board);
    if (min > LIFT) over(min);
    return true;
  }
  if (!over(TABLE_TOP_Y + TABLE_LIFT)) return false;
  out.x = Math.max(-13, Math.min(13, out.x));
  out.z = Math.max(-8.5, Math.min(8.5, out.z));
  // Back over the board from the table: up onto it.
  if (Math.abs(out.x) < BOARD_HALF && Math.abs(out.z) < BOARD_HALF) out.y = floorAt(out.x, out.z, board);
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

/**
 * A thing in the player's hand. It is held in the plane facing the eye through where it was
 * picked up: the finger moves it about that plane, so moving up lifts it into the air (and down
 * brings it back); pointing lower than the table there, it slides along the table toward the eye.
 * The mouse wheel pushes the hold farther away or brings it nearer.
 */
export class Grip {
  private readonly plane = new Plane();
  private ray: Ray | null = null;
  readonly fling = new Fling();

  constructor(camera: Camera, at: Vector3) {
    this.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), at);
  }

  /** Where the held thing is for this ray (false: the ray misses everything). */
  at(ray: Ray, out: Vector3, board?: Board): boolean {
    this.ray = ray.clone();
    return this.place(out, board);
  }

  /** Farther away (+) or nearer (-), by `amount` along the view; then where it is for the last ray. */
  push(amount: number, out: Vector3, board?: Board): boolean {
    this.plane.constant -= amount;
    return this.place(out, board);
  }

  private place(out: Vector3, board?: Board): boolean {
    const ray = this.ray;
    if (!ray) return false;
    let ok: boolean;
    if (ray.intersectPlane(this.plane, out) === null) ok = carryPoint(ray, out, board);
    else {
      out.x = Math.max(-13, Math.min(13, out.x));
      out.z = Math.max(-8.5, Math.min(8.5, out.z));
      out.y = Math.min(CEILING, out.y);
      // Below the surface there: along the surface instead.
      ok = out.y < floorAt(out.x, out.z, board) ? carryPoint(ray, out, board) : true;
    }
    if (ok) this.fling.add(out);
    return ok;
  }
}

/** The finger's last few points, for how hard it throws when it lets go. */
export class Fling {
  private samples: { p: Vector3; t: number }[] = [];

  add(p: Vector3): void {
    const t = performance.now();
    this.samples.push({ p: p.clone(), t });
    while (this.samples.length > 2 && t - this.samples[0].t > 120) this.samples.shift();
  }

  /** Units a second (up and down too), no faster than a hard throw; a sideways swing arcs a little. */
  velocity(): Vector3 {
    const s = this.samples;
    if (s.length < 2) return new Vector3(0, 0, 0);
    const a = s[0];
    const b = s[s.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    const v = b.p.clone().sub(a.p).divideScalar(dt);
    if (v.length() > 9) v.setLength(9);
    if (Math.hypot(v.x, v.z) > 0.5) v.y += 0.6;
    return v;
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
