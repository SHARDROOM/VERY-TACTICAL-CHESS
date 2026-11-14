import { PROMOTION_TYPES, type GameEvent, type GameState } from '../engine';
import { cleanChat, cleanName, type ChatMessage, type Member, type NoticeTone, type Phase, type Request, type TimerSnapshot } from './types';
import { parseDoodleChange, parseDoodleOp, type Doodle, type DoodleChange, type DoodleOp } from './doodle';


export const PROTOCOL_VERSION = 2;

/**
 * `id` is a random per-browser id, so a guest coming back gets their seat again.
 * It is a secret between that guest and the host: other members only ever see public keys.
 */
export type GuestMessage =
  | { t: 'hello'; v: number; id?: string; name?: string }
  | { t: 'req'; req: Request }
  | { t: 'ping' }
  | { t: 'chat'; text: string }
  | { t: 'name'; name: string }
  | { t: 'doodle'; op: DoodleOp };

export interface RoomSnapshot {
  phase: Phase;
  members: Member[];
}

export type HostMessage =
  | {
      t: 'welcome';
      v: number;
      /** The guest's own public member key. */
      you: string;
      state: GameState;
      gmName: string;
      busy: boolean;
      room: RoomSnapshot;
      timer: TimerSnapshot | null;
      chat: ChatMessage[];
      doodles: Doodle[];
    }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'update'; state: GameState; events: GameEvent[] }
  | { t: 'sync'; state: GameState }
  | { t: 'busy'; busy: boolean; gmName: string }
  | { t: 'timer'; timer: TimerSnapshot | null }
  | { t: 'notice'; text: string; tone: NoticeTone }
  | { t: 'full' }
  | { t: 'ping' }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'doodle'; change: DoodleChange };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSquare = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64;

/** The host must not trust anything a guest sends: this is the only door in. */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello') {
    if (typeof raw.v !== 'number') return null;
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : undefined;
    const name = cleanName(raw.name);
    return { t: 'hello', v: raw.v, ...(id && { id }), ...(name && { name }) };
  }
  if (raw.t === 'ping') return { t: 'ping' };
  if (raw.t === 'chat') {
    const text = cleanChat(raw.text);
    return text ? { t: 'chat', text } : null;
  }
  if (raw.t === 'name') {
    const name = cleanName(raw.name);
    return name ? { t: 'name', name } : null;
  }
  if (raw.t === 'doodle') {
    const op = parseDoodleOp(raw.op);
    return op ? { t: 'doodle', op } : null;
  }
  if (raw.t !== 'req' || !isObj(raw.req)) return null;
  const r = raw.req;
  switch (r.type) {
    case 'move': {
      if (!isSquare(r.from) || !isSquare(r.to)) return null;
      if (r.promotion !== undefined && !PROMOTION_TYPES.includes(r.promotion as never)) return null;
      const base = { type: 'move' as const, from: r.from as number, to: r.to as number };
      const req: Request = r.promotion === undefined ? base : { ...base, promotion: r.promotion as (typeof PROMOTION_TYPES)[number] };
      return { t: 'req', req };
    }
    case 'declare':
      // Length is enforced again by the engine; this only bounds what we accept off the wire.
      return typeof r.action === 'string' && r.action.length <= 1000 ? { t: 'req', req: { type: 'declare', action: r.action } } : null;
    case 'endTurn':
    case 'attempt':
    case 'cancel':
      return { t: 'req', req: { type: r.type } };
    default:
      return null;
  }
}

const isRoom = (v: unknown): v is RoomSnapshot => isObj(v) && (v.phase === 'waiting' || v.phase === 'playing') && Array.isArray(v.members);
const isTimer = (v: unknown) => v === null || (isObj(v) && typeof v.remainingMs === 'number' && typeof v.limitMs === 'number');

function parseChatMessage(v: unknown): ChatMessage | null {
  if (!isObj(v)) return null;
  const text = cleanChat(v.text);
  const role = v.role === 'white' || v.role === 'black' || v.role === 'spectator' ? v.role : null;
  if (!text || !role || typeof v.author !== 'string' || typeof v.id !== 'number') return null;
  return { id: v.id, author: v.author, name: cleanName(v.name) || '?', role, text };
}

/** The guest trusts the host's game state (host authority), but still ignores junk. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'welcome': {
      if (!isObj(raw.state) || typeof raw.you !== 'string' || !isRoom(raw.room) || !isTimer(raw.timer)) return null;
      if (!Array.isArray(raw.chat) || !Array.isArray(raw.doodles)) return null;
      const doodles = parseDoodleChange({ op: 'reset', doodles: raw.doodles });
      return {
        ...(raw as unknown as Extract<HostMessage, { t: 'welcome' }>),
        chat: raw.chat.map(parseChatMessage).filter((m): m is ChatMessage => !!m),
        doodles: doodles?.op === 'reset' ? doodles.doodles : [],
      };
    }
    case 'room':
      return isRoom(raw.room) ? { t: 'room', room: raw.room } : null;
    case 'update':
      return isObj(raw.state) && Array.isArray(raw.events) ? (raw as unknown as HostMessage) : null;
    case 'sync':
      return isObj(raw.state) ? (raw as unknown as HostMessage) : null;
    case 'busy':
      return typeof raw.busy === 'boolean' ? (raw as unknown as HostMessage) : null;
    case 'timer':
      return isTimer(raw.timer) ? { t: 'timer', timer: raw.timer as TimerSnapshot | null } : null;
    case 'notice':
      return typeof raw.text === 'string' ? (raw as unknown as HostMessage) : null;
    case 'full':
      return { t: 'full' };
    case 'ping':
      return { t: 'ping' };
    case 'chat': {
      const message = parseChatMessage(raw.message);
      return message ? { t: 'chat', message } : null;
    }
    case 'doodle': {
      const change = parseDoodleChange(raw.change);
      return change ? { t: 'doodle', change } : null;
    }
    default:
      return null;
  }
}
