import { MEANS_NAME, distance, targetsOf, type Board, type Piece, type Ruling, type Square } from '../engine';

/** Who acts in a ruling, how, and on what (with how far away), for the ruling sheet and the board. */
export interface Reach {
  actor: Square;
  piece: Piece | null;
  /** 근접, 원거리, ... (null for a ruling without a means). */
  means: string | null;
  /** What the success effects act on (or where the actor goes), nearest first, without the actor's own square. */
  targets: { at: Square; d: number }[];
}

export function reachOf(ruling: Ruling, board: Board): Reach | null {
  if (!ruling.feasible || ruling.actor === undefined || ruling.actor === null) return null;
  const actor = ruling.actor;
  const seen = new Set<Square>();
  for (const e of ruling.effects) {
    // The actor's own trip shows where it goes; anything else, what it acts on.
    const squares = e.type === 'move' && e.from === actor ? [e.to] : targetsOf(e);
    for (const sq of squares) if (sq !== actor) seen.add(sq);
  }
  const targets = [...seen].map((at) => ({ at, d: distance(actor, at) })).sort((a, b) => a.d - b.d);
  return { actor, piece: board[actor] ?? null, means: ruling.means ? MEANS_NAME[ruling.means] : null, targets };
}
