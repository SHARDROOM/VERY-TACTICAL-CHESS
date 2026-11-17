import { useEffect, useMemo, useRef, useState } from 'react';
import { keepAwake } from '../scene/renderPace';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, CylinderGeometry, Quaternion, SRGBColorSpace, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import { isHex, playersOf, type Color } from '../engine';
import { HEX_FRAME_R } from '../scene/coords';
import { TABLE_TOP_Y } from '../scene/WoodTable';
import { COIN, DISH, simulateCoinThrow, type CoinThrow, type Pose } from './coinSim';
import { playSfx } from '../audio/sfx';

/** Where things sit, for a dealer standing on `side` (+1 = +x) of the table. */
export function coinLayout(side: 1 | -1) {
  if (isHex()) {
    // The hexagon: each dish just beyond the right-hand end of its player's back rank (the corner
    // there), the tally between it and the board, the dealer further out the same way.
    const dish = {} as Record<Color, [number, number]>;
    const tally = {} as Record<Color, [number, number]>;
    const dealer = {} as Record<Color, number>;
    for (const [color, corner] of [['white', 300], ['black', 60], ['red', 180]] as const) {
      const a = (corner * Math.PI) / 180;
      // The corner on the table (the board's plane has y toward black and red; the table's z is the other way).
      const [cx, cz] = [Math.cos(a), -Math.sin(a)];
      dish[color] = [cx * (HEX_FRAME_R + 1.3), cz * (HEX_FRAME_R + 1.3)];
      tally[color] = [cx * (HEX_FRAME_R + 0.2) + (color === 'red' ? 0 : 0.9), cz * (HEX_FRAME_R + 0.2)];
      dealer[color] = dish[color][0] + Math.sign(cx || 1) * 5;
    }
    return { dealerX: dealer, dish, tally };
  }
  const dishX = side * 6.9;
  // Kept toward the middle of the table so the default camera (and the side panel) leave them in view.
  const whiteZ = 1.5;
  const blackZ = -1.9;
  const redZ = -0.2;
  const tallyX = side * 5.3;
  const dealer = dishX + side * 5;
  return {
    dealerX: { white: dealer, black: dealer, red: dealer } as Record<Color, number>,
    dish: { white: [dishX, whiteZ], black: [dishX, blackZ], red: [dishX, redZ] } as Record<Color, [number, number]>,
    /** Tally marks carved between the board and each dish. */
    tally: { white: [tallyX, whiteZ], black: [tallyX, blackZ], red: [tallyX, redZ] } as Record<Color, [number, number]>,
  };
}

// ---- coin look -------------------------------------------------------------

function useCoinAssets() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(110, 100, 20, 128, 128, 128);
    g.addColorStop(0, '#ffe9a3');
    g.addColorStop(0.6, '#e2b53c');
    g.addColorStop(1, '#a8781c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(120, 80, 10, 0.8)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 128, 96, 0, Math.PI * 2);
    ctx.stroke();
    // A five-pointed star in the middle.
    ctx.fillStyle = 'rgba(140, 95, 15, 0.85)';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 62 : 26;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const face = new CanvasTexture(c);
    face.colorSpace = SRGBColorSpace;
    const geometry = new CylinderGeometry(COIN.radius, COIN.radius, COIN.halfHeight * 2, 40);
    return { face, geometry };
  }, []);
}

function CoinModel() {
  const { face, geometry } = useCoinAssets();
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {/* CylinderGeometry groups: side, top, bottom. */}
      <meshStandardMaterial attach="material-0" color="#d9a62e" metalness={1} roughness={0.32} />
      <meshStandardMaterial attach="material-1" map={face} metalness={0.9} roughness={0.35} />
      <meshStandardMaterial attach="material-2" map={face} metalness={0.9} roughness={0.35} />
    </mesh>
  );
}

function Dish({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, TABLE_TOP_Y, z]}>
      <mesh position={[0, DISH.baseHeight / 2, 0]} receiveShadow>
        <cylinderGeometry args={[DISH.radius + DISH.rimThickness, DISH.radius + DISH.rimThickness, DISH.baseHeight, 48]} />
        <meshStandardMaterial color="#2c1b10" roughness={0.6} />
      </mesh>
      <mesh position={[0, DISH.rimHeight, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[DISH.radius + DISH.rimThickness / 2, DISH.rimThickness / 2, 12, 48]} />
        <meshStandardMaterial color="#3d2716" roughness={0.55} />
      </mesh>
      <mesh position={[0, DISH.rimHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[DISH.radius + DISH.rimThickness, DISH.radius + DISH.rimThickness, DISH.rimHeight, 48, 1, true]} />
        <meshStandardMaterial color="#3d2716" roughness={0.55} side={2} />
      </mesh>
    </group>
  );
}

// ---- tally marks -------------------------------------------------------------

function useGrooveTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(210, 160, 110, 0)');
    g.addColorStop(0.25, 'rgba(210, 160, 110, 0.55)'); // freshly cut light wood edge
    g.addColorStop(0.45, 'rgba(30, 16, 6, 0.95)'); // dark groove
    g.addColorStop(0.6, 'rgba(30, 16, 6, 0.9)');
    g.addColorStop(0.8, 'rgba(120, 75, 40, 0.4)');
    g.addColorStop(1, 'rgba(120, 75, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    // Tapered at both ends, like a knife stroke.
    ctx.moveTo(0, 16);
    ctx.quadraticCurveTo(30, 4, 128, 5);
    ctx.quadraticCurveTo(226, 4, 256, 16);
    ctx.quadraticCurveTo(226, 28, 128, 27);
    ctx.quadraticCurveTo(30, 28, 0, 16);
    ctx.fill();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
}

const MARK = { length: 0.62, width: 0.075, gap: 0.16, groupGap: 0.35 };

/** Position and angle (about y) of mark `i`: groups of four strokes and a fifth across them. */
function markPlacement(i: number): { x: number; z: number; angle: number; length: number } {
  const group = Math.floor(i / 5);
  const k = i % 5;
  const groupWidth = 3 * MARK.gap;
  const x0 = group * (groupWidth + MARK.groupGap);
  // A little hand-made wobble, the same every time.
  const jitter = Math.sin(i * 12.9898) * 0.02;
  if (k < 4) return { x: x0 + k * MARK.gap + jitter, z: jitter, angle: Math.PI / 2 + jitter * 3, length: MARK.length };
  return { x: x0 + groupWidth / 2, z: 0, angle: Math.PI / 2 - 1.05, length: MARK.length * 1.15 };
}

function Knife() {
  return (
    <group rotation={[0, 0, 0.9]}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.025, 0.42, 0.07]} />
        <meshStandardMaterial color="#d6d9de" metalness={1} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <boxGeometry args={[0.06, 0.3, 0.09]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
    </group>
  );
}

interface MarkState {
  i: number;
  /** When carving starts (seconds on the tally's clock); < 0 for marks already there. */
  born: number;
  dying: number | null;
  sounded?: boolean;
}

/** Tally marks carved into the table; new ones are scored by a knife, removed ones fade away. */
function Tally({ count, x, z, flip }: { count: number; x: number; z: number; flip: boolean }) {
  const groove = useGrooveTexture();
  const [marks, setMarks] = useState<MarkState[]>(() => Array.from({ length: count }, (_, i) => ({ i, born: -1, dying: null })));
  const clock = useRef(0);
  const knife = useRef<Group>(null);
  const meshes = useRef<(Mesh | null)[]>([]);

  useEffect(() => {
    setMarks((ms) => {
      const alive = ms.filter((m) => m.dying === null);
      const next = [...ms];
      if (count > alive.length) {
        for (let i = alive.length; i < count; i++) next.push({ i, born: clock.current + (i - alive.length) * 0.5, dying: null });
      } else if (count < alive.length) {
        for (const m of alive.slice(count)) m.dying = clock.current;
      }
      return next;
    });
  }, [count]);

  useFrame((_, dt) => {
    // Frames can be far apart while the table is still (see renderPace).
    clock.current += Math.min(dt, 0.1);
    const now = clock.current;
    let carving: { m: MarkState; p: number } | null = null;
    marks.forEach((m, idx) => {
      const mesh = meshes.current[idx];
      if (!mesh) return;
      const place = markPlacement(m.i);
      const p = m.born < 0 ? 1 : Math.min(1, Math.max(0, (now - m.born) / 0.45));
      mesh.scale.set(Math.max(0.001, p), 1, 1);
      // Grow from one end: shift so the stroke starts at its tip.
      const dirX = Math.cos(place.angle);
      const dirZ = -Math.sin(place.angle);
      const off = (place.length * (1 - p)) / 2;
      mesh.position.set(place.x - dirX * off, 0.003, place.z - dirZ * off);
      const mat = mesh.material as MeshStandardMaterial;
      mat.opacity = m.dying === null ? 1 : Math.max(0, 1 - (now - m.dying) / 0.6);
      if (m.dying !== null && now - m.dying < 0.6) keepAwake();
      if (m.born >= 0 && p > 0 && p < 1) {
        carving = { m, p };
        if (!m.sounded) {
          m.sounded = true;
          playSfx('carve');
        }
      }
    });
    const k = knife.current;
    if (k) {
      const c = carving as { m: MarkState; p: number } | null;
      k.visible = !!c;
      if (c) {
        const place = markPlacement(c.m.i);
        const dirX = Math.cos(place.angle);
        const dirZ = -Math.sin(place.angle);
        const along = (c.p - 0.5) * place.length;
        k.position.set(place.x + dirX * along, 0, place.z + dirZ * along);
        k.rotation.set(0, place.angle, 0);
      }
    }
    // Drop marks that have finished fading.
    if (marks.some((m) => m.dying !== null && now - m.dying > 0.7)) {
      setMarks((ms) => ms.filter((m) => m.dying === null || now - m.dying <= 0.7));
    }
  });

  return (
    <group position={[x, TABLE_TOP_Y, z]} rotation={[0, flip ? Math.PI : 0, 0]}>
      {/* Centre the row of marks on the anchor. */}
      <group position={[-0.24, 0, 0]}>
        {marks.map((m, idx) => {
          const place = markPlacement(m.i);
          return (
            <mesh
              key={`${m.i}-${m.born}`}
              ref={(el) => (meshes.current[idx] = el)}
              rotation={[-Math.PI / 2, 0, place.angle]}
              receiveShadow
            >
              <planeGeometry args={[place.length, MARK.width]} />
              <meshStandardMaterial map={groove} transparent depthWrite={false} roughness={0.9} polygonOffset polygonOffsetFactor={-3} />
            </mesh>
          );
        })}
        <group ref={knife} visible={false}>
          <Knife />
        </group>
      </group>
    </group>
  );
}

// ---- coins in play -------------------------------------------------------------

type Op = { color: Color; kind: 'throw'; count: number } | { color: Color; kind: 'collect'; count: number };

interface Flight {
  color: Color;
  throw: CoinThrow;
  startedAt: number | null;
  ids: number[];
  /** Last step already given its sounds. */
  sounded: number;
  /** Set when it has landed: frames can run again before React re-renders, so finish only once. */
  finished?: boolean;
}

interface Collect {
  color: Color;
  coins: { id: number; from: Pose }[];
  startedAt: number | null;
  finished?: boolean;
}

let nextCoinId = 1;

/**
 * Each player's AP as gold coins in a dish beside the board. When AP goes up, a dealer
 * at the table's edge throws coins in (rigid-body physics); when AP is spent, coins fly
 * back to the dealer. Tally marks carved next to each dish keep count.
 */
export function CoinTable({ ap, side }: { ap: Record<Color, number>; side: 1 | -1 }) {
  const layout = useMemo(() => coinLayout(side), [side]);
  const [piles, setPiles] = useState<Record<Color, { id: number; pose: Pose }[]>>({ white: [], black: [], red: [], gray: [] });
  const [flight, setFlight] = useState<Flight | null>(null);
  const [collect, setCollect] = useState<Collect | null>(null);
  const busy = useRef(false);
  const queue = useRef<Op[]>([]);
  const planned = useRef<Record<Color, number>>({ white: 0, black: 0, red: 0, gray: 0 });
  const pilesRef = useRef(piles);
  pilesRef.current = piles;
  const coinRefs = useRef(new Map<number, Group>());

  // Plan the difference between what is on the table (or on its way) and the AP to show.
  useEffect(() => {
    for (const color of ['white', 'black', 'red'] as const) {
      const diff = (ap[color] ?? 0) - planned.current[color];
      if (diff > 0) queue.current.push({ color, kind: 'throw', count: diff });
      if (diff < 0) queue.current.push({ color, kind: 'collect', count: -diff });
      planned.current[color] = ap[color] ?? 0;
    }
    pump();
  }, [ap.white, ap.black, ap.red]);

  const pump = () => {
    if (busy.current) return;
    const op = queue.current.shift();
    if (!op) return;
    busy.current = true;
    if (op.kind === 'throw') {
      const [dishX, dishZ] = layout.dish[op.color];
      simulateCoinThrow({ count: op.count, dishX, dishZ, fromX: layout.dealerX[op.color], pile: pilesRef.current[op.color].map((c) => c.pose) })
        .then((t) => setFlight({ color: op.color, throw: t, startedAt: null, ids: t.coins.map(() => nextCoinId++), sounded: -1 }))
        .catch(() => {
          // No physics: drop the coins straight into the dish.
          setPiles((p) => ({
            ...p,
            [op.color]: [
              ...p[op.color],
              ...Array.from({ length: op.count }, (_, i) => ({
                id: nextCoinId++,
                pose: { position: new Vector3(dishX + (i % 3) * 0.2 - 0.2, TABLE_TOP_Y + 0.08 + i * 0.065, dishZ), quaternion: new Quaternion() },
              })),
            ],
          }));
          done();
        });
    } else {
      const pile = [...pilesRef.current[op.color]];
      // Take from the top of the pile first.
      pile.sort((a, b) => b.pose.position.y - a.pose.position.y);
      const taken = pile.slice(0, op.count);
      setPiles((p) => ({ ...p, [op.color]: p[op.color].filter((c) => !taken.includes(c)) }));
      setCollect({ color: op.color, coins: taken.map((c) => ({ id: c.id, from: c.pose })), startedAt: null });
      playSfx('coinCollect');
    }
  };

  const done = () => {
    busy.current = false;
    pump();
  };

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (flight && !flight.finished) {
      if (flight.startedAt === null) flight.startedAt = now;
      const step = Math.floor((now - flight.startedAt) / flight.throw.dt);
      for (const c of flight.throw.coins) {
        if (c.start > flight.sounded && c.start <= step) playSfx('coinWhoosh', { strength: 0.7 });
        for (const hit of c.impacts) {
          const at = c.start + hit.step;
          if (at > flight.sounded && at <= step) playSfx('coinClink', { strength: hit.strength });
        }
      }
      flight.sounded = step;
      flight.throw.coins.forEach((c, k) => {
        const g = coinRefs.current.get(flight.ids[k]);
        if (!g) return;
        const local = step - c.start;
        g.visible = local >= 0;
        if (local < 0) return;
        const n = c.frames.length / 7;
        const o = Math.min(n - 1, local) * 7;
        g.position.set(c.frames[o], c.frames[o + 1], c.frames[o + 2]);
        g.quaternion.set(c.frames[o + 3], c.frames[o + 4], c.frames[o + 5], c.frames[o + 6]);
      });
      if (step >= flight.throw.steps) {
        const f = flight;
        f.finished = true;
        setFlight(null);
        setPiles((p) => ({ ...p, [f.color]: [...p[f.color], ...f.throw.coins.map((c, k) => ({ id: f.ids[k], pose: c.final }))] }));
        done();
      }
    }
    if (collect && !collect.finished) {
      if (collect.startedAt === null) collect.startedAt = now;
      const t = (now - collect.startedAt) / 0.8;
      collect.coins.forEach((c, k) => {
        const g = coinRefs.current.get(c.id);
        if (!g) return;
        const p = Math.min(1, Math.max(0, t - k * 0.12));
        // Flicked up, then flying back over to the dealer.
        const to = new Vector3(layout.dealerX[collect.color], TABLE_TOP_Y + 2.2, c.from.position.z);
        g.position.lerpVectors(c.from.position, to, p * p);
        g.position.y += Math.sin(p * Math.PI) * 1.2;
        g.rotation.x += 0.35;
        g.visible = p < 1;
      });
      if (t > 1 + collect.coins.length * 0.12) {
        collect.finished = true;
        setCollect(null);
        done();
      }
    }
  });

  const register = (id: number) => (el: Group | null) => {
    if (el) coinRefs.current.set(id, el);
    else coinRefs.current.delete(id);
  };

  return (
    <group>
      {playersOf().map((color) => (
        <group key={color}>
          <Dish x={layout.dish[color][0]} z={layout.dish[color][1]} />
          <Tally count={ap[color]} x={layout.tally[color][0]} z={layout.tally[color][1]} flip={color === 'black'} />
          {piles[color].map((c) => (
            <group key={c.id} ref={register(c.id)} position={c.pose.position} quaternion={c.pose.quaternion}>
              <CoinModel />
            </group>
          ))}
        </group>
      ))}
      {flight &&
        flight.ids.map((id) => (
          <group key={id} ref={register(id)} visible={false}>
            <CoinModel />
          </group>
        ))}
      {collect &&
        collect.coins.map((c) => (
          <group key={c.id} ref={register(c.id)} position={c.from.position} quaternion={c.from.quaternion}>
            <CoinModel />
          </group>
        ))}
    </group>
  );
}
