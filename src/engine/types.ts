import type { RuleConfig } from './config';

export type Color = 'white' | 'black';
export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PromotionType = 'queen' | 'rook' | 'bishop' | 'knight';
export const PROMOTION_TYPES: readonly PromotionType[] = ['queen', 'rook', 'bishop', 'knight'];

/** Tags with rules the engine enforces. Any other tag name is a free, narrative-only tag. */
export const STUN = '기절';
export const RIDE = '탑승';
export const SHIELD = '보호막';

export interface Tag {
  name: string;
  /** Owner's turns left; null = permanent. See tags.ts for exactly when it counts down. */
  turnsLeft: number | null;
  /** Turn number on which the tag was applied (that turn never counts down). */
  appliedOnTurn: number;
}

export interface Piece {
  id: string;
  color: Color;
  type: PieceType;
  tags?: Tag[];
  /** A friendly piece riding on this one (it is not on the board itself and moves with this piece). */
  rider?: Piece;
}

/** 0..63, index = rank * 8 + file. a1 = 0, h1 = 7, a8 = 56. */
export type Square = number;

export type Board = ReadonlyArray<Piece | null>;

export type GameStatus = { kind: 'playing' } | { kind: 'won'; winner: Color };

export type CastlingRights = Record<Color, { kingSide: boolean; queenSide: boolean }>;

/** A board change a GM ruling can make. The vocabulary grows in later tickets (tags, transform, spawn). */
export type Effect =
  | { type: 'move'; from: Square; to: Square }
  | { type: 'remove'; at: Square }
  /** turns: 0 = permanent. Not for 탑승 (use 'board'). */
  | { type: 'tag'; at: Square; tag: string; turns: number }
  | { type: 'untag'; at: Square; tag: string }
  /** The piece on `rider` climbs onto the friendly piece on `carrier`. */
  | { type: 'board'; rider: Square; carrier: Square }
  /** The rider of the piece on `at` gets off onto `to`. */
  | { type: 'unboard'; at: Square; to: Square }
  | { type: 'transform'; at: Square; into: PieceType }
  | { type: 'spawn'; at: Square; color: Color; piece: PieceType };

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
  /** Counter for ids of pieces created by spawn effects. */
  nextSpawnId: number;
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
  | { type: 'tagged'; pieceId: string; at: Square; tag: string; turns: number | null }
  | { type: 'untagged'; pieceId: string; at: Square; tag: string }
  | { type: 'tagExpired'; pieceId: string; tag: string }
  | { type: 'boarded'; riderId: string; carrierId: string; from: Square; at: Square }
  | { type: 'unboarded'; riderId: string; from: Square; to: Square; captured: Piece | null }
  | { type: 'transformed'; pieceId: string; at: Square; from: PieceType; to: PieceType }
  | { type: 'spawned'; piece: Piece; at: Square }
  /** A capture hit a shield: the shield is gone, the target stays, the attacker did not move. */
  | { type: 'shieldBroken'; pieceId: string; at: Square; attackerId: string | null }
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
