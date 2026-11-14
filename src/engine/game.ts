import {
  PROMOTION_TYPES,
  type Board,
  type Color,
  type Command,
  type CommandResult,
  type GameEvent,
  type GameState,
  type MoveSpecial,
  type Piece,
  type Square,
} from './types';
import { isInCheck, legalTargets } from './moves';
import { fileOf, opponent, rankOf, squareAt } from './squares';
import { revokeCastling } from './castling';
import { applyEffects, validateRuling } from './effects';

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

/** Ends the current player's turn: the opponent moves next and gains AP. */
function passTurn(
  state: GameState,
  board: Board,
  enPassant: Square | null,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const next = opponent(state.turn);
  const { apMax, apPerTurn } = state.rules;
  const apNext = Math.min(apMax, state.ap[next] + apPerTurn);
  const turnNumber = state.turnNumber + 1;
  return {
    state: {
      ...state,
      board,
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

  const lastRank = piece.color === 'white' ? 7 : 0;
  const promotes = piece.type === 'pawn' && rankOf(cmd.to) === lastRank;
  if (promotes && !cmd.promotion) return { ok: false, reason: 'promotionRequired' };
  if (cmd.promotion && (!promotes || !PROMOTION_TYPES.includes(cmd.promotion))) {
    return { ok: false, reason: 'invalidPromotion' };
  }

  const board: (Piece | null)[] = [...state.board];
  let captured = board[cmd.to];
  let special: MoveSpecial | undefined = target.special;
  const touched = [cmd.from, cmd.to];

  board[cmd.to] = promotes ? { ...piece, type: cmd.promotion! } : piece;
  board[cmd.from] = null;
  if (promotes) special = { kind: 'promotion', to: cmd.promotion! };

  if (target.special?.kind === 'enPassant') {
    const victim = squareAt(fileOf(cmd.to), rankOf(cmd.from))!;
    captured = board[victim];
    board[victim] = null;
    touched.push(victim);
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

  if (captured?.type === 'king') {
    events.push({ type: 'kingCaptured', winner: piece.color });
    return {
      ok: true,
      state: { ...state, board, status: { kind: 'won', winner: piece.color } },
      events,
    };
  }

  const doubleStep = piece.type === 'pawn' && Math.abs(rankOf(cmd.to) - rankOf(cmd.from)) === 2;
  const enPassant = doubleStep ? squareAt(fileOf(cmd.from), (rankOf(cmd.from) + rankOf(cmd.to)) / 2) : null;

  events.push(...checkEvents(board, piece.color));
  const withRights = { ...state, castling: revokeCastling(state.castling, touched) };
  return { ok: true, ...passTurn(withRights, board, enPassant, events) };
}

function propose(state: GameState, cmd: Extract<Command, { type: 'proposeSpecial' }>): CommandResult {
  const action = cmd.action.trim();
  if (!action) return { ok: false, reason: 'emptyAction' };
  if (action.length > state.rules.actionMaxLength) return { ok: false, reason: 'actionTooLong' };
  const problem = validateRuling(state.board, cmd.ruling, state.rules);
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

  const success = roll >= ruling.dc;
  let board = state.board;
  let castling = state.castling;
  const effectEvents: GameEvent[] = [];
  if (success) {
    const applied = applyEffects(board, ruling.effects);
    // Validated on proposal and nothing can change the board while pending, so this is an invariant.
    if (!applied.ok) return { ok: false, reason: 'invalidRuling', detail: applied.detail };
    board = applied.board;
    castling = revokeCastling(castling, applied.touched);
    effectEvents.push(...applied.events, ...checkEvents(board, color));
  }

  const events: GameEvent[] = [
    {
      type: 'specialResolved',
      color,
      action,
      roll,
      dc: ruling.dc,
      cost: ruling.cost,
      success,
      narration: success ? ruling.narration.success : ruling.narration.failure,
    },
    ...effectEvents,
  ];
  return {
    ok: true,
    state: {
      ...state,
      board,
      castling,
      ap: { ...state.ap, [color]: state.ap[color] - ruling.cost },
      usedApThisTurn: true,
      pending: null,
    },
    events,
  };
}
