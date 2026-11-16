import type { Color, GameState, Piece, PieceType } from './types';
import { SQUARES, backRank, homeHalf, parseSquare, playersOf, setBoardMap, squareAt, type BoardMap } from './squares';
import { FULL_CASTLING, NO_CASTLING } from './castling';
import { DEFAULT_RULES, type RuleConfig } from './config';

const BACK_RANK: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

/** AP at game start: everyone starts at apStart, and white's first turn has already begun. */
function initialAp(rules: RuleConfig, map: BoardMap): Record<Color, number> {
  return { white: Math.min(rules.apMax, rules.apStart + rules.apPerTurn), black: rules.apStart, red: map === 'hex3' ? rules.apStart : 0, gray: 0 };
}

/** A new game on `map` (the classic board by default; it also becomes the board in play). */
export function createInitialState(rules: RuleConfig = DEFAULT_RULES, map: BoardMap = 'classic'): GameState {
  setBoardMap(map);
  const board: (Piece | null)[] = Array(SQUARES).fill(null);
  if (map === 'hex3') {
    // Each army on its own half: the back rank and the pawns in front, as on a normal board.
    for (const color of playersOf(map)) {
      for (let f = 0; f < 8; f++) {
        board[backRank(color, f)] = { id: `${color}-${BACK_RANK[f]}-${f}-0`, color, type: BACK_RANK[f] };
        board[squareAt(f, 1, homeHalf(color))!] = { id: `${color}-pawn-${f}-1`, color, type: 'pawn' };
      }
    }
  } else {
    const place = (color: Color, type: PieceType, file: number, rank: number) => {
      board[squareAt(file, rank)!] = { id: `${color}-${type}-${file}-${rank}`, color, type };
    };
    for (let f = 0; f < 8; f++) {
      place('white', BACK_RANK[f], f, 0);
      place('white', 'pawn', f, 1);
      place('black', 'pawn', f, 6);
      place('black', BACK_RANK[f], f, 7);
    }
  }
  return {
    rules,
    ...(map !== 'classic' && { map }),
    board,
    turn: 'white',
    turnNumber: 1,
    status: { kind: 'playing' },
    castling: FULL_CASTLING,
    enPassant: null,
    ap: initialAp(rules, map),
    nextSpawnId: 1,
    usedApThisTurn: false,
    pending: null,
    precedents: [],
    captured: [],
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
  setBoardMap(extra.map);
  const board: (Piece | null)[] = Array(SQUARES).fill(null);
  for (const [name, p] of Object.entries(placements)) {
    const sq = parseSquare(name);
    if (sq === null) throw new Error(`bad square ${name}`);
    board[sq] = { id: `${p.color}-${p.type}-${name}`, color: p.color, type: p.type };
  }
  return {
    rules: DEFAULT_RULES,
    board,
    turn,
    turnNumber: 1,
    status: { kind: 'playing' },
    castling: NO_CASTLING,
    enPassant: null,
    ap: { white: 0, black: 0, red: 0, gray: 0 },
    nextSpawnId: 1,
    usedApThisTurn: false,
    pending: null,
    precedents: [],
    captured: [],
    ...extra,
  };
}

/** A board from before the air layer (only the ground) gets an empty air layer. */
export function withAir(board: ReadonlyArray<Piece | null>, map?: BoardMap): (Piece | null)[] {
  const size = map === 'hex3' ? 192 : 128;
  return board.length >= size ? [...board] : [...board, ...Array(size - board.length).fill(null)];
}
