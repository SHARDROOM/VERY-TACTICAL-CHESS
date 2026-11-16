import { overBoard } from './coords';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Plane, Raycaster, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { TABLE_TOP_Y } from './WoodTable';
import { MAX_LINE_POINTS, type Doodle, type DoodleInput, type DoodleOp } from '../session/doodle';

export type DoodleToolKind = 'pen' | 'note' | 'erase';

export interface DoodleTool {
  kind: DoodleToolKind;
  color: string;
  width: number;
  /** For the note tool: what to write where the player taps next. */
  noteText: string;
}

/** The board (frame included) sits higher than the table around it. */
const onBoard = (x: number, z: number) => overBoard(x, z, 0.05);
/** Height of the drawing surface under (x, z), just above it. */
export const surfaceY = (x: number, z: number) => (onBoard(x, z) ? 0.008 : TABLE_TOP_Y + 0.006);

/** A flat ribbon along the points, lying on the board or the table. */
function ribbon(points: number[], width: number): BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const n = points.length / 2;
  const half = width / 2;
  for (let i = 0; i < n; i++) {
    const x = points[i * 2];
    const z = points[i * 2 + 1];
    const prev = Math.max(0, i - 1);
    const next = Math.min(n - 1, i + 1);
    let dx = points[next * 2] - points[prev * 2];
    let dz = points[next * 2 + 1] - points[prev * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const y = surfaceY(x, z);
    pos.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // Round-ish caps: a small fan at each end.
  for (const end of [0, n - 1]) {
    const cx = points[end * 2];
    const cz = points[end * 2 + 1];
    const y = surfaceY(cx, cz);
    const center = pos.length / 3;
    pos.push(cx, y, cz);
    const seg = 10;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * half, y, cz + Math.sin(a) * half);
      if (k > 0) index.push(center, center + k, center + k + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function LineMesh({ points, width, color, opacity = 1 }: { points: number[]; width: number; color: string; opacity?: number }) {
  const geometry = useMemo(() => (points.length >= 4 ? ribbon(points, width) : null), [points, width]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={2}>
      {/* Triangle winding follows the stroke's direction, so both faces must draw. */}
      <meshBasicMaterial color={color} transparent opacity={opacity * 0.92} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  );
}

const noteCache = new Map<string, { texture: CanvasTexture; aspect: number }>();
/** The handwriting face for notes; canvases only use a font once it has loaded. */
const NOTE_FONT = '64px "Nanum Pen Script"';
const noteFontReady: Promise<unknown> =
  typeof document !== 'undefined' && document.fonts ? document.fonts.load(NOTE_FONT, '가나다abc').catch(() => null) : Promise.resolve();
let noteFontLoaded = false;
void noteFontReady.then(() => (noteFontLoaded = true));

function noteTexture(text: string, color: string) {
  const key = `${color}|${text}|${noteFontLoaded}`;
  let hit = noteCache.get(key);
  if (!hit) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = `${NOTE_FONT}, system-ui, sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = Math.min(2048, w);
    c.height = 88;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    // A thin dark outline keeps pale ink readable on light squares.
    ctx.lineWidth = 6;
    ctx.strokeStyle = color === '#1d1b22' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, 12, 46);
    ctx.fillText(text, 12, 46);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    hit = { texture, aspect: c.width / c.height };
    noteCache.set(key, hit);
  }
  return hit;
}

function NoteMesh({ doodle }: { doodle: Extract<Doodle, { kind: 'note' }> }) {
  // Redraw once the handwriting font arrives.
  const [, setReady] = useState(noteFontLoaded);
  useEffect(() => {
    if (!noteFontLoaded) void noteFontReady.then(() => setReady(true));
  }, []);
  const { texture, aspect } = noteTexture(doodle.text, doodle.color);
  const h = 0.5;
  return (
    <mesh position={[doodle.x, surfaceY(doodle.x, doodle.z) + 0.001, doodle.z]} rotation={[-Math.PI / 2, 0, doodle.angle]} renderOrder={2}>
      <planeGeometry args={[h * aspect, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  );
}

/** Distance from (x, z) to a doodle, for the eraser. */
function distanceTo(d: Doodle, x: number, z: number): number {
  if (d.kind === 'note') {
    const { aspect } = noteTexture(d.text, d.color);
    // Into the note's own frame.
    const dx = x - d.x;
    const dz = z - d.z;
    const c = Math.cos(d.angle);
    const s = Math.sin(d.angle);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.max(0, Math.abs(lx) - (0.5 * aspect) / 2, Math.abs(lz) - 0.25);
  }
  let best = Infinity;
  const p = d.points;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i];
    const az = p[i + 1];
    const bx = p[i + 2];
    const bz = p[i + 3];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best - d.width / 2;
}

interface Props {
  doodles: Doodle[];
  tool: DoodleTool | null;
  myKey: string;
  /** The host (or hotseat) may rub out anyone's doodles. */
  moderator: boolean;
  onDoodle: (op: DoodleOp) => void;
}

/**
 * Doodles on the table and the board, and the pen that makes them. While a tool is
 * picked, pointer drags draw (the camera holds still); otherwise doodles are just shown.
 */
export function DoodleLayer({ doodles, tool, myKey, moderator, onDoodle }: Props) {
  const { camera, gl } = useThree();
  const [stroke, setStroke] = useState<number[] | null>(null);
  const strokeRef = useRef<number[] | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const doodlesRef = useRef(doodles);
  doodlesRef.current = doodles;

  useEffect(() => {
    if (!tool) return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const boardPlane = new Plane(new Vector3(0, 1, 0), 0);
    const tablePlane = new Plane(new Vector3(0, 1, 0), -TABLE_TOP_Y);
    const hit = new Vector3();
    /** Where the pointer touches the board (if over it) or else the table. */
    const pick = (e: PointerEvent): [number, number] | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(boardPlane, hit) && onBoard(hit.x, hit.z)) return [hit.x, hit.z];
      if (raycaster.ray.intersectPlane(tablePlane, hit) && Math.abs(hit.x) < 12.8 && Math.abs(hit.z) < 8.3) return [hit.x, hit.z];
      return null;
    };
    const commit = () => {
      const points = strokeRef.current;
      strokeRef.current = null;
      setStroke(null);
      const t = toolRef.current;
      if (!points || !t) return;
      // A tap without a drag still leaves a dot.
      const pts = points.length >= 4 ? points : [...points, points[0] + 0.01, points[1]];
      const doodle: DoodleInput = { kind: 'line', color: t.color, width: t.width, points: pts };
      onDoodle({ op: 'add', doodle });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = toolRef.current;
      const at = pick(e);
      if (!t || !at) return;
      e.preventDefault();
      if (t.kind === 'pen') {
        el.setPointerCapture(e.pointerId);
        strokeRef.current = [at[0], at[1]];
        setStroke([...strokeRef.current]);
      } else if (t.kind === 'note') {
        const text = t.noteText.trim();
        if (!text) return;
        // Upright for whoever placed it: along the camera's view across the table.
        const yaw = Math.atan2(camera.position.x - at[0], camera.position.z - at[1]);
        onDoodle({ op: 'add', doodle: { kind: 'note', color: t.color, x: at[0], z: at[1], text, angle: yaw } });
      } else {
        const mine = doodlesRef.current.filter((d) => moderator || d.author === myKey);
        let best: { d: Doodle; dist: number } | null = null;
        for (const d of mine) {
          const dist = distanceTo(d, at[0], at[1]);
          if (dist < 0.25 && (!best || dist < best.dist)) best = { d, dist };
        }
        if (best) onDoodle({ op: 'remove', id: best.d.id });
      }
    };
    const move = (e: PointerEvent) => {
      const points = strokeRef.current;
      if (!points) return;
      const at = pick(e);
      if (!at) return;
      const lx = points[points.length - 2];
      const lz = points[points.length - 1];
      if (Math.hypot(at[0] - lx, at[1] - lz) < 0.05) return;
      points.push(at[0], at[1]);
      if (points.length / 2 >= MAX_LINE_POINTS) {
        // A very long stroke is sent in pieces.
        commit();
        strokeRef.current = [at[0], at[1]];
      }
      setStroke(strokeRef.current ? [...strokeRef.current] : null);
    };
    const up = () => {
      if (strokeRef.current) commit();
    };
    const prevTouch = el.style.touchAction;
    el.style.touchAction = 'none';
    el.style.cursor = tool.kind === 'erase' ? 'cell' : 'crosshair';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.style.touchAction = prevTouch;
      el.style.cursor = '';
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      strokeRef.current = null;
      setStroke(null);
    };
  }, [tool !== null, tool?.kind, camera, gl, moderator, myKey, onDoodle]);

  return (
    <group>
      {doodles.map((d) =>
        d.kind === 'line' ? <LineMesh key={d.id} points={d.points} width={d.width} color={d.color} /> : <NoteMesh key={d.id} doodle={d} />,
      )}
      {stroke && tool && <LineMesh points={stroke.length >= 4 ? stroke : [...stroke, stroke[0] + 0.01, stroke[1]]} width={tool.width} color={tool.color} opacity={0.8} />}
    </group>
  );
}
