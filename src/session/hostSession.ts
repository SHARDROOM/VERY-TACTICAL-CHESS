import type { Color, GameState, RuleConfig } from '../engine';
import { rollD20 } from '../dice';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent, type FallSimulator } from './authority';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import { PROTOCOL_VERSION, parseGuestMessage, type HostMessage, type RoomSnapshot } from './protocol';
import { startHeartbeat } from './heartbeat';
import { DoodleStore, type DoodleChange, type DoodleOp } from './doodle';
import type { ToyOp } from './toy';
import {
  MAX_MEMBERS,
  cleanChat,
  cleanName,
  cleanRules,
  pushChat,
  type ChatMessage,
  type ConnectionStatus,
  type Member,
  type Phase,
  type Request,
  type Role,
  type Session,
  type SessionView,
  type TurnTimer,
} from './types';

export interface HostOptions {
  code: string;
  link: string;
  /** Resume a saved game instead of starting fresh (skips the waiting room). */
  initialState?: GameState;
  /** Resume: the player who held the black seat, so they get it back when they return. */
  black?: { id: string; name: string };
  hostName?: string;
  roll?: () => number;
  chance?: () => number;
  /** Plays falls with physics (see Authority). */
  fall?: FallSimulator;
  /** Liveness ping interval; 0 turns it off. Default 10 s. */
  heartbeatMs?: number;
  /** Silence after which a guest counts as gone. Default 3 minutes (see heartbeat.ts). */
  silenceTimeoutMs?: number;
  /** Called on dispose, e.g. to close the room on the signalling server. */
  onDispose?: () => void;
}

/** A member as the host knows them: with the private reconnect id. */
interface Seat extends Member {
  id: string | null;
  channel: Channel | null;
}

const HOST_KEY = 'host';

/**
 * Online host: runs the authority (state, dice, GM calls with the host's own key) and mirrors
 * every change to everyone in the room. The first guest takes the black seat; anyone after that
 * watches. Nothing secret is ever sent: no API key, and no member's reconnect id.
 */
export class HostSession implements Session {
  readonly hostColor: Color = 'white';
  private readonly emitter = new Emitter();
  private readonly authority: Authority;
  private readonly members: Seat[];
  private chat: ChatMessage[] = [];
  private nextChatId = 1;
  private nextKey = 1;
  private readonly doodles = new DoodleStore();
  private timer: TurnTimer | null = null;
  private readonly connection: ConnectionStatus;

  constructor(gm: GameMaster, private readonly options: HostOptions) {
    const resumed = !!options.initialState;
    this.authority = new Authority(gm, options.roll ?? rollD20, (e) => this.onAuthority(e), {
      initial: options.initialState,
      phase: resumed ? 'playing' : 'waiting',
      chance: options.chance,
      fall: options.fall,
    });
    const t = this.authority.timer();
    this.timer = t && { ...t, at: Date.now() };
    this.connection = { kind: 'hosting', code: options.code, link: options.link };
    this.members = [{ key: HOST_KEY, id: null, channel: null, name: cleanName(options.hostName) || '방장', role: 'white', online: true, host: true }];
    if (options.black) {
      this.members.push({ key: this.newKey(), id: options.black.id, channel: null, name: cleanName(options.black.name) || '흑', role: 'black', online: false, host: false });
    }
  }

  view(): SessionView {
    return {
      state: this.authority.state,
      seat: this.hostColor,
      gmBusy: this.authority.busy,
      gmName: this.authority.gm.name,
      connection: this.connection,
      isAuthority: true,
      phase: this.authority.phase,
      members: this.publicMembers(),
      myKey: HOST_KEY,
      timer: this.timer,
      chat: this.chat,
      doodles: this.doodles.doodles,
      chaosReady: !!this.authority.gm.chaos,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  /** Who sits at black, for saving the game (with the reconnect id, which stays on this machine). */
  blackPlayer(): { id: string; name: string } | null {
    const black = this.members.find((m) => m.role === 'black' && m.id);
    return black ? { id: black.id!, name: black.name } : null;
  }

  /** Someone connected to the room; they get a seat (or are turned away) at their hello. */
  attachGuest(channel: Channel): void {
    const heartbeat = startHeartbeat(channel, this.options.heartbeatMs ?? 10_000, this.options.silenceTimeoutMs);
    channel.onMessage((raw) => {
      heartbeat.seen();
      const msg = parseGuestMessage(raw);
      if (!msg || msg.t === 'ping') return;
      if (msg.t === 'hello') return this.onHello(channel, msg.id, msg.name);
      const member = this.members.find((m) => m.channel === channel);
      if (!member) return;
      switch (msg.t) {
        case 'chat':
          return this.addChat(member, msg.text);
        case 'name':
          member.name = msg.name;
          return this.roomChanged();
        case 'doodle':
          return this.applyDoodle(msg.op, member.key, false);
        case 'toy':
          // On to everyone else, and shown here.
          this.broadcast({ t: 'toy', op: msg.op }, member);
          return this.emitter.emit({ kind: 'toy', op: msg.op });
        case 'req':
          if (member.role === 'spectator') return this.sendTo(member, { t: 'notice', text: '관전자는 수를 둘 수 없습니다.', tone: 'warn' });
          void this.authority.handle(msg.req, member.role);
      }
    });
    channel.onClose(() => {
      heartbeat.stop();
      const member = this.members.find((m) => m.channel === channel);
      if (!member) return;
      member.channel = null;
      member.online = false;
      // A player mid-game keeps their seat to come back to; anyone else simply leaves.
      const keepSeat = member.role !== 'spectator' && this.authority.phase === 'playing';
      if (!keepSeat) this.members.splice(this.members.indexOf(member), 1);
      this.roomChanged();
      const text = keepSeat
        ? `${member.name}님과의 연결이 끊겼습니다. 같은 방 코드로 다시 들어올 수 있습니다.`
        : `${member.name}님이 나갔습니다.`;
      this.emitter.emit({ kind: 'notice', text, tone: keepSeat ? 'warn' : 'normal' });
      this.broadcast({ t: 'notice', text, tone: 'normal' });
    });
  }

  private newKey(): string {
    return `m${this.nextKey++}`;
  }

  private onHello(channel: Channel, id: string | undefined, name: string | undefined): void {
    const returning = id ? this.members.find((m) => !m.host && m.id === id) : undefined;
    let member: Seat;
    if (returning) {
      // The same player on a new connection (refresh, network change): the old link is stale.
      const stale = returning.channel;
      returning.channel = channel;
      returning.online = true;
      if (name) returning.name = name;
      if (stale && stale !== channel) stale.close();
      member = returning;
    } else {
      if (this.members.length >= MAX_MEMBERS) {
        channel.send({ t: 'full' } satisfies HostMessage);
        setTimeout(() => channel.close(), 200);
        return;
      }
      const blackTaken = this.members.some((m) => m.role === 'black');
      member = {
        key: this.newKey(),
        id: id ?? null,
        channel,
        name: name || `손님 ${this.nextKey - 1}`,
        role: blackTaken ? 'spectator' : 'black',
        online: true,
        host: false,
      };
      this.members.push(member);
    }
    channel.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: member.key,
      state: this.authority.state,
      gmName: this.authority.gm.name,
      busy: this.authority.busy,
      room: this.room(),
      timer: this.authority.timer(),
      chat: this.chat.slice(-50),
      doodles: this.doodles.doodles,
    } satisfies HostMessage);
    this.roomChanged(member);
    const role = member.role === 'spectator' ? '관전' : '흑';
    const text = returning ? `${member.name}님이 다시 들어왔습니다.` : `${member.name}님이 들어왔습니다 (${role}).`;
    this.emitter.emit({ kind: 'notice', text, tone: 'normal' });
    this.broadcast({ t: 'notice', text, tone: 'normal' }, member);
  }

  request(req: Request): void {
    void this.authority.handle(req, this.hostColor);
  }

  sendChat(text: string): void {
    const clean = cleanChat(text);
    if (clean) this.addChat(this.members[0], clean);
  }

  setName(name: string): void {
    const clean = cleanName(name);
    if (!clean) return;
    this.members[0].name = clean;
    this.roomChanged();
  }

  doodle(op: DoodleOp): void {
    this.applyDoodle(op, HOST_KEY, true);
  }

  toy(op: ToyOp): void {
    this.broadcast({ t: 'toy', op });
  }

  setGm(gm: GameMaster): void {
    this.authority.gm = gm;
    this.broadcast({ t: 'busy', busy: this.authority.busy, gmName: gm.name });
    this.emitView();
  }

  setRules(rules: Partial<RuleConfig>): void {
    this.authority.setRules(cleanRules(this.authority.state.rules, rules));
  }

  /** Needs someone in the black seat who is here. */
  start(): void {
    if (!this.members.some((m) => m.role === 'black' && m.online)) {
      this.emitter.emit({ kind: 'notice', text: '흑 자리에 앉은 사람이 있어야 시작할 수 있습니다.', tone: 'warn' });
      return;
    }
    this.authority.start();
  }

  restart(): void {
    this.authority.reset();
  }

  assignRole(key: string, role: Role): void {
    const target = this.members.find((m) => m.key === key && !m.host);
    if (!target || role === 'white' || target.role === role) return;
    if (role === 'black') {
      const current = this.members.find((m) => m.role === 'black');
      if (current) {
        if (current.online) current.role = 'spectator';
        else this.members.splice(this.members.indexOf(current), 1);
      }
    }
    target.role = role;
    this.roomChanged();
  }

  dispose(): void {
    this.authority.dispose();
    for (const m of this.members) m.channel?.close();
    this.options.onDispose?.();
  }

  // ---- helpers ----------------------------------------------------------------

  private publicMembers(): Member[] {
    return this.members.map(({ key, name, role, online, host }) => ({ key, name, role, online, host }));
  }

  private room(): RoomSnapshot {
    return { phase: this.authority.phase as Phase, members: this.publicMembers() };
  }

  private sendTo(member: Seat, msg: HostMessage): void {
    member.channel?.send(msg);
  }

  private broadcast(msg: HostMessage, except?: Seat): void {
    for (const m of this.members) if (m !== except) m.channel?.send(msg);
  }

  private roomChanged(except?: Seat): void {
    this.broadcast({ t: 'room', room: this.room() }, except);
    this.emitView();
  }

  private emitView(): void {
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  private addChat(member: Seat, text: string): void {
    const message: ChatMessage = { id: this.nextChatId++, author: member.key, name: member.name, role: member.role, text };
    this.chat = pushChat(this.chat, message);
    this.broadcast({ t: 'chat', message });
    this.emitter.emit({ kind: 'chat', message, mine: member.key === HOST_KEY });
    this.emitView();
  }

  private applyDoodle(op: DoodleOp, author: string, moderator: boolean): void {
    if (op.op === 'add' && !this.authority.state.rules.doodle) return;
    const change = this.doodles.apply(op, author, moderator);
    if (change) this.doodleChanged(change);
  }

  private doodleChanged(change: DoodleChange): void {
    this.broadcast({ t: 'doodle', change });
    this.emitView();
  }

  private onAuthority(e: AuthorityEvent): void {
    switch (e.kind) {
      case 'events':
        this.broadcast({ t: 'update', state: e.after, events: e.events });
        this.emitter.emit({ kind: 'events', events: e.events, before: e.before, after: e.after });
        break;
      case 'busy':
        this.broadcast({ t: 'busy', busy: e.busy, gmName: this.authority.gm.name });
        break;
      case 'notice': {
        if (e.to === 'all') {
          this.broadcast({ t: 'notice', text: e.text, tone: e.tone });
          this.emitter.emit({ kind: 'notice', text: e.text, tone: e.tone });
        } else if (e.to === this.hostColor || e.to === 'any') {
          this.emitter.emit({ kind: 'notice', text: e.text, tone: e.tone });
        } else {
          const player = this.members.find((m) => m.role === e.to);
          if (player) this.sendTo(player, { t: 'notice', text: e.text, tone: e.tone });
        }
        break;
      }
      case 'reset':
        this.broadcast({ t: 'sync', state: e.state });
        break;
      case 'phase':
        if (e.phase === 'playing') this.doodleChanged(this.doodles.clearAll());
        this.broadcast({ t: 'room', room: this.room() });
        break;
      case 'timer':
        this.timer = e.timer && { ...e.timer, at: Date.now() };
        this.broadcast({ t: 'timer', timer: e.timer });
        break;
    }
    this.emitView();
  }
}
