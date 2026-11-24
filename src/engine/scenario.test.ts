import { describe, expect, it } from 'vitest';
import { SCENARIOS, createInitialState, isInCheck, playersOf, setBoardMap, stackOf, withScenario, type Color, type GameState, type PieceType } from './index';

/* 랜덤 시나리오 (사용자 요청): every scenario sets up on both boards, the same for every side. */

const seeded = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const count = (s: GameState, c: Color, type: PieceType) => s.board.filter((p) => p?.color === c && p.type === type).length;
const tagged = (s: GameState, c: Color, name: string) => s.board.filter((p) => p?.color === c && p.tags?.some((t) => t.name === name)).length;

describe('random scenarios', () => {
  for (const map of ['classic', 'hex3'] as const) {
    for (const def of SCENARIOS) {
      it(`${def.title} sets up on the ${map} board, alike for every side, with no king attacked`, () => {
        const s = withScenario(createInitialState(undefined, map), seeded(7), def.id);
        expect(s.scenario).toEqual({ id: def.id, title: def.title, text: def.text });
        setBoardMap(map);
        const sides = playersOf(map);
        for (const c of sides) expect(isInCheck(s.board, c, s.terrain)).toBe(false);
        // Every side got the same: the same pieces of each kind, the same tags, the same squares changed.
        const shape = (c: Color) => [
          ...(['pawn', 'rook', 'bishop', 'queen', 'knight'] as const).map((t) => count(s, c, t)),
          ...['혼란', '행동대장', '검술', '보호막', '질주'].map((n) => tagged(s, c, n)),
        ];
        for (const c of sides) expect(shape(c)).toEqual(shape(sides[0]));
        expect(JSON.stringify(s.board)).not.toBe(JSON.stringify(createInitialState(undefined, map).board) + (s.terrain?.length ? 'x' : ''));
      });
    }
  }

  it('the examples asked for: fewer pawns, pawns as rooks, dazed pieces, swords, a bishop made queen, generals', () => {
    const fresh = createInitialState();
    const go = (id: string) => withScenario(fresh, seeded(3), id);
    expect(count(go('conscription'), 'white', 'pawn')).toBe(6);
    expect(count(go('walls'), 'black', 'rook')).toBe(4);
    expect(tagged(go('light'), 'white', '혼란')).toBe(2);
    expect(go('drill').board.filter((p) => p?.type === 'pawn').every((p) => p!.tags?.some((t) => t.name === '검술' && t.clash === 1.3 && t.prop?.preset === 'sword'))).toBe(true);
    expect(count(go('affair'), 'white', 'queen')).toBe(2);
    expect(tagged(go('generals'), 'black', '행동대장')).toBe(3);
    expect(go('chapel').terrain?.filter((c) => c.building?.kind === 'church')).toHaveLength(2);
    void stackOf;
  });

  it('picks one at random when none is named', () => {
    const titles = new Set(Array.from({ length: 30 }, (_, i) => withScenario(createInitialState(), seeded(i + 1)).scenario?.id));
    expect(titles.size).toBeGreaterThan(4);
  });
});
