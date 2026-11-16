import { BURN, LEVITATE, RIDE, STUN, SHIELD, type Board, type Color, type FallingPiece, type GameEvent, type Piece, type PieceType, type Square, type Tag } from './types';

export const hasTag = (piece: Piece | null | undefined, name: string): boolean =>
  !!piece?.tags?.some((t) => t.name === name);

export const isStunned = (piece: Piece | null | undefined) => hasTag(piece, STUN);
export const isShielded = (piece: Piece | null | undefined) => hasTag(piece, SHIELD);
export const isBurning = (piece: Piece | null | undefined) => hasTag(piece, BURN);

/** Adds or refreshes a tag (same name replaces the old one). */
export function withTag(piece: Piece, tag: Tag): Piece {
  return { ...piece, tags: [...(piece.tags ?? []).filter((t) => t.name !== tag.name), tag] };
}

export function withoutTag(piece: Piece, name: string): Piece {
  const tags = (piece.tags ?? []).filter((t) => t.name !== name);
  return { ...piece, tags };
}

export const CORE_TAGS: readonly string[] = [STUN, RIDE, SHIELD, BURN, LEVITATE];

export const isFloating = (piece: Piece | null | undefined) => hasTag(piece, LEVITATE);

/** Most normal moves a piece may make in a row in one turn (a tag's moveTimes). */
export const MAX_MOVE_TIMES = 3;

/** The kinds of piece this one moves like: its own, and any its tags lend it (moveAs). */
export function movePatterns(piece: Piece): PieceType[] {
  const kinds = new Set<PieceType>([piece.type]);
  for (const t of piece.tags ?? []) for (const k of t.moveAs ?? []) kinds.add(k);
  return [...kinds];
}

/** How many normal moves in a row this piece makes in one turn (1 = the usual one). */
export function moveTimesOf(piece: Piece): number {
  return Math.max(1, ...(piece.tags ?? []).map((t) => t.moveTimes ?? 1));
}

/**
 * The carrier on `at` is taken or destroyed: whoever rides it is not taken with it but thrown
 * off, and falls (played like a fall from the air, see levitation.ts): it lands where it comes
 * to rest, or is lost in a pit or off the board. `push`: where the blow came from.
 */
export function unseat(carrier: Piece, at: Square, events: GameEvent[], push?: Square): FallingPiece[] {
  if (!carrier.rider) return [];
  const piece = withoutTag(carrier.rider, RIDE);
  events.push({ type: 'fallStarted', pieceId: piece.id, at });
  return [{ piece, from: at, rodeOn: carrier.type, ...(push !== undefined && { push }) }];
}

/**
 * A piece that moves off its square puts out its 화상, and so does whoever rides it.
 * `at` is where it ends up; the events say whose fire went out.
 */
export function extinguish(piece: Piece, at: Square, events: GameEvent[]): Piece {
  let next = piece;
  if (isBurning(next)) {
    next = withoutTag(next, BURN);
    events.push({ type: 'untagged', pieceId: piece.id, at, tag: BURN });
  }
  if (next.rider && isBurning(next.rider)) {
    events.push({ type: 'untagged', pieceId: next.rider.id, at, tag: BURN });
    next = { ...next, rider: withoutTag(next.rider, BURN) };
  }
  return next;
}

/**
 * Tag countdown rule: a tag with a duration loses one turn when its piece's
 * OWNER finishes a turn, except on the turn the tag was applied. So a 1-turn
 * stun put on an enemy knight keeps it still for exactly the enemy's next turn;
 * a 1-turn tag put on your own piece lasts through your next turn too.
 * Called when `color`'s turn `turnNumber` ends. Riders count down with everyone else.
 *
 * 화상 is the one tag that does not simply run out: a piece still burning when its turns are
 * up burns to ash (whoever rides it is thrown off), unless a shield takes the blow.
 */
export function tickTags(
  board: Board,
  color: Color,
  turnNumber: number,
): { board: (Piece | null)[]; events: GameEvent[]; falling: FallingPiece[] } {
  const events: GameEvent[] = [];
  const falling: FallingPiece[] = [];
  const countDown = (piece: Piece): { piece: Piece; burnt: boolean } => {
    if (piece.color !== color || !piece.tags?.length) return { piece, burnt: false };
    const kept: Tag[] = [];
    let burnt = false;
    for (const t of piece.tags) {
      if (t.turnsLeft === null || t.appliedOnTurn === turnNumber) {
        kept.push(t);
        continue;
      }
      const left = t.turnsLeft - 1;
      if (left > 0) kept.push({ ...t, turnsLeft: left });
      else if (t.name === BURN) burnt = true;
      else events.push({ type: 'tagExpired', pieceId: piece.id, tag: t.name });
    }
    return { piece: { ...piece, tags: kept }, burnt };
  };
  /** A burnt-out piece: gone, or its shield breaks instead (and the fire is out). */
  const burnUp = (piece: Piece, sq: Square): Piece | null => {
    if (isShielded(piece)) {
      events.push({ type: 'shieldBroken', pieceId: piece.id, at: sq, attackerId: null });
      return withoutTag(piece, SHIELD);
    }
    events.push({ type: 'removed', piece, at: sq, cause: 'burn' });
    return null;
  };
  const next = board.map((p, sq) => {
    if (!p) return null;
    const own = countDown(p);
    let piece = own.piece;
    if (piece.rider) {
      const r = countDown(piece.rider);
      piece = { ...piece, rider: (r.burnt ? burnUp(r.piece, sq) : r.piece) ?? undefined };
    }
    if (!own.burnt) return piece;
    const left = burnUp(piece, sq);
    // Whoever rides a piece that burns away is thrown off it.
    if (!left) falling.push(...unseat(piece, sq, events));
    return left;
  });
  return { board: next, events, falling };
}
