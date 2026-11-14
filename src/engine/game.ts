import {
  PROMOTION_TYPES,
  type Command,
  type CommandResult,
  type GameEvent,
  type GameState,
  type MoveSpecial,
  type Piece,
} from './types';
import { isInCheck, legalTargets } from './moves';
import { fileOf, opponent, rankOf, squareAt } from './squares';
import { revokeCastling } from './castling';

/** The single entry point for changing game state. Pure: no I/O, no randomness. */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.status.kind !== 'playing') return { ok: false, reason: 'gameOver' };

  switch (cmd.type) {
    case 'move':
      return applyMove(state, cmd);
  }
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

  const events: GameEvent[] = [];
  if (target.special?.kind === 'castle') {
    const rank = rankOf(cmd.from);
    const [rookFrom, rookTo] =
      target.special.side === 'king' ? [squareAt(7, rank)!, squareAt(5, rank)!] : [squareAt(0, rank)!, squareAt(3, rank)!];
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
    touched.push(rookFrom, rookTo);
  }

  events.push({ type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured, ...(special && { special }) });

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

  const mover = piece.color;
  const next = opponent(mover);
  if (isInCheck(board, mover)) events.push({ type: 'ownKingExposed', color: mover });
  if (isInCheck(board, next)) events.push({ type: 'check', color: next });

  const turnNumber = state.turnNumber + 1;
  events.push({ type: 'turnPassed', turn: next, turnNumber });
  return {
    ok: true,
    state: {
      ...state,
      board,
      turn: next,
      turnNumber,
      castling: revokeCastling(state.castling, touched),
      enPassant,
    },
    events,
  };
}
