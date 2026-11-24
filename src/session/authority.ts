import { AI_LEVEL_NAME, CLASH_ROLLS, aiExile, aiHints, aiMaxDc, cleanAiSeats, isAiOnly, isAir, playersOf, promotesOn, stackOf, standing, type AiSeat, applyCommand, impulseOf, impulseKindOf, impulseTargets, isStunned as isStunnedPiece, vanguardOrder, wanderTargets, duelSeconds, buildTimeline, createInitialState, effectiveStaging, type Color, type Command, type Effect, type FallingPiece, type GameEvent, type GameState, type Landing, type RuleConfig, type Staging, type TerrainCell } from '../engine';
import type { GameMaster } from '../gm/types';
import { parseGmChaos, parseGmRuling } from '../gm/parse';
import { pickSparks } from '../gm/prompt';
import { GmError, isTransient } from '../gm/errors';
import { COLOR_NAME, REJECT_MESSAGE } from '../ui/messages';
import { AI_RETRIES, RETRY_REASON, withRetries } from './retry';
import { parsePlayerAction } from '../gm/player';
import { chooseMoveAsync, shouldRollAsync } from './aiCompute';
import { WATCH_DEFAULT, WATCH_SPEEDS, type DrawOffer, type Entrant, type NoticeTone, type Phase, type Request, type TimerSnapshot, type WatchSpeed, type WatchState } from './types';

export type AuthorityEvent =
  | { kind: 'events'; events: GameEvent[]; before: GameState; after: GameState }
  | { kind: 'busy'; busy: boolean }
  /** `to`: the player of that color, 'any' (hotseat: whoever acted), or 'all' (everyone, spectators too). */
  | { kind: 'notice'; to: Color | 'any' | 'all'; text: string; tone: NoticeTone }
  /** A fresh state replaced the old one (new game, back to the waiting room, rules changed). */
  | { kind: 'reset'; state: GameState }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'timer'; timer: TimerSnapshot | null }
  /** A watched game (only AIs play): paused, speed, score, a new round. */
  | { kind: 'watch'; watch: WatchState }
  /** A draw offered, answered, or gone (판 끝내기). */
  | { kind: 'draw'; offer: DrawOffer | null };

/** What a fall simulation needs: the board as it is, the falling pieces, and the seed every screen replays it with. */
export interface FallQuery {
  board: GameState['board'];
  terrain: readonly TerrainCell[];
  falling: readonly FallingPiece[];
  seed: number;
}

/** Where falling pieces come to rest (the physics); missing ones drop straight down. */
export type FallSimulator = (query: FallQuery) => Promise<Landing[]>;

export interface AuthorityOptions {
  initial?: GameState;
  /** A resumed game goes straight to 'playing'; a new room starts in the waiting room. */
  phase?: Phase;
  /** Chaos dice (0..1). */
  chance?: () => number;
  now?: () => number;
  /** Plays falls with physics; without it, falling pieces drop straight down. */
  fall?: FallSimulator;
  /** Seeds for fall simulations. */
  seed?: () => number;
  /** How long AI players wait before acting, as a share of the screen's show (tests: 0). Default 1. */
  aiPace?: number;
}

/** An AI player waits at least this long before it acts (its "thinking" is seen). */
const AI_MIN_MS = 900;
/** Watching AIs: the pause after a show, slow and fast. */
const AI_SLOW_MS = 2400;
const AI_FAST_MS = 120;
/** An AI's declaration found impossible (or not ruled within the rules) is written anew this many more times. */
const AI_REWRITES = 2;
/**
 * The most an AI spends on one turn's special action, model calls, waits and rewrites together
 * (사용자 요청: answers came slowly; a busy model could hold a turn for minutes). Then it plays chess.
 */
const AI_SPECIAL_BUDGET_MS = 45_000;
/** A model found busy or out of reach: the AI leaves special actions alone for this many of its turns. */
const AI_BUSY_REST_TURNS = 2;
/** How long one try may take: the AI writing a sentence, the GM ruling on it (a long reply). Shortened (사용자 요청). */
const AI_COMPOSE_TIMEOUT_MS = 20_000;
const AI_RULING_TIMEOUT_MS = 60_000;

/** The most moves kept for taking back (무르기). */
const UNDO_MAX = 40;

/** How long a fall plays on screen; the clock does not run during it. */
export const FALL_SHOW_MS = 3200;

/** Extra time after an attempt, for the dice to roll on screen. */
export const DICE_GRACE_MS = 5000;
/** A clash's two dice, thrown one after the other, and a moment to read both scores. */
export const CLASH_DICE_GRACE_MS = 8500;

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
  private readonly fall?: FallSimulator;
  private readonly seed: () => number;
  /** A fall is being simulated: its `land` comes next. */
  private landing = false;
  /** Bumped whenever the state is replaced, so late GM answers for an old game are dropped. */
  private generation = 0;
  private clock = { remaining: 0, startedAt: null as number | null, handle: null as ReturnType<typeof setTimeout> | null };
  private readonly aiPace: number;
  /** An AI player's next look at the game is scheduled. */
  private aiHandle: ReturnType<typeof setTimeout> | null = null;
  /** An AI player is acting (thinking, asking the GM). */
  private aiActing = false;
  /** When the screens will have shown what has happened so far (ms, this.now()). */
  private aiReadyAt = 0;
  /** The turn an AI last tried a special action on (once a turn). */
  private aiTried = -1;
  /** After an AI lets its own ruling go: no special action again until this turn number (per color). */
  private aiRestUntil: Partial<Record<Color, number>> = {};
  /** The declaration it last let go (never declared again right away). */
  private aiDropped: Partial<Record<Color, string>> = {};
  /** A game only AIs play: paused or not, how fast, the score of the series (docs/SPEC.md, "AI 관전"). */
  watch: WatchState = WATCH_DEFAULT;
  /** AI seats with a model of their own for their special actions (AI의 두뇌); the others use the GM's. */
  private brainsNow: Partial<Record<Color, GameMaster>> = {};
  /** A draw offered and not yet answered by everyone; it goes when the turn passes (판 끝내기). */
  drawOffer: DrawOffer | null = null;
  /**
   * 무르기 (사용자 요청): the game as it was before each move made on this screen, newest last.
   * Dice (a special action rolled, a clash) or a chaos event empty it: nothing goes back past them.
   */
  private undoStack: GameState[] = [];
  /** The last change applied had dice or chaos in it. */
  private barrier = false;
  private gmNow!: GameMaster;

  /**
   * The GM; one that goes on to a backup (예비 GM) tells everyone through the log, and (while it
   * rules) the busy badge names the one asked now.
   */
  get gm(): GameMaster {
    return this.gmNow;
  }
  set gm(gm: GameMaster) {
    this.gmNow = gm;
    gm.onNotice = (text) => {
      this.emit({ kind: 'notice', to: 'all', text, tone: 'warn' });
      if (this.busy) this.emit({ kind: 'busy', busy: true });
    };
  }
  get brains(): Partial<Record<Color, GameMaster>> {
    return this.brainsNow;
  }
  set brains(brains: Partial<Record<Color, GameMaster>>) {
    this.brainsNow = brains;
    for (const [c, gm] of Object.entries(brains)) if (gm) gm.onNotice = (text) => this.emit({ kind: 'notice', to: 'all', text: `${COLOR_NAME[c as Color]} AI: ${text}`, tone: 'warn' });
  }

  /** Who writes this AI's declarations: its own model, or the GM's. */
  private brainOf(color: Color): GameMaster {
    return this.brains[color] ?? this.gm;
  }

  constructor(
    gm: GameMaster,
    private readonly roll: () => number,
    private readonly emit: (e: AuthorityEvent) => void,
    options: AuthorityOptions = {},
  ) {
    this.gm = gm;
    this.state = options.initial ?? createInitialState();
    this.phase = options.phase ?? 'waiting';
    this.chance = options.chance ?? Math.random;
    this.now = options.now ?? Date.now;
    this.fall = options.fall;
    this.seed = options.seed ?? (() => Math.floor(Math.random() * 2 ** 31));
    this.aiPace = options.aiPace ?? 1;
    // A game saved mid-fall lands first.
    if (this.state.falling?.length) setTimeout(() => void this.land(), 0);
    if (this.phase === 'playing') {
      this.restartClock(false);
      // A saved game whose AI is to move.
      setTimeout(() => this.aiPoke(), 0);
    }
  }

  // ---- room ----------------------------------------------------------------

  /** Waiting room only: the rules for the next game. */
  setRules(rules: RuleConfig): void {
    if (this.phase !== 'waiting') return;
    this.replace(createInitialState(rules, rules.map));
  }

  start(): void {
    if (this.phase !== 'waiting') return;
    this.replace(createInitialState(this.state.rules, this.state.rules.map));
    this.aiForget();
    this.phase = 'playing';
    // Watching AIs: the same lineup carries on its score, a new one starts from nothing; never paused at the start.
    this.setWatchState({ ...this.watch, paused: false, tally: this.tallyNow(), round: this.watch.round + 1 });
    this.emit({ kind: 'phase', phase: 'playing' });
    this.restartClock();
    this.aiPoke();
  }

  /**
   * After a game only AIs played: the next one at once, every AI one seat on (white's plays black,
   * black's white; on the hexagon black's plays red and red's white), the score carried over.
   */
  rematch(): void {
    if (this.phase !== 'playing' || this.state.status.kind === 'playing' || !isAiOnly(this.state)) return;
    const colors = playersOf(this.state.map);
    const next = (c: Color) => colors[(colors.indexOf(c) + 1) % colors.length];
    const ai: NonNullable<RuleConfig['ai']> = {};
    for (const c of colors) ai[next(c) as 'white'] = this.state.rules.ai![c as 'white'];
    const rules = { ...this.state.rules, ai };
    this.replace(createInitialState(rules, rules.map));
    this.aiForget();
    this.setWatchState({ ...this.watch, paused: false, tally: this.watch.tally.map((e) => ({ ...e, color: next(e.color) })), round: this.watch.round + 1 });
    this.restartClock();
    this.aiPoke();
  }

  /**
   * One screen, mid-game: a side passes from its AI to the people at the screen, or the other way.
   * Whatever the AI was thinking is dropped; a game no longer only AIs' is not paused.
   */
  setAiNow(color: Color, seat: AiSeat | null): void {
    if (this.phase !== 'playing' || !playersOf(this.state.map).includes(color)) return;
    const ai = cleanAiSeats({ ...this.state.rules.ai, [color]: seat ?? undefined }, this.state.rules.map);
    this.state = { ...this.state, rules: { ...this.state.rules, ai } };
    this.emit({ kind: 'reset', state: this.state });
    if (this.watch.paused && !isAiOnly(this.state)) this.setWatchState({ ...this.watch, paused: false });
    this.resumeClock();
    this.aiPoke();
  }

  /** Pause a watched game (the move under way finishes), or change how fast its AIs go. */
  setWatch(change: { paused?: boolean; speed?: WatchSpeed }): void {
    const paused = typeof change.paused === 'boolean' ? change.paused : this.watch.paused;
    const speed = WATCH_SPEEDS.includes(change.speed as WatchSpeed) ? (change.speed as WatchSpeed) : this.watch.speed;
    if (paused === this.watch.paused && speed === this.watch.speed) return;
    this.setWatchState({ ...this.watch, paused, speed });
    if (this.aiHandle) clearTimeout(this.aiHandle);
    this.aiHandle = null;
    if (this.paused()) this.pauseClock();
    else this.resumeClock();
    this.aiPoke();
  }

  private setWatchState(watch: WatchState): void {
    this.watch = watch;
    this.emit({ kind: 'watch', watch });
  }

  /** A watched game is paused (pausing means nothing once someone plays). */
  private paused(): boolean {
    return this.watch.paused && this.phase === 'playing' && isAiOnly(this.state);
  }

  /** The AIs of the board, as the scoreboard names them (the same level twice: A, B, ...). */
  private lineup(): Entrant[] {
    if (!isAiOnly(this.state)) return [];
    const colors = playersOf(this.state.map);
    const levels = colors.map((c) => this.state.rules.ai![c as 'white']!.level);
    return colors.map((color, i) => {
      const level = levels[i];
      const twins = levels.filter((l) => l === level).length > 1;
      const nth = levels.slice(0, i).filter((l) => l === level).length;
      return { label: AI_LEVEL_NAME[level] + (twins ? ` ${'ABC'[nth]}` : ''), level, color, wins: 0 };
    });
  }

  /** The score as it stands for the AIs now on the board (a different lineup: a fresh one). */
  private tallyNow(): Entrant[] {
    const lineup = this.lineup();
    const tally = this.watch.tally;
    const same = lineup.length === tally.length && lineup.every((e) => tally.some((t) => t.color === e.color && t.level === e.level));
    return same ? tally : lineup;
  }

  /** A watched game was just won: a point to the AI that won it. */
  private noteResult(before: GameState): void {
    const status = this.state.status;
    if (before.status.kind !== 'playing' || status.kind !== 'won' || !isAiOnly(this.state)) return;
    this.setWatchState({ ...this.watch, tally: this.tallyNow().map((e) => (e.color === status.winner ? { ...e, wins: e.wins + 1 } : e)) });
  }

  /** A new game: what the AIs remembered of the last one goes. */
  private aiForget(): void {
    this.aiTried = -1;
    this.aiRestUntil = {};
    this.aiDropped = {};
    this.aiReadyAt = 0;
  }

  /** Back to the waiting room with a fresh board and the same rules. */
  reset(): void {
    this.phase = 'waiting';
    this.replace(createInitialState(this.state.rules, this.state.rules.map));
    this.emit({ kind: 'phase', phase: 'waiting' });
    this.restartClock();
  }

  dispose(): void {
    this.stopHandle();
    if (this.aiHandle) clearTimeout(this.aiHandle);
    this.aiHandle = null;
    this.generation++;
  }

  /** A move can be taken back now: one screen's own moves, a game people play. */
  canUndo(): boolean {
    return this.phase === 'playing' && !this.busy && this.undoStack.length > 0 && !isAiOnly(this.state);
  }

  /** Back to before the last move made on this screen (whatever the AIs and wanderers did after it goes too). */
  undo(): boolean {
    if (!this.canUndo()) return false;
    // Who plays which side stays as it is now (a side handed to an AI or taken back mid-game).
    const popped = this.undoStack.pop()!;
    const back: GameState = { ...popped, rules: { ...popped.rules, ai: this.state.rules.ai } };
    if (!back.rules.ai) delete back.rules.ai;
    if (this.aiHandle) clearTimeout(this.aiHandle);
    this.aiHandle = null;
    this.aiActing = false;
    this.aiTried = -1;
    this.aiReadyAt = 0;
    this.replace(back, true);
    this.restartClock();
    this.aiPoke();
    return true;
  }

  private replace(state: GameState, keepUndo = false): void {
    if (!keepUndo) this.undoStack = [];
    this.generation++;
    this.busy = false;
    this.state = state;
    this.emit({ kind: 'reset', state });
    this.setDrawOffer(null);
  }

  private setDrawOffer(offer: DrawOffer | null): void {
    if (offer === null && this.drawOffer === null) return;
    this.drawOffer = offer;
    this.emit({ kind: 'draw', offer });
  }

  /** The sides still in this game (any piece of theirs on the board). */
  private inGame(): Color[] {
    return playersOf(this.state.map).filter((c) => this.state.board.some((p) => p && stackOf(p).some((q) => q.color === c)));
  }

  /**
   * Resigning and draws (판 끝내기, 사용자 요청). Online a player speaks for its own side; on one
   * screen, for the side to move (on an AI's turn, the one person's side). People are asked about a
   * draw (online); AIs take one only when they are behind; on one screen pressing it is agreeing.
   */
  private ending(req: Extract<Request, { type: 'resign' | 'offerDraw' | 'answerDraw' }>, actor: Color | 'any', notice: (text: string, tone?: NoticeTone) => void): void {
    if (this.state.status.kind !== 'playing') return notice('이미 끝난 게임입니다.', 'warn');
    const ai = this.state.rules.ai ?? {};
    const inGame = this.inGame();
    const people = inGame.filter((c) => !ai[c as 'white']);
    const me: Color | null = actor !== 'any' ? actor : !ai[this.state.turn as 'white'] ? this.state.turn : people.length === 1 ? people[0] : null;
    if (!me) return notice('AI의 차례가 끝난 뒤 다시 눌러 주세요.', 'warn');
    if (!inGame.includes(me)) return notice('이 게임에서 이미 빠진 편입니다.', 'warn');
    if (req.type === 'resign') {
      this.apply({ type: 'resign', color: me }, actor);
      return;
    }
    if (req.type === 'answerDraw') {
      const offer = this.drawOffer;
      if (!offer || !offer.waiting.includes(me)) return notice('답할 무승부 제안이 없습니다.', 'warn');
      if (!req.accept) {
        this.setDrawOffer(null);
        this.emit({ kind: 'notice', to: 'all', text: `${COLOR_NAME[me]}이 무승부를 거절했습니다.`, tone: 'normal' });
        return;
      }
      const waiting = offer.waiting.filter((c) => c !== me);
      if (waiting.length) return this.setDrawOffer({ ...offer, waiting });
      // The offer goes once the draw is made (apply clears it); a draw that cannot be made yet (a
      // surrender's exile being picked, a piece in mid-fall) leaves it standing to answer again.
      this.apply({ type: 'draw' }, 'all');
      return;
    }
    if (this.drawOffer) return notice('이미 무승부 제안이 있습니다.', 'warn');
    const others = inGame.filter((c) => c !== me);
    // An AI answers at once: it takes a draw only when it is behind (less than an even share).
    const share = standing(this.state);
    const refusing = others.filter((c) => ai[c as 'white'] && (share[c] ?? 0) >= 1 / inGame.length);
    if (refusing.length) {
      return this.emit({ kind: 'notice', to: actor, text: `${refusing.map((c) => COLOR_NAME[c]).join(', ')} AI가 무승부를 거절했습니다(아직 불리하지 않음).`, tone: 'warn' });
    }
    const waiting = actor === 'any' ? [] : others.filter((c) => !ai[c as 'white']);
    if (!waiting.length) {
      this.apply({ type: 'draw' }, actor);
      return;
    }
    this.setDrawOffer({ from: me, waiting });
    this.emit({ kind: 'notice', to: 'all', text: `${COLOR_NAME[me]}이 무승부를 제안했습니다.`, tone: 'normal' });
  }

  // ---- requests --------------------------------------------------------------

  /** `actor` is the requesting player's color; 'any' means hotseat (acts for whoever's turn it is). */
  async handle(req: Request, actor: Color | 'any'): Promise<void> {
    const notice = (text: string, tone: NoticeTone = 'error') => this.emit({ kind: 'notice', to: actor, text, tone });
    if (this.phase !== 'playing') return notice('게임이 아직 시작되지 않았습니다.', 'warn');
    if (this.busy) return notice('GM이 판정 중입니다. 잠시 기다려 주세요.', 'warn');
    // A surrendering player picks its exile, whoever's turn it is.
    if (req.type === 'exile') {
      const s = this.state.surrender;
      if (!s) return notice('항복한 플레이어가 없습니다.', 'warn');
      if (actor !== 'any' && actor !== s.loser) return notice('항복한 쪽이 남길 기물을 고르는 중입니다.', 'warn');
      if (actor === 'any' && this.state.rules.ai?.[s.loser as 'white']) return notice('AI가 남길 기물을 고르는 중입니다.', 'warn');
      this.apply({ type: 'exile', at: req.at }, actor);
      return;
    }
    // Resigning and draws, whoever's turn it is.
    if (req.type === 'resign' || req.type === 'offerDraw' || req.type === 'answerDraw') return this.ending(req, actor, notice);
    if (actor !== 'any' && actor !== this.state.turn && this.state.status.kind === 'playing') {
      return notice('상대의 차례입니다.', 'warn');
    }
    // One screen for everyone (hotseat): an AI's turn is the AI's.
    if (actor === 'any' && this.state.rules.ai?.[this.state.turn as 'white'] && this.state.status.kind === 'playing') {
      return notice('AI의 차례입니다. 잠시 기다려 주세요.', 'warn');
    }

    switch (req.type) {
      case 'move':
      case 'endTurn': {
        const before = this.state;
        const done = this.apply(req.type === 'endTurn' ? { type: 'endTurn' } : req.promotion ? { type: 'move', from: req.from, to: req.to, promotion: req.promotion } : { type: 'move', from: req.from, to: req.to }, actor);
        // One screen's own plain moves can be taken back (not one that rolled a clash).
        if (done && actor === 'any' && !this.barrier && !isAiOnly(before)) this.undoStack = [...this.undoStack.slice(-(UNDO_MAX - 1)), before];
        return;
      }
      case 'cancel':
        this.apply({ type: 'cancelSpecial' }, actor);
        return;
      case 'attempt':
        {
          // Two dice, added up (the faces go along for the screens).
          const dice: [number, number] = [this.roll(), this.roll()];
          this.apply({ type: 'attemptSpecial', roll: dice[0] + dice[1], dice }, actor);
        }
        return;
      case 'declare':
        await this.declare(req.action, actor);
        return;
    }
  }

  private clashRolls(): number[] {
    return Array.from({ length: CLASH_ROLLS }, () => this.roll());
  }

  private apply(cmd: Command, actor: Color | 'any' | 'all'): boolean {
    const before = this.state;
    let result = applyCommand(before, cmd);
    // A capture that turns into a clash (합) needs dice: roll them only then.
    if (!result.ok && result.reason === 'clashRollsNeeded' && (cmd.type === 'move' || cmd.type === 'attemptSpecial' || cmd.type === 'impulse')) {
      result = applyCommand(before, { ...cmd, clashRolls: this.clashRolls() });
    }
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
    // Dice or chaos: nothing is taken back past this.
    this.barrier = result.events.some((e) => e.type === 'specialResolved' || e.type === 'clash' || e.type === 'chaos');
    if (this.barrier) this.undoStack = [];
    this.emit({ kind: 'events', events: result.events, before, after: result.state });
    // A draw offer stands until the turn passes or the game is over; a resignation (the hexagon: the
    // others play on) takes it away too, or it would wait on a side no longer there to answer.
    if (result.events.some((e) => e.type === 'turnPassed' || e.type === 'resigned') || this.state.status.kind !== 'playing') this.setDrawOffer(null);
    this.noteResult(before);
    this.aiNote(result.events);
    this.afterChange(result.events);
    if (this.state.falling?.length) void this.land();
    this.aiPoke();
    return true;
  }

  // ---- AI players (docs/SPEC.md, "AI 플레이어") ------------------------------------

  /** The AI that has to act now, if any: the one to move, or one that surrendered and keeps a piece. */
  private aiToAct(): { color: Color; seat: AiSeat } | null {
    const s = this.state;
    if (this.phase !== 'playing' || s.status.kind !== 'playing' || this.busy || this.landing || s.falling?.length) return null;
    const ai = s.rules.ai ?? {};
    const color = s.surrender ? s.surrender.loser : s.turn;
    const seat = ai[color as 'white'];
    return seat ? { color, seat } : null;
  }

  /** What just happened takes this long to show on the screens: an AI waits for it. */
  private aiNote(events: readonly GameEvent[]): void {
    let ms = 0;
    for (const e of events) {
      if (e.type === 'specialResolved') ms = Math.max(ms, DICE_GRACE_MS + showMs(e.staging, e.effects));
      else if (e.type === 'clash') ms = Math.max(ms, CLASH_DICE_GRACE_MS + Math.round(duelSeconds(e.exchanges) * 1000));
      else if (e.type === 'fell' || e.type === 'fallStarted') ms = Math.max(ms, FALL_SHOW_MS);
      else if (e.type === 'specialProposed') ms = Math.max(ms, 1800);
      else if (e.type === 'moved' || e.type === 'impulse' || e.type === 'wandered') ms = Math.max(ms, 1700);
    }
    const now = this.now();
    this.aiReadyAt = Math.max(this.aiReadyAt, now) + ms;
  }

  /** If an AI has to act, it will, once the screens have caught up (and it has "thought" a moment). */
  private aiPoke(): void {
    if (this.aiHandle || this.aiActing || this.paused() || !this.aiToAct()) return;
    // The shows play in full; watching, the pause after them is longer or shorter.
    const showing = Math.max(0, this.aiReadyAt - this.now());
    const speed = isAiOnly(this.state) ? this.watch.speed : 'normal';
    const wait = this.aiPace * (speed === 'slow' ? showing + AI_SLOW_MS : speed === 'fast' ? showing + AI_FAST_MS : Math.max(AI_MIN_MS, showing));
    this.aiHandle = setTimeout(() => {
      this.aiHandle = null;
      void this.aiAct();
    }, wait);
  }

  private async aiAct(): Promise<void> {
    const who = this.aiToAct();
    if (!who) return;
    const s = this.state;
    const generation = this.generation;
    this.aiActing = true;
    try {
      // Surrendered (3인 육각 맵): it keeps its strongest piece.
      if (s.surrender) {
        const at = aiExile(s, who.color);
        if (at !== null) this.apply({ type: 'exile', at }, who.color);
        return;
      }
      // Its ruling is in: roll, or let it go.
      if (s.pending) {
        if (s.pending.color !== who.color) return;
        const roll = await shouldRollAsync(s, who.seat.level);
        if (generation !== this.generation || this.state !== s) return;
        if (!roll && !s.pending.retry) {
          // Not worth it: rest from special actions for its next two turns, and not this one again.
          this.aiRestUntil[who.color] = s.turnNumber + 2 * playersOf(s.map).length + 1;
          this.aiDropped[who.color] = s.pending.action;
        }
        await this.handle({ type: roll ? 'attempt' : 'cancel' }, who.color);
        return;
      }
      // A special action, now and then (once a turn).
      if (!s.chain && this.aiTried !== s.turnNumber && this.aiWantsSpecial(who)) {
        this.aiTried = s.turnNumber;
        // A declaration the GM finds impossible, or cannot rule on within the rules, is let go and
        // written anew with the reason, up to AI_REWRITES more times (사용자 요청).
        let problem: string | undefined;
        const deadline = this.now() + AI_SPECIAL_BUDGET_MS;
        for (let n = 0; n <= AI_REWRITES && this.now() < deadline; n++) {
          const action = await this.aiCompose(who, problem, deadline);
          if (generation !== this.generation) return;
          if (action === 'busy') {
            this.restFromBusy(who.color);
            break;
          }
          if (!action) break;
          const outcome = await this.declare(action, who.color, true, deadline);
          if (generation !== this.generation) return;
          // The GM cannot be reached (even after asking again): it just plays chess, and rests a while.
          if (outcome === 'unreachable') {
            this.restFromBusy(who.color);
            break;
          }
          const p = this.state.pending;
          if (p?.color === who.color) {
            if (p.ruling.feasible) return;
            problem = `"${action}" → GM이 불가능하다고 판정했습니다: ${p.ruling.interpretation}`;
            this.aiDropped[who.color] = action;
            await this.handle({ type: 'cancel' }, who.color);
            if (generation !== this.generation) return;
          } else {
            problem = `"${action}" → 규칙에 맞는 판정이 나오지 않았습니다(주체, 거리, 대상을 확인하세요).`;
          }
          if (n < AI_REWRITES) this.emit({ kind: 'notice', to: 'all', text: `🤖 ${COLOR_NAME[who.color]} AI가 선언을 고쳐 씁니다 (${n + 1}/${AI_REWRITES})`, tone: 'normal' });
        }
        // Whatever happened, the board may have moved on: the move is chosen afresh.
        if (this.state !== s) return;
      }
      // Its move.
      const move = await chooseMoveAsync(s, who.seat.level, Math.floor(this.chance() * 2 ** 31));
      if (generation !== this.generation || this.state !== s) return;
      if (!move || move.to === null) {
        this.apply({ type: 'endTurn' }, who.color);
        return;
      }
      const piece = s.board[move.from];
      const promotes = piece?.type === 'pawn' && !isAir(move.to) && promotesOn(piece.color, move.to);
      await this.handle({ type: 'move', from: move.from, to: move.to, ...(promotes && { promotion: 'queen' as const }) }, who.color);
    } finally {
      this.aiActing = false;
      this.aiPoke();
    }
  }

  /** Whether the AI tries a special action this turn: if the GM can make one up and its AP and habit say so. */
  private aiWantsSpecial({ color, seat }: { color: Color; seat: AiSeat }): boolean {
    if (seat.specials === 'off' || !this.brainOf(color).act) return false;
    if ((this.aiRestUntil[color] ?? 0) > this.state.turnNumber) return false;
    const ap = this.state.ap[color] ?? 0;
    if (seat.specials === 'often') return ap >= 1;
    return ap >= 2 && this.chance() < 0.5;
  }

  /**
   * The AI's declaration, made up by its model (its own, or the GM's) as that player (null: none
   * came). A busy, slow or unreachable model, or a reply without a declaration, is asked again
   * (retry.ts); `problem` says why its last declaration did not work.
   */
  private async aiCompose({ color, seat }: { color: Color; seat: AiSeat }, problem?: string, deadline?: number): Promise<string | null | 'busy'> {
    const generation = this.generation;
    this.setBusy(true);
    try {
      const style = seat.level === 'hard' || seat.level === 'master' ? 'sharp' : 'playful';
      const brain = this.brainOf(color);
      return await withRetries(
        async () => {
          const raw = await brain.act!({ state: this.state, color, style, hints: aiHints(this.state, color), maxDc: aiMaxDc(seat.level), ...(problem && { problem }) });
          const action = parsePlayerAction(raw, this.state.rules.actionMaxLength);
          // No declaration, or the one it just let go: write one again.
          if (!action || action === this.aiDropped[color]) throw new GmError('선언이 없습니다.', 'format');
          return action;
        },
        { timeoutMs: AI_COMPOSE_TIMEOUT_MS, pace: this.aiPace, stillWanted: () => generation === this.generation, onRetry: (kind, n) => this.retryNotice(color, kind, n), deadline, now: this.now },
      );
    } catch (err) {
      // The model would not, even asked again: the AI just plays chess this turn (a busy one: a while).
      return isTransient(err) && err.kind !== 'format' ? 'busy' : null;
    } finally {
      if (generation === this.generation) this.setBusy(false);
    }
  }

  /** The model is busy or out of reach: no special actions for this AI's next few turns (it plays chess meanwhile). */
  private restFromBusy(color: Color): void {
    this.aiRestUntil[color] = this.state.turnNumber + AI_BUSY_REST_TURNS * playersOf(this.state.map).length + 1;
    this.emit({ kind: 'notice', to: 'all', text: `🤖 ${COLOR_NAME[color]} AI: 모델이 붐벼서 ${AI_BUSY_REST_TURNS}턴 동안 특수 행동을 쉬고 일반 수를 둡니다.`, tone: 'warn' });
  }

  /** Everyone sees that an AI's model is being asked again (not for a malformed reply: that is quick). */
  private retryNotice(color: Color, kind: keyof typeof RETRY_REASON, n: number): void {
    if (kind === 'format') return;
    this.emit({ kind: 'notice', to: 'all', text: `🤖 ${COLOR_NAME[color]} AI: ${RETRY_REASON[kind]} 다시 요청합니다 (${n}/${AI_RETRIES})`, tone: 'warn' });
  }

  /** Falling pieces come down: the physics (if any) says where they rest, then `land` plays it. */
  private async land(): Promise<void> {
    if (this.landing || !this.state.falling?.length) return;
    this.landing = true;
    const generation = this.generation;
    const s = this.state;
    const seed = this.seed();
    let landings: Landing[] = [];
    try {
      if (this.fall) landings = await this.fall({ board: s.board, terrain: s.terrain ?? [], falling: s.falling!, seed });
    } catch {
      // no physics: straight down
    }
    this.landing = false;
    if (generation !== this.generation || this.state !== s) return;
    this.apply({ type: 'land', seed, landings }, 'all');
  }

  /** Keeps the clock in step with the game and sets off chaos when a round begins. */
  private afterChange(events: GameEvent[]): void {
    if (this.state.status.kind !== 'playing') return this.restartClock();
    // The exile is picked: the player to move gets a fresh clock (it stood still meanwhile).
    if (events.some((e) => e.type === 'exiled')) return this.restartClock();
    // A clash's dice (and its duel) do not eat the time of whoever moves next.
    const clashTime = events.reduce((t, e) => t + (e.type === 'clash' ? CLASH_DICE_GRACE_MS + Math.round(duelSeconds(e.exchanges) * 1000) : 0), 0);
    const passed = events.find((e) => e.type === 'turnPassed');
    if (passed) {
      this.restartClock();
      if (clashTime) this.addTime(clashTime);
      // Whoever just ended their turn: their 혼란 pieces stagger, their 행동대장 pieces step out.
      if (passed.type === 'turnPassed' && passed.ended) this.impulses(passed.ended);
      // Chaos's gray wanderers each take a step of their own whenever a turn passes.
      this.wander();
      // Chaos may strike once a round: when white's turn begins (both sides have moved).
      if (passed.turn === 'white') this.maybeChaos();
    } else {
      const resolved = events.find((e) => e.type === 'specialResolved');
      // The roll and the show that follows it do not eat the player's time.
      if (resolved) this.addTime(DICE_GRACE_MS + showMs(resolved.staging, resolved.effects) + clashTime);
      // Nor does a fall.
      if (events.some((e) => e.type === 'fell')) this.addTime(FALL_SHOW_MS);
    }
  }

  /**
   * `color`'s pieces that move of their own accord at the end of its turn (see engine/vanguard.ts):
   * a 혼란 piece to a random free square, a 행동대장 piece to its best move (or it holds its ground).
   * One at a time, in board order, each on the board the ones before it left.
   */
  private impulses(color: Color): void {
    // Taken as the turn ended, before its tags counted down (a 혼란 that ran out then still staggers).
    const ids = this.state.impulseDue?.map((d) => d.id) ?? this.state.board.flatMap((p, sq) => (p && p.color === color && impulseOf(this.state.board, sq) ? [p.id] : []));
    // A piece moves once at a turn's end, whoever orders it.
    const moved = new Set<string>();
    for (const id of ids) {
      const s = this.state;
      if (s.status.kind !== 'playing' || s.surrender || s.falling?.length || s.pending) return;
      const from = s.board.findIndex((p) => p?.id === id);
      const kind = from >= 0 ? impulseKindOf(s, from) : null;
      if (!kind || isStunnedPiece(s.board[from])) continue;
      if (kind === 'confused') {
        const options = impulseTargets(s, from, 'confused');
        if (!options.length || moved.has(id)) continue;
        moved.add(id);
        this.apply({ type: 'impulse', from, to: options[Math.floor(this.chance() * options.length) % options.length] }, 'all');
      } else {
        // A 행동대장 orders the best move among itself and its own pieces next to it (or holds).
        const order = vanguardOrder(s, from, moved);
        if (!order) {
          this.apply({ type: 'impulse', from, to: null }, 'all');
          continue;
        }
        moved.add(s.board[order.from]!.id);
        this.apply({ type: 'impulse', from: order.from, to: order.to, ...(order.from !== from && { by: from }) }, 'all');
      }
    }
  }

  /** The gray wanderers' random moves, one each (in board order, each seeing the moves before it). */
  private wander(): void {
    const s = this.state;
    if (s.status.kind !== 'playing' || s.surrender || s.falling?.length || s.pending) return;
    const board = [...s.board];
    const moves: { from: number; to: number }[] = [];
    // Where each stands now (a wanderer moved further along the board is not moved twice).
    const wanderers = board.flatMap((p, sq) => (p?.color === 'gray' ? [{ id: p.id, sq }] : []));
    for (const w of wanderers) {
      const from = w.sq;
      // Taken by a wanderer that moved before it: nothing left to move.
      if (board[from]?.id !== w.id) continue;
      const options = wanderTargets(board, from, s.terrain);
      if (!options.length) continue;
      const to = options[Math.floor(this.chance() * options.length) % options.length];
      board[to] = board[from];
      board[from] = null;
      moves.push({ from, to });
    }
    if (moves.length) this.apply({ type: 'wander', moves }, 'all');
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.emit({ kind: 'busy', busy });
    if (busy) this.pauseClock();
    else {
      this.resumeClock();
      // The GM is done (a ruling turned down, a chaos event): an AI to move carries on.
      this.aiPoke();
    }
  }

  /**
   * A declaration to the GM; its ruling goes on the table as pending. `patient` (an AI's): a busy,
   * slow or unreachable GM is asked again (retry.ts). What came of it: a ruling proposed, the GM
   * not reachable, or no ruling the rules accept.
   */
  private async declare(action: string, actor: Color | 'any', patient = false, deadline?: number): Promise<'proposed' | 'unreachable' | 'refused'> {
    const notice = (text: string) => {
      this.emit({ kind: 'notice', to: actor, text, tone: 'error' });
      return 'refused' as const;
    };
    const trimmed = action.trim();
    const s = this.state;
    // Cheap checks first, so a doomed declaration never costs a GM call.
    if (s.status.kind !== 'playing') return notice(REJECT_MESSAGE.gameOver);
    if (s.pending) return notice(REJECT_MESSAGE.actionPending);
    if (s.chain) return notice(REJECT_MESSAGE.chainInProgress);
    if (!trimmed) return notice(REJECT_MESSAGE.emptyAction);
    if (trimmed.length > s.rules.actionMaxLength) return notice(REJECT_MESSAGE.actionTooLong);

    const generation = this.generation;
    this.setBusy(true);
    try {
      // A ruling the rules turn down (nobody acting, a touch out of reach...) goes back to the
      // GM once, with the reason; the second answer stands or falls.
      let problem: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const ask = () => this.gm.rule({ action: trimmed, state: s, problem });
        const raw = patient
          ? await withRetries(ask, {
              timeoutMs: AI_RULING_TIMEOUT_MS,
              pace: this.aiPace,
              stillWanted: () => generation === this.generation,
              onRetry: (kind, n) => actor !== 'any' && this.retryNotice(actor, kind, n),
              deadline,
              now: this.now,
            })
          : await ask();
        if (generation !== this.generation) return 'refused';
        const parsed = parseGmRuling(raw);
        if (!parsed.ok) {
          problem = `응답 형식 오류: ${parsed.error}`;
          if (attempt === 0) continue;
          return notice(`GM 응답 형식이 올바르지 않습니다 (${parsed.error}). AP는 쓰지 않았습니다. 다시 시도해 주세요.`);
        }
        const command = { type: 'proposeSpecial' as const, action: trimmed, ruling: parsed.ruling };
        const dry = applyCommand(this.state, command);
        if (!dry.ok && dry.reason === 'invalidRuling' && attempt === 0) {
          problem = dry.detail ?? REJECT_MESSAGE.invalidRuling;
          continue;
        }
        this.busy = false;
        this.apply(command, actor);
        return dry.ok ? 'proposed' : 'refused';
      }
      return 'refused';
    } catch (err) {
      if (generation !== this.generation) return 'refused';
      const reason = err instanceof GmError ? err.message : `GM 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      notice(`${reason} (AP는 쓰지 않았습니다. 다시 보낼 수 있습니다.)`);
      // A malformed reply is the GM's answer; anything else means it could not be reached.
      return isTransient(err) && err.kind === 'format' ? 'refused' : 'unreachable';
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
        this.noteResult(before);
        this.aiNote(result.events);
        this.aiReadyAt += showMs(parsed.chaos.staging, parsed.chaos.effects);
        // The clock restarts when the GM is done (setBusy below); the show is extra.
        this.addTime(showMs(parsed.chaos.staging, parsed.chaos.effects));
        if (this.state.falling?.length) void this.land();
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
    // A surrendering player's pick (the 3-player board) is not anyone's turn: no clock meanwhile.
    return this.phase === 'playing' && this.state.status.kind === 'playing' && this.limitMs() > 0 && !this.state.surrender;
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
    if (!this.clockActive() || this.busy || this.paused() || c.startedAt !== null) return;
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
