import { describe, expect, it } from 'vitest';
import { applyCommand, buildTimeline, createInitialState, type Effect, type Ruling, type Staging } from './index';
import { cleanStaging } from '../gm/staging';
import { parseGmRuling } from '../gm/parse';
import { fakeRuling } from '../gm/fakeGm';
import { ok, sq } from './testUtil';

const fxItem = (over: Record<string, unknown> = {}) => ({
  element: 'fire', shape: 'burst', at: 'e4', to: '', radius: 1, strength: 3, duration: 1.5, withEffect: 0, delay: 0, ...over,
});

describe('cleaning GM staging', () => {
  it('keeps good items, converts squares and effect numbers, clamps numbers', () => {
    const s = cleanStaging(
      {
        fx: [fxItem({ radius: 9, strength: 0, duration: 99, withEffect: 1, delay: -3 })],
        shake: 7,
        beats: [{ effect: 1, wait: 5, motion: 'teleport', speed: 'fast', entrance: 'rise', exit: 'ash' }],
        acts: [{ at: 'b1', act: 'hop', delay: 0.5 }],
      },
      1,
    );
    expect(s).toEqual({
      fx: [{ element: 'fire', shape: 'burst', at: sq('e4'), to: null, radius: 3, strength: 1, duration: 5, withEffect: 0, delay: 0 }],
      shake: 3,
      beats: [{ effect: 0, wait: 2, motion: 'teleport', speed: 'fast', entrance: 'rise', exit: 'ash' }],
      acts: [{ at: sq('b1'), act: 'hop', delay: 0.5 }],
    });
  });

  it('drops what cannot be shown, and never throws', () => {
    const s = cleanStaging(
      {
        fx: [
          fxItem({ element: 'plasma' }),
          fxItem({ shape: 'spiral' }),
          fxItem({ at: 'z9' }),
          fxItem({ shape: 'beam', to: '' }),
          fxItem({ shape: 'area', at: 'a1', to: '' }),
          fxItem({ shape: 'trail', withEffect: 0 }),
          fxItem({ shape: 'area', at: '', to: '' }),
        ],
        beats: [{ effect: 4, motion: 'fly' }, { effect: 1, motion: 'warp' }],
        acts: [{ at: 'e4', act: 'moonwalk' }],
      },
      1,
    );
    // Only the whole-board area survives; the beat for a missing effect goes, an unknown motion falls back.
    expect(s.fx).toEqual([expect.objectContaining({ shape: 'area', at: null, to: null })]);
    expect(s.beats).toEqual([expect.objectContaining({ effect: 0, motion: 'default' })]);
    expect(s.acts).toEqual([]);
    expect(cleanStaging('junk', 0)).toEqual({ fx: [], shake: 0, beats: [], acts: [] });
  });

  it('allows at most six fx', () => {
    expect(cleanStaging({ fx: Array.from({ length: 10 }, () => fxItem()) }, 0).fx).toHaveLength(6);
  });

  it('a ruling with broken staging still parses; its staging is cleaned per outcome', () => {
    const raw = fakeRuling('b1 나이트를 투석기로 e5까지 날린다');
    const broken = { ...raw, staging: { ...raw.staging, failure: 'nonsense', critSuccess: { fx: [fxItem({ element: '???' })] } } };
    const parsed = parseGmRuling(broken);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.ruling.staging?.failure).toEqual({ fx: [], shake: 0, beats: [], acts: [] });
    expect(parsed.ruling.staging?.critSuccess?.fx).toEqual([]);
    expect(parsed.ruling.staging?.success?.beats[0]).toMatchObject({ effect: 0, motion: 'fly' });
    // And without any staging at all.
    const { staging: _gone, ...bare } = raw;
    void _gone;
    expect(parseGmRuling(bare).ok).toBe(true);
  });
});

describe('the engine carries staging', () => {
  const ruling = (staging: Ruling['staging'], effects: Effect[]): Ruling => ({
    interpretation: 'x', feasible: true, dc: 10, cost: 1, effects, narration: { success: 's', failure: 'f' }, staging,
  });
  const look: Staging = { fx: [], shake: 2, beats: [], acts: [] };

  it('the resolved event has the outcome effects and staging', () => {
    const effects: Effect[] = [{ type: 'move', from: sq('b1'), to: sq('c3') }];
    let s = { ...createInitialState(), ap: { white: 3, black: 0 } };
    s = ok(applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling: ruling({ success: look }, effects) })).state;
    const r = ok(applyCommand(s, { type: 'attemptSpecial', roll: 15 }));
    expect(r.events[0]).toMatchObject({ type: 'specialResolved', outcome: 'success', effects, staging: look });
  });

  it('a tag aura is stored on the tag', () => {
    const effects: Effect[] = [{ type: 'tag', at: sq('g1'), tag: '불타는 중', turns: 2, aura: { element: 'fire', strength: 3 } }];
    let s = { ...createInitialState(), ap: { white: 3, black: 0 } };
    s = ok(applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling: ruling(undefined, effects) })).state;
    const r = ok(applyCommand(s, { type: 'attemptSpecial', roll: 15 }));
    expect(r.state.board[sq('g1')]?.tags?.[0]).toMatchObject({ name: '불타는 중', aura: { element: 'fire', strength: 3 } });
  });
});

describe('show timeline', () => {
  const move: Effect = { type: 'move', from: sq('b1'), to: sq('c3') };
  const spawn: Effect = { type: 'spawn', at: sq('e4'), color: 'white', piece: 'pawn' };

  it('effects play one after another, each after its wait', () => {
    const t = buildTimeline(
      { fx: [], shake: 0, acts: [], beats: [{ effect: 1, wait: 0.5, motion: 'default', speed: 'normal', entrance: 'rise', exit: 'default' }] },
      [move, spawn],
    );
    expect(t.effectStarts[0]).toBe(0);
    expect(t.effectStarts[1]).toBeCloseTo(t.effectDurations[0] + 0.5);
    expect(t.length).toBeCloseTo(t.effectStarts[1] + t.effectDurations[1]);
  });

  it('fx start with their effect or from the start; a trail lasts as long as its piece moves', () => {
    const fx = (over: Partial<Staging['fx'][number]>) => ({ element: 'fire' as const, shape: 'burst' as const, at: sq('e4'), to: null, radius: 1, strength: 3, duration: 1, withEffect: null, delay: 0, ...over });
    const t = buildTimeline({ shake: 1, beats: [], acts: [], fx: [fx({ withEffect: 1, delay: 0.2 }), fx({ shape: 'trail', withEffect: 0 }), fx({ delay: 0.4 })] }, [move, spawn]);
    expect(t.fxStarts[0]).toBeCloseTo(t.effectStarts[1] + 0.2);
    expect(t.fxEnds[1]).toBeCloseTo(t.effectDurations[0] + 0.3);
    expect(t.fxStarts[2]).toBeCloseTo(0.4);
    expect(t.shakeAt).toBe(0);
  });

  it('slower moves take longer; the whole show fits in six seconds', () => {
    const beat = (speed: 'slow' | 'fast') => ({ effect: 0, wait: 0, motion: 'sneak' as const, speed, entrance: 'default' as const, exit: 'default' as const });
    const slow = buildTimeline({ fx: [], shake: 0, acts: [], beats: [beat('slow')] }, [move]);
    const fast = buildTimeline({ fx: [], shake: 0, acts: [], beats: [beat('fast')] }, [move]);
    expect(slow.length).toBeGreaterThan(fast.length);
    const many = buildTimeline({ fx: [], shake: 0, acts: [], beats: [] }, Array.from({ length: 8 }, () => ({ ...move })));
    expect(many.length).toBeCloseTo(6);
    expect(many.scale).toBeLessThan(1);
  });

  it('no staging: effects still play in order, with nothing else', () => {
    const t = buildTimeline(undefined, [move]);
    expect(t).toMatchObject({ fxStarts: [], actStarts: [], shakeAt: null, scale: 1 });
    expect(t.length).toBeGreaterThan(0);
  });
});
