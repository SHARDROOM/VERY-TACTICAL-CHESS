import { describe, expect, it } from 'vitest';
import { ACTS, ELEMENTS, ENTRANCES, EXITS, FX_SHAPES, MOTION_STYLES, withDefaultRules } from '../engine';
import { buildChaosSystemPrompt, buildSystemPrompt } from './prompt';

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
