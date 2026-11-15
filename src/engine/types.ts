import type { RuleConfig } from './config';
import type { Aura, Exit, Staging } from './staging';
import type { Prop } from './props';

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
/**
 * A floating piece: it stands on the air layer (the square + 64) for as long as the tag lasts,
 * and falls when it ends (see levitation.ts).
 */
export const LEVITATE = '공중부양';

export interface Tag {
  name: string;
  /** Owner's turns left; null = permanent. See tags.ts for exactly when it counts down. */
  turnsLeft: number | null;
  /** Turn number on which the tag was applied (that turn never counts down). */
  appliedOnTurn: number;
  /** A lasting look while the tag lasts (GM staging; no rule meaning). */
  aura?: Aura;
  /**
   * Clash multiplier (합 배율, 1.2..2.0), e.g. 검술 ×1.5: a piece with one fights a clash when
   * someone tries to capture it, and uses it when it attacks into a clash. See clash.ts.
   */
  clash?: number;
  /** What the tag looks like on the piece (a sword for 검술); goes with the tag. */
  prop?: Prop;
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

/** What lets pieces cross terrain: a bridge over a pit (cross and stand on it), a ladder on a wall (cross only). */
export type CoverKind = 'bridge' | 'ladder';
export const COVER_NAME: Record<CoverKind, string> = { bridge: '다리', ladder: '사다리' };

export interface TerrainCover {
  kind: CoverKind;
  /** Turns of `owner` left; null = permanent (counted like the terrain itself). */
  turnsLeft: number | null;
  owner: Color;
  appliedOnTurn: number;
  /** The look the GM gave it (a ready-made bridge or ladder otherwise). */
  prop?: Prop;
}

/** A wall or pit on one square. Only a bridged pit ever holds a piece. */
export interface TerrainCell {
  at: Square;
  kind: TerrainKind;
  /** Turns of `owner` left; null = permanent. Counts down like a tag (see tags.ts). */
  turnsLeft: number | null;
  /** Whose turns it lasts: the side whose turn it was made on. */
  owner: Color;
  appliedOnTurn: number;
  /** The look the GM gave it (a barricade, a statue...); stones or a plain hole otherwise. */
  prop?: Prop;
  /** A bridge over the pit or a ladder on the wall. */
  cover?: TerrainCover;
}

/**
 * 0..63 on the ground, index = rank * 8 + file (a1 = 0, h1 = 7, a8 = 56); 64..127 the air above
 * the same squares (see squares.ts). Walls, pits, castling and en passant are ground only.
 */
export type Square = number;

export type Board = ReadonlyArray<Piece | null>;

export type GameStatus = { kind: 'playing' } | { kind: 'won'; winner: Color };

export type CastlingRights = Record<Color, { kingSide: boolean; queenSide: boolean }>;

/** A board change a GM ruling can make. The vocabulary grows in later tickets (tags, transform, spawn). */
export type Effect =
  | { type: 'move'; from: Square; to: Square }
  | { type: 'remove'; at: Square }
  /** turns: 0 = permanent. Not for 탑승 (use 'board'). `clash`: a clash multiplier; `prop`: its look on the piece. */
  | { type: 'tag'; at: Square; tag: string; turns: number; aura?: Aura; clash?: number; prop?: Prop }
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
  | { type: 'terrain'; at: Square; kind: TerrainKind; turns: number; prop?: Prop }
  /** A bridge over the pit on `at`, or a ladder on the wall there; turns 0 = permanent. */
  | { type: 'cover'; at: Square; kind: CoverKind; turns: number; prop?: Prop }
  /** Cuts the bridge or takes the ladder away (whoever stands on a bridge falls). */
  | { type: 'clearCover'; at: Square }
  /** Takes away the wall or pit on `at` (nothing there: no-op). */
  | { type: 'clearTerrain'; at: Square };

/**
 * How the acting piece does it, which sets how far it reaches: touch (1 square: setting fire,
 * pushing, grabbing), ranged (arrows, throws, shots: any distance, harder further away), magic
 * (spells: any distance, depends on the piece), move (the piece itself travels).
 */
export type Means = 'touch' | 'ranged' | 'magic' | 'move';
export const MEANS: readonly Means[] = ['touch', 'ranged', 'magic', 'move'];
export const MEANS_NAME: Record<Means, string> = { touch: '근접', ranged: '원거리', magic: '마법', move: '이동' };

/** The GM's ruling on a declared special action, already converted to engine squares. */
export interface Ruling {
  /** How the GM understood the declaration. */
  interpretation: string;
  /**
   * The declarer's piece that does it. Every GM ruling names one (null: the declaration had
   * none, so a feasible ruling is refused); missing only in rulings made before the rule.
   */
  actor?: Square | null;
  /** How it does it; touch means everything it acts on is within 1 square. */
  means?: Means;
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
  /** How many times the dice were rolled again after a failure (roll and outcome are the last). */
  rerolls?: number;
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
  /**
   * Set when the last roll was a plain failure: the same ruling may be rolled again for
   * `rules.rerollCost` AP, or let go. `rerolls`: second tries made so far.
   */
  retry?: { roll: number; narration: string; rerolls: number };
}

/** A piece whose levitation ended: it is off the board until the fall is played (the `land` command). */
export interface FallingPiece {
  piece: Piece;
  /** The air square it falls from. */
  from: Square;
}

/**
 * Where a falling piece came to rest, as the physics put it: continuous board coordinates (a
 * square's centre is its file and rank; off the board is below 0 or above 7).
 */
export interface Landing {
  id: string;
  file: number;
  rank: number;
}

export interface GameState {
  rules: RuleConfig;
  /** SQUARES entries: the ground, then the air (see Square). */
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
  /** Pieces falling from the air, waiting for the `land` command (missing = none). Nothing else happens meanwhile. */
  falling?: FallingPiece[];
}

export type Command =
  /** `clashRolls`: d20s rolled outside the engine, used in order if the capture becomes a clash. */
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType; clashRolls?: number[] }
  | { type: 'endTurn' }
  | { type: 'proposeSpecial'; action: string; ruling: Ruling }
  /** `roll` is a d20 result produced outside the engine, keeping the engine deterministic. */
  | { type: 'attemptSpecial'; roll: number; clashRolls?: number[] }
  | { type: 'cancelSpecial' }
  /** The side to move ran out of time: it loses AP and the turn passes. */
  | { type: 'timeout' }
  /** A chaos event at the start of a turn (no AP, no dice). */
  | { type: 'chaos'; chaos: ChaosEvent }
  /**
   * The falling pieces come down where the physics put them (simulated outside the engine with
   * `seed`, which the screens replay). A piece without a landing drops straight down.
   */
  | { type: 'land'; seed: number; landings: Landing[] };

export type MoveSpecial =
  | { kind: 'castle'; side: 'king' | 'queen' }
  | { kind: 'enPassant' }
  | { kind: 'promotion'; to: PromotionType };

export type GameEvent =
  /** `capturedExit`: how the captured piece goes, if the rules say (cut down in a clash). */
  | { type: 'moved'; pieceId: string; from: Square; to: Square; captured: Piece | null; special?: MoveSpecial; capturedExit?: Exit }
  /** A clash (합): who fought, their multipliers, every round of dice (ties first), who won and how long it looks. */
  | {
      type: 'clash';
      attackerId: string;
      defenderId: string;
      attacker: Color;
      from: Square;
      at: Square;
      attack: number;
      defense: number;
      rounds: { attack: number; defense: number }[];
      winner: 'attacker' | 'defender';
      /** The defender had a shield: losing breaks it instead. */
      shield: boolean;
      /** How many times they meet on screen (합 횟수). */
      exchanges: number;
    }
  /** `cause`: burnt up by 화상, fell into a pit, or lost a clash it started. `exit`: how it goes, if the rules say. */
  | { type: 'removed'; piece: Piece; at: Square; cause?: 'burn' | 'pit' | 'clash' | 'fall'; exit?: Exit }
  /** A piece given 공중부양 rises from its square to the air above it. */
  | { type: 'lifted'; pieceId: string; from: Square; to: Square }
  /** A floating piece's levitation ended (it ran out, or was taken away): it falls (see `fell`). */
  | { type: 'fallStarted'; pieceId: string; at: Square }
  /**
   * The falls played out, in order, from the physics run with `seed`. `to`: the ground square it
   * now stands on (a king that would have died there is put on the nearest free square instead,
   * `pushed`), or null when it is gone: `buried` in a pit, `shattered` off the board or with no
   * free square under it.
   */
  | {
      type: 'fell';
      seed: number;
      falls: { pieceId: string; from: Square; to: Square | null; result: 'landed' | 'pushed' | 'buried' | 'shattered' }[];
    }
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
  | { type: 'coverMade'; at: Square; kind: CoverKind; turns: number | null }
  | { type: 'coverGone'; at: Square; kind: CoverKind; expired: boolean }
  /** A king that would have fallen off a bridge, moved to the nearest safe square instead. */
  | { type: 'pushed'; pieceId: string; from: Square; to: Square }
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
  /** `afterFailure`: the player let a failed action go instead of rolling again. */
  | { type: 'specialCancelled'; color: Color; action: string; afterFailure?: boolean }
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
      /** Set on a second try after a failure: which one (1 = the first reroll). `cost` is what it cost. */
      reroll?: number;
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
  | 'invalidChaos'
  | 'clashRollsNeeded'
  /** A piece is falling: only `land` may come next. */
  | 'landingPending'
  | 'nothingFalling';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason; detail?: string };
