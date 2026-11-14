import { createInitialState, type GameState } from '../engine';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import { PROTOCOL_VERSION, parseHostMessage, type GuestMessage } from './protocol';
import { startHeartbeat } from './heartbeat';
import { cleanChat, type ConnectionStatus, type Request, type Seat, type Session, type SessionView } from './types';

export interface GuestOptions {
  /** Random per-browser id sent with hello, so the host recognises us when we come back. */
  id?: string;
  /** Opens a fresh connection to the same room; without it a lost connection is final. */
  reconnect?: () => Promise<Channel>;
  onDispose?: () => void;
  heartbeatMs?: number;
  silenceTimeoutMs?: number;
  /** First retry delay; grows to at most 10 s. */
  retryMs?: number;
}

/**
 * Online guest: shows the host's state and sends requests; the host decides everything.
 * If the host goes away (refresh, closed tab, network), the game pauses and the guest keeps
 * trying to reconnect to the same room until the host is back or the player leaves.
 */
export class GuestSession implements Session {
  private readonly emitter = new Emitter();
  private channel: Channel;
  private state: GameState = createInitialState();
  private seat: Seat = 'black';
  private gmBusy = false;
  private gmName = '';
  private connection: ConnectionStatus = { kind: 'connecting' };
  private welcomed = false;
  private disposed = false;
  private turnedAway = false;

  constructor(channel: Channel, private readonly options: GuestOptions = {}) {
    this.channel = channel;
    this.attach(channel);
  }

  view(): SessionView {
    return {
      state: this.state,
      seat: this.seat,
      gmBusy: this.gmBusy,
      gmName: this.gmName,
      connection: this.connection,
      isAuthority: false,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  request(req: Request): void {
    if (this.connection.kind !== 'connected') return;
    this.channel.send({ t: 'req', req } satisfies GuestMessage);
  }

  sendChat(text: string): void {
    const clean = cleanChat(text);
    if (!clean || this.connection.kind !== 'connected' || this.seat === 'both') return;
    this.emitter.emit({ kind: 'chat', from: this.seat, text: clean, mine: true });
    this.channel.send({ t: 'chat', text: clean } satisfies GuestMessage);
  }

  setGm(): void {}
  restart(): void {}

  dispose(): void {
    this.disposed = true;
    this.connection = { kind: 'disconnected', reason: '방에서 나왔습니다.' };
    this.channel.close();
    this.options.onDispose?.();
  }

  private attach(channel: Channel): void {
    this.channel = channel;
    const heartbeat = startHeartbeat(channel, this.options.heartbeatMs ?? 10_000, this.options.silenceTimeoutMs);
    channel.onMessage((raw) => {
      if (this.channel !== channel) return;
      heartbeat.seen();
      this.onMessage(raw);
    });
    channel.onClose(() => {
      heartbeat.stop();
      if (this.channel !== channel || this.disposed) return;
      if (this.turnedAway || !this.options.reconnect) {
        if (this.connection.kind !== 'disconnected') {
          this.connection = { kind: 'disconnected', reason: '방장과의 연결이 끊겼습니다.' };
          this.emitView();
        }
        return;
      }
      this.connection = { kind: 'paused', reason: '방장과의 연결이 끊겼습니다.' };
      this.emitView();
      void this.reconnectLoop();
    });
    const hello: GuestMessage = this.options.id ? { t: 'hello', v: PROTOCOL_VERSION, id: this.options.id } : { t: 'hello', v: PROTOCOL_VERSION };
    channel.send(hello);
  }

  private async reconnectLoop(): Promise<void> {
    let delay = this.options.retryMs ?? 2000;
    while (!this.disposed) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.disposed) return;
      try {
        const next = await this.options.reconnect!();
        if (this.disposed) {
          next.close();
          return;
        }
        this.attach(next);
        return;
      } catch {
        delay = Math.min(10_000, Math.round(delay * 1.5));
      }
    }
  }

  private emitView() {
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  private onMessage(raw: unknown): void {
    const msg = parseHostMessage(raw);
    if (!msg || msg.t === 'ping') return;
    switch (msg.t) {
      case 'welcome': {
        const again = this.welcomed;
        this.welcomed = true;
        this.connection = { kind: 'connected' };
        this.seat = msg.color;
        this.state = msg.state;
        this.gmName = msg.gmName;
        this.gmBusy = msg.busy;
        this.emitter.emit({
          kind: 'notice',
          text: again ? '방장과 다시 연결되었습니다. 게임을 이어 갑니다.' : `방에 들어왔습니다. 당신은 ${msg.color === 'white' ? '백' : '흑'}입니다.`,
          tone: 'normal',
        });
        break;
      }
      case 'update': {
        const before = this.state;
        this.state = msg.state;
        this.emitter.emit({ kind: 'events', events: msg.events, before, after: msg.state });
        break;
      }
      case 'sync':
        this.state = msg.state;
        this.emitter.emit({ kind: 'notice', text: '방장이 새 게임을 시작했습니다.', tone: 'normal' });
        break;
      case 'busy':
        this.gmBusy = msg.busy;
        this.gmName = msg.gmName;
        break;
      case 'notice':
        this.emitter.emit({ kind: 'notice', text: msg.text, tone: msg.tone });
        break;
      case 'chat':
        this.emitter.emit({ kind: 'chat', from: msg.from, text: msg.text, mine: false });
        return;
      case 'full':
        this.turnedAway = true;
        this.connection = { kind: 'disconnected', reason: '이미 두 명이 있는 방입니다.' };
        break;
    }
    this.emitView();
  }
}
