import { describe, expect, it } from 'vitest';
import { Quaternion, Ray, Vector3 } from 'three';
import { createStateFrom, parseSquare } from '../engine';
import { CHUNK, addChunk, chunkPose, clearChunks, getChunk, playChunk, restingChunks } from './debris';
import { LIFT, carryPoint } from './tableDrag';
import { TABLE_TOP_Y } from './WoodTable';
import { simulateRomp } from './boardPhysics';
import { fragmentsOf } from './shatter';
import { squareToWorld } from './coords';

const track = (from: number[], to: number[]) => Float32Array.from([...from, 0, 0, 0, 1, ...to, 0, 0, 0, 1]);

describe('chunks lying about', () => {
  it('a chunk playing a recording is there along it, and rests where it ends', () => {
    clearChunks();
    const c = { key: 'p#0', pieceId: 'p', index: 0, hull: new Float32Array(), p: new Vector3(), q: new Quaternion() };
    addChunk(c);
    playChunk(c, track([0, 1, 0], [2, 0, 0]), 2, 1, performance.now() + 10_000);
    // It rests where the recording ends (what the simulations use), though it has not moved yet.
    expect(c.p.toArray()).toEqual([2, 0, 0]);
    expect(restingChunks()).toHaveLength(0);
    const p = new Vector3();
    chunkPose(c, performance.now(), p, new Quaternion());
    expect(p.toArray()).toEqual([0, 1, 0]);
    playChunk(c, track([0, 1, 0], [3, 0, 0]), 2, 0.001, 0);
    chunkPose(c, performance.now(), p, new Quaternion());
    expect(p.toArray()).toEqual([3, 0, 0]);
    expect(restingChunks()).toEqual([getChunk('p#0')]);
  });

  it('is carried at a height over the board, or over the table beside it', () => {
    const down = new Vector3(0, -1, 0);
    const p = new Vector3();
    expect(carryPoint(new Ray(new Vector3(1, 10, 1), down), p)).toBe(true);
    expect(p.y).toBeCloseTo(LIFT);
    expect(carryPoint(new Ray(new Vector3(7, 10, 1), down), p)).toBe(true);
    expect(p.y).toBeCloseTo(TABLE_TOP_Y + LIFT);
  });

  it('a piece sliding through a chunk pushes it out of the way', async () => {
    clearChunks();
    const s = createStateFrom({ a1: { color: 'white', type: 'rook' }, e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } });
    const [x, , z] = squareToWorld(parseSquare('a4')!);
    const frag = fragmentsOf('pawn')[0];
    const run = await simulateRomp({
      board: s.board,
      movers: [{ id: s.board[parseSquare('a1')!]!.id, type: 'rook', from: parseSquare('a1')!, to: parseSquare('a6')!, mode: 'slide' }],
      debris: [{ key: 'x#0', hull: frag.hull, p: new Vector3(x, 0.06, z), q: new Quaternion() }],
      seed: 3,
    });
    const t = run.tracks.get(CHUNK + 'x#0');
    expect(t).toBeDefined();
    const last = t!.length - 7;
    expect(Math.hypot(t![last] - x, t![last + 2] - z)).toBeGreaterThan(0.3);
  });
});
