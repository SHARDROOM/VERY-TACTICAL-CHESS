import { createInitialState, type GameState } from '../engine';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import { PROTOCOL_VERSION, parseHostMessage, type GuestMessage } from './protocol';
import { startHeartbeat } from './heartbeat';
import type { ConnectionStatus, Request, Seat, Session, SessionView } from './types';

/** Online guest: shows the host's state and sends requests; the host decides everything. */
export class GuestSession implements Session {
  private readonly emitter = new Emitter();
  private state: GameState = createInitialState();
  private seat: Seat = 'black';
  private gmBusy = false;
  private gmName = '';
  private connection: ConnectionStatus = { kind: 'connected' };
  private welcomed = false;

  constructor(
    private readonly channel: Channel,
    private readonly onDispose?: () => void,
    heartbeatMs = 10_000,
    silenceTimeoutMs?: number,
  ) {
    const heartbeat = startHeartbeat(channel, heartbeatMs, silenceTimeoutMs);
    channel.onMessage((raw) => {
      heartbeat.seen();
      this.onMessage(raw);
    });
    channel.onClose(() => {
      heartbeat.stop();
      if (this.connection.kind === 'disconnected') return;
      this.connection = { kind: 'disconnected', reason: '방장과의 연결이 끊겼습니다.' };
      this.emitView();
    });
    channel.send({ t: 'hello', v: PROTOCOL_VERSION } satisfies GuestMessage);
  }

  view(): SessionView {
    return {
      state: this.state,
      seat: this.seat,
      gmBusy: this.gmBusy,
      gmName: this.gmName,
      connection: this.welcomed || this.connection.kind === 'disconnected' ? this.connection : { kind: 'connecting' },
      isAuthority: false,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  request(req: Request): void {
    if (this.connection.kind !== 'connected') return;
    this.channel.send({ t: 'req', req } satisfies GuestMessage);
  }

  setGm(): void {}
  restart(): void {}

  dispose(): void {
    this.connection = { kind: 'disconnected', reason: '방에서 나왔습니다.' };
    this.channel.close();
    this.onDispose?.();
  }

  private emitView() {
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  private onMessage(raw: unknown): void {
    const msg = parseHostMessage(raw);
    if (!msg || msg.t === 'ping') return;
    switch (msg.t) {
      case 'welcome':
        this.welcomed = true;
        this.seat = msg.color;
        this.state = msg.state;
        this.gmName = msg.gmName;
        this.gmBusy = msg.busy;
        this.emitter.emit({ kind: 'notice', text: `방에 들어왔습니다. 당신은 ${msg.color === 'white' ? '백' : '흑'}입니다.`, tone: 'normal' });
        break;
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
      case 'full':
        this.connection = { kind: 'disconnected', reason: '이미 두 명이 있는 방입니다.' };
        break;
    }
    this.emitView();
  }
}
