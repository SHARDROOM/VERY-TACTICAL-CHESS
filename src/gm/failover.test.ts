import { describe, expect, it, vi } from 'vitest';
import { GmError } from './errors';
import { FailoverGameMaster, REST_MS } from './failover';
import type { GameMaster } from './types';

/** A GM that answers with its name, or fails as told, counting its calls. */
function gm(name: string, fail?: () => Error): GameMaster & { calls: number } {
  const g = {
    name,
    calls: 0,
    async rule() {
      g.calls++;
      if (fail) throw fail();
      return { from: name };
    },
  };
  return g;
}
const req = { action: 'x', state: {} as never };

describe('backup GMs (예비 GM, 사용자 요청)', () => {
  it('a busy main GM: the backup answers, everyone is told, and the main one rests for two minutes', async () => {
    let clock = 0;
    let busy = true;
    const main = gm('Gemini GM', undefined);
    main.rule = async () => {
      main.calls++;
      if (busy) throw new GmError('busy', 'busy');
      return { from: 'main' };
    };
    const backup = gm('Groq GM');
    const notes: string[] = [];
    const f = new FailoverGameMaster([{ gm: main, label: 'Gemini' }, { gm: backup, label: '예비 1 Groq' }], () => clock);
    f.onNotice = (t) => notes.push(t);
    expect(await f.rule(req)).toEqual({ from: 'Groq GM' });
    expect(notes).toEqual(['🔁 Gemini이(가) 요청이 몰리거나 사용 한도에 걸려 예비 1 Groq(으)로 넘깁니다.']);
    expect(f.name).toBe('Groq GM · 예비 1 Groq');
    // Resting: straight to the backup.
    await f.rule(req);
    expect(main.calls).toBe(1);
    // Two minutes on, the main one is asked again (and answers now).
    clock += REST_MS + 1;
    busy = false;
    expect(await f.rule(req)).toEqual({ from: 'main' });
    expect(f.name).toBe('Gemini GM');
  });

  it('a key that will not do rests for good; a malformed reply is not passed on', async () => {
    let clock = 0;
    const main = gm('A', () => new GmError('key', 'auth'));
    const backup = gm('B');
    const f = new FailoverGameMaster([{ gm: main, label: 'A' }, { gm: backup, label: 'B' }], () => clock);
    await f.rule(req);
    clock += 10 * REST_MS;
    await f.rule(req);
    expect(main.calls).toBe(1);
    const odd = new FailoverGameMaster([{ gm: gm('C', () => new GmError('bad json', 'format')), label: 'C' }, { gm: backup, label: 'B' }]);
    await expect(odd.rule(req)).rejects.toThrow('bad json');
  });

  it('a GM too slow to answer is left for the next one', async () => {
    vi.useFakeTimers();
    try {
      const slow = gm('slow');
      slow.rule = () => new Promise(() => {});
      const f = new FailoverGameMaster([{ gm: slow, label: 'slow' }, { gm: gm('fast'), label: 'fast' }]);
      const answer = f.rule(req);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await answer).toEqual({ from: 'fast' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('when every one is blocked, the last failure comes back', async () => {
    const f = new FailoverGameMaster([
      { gm: gm('A', () => new GmError('busy A', 'busy')), label: 'A' },
      { gm: gm('B', () => new GmError('busy B', 'busy')), label: 'B' },
    ]);
    await expect(f.rule(req)).rejects.toThrow('busy B');
  });
});

describe('in a game', () => {
  it('a declaration still gets its ruling from the backup, and the log says so', async () => {
    const { LocalSession } = await import('../session/localSession');
    const { FakeGameMaster } = await import('./fakeGm');
    const { createInitialState } = await import('../engine');
    const main = gm('Gemini GM', () => new GmError('busy', 'busy'));
    const chain = new FailoverGameMaster([{ gm: main, label: 'Gemini' }, { gm: new FakeGameMaster(0), label: '예비 1 가짜' }]);
    const s = createInitialState();
    const local = new LocalSession(chain, { initialState: { ...s, ap: { ...s.ap, white: 3 } }, phase: 'playing' });
    const notices: string[] = [];
    local.subscribe((e) => e.kind === 'notice' && notices.push(e.text));
    local.request({ type: 'declare', action: 'b1 나이트를 투석기로 e5까지 날린다' });
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    };
    await until(() => !!local.view().state.pending);
    expect(local.view().state.pending?.ruling.feasible).toBe(true);
    expect(notices.some((t) => t.startsWith('🔁 Gemini'))).toBe(true);
    expect(local.view().gmName).toContain('예비 1 가짜');
    local.dispose();
  });
});
