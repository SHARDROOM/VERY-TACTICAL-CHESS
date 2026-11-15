import type { RuleConfig } from './config';
import type { Aura, Exit, Staging } from './staging';

export type Color = 'white' | 'black';
export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PromotionType = 'queen' | 'rook' | 'bishop' | 'knight';
export const PROMOTION_TYPES: readonly PromotionType[] = ['queen', 'rook', 'bishop', 'knight'];

/** Tags with rules the engine enforces. Any other tag name is a free, narrative-only tag. */
export const STUN = '기절';
export const RIDE = '탑승';
export const SHIELD = '보호막';
/** A burning piece: if it has not moved off its square when the turns run out, it burns to ash. */
export const BURN = '화상';

export interface Tag {
  name: string;
  /** Owner's turns left; null = permanent. See tags.ts for exactly when it counts down. */
  turnsLeft: number | null;
  /** Turn number on which the tag was applied (that turn never counts down). */
  appliedOnTurn: number;
  /** A lasting look while the tag lasts (GM staging; no rule meaning). */
  aura?: Aura;
}

/** A piece beside the board, and how it left (as the GM staged it; missing = knocked off). */
export interface CapturedPiece extends Piece {
  exit?: Exit;
}

export interface Piece {
  id: string;
  color: Color;
  type: PieceType;
  tags?: Tag[];
  /** A friendly piece riding on this one (it is not on the board itself and moves with this piece). */
  rider?: Piece;
}

/** What can stand on a square instead of a piece: nothing enters or passes it (knights jump over). */
export type TerrainKind = 'wall' | 'pit';
export const TERRAIN_KINDS: readonly TerrainKind[] = ['wall', 'pit'];
export const TERRAIN_NAME: Record<TerrainKind, string> = { wall: '벽', pit: '구덩이' };

/** A wall or pit on one square. A square with terrain never holds a piece. */
export interface TerrainCell {
  at: Square;
  kind: TerrainKind;
  /** Turns of `owner` left; null = permanent. Counts down like a tag (see tags.ts). */
  turnsLeft: number | null;
  /** Whose turns it lasts: the side whose turn it was made on. */
  owner: Color;
  appliedOnTurn: number;
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
  | { type: 'tag'; at: Square; tag: string; turns: number; aura?: Aura }
  | { type: 'untag'; at: Square; tag: string }
  /** The piece on `rider` climbs onto the friendly piece on `carrier`. */
  | { type: 'board'; rider: Square; carrier: Square }
  /** The rider of the piece on `at` gets off onto `to`. */
  | { type: 'unboard'; at: Square; to: Square }
  | { type: 'transform'; at: Square; into: PieceType }
  | { type: 'spawn'; at: Square; color: Color; piece: PieceType }
  /** The piece on `at` (and whoever rides it) changes sides. */
  | { type: 'convert'; at: Square; color: Color }
  /** The pieces on `a` and `b` trade squares (riders go with their carriers). */
  | { type: 'swap'; a: Square; b: Square }
  /** The most recently taken piece of that colour and kind comes back onto the empty square `at`. */
  | { type: 'revive'; at: Square; color: Color; piece: PieceType }
  /** A wall (empty square only) or a pit (swallows whatever stands there) on `at`; turns 0 = permanent. */
  | { type: 'terrain'; at: Square; kind: TerrainKind; turns: number }
  /** Takes away the wall or pit on `at` (nothing there: no-op). */
  | { type: 'clearTerrain'; at: Square };

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
  /** Applied instead of `effects` on a natural 20. Empty or missing: `effects` apply. */
  critSuccessEffects?: Effect[];
  /** Backfire applied on a natural 1. Empty or missing: nothing happens. */
  critFailureEffects?: Effect[];
  narration: { success: string; failure: string; critSuccess?: string; critFailure?: string };
  /** How each outcome looks (GM staging, already cleaned; purely visual). */
  staging?: Partial<Record<Outcome, Staging>>;
}

export type Outcome = 'critSuccess' | 'success' | 'failure' | 'critFailure';

/** A past ruling in this game, shown to the GM so similar declarations get similar rulings. */
export interface Precedent {
  turnNumber: number;
  color: Color;
  action: string;
  interpretation: string;
  dc: number;
  cost: number;
  roll: number;
  outcome: Outcome;
}

/** Something chaotic the GM made happen at the start of a turn (the 혼돈 rule). */
export interface ChaosEvent {
  title: string;
  narration: string;
  effects: Effect[];
  staging?: Staging;
}

/** A chaos event that happened, kept so later rulings can build on it. */
export interface ChaosRecord {
  turnNumber: number;
  title: string;
  narration: string;
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
  /** Every attempted special action this game, oldest first. */
  precedents: Precedent[];
  /** Pieces taken off the board (captured or removed), oldest first, as plain pieces. */
  captured: CapturedPiece[];
  /** Chaos events so far, oldest first (missing in saves from before the rule existed). */
  chaosLog?: ChaosRecord[];
  /** Walls and pits on the board (missing = none). */
  terrain?: TerrainCell[];
}

export type Command =
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType }
  | { type: 'endTurn' }
  | { type: 'proposeSpecial'; action: string; ruling: Ruling }
  /** `roll` is a d20 result produced outside the engine, keeping the engine deterministic. */
  | { type: 'attemptSpecial'; roll: number }
  | { type: 'cancelSpecial' }
  /** The side to move ran out of time: it loses AP and the turn passes. */
  | { type: 'timeout' }
  /** A chaos event at the start of a turn (no AP, no dice). */
  | { type: 'chaos'; chaos: ChaosEvent };

export type MoveSpecial =
  | { kind: 'castle'; side: 'king' | 'queen' }
  | { kind: 'enPassant' }
  | { kind: 'promotion'; to: PromotionType };

export type GameEvent =
  | { type: 'moved'; pieceId: string; from: Square; to: Square; captured: Piece | null; special?: MoveSpecial }
  /** `cause`: burnt up by 화상 at the end of its owner's turn, or fell into a pit. */
  | { type: 'removed'; piece: Piece; at: Square; cause?: 'burn' | 'pit' }
  | { type: 'tagged'; pieceId: string; at: Square; tag: string; turns: number | null }
  | { type: 'untagged'; pieceId: string; at: Square; tag: string }
  | { type: 'tagExpired'; pieceId: string; tag: string }
  | { type: 'boarded'; riderId: string; carrierId: string; from: Square; at: Square }
  | { type: 'unboarded'; riderId: string; from: Square; to: Square; captured: Piece | null }
  | { type: 'transformed'; pieceId: string; at: Square; from: PieceType; to: PieceType }
  | { type: 'spawned'; piece: Piece; at: Square }
  | { type: 'converted'; pieceId: string; at: Square; to: Color }
  | { type: 'swapped'; aId: string; bId: string; a: Square; b: Square }
  | { type: 'revived'; piece: Piece; at: Square }
  | { type: 'terrainMade'; at: Square; kind: TerrainKind; turns: number | null }
  /** `expired`: its turns ran out (otherwise an effect took it away). */
  | { type: 'terrainCleared'; at: Square; kind: TerrainKind; expired: boolean }
  | { type: 'timedOut'; color: Color; apLost: number }
  /** Carries the applied effects and their staging so every screen can play the event step by step. */
  | { type: 'chaos'; title: string; narration: string; effects: Effect[]; staging?: Staging }
  /** A special action left the opponent's king attacked, so the turn ended by itself. */
  | { type: 'autoTurnEnd'; color: Color; reason: 'check' }
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
      outcome: Outcome;
      narration: string;
      /** The effects that were applied for this outcome (empty on a plain failure), for step-by-step playback. */
      effects: Effect[];
      staging?: Staging;
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
  | 'invalidRoll'
  | 'kingProtectedThisTurn'
  | 'nothingDoneThisTurn'
  | 'invalidChaos';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason; detail?: string };
