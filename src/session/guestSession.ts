import { createInitialState, type GameState } from '../engine';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import { PROTOCOL_VERSION, parseHostMessage, type GuestMessage } from './protocol';
import { startHeartbeat } from './heartbeat';
import { applyDoodleChange, type Doodle, type DoodleOp } from './doodle';
import type { ToyOp } from './toy';
import {
  cleanChat,
  cleanName,
  pushChat,
  type ChatMessage,
  type ConnectionStatus,
  type Member,
  type Phase,
  type Request,
  type Role,
  type Seat,
  type Session,
  type SessionView,
  type TimerSnapshot,
  type TurnTimer,
  WATCH_DEFAULT,
  type WatchState,
} from './types';

export interface GuestOptions {
  /** Random per-browser id sent with hello, so the host recognises us when we come back. */
  id?: string;
  name?: string;
  /** Opens a fresh connection to the same room; without it a lost connection is final. */
  reconnect?: () => Promise<Channel>;
  onDispose?: () => void;
  heartbeatMs?: number;
  silenceTimeoutMs?: number;
  /** First retry delay; grows to at most 10 s. */
  retryMs?: number;
}

/**
 * Online guest (player or spectator): shows the host's state and sends requests; the host
 * decides everything. If the host goes away (refresh, closed tab, network), the game pauses
 * and the guest keeps trying to reconnect to the same room until the host is back or the
 * player leaves.
 */
export class GuestSession implements Session {
  private readonly emitter = new Emitter();
  private channel: Channel;
  private state: GameState = createInitialState();
  private myKey = '';
  private members: Member[] = [];
  private phase: Phase = 'waiting';
  private watch: WatchState = WATCH_DEFAULT;
  private gmBusy = false;
  private gmName = '';
  private timer: TurnTimer | null = null;
  private chat: ChatMessage[] = [];
  private doodles: Doodle[] = [];
  private connection: ConnectionStatus = { kind: 'connecting' };
  private welcomed = false;
  private disposed = false;
  private turnedAway = false;
  private name: string;

  constructor(channel: Channel, private readonly options: GuestOptions = {}) {
    this.channel = channel;
    this.name = cleanName(options.name);
    this.attach(channel);
  }

  view(): SessionView {
    const me = this.members.find((m) => m.key === this.myKey);
    const seat: Seat = me?.role ?? 'spectator';
    return {
      state: this.state,
      seat,
      gmBusy: this.gmBusy,
      gmName: this.gmName,
      connection: this.connection,
      isAuthority: false,
      phase: this.phase,
      members: this.members,
      myKey: this.myKey,
      timer: this.timer,
      chat: this.chat,
      doodles: this.doodles,
      chaosReady: true,
      watch: this.watch,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  private send(msg: GuestMessage): void {
    if (this.connection.kind === 'connected') this.channel.send(msg);
  }

  request(req: Request): void {
    this.send({ t: 'req', req });
  }

  sendChat(text: string): void {
    const clean = cleanChat(text);
    if (clean) this.send({ t: 'chat', text: clean });
  }

  setName(name: string): void {
    const clean = cleanName(name);
    if (!clean) return;
    this.name = clean;
    this.send({ t: 'name', name: clean });
  }

  doodle(op: DoodleOp): void {
    this.send({ t: 'doodle', op });
  }

  toy(op: ToyOp): void {
    this.send({ t: 'toy', op });
  }

  setGm(): void {}
  setBrains(): void {}
  setRules(): void {}
  start(): void {}
  restart(): void {}
  assignRole(): void {}

  setAi(): void {}
  setWatch(_change: Parameters<Session['setWatch']>[0]): void {}
  rematch(): void {}

  takeSeat(role: Role): void {
    this.send({ t: 'seat', role });
  }

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
    channel.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      ...(this.options.id && { id: this.options.id }),
      ...(this.name && { name: this.name }),
    } satisfies GuestMessage);
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

  private setTimer(t: TimerSnapshot | null) {
    this.timer = t && { ...t, at: Date.now() };
  }

  private onMessage(raw: unknown): void {
    const msg = parseHostMessage(raw);
    if (!msg || msg.t === 'ping') return;
    switch (msg.t) {
      case 'welcome': {
        const again = this.welcomed;
        this.welcomed = true;
        this.connection = { kind: 'connected' };
        this.myKey = msg.you;
        this.state = msg.state;
        this.phase = msg.room.phase;
        this.members = msg.room.members;
        this.watch = msg.room.watch ?? WATCH_DEFAULT;
        this.gmName = msg.gmName;
        this.gmBusy = msg.busy;
        this.setTimer(msg.timer);
        this.chat = msg.chat;
        this.doodles = msg.doodles;
        const me = this.members.find((m) => m.key === this.myKey);
        const where = me?.role === 'black' ? '흑' : me?.role === 'white' ? '백' : me?.role === 'red' ? '적' : null;
        const first = where ? `방에 들어왔습니다. 당신은 ${where}입니다.` : this.phase === 'waiting' ? '방에 들어왔습니다. 대기석에서 앉을 자리를 골라 주세요.' : '방에 들어왔습니다. 관전합니다.';
        this.emitter.emit({
          kind: 'notice',
          text: again ? '방장과 다시 연결되었습니다. 이어 갑니다.' : first,
          tone: 'normal',
        });
        break;
      }
      case 'room':
        this.phase = msg.room.phase;
        this.members = msg.room.members;
        this.watch = msg.room.watch ?? WATCH_DEFAULT;
        break;
      case 'update': {
        const before = this.state;
        this.state = msg.state;
        this.emitter.emit({ kind: 'events', events: msg.events, before, after: msg.state });
        break;
      }
      case 'sync':
        this.state = msg.state;
        break;
      case 'busy':
        this.gmBusy = msg.busy;
        this.gmName = msg.gmName;
        break;
      case 'timer':
        this.setTimer(msg.timer);
        break;
      case 'notice':
        this.emitter.emit({ kind: 'notice', text: msg.text, tone: msg.tone });
        break;
      case 'chat':
        this.chat = pushChat(this.chat, msg.message);
        this.emitter.emit({ kind: 'chat', message: msg.message, mine: msg.message.author === this.myKey });
        break;
      case 'toy':
        this.emitter.emit({ kind: 'toy', op: msg.op });
        break;
      case 'doodle':
        this.doodles = applyDoodleChange(this.doodles, msg.change);
        break;
      case 'full':
        this.turnedAway = true;
        this.connection = { kind: 'disconnected', reason: '방이 꽉 찼습니다.' };
        break;
    }
    this.emitView();
  }
}
