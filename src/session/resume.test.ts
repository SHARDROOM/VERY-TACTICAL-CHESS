import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare, type GameState, type Ruling } from '../engine';
import type { GameMaster, GmRequest } from '../gm/types';
import { fakeRuling } from '../gm/fakeGm';
import { createGm } from '../gm/createGm';
import { memoryChannelPair } from './channel';
import { HostSession } from './hostSession';
import { GuestSession } from './guestSession';
import { LocalSession } from './localSession';
import { browserId, clearSavedGame, gmForSave, gmFromSave, loadSavedGame, saveGame } from './storage';

const sq = (n: string) => parseSquare(n)!;
const settle = async (ms = 0) => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, ms));
};

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

class TestGm implements GameMaster {
  readonly name = 'Test GM';
  async rule(req: GmRequest) {
    return fakeRuling(req.action);
  }
}

/** A mid-game state with tags, a rider, a pending ruling and precedents. */
function busyState(): GameState {
  let s: GameState = { ...createInitialState(), ap: { white: 5, black: 5 } };
  const act = (effects: Ruling['effects'], roll = 20) => {
    const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 10, cost: 1, effects, narration: { success: 's', failure: 'f' } };
    const p = applyCommand(s, { type: 'proposeSpecial', action: 'act', ruling });
    if (!p.ok) throw new Error(p.reason);
    const a = applyCommand(p.state, { type: 'attemptSpecial', roll });
    if (!a.ok) throw new Error(a.reason);
    s = a.state;
  };
  act([{ type: 'tag', at: sq('g8'), tag: '기절', turns: 1 }]);
  act([{ type: 'board', rider: sq('a2'), carrier: sq('b1') }]);
  act([{ type: 'tag', at: sq('b1'), tag: '불타는 중', turns: 0 }]);
  const ruling: Ruling = { interpretation: 'pending', feasible: true, dc: 12, cost: 1, effects: [{ type: 'move', from: sq('g1'), to: sq('f3') }], narration: { success: 's', failure: 'f' } };
  const p = applyCommand(s, { type: 'proposeSpecial', action: 'still deciding', ruling });
  if (!p.ok) throw new Error(p.reason);
  return p.state;
}

describe('saved games', () => {
  it('round-trips the whole state: tags with turns left, riders, pending ruling, precedents', () => {
    const storage = new MemoryStorage();
    const state = busyState();
    saveGame({ kind: 'host', code: 'ABC234', state, gm: { provider: 'claude', model: 'claude-opus-5-5', effort: 'low' } }, storage, 1000);
    const loaded = loadSavedGame(storage);
    expect(loaded).toMatchObject({ version: 1, kind: 'host', code: 'ABC234', savedAt: 1000 });
    expect(loaded!.state).toEqual(JSON.parse(JSON.stringify(state)));
    expect(loaded!.state.board[sq('b1')]?.rider?.type).toBe('pawn');
    expect(loaded!.state.pending?.action).toBe('still deciding');
    expect(loaded!.state.precedents).toHaveLength(3);
  });

  it('keeps how captured pieces left and the auras on tags', () => {
    const storage = new MemoryStorage();
    const board = [...createInitialState().board];
    board[sq('e2')] = { ...board[sq('e2')]!, tags: [{ name: '불타는 중', turnsLeft: 2, appliedOnTurn: 1, aura: { element: 'fire', strength: 3 } }] };
    const state: GameState = {
      ...createInitialState(),
      board,
      captured: [{ id: 'b-p-d', color: 'black', type: 'pawn', exit: 'ash' }, { id: 'b-n-b', color: 'black', type: 'knight' }],
    };
    saveGame({ kind: 'hotseat', state, gm: { provider: 'fake' } }, storage);
    const back = loadSavedGame(storage)!.state;
    expect(back.captured).toEqual(state.captured);
    expect(back.board[sq('e2')]?.tags?.[0].aura).toEqual({ element: 'fire', strength: 3 });
  });

  it('a restored state keeps playing exactly like the original', () => {
    const storage = new MemoryStorage();
    const state = busyState();
    saveGame({ kind: 'hotseat', state, gm: { provider: 'fake' } }, storage);
    const restored = loadSavedGame(storage)!.state;
    const a = applyCommand(state, { type: 'attemptSpecial', roll: 15 });
    const b = applyCommand(restored, { type: 'attemptSpecial', roll: 15 });
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
  });

  it('never stores the API key', () => {
    const storage = new MemoryStorage();
    const gm = gmForSave({ provider: 'openai', apiKey: 'sk-secret-123', model: 'gpt-6.1-sol' });
    saveGame({ kind: 'hotseat', state: createInitialState(), gm }, storage);
    expect(storage.getItem('vtc.save.v1')).not.toContain('sk-secret-123');
    expect(gmFromSave(loadSavedGame(storage)!.gm)).toEqual({ provider: 'openai', apiKey: '', model: 'gpt-6.1-sol' });
  });

  it('discards broken or foreign data', () => {
    const storage = new MemoryStorage();
    storage.setItem('vtc.save.v1', '{not json');
    expect(loadSavedGame(storage)).toBeNull();
    storage.setItem('vtc.save.v1', JSON.stringify({ version: 1, kind: 'host', gm: { provider: 'fake' }, state: { board: [] } }));
    expect(loadSavedGame(storage)).toBeNull();
    expect(storage.getItem('vtc.save.v1')).toBeNull();
    saveGame({ kind: 'hotseat', state: createInitialState(), gm: { provider: 'fake' } }, storage);
    clearSavedGame(storage);
    expect(loadSavedGame(storage)).toBeNull();
  });

  it('keeps one stable random id per browser', () => {
    const storage = new MemoryStorage();
    const id = browserId(storage);
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    expect(browserId(storage)).toBe(id);
  });

  it('a reloaded game without its key gets a GM that asks for the key', async () => {
    const gm = createGm(gmFromSave({ provider: 'claude', model: 'claude-opus-5-5', effort: 'low' }));
    expect(gm.name).toContain('API 키 필요');
    await expect(gm.rule({ action: 'x', state: createInitialState() })).rejects.toThrow(/다시 입력/);
  });

  it('hotseat and host sessions resume from a saved state', () => {
    const state = busyState();
    const local = new LocalSession(new TestGm(), { roll: () => 20, initialState: state, phase: 'playing' });
    expect(local.view()).toMatchObject({ state, phase: 'playing' });
    const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', initialState: state, heartbeatMs: 0, black: { id: 'guest-1', name: '친구' } });
    expect(host.view()).toMatchObject({ state, phase: 'playing' });
    // The black seat waits for its player.
    expect(host.view().members.map((m) => [m.name, m.role, m.online])).toEqual([['방장', 'white', true], ['친구', 'black', false]]);
  });

  it('old saves (before the newer rules) load with the default rules filled in', () => {
    const storage = new MemoryStorage();
    const state = createInitialState();
    const { turnSeconds, chaosChance, doodle, timeoutPenalty, ...oldRules } = state.rules;
    void [turnSeconds, chaosChance, doodle, timeoutPenalty];
    saveGame({ kind: 'hotseat', state: { ...state, rules: oldRules as never }, gm: { provider: 'fake' } }, storage);
    expect(loadSavedGame(storage)?.state.rules).toMatchObject({ turnSeconds: 0, chaosChance: 0, doodle: true, timeoutPenalty: 1 });
  });

  it('a host save remembers who sat at black', () => {
    const storage = new MemoryStorage();
    saveGame({ kind: 'host', code: 'ABC234', state: createInitialState(), gm: { provider: 'fake' }, black: { id: 'guest-1', name: '친구' } }, storage);
    expect(loadSavedGame(storage)?.black).toEqual({ id: 'guest-1', name: '친구' });
  });
});

describe('reconnecting', () => {
  it('the guest pauses when the host goes away and picks up the saved game when the host is back', async () => {
    const state = busyState();
    let host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', initialState: state, heartbeatMs: 0 });
    const [h1, g1] = memoryChannelPair();
    host.attachGuest(h1);
    let reopen: (() => void) | null = null;
    const guest = new GuestSession(g1, {
      id: 'guest-1',
      heartbeatMs: 0,
      retryMs: 5,
      // Each reconnect knocks on whatever host currently holds the room.
      reconnect: () =>
        new Promise((resolve, reject) => {
          if (!reopen) return reject(new Error('host not back yet'));
          const [h, g] = memoryChannelPair();
          host.attachGuest(h);
          resolve(g);
        }),
    });
    await settle();
    expect(guest.view().connection).toEqual({ kind: 'connected' });

    // The host reloads the page: the old session is gone.
    host.dispose();
    await settle();
    expect(guest.view().connection).toMatchObject({ kind: 'paused' });

    // The host comes back with the saved state under the same room, keeping black's seat.
    host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', initialState: state, heartbeatMs: 0, black: { id: 'guest-1', name: '친구' } });
    reopen = () => {};
    await settle(10);
    expect(guest.view()).toMatchObject({ connection: { kind: 'connected' }, seat: 'black', phase: 'playing' });
    expect(guest.view().state).toEqual(JSON.parse(JSON.stringify(state)));

    // ...and play continues: the pending ruling can still be attempted (it is white's).
    host.request({ type: 'attempt' });
    await settle();
    expect(guest.view().state.pending).toBeNull();
    guest.dispose();
  });

  it('a guest coming back on a new connection replaces their stale one (same id)', async () => {
    const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', heartbeatMs: 0 });
    const [h1, g1] = memoryChannelPair();
    host.attachGuest(h1);
    new GuestSession(g1, { id: 'same-player', heartbeatMs: 0 });
    await settle();
    host.start();
    await settle();
    // The host never noticed the first connection dying; the same player reconnects.
    const [h2, g2] = memoryChannelPair();
    host.attachGuest(h2);
    const again = new GuestSession(g2, { id: 'same-player', heartbeatMs: 0 });
    await settle();
    expect(again.view()).toMatchObject({ connection: { kind: 'connected' }, seat: 'black' });
    expect(host.view().members).toHaveLength(2);
    host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(again.view().state.turn).toBe('black');
  });

  it('a different player only watches while the seat is taken', async () => {
    const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', heartbeatMs: 0 });
    const [h1, g1] = memoryChannelPair();
    host.attachGuest(h1);
    new GuestSession(g1, { id: 'player-a', heartbeatMs: 0 });
    await settle();
    const [h2, g2] = memoryChannelPair();
    host.attachGuest(h2);
    const stranger = new GuestSession(g2, { id: 'player-b', heartbeatMs: 0 });
    await settle(10);
    expect(stranger.view()).toMatchObject({ connection: { kind: 'connected' }, seat: 'spectator' });
  });

  it('leaving stops the reconnect attempts', async () => {
    let attempts = 0;
    const [, g1] = memoryChannelPair();
    const guest = new GuestSession(g1, {
      heartbeatMs: 0,
      retryMs: 5,
      reconnect: async () => {
        attempts++;
        throw new Error('nobody home');
      },
    });
    g1.close();
    await settle(10);
    expect(guest.view().connection).toMatchObject({ kind: 'paused' });
    guest.dispose();
    const seen = attempts;
    await settle(20);
    expect(attempts).toBe(seen);
    expect(guest.view().connection).toMatchObject({ kind: 'disconnected' });
  });
});
