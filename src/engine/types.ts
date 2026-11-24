import type { RollModifier } from './modifiers';
import type { RuleConfig } from './config';
import type { Aura, Exit, Staging } from './staging';
import type { Prop } from './props';
import type { BoardMap } from './squares';

/**
 * The sides: white and black, red on the three-player hexagon, and gray: nobody's, the wanderers a
 * chaos event brings onto the board (a merchant, a mysterious knight). Gray never takes a turn.
 */
export type Color = 'white' | 'black' | 'red' | 'gray';
/** Nobody's side: chaos's wanderers (see wander.ts). */
export const GRAY = 'gray' as const;
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
/**
 * An exile's ragged hood (3인 육각 맵): worn by the one piece a surrendering player keeps. Gear of
 * ×1: a capture of it is always a clash (see clash.ts, canResist), so it never dies in one blow.
 */
export const HOOD = '누더기 후드';
/** 혼란: at the end of its owner's turn it staggers to a random free square it could move to. */
export const CONFUSED = '혼란';
/** 행동대장: at the end of its owner's turn it makes the best move it sees (or holds its ground). */
export const VANGUARD = '행동대장';
/** 원호: a friend next to it about to be taken, it throws itself in and is taken instead. */
export const GUARD = '원호';
/** 인질: held by another side's piece next to it (`holder`); it cannot move, and dies in its holder's stead. */
export const HOSTAGE = '인질';

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
  /**
   * Moves this piece also has while the tag lasts, as if it were these kinds too (a pawn with
   * ['rook'] moves, captures and checks like a pawn or a rook). See movePatterns in tags.ts.
   */
  moveAs?: PieceType[];
  /** Normal moves this piece makes in a row in one turn (2..MAX_MOVE_TIMES), see GameState.chain. */
  moveTimes?: number;
  /** A skill (특기): `bonus` (±1..3) on the roll of special actions it does that are `about` this. See modifiers.ts. */
  skill?: { about: string; bonus: number };
  /** Will (정신력, ±1..3): mental actions by another side against this piece get minus this. See modifiers.ts. */
  mind?: number;
  /** 인질: the id of the piece holding it. See guard.ts. */
  holder?: string;
}

/**
 * The remains (유해) of a piece that fell on the board: for a few of its owner's turns the place
 * remembers it, and reviving it there gets a bonus (see modifiers.ts) and brings back that very piece.
 */
export interface RemainsMark {
  pieceId: string;
  color: Color;
  type: PieceType;
  /** The ground square it fell on (under it, if it was in the air). */
  at: Square;
  /** Its owner's turns left (a gray wanderer's: anyone's). */
  turnsLeft: number;
  /** The turn it fell on (that turn never counts down). */
  appliedOnTurn: number;
}

/** A piece beside the board, and how it left (as the GM staged it; missing = knocked off). */
export interface CapturedPiece extends Piece {
  exit?: Exit;
  /** Where it shattered (exit 'shatter'): its shards lie scattered on that ground square. */
  at?: Square;
}

export interface Piece {
  id: string;
  color: Color;
  type: PieceType;
  tags?: Tag[];
  /** A friendly piece riding on this one (it is not on the board itself and moves with this piece). */
  rider?: Piece;
  /** Fused (융합): the pieces it took in, worn as crowns on top, and what it fights with. See fusion.ts. */
  fuse?: Fusion;
}

/**
 * A fused piece (융합, docs/SPEC.md): it keeps its own kind, moves and side (the body) and wears
 * the heads of the pieces it took in as stacked crowns, oldest at the bottom. Fusing alone makes it
 * a fighter: `base` is its clash multiplier before tags (the body's base plus a quarter of each
 * piece taken in, as it was then).
 */
export interface Fusion {
  base: number;
  crowns: { id: string; type: PieceType; color: Color }[];
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
/**
 * A building (건물, docs/SPEC.md "건물"): a wall that also helps actions done next to it. Three
 * ready-made kinds, or the GM's own ('custom', with its own name and what it helps with).
 */
export type BuildingKind = 'cannon' | 'church' | 'forge' | 'custom';
export const BUILDING_KINDS: readonly BuildingKind[] = ['cannon', 'church', 'forge', 'custom'];
export interface Building {
  kind: BuildingKind;
  /** "대포", "교회", "대장간", or the GM's ("도서관"). */
  name: string;
  /** What kind of action it helps with ("원거리 공격"). */
  about: string;
  /** Added to the dice of such an action by a piece next to it: 1..3. */
  bonus: number;
}

export interface TerrainCell {
  at: Square;
  kind: TerrainKind;
  /** A wall that is a building (대포, 교회, 대장간, ...). */
  building?: Building;
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

/** A game over with no winner: agreed on, or only kings left for KINGS_ONLY_DRAW_TURNS turns (판 끝내기). */
export type DrawReason = 'agreed' | 'kingsOnly';
/** `by`: how it was won when not by taking the last king ('resign': the other side gave up). */
export type GameStatus = { kind: 'playing' } | { kind: 'won'; winner: Color; by?: 'resign' } | { kind: 'draw'; reason: DrawReason };

export type CastlingRights = Record<Color, { kingSide: boolean; queenSide: boolean }>;

/** A board change a GM ruling can make. The vocabulary grows in later tickets (tags, transform, spawn). */
export type Effect =
  | { type: 'move'; from: Square; to: Square }
  | { type: 'remove'; at: Square }
  /**
   * turns: 0 = permanent. Not for 탑승 (use 'board'). `clash`: a clash multiplier; `prop`: its look
   * on the piece; `moveAs`: kinds it also moves like; `moveTimes`: moves in a row in one turn.
   */
  /** `by`: in a chaos event, who holds the 인질 (a special action's actor holds it there). */
  | { type: 'tag'; at: Square; tag: string; turns: number; by?: Square; aura?: Aura; clash?: number; prop?: Prop; moveAs?: PieceType[]; moveTimes?: number; skill?: { about: string; bonus: number }; mind?: number }
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
  /** 융합: the piece on `body` takes in the one on `material` (next to it), which becomes its newest crown. */
  | { type: 'fuse'; body: Square; material: Square }
  /** The fused piece on `at` lets its newest crown go: that piece stands again on the free square `to` next to it. */
  | { type: 'split'; at: Square; to: Square }
  /** The most recently taken piece of that colour and kind comes back onto the empty square `at`. */
  | { type: 'revive'; at: Square; color: Color; piece: PieceType }
  /** A wall (empty square only) or a pit (swallows whatever stands there) on `at`; turns 0 = permanent. */
  | { type: 'terrain'; at: Square; kind: TerrainKind; turns: number; prop?: Prop; building?: Building }
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
  /** The actor's (or its riders') skill tags that apply to this action, by name (see modifiers.ts). */
  skills?: string[];
  /** A mental action (회유, 매혹, 공포, 설득, 세뇌): the target's will (정신력) counts. */
  mental?: boolean;
  /** The piece mainly acted on, if any (whose will counts for a mental action). */
  target?: Square | null;
  /** Pieces of the declarer's next to the actor, given up when the dice are thrown (희생, see modifiers.ts). */
  sacrifice?: Square[];
  /** Buildings next to the actor that help with this action (건물, see modifiers.ts), by square. */
  buildings?: Square[];
  /** False when the action cannot be attempted at all. */
  feasible: boolean;
  /** Difficulty: the d6 roll must be at least this. */
  dc: number;
  /** AP spent when attempting. */
  cost: number;
  /** Applied in order when the attempt succeeds. */
  effects: Effect[];
  /** Backfire applied on a natural 1. Empty or missing: nothing happens. */
  critFailureEffects?: Effect[];
  narration: { success: string; failure: string; critFailure?: string };
  /** How each outcome looks (GM staging, already cleaned; purely visual). */
  staging?: Partial<Record<Outcome, Staging>>;
}

/** No critical success (사용자 요청): a 6 is just a roll, a natural 1 still backfires. */
export type Outcome = 'success' | 'failure' | 'critFailure';

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
  /** What the modifiers added to the roll (see modifiers.ts), if anything. */
  bonus?: number;
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
  /** After the first throw: what the sacrifice was worth (the pieces are gone; a second try keeps it). */
  offered?: RollModifier[];
}

/**
 * A piece off the board until its fall is played (the `land` command): its levitation ended, or
 * it was thrown off a carrier that was taken from under it.
 */
export interface FallingPiece {
  piece: Piece;
  /** Where it falls from: the air square it floated on, or the square its carrier stood on. */
  from: Square;
  /** It rode a piece of this kind, taken from under it: it tumbles off from on top of it. */
  rodeOn?: PieceType;
  /** Where the blow that took its carrier came from: it is knocked away from there. */
  push?: Square;
}

/**
 * Where a falling piece came to rest, as the physics put it: a point on the board's plane (see
 * squares.ts, planeOf). On the classic board a square's centre is its file and rank (off the board
 * is below 0 or above 7); on the hexagon it is board units from the centre.
 */
export interface Landing {
  id: string;
  file: number;
  rank: number;
}

export interface GameState {
  rules: RuleConfig;
  /** The board: the classic 8×8 for two, or the three-player hexagon (missing: classic). */
  map?: BoardMap;
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
  /**
   * Just after a turn passes: the pieces of the side whose turn ended that now move of their own
   * accord (혼란, 행동대장), taken before its tags counted down, so one that ran out at that very
   * end still moves (it lasted through the turn). Gone with the next command that is not an impulse.
   */
  impulseDue?: { id: string; kind: 'confused' | 'vanguard' }[];
  /** Every attempted special action this game, oldest first. */
  precedents: Precedent[];
  /** Set when a game starts (the session's): tells two games apart that ended alike (기록·전적). Missing in older saves. */
  gameId?: string;
  /** The random scenario this game started in (랜덤 시나리오, scenario.ts), read out on a parchment. */
  scenario?: { id: string; title: string; text: string };
  /**
   * Who took what (명장면's MVP, highlights.ts): piece id → its side and kind when it last took a
   * piece, and how many it has taken. Missing = nothing taken yet.
   */
  takes?: Record<string, { color: Color; type: PieceType; n: number }>;
  /** Pieces taken off the board (captured or removed), oldest first, as plain pieces. */
  captured: CapturedPiece[];
  /** Where pieces fell lately (유해), oldest first: reviving one there is easier. See captured.ts. */
  remains?: RemainsMark[];
  /** Chaos events so far, oldest first (missing in saves from before the rule existed). */
  chaosLog?: ChaosRecord[];
  /** Walls and pits on the board (missing = none). */
  terrain?: TerrainCell[];
  /**
   * The hexagon: a player whose king fell picks the one piece it keeps (the `exile` command, from
   * that player). Nothing else happens meanwhile. Missing = none.
   */
  surrender?: { loser: Color; to: Color };
  /** Pieces falling from the air, waiting for the `land` command (missing = none). Nothing else happens meanwhile. */
  falling?: FallingPiece[];
  /**
   * A piece with moveTimes made a normal move and may move again this turn: only it may move
   * (`left` more times), or the turn is ended. Missing = no chain.
   */
  chain?: Chain;
  /** The turn from which every side had only its king left (gray wanderers aside); missing = not so. See KINGS_ONLY_DRAW_TURNS. */
  kingsOnlySince?: number;
}

/** The piece in the middle of moving several times in a row (see GameState.chain). */
export interface Chain {
  pieceId: string;
  /** Where it stands now. */
  at: Square;
  /** Moves it may still make this turn (at least 1). */
  left: number;
}

export type Command =
  /** `clashRolls`: d6s rolled outside the engine, used in order if the capture becomes a clash. */
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType; clashRolls?: number[] }
  | { type: 'endTurn' }
  | { type: 'proposeSpecial'; action: string; ruling: Ruling }
  /** `roll` is a d6 result produced outside the engine, keeping the engine deterministic. */
  | { type: 'attemptSpecial'; roll: number; dice?: [number, number]; clashRolls?: number[] }
  | { type: 'cancelSpecial' }
  /** The side to move ran out of time: it loses AP and the turn passes. */
  | { type: 'timeout' }
  /** A chaos event at the start of a turn (no AP, no dice). */
  | { type: 'chaos'; chaos: ChaosEvent }
  /**
   * The falling pieces come down where the physics put them (simulated outside the engine with
   * `seed`, which the screens replay). A piece without a landing drops straight down.
   */
  | { type: 'land'; seed: number; landings: Landing[] }
  /** The surrendering player keeps the piece on `at` (see GameState.surrender). */
  | { type: 'exile'; at: Square }
  /** `color` gives up (기권), whoever is to move. See game.ts, resign. */
  | { type: 'resign'; color: Color }
  /** Everyone agreed on a draw (the session asks them; the engine just ends the game). */
  | { type: 'draw' }
  /** Chaos's gray wanderers each make the move given (picked at random outside the engine), after a turn passes. */
  | { type: 'wander'; moves: { from: Square; to: Square }[] }
  /**
   * A piece moves of its own accord at the end of its owner's turn (혼란: at random, 행동대장: its
   * best move; `to` null: it holds its ground). The game's runner picks and sends it.
   */
  /** A piece moving of its own accord at its side's turn's end; `by`: the 행동대장 next to it that orders it (if not itself). */
  | { type: 'impulse'; from: Square; to: Square | null; by?: Square; clashRolls?: number[] };

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
      /** The defender's side (on the 3-player board it is not simply the other one). */
      defender?: Color;
      from: Square;
      at: Square;
      attack: number;
      defense: number;
      rounds: { attack: number; defense: number; attackDice: [number, number]; defenseDice: [number, number] }[];
      winner: 'attacker' | 'defender';
      /** The defender had a shield: losing breaks it instead. */
      shield: boolean;
      /** How many times they meet on screen (합 횟수). */
      exchanges: number;
      /**
       * An instant kill (a remove) tried on a piece with clash gear became this clash (사용자 요청):
       * the attacker fights from its own square and does not take the defender's. 'melee': losing
       * costs it its life as in any clash; 'ranged' (a missile or a spell): it loses nothing but the try.
       */
      strike?: 'melee' | 'ranged';
    }
  /** `cause`: burnt up by 화상, fell into a pit, or lost a clash it started. `exit`: how it goes, if the rules say. */
  | { type: 'removed'; piece: Piece; at: Square; cause?: 'burn' | 'pit' | 'clash' | 'fall' | 'sacrifice' | 'guard' | 'hostage'; exit?: Exit }
  /** The piece that just moved may move again this turn (`left` more times), or the turn may be ended. */
  | { type: 'moveAgain'; pieceId: string; at: Square; left: number }
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
  /** `moveAs`, `moveTimes`: the moves the tag lends the piece, if any. */
  | { type: 'tagged'; pieceId: string; at: Square; tag: string; turns: number | null; moveAs?: PieceType[]; moveTimes?: number }
  | { type: 'untagged'; pieceId: string; at: Square; tag: string }
  | { type: 'tagExpired'; pieceId: string; tag: string }
  | { type: 'boarded'; riderId: string; carrierId: string; from: Square; at: Square }
  | { type: 'unboarded'; riderId: string; from: Square; to: Square; captured: Piece | null }
  | { type: 'transformed'; pieceId: string; at: Square; from: PieceType; to: PieceType }
  | { type: 'spawned'; piece: Piece; at: Square }
  | { type: 'converted'; pieceId: string; at: Square; to: Color }
  | { type: 'swapped'; aId: string; bId: string; a: Square; b: Square }
  | { type: 'revived'; piece: Piece; at: Square }
  | { type: 'terrainMade'; at: Square; kind: TerrainKind; turns: number | null; building?: string }
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
  /** A king fell (on the classic board: the game is over; on the hexagon, `loser` surrenders unless it was the last). */
  | { type: 'kingCaptured'; winner: Color; loser?: Color }
  /** The hexagon: `loser`'s king fell to `to`; it now picks the one piece it keeps (or has none left). */
  | { type: 'surrendered'; loser: Color; to: Color; keepsOne: boolean }
  /** The kept piece goes into exile under a ragged hood; everything else of `loser` now serves `to`. */
  | { type: 'exiled'; loser: Color; to: Color; piece: Piece; at: Square }
  /** `color` gave up; `winner`: who won by it (null: the others play on, the hexagon). */
  | { type: 'resigned'; color: Color; winner: Color | null }
  /** The game ended with no winner. */
  | { type: 'drawn'; reason: DrawReason }
  /** A gray wanderer (chaos's) moves of its own accord; the `moved` event follows. */
  | { type: 'wandered'; pieceId: string; from: Square; to: Square }
  /** An exile took a king: it becomes its side's king again. */
  | { type: 'crowned'; pieceId: string; at: Square; color: Color }
  /** The given color's king is attacked after the change. */
  | { type: 'check'; color: Color }
  /** The mover left their own king attacked (allowed, but warned). */
  | { type: 'ownKingExposed'; color: Color }
  /** `ended`: whose turn it was (their 혼란 and 행동대장 pieces now move of their own accord). */
  | { type: 'turnPassed'; turn: Color; turnNumber: number; apGained: number; ended?: Color }
  /** 융합: `bodyId` took in `materialId` (gone from `material`); `base` is its clash multiplier now. */
  | { type: 'fused'; bodyId: string; materialId: string; body: Square; material: Square; base: number }
  /** The newest crown of the fused piece on `from` stands again on `to`. */
  | { type: 'split'; bodyId: string; pieceId: string; from: Square; to: Square }
  /** A piece moved of its own accord (혼란 / 행동대장); `to` null: it held its ground. The move itself follows as 'moved'. */
  | { type: 'impulse'; pieceId: string; kind: 'confused' | 'vanguard'; from: Square; to: Square | null; by?: string }
  /**
   * Someone was about to be taken and another went down in its place: a 원호 friend that threw
   * itself in (`guard`), or the hostage its holder hid behind (`hostage`). `by`: the attacker's square.
   */
  | { type: 'intercepted'; kind: 'guard' | 'hostage'; saverId: string; savedId: string; attackerId: string; from: Square; at: Square; by: Square }
  | { type: 'specialProposed'; color: Color; action: string; ruling: Ruling }
  /** `afterFailure`: the player let a failed action go instead of rolling again. */
  | { type: 'specialCancelled'; color: Color; action: string; afterFailure?: boolean }
  | {
      type: 'specialResolved';
      color: Color;
      action: string;
      /** The two dice added up (2..12); `dice` are the faces, when the roll came with them. */
      roll: number;
      dice?: [number, number];
      /** What was added to the dice (see modifiers.ts); `bonus` is their total, held within ±4. */
      mods?: RollModifier[];
      bonus?: number;
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
  /** Resigning for a side that is not (or no longer) in the game. */
  | 'notInGame'
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
  | 'nothingFalling'
  /** Mid-chain only the piece moving in a row may move. */
  | 'notChainedPiece'
  /** Mid-chain: no special actions (or chaos) until the turn is over. */
  | 'chainInProgress'
  /** A player surrendered: only its `exile` choice may come next. */
  | 'surrenderPending'
  | 'noSurrender'
  /** The exile must be one of the surrendering player's pieces. */
  | 'notExiledPiece'
  /** A wander move that is not a gray piece's own move (or would take a king or a piece that stands its ground). */
  | 'illegalWander';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason; detail?: string };
