import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseToyOp, type ToyOp } from '../session/toy';
import { onPaper, setToySender, tellToss, tellWrite } from './toys';
import { paperKey } from './Papers';

/* 쓰는 종이 (사용자 요청): what a player writes reaches the others as it is typed, and is tossed when sent. */

describe('a sheet being written', () => {
  afterEach(() => {
    setToySender(null);
    vi.useRealTimers();
  });

  it('only well-formed writing gets through', () => {
    expect(parseToyOp({ op: 'write', id: 'black', text: '나이트가 돌진' })).toEqual({ op: 'write', id: 'black', text: '나이트가 돌진' });
    expect(parseToyOp({ op: 'write', id: 'black', text: 'x'.repeat(201) })).toBeNull();
    expect(parseToyOp({ op: 'write', id: 'nobody', text: 'x' })).toBeNull();
    expect(parseToyOp({ op: 'toss', id: 'red', text: '안녕', dir: -1, seed: 5 })).toEqual({ op: 'toss', id: 'red', text: '안녕', dir: -1, seed: 5 });
    expect(parseToyOp({ op: 'toss', id: 'red', text: '안녕', dir: 2, seed: 5 })).toBeNull();
  });

  it('typing goes out a few times a second, always ending on what is written now; sending tosses it here too', () => {
    vi.useFakeTimers();
    const sent: ToyOp[] = [];
    setToySender((op) => sent.push(op));
    const here: ToyOp[] = [];
    const off = onPaper((op) => here.push(op));
    for (const t of ['나', '나이', '나이트', '나이트가']) tellWrite('white', t);
    vi.advanceTimersByTime(500);
    const writes = sent.filter((o) => o.op === 'write');
    expect(writes.length).toBeLessThan(4);
    expect(writes.at(-1)).toEqual({ op: 'write', id: 'white', text: '나이트가' });
    tellToss('white', '나이트가 돌진한다');
    expect(sent.at(-1)).toMatchObject({ op: 'toss', id: 'white', text: '나이트가 돌진한다' });
    expect(here).toEqual([sent.at(-1)]);
    off();
  });
});

describe('a tossed sheet', () => {
  it('has the same name on every screen, however many sheets each has seen (found by cross-check: one picked up elsewhere did not move here)', () => {
    const op = { op: 'toss', id: 'black', text: 'x', dir: 1, seed: 12345 } as const;
    expect(paperKey(op)).toBe(paperKey({ ...op }));
    expect(paperKey(op)).not.toBe(paperKey({ ...op, seed: 999 }));
    expect(paperKey(op)).not.toBe(paperKey({ ...op, id: 'white' }));
  });
});
