import { describe, expect, it } from 'vitest';
import { aiExile, aiHints, evaluate, wanderRisk, aiShouldRoll, applyCommand, clashBuffs, clashCaptures, standing, chooseMove, createInitialState, createStateFrom, squareName, type AiLevel, type Effect, type GameState, type Ruling } from './index';
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
    expect(aiShouldRoll(pending(7, 2, [stun('b4')], 1), 'easy')).toBe(false);
  });

  it('보통 rolls at 42% (DC 8), not at 28% (DC 9)', () => {
    expect(aiShouldRoll(pending(8, 1, [stun('b4')]), 'normal')).toBe(true);
    // The same DC, but 6 squares off by magic: -1 for distance, so 28%.
    expect(aiShouldRoll(pending(8, 1, [stun('h7')]), 'normal')).toBe(false);
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


describe("the watchers' standing bar (standing)", () => {
  it('even at the start, far ahead a queen up, all of it to the winner', () => {
    const start = standing(createInitialState());
    expect(start.white).toBeGreaterThan(0.4);
    expect(start.white).toBeLessThan(0.6);
    const up = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d1: { color: 'white', type: 'queen' } }, 'black');
    expect(standing(up).white).toBeGreaterThan(0.9);
    expect(standing({ ...up, status: { kind: 'won', winner: 'black' } })).toEqual({ white: 0, black: 1 });
  });

  it('a capture under way counts as made (no flicker mid-exchange)', () => {
    // A rook down on the board, but black's rook on a4 hangs to the white queen, white to move: about even.
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d1: { color: 'white', type: 'queen' }, a4: { color: 'black', type: 'rook' }, h7: { color: 'black', type: 'queen' } }, 'white');
    expect(standing(s).white).toBeGreaterThan(0.4);
    expect(standing({ ...s, turn: 'black' }).white).toBeLessThan(0.3);
  });

  it('three sides share it on the hexagon', () => {
    const shares = standing(createInitialState(undefined, 'hex3'));
    const total = (shares.white ?? 0) + (shares.black ?? 0) + (shares.red ?? 0);
    expect(total).toBeCloseTo(1);
    expect(shares.red).toBeGreaterThan(0.2);
  });
});

describe('clashes in what the AI is told (clashCaptures, clashBuffs, aiHints)', () => {
  // White's d4 piece next to a black rook with 검술 ×1.5 (×1.8 in a clash).
  const pos = (attacker: 'pawn' | 'queen'): GameState => {
    const s = createStateFrom({ a1: { color: 'white', type: 'king' }, h8: { color: 'black', type: 'king' }, d4: { color: 'white', type: attacker }, e5: { color: 'black', type: 'rook' }, a7: { color: 'black', type: 'pawn' } }, 'white');
    const board = [...s.board];
    board[sq('e5')] = { ...board[sq('e5')]!, tags: [{ name: '검술', turnsLeft: null, appliedOnTurn: 0, clash: 1.5 }] };
    return { ...s, board };
  };

  it('a capture into a clash has its odds: a pawn seldom wins, a queen 40% and has more to lose', () => {
    const [pawn] = clashCaptures(pos('pawn'), 'white');
    expect(pawn).toMatchObject({ from: sq('d4'), to: sq('e5'), attack: 0.8, defense: 1.8 });
    expect(pawn.chance).toBeLessThan(0.1);
    expect(pawn.gain).toBeLessThan(0);
    const [queen] = clashCaptures(pos('queen'), 'white');
    expect(queen.chance).toBeCloseTo(0.4, 1);
    expect(queen.gain).toBeLessThan(0);
  });

  it('a ×2 buff makes the pawn worth sending; ×1.4 does not', () => {
    const [plan] = clashBuffs(pos('pawn'), 'white', 2);
    expect(plan).toMatchObject({ from: sq('d4'), to: sq('e5') });
    expect(plan.buffedChance).toBeGreaterThan(0.35);
    expect(plan.buffedGain).toBeGreaterThan(0);
    expect(clashBuffs(pos('pawn'), 'white', 1.4)).toEqual([]);
  });

  it("a ruling that walks into the clash counts the clash's odds (not a sure win)", () => {
    const ruling = (effects: Effect[]): Ruling => ({ interpretation: 'x', feasible: true, dc: 7, cost: 2, actor: sq('d4'), means: 'touch', effects, narration: { success: 's', failure: 'f' } });
    const propose = (effects: Effect[]) => ok(applyCommand({ ...pos('pawn'), ap: { ...pos('pawn').ap, white: 4 } }, { type: 'proposeSpecial', action: 'x', ruling: ruling(effects) })).state;
    const sword: Effect = { type: 'tag', at: sq('e5'), tag: '검술', turns: 0, clash: 1.5 };
    // The pawn charges first (×0.8 against ×1.8: 7%), the sword comes after: not worth it.
    expect(aiShouldRoll(propose([{ type: 'move', from: sq('d4'), to: sq('e5') }, sword]), 'hard')).toBe(false);
    // A stab is no way round it: an instant kill on a piece with clash gear is the same clash (사용자 요청).
    expect(aiShouldRoll(propose([{ type: 'remove', at: sq('e5') }]), 'hard')).toBe(false);
  });

  it('the hints never call such a rook a free capture, and give the odds and the plan', () => {
    const hints = aiHints(pos('pawn'), 'white').join('\n');
    expect(hints).not.toMatch(/기회/);
    expect(hints).toMatch(/합 표적.*e5 룩 ×1\.8\(검술\).*d4 폰 ×0\.8의 승률 7%/);
    expect(hints).toMatch(/합 계획.*d4 폰에 합 배율 태그를 주면 e5 룩을\(를\) 잡을 확률 7% → ×2면 \d+%\(배율 판정 DC 9 성공까지 치면 약 \d+%\)/);
  });
});

describe('gray wanderers as the AI sees them (사용자 요청)', () => {
  // White: king a1, queen d4, bishop c2 (it can take f5). A gray knight on f5 could take the queen on d4.
  function scene(): GameState {
    const s = createStateFrom({ a1: { color: 'white', type: 'king' }, d4: { color: 'white', type: 'queen' }, c2: { color: 'white', type: 'bishop' }, h8: { color: 'black', type: 'king' }, h7: { color: 'black', type: 'pawn' } }, 'white');
    const board = [...s.board];
    board[sq('f5')] = { id: 'g1', color: 'gray', type: 'knight', tags: [{ name: '떠돌이 기사', turnsLeft: null, appliedOnTurn: 1 }] };
    return { ...s, board };
  }

  it('counts what a wanderer may take as a risk (by the chance it picks that step)', () => {
    const s = scene();
    const risk = wanderRisk(s.board, [sq('f5')]);
    // A knight on f5 has 8 steps; one takes the queen.
    expect(risk.white).toBeCloseTo(9 / 8, 1);
    const without = s.board.map((p, i) => (i === sq('f5') ? null : p));
    expect(evaluate(s.board, 'white')).toBeLessThan(evaluate(without, 'white'));
  });

  it('does not leave its queen where a wanderer may take it, even for a free knight elsewhere', () => {
    // A gray knight in the corner (a8) has one step (the king on c7 cannot be taken): onto the queen
    // on b6. The bishop could take a free knight on e5 instead (+3.2), which it would without the risk.
    const base = createStateFrom({ c7: { color: 'white', type: 'king' }, b6: { color: 'white', type: 'queen' }, c3: { color: 'white', type: 'bishop' }, h1: { color: 'black', type: 'king' }, e5: { color: 'black', type: 'knight' } }, 'white');
    const board = [...base.board];
    board[sq('a8')] = { id: 'g2', color: 'gray', type: 'knight' };
    for (const level of ['normal', 'hard'] as AiLevel[]) {
      const s = { ...base, board };
      const m = chooseMove(s, level, () => 0.5)!;
      const after = ok(applyCommand(s, { type: 'move', from: m.from, to: m.to! })).state;
      const wanderers = after.board.flatMap((p, i) => (p?.color === 'gray' ? [i] : []));
      expect(wanderRisk(after.board, wanderers).white ?? 0).toBe(0);
    }
  });

  it('tells its model about the wanderer: what it may take, the odds, and that it can be taken', () => {
    const hints = aiHints(scene(), 'white').join('\n');
    expect(hints).toMatch(/떠돌이\(회색.*f5 나이트\(떠돌이 기사\): 내 d4 퀸을\(를\) 잡을 수 있음\(수마다 1\/8\), 내 기물로 잡을 수 있음/);
  });
});
