import type { AiSeat, Color, GameState, RuleConfig } from '../engine';
import { rollDie } from '../dice';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent, type FallSimulator } from './authority';
import type { Channel } from './channel';
import { Emitter } from './emitter';
import type { SavedSeats } from './storage';
import { playersOf } from '../engine';
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
  type WatchSpeed,
} from './types';

export interface HostOptions {
  code: string;
  link: string;
  /** Resume a saved game instead of starting fresh (skips the waiting room). */
  initialState?: GameState;
  /** Resume: who sat where, so everyone gets their seat back (guests when they return). */
  seats?: SavedSeats;
  hostName?: string;
  roll?: () => number;
  chance?: () => number;
  /** Plays falls with physics (see Authority). */
  fall?: FallSimulator;
  /** AI players' pace (see Authority; tests: 0). */
  aiPace?: number;
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
const SEAT_NAME: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };

/**
 * Online host: runs the authority (state, dice, GM calls with the host's own key) and mirrors
 * every change to everyone in the room. Everyone, the host too, comes in on the waiting bench
 * (role 'spectator') and picks an empty seat themselves: white, black, and red on the 3-player
 * board. Nothing secret is ever sent: no API key, and no member's reconnect id.
 */
export class HostSession implements Session {
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
    this.authority = new Authority(gm, options.roll ?? rollDie, (e) => this.onAuthority(e), {
      initial: options.initialState,
      phase: resumed ? 'playing' : 'waiting',
      chance: options.chance,
      fall: options.fall,
      aiPace: options.aiPace,
    });
    const t = this.authority.timer();
    this.timer = t && { ...t, at: Date.now() };
    this.connection = { kind: 'hosting', code: options.code, link: options.link };
    // A saved game puts everyone back in their seat (an old save: the host was white).
    const hostRole: Role = resumed ? options.seats?.host ?? 'white' : 'spectator';
    this.members = [{ key: HOST_KEY, id: null, channel: null, name: cleanName(options.hostName) || '방장', role: hostRole, online: true, host: true }];
    for (const g of options.seats?.guests ?? []) {
      if (g.role === hostRole) continue;
      this.members.push({ key: this.newKey(), id: g.id, channel: null, name: cleanName(g.name) || SEAT_NAME[g.role], role: g.role, online: false, host: false });
    }
  }

  /** Where the host sits (the bench is 'spectator'). */
  private get hostRole(): Role {
    return this.members[0].role;
  }

  view(): SessionView {
    return {
      state: this.authority.state,
      seat: this.hostRole,
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
      watch: this.authority.watch,
      drawOffer: this.authority.drawOffer,
      undoable: false,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  /** Who sits where, for saving the game (with the guests' reconnect ids, which stay on this machine). */
  seats(): SavedSeats {
    const guests = this.members
      .filter((m) => !m.host && m.id && m.role !== 'spectator')
      .map((m) => ({ role: m.role as Color, id: m.id!, name: m.name }));
    return { host: this.hostRole, guests };
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
        case 'seat':
          return this.seat(member, msg.role);
        case 'doodle':
          return this.applyDoodle(msg.op, member.key, false);
        case 'toy':
          // A look or a sheet speaks for a side: only the one sitting there may send it (no words in another's name).
          if ((msg.op.op === 'gaze' || msg.op.op === 'write' || msg.op.op === 'toss') && msg.op.id !== member.role) return;
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
      // Newcomers wait on the bench and choose a seat themselves.
      member = {
        key: this.newKey(),
        id: id ?? null,
        channel,
        name: name || `손님 ${this.nextKey - 1}`,
        role: 'spectator',
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
    const text = returning ? `${member.name}님이 다시 들어왔습니다.` : `${member.name}님이 들어왔습니다.`;
    this.emitter.emit({ kind: 'notice', text, tone: 'normal' });
    this.broadcast({ t: 'notice', text, tone: 'normal' }, member);
  }

  request(req: Request): void {
    const role = this.hostRole;
    if (role === 'spectator') return this.emitter.emit({ kind: 'notice', text: '관전자는 수를 둘 수 없습니다.', tone: 'warn' });
    void this.authority.handle(req, role);
  }

  takeSeat(role: Role): void {
    this.seat(this.members[0], role);
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

  setBrains(brains: Partial<Record<Color, GameMaster>>): void {
    this.authority.brains = brains;
  }

  setGm(gm: GameMaster): void {
    this.authority.gm = gm;
    this.broadcast({ t: 'busy', busy: this.authority.busy, gmName: gm.name });
    this.emitView();
  }

  setRules(rules: Partial<RuleConfig>): void {
    this.authority.setRules(cleanRules(this.authority.state.rules, rules));
    // A seat the new board does not have (red, off the hexagon): back to the bench.
    const seats = playersOf(this.authority.state.rules.map);
    let moved = false;
    for (const m of this.members) {
      if (m.role !== 'spectator' && !seats.includes(m.role)) {
        m.role = 'spectator';
        moved = true;
      }
    }
    if (moved) this.roomChanged();
  }

  /**
   * `member` sits in `role` (or stands up to the bench): only in the waiting room, only an empty
   * seat the board has. Anyone may move straight from one seat to another.
   */
  private seat(member: Seat, role: Role): void {
    const tell = (text: string) =>
      member.host ? this.emitter.emit({ kind: 'notice', text, tone: 'warn' }) : this.sendTo(member, { t: 'notice', text, tone: 'warn' });
    if (member.role === role) return;
    if (this.authority.phase !== 'waiting') return tell('게임 중에는 자리를 바꿀 수 없습니다.');
    if (role !== 'spectator') {
      if (!playersOf(this.authority.state.rules.map).includes(role)) return;
      const holder = this.members.find((m) => m.role === role);
      if (holder) return tell(`${SEAT_NAME[role]} 자리에는 이미 ${holder.name}님이 앉아 있습니다.`);
      if (this.authority.state.rules.ai?.[role as 'white']) return tell(`${SEAT_NAME[role]} 자리에는 AI가 앉아 있습니다.`);
    }
    member.role = role;
    this.roomChanged();
    const text = role === 'spectator' ? `${member.name}님이 대기석으로 갔습니다.` : `${member.name}님이 ${SEAT_NAME[role]} 자리에 앉았습니다.`;
    this.emitter.emit({ kind: 'notice', text, tone: 'normal' });
    this.broadcast({ t: 'notice', text, tone: 'normal' });
  }

  /** Needs someone in every seat of the board (white, black, and red on the 3-player board) who is here. */
  start(): void {
    const ai = this.authority.state.rules.ai ?? {};
    const empty = playersOf(this.authority.state.rules.map).find((s) => !ai[s as 'white'] && !this.members.some((m) => m.role === s && m.online));
    if (empty) {
      this.emitter.emit({ kind: 'notice', text: `${SEAT_NAME[empty]} 자리에 앉은 사람이 있어야 시작할 수 있습니다.`, tone: 'warn' });
      return;
    }
    this.authority.start();
  }

  restart(): void {
    this.authority.reset();
  }

  /** An AI sits in a free seat (or leaves it): waiting room only. */
  setAi(color: Color, seat: AiSeat | null): void {
    if (this.authority.phase !== 'waiting') return;
    if (seat) {
      const holder = this.members.find((m) => m.role === color);
      if (holder) {
        this.emitter.emit({ kind: 'notice', text: `${SEAT_NAME[color]} 자리에는 ${holder.name}님이 앉아 있습니다.`, tone: 'warn' });
        return;
      }
    }
    this.setRules({ ai: { ...this.authority.state.rules.ai, [color]: seat ?? undefined } });
  }

  setWatch(change: { paused?: boolean; speed?: WatchSpeed }): void {
    this.authority.setWatch(change);
  }

  rematch(): void {
    this.authority.rematch();
  }

  /** Online there is no taking back: the other side has seen the move. */
  undo(): void {}

  /** The host sends a guest from their seat back to the bench (only that: guests choose seats themselves). */
  assignRole(key: string, role: Role): void {
    const target = this.members.find((m) => m.key === key && !m.host);
    if (!target || role !== 'spectator' || target.role === 'spectator' || this.authority.phase !== 'waiting') return;
    target.role = 'spectator';
    this.roomChanged();
    const text = `방장이 ${target.name}님을 대기석으로 옮겼습니다.`;
    this.emitter.emit({ kind: 'notice', text, tone: 'normal' });
    this.broadcast({ t: 'notice', text, tone: 'normal' });
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
    return { phase: this.authority.phase as Phase, members: this.publicMembers(), watch: this.authority.watch, draw: this.authority.drawOffer };
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
        } else if (e.to === this.hostRole || e.to === 'any') {
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
      case 'watch':
      case 'draw':
        this.broadcast({ t: 'room', room: this.room() });
        break;
    }
    this.emitView();
  }
}
