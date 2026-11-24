import { describe, expect, it } from 'vitest';
import { fakeRuling } from '../gm/fakeGm';
import type { GameMaster, GmRequest } from '../gm/types';
import { LocalSession } from './localSession';

/* 랜덤 시나리오 (사용자 요청), chosen in the waiting room. */
const gm: GameMaster = { name: 'Test GM', rule: async (req: GmRequest) => fakeRuling(req.action, req.state.turn) };

describe('a random scenario chosen in the waiting room', () => {
  it('starts the game in one, read out from the state; off, the board is the usual one', () => {
    const s = new LocalSession(gm, { roll: () => 6 });
    s.setRules({ scenario: true });
    expect(s.view().state.rules.scenario).toBe(true);
    s.start();
    expect(s.view().state.scenario?.title).toBeTruthy();
    s.dispose();
    const plain = new LocalSession(gm, { roll: () => 6 });
    plain.start();
    expect(plain.view().state.scenario).toBeUndefined();
    plain.dispose();
  });
});
