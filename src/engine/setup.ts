import type { Color, GameState, Piece, PieceType } from './types';
import { squareAt } from './squares';
import { FULL_CASTLING } from './castling';
import { DEFAULT_RULES, type RuleConfig } from './config';

const BACK_RANK: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

/** AP at game start: both start at apStart, and white's first turn has already begun. */
function initialAp(rules: RuleConfig): Record<Color, number> {
  return { white: Math.min(rules.apMax, rules.apStart + rules.apPerTurn), black: rules.apStart };
}

export function createInitialState(rules: RuleConfig = DEFAULT_RULES): GameState {
  const board: (Piece | null)[] = Array(64).fill(null);
  const place = (color: Color, type: PieceType, file: number, rank: number) => {
    board[squareAt(file, rank)!] = { id: `${color}-${type}-${file}-${rank}`, color, type };
  };
  for (let f = 0; f < 8; f++) {
    place('white', BACK_RANK[f], f, 0);
    place('white', 'pawn', f, 1);
    place('black', 'pawn', f, 6);
    place('black', BACK_RANK[f], f, 7);
  }
  return {
    rules,
    board,
    turn: 'white',
    turnNumber: 1,
    status: { kind: 'playing' },
    castling: FULL_CASTLING,
    enPassant: null,
    ap: initialAp(rules),
    nextSpawnId: 1,
    usedApThisTurn: false,
    pending: null,
  };
}

/**
 * Build a state from a sparse placement map, for tests and scenarios.
 * Castling rights default to none and AP to zero; override via `extra`.
 */
export function createStateFrom(
  placements: Record<string, { color: Color; type: PieceType }>,
  turn: Color = 'white',
  extra: Partial<GameState> = {},
): GameState {
  const board: (Piece | null)[] = Array(64).fill(null);
  for (const [name, p] of Object.entries(placements)) {
    const file = 'abcdefgh'.indexOf(name[0]);
    const rank = Number(name[1]) - 1;
    const sq = squareAt(file, rank);
    if (sq === null) throw new Error(`bad square ${name}`);
    board[sq] = { id: `${p.color}-${p.type}-${name}`, color: p.color, type: p.type };
  }
  return {
    rules: DEFAULT_RULES,
    board,
    turn,
    turnNumber: 1,
    status: { kind: 'playing' },
    castling: {
      white: { kingSide: false, queenSide: false },
      black: { kingSide: false, queenSide: false },
    },
    enPassant: null,
    ap: { white: 0, black: 0 },
    nextSpawnId: 1,
    usedApThisTurn: false,
    pending: null,
    ...extra,
  };
}
