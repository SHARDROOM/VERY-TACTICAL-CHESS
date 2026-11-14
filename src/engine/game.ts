import type { Command, CommandResult, GameEvent, GameState, Piece } from './types';
import { movesFrom, isInCheck } from './moves';
import { opponent } from './squares';

/** The single entry point for changing game state. Pure: no I/O, no randomness. */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.status.kind !== 'playing') return { ok: false, reason: 'gameOver' };

  switch (cmd.type) {
    case 'move': {
      const piece = state.board[cmd.from];
      if (!piece) return { ok: false, reason: 'noPiece' };
      if (piece.color !== state.turn) return { ok: false, reason: 'notYourPiece' };
      if (!movesFrom(state.board, cmd.from).includes(cmd.to)) return { ok: false, reason: 'illegalMove' };

      const board: (Piece | null)[] = [...state.board];
      const captured = board[cmd.to];
      board[cmd.to] = piece;
      board[cmd.from] = null;

      const events: GameEvent[] = [
        { type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured },
      ];

      if (captured?.type === 'king') {
        events.push({ type: 'kingCaptured', winner: piece.color });
        return {
          ok: true,
          state: { ...state, board, status: { kind: 'won', winner: piece.color } },
          events,
        };
      }

      const mover = piece.color;
      const next = opponent(mover);
      if (isInCheck(board, mover)) events.push({ type: 'ownKingExposed', color: mover });
      if (isInCheck(board, next)) events.push({ type: 'check', color: next });

      const turnNumber = state.turnNumber + 1;
      events.push({ type: 'turnPassed', turn: next, turnNumber });
      return { ok: true, state: { ...state, board, turn: next, turnNumber }, events };
    }
  }
}
