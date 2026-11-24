import { describe, expect, it } from 'vitest';
import { GmError } from '../gm/errors';
import { FailoverGameMaster } from '../gm/failover';
import { fakeRuling } from '../gm/fakeGm';
import type { GameMaster, GmRequest } from '../gm/types';
import { memoryChannelPair } from './channel';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';

/* While the GM rules, everyone sees which GM is being asked (GM 속도, 사용자 요청). */

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await tick();
};

describe('the GM being asked, as everyone sees it', () => {
  it('a guest sees the name change when the host’s GM goes on to a backup mid-ruling', async () => {
    let answer: () => void = () => {};
    const main: GameMaster = { name: 'Gemini GM', rule: async () => { throw new GmError('busy', 'busy'); } };
    const backup: GameMaster = {
      name: 'Groq GM',
      rule: (req: GmRequest) => new Promise((r) => (answer = () => r(fakeRuling(req.action, req.state.turn)))),
    };
    const gm = new FailoverGameMaster([{ gm: main, label: 'Gemini' }, { gm: backup, label: '예비 1' }]);
    const [hostEnd, guestEnd] = memoryChannelPair();
    const host = new HostSession(gm, { code: 'ABC234', link: 'x', roll: () => 6, heartbeatMs: 0 });
    host.attachGuest(hostEnd);
    const guest = new GuestSession(guestEnd, { heartbeatMs: 0, id: 'g1', name: '친구' });
    host.takeSeat('white');
    await settle();
    guest.takeSeat('black');
    await settle();
    host.start();
    await settle();
    host.request({ type: 'declare', action: 'e2 폰이 e3로 뛴다' });
    await settle();
    expect(guest.view().gmBusy).toBe(true);
    expect(guest.view().gmName).toBe('Groq GM · 예비 1');
    answer();
    await settle();
    expect(guest.view().gmBusy).toBe(false);
  });
});
