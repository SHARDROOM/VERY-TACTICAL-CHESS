import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../engine';
import { play } from '../engine/testUtil';
import { MAX_RECORDS, addRecord, mergeRecords, readRecords, recordOf, type GameRecord } from './records';
import { LocalSession } from './localSession';
import { fakeRuling } from '../gm/fakeGm';
import type { GameMaster, GmRequest } from '../gm/types';

/* 기록·전적 (사용자 요청): every finished game, from this screen's side, the last 100. */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

/** White takes a pawn, then black gives up. */
const finished = (extra: Partial<GameState> = {}): GameState => {
  const s = play(createInitialState(), 'e2e4 d7d5 e4d5');
  return { ...s, status: { kind: 'won', winner: 'white', by: 'resign' }, ...extra };
};

const base = { gm: 'Gemini GM (gemini-3.5-flash-lite)', at: 1_700_000_000_000 };

describe('what a finished game leaves', () => {
  it('against an AI, the person’s result, the GM, the AI, the turns and the highlights', () => {
    const s = finished({ rules: { ...createInitialState().rules, ai: { black: { level: 'hard', specials: 'off' } } } });
    const r = recordOf(s, { ...base, mode: 'ai', me: 'white', ai: { black: '어려움' } })!;
    expect(r).toMatchObject({ mode: 'ai', map: 'classic', me: 'white', winner: 'white', end: 'resign', result: 'won', turns: s.turnNumber, gm: base.gm, ai: { black: '어려움' }, at: base.at });
    expect(r.highlights.mvp).toMatchObject({ color: 'white', type: 'pawn', n: 1 });
    expect(typeof r.id).toBe('string');
  });

  it('a guest sees its own side; one watching keeps no result; two at one screen neither', () => {
    expect(recordOf(finished(), { ...base, mode: 'online', me: 'black' })!.result).toBe('lost');
    expect(recordOf(finished(), { ...base, mode: 'watching', me: null })!.result).toBeNull();
    expect(recordOf(finished(), { ...base, mode: 'hotseat', me: 'both' })!.result).toBeNull();
    expect(recordOf(finished({ status: { kind: 'draw', reason: 'agreed' } }), { ...base, mode: 'online', me: 'black' })).toMatchObject({ result: 'draw', winner: null, end: 'agreed' });
  });

  it('a game still going, or one only AIs played, leaves nothing', () => {
    expect(recordOf(play(createInitialState(), 'e2e4'), { ...base, mode: 'hotseat', me: 'both' })).toBeNull();
    const watch = finished({ rules: { ...createInitialState().rules, ai: { white: { level: 'easy', specials: 'off' }, black: { level: 'easy', specials: 'off' } } } });
    expect(recordOf(watch, { ...base, mode: 'ai', me: null })).toBeNull();
  });

  it('the same game seen again (a reload, a reconnect) is the same record; another game is another', () => {
    const a = recordOf(finished(), { ...base, mode: 'online', me: 'white' })!;
    const again = recordOf(finished(), { ...base, mode: 'online', me: 'white', at: base.at + 5000 })!;
    expect(again.id).toBe(a.id);
    const other = recordOf({ ...play(createInitialState(), 'd2d4 e7e5 d4e5'), status: { kind: 'won', winner: 'white' } }, { ...base, mode: 'online', me: 'white' })!;
    expect(other.id).not.toBe(a.id);
  });
});

describe('two games that end alike', () => {
  it('are two records: each game started has its own id (found in review: two quick draws were one)', () => {
    const gm: GameMaster = { name: 'Test GM', rule: async (req: GmRequest) => fakeRuling(req.action, req.state.turn) };
    const s = new LocalSession(gm, { roll: () => 6 });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      s.start();
      s.request({ type: 'offerDraw' });
      ids.push(recordOf(s.view().state, { ...base, mode: 'hotseat', me: 'both' })!.id);
      s.restart();
    }
    expect(ids[0]).not.toBe(ids[1]);
    s.dispose();
  });
});

describe('kept on this browser', () => {
  const rec = (id: string, at: number): GameRecord => ({ ...recordOf(finished(), { ...base, mode: 'hotseat', me: 'both' })!, id, at });

  it('newest first, each game once, the last 100', () => {
    const storage = new MemoryStorage();
    addRecord(rec('a', 1), storage);
    addRecord(rec('b', 2), storage);
    addRecord(rec('a', 3), storage);
    expect(readRecords(storage).map((r) => r.id)).toEqual(['b', 'a']);
    for (let i = 0; i < MAX_RECORDS + 5; i++) addRecord(rec(`g${i}`, 10 + i), storage);
    const kept = readRecords(storage);
    expect(kept).toHaveLength(MAX_RECORDS);
    expect(kept[0].id).toBe(`g${MAX_RECORDS + 4}`);
  });

  it('two devices’ records come together: every game once, newest first', () => {
    const merged = mergeRecords([rec('a', 5), rec('b', 3)], [rec('b', 3), rec('c', 4), { junk: true }]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(mergeRecords(null, undefined)).toEqual([]);
  });

  it('the same records in any order come out in the same order (found by cross-check: equal times flip-flopped between devices)', () => {
    const a = rec('a', 7);
    const b = rec('b', 7);
    expect(mergeRecords([a], [b])).toEqual(mergeRecords([b], [a]));
  });

  it('what is not a record is passed over', () => {
    const storage = new MemoryStorage();
    storage.setItem('vtc.records.v1', JSON.stringify([{ id: 1 }, 'x', rec('ok', 1)]));
    expect(readRecords(storage).map((r) => r.id)).toEqual(['ok']);
    storage.setItem('vtc.records.v1', '{broken');
    expect(readRecords(storage)).toEqual([]);
  });
});
