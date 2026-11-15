import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createStateFrom, parseSquare, type GameEvent } from '../engine';
import { duelLength, duelPose, planDuel, scriptedDuel, simulateDuel } from './duel';

const sq = (n: string) => parseSquare(n)!;
const board = createStateFrom({ d4: { color: 'white', type: 'rook' }, d7: { color: 'black', type: 'knight' } }).board;
const clash = (over: Partial<Extract<GameEvent, { type: 'clash' }>> = {}): Extract<GameEvent, { type: 'clash' }> => ({
  type: 'clash',
  attackerId: board[sq('d4')]!.id,
  defenderId: board[sq('d7')]!.id,
  attacker: 'white',
  from: sq('d4'),
  at: sq('d7'),
  attack: 1,
  defense: 1.5,
  rounds: [{ attack: 4, defense: 12 }],
  winner: 'defender',
  shield: false,
  exchanges: 3,
  ...over,
});
const at = (run: Parameters<typeof duelPose>[0], who: 'attacker' | 'defender', t: number) => duelPose(run, who, t, { p: new Vector3(), q: new Quaternion() });

describe('planning a duel', () => {
  it('the attacker steps up to just short of the defender; the finale follows who won and how', () => {
    const plan = planDuel(clash(), board)!;
    expect(plan.attacker.stance.z).toBeCloseTo(plan.defender.home.z + 0.95);
    expect(plan.finale).toBe('shatter'); // lost to a fighter
    expect(planDuel(clash({ defense: 1, shield: true }), board)!.finale).toBe('knock');
    expect(planDuel(clash({ winner: 'attacker', shield: true }), board)!.finale).toBe('shield');
    expect(planDuel(clash({ winner: 'attacker', attack: 1.5 }), board)!.finale).toBe('shatter');
    expect(planDuel(clash(), board, 2)!.exchanges).toBe(2);
  });
});

describe('the duel run', () => {
  it('with physics: they meet as many times as the exchanges, and a knocked loser flies off its spot', async () => {
    const plan = planDuel(clash({ defense: 1, exchanges: 3 }), board)!;
    const run = await simulateDuel(plan);
    expect(run.hits.length).toBeGreaterThanOrEqual(2);
    expect(run.hits.filter((h) => h.final)).toHaveLength(1);
    expect(duelLength(run)).toBeGreaterThan(2);
    expect(duelLength(run)).toBeLessThan(6);
    const end = at(run, 'attacker', duelLength(run));
    expect(end.p.distanceTo(plan.attacker.stance)).toBeGreaterThan(0.6);
    // The defender stands its ground.
    expect(at(run, 'defender', duelLength(run)).p.distanceTo(plan.defender.home)).toBeLessThan(0.6);
  }, 30_000);

  it('a scripted duel has the same shape when physics cannot run', () => {
    const run = scriptedDuel(planDuel(clash({ exchanges: 4 }), board)!);
    expect(run.hits).toHaveLength(4);
    expect(run.hits[3].final).toBe(true);
  });
});
