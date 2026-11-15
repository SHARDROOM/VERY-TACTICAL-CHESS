import { LEVITATE, SHIELD, type Board, type FallingPiece, type GameEvent, type Landing, type Piece, type Square, type TerrainCell } from './types';
import { AIR, SQUARES, fileOf, groundOf, rankOf, squareAt } from './squares';
import { hasTag, isShielded, withTag, withoutTag } from './tags';
import { blockedSquares, terrainAt } from './terrain';

/*
 * 공중부양: a levitating piece stands on the air layer (its square + AIR), where it moves,
 * captures and clashes only with other floating pieces. When the tag ends it falls; the physics
 * (run outside the engine, by whoever runs the game) says where it came to rest, and the rules
 * here say what that means: it stands on the free square it covers most, is buried in a pit,
 * or shatters off the board or with nowhere free to stand. docs/SPEC.md, "공중부양".
 */

/** How far a piece's footprint reaches from where it rests, in squares (a disc). */
export const FOOTPRINT = 0.3;
/** Samples across the footprint's width (on a fixed grid, so every screen gets the same answer). */
const GRID = 15;

/**
 * The squares under a resting piece and how much of its footprint lies on each, most first
 * (ties: nearer the centre, then lower square). `sq` null: off the board.
 */
export function footprint(file: number, rank: number): { sq: Square | null; share: number }[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const dx = ((i + 0.5) / GRID - 0.5) * 2 * FOOTPRINT;
      const dy = ((j + 0.5) / GRID - 0.5) * 2 * FOOTPRINT;
      if (dx * dx + dy * dy > FOOTPRINT * FOOTPRINT) continue;
      total++;
      const sq = squareAt(Math.round(file + dx), Math.round(rank + dy));
      const key = sq ?? -1;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const dist = (key: number) => (key < 0 ? Infinity : Math.hypot(fileOf(key) - file, rankOf(key) - rank));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || dist(a[0]) - dist(b[0]) || a[0] - b[0])
    .map(([key, n]) => ({ sq: key < 0 ? null : key, share: n / total }));
}

export type FallResult = { to: Square; result: 'landed' } | { to: Square | null; result: 'buried' | 'shattered' };

/**
 * Where a piece resting at (`file`, `rank`) ends up on `board`: if most of it hangs off the
 * board it shatters; otherwise it stands on the square it covers most that is free (no piece,
 * no wall), is buried if that square is an open pit, and shatters if none is free.
 */
export function restingPlace(board: Board, terrain: readonly TerrainCell[] | undefined, file: number, rank: number): FallResult {
  const spots = footprint(file, rank);
  if (!spots.length || spots[0].sq === null) return { to: null, result: 'shattered' };
  for (const { sq } of spots) {
    if (sq === null) continue;
    const cell = terrainAt(terrain, sq);
    if (cell?.kind === 'wall' || board[sq]) continue;
    if (cell?.kind === 'pit' && cell.cover?.kind !== 'bridge') return { to: sq, result: 'buried' };
    return { to: sq, result: 'landed' };
  }
  return { to: spots[0].sq, result: 'shattered' };
}

/**
 * Floating pieces whose levitation is gone (it ran out, or was taken away) leave the air and
 * start to fall. Changes `board`; returns them, and says so in `events`.
 */
export function startFalls(board: (Piece | null)[], events: GameEvent[]): FallingPiece[] {
  const out: FallingPiece[] = [];
  for (let sq = AIR; sq < SQUARES; sq++) {
    const piece = board[sq];
    if (!piece || hasTag(piece, LEVITATE)) continue;
    board[sq] = null;
    out.push({ piece, from: sq });
    events.push({ type: 'fallStarted', pieceId: piece.id, at: sq });
  }
  return out;
}

/** The closest square a piece may stand on (no piece, no wall, no open pit), nearest rings first. */
function nearestFree(board: Board, terrain: readonly TerrainCell[] | undefined, from: Square): Square | null {
  const blocked = blockedSquares(terrain);
  for (let r = 0; r < 8; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let df = -r; df <= r; df++) {
        if (Math.max(Math.abs(df), Math.abs(dr)) !== r) continue;
        const sq = squareAt(fileOf(from) + df, rankOf(from) + dr);
        if (sq !== null && !board[sq] && !blocked.has(sq)) return sq;
      }
    }
  }
  return null;
}

/**
 * Plays the falls: each piece in turn (later ones see where earlier ones landed) comes down
 * where its landing says, or straight down without one. A king is never killed by a fall, and a
 * shield breaks instead: such a piece is put on the nearest free square ("pushed"). A piece that
 * cannot even be put down (the whole board full) stays afloat for one more turn.
 */
export function playFalls(
  start: Board,
  terrain: readonly TerrainCell[] | undefined,
  falling: readonly FallingPiece[],
  landings: readonly Landing[],
  seed: number,
  turnNumber: number,
): { board: (Piece | null)[]; events: GameEvent[] } {
  const board: (Piece | null)[] = [...start];
  const falls: Extract<GameEvent, { type: 'fell' }>['falls'] = [];
  const after: GameEvent[] = [];
  for (const { piece, from } of falling) {
    const l = landings.find((x) => x.id === piece.id);
    const ok = l && Number.isFinite(l.file) && Number.isFinite(l.rank);
    const spot = ok ? { file: l.file, rank: l.rank } : { file: fileOf(from), rank: rankOf(from) };
    const place = restingPlace(board, terrain, spot.file, spot.rank);
    if (place.result === 'landed') {
      board[place.to] = piece;
      falls.push({ pieceId: piece.id, from, to: place.to, result: 'landed' });
      continue;
    }
    if (piece.type === 'king' || isShielded(piece)) {
      const near = place.to ?? groundOf(from);
      const to = nearestFree(board, terrain, near);
      if (to === null) {
        board[from] = withTag(piece, { name: LEVITATE, turnsLeft: 1, appliedOnTurn: turnNumber });
        continue;
      }
      // A king just lands beside; anyone else is saved by its shield, which breaks.
      let kept = piece;
      if (piece.type !== 'king') {
        kept = withoutTag(piece, SHIELD);
        after.push({ type: 'shieldBroken', pieceId: piece.id, at: to, attackerId: null });
      }
      board[to] = kept;
      falls.push({ pieceId: piece.id, from, to, result: 'pushed' });
      continue;
    }
    const at = place.to ?? groundOf(from);
    falls.push({ pieceId: piece.id, from, to: null, result: place.result });
    const removed = (p: Piece): GameEvent =>
      place.result === 'buried' ? { type: 'removed', piece: p, at, cause: 'pit', exit: 'sink' } : { type: 'removed', piece: p, at, cause: 'fall', exit: 'shatter' };
    after.push(removed(piece));
    if (piece.rider) after.push(removed(piece.rider));
  }
  return { board, events: [{ type: 'fell', seed, falls }, ...after] };
}
