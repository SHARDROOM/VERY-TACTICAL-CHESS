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

/**
 * The kinds of piece this one moves like: its own, or, while a tag lends it others (moveAs),
 * those instead (docs/SPEC.md, "이동 능력"). With several such tags the newest one counts (a tag
 * put on again counts as new). A tag may list several kinds: it moves like any of them.
 */
export function movePatterns(piece: Piece): PieceType[] {
  const lent = [...(piece.tags ?? [])].reverse().find((t) => t.moveAs?.length);
  return lent ? [...new Set(lent.moveAs)] : [piece.type];
}

/** Its own moves are replaced by a tag's (and with them a pawn's two-step and en passant, a king's castling). */
export const movesReplaced = (piece: Piece): boolean => !!piece.tags?.some((t) => t.moveAs?.length);

/** How many normal moves in a row this piece makes in one turn (1 = the usual one). */
export function moveTimesOf(piece: Piece): number {
  return Math.max(1, ...(piece.tags ?? []).map((t) => t.moveTimes ?? 1));
}

// ---- stacks of riders (탑승): a carrier, its rider, that one's rider, and so on up ----------

/** Everyone riding a piece, bottom to top. */
export function ridersOf(piece: Piece): Piece[] {
  const out: Piece[] = [];
  for (let r = piece.rider; r; r = r.rider) out.push(r);
  return out;
}

/** The piece with `rider` (and whoever rides it) on top of everyone riding it already. */
export function withRiderOnTop(carrier: Piece, rider: Piece): Piece {
  return { ...carrier, rider: carrier.rider ? withRiderOnTop(carrier.rider, rider) : rider };
}

/** The topmost rider got off: the carrier without it, and it (null: nobody rides it). */
export function withoutTopRider(carrier: Piece): { carrier: Piece; rider: Piece } | null {
  const r = carrier.rider;
  if (!r) return null;
  if (!r.rider) return { carrier: { ...carrier, rider: undefined }, rider: r };
  const up = withoutTopRider(r)!;
  return { carrier: { ...carrier, rider: up.carrier }, rider: up.rider };
}

/** The piece and every rider on it changed by `f` (each sees itself without its riders' changes yet). */
export function mapStack(piece: Piece, f: (p: Piece) => Piece): Piece {
  const next = f(piece);
  return piece.rider ? { ...next, rider: mapStack(piece.rider, f) } : next;
}

/** The whole stack, bottom first. */
export const stackOf = (piece: Piece): Piece[] => [piece, ...ridersOf(piece)];

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
 * A piece that moves off its square puts out its 화상, and so does everyone riding it.
 * `at` is where it ends up; the events say whose fire went out.
 */
export function extinguish(piece: Piece, at: Square, events: GameEvent[]): Piece {
  let next = piece;
  if (isBurning(next)) {
    next = withoutTag(next, BURN);
    events.push({ type: 'untagged', pieceId: piece.id, at, tag: BURN });
  }
  if (next.rider) {
    next = {
      ...next,
      rider: mapStack(next.rider, (r) => {
        if (!isBurning(r)) return r;
        events.push({ type: 'untagged', pieceId: r.id, at, tag: BURN });
        return withoutTag(r, BURN);
      }),
    };
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
      // Everyone up the stack counts down; one that burns away is gone, and those above it settle
      // onto the one below.
      const kept: Piece[] = [];
      for (const r of ridersOf(piece)) {
        const c = countDown({ ...r, rider: undefined });
        const left = c.burnt ? burnUp(c.piece, sq) : c.piece;
        if (left) kept.push(left);
      }
      piece = { ...piece, rider: undefined };
      for (const r of kept) piece = withRiderOnTop(piece, r);
    }
    if (!own.burnt) return piece;
    const left = burnUp(piece, sq);
    // Whoever rides a piece that burns away is thrown off it.
    if (!left) falling.push(...unseat(piece, sq, events));
    return left;
  });
  return { board: next, events, falling };
}
