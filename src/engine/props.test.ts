import { describe, expect, it } from 'vitest';
import { applyEffects, cleanProp, createInitialState, parseSquare, partsOf, propReach, PRESET_PARTS, PROP_PRESETS } from './index';

const sq = (n: string) => parseSquare(n)!;
const part = { shape: 'box', position: [0, 0.2, 0], size: [0.1, 0.4, 0.1], rotation: [0, 0, 0], material: 'iron' };

describe('cleaning a prop', () => {
  it('a ready-made one by name, held where it belongs unless told', () => {
    expect(cleanProp({ preset: 'sword' })).toEqual({ preset: 'sword', parts: [], attach: 'rightHand', scale: 1 });
    expect(cleanProp({ preset: 'shield' })?.attach).toBe('leftHand');
    expect(cleanProp({ preset: 'crown', attach: 'head', color: '#AA2233', scale: 9 })).toEqual({ preset: 'crown', parts: [], attach: 'head', color: '#aa2233', scale: 2 });
  });

  it('its own parts: bad ones dropped, numbers pulled into range, at most 20', () => {
    const p = cleanProp({
      parts: [part, { ...part, shape: 'dragon' }, { ...part, material: 'cheese' }, { ...part, position: [9, 0, 0], size: [-0.2, 0, 3], rotation: [370, -90, 0], color: 'red' }],
      attach: 'tail',
    })!;
    expect(p.preset).toBeNull();
    expect(p.attach).toBe('rightHand');
    expect(p.parts).toHaveLength(2);
    expect(p.parts[1]).toEqual({ shape: 'box', position: [1.5, 0, 0], size: [0.2, 0.005, 1.5], rotation: [10, 270, 0], material: 'iron' });
    expect(cleanProp({ parts: Array.from({ length: 30 }, () => part) })!.parts).toHaveLength(20);
  });

  it('nothing drawable: no prop', () => {
    expect(cleanProp({ preset: 'dragon' })).toBeNull();
    expect(cleanProp({ parts: [{ shape: 'box' }] })).toBeNull();
    expect(cleanProp(null)).toBeNull();
  });

  it('every ready-made prop is drawable and fits in a square or so', () => {
    for (const name of PROP_PRESETS) {
      expect(PRESET_PARTS[name].length).toBeGreaterThan(0);
      expect(PRESET_PARTS[name].length).toBeLessThanOrEqual(20);
      expect(propReach(PRESET_PARTS[name])).toBeLessThan(1.2);
    }
    // A banner's colour goes on its cloth only.
    const flag = partsOf({ preset: 'flag', parts: [], attach: 'rightHand', scale: 1, color: '#3355cc' });
    expect(flag.filter((p) => p.color === '#3355cc').map((p) => p.material)).toEqual(['cloth']);
  });
});

describe('props and clash multipliers on tags', () => {
  const ctx = { turnNumber: 1, nextSpawnId: 1 };
  it('a tag keeps its multiplier and its (cleaned) prop', () => {
    const r = applyEffects(createInitialState().board, [{ type: 'tag', at: sq('e2'), tag: '검술', turns: 0, clash: 1.5, prop: { preset: 'sword', parts: [], attach: 'rightHand', scale: 1 } }], ctx);
    if (!r.ok) throw new Error(r.detail);
    expect(r.board[sq('e2')]?.tags).toEqual([{ name: '검술', turnsLeft: null, appliedOnTurn: 1, clash: 1.5, prop: { preset: 'sword', parts: [], attach: 'rightHand', scale: 1 } }]);
  });

  it('a multiplier must be 1.2..2.0', () => {
    for (const clash of [1, 2.5, Number.NaN]) {
      const r = applyEffects(createInitialState().board, [{ type: 'tag', at: sq('e2'), tag: '검술', turns: 0, clash }], ctx);
      expect(r).toMatchObject({ ok: false });
    }
  });
});
