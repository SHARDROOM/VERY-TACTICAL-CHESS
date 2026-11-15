import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { AIR, LEVITATE, createInitialState, createStateFrom, parseSquare, restingPlace } from '../engine';
import { runLength, simulateFalls, simulateRomp } from './boardPhysics';
import { squareToWorld } from './coords';

const sq = (n: string) => parseSquare(n)!;
const end = (f: Float32Array) => ({ x: f[f.length - 7], y: f[f.length - 6], z: f[f.length - 5], up: new Vector3(0, 1, 0).applyQuaternion(new Quaternion(f[f.length - 4], f[f.length - 3], f[f.length - 2], f[f.length - 1])).y });
const rookAt = (to: string, others: Record<string, { color: 'white' | 'black'; type: 'pawn' }> = {}) => {
  const s = createStateFrom({ a1: { color: 'white', type: 'rook' }, ...others });
  const rook = s.board[sq('a1')]!;
  return simulateRomp({ board: s.board, movers: [{ id: rook.id, type: 'rook', from: sq('a1'), to: sq(to), mode: 'slide' }], seed: 7 }).then((run) => ({ run, rook: end(run.tracks.get(rook.id)!), s }));
};

describe('a move as a romp', () => {
  it('a short slide goes straight and stops about on its square, standing', async () => {
    const { rook, run } = await rookAt('a3');
    const [tx, , tz] = squareToWorld(sq('a3'));
    expect(Math.abs(rook.x - tx)).toBeLessThan(0.02);
    expect(Math.abs(rook.z - tz)).toBeLessThan(0.6);
    expect(rook.up).toBeGreaterThan(0.95);
    expect(runLength(run)).toBeLessThan(2.3);
  }, 30_000);

  it('a long slide tips over', async () => {
    const { rook } = await rookAt('a8');
    expect(rook.up).toBeLessThan(0.6);
  }, 30_000);

  it('a slide onto a piece rams it', async () => {
    const { run, s } = await rookAt('a3', { a3: { color: 'black', type: 'pawn' } });
    expect(run.tracks.has(s.board[sq('a3')]!.id)).toBe(true);
  }, 30_000);

  it('a knight is thrown high, lands a little past its square; the same seed gives the same flight', async () => {
    const s = createInitialState();
    const knight = s.board[sq('b1')]!;
    const opts = { board: s.board, movers: [{ id: knight.id, type: 'knight' as const, from: sq('b1'), to: sq('c3'), mode: 'throw' as const }], seed: 42 };
    const run = await simulateRomp(opts);
    const track = run.tracks.get(knight.id)!;
    let top = 0;
    for (let i = 1; i < track.length; i += 7) top = Math.max(top, track[i]);
    expect(top).toBeGreaterThan(1);
    const [tx, , tz] = squareToWorld(sq('c3'));
    const k = end(track);
    expect(Math.hypot(k.x - tx, k.z - tz)).toBeLessThan(3);
    const again = await simulateRomp(opts);
    expect(end(again.tracks.get(knight.id)!)).toEqual(k);
  }, 30_000);
});

describe('a fall from the air', () => {
  const drop = (seed: number) => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, d3: { color: 'black', type: 'pawn' }, e4: { color: 'black', type: 'pawn' } });
    const knight = { id: 'k', color: 'white' as const, type: 'knight' as const, tags: [{ name: LEVITATE, turnsLeft: 1, appliedOnTurn: 0 }] };
    return simulateFalls({ board: s.board, falling: [{ piece: knight, from: sq('d4') + AIR }], seed }).then((r) => ({ ...r, s }));
  };

  it('drops onto the board near its square, the same way for the same seed', async () => {
    const a = await drop(11);
    const b = await drop(11);
    expect(a.landings).toEqual(b.landings);
    const [l] = a.landings;
    expect(Math.abs(l.file - 3)).toBeLessThan(1.2);
    expect(Math.abs(l.rank - 3)).toBeLessThan(1.2);
    const track = a.run.tracks.get('k')!;
    expect(track[1]).toBeGreaterThan(1.2); // it starts up in the air
    expect(end(track).y).toBeLessThan(0.3); // and ends on the board
    // The rules make a square of it.
    expect(restingPlace(a.s.board, [], l.file, l.rank).result).not.toBeUndefined();
  }, 30_000);
});
