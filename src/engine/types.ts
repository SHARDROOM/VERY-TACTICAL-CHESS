export type Color = 'white' | 'black';
export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PromotionType = 'queen' | 'rook' | 'bishop' | 'knight';
export const PROMOTION_TYPES: readonly PromotionType[] = ['queen', 'rook', 'bishop', 'knight'];

export interface Piece {
  id: string;
  color: Color;
  type: PieceType;
}

/** 0..63, index = rank * 8 + file. a1 = 0, h1 = 7, a8 = 56. */
export type Square = number;

export type Board = ReadonlyArray<Piece | null>;

export type GameStatus = { kind: 'playing' } | { kind: 'won'; winner: Color };

export type CastlingRights = Record<Color, { kingSide: boolean; queenSide: boolean }>;

export interface GameState {
  board: Board;
  turn: Color;
  /** Starts at 1 and increases every time the turn passes. */
  turnNumber: number;
  status: GameStatus;
  castling: CastlingRights;
  /** Square a pawn skipped over with a double step on the previous turn, capturable en passant. */
  enPassant: Square | null;
}

export type Command = { type: 'move'; from: Square; to: Square; promotion?: PromotionType };

export type MoveSpecial =
  | { kind: 'castle'; side: 'king' | 'queen' }
  | { kind: 'enPassant' }
  | { kind: 'promotion'; to: PromotionType };

export type GameEvent =
  | { type: 'moved'; pieceId: string; from: Square; to: Square; captured: Piece | null; special?: MoveSpecial }
  | { type: 'kingCaptured'; winner: Color }
  /** The given color's king is attacked after the move. */
  | { type: 'check'; color: Color }
  /** The mover left their own king attacked (allowed, but warned). */
  | { type: 'ownKingExposed'; color: Color }
  | { type: 'turnPassed'; turn: Color; turnNumber: number };

export type RejectReason =
  | 'gameOver'
  | 'noPiece'
  | 'notYourPiece'
  | 'illegalMove'
  | 'promotionRequired'
  | 'invalidPromotion';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
