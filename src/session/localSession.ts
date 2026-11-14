import { rollD20 } from '../dice';
import type { GameMaster } from '../gm/types';
import { Authority, type AuthorityEvent } from './authority';
import { Emitter } from './emitter';
import type { Request, Session, SessionView } from './types';

/** Hotseat: both players share this screen; the authority runs right here. */
export class LocalSession implements Session {
  private readonly emitter = new Emitter();
  private readonly authority: Authority;

  constructor(gm: GameMaster, roll: () => number = rollD20) {
    this.authority = new Authority(gm, roll, (e) => this.onAuthority(e));
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
