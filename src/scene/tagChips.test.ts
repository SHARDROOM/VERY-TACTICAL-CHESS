import { describe, expect, it } from 'vitest';
import { tagChips } from './PieceMesh';

describe('turn badges over a piece', () => {
  const piece = (tags: { name: string; turnsLeft: number | null }[]) => ({ id: 'x', color: 'white' as const, type: 'knight' as const, tags: tags.map((t) => ({ ...t, appliedOnTurn: 1 })) });

  it('every tag that runs out shows its turns left; lasting core tags show none', () => {
    expect(tagChips(piece([{ name: '기절', turnsLeft: 1 }, { name: '보호막', turnsLeft: null }, { name: '용기백배', turnsLeft: 2 }]))).toEqual([
      { text: '기절 1', tone: 'stun' },
      { text: '용기백배 2', tone: 'free' },
    ]);
  });

  it('a burning piece turns red on its last turn to move; long names are cut short', () => {
    expect(tagChips(piece([{ name: '화상', turnsLeft: 2 }]))).toEqual([{ text: '화상 2', tone: 'burn' }]);
    expect(tagChips(piece([{ name: '화상', turnsLeft: 1 }]))).toEqual([{ text: '화상 1', tone: 'burnLast' }]);
    expect(tagChips(piece([{ name: '아주아주긴서사태그', turnsLeft: null }]))).toEqual([{ text: '아주아주긴…', tone: 'free' }]);
  });
});
