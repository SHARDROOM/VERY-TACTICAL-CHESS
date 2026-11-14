import { opponent, type Color } from '../engine';
import { rollD20 } from '../dice';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent } from './authority';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import { PROTOCOL_VERSION, parseGuestMessage, type HostMessage } from './protocol';
import { startHeartbeat } from './heartbeat';
import type { ConnectionStatus, Request, Session, SessionView } from './types';

export interface HostOptions {
  code: string;
  link: string;
  roll?: () => number;
  /** Liveness ping interval; 0 turns it off. Default 10 s. */
  heartbeatMs?: number;
  /** Silence after which the guest counts as gone. Default 3 minutes (see heartbeat.ts). */
  silenceTimeoutMs?: number;
  /** Called on dispose, e.g. to close the room on the signalling server. */
  onDispose?: () => void;
}

/**
 * Online host: runs the authority (state, dice, GM calls with the host's own key)
 * and mirrors every change to the guest. Nothing secret is ever sent: only game state,
 * events, notices, and the GM's display name.
 */
export class HostSession implements Session {
  readonly hostColor: Color = 'white';
  private readonly emitter = new Emitter();
  private readonly authority: Authority;
  private guest: Channel | null = null;
  private connection: ConnectionStatus;

  constructor(gm: GameMaster, private readonly options: HostOptions) {
    this.authority = new Authority(gm, options.roll ?? rollD20, (e) => this.onAuthority(e));
    this.connection = { kind: 'waiting', code: options.code, link: options.link, guestLeft: false };
  }

  get guestColor(): Color {
    return opponent(this.hostColor);
  }

  view(): SessionView {
    return {
      state: this.authority.state,
      seat: this.hostColor,
      gmBusy: this.authority.busy,
      gmName: this.authority.gm.name,
      connection: this.connection,
      isAuthority: true,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  /** A guest connected to the room. One guest at a time; a guest who left can come back. */
  attachGuest(channel: Channel): void {
    if (this.guest) {
      channel.send({ t: 'full' } satisfies HostMessage);
      setTimeout(() => channel.close(), 200);
      return;
    }
    this.guest = channel;
    const heartbeat = startHeartbeat(channel, this.options.heartbeatMs ?? 10_000, this.options.silenceTimeoutMs);
    channel.onMessage((raw) => {
      if (this.guest !== channel) return;
      heartbeat.seen();
      const msg = parseGuestMessage(raw);
      if (!msg || msg.t === 'ping') return;
      if (msg.t === 'hello') {
        this.send({
          t: 'welcome',
          v: PROTOCOL_VERSION,
          color: this.guestColor,
          state: this.authority.state,
          gmName: this.authority.gm.name,
          busy: this.authority.busy,
        });
        this.setConnection({ kind: 'connected' });
        this.emitter.emit({ kind: 'notice', text: '상대가 방에 들어왔습니다.', tone: 'normal' });
      } else {
        void this.authority.handle(msg.req, this.guestColor);
      }
    });
    channel.onClose(() => {
      heartbeat.stop();
      if (this.guest !== channel) return;
      this.guest = null;
      this.setConnection({ kind: 'waiting', code: this.options.code, link: this.options.link, guestLeft: true });
      this.emitter.emit({ kind: 'notice', text: '상대와의 연결이 끊겼습니다. 같은 방 코드로 다시 들어올 수 있습니다.', tone: 'warn' });
    });
  }

  request(req: Request): void {
    void this.authority.handle(req, this.hostColor);
  }

  setGm(gm: GameMaster): void {
    this.authority.gm = gm;
    this.send({ t: 'busy', busy: this.authority.busy, gmName: gm.name });
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  restart(): void {
    this.authority.reset();
  }

  dispose(): void {
    this.guest?.close();
    this.guest = null;
    this.options.onDispose?.();
  }

  private send(msg: HostMessage): void {
    this.guest?.send(msg);
  }

  private setConnection(c: ConnectionStatus): void {
    this.connection = c;
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  private onAuthority(e: AuthorityEvent): void {
    switch (e.kind) {
      case 'events':
        this.send({ t: 'update', state: e.after, events: e.events });
        this.emitter.emit({ kind: 'events', events: e.events, before: e.before, after: e.after });
        break;
      case 'busy':
        this.send({ t: 'busy', busy: e.busy, gmName: this.authority.gm.name });
        break;
      case 'notice':
        if (e.to === this.guestColor) this.send({ t: 'notice', text: e.text, tone: e.tone });
        else this.emitter.emit({ kind: 'notice', text: e.text, tone: e.tone });
        break;
      case 'reset':
        this.send({ t: 'sync', state: e.state });
        this.emitter.emit({ kind: 'notice', text: '새 게임을 시작했습니다.', tone: 'normal' });
        break;
    }
    this.emitter.emit({ kind: 'view', view: this.view() });
  }
}
