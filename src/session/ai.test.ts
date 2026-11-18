import { describe, expect, it } from 'vitest';
import { createInitialState, withDefaultRules, type GameState } from '../engine';
import { FakeGameMaster } from '../gm/fakeGm';
import { LocalSession } from './localSession';
import type { SessionEvent } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(5);
  }
}

function game(ai: NonNullable<GameState['rules']['ai']>): GameState {
  const rules = withDefaultRules({ ai });
  return createInitialState(rules);
}

describe('AI players (hotseat)', () => {
  it('answers a human move with its own, and the human cannot move for it', async () => {
    const local = new LocalSession(new FakeGameMaster(0), { initialState: game({ black: { level: 'normal', specials: 'off' } }), phase: 'playing', aiPace: 0, chance: () => 0.4 });
    const notices: string[] = [];
    local.subscribe((e: SessionEvent) => e.kind === 'notice' && notices.push(e.text));
    local.request({ type: 'move', from: 12, to: 28 });
    expect(local.view().state.turn).toBe('black');
    local.request({ type: 'move', from: 52, to: 36 });
    expect(notices.join()).toContain('AI의 차례');
    await until(() => local.view().state.turn === 'white');
    expect(local.view().state.turnNumber).toBe(3);
    local.dispose();
  });

  it('two AIs play a game by themselves (the first moves when the game starts)', async () => {
    const local = new LocalSession(new FakeGameMaster(0), { aiPace: 0, chance: Math.random });
    local.setRules({ ai: { white: { level: 'easy', specials: 'off' }, black: { level: 'easy', specials: 'off' } } });
    local.start();
    await until(() => local.view().state.turnNumber >= 9 || local.view().state.status.kind !== 'playing', 20000);
    expect(local.view().state.turnNumber).toBeGreaterThanOrEqual(9);
    local.dispose();
  }, 30000);

  it('tries special actions with the fake GM and decides whether to roll', async () => {
    const s = game({ black: { level: 'hard', specials: 'often' } });
    const local = new LocalSession(new FakeGameMaster(0), { initialState: { ...s, ap: { ...s.ap, black: 4 } }, phase: 'playing', aiPace: 0, chance: () => 0.3 });
    const seen: string[] = [];
    local.subscribe((e: SessionEvent) => e.kind === 'events' && e.events.forEach((ev) => seen.push(ev.type)));
    local.request({ type: 'move', from: 12, to: 28 });
    await until(() => local.view().state.turn === 'white', 15000);
    expect(seen).toContain('specialProposed');
    expect(seen.some((t) => t === 'specialResolved' || t === 'specialCancelled')).toBe(true);
    local.dispose();
  }, 20000);
});
