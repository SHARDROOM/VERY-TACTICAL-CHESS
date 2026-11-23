import { describe, expect, it } from 'vitest';
import { actionReach, applyCommand, applyEffects, createStateFrom, distancePenalty, modifierTotal, rollModifiers, type Effect, type GameState, type Piece, type Ruling, type Tag } from './index';
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

describe('sacrifice (희생)', () => {
  /** Kings, a white knight d4 (actor), white pawn e3 and rook c4 next to it, a far white queen h1, black pawn d6. */
  function altar(): GameState {
    const s = scene();
    const board = [...s.board];
    board[sq('e3')] = { id: 'pe3', color: 'white', type: 'pawn' };
    board[sq('c4')] = { id: 'rc4', color: 'white', type: 'rook' };
    board[sq('h1')] = { id: 'qh1', color: 'white', type: 'queen' };
    board[sq('c3')] = { id: 'bc3', color: 'white', type: 'bishop' };
    return { ...s, board };
  }
  const offering = (over: Partial<Ruling> = {}) =>
    ruling({ interpretation: '제물을 바쳐 나이트가 강해진다', effects: [{ type: 'tag', at: sq('d4'), tag: '피의 맹세', turns: 2, clash: 1.5 }], sacrifice: [sq('e3'), sq('c4')], ...over });
  /** The same offering for a plain skill (no multiplier). */
  const forSkill = (over: Partial<Ruling> = {}) => offering({ effects: [{ type: 'tag', at: sq('d4'), tag: '광전사', turns: 2, skill: { about: '돌격', bonus: 2 } }], ...over });

  it('pieces next to the actor are given up when the dice are thrown, even on a failure; several help the roll only as much as the strongest (사용자 요청)', () => {
    const r = roll(altar(), forSkill(), 5);
    const resolved = r.events.find((e) => e.type === 'specialResolved');
    // A pawn and a rook help the roll as the rook alone: 5 + 3 = 8 < 9, a failure, and both are gone anyway.
    expect(resolved).toMatchObject({ outcome: 'failure', bonus: 3, mods: [{ kind: 'sacrifice', value: 3, label: '제물 폰 e3, 룩 c4 (확률은 가장 센 하나만)' }] });
    // One piece is counted as before.
    const pawn = roll(altar(), forSkill({ sacrifice: [sq('e3')] }), 5);
    expect(pawn.events.find((e) => e.type === 'specialResolved')).toMatchObject({ bonus: 1, mods: [{ kind: 'sacrifice', value: 1, label: '제물 폰 e3' }] });
    expect(r.state.board[sq('e3')]).toBeNull();
    expect(r.state.board[sq('c4')]).toBeNull();
    expect(r.events.filter((e) => e.type === 'removed' && e.cause === 'sacrifice')).toHaveLength(2);
    expect(r.state.captured?.map((c) => c.id)).toEqual(expect.arrayContaining(['pe3', 'rc4']));
  });

  it('given up for a clash multiplier, the offering raises it by its worth and helps the roll a third as much (사용자 요청)', () => {
    // A pawn and a rook (1 + 3 = 4): ×1.5 + 0.4 = ×1.9, and +1 (4 / 3) on the dice.
    const r = roll(altar(), offering(), 8);
    expect(r.events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'success', bonus: 1, mods: [{ kind: 'sacrifice', value: 1, worth: 4 }] });
    expect(r.state.board[sq('d4')]?.tags?.[0]).toMatchObject({ clash: 1.9 });
    // A pawn alone: ×1.6. Stronger and more pieces give more.
    const pawn = roll(altar(), offering({ sacrifice: [sq('e3')] }), 9);
    expect(pawn.state.board[sq('d4')]?.tags?.[0]).toMatchObject({ clash: 1.6 });
    // A rook and a bishop (3 + 2 = 5): the multiplier takes all of it (×2.0), the dice a third of the rook alone (+1, not +2).
    const two = roll(altar(), offering({ sacrifice: [sq('c4'), sq('c3')] }), 8);
    expect(two.events.find((e) => e.type === 'specialResolved')).toMatchObject({ bonus: 1, mods: [{ kind: 'sacrifice', value: 1, worth: 5 }] });
    expect(two.state.board[sq('d4')]?.tags?.[0]).toMatchObject({ clash: 2 });
  });

  it('a second try after a failure keeps the offering (and its multiplier) without giving anything more', () => {
    const first = roll(altar(), offering(), 4).state;
    expect(first.pending?.offered).toHaveLength(1);
    const again = ok(applyCommand(first, { type: 'attemptSpecial', roll: 8 }));
    expect(again.events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'success', bonus: 1 });
    expect(again.events.some((e) => e.type === 'removed' && e.cause === 'sacrifice')).toBe(false);
    expect(again.state.board[sq('d4')]?.tags?.[0]).toMatchObject({ clash: 1.9 });
  });

  it('with a sacrifice a skill may be stronger (±4); a multiplier stays within ×2 as given (the system adds the offering)', () => {
    const s = altar();
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: offering() }).ok).toBe(true);
    const over = offering({ effects: [{ type: 'tag', at: sq('d4'), tag: '피의 맹세', turns: 2, clash: 2.5 }] });
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: over })).toMatchObject({ ok: false, reason: 'invalidRuling' });
    const skill4 = offering({ effects: [{ type: 'tag', at: sq('d4'), tag: '광전사', turns: 2, skill: { about: '돌격', bonus: 4 } }] });
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: skill4 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: { ...skill4, sacrifice: [] } })).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });

  it("refuses a far piece, a king, the actor itself and someone else's piece", () => {
    const s = altar();
    const refused = (sacrifice: string[]) => applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: offering({ sacrifice: sacrifice.map(sq) }) });
    expect(refused(['h1'])).toMatchObject({ ok: false, detail: expect.stringContaining('1칸') });
    expect(refused(['e1'])).toMatchObject({ ok: false });
    expect(refused(['d4'])).toMatchObject({ ok: false, detail: expect.stringContaining('주체') });
    expect(refused(['d6'])).toMatchObject({ ok: false });
  });

  it('a snake-eyes throw still takes the offering', () => {
    const r = roll(altar(), offering(), 2);
    expect(r.events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'critFailure' });
    expect(r.state.board[sq('e3')]).toBeNull();
  });
});

describe('distance (거리)', () => {
  it('costs more the farther, by how the actor reaches', () => {
    expect([1, 2, 3, 4, 8, 12].map((d) => distancePenalty('touch', d))).toEqual([0, -1, -1, -2, -4, -4]);
    expect([2, 3, 4, 5, 8, 12].map((d) => distancePenalty('ranged', d))).toEqual([0, -1, -1, -2, -3, -4]);
    expect([3, 4, 6, 7, 12].map((d) => distancePenalty('magic', d))).toEqual([0, -1, -1, -2, -3]);
  });

  it("counts the actor's run, then what it reaches from where it stopped", () => {
    const r = (effects: Effect[], means: Ruling['means'] = 'touch'): Ruling => ({ interpretation: 'x', feasible: true, dc: 7, cost: 2, actor: sq('b1'), means, effects, narration: { success: 's', failure: 'f' } });
    // b1 runs to c6 (5 squares) and strikes d7 next to it.
    const charge = r([{ type: 'move', from: sq('b1'), to: sq('c6') }, { type: 'remove', at: sq('d7') }]);
    expect(actionReach(charge)).toBe(5);
    expect(rollModifiers(createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, b1: { color: 'white', type: 'knight' }, d7: { color: 'black', type: 'pawn' } }, 'white').board, charge, 'white')).toEqual([
      { kind: 'distance', label: '5칸 근접', value: -2 },
    ]);
    // A shot from b1 at h7: 6 squares.
    expect(actionReach(r([{ type: 'remove', at: sq('h7') }], 'ranged'))).toBe(6);
  });
});
