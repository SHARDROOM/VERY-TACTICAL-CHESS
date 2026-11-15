import { describe, expect, it } from 'vitest';
import { ACTS, ELEMENTS, ENTRANCES, EXITS, FX_SHAPES, MOTION_STYLES, createStateFrom, parseSquare, withDefaultRules } from '../engine';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';

const rules = withDefaultRules({});

describe('staging in the GM prompts', () => {
  const ruling = buildSystemPrompt(rules);
  const chaos = buildChaosSystemPrompt(rules);

  it('the ruling prompt lists every staging tool by name', () => {
    for (const name of [...ELEMENTS, ...FX_SHAPES, ...MOTION_STYLES, ...ENTRANCES, ...EXITS, ...ACTS]) expect(ruling).toContain(name);
    for (const word of ['shake', 'beats', 'acts', 'aura', 'withEffect']) expect(ruling).toContain(word);
  });

  it('with the light principles: match the narration and the size of the outcome', () => {
    expect(ruling).toContain('서술과 맞게');
    expect(ruling).toContain('대성공은 화려하게, 실패는 짧게, 대실패는 행동한 쪽에 역효과처럼');
    expect(ruling).toContain('6초');
  });

  it('the chaos prompt has staging too', () => {
    for (const name of [...ELEMENTS, ...FX_SHAPES]) expect(chaos).toContain(name);
    for (const word of ['staging', 'shake', 'beats', 'acts', 'aura', '서술과 맞게', '6초']) expect(chaos).toContain(word);
  });

  it('no recipes per element: the GM decides', () => {
    // A light guide: no "fire means X" tables.
    expect(ruling).not.toMatch(/fire\s*(=|→|는\s*항상)/);
  });
});

describe('the new effects and terrain in the GM prompts', () => {
  it('both prompts list swap, revive, terrain and the 화상 rule', () => {
    for (const prompt of [buildSystemPrompt(rules), buildChaosSystemPrompt(rules)]) {
      for (const word of ['"swap"', '"revive"', '"terrain"', '"clearTerrain"', '화상', '구덩이', '벽']) expect(prompt).toContain(word);
    }
  });

  it('the board message shows walls, pits and the pieces beside the board', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, 'white', {
      terrain: [
        { at: parseSquare('d4')!, kind: 'wall', turnsLeft: 2, owner: 'white', appliedOnTurn: 1 },
        { at: parseSquare('e5')!, kind: 'pit', turnsLeft: null, owner: 'black', appliedOnTurn: 1 },
      ],
      captured: [
        { id: 'k1', color: 'black', type: 'knight' },
        { id: 'k2', color: 'black', type: 'knight' },
        { id: 'p1', color: 'white', type: 'pawn', exit: 'ash' },
      ],
    });
    for (const msg of [buildUserMessage('x', s), buildChaosUserMessage(s)]) {
      expect(msg).toContain('벽 d4 (백의 턴으로 2턴 남음)');
      expect(msg).toContain('구덩이 e5 (영구)');
      expect(msg).toContain('- 흑: 나이트 2');
      expect(msg).toContain('- 백: 폰 1');
      expect(msg).toMatch(/^5 \. \. \. \. O \. \. \.$/m);
      expect(msg).toMatch(/^4 \. \. \. # \. \. \. \.$/m);
    }
  });
});
