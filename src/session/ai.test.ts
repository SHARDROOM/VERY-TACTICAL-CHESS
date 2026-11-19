import { describe, expect, it } from 'vitest';
import { createInitialState, createStateFrom, withDefaultRules, type GameState } from '../engine';
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

  it("an AI with a model of its own asks that model, not the GM's, for its declaration (AI의 두뇌)", async () => {
    const s = game({ black: { level: 'easy', specials: 'often' } });
    const asked: string[] = [];
    const gm = new FakeGameMaster(0);
    const brain = new FakeGameMaster(0);
    const spy = (who: string, m: FakeGameMaster) => {
      const act = m.act.bind(m);
      m.act = (r) => (asked.push(who), act(r));
    };
    spy('gm', gm);
    spy('brain', brain);
    const local = new LocalSession(gm, { initialState: { ...s, ap: { ...s.ap, black: 4 } }, phase: 'playing', aiPace: 0, chance: () => 0.3 });
    local.setBrains({ black: brain });
    local.request({ type: 'move', from: 12, to: 28 });
    await until(() => local.view().state.turn === 'white', 15000);
    expect(asked).toContain('brain');
    expect(asked).not.toContain('gm');
    local.dispose();
  }, 20000);

  it('a saved game with the AI to move picks up where it was (the AI is in the rules)', async () => {
    const first = new LocalSession(new FakeGameMaster(0), { initialState: game({ black: { level: 'easy', specials: 'off' } }), phase: 'playing', aiPace: 0, chance: () => 0.4 });
    first.dispose();
    // Saved right after white's move, before the AI answered: JSON round trip, as the save does.
    const saved: GameState = JSON.parse(JSON.stringify({ ...first.view().state }));
    const resumed = new LocalSession(new FakeGameMaster(0), { initialState: saved, phase: 'playing', aiPace: 0, chance: () => 0.4 });
    resumed.request({ type: 'move', from: 12, to: 28 });
    resumed.dispose();
    const mid: GameState = JSON.parse(JSON.stringify(resumed.view().state));
    expect(mid.turn).toBe('black');
    expect(mid.rules.ai?.black).toEqual({ level: 'easy', specials: 'off' });
    const again = new LocalSession(new FakeGameMaster(0), { initialState: mid, phase: 'playing', aiPace: 0, chance: () => 0.4 });
    await until(() => again.view().state.turn === 'white');
    expect(again.view().state.turnNumber).toBe(3);
    again.dispose();
  });
});

describe('watching AIs (docs/SPEC.md, "AI 관전")', () => {
  const both = { white: { level: 'easy', specials: 'off' }, black: { level: 'easy', specials: 'off' } } as const;

  it('pauses (nothing moves) and carries on', async () => {
    const local = new LocalSession(new FakeGameMaster(0), { aiPace: 0, chance: Math.random });
    local.setRules({ ai: both });
    local.start();
    expect(local.view().watch).toMatchObject({ paused: false, round: 1 });
    await until(() => local.view().state.turnNumber >= 3);
    local.setWatch({ paused: true });
    await sleep(30);
    const at = local.view().state.turnNumber;
    await sleep(120);
    expect(local.view().state.turnNumber).toBe(at);
    local.setWatch({ paused: false, speed: 'fast' });
    expect(local.view().watch).toMatchObject({ paused: false, speed: 'fast' });
    await until(() => local.view().state.turnNumber >= at + 2);
    local.dispose();
  });

  it('scores a win, and the rematch swaps the seats and keeps the score', async () => {
    // White's queen takes the black king at once.
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, e2: { color: 'white', type: 'queen' } }, 'white');
    const rules = withDefaultRules({ ai: { white: { level: 'normal', specials: 'off' }, black: { level: 'hard', specials: 'off' } } });
    const local = new LocalSession(new FakeGameMaster(0), { initialState: { ...s, rules }, phase: 'playing', aiPace: 0, chance: () => 0.5 });
    await until(() => local.view().state.status.kind === 'won');
    expect(local.view().watch.tally).toEqual([
      { label: '보통', level: 'normal', color: 'white', wins: 1 },
      { label: '어려움', level: 'hard', color: 'black', wins: 0 },
    ]);
    local.rematch();
    const v = local.view();
    expect(v.state.status.kind).toBe('playing');
    expect(v.state.rules.ai).toEqual({ white: { level: 'hard', specials: 'off' }, black: { level: 'normal', specials: 'off' } });
    expect(v.watch.tally.map((e) => [e.label, e.color, e.wins])).toEqual([
      ['보통', 'black', 1],
      ['어려움', 'white', 0],
    ]);
    expect(v.watch.round).toBe(1);
    local.dispose();
  });

  it('one screen takes a side over mid-game (no longer only AIs), and hands it back', async () => {
    const local = new LocalSession(new FakeGameMaster(0), { aiPace: 0, chance: Math.random });
    local.setRules({ ai: both });
    local.start();
    await until(() => local.view().state.turnNumber >= 2);
    local.setWatch({ paused: true });
    local.setAi('white', null);
    expect(local.view().state.rules.ai).toEqual({ black: both.black });
    // Pausing means nothing once someone plays.
    expect(local.view().watch.paused).toBe(false);
    await until(() => local.view().state.turn === 'white');
    const at = local.view().state.turnNumber;
    await sleep(60);
    expect(local.view().state.turnNumber).toBe(at);
    local.setAi('white', { level: 'easy', specials: 'off' });
    await until(() => local.view().state.turnNumber > at);
    local.dispose();
  });
});

