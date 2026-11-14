import type { Color, GameEvent, GameState, PromotionType, Square } from '../engine';

export const CHAT_MAX_LENGTH = 300;

/** Trims a chat message to one line of at most CHAT_MAX_LENGTH characters; empty means nothing to send. */
export function cleanChat(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
}
import type { GameMaster } from '../gm/types';

/** What a player asks for. Rolls and GM calls happen on the authority, never on the asking side. */
export type Request =
  | { type: 'move'; from: Square; to: Square; promotion?: PromotionType }
  | { type: 'endTurn' }
  | { type: 'declare'; action: string }
  | { type: 'attempt' }
  | { type: 'cancel' };

/** Which side(s) this screen plays: one color online, both in hotseat. */
export type Seat = Color | 'both';

export type ConnectionStatus =
  | { kind: 'local' }
  /** Host: room is open, nobody has joined (or the guest left and may rejoin). */
  | { kind: 'waiting'; code: string; link: string; guestLeft: boolean }
  /** Guest: connected to the host, waiting for the welcome. */
  | { kind: 'connecting' }
  | { kind: 'connected' }
  /** Guest: the host went away; the game is paused while we keep trying to reconnect. */
  | { kind: 'paused'; reason: string }
  | { kind: 'disconnected'; reason: string };

export interface SessionView {
  state: GameState;
  seat: Seat;
  gmBusy: boolean;
  gmName: string;
  connection: ConnectionStatus;
  /** Only the authority (hotseat or host) chooses the GM and restarts games. */
  isAuthority: boolean;
}

export type NoticeTone = 'normal' | 'warn' | 'error';

export type SessionEvent =
  | { kind: 'view'; view: SessionView }
  | { kind: 'events'; events: GameEvent[]; before: GameState; after: GameState }
  | { kind: 'notice'; text: string; tone: NoticeTone }
  /** A chat message between the players (not a game action, not saved). */
  | { kind: 'chat'; from: Color; text: string; mine: boolean };

export interface Session {
  view(): SessionView;
  subscribe(listener: (e: SessionEvent) => void): () => void;
  request(req: Request): void;
  /** Sends a chat message to the other player (in hotseat it just shows up in the chat). */
  sendChat(text: string): void;
  /** Authority only. */
  setGm(gm: GameMaster): void;
  /** Authority only: start a fresh game. */
  restart(): void;
  dispose(): void;
}
