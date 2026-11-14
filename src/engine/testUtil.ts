import { applyCommand, movesFrom, parseSquare, squareName, type Command, type CommandResult, type GameState } from './index';

export const sq = (name: string) => {
  const s = parseSquare(name);
  if (s === null) throw new Error(name);
  return s;
};

export const move = (state: GameState, from: string, to: string, extra: Partial<Extract<Command, { type: 'move' }>> = {}): CommandResult =>
  applyCommand(state, { type: 'move', from: sq(from), to: sq(to), ...extra });

export const okMove = (state: GameState, from: string, to: string, extra: Partial<Extract<Command, { type: 'move' }>> = {}) => {
  const r = move(state, from, to, extra);
  if (!r.ok) throw new Error(`${from}${to} rejected: ${r.reason}`);
  return r;
};

export const ok = (r: CommandResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
};

export const targets = (state: GameState, from: string) => movesFrom(state.board, sq(from)).map(squareName).sort();

/** Plays a sequence like "e2e4 e7e5" from the given state. */
export const play = (state: GameState, moves: string) =>
  moves.split(/\s+/).filter(Boolean).reduce((s, m) => okMove(s, m.slice(0, 2), m.slice(2, 4)).state, state);
