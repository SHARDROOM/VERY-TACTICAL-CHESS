import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
  type PointLight,
} from 'three';
import type { Fx } from '../engine';
import type { AuraSpec } from './auras';
import { squareToWorld } from './coords';
import { ELEMENT_LOOK, type ElementLook, type FxLayerKind, type FxPart } from './fxLooks';
import { playFxSound } from '../audio/sfx';

/** The particle effects of a show, with their start and end times (seconds from `startedAt`). */
export interface FxShow {
  fx: Fx[];
  starts: number[];
  ends: number[];
  /** performance.now() when the show started. */
  startedAt: number;
  /** For each fx, the piece its trail follows (null: not a trail). */
  followers: (string | null)[];
  /** For each fx, a point on the table (x, z) to centre it on instead of its square (a duel's sparks fly between two). */
  points?: ([number, number] | null)[];
  /** Fewer particles, for slow devices. */
  light?: boolean;
}

/** Most particles alive at once per layer; the light look emits 40% as many. */
const CAPS: Record<FxLayerKind, number> = { glow: 2600, smoke: 1100, chunk: 600 };

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uHard;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = 1.0 - d;
    // Soft glow with a brighter core; chunks are solid little discs.
    float a = mix(pow(soft, 1.6) + 0.35 * smoothstep(0.45, 0.0, d), step(d, 0.8) * (1.0 - d * 0.4), uHard);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/** A fixed-size pool of particles drawn as one Points object. */
class ParticlePool {
  readonly cap: number;
  count = 0;
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  /** size0, size1, age, life, gravity, drag, swirl, cx, cz, peakAlpha, flicker, ground */
  private readonly p: Float32Array;
  private static readonly P = 12;
  readonly material: ShaderMaterial;

  constructor(cap: number, kind: FxLayerKind) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.c0 = new Float32Array(cap * 3);
    this.c1 = new Float32Array(cap * 3);
    this.p = new Float32Array(cap * ParticlePool.P);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new BufferAttribute(this.col, 3));
    geometry.setAttribute('size', new BufferAttribute(this.size, 1));
    geometry.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    geometry.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 500 }, uHard: { value: kind === 'chunk' ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: kind === 'glow' ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = kind === 'glow' ? 3 : 2;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, part: FxPart, scale: number, cx: number, cz: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    const a = TMP_A.set(part.colors[0]);
    const b = TMP_B.set(part.colors[1]);
    this.c0.set([a.r, a.g, a.b], i * 3);
    this.c1.set([b.r, b.g, b.b], i * 3);
    const s0 = r(part.size) * scale;
    const o = i * ParticlePool.P;
    const p = this.p;
    p[o] = s0;
    p[o + 1] = s0 * part.grow;
    p[o + 2] = 0;
    p[o + 3] = r(part.life);
    p[o + 4] = part.gravity;
    p[o + 5] = part.drag;
    p[o + 6] = part.swirl ?? 0;
    p[o + 7] = cx;
    p[o + 8] = cz;
    p[o + 9] = part.alpha ?? 1;
    p[o + 10] = part.flicker ? 1 : 0;
    p[o + 11] = part.ground === 'bounce' ? 1 : part.ground === 'die' ? 2 : 0;
  }

  update(dt: number): void {
    const { pos, vel, col, size, alpha, c0, c1, p } = this;
    const P = ParticlePool.P;
    let i = 0;
    while (i < this.count) {
      const o = i * P;
      p[o + 2] += dt;
      const age = p[o + 2];
      const life = p[o + 3];
      const i3 = i * 3;
      let dead = age >= life;
      if (!dead) {
        const drag = Math.exp(-p[o + 5] * dt);
        let vx = vel[i3] * drag;
        let vy = vel[i3 + 1] * drag + p[o + 4] * dt;
        let vz = vel[i3 + 2] * drag;
        const swirl = p[o + 6];
        if (swirl) {
          // Turn around the emitter's centre.
          const dx = pos[i3] - p[o + 7];
          const dz = pos[i3 + 2] - p[o + 8];
          vx += -dz * swirl * dt;
          vz += dx * swirl * dt;
        }
        pos[i3] += vx * dt;
        pos[i3 + 1] += vy * dt;
        pos[i3 + 2] += vz * dt;
        if (pos[i3 + 1] < 0.015) {
          const ground = p[o + 11];
          if (ground === 2) dead = true;
          else if (ground === 1 && vy < 0) {
            pos[i3 + 1] = 0.015;
            vy = -vy * 0.3;
            vx *= 0.6;
            vz *= 0.6;
          } else pos[i3 + 1] = 0.015;
        }
        vel[i3] = vx;
        vel[i3 + 1] = vy;
        vel[i3 + 2] = vz;
      }
      if (dead) {
        this.remove(i);
        continue;
      }
      const t = age / life;
      col[i3] = c0[i3] + (c1[i3] - c0[i3]) * t;
      col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * t;
      col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * t;
      size[i] = p[o] + (p[o + 1] - p[o]) * t;
      // Quick fade in, long fade out.
      let a = p[o + 9] * Math.min(1, t * 8) * (1 - t) ** 1.4;
      if (p[o + 10]) a *= 0.55 + 0.45 * Math.sin(age * 31 + i);
      alpha[i] = a;
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    for (const name of ['position', 'color', 'size', 'alpha']) (g.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  /** Moves the last particle into slot `i`. */
  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const P = ParticlePool.P;
    for (const [arr, n] of [[this.pos, 3], [this.vel, 3], [this.c0, 3], [this.c1, 3]] as const) arr.copyWithin(i * n, last * n, last * n + n);
    this.p.copyWithin(i * P, last * P, last * P + P);
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** A lightning bolt: a white-hot core in a blue haze. */
const BOLT_CORE: FxPart = { layer: 'glow', share: 1, colors: ['#ffffff', '#9cc2ff'], life: [0.12, 0.2], size: [0.24, 0.32], grow: 0.6, speed: 0, up: 0, gravity: 0, drag: 0, jitter: 0 };
const BOLT_HALO: FxPart = { layer: 'glow', share: 1, colors: ['#bcd5ff', '#3f6fd8'], life: [0.15, 0.25], size: [0.8, 1.1], grow: 1.3, speed: 0, up: 0, gravity: 0, drag: 0, jitter: 0, alpha: 0.3 };

const TMP_A = new Color();
const TMP_B = new Color();

/** An fx being played: when it started, how much it has emitted, where it is. */
interface Emitter {
  fx: Fx;
  look: ElementLook;
  start: number;
  end: number;
  started: boolean;
  carry: number;
  /** Next lightning strike, seconds into the fx. */
  nextBolt: number;
  follower: string | null;
  point: Vector3 | null;
}

/** A square's spot: on the board, or on the air layer above it. */
const world = (sq: number) => new Vector3(...squareToWorld(sq));

/** The table area an `area` fx covers. */
function areaRect(fx: Fx): { x0: number; x1: number; z0: number; z1: number } {
  if (fx.at === null || fx.to === null) return { x0: -4, x1: 4, z0: -4, z1: 4 };
  const a = world(fx.at);
  const b = world(fx.to);
  return { x0: Math.min(a.x, b.x) - 0.5, x1: Math.max(a.x, b.x) + 0.5, z0: Math.min(a.z, b.z) - 0.5, z1: Math.max(a.z, b.z) + 0.5 };
}

/** How much more an fx emits for its size: a beam per its length, an area per its size. */
function spread(fx: Fx): number {
  if (fx.shape === 'beam' && fx.at !== null && fx.to !== null) return Math.min(3, Math.max(1, world(fx.at).distanceTo(world(fx.to)) / 2.5));
  if (fx.shape === 'area') {
    const r = areaRect(fx);
    return Math.min(4, Math.max(1, ((r.x1 - r.x0) * (r.z1 - r.z0)) / 6));
  }
  return 1;
}

/** A jagged path from `a` to `b` (midpoint displacement). */
function boltPath(a: Vector3, b: Vector3, roughness: number): Vector3[] {
  let pts = [a, b];
  for (let level = 0; level < 5; level++) {
    const next: Vector3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const len = p.distanceTo(q);
      const mid = p.clone().lerp(q, 0.5);
      mid.x += (Math.random() - 0.5) * len * roughness;
      mid.z += (Math.random() - 0.5) * len * roughness;
      mid.y += (Math.random() - 0.5) * len * roughness * 0.3;
      next.push(mid, q);
    }
    pts = next;
  }
  return pts;
}

/**
 * Particle effects over the board: bursts, beams, areas and trails for the twelve elements,
 * with a flash of light and lightning bolts where the element has them.
 */
/** Auras use at most this share of each pool, so a show always has room. */
const AURA_SHARE = 0.45;

export function FxLayer({ show, pieceAt, auras = [], light = false }: { show: FxShow | null; pieceAt: (id: string) => Vector3 | null; auras?: AuraSpec[]; light?: boolean }) {
  const pools = useMemo(
    () => ({ glow: new ParticlePool(CAPS.glow, 'glow'), smoke: new ParticlePool(CAPS.smoke, 'smoke'), chunk: new ParticlePool(CAPS.chunk, 'chunk') }),
    [],
  );
  useEffect(() => () => Object.values(pools).forEach((p) => p.dispose()), [pools]);

  const emitters = useRef<Emitter[]>([]);
  const startedAt = useRef(0);
  const lights = useRef<(PointLight | null)[]>([null, null]);
  const lightLevel = useRef([0, 0]);
  const nextLight = useRef(0);
  const density = light || show?.light ? 0.4 : 1;
  const auraCarry = useRef(new Map<string, number>());

  /** Particles clinging to a piece: born on its body, drifting the way the element drifts. */
  const emitAura = (a: AuraSpec, at: Vector3, n: number) => {
    const look = ELEMENT_LOOK[a.element];
    for (const part of look.parts) {
      const pool = pools[part.layer];
      if (pool.count > pool.cap * AURA_SHARE) continue;
      const count = Math.round(n * part.share + Math.random() * 0.5);
      for (let k = 0; k < count; k++) {
        const ang = Math.random() * Math.PI * 2;
        const r = a.radius * (0.6 + Math.random() * 0.5);
        const x = at.x + Math.cos(ang) * r;
        const z = at.z + Math.sin(ang) * r;
        const y = at.y + 0.05 + Math.random() * a.height;
        // Gentler than an fx: drift, no burst; rain-like elements just drip.
        const vx = Math.cos(ang) * part.speed * 0.15 + (Math.random() - 0.5) * part.jitter * 0.4;
        const vz = Math.sin(ang) * part.speed * 0.15 + (Math.random() - 0.5) * part.jitter * 0.4;
        const vy = part.gravity < -3 ? 0.2 : part.up * 0.35;
        const soft: FxPart = part.gravity < -3 ? { ...part, gravity: part.gravity * 0.25, ground: 'die' } : part;
        pool.spawn(x, y, z, vx, vy, vz, soft, 0.55 + 0.1 * a.strength, at.x, at.z);
      }
    }
  };

  useEffect(() => {
    if (!show) {
      emitters.current = [];
      return;
    }
    startedAt.current = show.startedAt;
    emitters.current = show.fx.map((fx, i) => ({
      fx,
      look: ELEMENT_LOOK[fx.element],
      start: show.starts[i],
      end: show.ends[i],
      started: false,
      carry: 0,
      nextBolt: 0,
      follower: show.followers[i],
      point: show.points?.[i] ? new Vector3(show.points[i]![0], 0, show.points[i]![1]) : null,
    }));
  }, [show]);

  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const flash = (at: Vector3, color: string, level: number) => {
    const i = nextLight.current++ % 2;
    const l = lights.current[i];
    if (!l) return;
    l.position.set(at.x, at.y + 1.2, at.z);
    l.color.set(color);
    lightLevel.current[i] = level;
  };

  /** Emits `n` particles of `look` for `e` (spread over its parts). */
  const emit = (e: Emitter, n: number, origin: 'start' | 'sustain') => {
    const { fx, look } = e;
    const sizeScale = 0.8 + 0.1 * fx.strength;
    for (const part of look.parts) {
      const count = Math.round(n * part.share * density + Math.random() * 0.5);
      const pool = pools[part.layer];
      for (let k = 0; k < count; k++) {
        let x = 0;
        let y = 0.2;
        let z = 0;
        let vx = (Math.random() - 0.5) * part.jitter;
        let vy = part.up * (0.6 + Math.random() * 0.6);
        let vz = (Math.random() - 0.5) * part.jitter;
        let cx = 0;
        let cz = 0;
        if (fx.shape === 'burst' && fx.at !== null) {
          const c = e.point ?? world(fx.at);
          const ang = Math.random() * Math.PI * 2;
          const rr = fx.radius * Math.sqrt(Math.random()) * (origin === 'start' ? 0.35 : 0.8);
          x = c.x + Math.cos(ang) * rr;
          z = c.z + Math.sin(ang) * rr;
          y = 0.15 + Math.random() * 0.35;
          const out = part.speed * fx.radius * (0.4 + Math.random() * 0.8) * (origin === 'start' ? 1.3 : 0.6);
          vx += Math.cos(ang) * out;
          vz += Math.sin(ang) * out;
          cx = c.x;
          cz = c.z;
        } else if (fx.shape === 'beam' && fx.at !== null && fx.to !== null) {
          const a = world(fx.at);
          const b = world(fx.to);
          // The beam's head travels to the target in its first quarter second.
          const reach = Math.min(1, (performance.now() / 1000 - startedAt.current / 1000 - e.start) / 0.25);
          const t = Math.random() * reach;
          x = a.x + (b.x - a.x) * t;
          z = a.z + (b.z - a.z) * t;
          y = 0.45 + (Math.random() - 0.5) * 0.12;
          const len = Math.max(0.001, a.distanceTo(b));
          const along = part.speed * 0.8;
          vx += ((b.x - a.x) / len) * along;
          vz += ((b.z - a.z) / len) * along;
          vy *= 0.25;
          cx = x;
          cz = z;
        } else if (fx.shape === 'area') {
          const r = areaRect(fx);
          x = r.x0 + Math.random() * (r.x1 - r.x0);
          z = r.z0 + Math.random() * (r.z1 - r.z0);
          cx = (r.x0 + r.x1) / 2;
          cz = (r.z0 + r.z1) / 2;
          if (look.rain && part.ground === 'die') {
            // Drops fall from above; the mist stays low over the table.
            y = 2.2 + Math.random() * 1.2;
            vy = -5 - Math.random() * 2;
            vx *= 0.2;
            vz *= 0.2;
          } else y = 0.05 + Math.random() * 0.2;
        } else if (fx.shape === 'trail') {
          const at = e.follower ? pieceAt(e.follower) : null;
          if (!at) return;
          x = at.x + (Math.random() - 0.5) * 0.2;
          y = at.y + 0.35 + (Math.random() - 0.5) * 0.2;
          z = at.z + (Math.random() - 0.5) * 0.2;
          vy *= 0.3;
          cx = at.x;
          cz = at.z;
        } else return;
        pool.spawn(x, y, z, vx, vy, vz, part, sizeScale, cx, cz);
      }
    }
  };

  /** Where an fx is centred, for its flash, sound and bolts. */
  const centre = (e: Emitter): Vector3 | null => {
    const { fx } = e;
    if (fx.shape === 'trail') return e.follower ? pieceAt(e.follower) : null;
    if (fx.shape === 'area') {
      const r = areaRect(fx);
      return new Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    }
    if (fx.shape === 'beam' && fx.to !== null) return world(fx.to);
    if (e.point) return e.point.clone();
    return fx.at === null ? null : world(fx.at);
  };

  const strike = (e: Emitter) => {
    const { fx } = e;
    let from: Vector3;
    let to: Vector3;
    if (fx.shape === 'beam' && fx.at !== null && fx.to !== null) {
      from = world(fx.at).setY(0.5);
      to = world(fx.to).setY(0.4);
    } else {
      const c = centre(e);
      if (!c) return;
      if (fx.shape === 'area') {
        const r = areaRect(fx);
        c.set(r.x0 + Math.random() * (r.x1 - r.x0), 0, r.z0 + Math.random() * (r.z1 - r.z0));
      } else if (fx.shape === 'burst') {
        const ang = Math.random() * Math.PI * 2;
        const rr = fx.radius * 0.4 * Math.random();
        c.x += Math.cos(ang) * rr;
        c.z += Math.sin(ang) * rr;
      }
      to = c.clone().setY(0.05);
      from = c.clone().set(c.x + (Math.random() - 0.5) * 2, 7, c.z + (Math.random() - 0.5) * 2);
    }
    const path = boltPath(from, to, fx.shape === 'beam' ? 0.35 : 0.5);
    const scale = 0.8 + 0.12 * fx.strength;
    let n = 0;
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1];
      const q = path[i];
      const steps = Math.max(1, Math.ceil(p.distanceTo(q) / 0.06));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = p.x + (q.x - p.x) * t;
        const y = p.y + (q.y - p.y) * t;
        const z = p.z + (q.z - p.z) * t;
        pools.glow.spawn(x, y, z, 0, 0, 0, BOLT_CORE, scale, 0, 0);
        if (n++ % 4 === 0) pools.glow.spawn(x, y, z, 0, 0, 0, BOLT_HALO, scale, 0, 0);
      }
    }
    flash(to, e.look.light ?? '#a8c8ff', 26 * (0.6 + 0.15 * fx.strength));
  };

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    const cam = camera as PerspectiveCamera;
    const scale = (size.height * dpr) / (2 * Math.tan(((cam.fov ?? 45) * Math.PI) / 360));
    for (const pool of Object.values(pools)) pool.material.uniforms.uScale.value = scale;

    const now = (performance.now() - startedAt.current) / 1000;
    for (const e of emitters.current) {
      if (now < e.start || now > e.end) continue;
      const t = now - e.start;
      const { fx, look } = e;
      const strength = 0.4 + 0.2 * fx.strength;
      if (!e.started) {
        e.started = true;
        const c = centre(e);
        if (c) {
          if (look.light) flash(c, look.light, 14 * strength);
          playFxSound(fx.element, fx.strength);
        }
        if (fx.shape === 'burst' || fx.shape === 'beam') emit(e, look.rate * strength * 0.5, 'start');
        if (look.ring && fx.shape === 'burst' && fx.at !== null) ring(e);
        if (look.pillar && fx.shape === 'burst' && fx.at !== null) pillar(e);
      }
      if (look.bolts && t >= e.nextBolt) {
        strike(e);
        // A few quick strikes, then now and then for as long as it lasts.
        e.nextBolt = t + (t < 0.4 ? 0.09 + Math.random() * 0.08 : 0.35 + Math.random() * 0.5 / strength);
      }
      // Bursts die down; areas and trails keep going. Long beams and wide areas need more.
      const fade = fx.shape === 'burst' ? Math.max(0, 1 - t / (e.end - e.start)) : fx.shape === 'beam' ? Math.max(0.3, 1 - t / (e.end - e.start)) : 1;
      e.carry += look.rate * strength * fade * spread(fx) * step;
      const n = Math.floor(e.carry);
      e.carry -= n;
      if (n > 0) emit(e, n, 'sustain');
    }

    // Auras: a steady trickle for each tagged piece, stronger auras thicker.
    const seen = new Set<string>();
    for (const a of auras) {
      const at = pieceAt(a.pieceId);
      if (!at) continue;
      seen.add(a.pieceId);
      const rate = ELEMENT_LOOK[a.element].rate * (0.08 + 0.07 * a.strength) * density;
      const carry = (auraCarry.current.get(a.pieceId) ?? 0) + rate * step;
      const n = Math.floor(carry);
      auraCarry.current.set(a.pieceId, carry - n);
      if (n > 0) emitAura(a, at, n);
    }
    for (const id of auraCarry.current.keys()) if (!seen.has(id)) auraCarry.current.delete(id);

    for (const pool of Object.values(pools)) pool.update(step);
    lights.current.forEach((l, i) => {
      if (!l) return;
      lightLevel.current[i] *= Math.exp(-step * 7);
      l.intensity = lightLevel.current[i] < 0.05 ? 0 : lightLevel.current[i];
    });
  });

  /** A shockwave along the table. */
  function ring(e: Emitter) {
    const c = e.point ?? world(e.fx.at!);
    const look = e.look.ring!;
    const part: FxPart = { layer: 'smoke', share: 1, colors: look.colors, life: [0.55, 0.9], size: [0.3, 0.42], grow: 2.2, speed: 0, up: 0, gravity: 0, drag: 3.2, jitter: 0, alpha: look.alpha };
    const n = Math.round(70 * density);
    const speed = 5 + 1.6 * e.fx.radius;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      pools.smoke.spawn(c.x + Math.cos(ang) * 0.2, 0.08, c.z + Math.sin(ang) * 0.2, Math.cos(ang) * speed, 0.2, Math.sin(ang) * speed, part, 1, c.x, c.z);
    }
  }

  /** A column of light rising from the square. */
  function pillar(e: Emitter) {
    const c = e.point ?? world(e.fx.at!);
    const part: FxPart = { layer: 'glow', share: 1, colors: ['#fffbe8', '#ffcf6b'], life: [0.7, 1.2], size: [0.3, 0.45], grow: 0.6, speed: 0, up: 0, gravity: 0, drag: 0.5, jitter: 0, alpha: 0.5 };
    const n = Math.round(90 * density * (0.6 + 0.15 * e.fx.strength));
    const r = 0.25 + 0.2 * e.fx.radius;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = r * Math.sqrt(Math.random());
      pools.glow.spawn(c.x + Math.cos(ang) * rr, Math.random() * 0.6, c.z + Math.sin(ang) * rr, 0, 2 + Math.random() * 3, 0, part, 1, c.x, c.z);
    }
  }

  return (
    <group>
      <primitive object={pools.smoke.points} />
      <primitive object={pools.chunk.points} />
      <primitive object={pools.glow.points} />
      {/* Always mounted (intensity 0 when idle): adding lights later would recompile every material. */}
      <pointLight ref={(l) => void (lights.current[0] = l)} intensity={0} distance={7} decay={2} />
      <pointLight ref={(l) => void (lights.current[1] = l)} intensity={0} distance={7} decay={2} />
    </group>
  );
}
