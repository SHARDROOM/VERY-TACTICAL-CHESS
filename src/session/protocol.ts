import { PROMOTION_TYPES, type Color, type GameEvent, type GameState } from '../engine';
import type { NoticeTone, Request } from './types';

export const PROTOCOL_VERSION = 1;

export type GuestMessage = { t: 'hello'; v: number } | { t: 'req'; req: Request } | { t: 'ping' };

export type HostMessage =
  | { t: 'welcome'; v: number; color: Color; state: GameState; gmName: string; busy: boolean }
  | { t: 'update'; state: GameState; events: GameEvent[] }
  | { t: 'sync'; state: GameState }
  | { t: 'busy'; busy: boolean; gmName: string }
  | { t: 'notice'; text: string; tone: NoticeTone }
  | { t: 'full' }
  | { t: 'ping' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSquare = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64;

/** The host must not trust anything the guest sends: this is the only door in. */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello') return typeof raw.v === 'number' ? { t: 'hello', v: raw.v } : null;
  if (raw.t === 'ping') return { t: 'ping' };
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

/** The guest trusts the host's game state (host authority), but still ignores junk. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'welcome':
      return isObj(raw.state) && (raw.color === 'white' || raw.color === 'black') ? (raw as unknown as HostMessage) : null;
    case 'update':
      return isObj(raw.state) && Array.isArray(raw.events) ? (raw as unknown as HostMessage) : null;
    case 'sync':
      return isObj(raw.state) ? (raw as unknown as HostMessage) : null;
    case 'busy':
      return typeof raw.busy === 'boolean' ? (raw as unknown as HostMessage) : null;
    case 'notice':
      return typeof raw.text === 'string' ? (raw as unknown as HostMessage) : null;
    case 'full':
      return { t: 'full' };
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}
