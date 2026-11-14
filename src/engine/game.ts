import {
  PROMOTION_TYPES,
  type Board,
  type Color,
  type Command,
  type CommandResult,
  type GameEvent,
  type GameState,
  type MoveSpecial,
  type Outcome,
  type Piece,
  type Precedent,
  type Square,
} from './types';
import { isInCheck, legalTargets } from './moves';
import { fileOf, opponent, rankOf, squareAt } from './squares';
import { revokeCastling } from './castling';
import { applyEffects, validateRuling } from './effects';
import { isShielded, tickTags, withoutTag } from './tags';
import { SHIELD } from './types';

/** The single entry point for changing game state. Pure: no I/O, no randomness. */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.status.kind !== 'playing') return { ok: false, reason: 'gameOver' };
  const actionCommand = cmd.type === 'attemptSpecial' || cmd.type === 'cancelSpecial';
  if (state.pending && !actionCommand) return { ok: false, reason: 'actionPending' };
  if (!state.pending && actionCommand) return { ok: false, reason: 'noPendingAction' };

  switch (cmd.type) {
    case 'move':
      return applyMove(state, cmd);
    case 'endTurn':
      return { ok: true, ...passTurn(state, state.board, null, []) };
    case 'proposeSpecial':
      return propose(state, cmd);
    case 'attemptSpecial':
      return attempt(state, cmd.roll);
    case 'cancelSpecial': {
      const { color, action } = state.pending!;
      return { ok: true, state: { ...state, pending: null }, events: [{ type: 'specialCancelled', color, action }] };
    }
  }
}

/** Records the pieces that left the board in these events (plain: no tags, no rider). */
function withCaptured(state: GameState, events: GameEvent[]): GameState {
  const gone: Piece[] = [];
  for (const e of events) {
    const piece = e.type === 'moved' ? e.captured : e.type === 'removed' ? e.piece : null;
    if (piece) gone.push({ id: piece.id, color: piece.color, type: piece.type });
  }
  return gone.length ? { ...state, captured: [...(state.captured ?? []), ...gone] } : state;
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
  events = [...events, ...ticked.events];
  return {
    state: {
      ...state,
      board: ticked.board,
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

function checkEvents(board: Board, mover: Color): GameEvent[] {
  const events: GameEvent[] = [];
  if (isInCheck(board, mover)) events.push({ type: 'ownKingExposed', color: mover });
  if (isInCheck(board, opponent(mover))) events.push({ type: 'check', color: opponent(mover) });
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
    events.push(...checkEvents(board, piece.color));
    return { ok: true, ...passTurn(state, board, null, events) };
  }

  const captured = victim;
  let special: MoveSpecial | undefined = target.special;
  const touched = [cmd.from, cmd.to];

  board[cmd.to] = promotes ? { ...piece, type: cmd.promotion! } : piece;
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
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
    touched.push(rookFrom, rookTo);
  }

  const events: GameEvent[] = [
    { type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured, ...(special && { special }) },
  ];
  // Whoever rode the captured piece falls with it.
  if (captured?.rider) events.push({ type: 'removed', piece: captured.rider, at: victimSquare });

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

  events.push(...checkEvents(board, piece.color));
  const withRights = withCaptured({ ...state, castling: revokeCastling(state.castling, touched) }, events);
  return { ok: true, ...passTurn(withRights, board, enPassant, events) };
}

function propose(state: GameState, cmd: Extract<Command, { type: 'proposeSpecial' }>): CommandResult {
  const action = cmd.action.trim();
  if (!action) return { ok: false, reason: 'emptyAction' };
  if (action.length > state.rules.actionMaxLength) return { ok: false, reason: 'actionTooLong' };
  const problem = validateRuling(state.board, cmd.ruling, state.rules, {
    turnNumber: state.turnNumber,
    nextSpawnId: state.nextSpawnId,
  });
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
  let castling = state.castling;
  let nextSpawnId = state.nextSpawnId;
  const effectEvents: GameEvent[] = [];
  if (toApply.length) {
    const applied = applyEffects(board, toApply, { turnNumber: state.turnNumber, nextSpawnId });
    // Validated on proposal and nothing can change the board while pending, so this is an invariant.
    if (!applied.ok) return { ok: false, reason: 'invalidRuling', detail: applied.detail };
    board = applied.board;
    nextSpawnId = applied.nextSpawnId;
    castling = revokeCastling(castling, applied.touched);
    effectEvents.push(...applied.events, ...checkEvents(board, color));
  } else if (isInCheck(board, opponent(color))) {
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

  const events: GameEvent[] = [
    { type: 'specialResolved', color, action, roll, dc: ruling.dc, cost: ruling.cost, success, outcome, narration },
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
    castling,
    nextSpawnId,
    ap: { ...state.ap, [color]: state.ap[color] - ruling.cost },
    usedApThisTurn: true,
    pending: null,
    precedents: [...state.precedents, precedent],
  }, events);

  // One-turn-kill guard: if the opponent's king is attacked after a special action, the
  // turn ends at once (remaining AP carries over), so the opponent always gets to respond.
  if (events.some((e) => e.type === 'check')) {
    return { ok: true, ...passTurn(after, board, null, [...events, { type: 'autoTurnEnd', color, reason: 'check' }]) };
  }
  return { ok: true, state: after, events };
}
