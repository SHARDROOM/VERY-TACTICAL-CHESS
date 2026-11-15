import { applyCommand, buildTimeline, createInitialState, effectiveStaging, type Color, type Command, type Effect, type GameEvent, type GameState, type RuleConfig, type Staging } from '../engine';
import type { GameMaster } from '../gm/types';
import { parseGmChaos, parseGmRuling } from '../gm/parse';
import { pickSparks } from '../gm/prompt';
import { GmError } from '../gm/errors';
import { REJECT_MESSAGE } from '../ui/messages';
import type { NoticeTone, Phase, Request, TimerSnapshot } from './types';

export type AuthorityEvent =
  | { kind: 'events'; events: GameEvent[]; before: GameState; after: GameState }
  | { kind: 'busy'; busy: boolean }
  /** `to`: the player of that color, 'any' (hotseat: whoever acted), or 'all' (everyone, spectators too). */
  | { kind: 'notice'; to: Color | 'any' | 'all'; text: string; tone: NoticeTone }
  /** A fresh state replaced the old one (new game, back to the waiting room, rules changed). */
  | { kind: 'reset'; state: GameState }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'timer'; timer: TimerSnapshot | null };

export interface AuthorityOptions {
  initial?: GameState;
  /** A resumed game goes straight to 'playing'; a new room starts in the waiting room. */
  phase?: Phase;
  /** Chaos dice (0..1). */
  chance?: () => number;
  now?: () => number;
}

/** Extra time after an attempt, for the dice to roll on screen. */
export const DICE_GRACE_MS = 4000;

/** How long a staged show takes on screen, in ms (the clock does not run during it). */
export function showMs(staging: Staging | undefined, effects: Effect[]): number {
  return Math.round(buildTimeline(effectiveStaging(staging, effects), effects).length * 1000);
}

/**
 * The one place game state changes, for hotseat and for the online host.
 * It checks whose turn it is, rolls the dice, calls the GM, runs the turn clock and
 * sets off chaos; players only send requests.
 */
export class Authority {
  state: GameState;
  busy = false;
  phase: Phase;
  private readonly chance: () => number;
  private readonly now: () => number;
  /** Bumped whenever the state is replaced, so late GM answers for an old game are dropped. */
  private generation = 0;
  private clock = { remaining: 0, startedAt: null as number | null, handle: null as ReturnType<typeof setTimeout> | null };

  constructor(
    public gm: GameMaster,
    private readonly roll: () => number,
    private readonly emit: (e: AuthorityEvent) => void,
    options: AuthorityOptions = {},
  ) {
    this.state = options.initial ?? createInitialState();
    this.phase = options.phase ?? 'waiting';
    this.chance = options.chance ?? Math.random;
    this.now = options.now ?? Date.now;
    if (this.phase === 'playing') this.restartClock(false);
  }

  // ---- room ----------------------------------------------------------------

  /** Waiting room only: the rules for the next game. */
  setRules(rules: RuleConfig): void {
    if (this.phase !== 'waiting') return;
    this.replace(createInitialState(rules));
  }

  start(): void {
    if (this.phase !== 'waiting') return;
    this.replace(createInitialState(this.state.rules));
    this.phase = 'playing';
    this.emit({ kind: 'phase', phase: 'playing' });
    this.restartClock();
  }

  /** Back to the waiting room with a fresh board and the same rules. */
  reset(): void {
    this.phase = 'waiting';
    this.replace(createInitialState(this.state.rules));
    this.emit({ kind: 'phase', phase: 'waiting' });
    this.restartClock();
  }

  dispose(): void {
    this.stopHandle();
    this.generation++;
  }

  private replace(state: GameState): void {
    this.generation++;
    this.busy = false;
    this.state = state;
    this.emit({ kind: 'reset', state });
  }

  // ---- requests --------------------------------------------------------------

  /** `actor` is the requesting player's color; 'any' means hotseat (acts for whoever's turn it is). */
  async handle(req: Request, actor: Color | 'any'): Promise<void> {
    const notice = (text: string, tone: NoticeTone = 'error') => this.emit({ kind: 'notice', to: actor, text, tone });
    if (this.phase !== 'playing') return notice('게임이 아직 시작되지 않았습니다.', 'warn');
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

  private apply(cmd: Command, actor: Color | 'any' | 'all'): boolean {
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
    this.afterChange(result.events);
    return true;
  }

  /** Keeps the clock in step with the game and sets off chaos when a turn begins. */
  private afterChange(events: GameEvent[]): void {
    if (this.state.status.kind !== 'playing') return this.restartClock();
    if (events.some((e) => e.type === 'turnPassed')) {
      this.restartClock();
      this.maybeChaos();
    } else {
      const resolved = events.find((e) => e.type === 'specialResolved');
      // The roll and the show that follows it do not eat the player's time.
      if (resolved) this.addTime(DICE_GRACE_MS + showMs(resolved.staging, resolved.effects));
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.emit({ kind: 'busy', busy });
    if (busy) this.pauseClock();
    else this.resumeClock();
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

    const generation = this.generation;
    this.setBusy(true);
    try {
      // A ruling the rules turn down (nobody acting, a touch out of reach...) goes back to the
      // GM once, with the reason; the second answer stands or falls.
      let problem: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await this.gm.rule({ action: trimmed, state: s, problem });
        if (generation !== this.generation) return;
        const parsed = parseGmRuling(raw);
        if (!parsed.ok) {
          problem = `응답 형식 오류: ${parsed.error}`;
          if (attempt === 0) continue;
          notice(`GM 응답 형식이 올바르지 않습니다 (${parsed.error}). AP는 쓰지 않았습니다. 다시 시도해 주세요.`);
          return;
        }
        const command = { type: 'proposeSpecial' as const, action: trimmed, ruling: parsed.ruling };
        const dry = applyCommand(this.state, command);
        if (!dry.ok && dry.reason === 'invalidRuling' && attempt === 0) {
          problem = dry.detail ?? REJECT_MESSAGE.invalidRuling;
          continue;
        }
        this.busy = false;
        this.apply(command, actor);
        return;
      }
    } catch (err) {
      if (generation !== this.generation) return;
      const reason = err instanceof GmError ? err.message : `GM 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      notice(`${reason} (AP는 쓰지 않았습니다. 다시 보낼 수 있습니다.)`);
    } finally {
      if (generation === this.generation) this.setBusy(false);
    }
  }

  // ---- chaos -------------------------------------------------------------------

  private maybeChaos(): void {
    const chance = this.state.rules.chaosChance;
    if (!(chance > 0) || !this.gm.chaos || this.state.status.kind !== 'playing') return;
    if (this.chance() >= chance) return;
    void this.runChaos();
  }

  private async runChaos(): Promise<void> {
    const generation = this.generation;
    const turnNumber = this.state.turnNumber;
    this.setBusy(true);
    const skip = (why: string) => this.emit({ kind: 'notice', to: 'all', text: `🌪 혼돈이 일어나려다 잠잠해졌습니다. (${why})`, tone: 'warn' });
    try {
      const inspiration = pickSparks(Math.random);
      // If the first idea breaks a rule, the GM hears why and gets one more go.
      let problem: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await this.gm.chaos!({ state: this.state, inspiration, problem });
        if (generation !== this.generation || turnNumber !== this.state.turnNumber) return;
        const parsed = parseGmChaos(raw);
        if (!parsed.ok) {
          problem = `응답 형식 오류: ${parsed.error}`;
          continue;
        }
        if (!parsed.chaos.effects.length) return;
        const result = applyCommand(this.state, { type: 'chaos', chaos: parsed.chaos });
        if (!result.ok) {
          problem = result.detail ?? REJECT_MESSAGE[result.reason];
          continue;
        }
        const before = this.state;
        this.state = result.state;
        this.emit({ kind: 'events', events: result.events, before, after: result.state });
        // The clock restarts when the GM is done (setBusy below); the show is extra.
        this.addTime(showMs(parsed.chaos.staging, parsed.chaos.effects));
        return;
      }
      skip(problem ?? '규칙에 맞지 않음');
    } catch (err) {
      if (generation !== this.generation) return;
      skip(err instanceof GmError ? err.message : 'GM 호출 실패');
    } finally {
      if (generation === this.generation) this.setBusy(false);
    }
  }

  // ---- turn clock ----------------------------------------------------------------

  private limitMs(): number {
    return Math.max(0, this.state.rules.turnSeconds) * 1000;
  }

  private clockActive(): boolean {
    return this.phase === 'playing' && this.state.status.kind === 'playing' && this.limitMs() > 0;
  }

  timer(): TimerSnapshot | null {
    if (!this.clockActive()) return null;
    const c = this.clock;
    const running = c.startedAt !== null;
    const remaining = running ? c.remaining - (this.now() - c.startedAt!) : c.remaining;
    return { limitMs: this.limitMs(), remainingMs: Math.max(0, remaining), running };
  }

  private emitTimer(): void {
    this.emit({ kind: 'timer', timer: this.timer() });
  }

  private stopHandle(): void {
    if (this.clock.handle) clearTimeout(this.clock.handle);
    this.clock.handle = null;
  }

  /** A full clock for the turn that is starting (or no clock at all). */
  private restartClock(emit = true): void {
    this.stopHandle();
    this.clock.startedAt = null;
    this.clock.remaining = this.limitMs();
    if (this.clockActive()) this.resumeClock(false);
    if (emit) this.emitTimer();
  }

  private pauseClock(): void {
    const c = this.clock;
    if (c.startedAt === null) return;
    this.stopHandle();
    c.remaining -= this.now() - c.startedAt;
    c.startedAt = null;
    this.emitTimer();
  }

  private resumeClock(emit = true): void {
    const c = this.clock;
    if (!this.clockActive() || this.busy || c.startedAt !== null) return;
    c.startedAt = this.now();
    c.handle = setTimeout(() => this.expire(), Math.max(0, c.remaining));
    if (emit) this.emitTimer();
  }

  private addTime(ms: number): void {
    if (!this.clockActive()) return;
    const running = this.clock.startedAt !== null;
    this.pauseClock();
    this.clock.remaining += ms;
    if (running) this.resumeClock();
    else this.emitTimer();
  }

  private expire(): void {
    this.clock.handle = null;
    this.clock.startedAt = null;
    this.clock.remaining = 0;
    if (!this.clockActive() || this.busy) return;
    this.apply({ type: 'timeout' }, 'all');
  }
}
