import { describe, expect, it } from 'vitest';
import { fakeRuling } from '../gm/fakeGm';
import type { GameMaster, GmRequest } from '../gm/types';
import { memoryChannelPair } from './channel';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';
import { parseToyOp, type ToyOp } from './toy';
import type { SessionEvent } from './types';

/* 상대 시선 (사용자 요청): where a player's camera looks goes to the others in the room. */

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};
const gm: GameMaster = { name: 'Test GM', rule: async (req: GmRequest) => fakeRuling(req.action, req.state.turn) };

describe('a look between screens', () => {
  it('only a well-formed look gets through', () => {
    expect(parseToyOp({ op: 'gaze', id: 'black', from: [0, 7, -9], at: [0, 0, 0.5] })).toEqual({ op: 'gaze', id: 'black', from: [0, 7, -9], at: [0, 0, 0.5] });
    expect(parseToyOp({ op: 'gaze', id: 'spectator', from: [0, 7, -9], at: [0, 0, 0] })).toBeNull();
    expect(parseToyOp({ op: 'gaze', id: 'white', from: [0, 7e6, -9], at: [0, 0, 0] })).toBeNull();
    expect(parseToyOp({ op: 'gaze', id: 'white', from: [0, 7], at: [0, 0, 0] })).toBeNull();
  });

  it("the host's look reaches the guest, and the guest's the host", async () => {
    const [hostEnd, guestEnd] = memoryChannelPair();
    const host = new HostSession(gm, { code: 'ABC234', link: 'x', roll: () => 6, heartbeatMs: 0 });
    host.attachGuest(hostEnd);
    const guest = new GuestSession(guestEnd, { heartbeatMs: 0, id: 'g1', name: '친구' });
    await settle();
    const seen = (s: HostSession | GuestSession) => {
      const got: ToyOp[] = [];
      s.subscribe((e: SessionEvent) => e.kind === 'toy' && got.push(e.op));
      return got;
    };
    const atGuest = seen(guest);
    const atHost = seen(host);
    host.toy({ op: 'gaze', id: 'white', from: [0, 7, 9], at: [0, 0, 0] });
    guest.toy({ op: 'gaze', id: 'black', from: [0, 7, -9], at: [1, 0, 0] });
    await settle();
    expect(atGuest).toEqual([{ op: 'gaze', id: 'white', from: [0, 7, 9], at: [0, 0, 0] }]);
    expect(atHost).toEqual([{ op: 'gaze', id: 'black', from: [0, 7, -9], at: [1, 0, 0] }]);
  });
});
