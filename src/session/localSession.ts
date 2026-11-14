import { rollD20 } from '../dice';
import type { GameState } from '../engine';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent } from './authority';
import { Emitter } from './emitter';
import { cleanChat, type Request, type Session, type SessionView } from './types';

/** Hotseat: both players share this screen; the authority runs right here. */
export class LocalSession implements Session {
  private readonly emitter = new Emitter();
  private readonly authority: Authority;

  constructor(gm: GameMaster, roll: () => number = rollD20, initialState?: GameState) {
    this.authority = new Authority(gm, roll, (e) => this.onAuthority(e), initialState);
  }

  view(): SessionView {
    return {
      state: this.authority.state,
      seat: 'both',
      gmBusy: this.authority.busy,
      gmName: this.authority.gm.name,
      connection: { kind: 'local' },
      isAuthority: true,
    };
  }

  subscribe = (listener: Parameters<Emitter['subscribe']>[0]) => this.emitter.subscribe(listener);

  request(req: Request): void {
    void this.authority.handle(req, 'any');
  }

  sendChat(text: string): void {
    const clean = cleanChat(text);
    // Hotseat: whoever is to move is the one typing.
    if (clean) this.emitter.emit({ kind: 'chat', from: this.authority.state.turn, text: clean, mine: true });
  }

  setGm(gm: GameMaster): void {
    this.authority.gm = gm;
    this.emitter.emit({ kind: 'view', view: this.view() });
  }

  restart(): void {
    this.authority.reset();
  }

  dispose(): void {}

  private onAuthority(e: AuthorityEvent): void {
    if (e.kind === 'events') this.emitter.emit({ kind: 'events', events: e.events, before: e.before, after: e.after });
    if (e.kind === 'notice') this.emitter.emit({ kind: 'notice', text: e.text, tone: e.tone });
    this.emitter.emit({ kind: 'view', view: this.view() });
  }
}
