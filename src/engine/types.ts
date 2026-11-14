import type { RuleConfig } from './config';

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

/** A board change a GM ruling can make. The vocabulary grows in later tickets (tags, transform, spawn). */
export type Effect =
  | { type: 'move'; from: Square; to: Square }
  | { type: 'remove'; at: Square };

/** The GM's ruling on a declared special action, already converted to engine squares. */
export interface Ruling {
  /** How the GM understood the declaration. */
  interpretation: string;
  /** False when the action cannot be attempted at all. */
  feasible: boolean;
  /** Difficulty: the d20 roll must be at least this. */
  dc: number;
  /** AP spent when attempting. */
  cost: number;
  /** Applied in order when the attempt succeeds. */
  effects: Effect[];
  narration: { success: string; failure: string };
}

/** A ruled special action waiting for the player to attempt or cancel it. */
export interface PendingAction {
  color: Color;
  action: string;
  ruling: Ruling;
}

export interface GameState {
  rules: RuleConfig;
  board: Board;
  turn: Color;
  /** Starts at 1 and increases every time the turn passes. */
  turnNumber: number;
  status: GameStatus;
  castling: CastlingRights;
  /** Square a pawn skipped over with a double step on the previous turn, capturable en passant. */
  enPassant: Square | null;
  ap: Record<Color, number>;
  /** True once the current player has attempted any special action this turn. */
  usedApThisTurn: boolean;
  pending: PendingAction | null;
}

export type Command =
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType }
  | { type: 'endTurn' }
  | { type: 'proposeSpecial'; action: string; ruling: Ruling }
  /** `roll` is a d20 result produced outside the engine, keeping the engine deterministic. */
  | { type: 'attemptSpecial'; roll: number }
  | { type: 'cancelSpecial' };

export type MoveSpecial =
  | { kind: 'castle'; side: 'king' | 'queen' }
  | { kind: 'enPassant' }
  | { kind: 'promotion'; to: PromotionType };

export type GameEvent =
  | { type: 'moved'; pieceId: string; from: Square; to: Square; captured: Piece | null; special?: MoveSpecial }
  | { type: 'removed'; piece: Piece; at: Square }
  | { type: 'kingCaptured'; winner: Color }
  /** The given color's king is attacked after the change. */
  | { type: 'check'; color: Color }
  /** The mover left their own king attacked (allowed, but warned). */
  | { type: 'ownKingExposed'; color: Color }
  | { type: 'turnPassed'; turn: Color; turnNumber: number; apGained: number }
  | { type: 'specialProposed'; color: Color; action: string; ruling: Ruling }
  | { type: 'specialCancelled'; color: Color; action: string }
  | {
      type: 'specialResolved';
      color: Color;
      action: string;
      roll: number;
      dc: number;
      cost: number;
      success: boolean;
      narration: string;
    };

export type RejectReason =
  | 'gameOver'
  | 'noPiece'
  | 'notYourPiece'
  | 'illegalMove'
  | 'promotionRequired'
  | 'invalidPromotion'
  | 'actionPending'
  | 'noPendingAction'
  | 'emptyAction'
  | 'actionTooLong'
  | 'invalidRuling'
  | 'notFeasible'
  | 'notEnoughAp'
  | 'invalidRoll';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason; detail?: string };
