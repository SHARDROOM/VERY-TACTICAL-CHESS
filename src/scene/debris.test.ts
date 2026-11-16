import { describe, expect, it } from 'vitest';
import { Quaternion, Ray, Vector3 } from 'three';
import { createStateFrom, parseSquare } from '../engine';
import { CHUNK, addChunk, chunkPose, clearChunks, getChunk, playChunk, restingChunks } from './debris';
import { LIFT, TABLE_LIFT, carryPoint } from './tableDrag';
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
    expect(p.y).toBeCloseTo(TABLE_TOP_Y + TABLE_LIFT);
    // Over a square with a king on it: above the king.
    const board = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }).board;
    const [kx, , kz] = squareToWorld(parseSquare('e1')!);
    expect(carryPoint(new Ray(new Vector3(kx, 10, kz), down), p, board)).toBe(true);
    expect(p.y).toBeGreaterThan(1.1);
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

describe('things thrown about the table hit the dice', () => {
  it('a taken piece thrown along the table stops against a die in its way', async () => {
    const { simulatePiece } = await import('./piecePhysics');
    const { d20Vertices } = await import('../dice3d/d20');
    const hull = Float32Array.from(d20Vertices(0.42).flatMap((v) => [v.x, v.y, v.z]));
    const throwAt = (dice: { hull: Float32Array; p: Vector3; q: Quaternion }[]) =>
      simulatePiece({
        type: 'pawn',
        scale: 1,
        start: { position: new Vector3(12.5, TABLE_TOP_Y + 0.05, 5), quaternion: new Quaternion() },
        velocity: new Vector3(-6, 0, 0),
        spin: new Vector3(0, 0, 0),
        extra: { pieces: [], chunks: [], dice },
        diceSide: -1,
        maxSeconds: 3,
      });
    const free = await throwAt([]);
    // Left alone it slides about a square and a bit; with a die there it stops short of it.
    const blocked = await throwAt([{ hull, p: new Vector3(11.5, TABLE_TOP_Y + 0.42, 5), q: new Quaternion() }]);
    expect(free.final.position.x).toBeLessThan(11.6);
    expect(blocked.final.position.x).toBeGreaterThan(11.9);
  });
});
