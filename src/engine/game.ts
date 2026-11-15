import {
  PROMOTION_TYPES,
  type Board,
  type Color,
  type Command,
  type ChaosEvent,
  type CommandResult,
  type GameEvent,
  type GameState,
  type MoveSpecial,
  type Outcome,
  type Piece,
  type Precedent,
  type Square,
  type TerrainCell,
} from './types';
import type { Exit, Staging } from './staging';
import { isInCheck, legalTargets } from './moves';
import { fileOf, opponent, rankOf, squareAt } from './squares';
import { revokeCastling } from './castling';
import { applyEffects, validateRuling, type EffectContext } from './effects';
import { extinguish, isShielded, tickTags, withoutTag } from './tags';
import { SHIELD } from './types';
import { tickTerrain } from './terrain';
import { capturedAfter } from './captured';

/** What effects applied now start from: the turn, whose it is, the walls and pits, the side of the board. */
function effectContext(state: GameState, nextSpawnId = state.nextSpawnId): EffectContext {
  return { turnNumber: state.turnNumber, nextSpawnId, color: state.turn, terrain: state.terrain ?? [], captured: state.captured ?? [] };
}

/** The single entry point for changing game state. Pure: no I/O, no randomness. */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.status.kind !== 'playing') return { ok: false, reason: 'gameOver' };
  // Running out of time cancels whatever was pending, so it may come at any moment.
  if (cmd.type === 'timeout') return timeOut(state);
  const actionCommand = cmd.type === 'attemptSpecial' || cmd.type === 'cancelSpecial';
  if (state.pending && !actionCommand) return { ok: false, reason: 'actionPending' };
  if (!state.pending && actionCommand) return { ok: false, reason: 'noPendingAction' };

  switch (cmd.type) {
    case 'move':
      return applyMove(state, cmd);
    case 'endTurn':
      // Passing is for a turn spent on special actions. Doing nothing at all is not a turn,
      // unless there is no normal move to make (e.g. every piece is stunned or blocked).
      if (!state.usedApThisTurn && hasAnyMove(state)) return { ok: false, reason: 'nothingDoneThisTurn' };
      return { ok: true, ...passTurn(state, state.board, null, []) };
    case 'proposeSpecial':
      return propose(state, cmd);
    case 'attemptSpecial':
      return attempt(state, cmd.roll);
    case 'cancelSpecial': {
      const { color, action } = state.pending!;
      return { ok: true, state: { ...state, pending: null }, events: [{ type: 'specialCancelled', color, action }] };
    }
    case 'chaos':
      return chaos(state, cmd.chaos);
  }
}

function timeOut(state: GameState): CommandResult {
  const color = state.turn;
  const apLost = Math.min(state.ap[color], Math.max(0, state.rules.timeoutPenalty));
  const events: GameEvent[] = [];
  if (state.pending) events.push({ type: 'specialCancelled', color: state.pending.color, action: state.pending.action });
  events.push({ type: 'timedOut', color, apLost });
  const after: GameState = { ...state, pending: null, ap: { ...state.ap, [color]: state.ap[color] - apLost } };
  return { ok: true, ...passTurn(after, after.board, null, events) };
}

/**
 * A chaos event: applied as it stands, with no AP and no dice. It may not leave either
 * king attacked, so chaos can never hand anyone a free king capture or a forced loss.
 */
function chaos(state: GameState, event: ChaosEvent): CommandResult {
  const bad = (detail: string): CommandResult => ({ ok: false, reason: 'invalidChaos', detail });
  if (typeof event?.title !== 'string' || typeof event.narration !== 'string' || !Array.isArray(event.effects)) return bad('형식이 올바르지 않음');
  if (event.effects.length > state.rules.maxEffects) return bad(`효과가 너무 많음 (최대 ${state.rules.maxEffects}개)`);
  const applied = applyEffects(state.board, event.effects, effectContext(state));
  if (!applied.ok) return bad(applied.detail);
  if (isInCheck(applied.board, 'white', applied.terrain) || isInCheck(applied.board, 'black', applied.terrain)) return bad('혼돈 뒤에 킹이 공격받는 상태가 됨');
  const title = event.title.trim().slice(0, 40);
  const narration = event.narration.trim().slice(0, 300);
  const events: GameEvent[] = [
    { type: 'chaos', title, narration, effects: event.effects, ...(event.staging && { staging: event.staging }) },
    ...applied.events,
  ];
  const after = withCaptured(
    {
      ...state,
      board: applied.board,
      terrain: applied.terrain,
      nextSpawnId: applied.nextSpawnId,
      castling: revokeCastling(state.castling, applied.touched),
      chaosLog: [...(state.chaosLog ?? []), { turnNumber: state.turnNumber, title, narration }],
    },
    events,
    exitsOf(applied.events, applied.sources, event.staging),
  );
  return { ok: true, state: after, events };
}

/** True if the side to move has at least one normal move. */
export function hasAnyMove(state: GameState): boolean {
  return state.board.some((p, sq) => p?.color === state.turn && legalTargets(state, sq).length > 0);
}

/**
 * How each piece taken by these effect events left, as staged: the exit of the effect that
 * took it (a rider goes the way its carrier went). Knocked off (the plain way) is not recorded.
 */
export function exitsOf(events: GameEvent[], sources: number[], staging: Staging | undefined): Map<string, Exit> {
  const exits = new Map<string, Exit>();
  if (!staging) return exits;
  events.forEach((e, i) => {
    const piece = e.type === 'moved' ? e.captured : e.type === 'removed' ? e.piece : null;
    const exit = staging.beats.find((b) => b.effect === sources[i])?.exit;
    // A piece falls into a pit on the spot: only the exits played in place fit (otherwise it sinks).
    const inPit = e.type === 'removed' && e.cause === 'pit';
    if (inPit && exit && !['ash', 'shatter', 'vanish', 'sink'].includes(exit)) return;
    if (piece && exit && exit !== 'default' && exit !== 'knock') exits.set(piece.id, exit);
  });
  return exits;
}

/** Records the pieces that left the board in these events (with how they left) and those that came back. */
function withCaptured(state: GameState, events: GameEvent[], exits?: Map<string, Exit>): GameState {
  return events.some((e) => e.type === 'moved' || e.type === 'removed' || e.type === 'revived')
    ? { ...state, captured: capturedAfter(state.captured, events, exits) }
    : state;
}

/** Ends the current player's turn: the opponent moves next and gains AP. */
function passTurn(
  state: GameState,
  board: Board,
  enPassant: Square | null,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  // Tags of the player whose turn is ending count down here.
  const next = opponent(state.turn);
  const { apMax, apPerTurn } = state.rules;
  const apNext = Math.min(apMax, state.ap[next] + apPerTurn);
  const turnNumber = state.turnNumber + 1;
  const ticked = tickTags(board, state.turn, state.turnNumber);
  const land = tickTerrain(state.terrain, state.turn, state.turnNumber);
  events = [...events, ...ticked.events, ...land.events];
  // A piece burnt up or a wall gone may open a line onto a king.
  if (ticked.events.some((e) => e.type === 'removed') || land.events.length) {
    for (const c of ['white', 'black'] as const) if (isInCheck(ticked.board, c, land.terrain)) events.push({ type: 'check', color: c });
  }
  return {
    state: {
      ...withCaptured(state, ticked.events),
      board: ticked.board,
      terrain: land.terrain,
      turn: next,
      turnNumber,
      enPassant,
      ap: { ...state.ap, [next]: apNext },
      usedApThisTurn: false,
      pending: null,
    },
    events: [...events, { type: 'turnPassed', turn: next, turnNumber, apGained: apNext - state.ap[next] }],
  };
}

function checkEvents(board: Board, mover: Color, terrain: readonly TerrainCell[] | undefined): GameEvent[] {
  const events: GameEvent[] = [];
  if (isInCheck(board, mover, terrain)) events.push({ type: 'ownKingExposed', color: mover });
  if (isInCheck(board, opponent(mover), terrain)) events.push({ type: 'check', color: opponent(mover) });
  return events;
}

function applyMove(state: GameState, cmd: Extract<Command, { type: 'move' }>): CommandResult {
  const piece = state.board[cmd.from];
  if (!piece) return { ok: false, reason: 'noPiece' };
  if (piece.color !== state.turn) return { ok: false, reason: 'notYourPiece' };
  const target = legalTargets(state, cmd.from).find((t) => t.to === cmd.to);
  if (!target) return { ok: false, reason: 'illegalMove' };
  // One-turn-kill guard: after any special-action attempt this turn, kings are off limits.
  if (state.usedApThisTurn && state.board[cmd.to]?.type === 'king') return { ok: false, reason: 'kingProtectedThisTurn' };

  const lastRank = piece.color === 'white' ? 7 : 0;
  const promotes = piece.type === 'pawn' && rankOf(cmd.to) === lastRank;
  if (promotes && !cmd.promotion) return { ok: false, reason: 'promotionRequired' };
  if (cmd.promotion && (!promotes || !PROMOTION_TYPES.includes(cmd.promotion))) {
    return { ok: false, reason: 'invalidPromotion' };
  }

  const board: (Piece | null)[] = [...state.board];
  const victimSquare =
    target.special?.kind === 'enPassant' ? squareAt(fileOf(cmd.to), rankOf(cmd.from))! : cmd.to;
  const victim = board[victimSquare];

  // A shield absorbs the capture: it breaks, the target stays, the attacker does not move,
  // and the move still uses up the turn.
  if (victim && isShielded(victim)) {
    board[victimSquare] = withoutTag(victim, SHIELD);
    const events: GameEvent[] = [{ type: 'shieldBroken', pieceId: victim.id, at: victimSquare, attackerId: piece.id }];
    events.push(...checkEvents(board, piece.color, state.terrain));
    return { ok: true, ...passTurn(state, board, null, events) };
  }

  const captured = victim;
  let special: MoveSpecial | undefined = target.special;
  const touched = [cmd.from, cmd.to];

  // Moving off its square puts out a 화상 (the events go after the move's own).
  const fireOut: GameEvent[] = [];
  board[cmd.to] = extinguish(promotes ? { ...piece, type: cmd.promotion! } : piece, cmd.to, fireOut);
  board[cmd.from] = null;
  if (promotes) special = { kind: 'promotion', to: cmd.promotion! };

  if (target.special?.kind === 'enPassant') {
    board[victimSquare] = null;
    touched.push(victimSquare);
  }

  if (target.special?.kind === 'castle') {
    const rank = rankOf(cmd.from);
    const [rookFrom, rookTo] =
      target.special.side === 'king' ? [squareAt(7, rank)!, squareAt(5, rank)!] : [squareAt(0, rank)!, squareAt(3, rank)!];
    board[rookTo] = extinguish(board[rookFrom]!, rookTo, fireOut);
    board[rookFrom] = null;
    touched.push(rookFrom, rookTo);
  }

  const events: GameEvent[] = [
    { type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured, ...(special && { special }) },
  ];
  // Whoever rode the captured piece falls with it.
  if (captured?.rider) events.push({ type: 'removed', piece: captured.rider, at: victimSquare });
  events.push(...fireOut);

  if (captured?.type === 'king') {
    events.push({ type: 'kingCaptured', winner: piece.color });
    return {
      ok: true,
      state: withCaptured({ ...state, board, status: { kind: 'won', winner: piece.color } }, events),
      events,
    };
  }

  const doubleStep = piece.type === 'pawn' && Math.abs(rankOf(cmd.to) - rankOf(cmd.from)) === 2;
  const enPassant = doubleStep ? squareAt(fileOf(cmd.from), (rankOf(cmd.from) + rankOf(cmd.to)) / 2) : null;

  events.push(...checkEvents(board, piece.color, state.terrain));
  const withRights = withCaptured({ ...state, castling: revokeCastling(state.castling, touched) }, events);
  return { ok: true, ...passTurn(withRights, board, enPassant, events) };
}

function propose(state: GameState, cmd: Extract<Command, { type: 'proposeSpecial' }>): CommandResult {
  const action = cmd.action.trim();
  if (!action) return { ok: false, reason: 'emptyAction' };
  if (action.length > state.rules.actionMaxLength) return { ok: false, reason: 'actionTooLong' };
  const problem = validateRuling(state.board, cmd.ruling, state.rules, effectContext(state));
  if (problem) return { ok: false, reason: 'invalidRuling', detail: problem };

  const pending = { color: state.turn, action, ruling: cmd.ruling };
  return {
    ok: true,
    state: { ...state, pending },
    events: [{ type: 'specialProposed', ...pending }],
  };
}

function attempt(state: GameState, roll: number): CommandResult {
  const { color, action, ruling } = state.pending!;
  if (!ruling.feasible) return { ok: false, reason: 'notFeasible' };
  if (state.ap[color] < ruling.cost) return { ok: false, reason: 'notEnoughAp' };
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) return { ok: false, reason: 'invalidRoll' };

  // A natural 20 always succeeds and a natural 1 always fails, whatever the DC.
  const outcome: Outcome =
    roll === 20 ? 'critSuccess' : roll === 1 ? 'critFailure' : roll >= ruling.dc ? 'success' : 'failure';
  const success = outcome === 'critSuccess' || outcome === 'success';
  const crit = ruling.critSuccessEffects?.length ? ruling.critSuccessEffects : ruling.effects;
  const toApply = outcome === 'critSuccess' ? crit : outcome === 'success' ? ruling.effects : outcome === 'critFailure' ? ruling.critFailureEffects ?? [] : [];

  let board = state.board;
  let terrain = state.terrain;
  let castling = state.castling;
  let nextSpawnId = state.nextSpawnId;
  const effectEvents: GameEvent[] = [];
  let exits = new Map<string, Exit>();
  if (toApply.length) {
    const applied = applyEffects(board, toApply, effectContext(state, nextSpawnId));
    // Validated on proposal and nothing can change the board while pending, so this is an invariant.
    if (!applied.ok) return { ok: false, reason: 'invalidRuling', detail: applied.detail };
    board = applied.board;
    terrain = applied.terrain;
    nextSpawnId = applied.nextSpawnId;
    castling = revokeCastling(castling, applied.touched);
    exits = exitsOf(applied.events, applied.sources, ruling.staging?.[outcome]);
    effectEvents.push(...applied.events, ...checkEvents(board, color, terrain));
  } else if (isInCheck(board, opponent(color), terrain)) {
    // Nothing changed, but the opponent's king was already attacked (e.g. since the turn began).
    effectEvents.push({ type: 'check', color: opponent(color) });
  }

  const narration =
    outcome === 'critSuccess'
      ? ruling.narration.critSuccess || ruling.narration.success
      : outcome === 'critFailure'
        ? ruling.narration.critFailure || ruling.narration.failure
        : success
          ? ruling.narration.success
          : ruling.narration.failure;

  const staging = ruling.staging?.[outcome];
  const events: GameEvent[] = [
    { type: 'specialResolved', color, action, roll, dc: ruling.dc, cost: ruling.cost, success, outcome, narration, effects: toApply, ...(staging && { staging }) },
    ...effectEvents,
  ];
  const precedent: Precedent = {
    turnNumber: state.turnNumber,
    color,
    action,
    interpretation: ruling.interpretation,
    dc: ruling.dc,
    cost: ruling.cost,
    roll,
    outcome,
  };
  const after: GameState = withCaptured({
    ...state,
    board,
    terrain,
    castling,
    nextSpawnId,
    ap: { ...state.ap, [color]: state.ap[color] - ruling.cost },
    usedApThisTurn: true,
    pending: null,
    precedents: [...state.precedents, precedent],
  }, events, exits);

  // One-turn-kill guard: if the opponent's king is attacked after a special action, the
  // turn ends at once (remaining AP carries over), so the opponent always gets to respond.
  if (events.some((e) => e.type === 'check')) {
    return { ok: true, ...passTurn(after, board, null, [...events, { type: 'autoTurnEnd', color, reason: 'check' }]) };
  }
  return { ok: true, state: after, events };
}
