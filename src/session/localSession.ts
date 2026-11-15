import { rollD20 } from '../dice';
import type { GameState, RuleConfig } from '../engine';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent } from './authority';
import { Emitter } from './emitter';
import { DoodleStore, type DoodleOp } from './doodle';
import { cleanChat, cleanRules, pushChat, type ChatMessage, type Member, type Phase, type Request, type Role, type Session, type SessionView, type TurnTimer } from './types';

const LOCAL_KEY = 'local';

export interface LocalOptions {
  roll?: () => number;
  initialState?: GameState;
  /** A resumed game skips the waiting room. */
  phase?: Phase;
  chance?: () => number;
}

/** Hotseat: both players share this screen; the authority runs right here. */
export class LocalSession implements Session {
  private readonly emitter = new Emitter();
  private readonly authority: Authority;
  private chat: ChatMessage[] = [];
  private nextChatId = 1;
  private readonly doodles = new DoodleStore();
  private timer: TurnTimer | null = null;

  constructor(gm: GameMaster, options: LocalOptions = {}) {
    this.authority = new Authority(gm, options.roll ?? rollD20, (e) => this.onAuthority(e), {
      initial: options.initialState,
      phase: options.phase ?? 'waiting',
      chance: options.chance,
    });
    const t = this.authority.timer();
    this.timer = t && { ...t, at: Date.now() };
  }

  view(): SessionView {
    const members: Member[] = [
      { key: 'white', name: '이 기기', role: 'white', online: true, host: true },
      { key: 'black', name: '이 기기', role: 'black', online: true, host: false },
    ];
    return {
      state: this.authority.state,
      seat: 'both',
      gmBusy: this.authority.busy,
      gmName: this.authority.gm.name,
      connection: { kind: 'local' },
      isAuthority: true,
      phase: this.authority.phase,
      members,
      myKey: LOCAL_KEY,
      timer: this.timer,
      chat: this.chat,
      doodles: this.doodles.doodles,
      chaosReady: !!this.authority.gm.chaos,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  request(req: Request): void {
    void this.authority.handle(req, 'any');
  }

  sendChat(text: string): void {
    const clean = cleanChat(text);
    if (!clean) return;
    // Hotseat: whoever is to move is the one typing.
    const side = this.authority.state.turn;
    const message: ChatMessage = { id: this.nextChatId++, author: side, name: side === 'white' ? '백' : '흑', role: side, text: clean };
    this.chat = pushChat(this.chat, message);
    this.emitter.emit({ kind: 'chat', message, mine: true });
    this.emitView();
  }

  setName(): void {}

  doodle(op: DoodleOp): void {
    if (!this.authority.state.rules.doodle && op.op === 'add') return;
    if (this.doodles.apply(op, LOCAL_KEY, true)) this.emitView();
  }

  setGm(gm: GameMaster): void {
    this.authority.gm = gm;
    this.emitView();
  }

  setRules(rules: Partial<RuleConfig>): void {
    this.authority.setRules(cleanRules(this.authority.state.rules, rules));
  }

  start(): void {
    this.authority.start();
  }

  restart(): void {
    this.authority.reset();
  }

  assignRole(_key: string, _role: Role): void {}

  dispose(): void {
    this.authority.dispose();
  }

  private emitView(): void {
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  private onAuthority(e: AuthorityEvent): void {
    if (e.kind === 'events') this.emitter.emit({ kind: 'events', events: e.events, before: e.before, after: e.after });
    if (e.kind === 'notice') this.emitter.emit({ kind: 'notice', text: e.text, tone: e.tone });
    if (e.kind === 'timer') this.timer = e.timer && { ...e.timer, at: Date.now() };
    if (e.kind === 'phase' && e.phase === 'playing') this.doodles.clearAll();
    this.emitView();
  }
}
