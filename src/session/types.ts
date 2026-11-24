import type { AiLevel, AiSeat, Color, GameEvent, GameState, PromotionType, RuleConfig, Square } from '../engine';
import { cleanAiSeats } from '../engine';
import type { GameMaster } from '../gm/types';
import type { Doodle, DoodleOp } from './doodle';
import type { ToyOp } from './toy';

export const CHAT_MAX_LENGTH = 300;
export const NAME_MAX_LENGTH = 16;
/** Everyone in a room, players and spectators. */
export const MAX_MEMBERS = 10;

/** Trims a chat message to one line of at most CHAT_MAX_LENGTH characters; empty means nothing to send. */
export function cleanChat(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
}

/** A display name: one line, at most NAME_MAX_LENGTH characters; empty means "use a default". */
export function cleanName(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\r\n\t<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

/** What a player asks for. Rolls and GM calls happen on the authority, never on the asking side. */
export type Request =
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType }
  | { type: 'endTurn' }
  | { type: 'declare'; action: string }
  | { type: 'attempt' }
  | { type: 'cancel' }
  /** The 3-player board: the surrendering player keeps the piece on `at` (see GameState.surrender). */
  | { type: 'exile'; at: Square }
  /** Give up (기권): online one's own side; on one screen the side to move (or the person's, on an AI's turn). */
  | { type: 'resign' }
  /** Offer a draw; the others (people) answer, AIs take it only when behind. */
  | { type: 'offerDraw' }
  | { type: 'answerDraw'; accept: boolean };

/** A draw someone offered: who still has to answer it (the others took it, AIs at once). */
export interface DrawOffer {
  from: Color;
  waiting: Color[];
}

/** A player's side, or watching. */
export type Role = Color | 'spectator';

/** Someone in the room. `key` is public (safe to show everyone); the reconnect id never leaves the host. */
export interface Member {
  key: string;
  name: string;
  role: Role;
  online: boolean;
  host: boolean;
}

/** The waiting room (rules, seats) or a game in progress. */
export type Phase = 'waiting' | 'playing';

/** Which side(s) this screen plays: one color online, both in hotseat, none for spectators. */
export type Seat = Color | 'both' | 'spectator';

export type ConnectionStatus =
  | { kind: 'local' }
  /** Host: the room is open under this code. */
  | { kind: 'hosting'; code: string; link: string }
  /** Guest: connected to the host, waiting for the welcome. */
  | { kind: 'connecting' }
  | { kind: 'connected' }
  /** Guest: the host went away; the game is paused while we keep trying to reconnect. */
  | { kind: 'paused'; reason: string }
  | { kind: 'disconnected'; reason: string };

/** The turn clock as the authority reports it. */
export interface TimerSnapshot {
  limitMs: number;
  remainingMs: number;
  /** False while the GM is thinking. */
  running: boolean;
}

/** The turn clock as this screen sees it: counting down from `remainingMs` at local time `at`. */
export interface TurnTimer extends TimerSnapshot {
  at: number;
}

/** Time left on a turn clock right now. */
export function timeLeft(timer: TurnTimer, now = Date.now()): number {
  return Math.max(0, timer.running ? timer.remainingMs - (now - timer.at) : timer.remainingMs);
}

export interface ChatMessage {
  id: number;
  /** Public key of the author (hotseat: the side to move). */
  author: string;
  name: string;
  role: Role;
  text: string;
}

/** How fast the AIs of a watched game go: the pause between moves (the shows play in full). */
export type WatchSpeed = 'slow' | 'normal' | 'fast';
export const WATCH_SPEEDS: readonly WatchSpeed[] = ['slow', 'normal', 'fast'];

/** One AI of a watched series: its name on the scoreboard, the seat it plays now, its wins. */
export interface Entrant {
  label: string;
  level: AiLevel;
  color: Color;
  wins: number;
}

/** A game only AIs play (docs/SPEC.md, "AI 관전"): paused or not, how fast, the score so far, and which game this is. */
export interface WatchState {
  paused: boolean;
  speed: WatchSpeed;
  tally: Entrant[];
  /** Counts games started (a rematch is a new game on the same screen). */
  round: number;
}

export const WATCH_DEFAULT: WatchState = { paused: false, speed: 'normal', tally: [], round: 0 };

export interface SessionView {
  state: GameState;
  seat: Seat;
  gmBusy: boolean;
  gmName: string;
  connection: ConnectionStatus;
  /** Only the authority (hotseat or host) chooses the GM, the rules and when to start. */
  isAuthority: boolean;
  phase: Phase;
  members: Member[];
  /** This screen's member key. */
  myKey: string;
  timer: TurnTimer | null;
  chat: ChatMessage[];
  doodles: Doodle[];
  /** The GM can make chaos events (a real API GM). Only meaningful on the authority. */
  chaosReady: boolean;
  /** For a game only AIs play: pause, speed, the score of the series. */
  watch: WatchState;
  /** A draw offered and not yet answered by everyone (판 끝내기). */
  drawOffer: DrawOffer | null;
  /** One screen: a move can be taken back now (무르기). */
  undoable: boolean;
}

export type NoticeTone = 'normal' | 'warn' | 'error';

export type SessionEvent =
  | { kind: 'view'; view: SessionView }
  | { kind: 'events'; events: GameEvent[]; before: GameState; after: GameState }
  | { kind: 'notice'; text: string; tone: NoticeTone }
  /** A new chat message (not a game action, not saved). */
  | { kind: 'chat'; message: ChatMessage; mine: boolean }
  /** Someone on another screen is playing with what lies about the table (never this screen's own). */
  | { kind: 'toy'; op: ToyOp };

export interface Session {
  view(): SessionView;
  subscribe(listener: (e: SessionEvent) => void): () => void;
  request(req: Request): void;
  sendChat(text: string): void;
  setName(name: string): void;
  doodle(op: DoodleOp): void;
  /** Tells the other screens about something picked up off the table (this screen already shows it). */
  toy(op: ToyOp): void;
  /** Authority only. */
  setGm(gm: GameMaster): void;
  /** Authority only: the AI seats' own models for their special actions (a seat left out uses the GM's). */
  setBrains(brains: Partial<Record<Color, GameMaster>>): void;
  /** Authority only, in the waiting room. */
  setRules(rules: Partial<RuleConfig>): void;
  /** Authority only: from the waiting room into a fresh game. */
  start(): void;
  /** Authority only: back to the waiting room (after a game, or to change rules). */
  restart(): void;
  /** Waiting room: sit in an empty seat (white, black, red on the 3-player board) or go back to the bench ('spectator'). */
  takeSeat(role: Role): void;
  /** Authority only: send a member from their seat back to the waiting bench. */
  assignRole(key: string, role: Role): void;
  /**
   * Authority only, in the waiting room: an AI in this seat (null: the seat is free again). On one
   * screen also mid-game: take a side over from its AI, or hand it to one.
   */
  setAi(color: Color, seat: AiSeat | null): void;
  /** Authority only, a game only AIs play: pause it, or change how fast they go. */
  setWatch(change: { paused?: boolean; speed?: WatchSpeed }): void;
  /** Authority only, after a game only AIs played: the next one at once, the AIs one seat on. */
  rematch(): void;
  /** One screen only: take back the last move (무르기), never past dice or chaos. */
  undo(): void;
  dispose(): void;
}

export const CHAT_HISTORY = 200;

/** Keeps the last CHAT_HISTORY messages. */
export function pushChat(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...list.slice(-(CHAT_HISTORY - 1)), message];
}

/** Rule values a host may set; anything else is clamped into range. */
export function cleanRules(base: RuleConfig, change: Partial<RuleConfig>): RuleConfig {
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const next = { ...base };
  if ('turnSeconds' in change) next.turnSeconds = pick(change.turnSeconds, TURN_SECONDS, base.turnSeconds);
  if ('timeoutPenalty' in change) next.timeoutPenalty = pick(change.timeoutPenalty, TIMEOUT_PENALTIES, base.timeoutPenalty);
  if ('rerollCost' in change) next.rerollCost = pick(change.rerollCost, REROLL_COSTS, base.rerollCost);
  if ('apPerTurn' in change) next.apPerTurn = pick(change.apPerTurn, AP_PER_TURN, base.apPerTurn);
  if ('chaosChance' in change) next.chaosChance = pick(change.chaosChance, CHAOS_CHANCES.map((c) => c.value), base.chaosChance);
  if ('doodle' in change && typeof change.doodle === 'boolean') next.doodle = change.doodle;
  if ('map' in change) next.map = change.map === 'hex3' ? 'hex3' : 'classic';
  // AI seats: only those the board has (a seat lost with the map change goes too).
  const ai = cleanAiSeats('ai' in change ? change.ai : next.ai, next.map);
  if (ai) next.ai = ai;
  else delete next.ai;
  next.apMax = Math.max(next.apMax, next.apPerTurn);
  return next;
}

export const TURN_SECONDS = [0, 30, 60, 90, 120, 180] as const;
export const TIMEOUT_PENALTIES = [1, 2, 3] as const;
export const AP_PER_TURN = [1, 2, 3] as const;
/** AP for a second try after a failed special action; 0 = none. */
export const REROLL_COSTS = [0, 1, 2, 3] as const;
export const CHAOS_CHANCES = [
  { value: 0, label: '끔' },
  { value: 0.1, label: '가끔 (10%)' },
  { value: 0.25, label: '자주 (25%)' },
  { value: 0.5, label: '매우 자주 (50%)' },
] as const;
