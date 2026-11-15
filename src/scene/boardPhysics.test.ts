import { describe, expect, it } from 'vitest';
import { createInitialState, createStateFrom, parseSquare } from '../engine';
import { runLength, simulateRomp } from './boardPhysics';
import { squareToWorld } from './coords';

const sq = (n: string) => parseSquare(n)!;
const end = (f: Float32Array) => ({ x: f[f.length - 7], y: f[f.length - 6], z: f[f.length - 5] });

describe('a move as a romp', () => {
  it('a slide shoves the piece a little past its square and knocks what is there', async () => {
    const s = createStateFrom({ a1: { color: 'white', type: 'rook' }, a6: { color: 'black', type: 'pawn' }, b6: { color: 'black', type: 'pawn' } });
    const rook = s.board[sq('a1')]!;
    const run = await simulateRomp({ board: s.board, movers: [{ id: rook.id, type: 'rook', from: sq('a1'), to: sq('a5'), mode: 'slide' }], seed: 7 });
    const [, , tz] = squareToWorld(sq('a5'));
    const r = end(run.tracks.get(rook.id)!);
    expect(r.z).toBeLessThan(tz); // past a5, toward a6
    expect(run.tracks.has(s.board[sq('a6')]!.id)).toBe(true); // shoved
    expect(runLength(run)).toBeLessThan(2);
  }, 30_000);

  it('a throw lands roughly near its square; the same seed gives the same flight', async () => {
    const s = createInitialState();
    const knight = s.board[sq('b1')]!;
    const opts = { board: s.board, movers: [{ id: knight.id, type: 'knight' as const, from: sq('b1'), to: sq('c3'), mode: 'throw' as const }], seed: 42 };
    const run = await simulateRomp(opts);
    const [tx, , tz] = squareToWorld(sq('c3'));
    const k = end(run.tracks.get(knight.id)!);
    expect(Math.hypot(k.x - tx, k.z - tz)).toBeLessThan(2.5);
    const again = await simulateRomp(opts);
    expect(end(again.tracks.get(knight.id)!)).toEqual(k);
  }, 30_000);
});
