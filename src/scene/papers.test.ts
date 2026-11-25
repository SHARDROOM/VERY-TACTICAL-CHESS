import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseToyOp, type ToyOp } from '../session/toy';
import { Quaternion, Vector3 } from 'three';
import { onPaper, setToySender, tellGaze, tellToss, tellWrite } from './toys';
import { PAPER_HEIGHT, paperPose } from './paperPose';
import { paperKey } from './Papers';

/* 쓰는 종이 (사용자 요청): what a player writes reaches the others as it is typed, and is tossed when sent. */

describe('a sheet being written', () => {
  afterEach(() => {
    setToySender(null);
    vi.useRealTimers();
  });

  it('only well-formed writing gets through', () => {
    expect(parseToyOp({ op: 'write', id: 'black', text: '나이트가 돌진' })).toEqual({ op: 'write', id: 'black', text: '나이트가 돌진' });
    expect(parseToyOp({ op: 'write', id: 'black', text: 'x'.repeat(201) })).toBeNull();
    expect(parseToyOp({ op: 'write', id: 'nobody', text: 'x' })).toBeNull();
    expect(parseToyOp({ op: 'toss', id: 'red', text: '안녕', dir: -1, seed: 5 })).toEqual({ op: 'toss', id: 'red', text: '안녕', dir: -1, seed: 5 });
    expect(parseToyOp({ op: 'toss', id: 'red', text: '안녕', dir: 2, seed: 5 })).toBeNull();
  });

  it('typing goes out a few times a second, always ending on what is written now; sending tosses it here too', () => {
    vi.useFakeTimers();
    const sent: ToyOp[] = [];
    setToySender((op) => sent.push(op));
    const here: ToyOp[] = [];
    const off = onPaper((op) => here.push(op));
    for (const t of ['나', '나이', '나이트', '나이트가']) tellWrite('white', t);
    vi.advanceTimersByTime(500);
    const writes = sent.filter((o) => o.op === 'write');
    expect(writes.length).toBeLessThan(4);
    expect(writes.at(-1)).toEqual({ op: 'write', id: 'white', text: '나이트가' });
    tellToss('white', '나이트가 돌진한다');
    expect(sent.at(-1)).toMatchObject({ op: 'toss', id: 'white', text: '나이트가 돌진한다' });
    expect(here).toEqual([sent.at(-1)]);
    off();
  });
});

describe('a tossed sheet', () => {
  it('has the same name on every screen, however many sheets each has seen (found by cross-check: one picked up elsewhere did not move here)', () => {
    const op = { op: 'toss', id: 'black', text: 'x', dir: 1, seed: 12345 } as const;
    expect(paperKey(op)).toBe(paperKey({ ...op }));
    expect(paperKey(op)).not.toBe(paperKey({ ...op, seed: 999 }));
    expect(paperKey(op)).not.toBe(paperKey({ ...op, id: 'white' }));
  });
});

describe('where a sheet being written floats (사용자 요청: about the middle of the writer’s view, the words facing the writer)', () => {
  afterEach(() => setToySender(null));
  const eye: [number, number, number] = [0, 9, 12];
  const at: [number, number, number] = [0, 0, 0];

  it('on the writer’s line of sight where it comes down to a little over the board (halfway was off the others’ screens), its written face turned to the eye', () => {
    const [x, y, z, qx, qy, qz, qw] = paperPose(eye, at);
    expect([x, y]).toEqual([0, PAPER_HEIGHT]);
    expect(z).toBeCloseTo(12 - (12 * (9 - PAPER_HEIGHT)) / 9, 3);
    // From lower down or looking up, the look never comes down to it: halfway.
    expect(paperPose([0, 1, 10], [0, 1.5, 0]).slice(0, 3)).toEqual([0, 1.25, 5]);
    const face = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(qx, qy, qz, qw));
    const toEye = new Vector3(...eye).sub(new Vector3(x, y, z)).normalize();
    expect(face.dot(toEye)).toBeCloseTo(1, 3);
    // Upright as the writer sees it: its top edge points up, not down.
    expect(new Vector3(0, 1, 0).applyQuaternion(new Quaternion(qx, qy, qz, qw)).y).toBeGreaterThan(0);
  });

  it('the writer’s screen sends where it is with the words and the toss; a bad pose is turned away', () => {
    vi.useFakeTimers();
    const sent: ToyOp[] = [];
    setToySender((op) => sent.push(op));
    tellGaze('white', eye, at);
    tellWrite('white', '비숍이');
    vi.advanceTimersByTime(60_000);
    expect(sent.find((o) => o.op === 'write')).toEqual({ op: 'write', id: 'white', text: '비숍이', pose: paperPose(eye, at) });
    tellToss('white', '비숍이 돌진');
    expect(sent.at(-1)).toMatchObject({ op: 'toss', pose: paperPose(eye, at) });
    expect(parseToyOp({ op: 'write', id: 'white', text: 'x', pose: paperPose(eye, at) })).toMatchObject({ pose: paperPose(eye, at) });
    expect(parseToyOp({ op: 'write', id: 'white', text: 'x', pose: [0, 0, 0] })).toBeNull();
    expect(parseToyOp({ op: 'toss', id: 'white', text: 'x', dir: 1, seed: 3, pose: [999, 0, 0, 0, 0, 0, 1] })).toBeNull();
    vi.useRealTimers();
  });
});

describe('a look that stays still (found while placing the sheet: a camera left alone faded from the others’ screens after 20 s)', () => {
  it('is told again every few seconds, so the others keep seeing it', () => {
    let now = 1e9;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sent: ToyOp[] = [];
    setToySender((op) => sent.push(op));
    const eye: [number, number, number] = [1, 8, 11];
    tellGaze('black', eye, [0, 0, 0]);
    now += 1000;
    tellGaze('black', eye, [0, 0, 0]);
    now += 5000;
    tellGaze('black', eye, [0, 0, 0]);
    // Not every frame (once a second it had not moved: not told), but again after a few seconds.
    expect(sent.filter((o) => o.op === 'gaze' && o.id === 'black')).toHaveLength(2);
    setToySender(null);
    clock.mockRestore();
  });
});
