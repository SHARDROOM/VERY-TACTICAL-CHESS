import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Euler, Quaternion, SRGBColorSpace, Vector3, type Mesh } from 'three';
import { CHUNK, addChunk, chunkPose, getChunk, playChunk, removeChunks, type Chunk } from './debris';
import { simulateChunkThrow } from './shatter';
import { onPaper, onToy, poseOf, readPose, tellToy } from './toys';
import type { Pose } from '../session/toy';
import { Grip, holdingSomething, onDepth, tableObstacles, useTable } from './tableDrag';
import { LiveDrag } from './liveDrag';
import { sideDir } from './coords';
import { TABLE_TOP_Y } from './WoodTable';
import { keepAwake } from './renderPace';

/*
 * 쓰는 종이 (사용자 요청): while another player types a chat line or a special action, a sheet of
 * paper floats in the middle of their view (on their line of sight, as their screen tells:
 * paperPose.ts) with the words appearing as they are typed, the written face turned to the writer
 * (사용자 요청); the others see it from behind, the ink showing through. Sent, the sheet is tossed
 * from there to the table's left or right and lies there
 * as a body like a shattered piece's chunk (debris.ts): pieces push it, anyone can pick it up and
 * throw it (the same live drag), and the others see that too. Only a look, not saved.
 */

type Side = 'white' | 'black' | 'red';
const W = 1.4;
const H = 1.0;
const T = 0.02;
/** A sheet's hull for the physics: a thin box around its middle. */
const HULL = Float32Array.from([-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].flatMap((z) => [(x * W) / 2, (y * H) / 2, (z * T) / 2]))));
/** The most sheets lying about (the oldest goes). */
const MAX_PAPERS = 10;

/** Where a player holds the sheet it writes on: in front of its side of the board, a little to its right, raised. */
function writingSpot(side: Side): Vector3 {
  const [dx, dz] = sideDir(side);
  // To the player's right as it faces the board (its facing is -side direction).
  const rx = -dz;
  const rz = dx;
  return new Vector3(dx * 6.3 + rx * 2.6, TABLE_TOP_Y + 1.5, dz * 6.3 + rz * 2.6);
}

/** Lying back toward `toward` (a side's direction), so one sitting there reads it. */
function facing(toward: [number, number], tilt = 0.75): Quaternion {
  const yaw = Math.atan2(toward[0], toward[1]);
  return new Quaternion().setFromEuler(new Euler(-Math.PI / 2 + tilt, yaw, 0, 'YXZ'));
}

/** The sheet's face: aged paper, the words in ink, wrapped to fit. `back`: seen from behind, the ink showing through (mirrored, faint). */
function drawPaper(canvas: HTMLCanvasElement, text: string, writing: boolean, back = false): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { width: w, height: h } = canvas;
  const bg = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.7);
  bg.addColorStop(0, '#f4e7c6');
  bg.addColorStop(1, '#dcc394');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(110, 75, 30, 0.35)';
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#2c1a0a';
  const size = text.length > 90 ? 26 : text.length > 40 ? 32 : 40;
  g.font = `600 ${size}px 'Hahmlet Variable', 'Nanum Myeongjo', serif`;
  g.textBaseline = 'top';
  const lines: string[] = [];
  let line = '';
  for (const ch of text + (writing ? '▍' : '')) {
    if (g.measureText(line + ch).width > w - 60 && line) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  const lh = size * 1.35;
  const maxLines = Math.floor((h - 60) / lh);
  g.save();
  if (back) {
    g.translate(w, 0);
    g.scale(-1, 1);
    g.globalAlpha = 0.32;
  }
  lines.slice(0, maxLines).forEach((l, i) => g.fillText(l, 30, 30 + i * lh));
  g.restore();
}

interface PaperFaces {
  front: CanvasTexture;
  back: CanvasTexture;
}

function usePaperTexture(text: string, writing: boolean): PaperFaces {
  const tex = useMemo(() => {
    const make = () => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = Math.round((512 * H) / W);
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    return { front: make(), back: make() };
  }, []);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      if (!alive) return;
      drawPaper(tex.front.image as HTMLCanvasElement, text, writing);
      drawPaper(tex.back.image as HTMLCanvasElement, text, writing, true);
      tex.front.needsUpdate = true;
      tex.back.needsUpdate = true;
      keepAwake();
    };
    draw();
    // Drawn before the handwriting font came: once more when it has.
    document.fonts?.ready.then(draw).catch(() => {});
    return () => {
      alive = false;
    };
  }, [tex, text, writing]);
  useEffect(
    () => () => {
      tex.front.dispose();
      tex.back.dispose();
    },
    [tex],
  );
  return tex;
}

/** The sheet itself: a thin slab, the writing on its +z face (showing through on the other). */
type PointerHandler = (e: ThreeEvent<PointerEvent>) => void;
function Sheet({ texture, ...rest }: {
  texture: PaperFaces;
  meshRef?: (m: Mesh | null) => void;
  onPointerDown?: PointerHandler;
  onPointerMove?: PointerHandler;
  onPointerUp?: PointerHandler;
  onPointerCancel?: PointerHandler;
  onWheel?: (e: ThreeEvent<WheelEvent>) => void;
}) {
  const { meshRef, ...handlers } = rest;
  return (
    <mesh ref={meshRef} castShadow receiveShadow {...handlers}>
      <boxGeometry args={[W, H, T]} />
      <meshStandardMaterial attach="material-0" color="#d9c08e" roughness={0.95} />
      <meshStandardMaterial attach="material-1" color="#d9c08e" roughness={0.95} />
      <meshStandardMaterial attach="material-2" color="#d9c08e" roughness={0.95} />
      <meshStandardMaterial attach="material-3" color="#d9c08e" roughness={0.95} />
      <meshStandardMaterial attach="material-4" map={texture.front} roughness={0.9} />
      <meshStandardMaterial attach="material-5" map={texture.back} color="#efe4cc" roughness={0.95} />
    </mesh>
  );
}

/** Where a sheet starts: the writer's `pose` if told, else `spot`, lying back toward the writer. */
function sheetStart(side: Side, pose: Pose | undefined, spot: Vector3, tilt = 0.75): { at: Vector3; q: Quaternion } {
  if (!pose) return { at: spot, q: facing(sideDir(side), tilt) };
  const at = new Vector3();
  const q = new Quaternion();
  readPose(pose, at, q);
  return { at, q };
}

/** Where a sheet being written floats without a pose: just off the board by the writer's half (on its right), raised. */
function floatingSpot(side: Side): Vector3 {
  const [dx, dz] = sideDir(side);
  return new Vector3(dx * 2.6 - dz * 6.2, TABLE_TOP_Y + 1.5, dz * 2.6 + dx * 6.2);
}
/** Bigger while it is being written, so the words can be read from across the table. */
const WRITING_SCALE = 1.6;

/**
 * Another player's sheet while it writes: about the middle of its view, as its screen told
 * (`pose`), the words facing the writer; bobbing a little. Without a pose (its camera not known
 * yet): just off the board by its half, standing up toward it.
 */
function WritingPaper({ side, text, pose }: { side: Side; text: string; pose?: Pose }) {
  const texture = usePaperTexture(text, true);
  const ref = useRef<Mesh | null>(null);
  const { at, q } = useMemo(() => sheetStart(side, pose, floatingSpot(side), 1.15), [side, pose]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    m.position.set(at.x, at.y + Math.sin(clock.elapsedTime * 1.6) * 0.05, at.z);
    m.quaternion.copy(q);
    m.scale.setScalar(WRITING_SCALE);
  });
  return <Sheet texture={texture} meshRef={(m) => void (ref.current = m)} />;
}

/** A tossed sheet's name, the same on every screen (its drags are told by it): who wrote it and its toss's seed. */
export const paperKey = (op: { id: Side; seed: number }) => `paper-${op.id}-${op.seed}`;

interface Tossed {
  key: string;
  side: Side;
  text: string;
  dir: 1 | -1;
  seed: number;
  /** Where the writer held it (about the middle of its view), as its screen told. */
  pose?: Pose;
}

const TMP_P = new Vector3();

/** A sent sheet: tossed aside, then lying on the table where anyone may pick it up and throw it. */
function TossedPaper({ paper }: { paper: Tossed }) {
  const texture = usePaperTexture(paper.text, false);
  const table = useTable();
  const key = `${paper.key}#0`;
  const [ready, setReady] = useState(() => !!getChunk(key));
  const ref = useRef<Mesh | null>(null);
  // The toss: from where the writer held it, off to the side, the same on every screen.
  useEffect(() => {
    if (getChunk(key)) return;
    let alive = true;
    const { at: p, q } = sheetStart(paper.side, paper.pose, writingSpot(paper.side));
    const c: Chunk = { key, pieceId: paper.key, index: 0, hull: HULL, p: p.clone(), q: q.clone() };
    const [dx, dz] = sideDir(paper.side);
    // From over the writer's near ranks: flung hard to its left or right (a little back toward it),
    // over the dice tray or the coin dishes, to come down past them, clear of the board and the
    // writer's book (checked with two browsers and the physics: tossed as before, it landed among
    // the pieces; less hard, it hit the tray or a dish and fell back). Without a pose it starts off
    // the board already, in front of the writer.
    const velocity = paper.pose
      ? new Vector3(-dz * paper.dir * 12 + dx * 0.6, 3.2, dx * paper.dir * 12 + dz * 0.6)
      : new Vector3(paper.dir * 6 - dx * 0.5, 3.2, -dz * 1.2);
    simulateChunkThrow(HULL, p, q, velocity, paper.seed, table ? tableObstacles(table, { chunkKey: key }) : undefined)
      .then((run) => {
        if (!alive) return;
        playChunk(c, run.tracks[0], run.steps, run.dt, performance.now());
        addChunk(c);
        setReady(true);
        keepAwake();
      })
      .catch(() => {
        if (!alive) return;
        addChunk(c);
        setReady(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => removeChunks(paper.key), [paper.key]);

  // Picked up and thrown: the same live drag as a chunk's, told to the others the same way.
  const drag = useRef<{ x: number; y: number; moved: boolean; grip: Grip; grab: Vector3; target: Vector3; released: boolean } | null>(null);
  const live = useRef<LiveDrag | null>(null);
  const stopDepth = useRef<(() => void) | null>(null);
  const carried = useRef<{ p: Vector3; q: Quaternion } | null>(null);
  useEffect(() => () => live.current?.free(), []);
  useEffect(
    () =>
      onToy(CHUNK + key, (op) => {
        const c = getChunk(key);
        if (!c) return;
        if (op.op === 'hold') {
          c.held = true;
          c.track = undefined;
          const at = carried.current ?? { p: c.p.clone(), q: c.q.clone() };
          readPose(op.pose, at.p, at.q);
          carried.current = at;
          return;
        }
        carried.current = null;
        c.held = true;
        readPose(op.pose, c.p, c.q);
        simulateChunkThrow(HULL, c.p.clone(), c.q.clone(), new Vector3(...op.velocity), op.seed, table ? tableObstacles(table, { chunkKey: key }) : undefined)
          .then((run) => {
            c.held = false;
            playChunk(c, run.tracks[0], run.steps, run.dt, performance.now());
            readPose(op.final, c.p, c.q);
          })
          .catch(() => (c.held = false));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useFrame((_, dt) => {
    const m = ref.current;
    const c = getChunk(key);
    if (!m || !c) return;
    const hand = live.current;
    if (hand) {
      if (hand.step(dt, c.p, c.q)) {
        live.current = null;
        hand.free();
        c.held = false;
        c.track = undefined;
        const at = poseOf(c.p, c.q);
        tellToy({ op: 'drop', id: CHUNK + key, pose: at, velocity: [0, 0, 0], seed: 0, final: at });
      } else tellToy({ op: 'hold', id: CHUNK + key, pose: poseOf(c.p, c.q) });
    }
    const away = carried.current;
    if (away && c.held) {
      c.p.lerp(away.p, 0.3);
      c.q.slerp(away.q, 0.3);
    }
    if (c.held) {
      m.position.copy(c.p);
      m.quaternion.copy(c.q);
    } else chunkPose(c, performance.now(), m.position, m.quaternion);
  });

  const takeInHand = (d: NonNullable<typeof drag.current>, c: Chunk) => {
    if (!table) return;
    c.held = true;
    c.track = undefined;
    LiveDrag.start({ kind: 'chunk', hull: HULL }, c.p.clone(), c.q.clone(), d.grab, tableObstacles(table, { chunkKey: key }), table.diceSide(), table.piecesShown)
      .then((hand) => {
        hand.aim(d.target);
        if (d.released) hand.letGo();
        live.current = hand;
      })
      .catch(() => {
        c.held = false;
      });
  };
  const down = (e: ThreeEvent<PointerEvent>) => {
    const c = getChunk(key);
    if (!c || c.held || live.current || holdingSomething() || (c.track && performance.now() < c.track.start + c.track.steps * c.track.dt * 1000)) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    table?.hold(true);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, grip: new Grip(e.camera, e.point), grab: e.point.clone(), target: e.point.clone(), released: false };
    stopDepth.current = onDepth((amount) => push(amount));
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    const c = getChunk(key);
    if (!d || !c) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.moved) takeInHand(d, c);
    d.moved = true;
    if (d.grip.at(e.ray, TMP_P, table?.board())) {
      d.target.copy(TMP_P);
      live.current?.aim(d.target);
    }
  };
  const push = (amount: number) => {
    const d = drag.current;
    const c = getChunk(key);
    if (!d || !c) return;
    if (!d.moved) takeInHand(d, c);
    d.moved = true;
    if (d.grip.push(amount, TMP_P, table?.board())) {
      d.target.copy(TMP_P);
      live.current?.aim(d.target);
    }
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    drag.current = null;
    stopDepth.current?.();
    stopDepth.current = null;
    table?.hold(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (!d?.moved) return;
    d.released = true;
    live.current?.letGo();
  };
  const wheel = (e: ThreeEvent<WheelEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    push(e.deltaY * 0.004);
  };
  if (!ready) return null;
  return <Sheet texture={texture} meshRef={(m) => void (ref.current = m)} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />;
}

/**
 * The papers on the table: the others' while they write, and every sent one (this screen's too)
 * lying where it was tossed. `viewer`: the side this screen looks from (the writing faces it).
 */
export function Papers({ mySide }: { mySide: Side | null; viewer?: Side }) {
  const [writing, setWriting] = useState<Partial<Record<Side, { text: string; pose?: Pose }>>>({});
  const [tossed, setTossed] = useState<Tossed[]>([]);
  useEffect(
    () =>
      onPaper((op) => {
        if (op.op === 'write') {
          if (op.id === mySide) return;
          setWriting((w) => ({ ...w, [op.id]: { text: op.text, pose: op.pose } }));
          return;
        }
        setWriting((w) => ({ ...w, [op.id]: undefined }));
        if (!op.text.trim()) return;
        const paper: Tossed = { key: paperKey(op), side: op.id, text: op.text, dir: op.dir, seed: op.seed, pose: op.pose };
        setTossed((list) => (list.some((p) => p.key === paper.key) ? list : [...list, paper].slice(-MAX_PAPERS)));
      }),
    [mySide],
  );
  return (
    <>
      {(Object.entries(writing) as [Side, { text: string; pose?: Pose } | undefined][]).map(([side, w]) => (w?.text ? <WritingPaper key={side} side={side} text={w.text} pose={w.pose} /> : null))}
      {tossed.map((p) => (
        <TossedPaper key={p.key} paper={p} />
      ))}
    </>
  );
}
