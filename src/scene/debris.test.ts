import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Ray, Vector3 } from 'three';
import { createStateFrom, parseSquare } from '../engine';
import { CHUNK, addChunk, chunkPose, clearChunks, getChunk, playChunk, restingChunks } from './debris';
import { Grip, LIFT, TABLE_LIFT, carryPoint } from './tableDrag';
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

describe('holding things up', () => {
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
  camera.position.set(0, 7.2, 8.8);
  camera.lookAt(0, 0, 0.6);
  camera.updateMatrixWorld();
  const toward = (x: number, y: number, z: number) => new Ray(camera.position.clone(), new Vector3(x, y, z).sub(camera.position).normalize());

  it('picked up off the board, it rises as the finger goes up and comes back down to the board', () => {
    const grip = new Grip(camera, new Vector3(0, LIFT, 0));
    const p = new Vector3();
    expect(grip.at(toward(0, 2, 0), p)).toBe(true);
    expect(p.y).toBeGreaterThan(1);
    // Pointing lower than the board there: it slides along the board toward the eye.
    expect(grip.at(toward(0, -1, 0), p)).toBe(true);
    expect(p.y).toBeCloseTo(LIFT);
    expect(p.z).toBeGreaterThan(0);
  });

  it('the wheel pushes it farther away', () => {
    const grip = new Grip(camera, new Vector3(0, LIFT, 0));
    const near = new Vector3();
    const far = new Vector3();
    grip.at(toward(0, 2, 0), near);
    grip.push(1.5, far);
    expect(far.distanceTo(camera.position)).toBeGreaterThan(near.distanceTo(camera.position) + 1);
  });
});

describe('a second finger', () => {
  it('while something is held, sliding up pushes it away and down brings it near; otherwise it does nothing', async () => {
    const { onDepth, depthMoved, holdingSomething, DEPTH_PER_PIXEL } = await import('./tableDrag');
    expect(depthMoved(-50)).toBe(false);
    const pushed: number[] = [];
    const stop = onDepth((a) => pushed.push(a));
    expect(holdingSomething()).toBe(true);
    depthMoved(-50);
    depthMoved(20);
    expect(pushed).toEqual([50 * DEPTH_PER_PIXEL, -20 * DEPTH_PER_PIXEL]);
    stop();
    expect(holdingSomething()).toBe(false);
  });
});
