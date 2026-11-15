import { describe, expect, it } from 'vitest';
import { AIR, LEVITATE, createStateFrom, parseSquare, type GameState } from '../engine';
import { fakeRuling } from '../gm/fakeGm';
import type { GameMaster } from '../gm/types';
import { LocalSession } from './localSession';
import type { FallQuery } from './authority';

const sq = (n: string) => parseSquare(n)!;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const gm: GameMaster = { name: 'test', rule: async (req) => fakeRuling(req.action, req.state.turn, req.state.board) };

/** White's rook floats above d4 with one turn of levitation left. */
function floatingRook(): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'white', type: 'rook' }, a2: { color: 'white', type: 'pawn' } }, 'white');
  const board = [...s.board];
  board[sq('d4') + AIR] = { ...board[sq('d4')]!, tags: [{ name: LEVITATE, turnsLeft: 1, appliedOnTurn: 0 }] };
  board[sq('d4')] = null;
  return { ...s, board };
}

describe('falls on the authority', () => {
  it('when a levitation runs out the physics is asked where the piece rests, and it lands there', async () => {
    const asked: FallQuery[] = [];
    const session = new LocalSession(gm, {
      initialState: floatingRook(),
      phase: 'playing',
      fall: async (q) => {
        asked.push(q);
        return [{ id: 'white-rook-d4', file: 4.2, rank: 3.1 }];
      },
    });
    const kinds: string[] = [];
    session.subscribe((e) => {
      if (e.kind === 'events') kinds.push(...e.events.map((x) => x.type));
    });
    session.request({ type: 'move', from: sq('a2'), to: sq('a3') });
    await settle();
    expect(asked).toHaveLength(1);
    expect(asked[0].falling.map((f) => f.piece.id)).toEqual(['white-rook-d4']);
    expect(kinds).toContain('fallStarted');
    expect(kinds).toContain('fell');
    const state = session.view().state;
    expect(state.falling).toBeUndefined();
    expect(state.board[sq('e4')]?.type).toBe('rook');
    expect(state.turn).toBe('black');
    session.dispose();
  });

  it('without physics (or if it fails) the piece drops straight down', async () => {
    const session = new LocalSession(gm, { initialState: floatingRook(), phase: 'playing', fall: async () => Promise.reject(new Error('no wasm')) });
    session.request({ type: 'move', from: sq('a2'), to: sq('a3') });
    await settle();
    expect(session.view().state.board[sq('d4')]?.type).toBe('rook');
    session.dispose();
  });
});
