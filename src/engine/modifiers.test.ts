import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, createStateFrom, modifierTotal, rollModifiers, type GameState, type Piece, type Ruling, type Tag } from './index';
import { ok, sq } from './testUtil';

const tag = (name: string, extra: Partial<Tag>): Tag => ({ name, turnsLeft: 3, appliedOnTurn: 0, ...extra });

/** Kings on e1/e8, a white knight on d4 (with `tags`), a black pawn on d6, white to move with AP. */
function scene(knightTags: Tag[] = [], pawnTags: Tag[] = [], rider?: Piece): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, 'white');
  const board = [...s.board];
  board[sq('d4')] = { id: 'n', color: 'white', type: 'knight', tags: knightTags, ...(rider && { rider }) };
  board[sq('d6')] = { id: 'p', color: 'black', type: 'pawn', tags: pawnTags };
  return { ...s, board, ap: { ...s.ap, white: 6 } };
}

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  interpretation: '나이트가 d6 폰을 회유한다',
  actor: sq('d4'),
  means: 'magic',
  feasible: true,
  dc: 9,
  cost: 1,
  effects: [{ type: 'convert', at: sq('d6'), color: 'white' }],
  narration: { success: '성공', failure: '실패' },
  ...over,
});

const roll = (state: GameState, r: Ruling, n: number) => {
  const p = ok(applyCommand(state, { type: 'proposeSpecial', action: '회유', ruling: r })).state;
  return ok(applyCommand(p, { type: 'attemptSpecial', roll: n }));
};

describe('roll modifiers (판정 보정)', () => {
  const flag = tag('지휘의 깃발', { skill: { about: '함께 전진하는 행동', bonus: 2 } });

  it('a skill the GM names adds its bonus: 7 + 2 reaches DC 9', () => {
    const s = scene([flag]);
    const r = roll(s, ruling({ skills: ['지휘의 깃발'] }), 7);
    const resolved = r.events.find((e) => e.type === 'specialResolved');
    expect(resolved).toMatchObject({ outcome: 'success', roll: 7, bonus: 2, mods: [{ kind: 'skill', label: '지휘의 깃발', value: 2 }] });
    expect(r.state.precedents.at(-1)).toMatchObject({ roll: 7, bonus: 2 });
  });

  it('a skill the GM does not name adds nothing; nor a name the actor has no such tag for', () => {
    const s = scene([flag]);
    expect(roll(s, ruling(), 7).events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'failure' });
    expect(rollModifiers(s.board, ruling({ skills: ['없는 특기'] }), 'white')).toEqual([]);
  });

  it("a rider's skill counts for the actor's square", () => {
    const rider: Piece = { id: 'r', color: 'white', type: 'pawn', tags: [tag('탑승', {}), tag('건축가', { skill: { about: '지형 만들기', bonus: 3 } })] };
    const s = scene([], [], rider);
    expect(rollModifiers(s.board, ruling({ skills: ['건축가'] }), 'white')).toEqual([{ kind: 'skill', label: '건축가', value: 3 }]);
  });

  it("a mental action against another side's piece takes away its will", () => {
    const s = scene([], [tag('강철 의지', { mind: 2 })]);
    const mods = rollModifiers(s.board, ruling({ mental: true, target: sq('d6') }), 'white');
    expect(mods).toEqual([{ kind: 'mind', label: '강철 의지', value: -2 }]);
    // 10 - 2 = 8 < 9.
    expect(roll(s, ruling({ mental: true, target: sq('d6') }), 10).events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'failure', bonus: -2 });
    // A frightened mind is easier.
    const scared = scene([], [tag('겁에 질림', { mind: -2 })]);
    expect(modifierTotal(rollModifiers(scared.board, ruling({ mental: true, target: sq('d6') }), 'white'))).toBe(2);
  });

  it('will counts only for mental actions and only against another side', () => {
    const s = scene([tag('강철 의지', { mind: 2 })], [tag('강철 의지', { mind: 2 })]);
    expect(rollModifiers(s.board, ruling({ target: sq('d6') }), 'white')).toEqual([]);
    expect(rollModifiers(s.board, ruling({ mental: true, target: sq('d4') }), 'white')).toEqual([]);
  });

  it('all together stay within ±4, and snake eyes still fail', () => {
    const s = scene([tag('a', { skill: { about: 'x', bonus: 3 } }), tag('b', { skill: { about: 'y', bonus: 3 } })]);
    const r = ruling({ skills: ['a', 'b'], dc: 3 });
    expect(modifierTotal(rollModifiers(s.board, r, 'white'))).toBe(4);
    expect(roll(s, r, 2).events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'critFailure' });
  });

  it('a tag effect carries a skill or a will within ±3', () => {
    const s = scene();
    const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'white' as const };
    const good = applyEffects(s.board, [{ type: 'tag', at: sq('d4'), tag: '건축가', turns: 3, skill: { about: '지형 만들기', bonus: 2 } }, { type: 'tag', at: sq('d6'), tag: '겁에 질림', turns: 2, mind: -2 }], ctx);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.board[sq('d4')]?.tags?.[0]).toMatchObject({ skill: { about: '지형 만들기', bonus: 2 } });
    expect(good.board[sq('d6')]?.tags?.[0]).toMatchObject({ mind: -2 });
    expect(applyEffects(s.board, [{ type: 'tag', at: sq('d4'), tag: 'x', turns: 1, skill: { about: 'y', bonus: 4 } }], ctx).ok).toBe(false);
    expect(applyEffects(s.board, [{ type: 'tag', at: sq('d4'), tag: 'x', turns: 1, mind: 5 }], ctx).ok).toBe(false);
  });
});
