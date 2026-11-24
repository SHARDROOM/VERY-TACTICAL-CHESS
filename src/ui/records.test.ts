import { describe, expect, it } from 'vitest';
import type { GameRecord } from '../session/records';
import { recordSummary, resultLabel } from './Records';

const rec = (mode: GameRecord['mode'], result: GameRecord['result'], winner: GameRecord['winner'] = 'white'): GameRecord => ({
  id: Math.random().toString(36),
  at: 1,
  mode,
  map: 'classic',
  me: result ? 'white' : mode === 'hotseat' ? 'both' : null,
  winner,
  end: 'king',
  result,
  turns: 20,
  gm: '가짜 GM',
  highlights: {},
  precedents: [],
});

describe('전적 in the lobby', () => {
  it('sums up each way of playing, wins and losses where this screen had a side', () => {
    const list = [rec('ai', 'won'), rec('ai', 'won'), rec('ai', 'lost'), rec('online', 'draw', null), rec('hotseat', null), rec('hotseat', null), rec('watching', null)];
    expect(recordSummary(list)).toBe('AI와 2승 1패 · 온라인 1무 · 핫시트 2판 · 관전 1판');
  });

  it('says this screen’s result, or who won when it had no side', () => {
    expect([resultLabel(rec('ai', 'won')), resultLabel(rec('ai', 'lost')), resultLabel(rec('hotseat', null, 'black')), resultLabel(rec('watching', null, null))]).toEqual(['승', '패', '흑 승리', '무승부']);
  });
});
