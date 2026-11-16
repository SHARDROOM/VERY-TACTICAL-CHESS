import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import type { Color, Outcome } from '../engine';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { D6_FACES, d6Corners, faceWithNumber } from './d6';
import { DIE_HALF, DIE_ROUNDING, TRAY, type DiceRun } from './simulate';
import { TABLE_TOP_Y } from '../scene/WoodTable';
import { playSfx } from '../audio/sfx';
import { setDie } from '../scene/toys';

/** The tray is drawn smaller than the physics units so the die is in scale with the pieces. */
export const TRAY_SCALE = 0.7;

/** World x of the tray's centre: beside the board, on the given side. */
export function trayCenterX(side: 1 | -1): number {
  return side * (4.6 + 0.55 + TRAY.halfX * TRAY_SCALE + 0.35);
}

export interface ActiveRoll {
  /** Null while the physics is still being computed. */
  run: DiceRun | null;
  /** Rotation of the numbered skin that puts the engine's number on top (see d6.ts). */
  skin: Quaternion;
  /** A special action's roll lights up by its outcome; a clash's dice have none. */
  outcome: Outcome | null;
  /** Jump straight to the resting pose. */
  skipped: boolean;
  /** A clash (합): the defender's die, thrown once the first (the attacker's) has landed. */
  second?: { run: DiceRun | null; skin: Quaternion };
  /** A clash: each die in its side's colour (attacker, defender). */
  tints?: [Color, Color];
}

/** Dice in a side's colours, for a clash. */
const TINT: Record<Color, { body: string; ink: string }> = {
  white: { body: '#efe5cf', ink: '#1d1b22' },
  black: { body: '#2e2b31', ink: '#f0e6d2' },
};

const LOOK: Record<Outcome, { body: string; emissive: string; glow: number; text: string }> = {
  success: { body: '#d9d2c2', emissive: '#000000', glow: 0, text: '#8fe0a6' },
  failure: { body: '#d9d2c2', emissive: '#000000', glow: 0, text: '#f0a39d' },
  critFailure: { body: '#7a1f1f', emissive: '#ff3b2f', glow: 0.35, text: '#ff6b5e' },
};

/** A cube with rounded edges, like the physics' (simulate.ts). */
function useDieGeometry() {
  return useMemo(() => new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 4, DIE_ROUNDING), []);
}

/** Where the pips of each number sit on a face, on a 3×3 grid (-1, 0, 1 across and down). */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

const pipCache = new Map<string, CanvasTexture>();
function pipTexture(n: number, color: string): CanvasTexture {
  const key = `${n}-${color}`;
  let t = pipCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    // The single pip is drawn bigger, like on a real die.
    const r = n === 1 ? 17 : 11.5;
    for (const [x, y] of PIPS[n]) {
      ctx.beginPath();
      ctx.arc(64 + x * 34, 64 + y * 34, r, 0, Math.PI * 2);
      ctx.fill();
    }
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    pipCache.set(key, t);
  }
  return t;
}

/** Pip decals sitting on each face, square with its edges. */
function Pips({ ink }: { ink: string }) {
  const decals = useMemo(() => {
    const corners = d6Corners(1);
    const Z = new Vector3(0, 0, 1);
    const Y = new Vector3(0, 1, 0);
    return D6_FACES.map((f) => {
      const center = f.normal.clone().multiplyScalar(DIE_HALF * 1.004);
      // Toward the middle of the face's first edge: square with the face.
      const up = corners[f.corners[0]].clone().add(corners[f.corners[1]]).multiplyScalar(0.5).sub(f.centroid).normalize();
      // A plane faces +z: turn +z onto the face normal, then twist about the normal so +y points at `up`.
      const face = new Quaternion().setFromUnitVectors(Z, f.normal);
      const decalUp = Y.clone().applyQuaternion(face);
      const angle = Math.atan2(decalUp.clone().cross(up).dot(f.normal), decalUp.dot(up));
      return { number: f.number, center, rotation: new Quaternion().setFromAxisAngle(f.normal, angle).multiply(face) };
    });
  }, []);
  return (
    <>
      {decals.map((d) => (
        <mesh key={d.number} position={d.center} quaternion={d.rotation}>
          <planeGeometry args={[DIE_HALF * 1.8, DIE_HALF * 1.8]} />
          <meshBasicMaterial map={pipTexture(d.number, ink)} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </>
  );
}

/** Resting pose before any roll: flat on the felt with 6 on top. */
function initialPose(): { position: Vector3; quaternion: Quaternion } {
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion().setFromUnitVectors(D6_FACES[faceWithNumber(6)].normal, up);
  return { position: new Vector3(0, DIE_HALF, 0), quaternion: q };
}

function Tray() {
  const { halfX, halfZ } = TRAY;
  const rim = 0.3;
  const h = TRAY.rim;
  return (
    <>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[halfX * 2, halfZ * 2]} />
        <meshStandardMaterial color="#1f3b2d" roughness={0.95} />
      </mesh>
      {[
        [0, h / 2, halfZ + rim / 2, halfX * 2 + rim * 2, h, rim],
        [0, h / 2, -halfZ - rim / 2, halfX * 2 + rim * 2, h, rim],
        [halfX + rim / 2, h / 2, 0, rim, h, halfZ * 2],
        [-halfX - rim / 2, h / 2, 0, rim, h, halfZ * 2],
      ].map(([x, y, z, w, h, d], i) => (
        <mesh key={i} position={[x, y, z]} receiveShadow castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#3d2716" roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

interface Props {
  side: 1 | -1;
  roll: ActiveRoll | null;
  /** Every die of the roll is at rest. */
  onLanded: () => void;
  /** A clash: the first (attacker's) die is at rest and the second is about to be thrown. */
  onFirstLanded?: () => void;
}

/** A clash: the pause between the attacker's die landing and the defender's being thrown (s). */
const SECOND_DIE_PAUSE = 0.45;

/**
 * The dice tray on the table beside the board. Between rolls the die rests where it
 * last stopped; during a roll it plays back the recorded physics flight.
 */
export function DiceTray({ side, roll, onLanded, onFirstLanded }: Props) {
  const die = useRef<Group>(null);
  const skinGroup = useRef<Group>(null);
  const die2 = useRef<Group>(null);
  const skinGroup2 = useRef<Group>(null);
  const geometry = useDieGeometry();
  const rest = useRef(initialPose());
  const restSkin = useRef(new Quaternion());
  const startedAt = useRef<number | null>(null);
  const soundedTo = useRef(-1);
  const landedFor = useRef<DiceRun | null>(null);
  /** A clash: when the first die landed (clock seconds), and how far the second's sounds got. */
  const firstLandedAt = useRef<number | null>(null);
  const soundedTo2 = useRef(-1);
  const landed2For = useRef<DiceRun | null>(null);
  const [lit, setLit] = useState<Outcome | null>(null);

  // A new roll: start the clock again and drop the previous glow.
  useEffect(() => {
    startedAt.current = null;
    landedFor.current = null;
    soundedTo.current = -1;
    firstLandedAt.current = null;
    soundedTo2.current = -1;
    landed2For.current = null;
    if (!roll) setLit(null);
  }, [roll?.run, roll === null]);

  // Where the dice lie, for things thrown about the table to hit (as of the last frame).
  useFrame(() => {
    const half = DIE_HALF * TRAY_SCALE;
    for (const [key, g] of [['d1', die.current], ['d2', die2.current]] as const) {
      if (g && g.visible) setDie(key, { p: g.getWorldPosition(new Vector3()), q: g.getWorldQuaternion(new Quaternion()), half });
      else setDie(key, null);
    }
  });

  useFrame(({ clock }) => {
    const g = die.current;
    const sk = skinGroup.current;
    if (!g || !sk) return;
    const run = roll?.run;
    if (!roll || !run) {
      g.position.copy(rest.current.position);
      g.quaternion.copy(rest.current.quaternion);
      sk.quaternion.copy(restSkin.current);
      return;
    }
    if (startedAt.current === null) startedAt.current = clock.elapsedTime;
    const last = run.steps - 1;
    const step = roll.skipped ? last : Math.min(last, Math.floor((clock.elapsedTime - startedAt.current) / run.dt));
    if (!roll.skipped) {
      for (const hit of run.impacts) if (hit.step > soundedTo.current && hit.step <= step) playSfx('diceHit', { strength: hit.strength });
    }
    soundedTo.current = step;
    const o = step * 7;
    g.position.set(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
    g.quaternion.set(run.frames[o + 3], run.frames[o + 4], run.frames[o + 5], run.frames[o + 6]);
    sk.quaternion.copy(roll.skin);
    const second = roll.second;
    if (step === last && landedFor.current !== run) {
      landedFor.current = run;
      rest.current = { position: g.position.clone(), quaternion: g.quaternion.clone() };
      restSkin.current = roll.skin.clone();
      setLit(roll.outcome);
      if (roll.outcome === 'critFailure') playSfx('critFailure');
      if (second) {
        // A clash: the attacker's die is down; the defender's goes next.
        firstLandedAt.current = clock.elapsedTime;
        onFirstLanded?.();
      } else onLanded();
    }
    // A clash's second die: thrown after a moment, once the first rests.
    const run2 = second?.run;
    const g2 = die2.current;
    if (g2) g2.visible = false;
    if (second && run2 && g2 && skinGroup2.current && firstLandedAt.current !== null) {
      const last2 = run2.steps - 1;
      const t2 = clock.elapsedTime - firstLandedAt.current - (roll.skipped ? 0 : SECOND_DIE_PAUSE);
      if (t2 >= 0 || roll.skipped) {
        const step2 = roll.skipped ? last2 : Math.min(last2, Math.floor(t2 / run2.dt));
        if (!roll.skipped) {
          for (const hit of run2.impacts) if (hit.step > soundedTo2.current && hit.step <= step2) playSfx('diceHit', { strength: hit.strength });
        }
        soundedTo2.current = step2;
        const o2 = step2 * 7;
        g2.visible = true;
        g2.position.set(run2.frames[o2], run2.frames[o2 + 1], run2.frames[o2 + 2]);
        g2.quaternion.set(run2.frames[o2 + 3], run2.frames[o2 + 4], run2.frames[o2 + 5], run2.frames[o2 + 6]);
        skinGroup2.current.quaternion.copy(second.skin);
        if (step2 === last2 && landed2For.current !== run2) {
          landed2For.current = run2;
          onLanded();
        }
      }
    }
  });

  const look = lit ? LOOK[lit] : null;
  // A clash's dice wear the sides' colours (while they roll and until the next roll).
  const tint = roll?.tints ? TINT[roll.tints[0]] : null;
  const tint2 = roll?.tints ? TINT[roll.tints[1]] : null;
  return (
    <group position={[trayCenterX(side), TABLE_TOP_Y, 0]} scale={TRAY_SCALE}>
      <Tray />
      {roll?.second?.run && tint2 && (
        <group ref={die2}>
          <group ref={skinGroup2}>
            <mesh geometry={geometry} castShadow>
              <meshStandardMaterial color={tint2.body} roughness={0.35} metalness={0.05} />
            </mesh>
            <Pips ink={tint2.ink} />
          </group>
        </group>
      )}
      <group ref={die}>
        <group ref={skinGroup}>
          <mesh geometry={geometry} castShadow>
            <meshStandardMaterial
              color={tint ? tint.body : look ? look.body : '#d9d2c2'}
              emissive={look ? look.emissive : '#000000'}
              emissiveIntensity={look ? look.glow : 0}
              roughness={0.35}
              metalness={0.05}
            />
          </mesh>
          <Pips ink={tint ? tint.ink : lit === 'critFailure' ? '#ffe0dc' : '#1d1b22'} />
        </group>
        {look && look.glow > 0 && <pointLight color={look.emissive} intensity={5} distance={4} position={[0, 1.2, 0]} />}
      </group>
    </group>
  );
}
