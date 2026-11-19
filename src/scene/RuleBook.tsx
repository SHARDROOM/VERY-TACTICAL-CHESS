import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BackSide, BufferAttribute, BufferGeometry, FrontSide, Group, Plane, Raycaster, Vector2, Vector3, type CanvasTexture } from 'three';
import { TABLE_TOP_Y } from './WoodTable';
import { keepAwake } from './renderPace';
import { BOOK_PAGES, bookFontsReady, coverTexture, pageTexture } from './ruleBookPages';

/*
 * The rule book on the title screen's table ("이 게임이 매우 전략적인 이유"): a leather-bound book
 * of three paper sheets. Each leaf turns about the spine under its own little physics (gravity,
 * inertia, a bounce where it lands, and paper that bends as it moves and sags off the stack), by a
 * drag of the finger or a tap, or by the reader's buttons (BookControl).
 */

/** Where it lies and how big it is (world units; a board square is 1). */
export const BOOK = { x: -8.2, z: 5.6, yaw: 0.12, w: 2.4, d: 3.2, cover: 0.07, gap: 0.016, sheets: 3 } as const;
/** The front cover and the sheets turn; the back cover stays. */
const LEAVES = BOOK.sheets + 1;
/** Reading faces: the inside of the front cover, each sheet's two sides, the inside of the back cover. */
export const BOOK_FACES = BOOK_PAGES.length;

type Listener = () => void;

/**
 * The book's state as the screen sees it, and the reader's commands: shared by the title screen's
 * buttons, the camera (which page to look at) and the 3D book (which plays the turns).
 */
export class BookControl {
  /** The reader wants the book open. */
  open = false;
  /** Leaves turned to the left (0: closed .. LEAVES). */
  spread = 0;
  /** Which page of the open spread is being read (narrow screens show one at a time): 0 left, 1 right. */
  side: 0 | 1 = 0;
  /** A narrow screen: one page at a time. */
  single = false;
  /** Turns waiting to be played: a leaf, which way, and when (performance.now ms). */
  readonly turns: { leaf: number; dir: 1 | -1; at: number }[] = [];
  private listeners = new Set<Listener>();

  subscribe(f: Listener): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private emit() {
    for (const f of this.listeners) f();
  }

  /** The page being read, in reading order (0 .. BOOK_FACES - 1), or null with the book shut. */
  get page(): number | null {
    return this.spread === 0 ? null : 2 * (this.spread - 1) + this.side;
  }

  openBook(): void {
    if (this.open) return;
    this.open = true;
    this.side = 0;
    // Once the camera is there, the cover swings open.
    this.turns.push({ leaf: 0, dir: 1, at: performance.now() + 900 });
    this.spread = 1;
    this.emit();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    // The turned leaves fall back, the top one first.
    const now = performance.now();
    for (let leaf = this.spread - 1, i = 0; leaf >= 0; leaf--, i++) this.turns.push({ leaf, dir: -1, at: now + i * 220 });
    this.spread = 0;
    this.emit();
  }

  next(): void {
    if (!this.open) return;
    if (this.single && this.side === 0) {
      this.side = 1;
    } else if (this.spread < LEAVES) {
      this.turns.push({ leaf: this.spread, dir: 1, at: performance.now() });
      this.spread++;
      this.side = 0;
    }
    this.emit();
  }

  prev(): void {
    if (!this.open) return;
    if (this.single && this.side === 1) {
      this.side = 0;
    } else if (this.spread > 1) {
      this.turns.push({ leaf: this.spread - 1, dir: -1, at: performance.now() });
      this.spread--;
      this.side = 1;
    }
    this.emit();
  }

  get canNext(): boolean {
    return this.open && (this.spread < LEAVES || (this.single && this.side === 0));
  }
  get canPrev(): boolean {
    return this.open && (this.spread > 1 || (this.single && this.side === 1));
  }

  setSingle(single: boolean): void {
    if (this.single === single) return;
    this.single = single;
    this.emit();
  }

  /** The leaves came to rest with `spread` turned (a hand turned some): reading moves to the new pages. */
  settled(spread: number): void {
    if (!this.open || spread === this.spread || spread === 0) return;
    this.side = spread > this.spread ? 0 : 1;
    this.spread = spread;
    this.emit();
  }

  /**
   * What the camera should frame, in world space: the open spread, or on a narrow screen the page
   * being read. Null while the book is shut.
   */
  focus(): { center: [number, number, number]; width: number; depth: number; yaw: number; margin: number } | null {
    if (!this.open) return null;
    const local = this.single ? (this.side === 0 ? -BOOK.w / 2 : BOOK.w / 2) : 0;
    const c = Math.cos(BOOK.yaw);
    const s = Math.sin(BOOK.yaw);
    return {
      center: [BOOK.x + local * c, TABLE_TOP_Y + 0.15, BOOK.z - local * s],
      width: this.single ? BOOK.w * 1.04 : BOOK.w * 2.08,
      depth: BOOK.d * 1.04,
      yaw: BOOK.yaw,
      // A whole spread needs room for its near corners (they loom in perspective); one page less.
      margin: this.single ? 1.13 : 1.22,
    };
  }
}

/** A leaf's motion: its angle about the spine (0: lying right, π: lying left), and its bend. */
interface Leaf {
  th: number;
  w: number;
  curl: number;
  cv: number;
  /** Held by a finger: pulled toward `target`. */
  held: boolean;
  target: number;
}

const SEGMENTS = 20;
/** Gravity's pull on a raised leaf, the air's damping, a finger's pull. */
const GRAVITY = 9;
const DAMPING = 1.6;
const HOLD = 70;
const HOLD_DAMPING = 11;
/** A tap or a button: the push that carries a leaf over. */
const PUSH = 9.8;

/** Heights of each leaf's hinge on the right stack and on the left. */
function hinge(i: number): { right: number; left: number } {
  const { cover, gap, sheets } = BOOK;
  if (i === 0) return { right: cover + (sheets + 1) * gap + cover / 2, left: cover / 2 };
  return { right: cover + (sheets + 1 - i) * gap, left: cover + i * gap };
}

/** A sheet's bendable surface: columns from the spine to the edge, two rows across. */
function sheetGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const n = (SEGMENTS + 1) * 2;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let j = 0; j <= SEGMENTS; j++) {
    for (let r = 0; r < 2; r++) {
      const k = j * 2 + r;
      uv[k * 2] = j / SEGMENTS;
      // The far edge (−z) is the top of the page.
      uv[k * 2 + 1] = r === 0 ? 1 : 0;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    const a = j * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Bends a sheet's surface: each column's angle is the leaf's plus its curl, more toward the edge. */
function bend(g: BufferGeometry, leaf: Leaf) {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nor = g.getAttribute('normal') as BufferAttribute;
  const ds = BOOK.w / SEGMENTS;
  const half = BOOK.d / 2;
  let x = 0;
  let y = 0;
  for (let j = 0; j <= SEGMENTS; j++) {
    const angle = (f: number) => Math.min(Math.PI, Math.max(0, leaf.th + leaf.curl * Math.pow(f, 1.6)));
    if (j > 0) {
      const a = angle((j - 0.5) / SEGMENTS);
      x += Math.cos(a) * ds;
      y += Math.sin(a) * ds;
    }
    const a = angle(j / SEGMENTS);
    for (let r = 0; r < 2; r++) {
      const k = j * 2 + r;
      pos.setXYZ(k, x, y, r === 0 ? -half : half);
      nor.setXYZ(k, -Math.sin(a), Math.cos(a), 0);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  g.computeBoundingSphere();
}

export function RuleBook({ control }: { control: BookControl }) {
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    let live = true;
    void bookFontsReady().then(() => live && setFonts(true));
    return () => {
      live = false;
    };
  }, []);
  // Faces: the cover's outside and inside, each sheet's front and back, the back cover's inside and outside.
  const tex = useMemo(() => {
    const page = (i: number, mirror: boolean): CanvasTexture => pageTexture(i, mirror);
    return {
      coverOut: coverTexture(true),
      coverIn: page(0, false),
      sheets: Array.from({ length: BOOK.sheets }, (_, k) => ({ front: page(2 * k + 1, false), back: page(2 * k + 2, true) })),
      backIn: page(BOOK_FACES - 1, false),
      backOut: coverTexture(false),
    };
    // Repainted once the fonts are in.
  }, [fonts]);
  useEffect(
    () => () => {
      tex.coverOut.dispose();
      tex.coverIn.dispose();
      tex.backIn.dispose();
      tex.backOut.dispose();
      for (const s of tex.sheets) {
        s.front.dispose();
        s.back.dispose();
      }
    },
    [tex],
  );

  const leaves = useRef<Leaf[]>(Array.from({ length: LEAVES }, () => ({ th: 0, w: 0, curl: 0, cv: 0, held: false, target: 0 })));
  // Dev only: the leaves and the reader's state, for checking the physics from the console.
  if (import.meta.env.DEV) (window as unknown as { __vtcBook?: unknown }).__vtcBook = { leaves: leaves.current, control };
  const geoms = useMemo(() => Array.from({ length: BOOK.sheets }, () => sheetGeometry()), []);
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);
  const hinges = useRef<(Group | null)[]>([]);
  const coverRef = useRef<Group>(null);
  const bookRef = useRef<Group>(null);

  // A finger on a leaf: which, where it started, whether it moved.
  const drag = useRef<{ leaf: number; startTh: number; moved: boolean; startX: number } | null>(null);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -(TABLE_TOP_Y + 0.1)), []);
  const hit = useMemo(() => new Vector3(), []);

  /** The leaf on top of the right stack (the next to turn) and of the left (the last turned). */
  const tops = () => {
    const turned = leaves.current.filter((l) => l.th > Math.PI / 2).length;
    return { right: turned < LEAVES ? turned : -1, left: turned - 1 };
  };

  // Once a leaf is taken, the finger is followed over the whole screen (it may leave the book).
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const follow = (clientX: number, clientY: number) => {
    const d = drag.current;
    const book = bookRef.current;
    if (!d || !book) return;
    const rect = gl.domElement.getBoundingClientRect();
    const leaf = leaves.current[d.leaf];
    if (control.single) {
      // One page fills the screen (the spine at its edge): a swipe across most of the screen turns it.
      leaf.target = Math.min(Math.PI, Math.max(0, d.startTh + ((d.startX - clientX) / (rect.width * 0.7)) * Math.PI));
    } else {
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      // Where the finger is across the book: from the left page's edge (−1) to the right one's (+1).
      const local = book.worldToLocal(hit.clone());
      leaf.target = Math.acos(Math.min(1, Math.max(-1, local.x / BOOK.w)));
    }
    leaf.held = true;
    if (Math.abs(leaf.target - d.startTh) > 0.12) d.moved = true;
  };
  const release = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const leaf = leaves.current[d.leaf];
    leaf.held = false;
    // A tap turns the leaf over the way it would go; a drag lets it go as it was moving, with a
    // little flick the way it leans (a page let go upright would otherwise teeter there).
    if (!d.moved) leaf.w = leaf.th < Math.PI / 2 ? PUSH : -PUSH;
    else leaf.w += (leaf.th > Math.PI / 2 ? 1 : -1) * 2.2;
  };
  useEffect(() => {
    const move = (e: PointerEvent) => follow(e.clientX, e.clientY);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  });
  const down = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    if (!control.open) return;
    const { right, left } = tops();
    if (i !== right && i !== left) return;
    e.stopPropagation();
    drag.current = { leaf: i, startTh: leaves.current[i].th, moved: false, startX: e.nativeEvent.clientX };
  };

  useFrame((_, delta) => {
    const ls = leaves.current;
    const now = performance.now();
    // The reader's turns, when their time comes.
    for (let k = control.turns.length - 1; k >= 0; k--) {
      const t = control.turns[k];
      if (t.at > now) continue;
      control.turns.splice(k, 1);
      const leaf = ls[t.leaf];
      if (leaf && !leaf.held) leaf.w = t.dir * PUSH;
    }
    let moving = false;
    // Real time, in small steps (a slow frame does not slow the paper down).
    const span = Math.min(delta, 0.1);
    const steps = Math.max(1, Math.ceil(span / 0.008));
    const dt = span / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < LEAVES; i++) {
        const l = ls[i];
        const a = l.held ? HOLD * (l.target - l.th) - HOLD_DAMPING * l.w : -GRAVITY * Math.cos(l.th) - DAMPING * l.w;
        l.w += a * dt;
        l.th += l.w * dt;
        // The stacks stop it, with a little bounce.
        if (l.th < 0) {
          l.th = 0;
          if (l.w < 0) l.w = -l.w * 0.18;
        } else if (l.th > Math.PI) {
          l.th = Math.PI;
          if (l.w > 0) l.w = -l.w * 0.18;
        }
        // A leaf cannot pass the one turned before it (the cover first, then the sheets in order).
        if (i > 0 && l.th > ls[i - 1].th) {
          l.th = ls[i - 1].th;
          l.w = Math.min(l.w, ls[i - 1].w);
        }
        // Paper bends: it lags behind as it swings, and sags off the stack while raised.
        if (i > 0) {
          const want = -0.065 * l.w - 0.42 * Math.sin(2 * l.th);
          l.cv += (140 * (want - l.curl) - 12 * l.cv) * dt;
          l.curl += l.cv * dt;
        }
        if (l.held || Math.abs(l.w) > 0.02 || Math.abs(l.cv) > 0.02) moving = true;
      }
    }
    if (moving) keepAwake(300);

    // Pose the leaves.
    for (let i = 0; i < LEAVES; i++) {
      const l = ls[i];
      const h = hinge(i);
      const y = h.right + (h.left - h.right) * (l.th / Math.PI);
      const g = hinges.current[i];
      if (g) g.position.set(0, y, 0);
      if (i === 0) {
        if (coverRef.current) coverRef.current.rotation.z = l.th;
      } else bend(geoms[i - 1], l);
    }

    // Once nothing moves, the reader is on the pages the hand left open.
    if (!moving && !drag.current && control.turns.length === 0) control.settled(ls.filter((l) => l.th > Math.PI / 2).length);
  });

  const { w, d, cover } = BOOK;
  return (
    <group ref={bookRef} position={[BOOK.x, TABLE_TOP_Y, BOOK.z]} rotation={[0, BOOK.yaw, 0]}>
      {/* The back cover, with the endpaper on its inside. */}
      <mesh position={[w / 2, cover / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.06, cover, d + 0.06]} />
        <meshStandardMaterial map={tex.backOut} roughness={0.75} />
      </mesh>
      <mesh position={[w / 2, cover + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.backIn} roughness={0.9} />
      </mesh>
      {/* The spine. */}
      <mesh position={[-0.02, cover + 0.03, 0]} castShadow>
        <boxGeometry args={[0.1, cover * 2 + BOOK.sheets * BOOK.gap + 0.04, d + 0.06]} />
        <meshStandardMaterial color="#3d140f" roughness={0.7} />
      </mesh>
      {/* The front cover: stiff leather, gold on the outside, the endpaper inside. */}
      <group ref={(g) => (hinges.current[0] = g)}>
        <group ref={coverRef}>
          <mesh position={[w / 2, 0, 0]} castShadow receiveShadow onPointerDown={down(0)}>
            <boxGeometry args={[w + 0.06, cover, d + 0.06]} />
            <meshStandardMaterial color="#4a1913" roughness={0.75} />
          </mesh>
          <mesh position={[w / 2, cover / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={down(0)}>
            <planeGeometry args={[w + 0.04, d + 0.04]} />
            <meshStandardMaterial map={tex.coverOut} roughness={0.6} metalness={0.15} />
          </mesh>
          {/* Facing down while shut; turned over with the cover, it reads upright from the left. */}
          <mesh position={[w / 2, -cover / 2 - 0.002, 0]} rotation={[Math.PI / 2, 0, Math.PI]} onPointerDown={down(0)}>
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial map={tex.coverIn} roughness={0.9} />
          </mesh>
        </group>
      </group>
      {/* The sheets: paper that bends. */}
      {tex.sheets.map((t, k) => (
        <group key={k} ref={(g) => (hinges.current[k + 1] = g)}>
          <mesh geometry={geoms[k]} castShadow receiveShadow onPointerDown={down(k + 1)}>
            <meshStandardMaterial map={t.front} side={FrontSide} roughness={0.92} />
          </mesh>
          <mesh geometry={geoms[k]} onPointerDown={down(k + 1)}>
            <meshStandardMaterial map={t.back} side={BackSide} roughness={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
