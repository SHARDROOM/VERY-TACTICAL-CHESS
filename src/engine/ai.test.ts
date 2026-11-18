import { describe, expect, it } from 'vitest';
import { aiExile, aiShouldRoll, applyCommand, chooseMove, createInitialState, createStateFrom, squareName, type AiLevel, type Effect, type GameState, type Ruling } from './index';
import { ok, sq } from './testUtil';

const pick = (s: GameState, level: AiLevel, seed = 0.5) => {
  const m = chooseMove(s, level, () => seed);
  return m && `${squareName(m.from)}${m.to === null ? '-' : squareName(m.to)}`;
};

describe('AI moves (chooseMove)', () => {
  it('takes a free queen at every level but the easiest slips', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d1: { color: 'white', type: 'rook' }, d6: { color: 'black', type: 'queen' } }, 'white');
    for (const level of ['normal', 'hard', 'master'] as AiLevel[]) expect(pick(s, level)).toBe('d1d6');
  });

  it('takes the king when it can (the game ends there)', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a8: { color: 'white', type: 'rook' }, h2: { color: 'black', type: 'queen' } }, 'white');
    expect(pick(s, 'normal')).toBe('a8e8');
  });

  it('does not leave its queen to be taken for nothing', () => {
    // The white queen on d4 is attacked by the black bishop on b6... wait for the reply: it must move or be covered.
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'white', type: 'queen' }, b6: { color: 'black', type: 'bishop' }, a2: { color: 'white', type: 'pawn' } }, 'white');
    const m = chooseMove(s, 'normal', () => 0.5)!;
    // Either the queen takes the bishop, or it leaves the diagonal.
    expect(m.to === sq('b6') || m.from === sq('d4')).toBe(true);
  });

  it('finds a knight fork three plies deep (어려움 and 무아)', () => {
    // Nc7+ forks the king on e8 and the rook on a8.
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a8: { color: 'black', type: 'rook' }, b5: { color: 'white', type: 'knight' }, h7: { color: 'black', type: 'pawn' } }, 'white');
    expect(pick(s, 'hard')).toBe('b5c7');
    expect(pick(s, 'master')).toBe('b5c7');
  });

  it('thinks within its time; 무아 stops at four seconds', () => {
    const s = createInitialState();
    const t0 = performance.now();
    expect(chooseMove(s, 'normal')).not.toBeNull();
    expect(performance.now() - t0).toBeLessThan(1500);
    const t1 = performance.now();
    expect(chooseMove(s, 'master')).not.toBeNull();
    expect(performance.now() - t1).toBeLessThan(5000);
  }, 20000);

  it('plays on the hexagon too', () => {
    const s = createInitialState(undefined, 'hex3');
    const m = chooseMove(s, 'normal', () => 0.3);
    expect(m).not.toBeNull();
  });

  it('a surrendering AI keeps its strongest piece', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'black', type: 'knight' }, d5: { color: 'black', type: 'queen' } }, 'white');
    expect(aiExile(s, 'black')).toBe(sq('d5'));
  });
});

describe('AI rolls for its ruling (aiShouldRoll)', () => {
  // White (the AI) to act; the black queen on b4 eyes the white rook on e1 (and nothing of white's hits it).
  const board = () =>
    createStateFrom(
      { g1: { color: 'white', type: 'king' }, g8: { color: 'black', type: 'king' }, e1: { color: 'white', type: 'rook' }, b2: { color: 'white', type: 'bishop' }, b4: { color: 'black', type: 'queen' }, h7: { color: 'black', type: 'pawn' } },
      'white',
    );
  const stun = (at: string): Effect => ({ type: 'tag', at: sq(at), tag: '기절', turns: 1 });
  const pending = (dc: number, cost: number, effects: Effect[], ap = 3): GameState => {
    const r: Ruling = { interpretation: 'x', feasible: true, dc, cost, actor: sq('b2'), means: 'magic', effects, narration: { success: 's', failure: 'f' } };
    const s = board();
    return ok(applyCommand({ ...s, ap: { ...s.ap, white: ap } }, { type: 'proposeSpecial', action: 'b2 비숍이 b4 퀸을 기절시킨다', ruling: r })).state;
  };

  it('쉬움 rolls whatever comes, if it can pay', () => {
    expect(aiShouldRoll(pending(11, 2, [stun('h7')]), 'easy')).toBe(true);
    expect(aiShouldRoll(pending(7, 3, [stun('b4')], 2), 'easy')).toBe(false);
  });

  it('보통 rolls at 42% (DC 8), not at 28% (DC 9)', () => {
    expect(aiShouldRoll(pending(8, 1, [stun('h7')]), 'normal')).toBe(true);
    expect(aiShouldRoll(pending(9, 1, [stun('b4')]), 'normal')).toBe(false);
  });

  it('어려움 and 무아 roll a stun on the queen (it is worth something besides pieces taken), not a long shot at a pawn', () => {
    for (const level of ['hard', 'master'] as AiLevel[]) {
      expect(aiShouldRoll(pending(7, 1, [stun('b4')]), level)).toBe(true);
      expect(aiShouldRoll(pending(11, 2, [stun('h7')]), level)).toBe(false);
      // Taking the queen off the board is worth even a long shot.
      expect(aiShouldRoll(pending(10, 2, [{ type: 'remove', at: sq('b4') }]), level)).toBe(true);
    }
  });
});

