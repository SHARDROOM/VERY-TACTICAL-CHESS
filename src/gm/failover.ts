import { GmError, isBlocked } from './errors';
import type { ChaosRequest, GameMaster, GmRequest } from './types';
import type { ActRequest } from './player';

/*
 * Backup GMs (예비 GM, 사용자 요청): the main GM and up to three backups, each its own service,
 * model and key. A request goes to the first one not resting; if it is blocked (busy, over its
 * limit, too slow, unreachable, or its key will not do), the next one is asked at once, and the
 * blocked one rests: two minutes, or for good if its key will not do. A malformed reply or a
 * refusal is the GM's answer and stays with it. Every switch is told (`onNotice`), and the name
 * is the one now in use. docs/SPEC.md, "예비 GM".
 */

/** The most backups a GM may have. */
export const MAX_BACKUPS = 3;
/** How long a blocked GM rests before it is asked again (busy, slow, unreachable). */
export const REST_MS = 2 * 60_000;

/** One try at most this long when there is someone to go on to (a GM with no backup waits as before). */
const LIMIT_MS: Record<'rule' | 'chaos' | 'act', number> = { rule: 60_000, chaos: 60_000, act: 20_000 };

export interface FailoverEntry {
  gm: GameMaster;
  /** What it is called in the notices ("Gemini", "예비 1 · Groq"). */
  label: string;
}

const WHY: Record<string, string> = {
  busy: '요청이 몰리거나 사용 한도에 걸려',
  slow: '응답이 너무 늦어',
  network: '연결되지 않아',
  auth: '키나 모델을 쓸 수 없어',
};

export class FailoverGameMaster implements GameMaster {
  /** Told when a request goes on to another GM (the session shows it). */
  onNotice?: (text: string) => void;
  private readonly restUntil: number[];
  /** The one being asked now, or the one that answered last (its name is shown). */
  private current = 0;

  constructor(
    private readonly entries: readonly FailoverEntry[],
    private readonly now: () => number = Date.now,
  ) {
    this.restUntil = entries.map(() => 0);
  }

  get name(): string {
    const e = this.entries[this.current] ?? this.entries[0];
    return this.current > 0 ? `${e.gm.name} · ${e.label}` : e.gm.name;
  }

  rule(request: GmRequest): Promise<unknown> {
    return this.ask('rule', (gm) => gm.rule(request));
  }

  chaos(request: ChaosRequest): Promise<unknown> {
    return this.ask('chaos', (gm) => (gm.chaos ? gm.chaos(request) : Promise.reject(new GmError('이 GM은 혼돈을 일으키지 않습니다.'))));
  }

  act(request: ActRequest): Promise<unknown> {
    return this.ask('act', (gm) => (gm.act ? gm.act(request) : Promise.reject(new GmError('이 GM은 AI의 선언을 짓지 않습니다.'))));
  }

  /** The order to try them in: those not resting first (in their own order), then the resting ones, soonest back first. */
  private order(): number[] {
    const now = this.now();
    const idx = this.entries.map((_, i) => i);
    const ready = idx.filter((i) => this.restUntil[i] <= now);
    const resting = idx.filter((i) => this.restUntil[i] > now && Number.isFinite(this.restUntil[i])).sort((a, b) => this.restUntil[a] - this.restUntil[b]);
    return ready.length ? ready : resting.length ? resting : idx;
  }

  private async ask(what: 'rule' | 'chaos' | 'act', call: (gm: GameMaster) => Promise<unknown>): Promise<unknown> {
    const order = this.order();
    let last: unknown;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const next = order[k + 1];
      const e = this.entries[i];
      // The GM that does not support this (a fake one for chaos) is passed over quietly.
      if ((what === 'chaos' && !e.gm.chaos) || (what === 'act' && !e.gm.act)) continue;
      // Named while it thinks ("GM 판정 중 · …"), so a switch shows at once.
      this.current = i;
      try {
        return await (next === undefined ? call(e.gm) : limited(call(e.gm), LIMIT_MS[what]));
      } catch (err) {
        last = err;
        if (!isBlocked(err)) throw err;
        this.restUntil[i] = err.kind === 'auth' ? Infinity : this.now() + REST_MS;
        if (next === undefined) continue;
        this.current = next;
        this.onNotice?.(`🔁 ${e.label}이(가) ${WHY[err.kind]} ${this.entries[next].label}(으)로 넘깁니다.`);
      }
    }
    throw last ?? new GmError('쓸 수 있는 GM이 없습니다.');
  }
}

/** Rejects as "slow" if `promise` takes longer than `ms` (so the next GM can be asked). */
function limited<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GmError('응답이 너무 오래 걸립니다.', 'slow')), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}
