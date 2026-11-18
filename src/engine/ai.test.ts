import { describe, expect, it } from 'vitest';
import { aiExile, chooseMove, createInitialState, createStateFrom, squareName, type AiLevel, type GameState } from './index';
import { sq } from './testUtil';

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
