import { applyCommand, createInitialState, type Color, type Command, type GameEvent, type GameState } from '../engine';
import type { GameMaster } from '../gm/types';
import { parseGmRuling } from '../gm/parse';
import { GmError } from '../gm/errors';
import { REJECT_MESSAGE } from '../ui/messages';
import type { NoticeTone, Request } from './types';

export type AuthorityEvent =
  | { kind: 'events'; events: GameEvent[]; before: GameState; after: GameState }
  | { kind: 'busy'; busy: boolean }
  /** `to` is the color whose player should see it ('any' in hotseat). */
  | { kind: 'notice'; to: Color | 'any'; text: string; tone: NoticeTone }
  | { kind: 'reset'; state: GameState };

/**
 * The one place game state changes, for hotseat and for the online host.
 * It checks whose turn it is, rolls the dice, and calls the GM; players only send requests.
 */
export class Authority {
  state: GameState;
  busy = false;

  constructor(
    public gm: GameMaster,
    private readonly roll: () => number,
    private readonly emit: (e: AuthorityEvent) => void,
    initial: GameState = createInitialState(),
  ) {
    this.state = initial;
  }

  reset(): void {
    this.state = createInitialState(this.state.rules);
    this.emit({ kind: 'reset', state: this.state });
  }

  /** `actor` is the requesting player's color; 'any' means hotseat (acts for whoever's turn it is). */
  async handle(req: Request, actor: Color | 'any'): Promise<void> {
    const notice = (text: string, tone: NoticeTone = 'error') => this.emit({ kind: 'notice', to: actor, text, tone });
    if (this.busy) return notice('GM이 판정 중입니다. 잠시 기다려 주세요.', 'warn');
    if (actor !== 'any' && actor !== this.state.turn && this.state.status.kind === 'playing') {
      return notice('상대의 차례입니다.', 'warn');
    }

    switch (req.type) {
      case 'move':
        this.apply(
          req.promotion ? { type: 'move', from: req.from, to: req.to, promotion: req.promotion } : { type: 'move', from: req.from, to: req.to },
          actor,
        );
        return;
      case 'endTurn':
        this.apply({ type: 'endTurn' }, actor);
        return;
      case 'cancel':
        this.apply({ type: 'cancelSpecial' }, actor);
        return;
      case 'attempt':
        this.apply({ type: 'attemptSpecial', roll: this.roll() }, actor);
        return;
      case 'declare':
        return this.declare(req.action, actor);
    }
  }

  private apply(cmd: Command, actor: Color | 'any'): boolean {
    const before = this.state;
    const result = applyCommand(before, cmd);
    if (!result.ok) {
      this.emit({
        kind: 'notice',
        to: actor,
        text: REJECT_MESSAGE[result.reason] + (result.detail ? ` (${result.detail})` : ''),
        tone: 'error',
      });
      return false;
    }
    this.state = result.state;
    this.emit({ kind: 'events', events: result.events, before, after: result.state });
    return true;
  }

  private async declare(action: string, actor: Color | 'any'): Promise<void> {
    const notice = (text: string) => this.emit({ kind: 'notice', to: actor, text, tone: 'error' });
    const trimmed = action.trim();
    const s = this.state;
    // Cheap checks first, so a doomed declaration never costs a GM call.
    if (s.status.kind !== 'playing') return notice(REJECT_MESSAGE.gameOver);
    if (s.pending) return notice(REJECT_MESSAGE.actionPending);
    if (!trimmed) return notice(REJECT_MESSAGE.emptyAction);
    if (trimmed.length > s.rules.actionMaxLength) return notice(REJECT_MESSAGE.actionTooLong);

    this.busy = true;
    this.emit({ kind: 'busy', busy: true });
    try {
      const raw = await this.gm.rule({ action: trimmed, state: s });
      const parsed = parseGmRuling(raw);
      if (!parsed.ok) {
        notice(`GM 응답 형식이 올바르지 않습니다 (${parsed.error}). AP는 쓰지 않았습니다. 다시 시도해 주세요.`);
        return;
      }
      this.busy = false;
      this.apply({ type: 'proposeSpecial', action: trimmed, ruling: parsed.ruling }, actor);
    } catch (err) {
      const reason = err instanceof GmError ? err.message : `GM 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      notice(`${reason} (AP는 쓰지 않았습니다. 다시 보낼 수 있습니다.)`);
    } finally {
      if (this.busy) this.busy = false;
      this.emit({ kind: 'busy', busy: false });
    }
  }
}
