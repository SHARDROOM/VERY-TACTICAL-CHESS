import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import { isHex, type Color, type Outcome } from '../engine';
import { HEX_FRAME_R } from '../scene/coords';
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
  // Beside the board's edge: the classic board's side, or the hexagon's corner.
  const edge = isHex() ? HEX_FRAME_R + 0.1 : 4.6;
  return side * (edge + 0.55 + TRAY.halfX * TRAY_SCALE + 0.35);
}

export interface ActiveRoll {
  /** The dice thrown together (a pair); null while the physics is still being computed. */
  runs: DiceRun[] | null;
  /** Rotation of each die's pipped skin that puts the engine's number on top (see d6.ts). */
  skins: Quaternion[];
  /** A special action's roll lights up by its outcome; a clash's dice have none. */
  outcome: Outcome | null;
  /** Jump straight to the resting pose. */
  skipped: boolean;
  /** A clash (합): the defender's pair, thrown once the first (the attacker's) has landed. */
  second?: { runs: DiceRun[] | null; skins: Quaternion[] };
  /** A clash: each pair in its side's colour (attacker, defender). */
  tints?: [Color, Color];
}

/** Dice in a side's colours, for a clash. */
const TINT: Record<Color, { body: string; ink: string }> = {
  white: { body: '#efe5cf', ink: '#1d1b22' },
  black: { body: '#2e2b31', ink: '#f0e6d2' },
  red: { body: '#9b2f26', ink: '#f6e3c8' },
  gray: { body: '#8a8a86', ink: '#f2f0ea' },
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

/** Resting poses before any roll: a pair flat on the felt with 6 on top, side by side. */
function initialPoses(): { position: Vector3; quaternion: Quaternion }[] {
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion().setFromUnitVectors(D6_FACES[faceWithNumber(6)].normal, up);
  return [-0.7, 0.7].map((z) => ({ position: new Vector3(0, DIE_HALF, z), quaternion: q.clone() }));
}

/** The dice drawn for a roll: up to this many in each throw. */
const PER_THROW = 2;

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
  const firstDice = useRef<(Group | null)[]>([]);
  const firstSkins = useRef<(Group | null)[]>([]);
  const secondDice = useRef<(Group | null)[]>([]);
  const secondSkins = useRef<(Group | null)[]>([]);
  const geometry = useDieGeometry();
  const rest = useRef(initialPoses());
  const restSkins = useRef([new Quaternion(), new Quaternion()]);
  const startedAt = useRef<number | null>(null);
  const soundedTo = useRef(-1);
  const landedFor = useRef<DiceRun[] | null>(null);
  /** A clash: when the first pair landed (clock seconds), and how far the second's sounds got. */
  const firstLandedAt = useRef<number | null>(null);
  const soundedTo2 = useRef(-1);
  const landed2For = useRef<DiceRun[] | null>(null);
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
  }, [roll?.runs, roll === null]);

  // Where the dice lie, for things thrown about the table to hit (as of the last frame).
  useFrame(() => {
    const half = DIE_HALF * TRAY_SCALE;
    [...firstDice.current, ...secondDice.current].forEach((g, i) => {
      if (g && g.visible) setDie(`d${i}`, { p: g.getWorldPosition(new Vector3()), q: g.getWorldQuaternion(new Quaternion()), half });
      else setDie(`d${i}`, null);
    });
  });

  /** Puts `dice` where `runs` have them at `step` (each die its own run), playing their knocks up to there. */
  const place = (dice: (Group | null)[], skins: (Group | null)[], runs: DiceRun[], skinRot: Quaternion[], step: number, sounded: { current: number }, quiet: boolean) => {
    runs.forEach((run, i) => {
      const g = dice[i];
      const sk = skins[i];
      if (!g || !sk) return;
      const s = Math.min(run.steps - 1, step);
      if (!quiet) for (const hit of run.impacts) if (hit.step > sounded.current && hit.step <= s) playSfx('diceHit', { strength: hit.strength });
      const o = s * 7;
      g.visible = true;
      g.position.set(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
      g.quaternion.set(run.frames[o + 3], run.frames[o + 4], run.frames[o + 5], run.frames[o + 6]);
      sk.quaternion.copy(skinRot[i] ?? new Quaternion());
    });
    sounded.current = step;
  };

  useFrame(({ clock }) => {
    const runs = roll?.runs;
    if (!roll || !runs) {
      // At rest: the last pair where it stopped; nothing of a second throw.
      rest.current.forEach((pose, i) => {
        const g = firstDice.current[i];
        const sk = firstSkins.current[i];
        if (!g || !sk) return;
        g.visible = true;
        g.position.copy(pose.position);
        g.quaternion.copy(pose.quaternion);
        sk.quaternion.copy(restSkins.current[i] ?? new Quaternion());
      });
      secondDice.current.forEach((g) => g && (g.visible = false));
      return;
    }
    if (startedAt.current === null) startedAt.current = clock.elapsedTime;
    // Dice thrown together are recorded together: the same number of steps.
    const last = Math.max(...runs.map((r) => r.steps)) - 1;
    const step = roll.skipped ? last : Math.min(last, Math.floor((clock.elapsedTime - startedAt.current) / runs[0].dt));
    place(firstDice.current, firstSkins.current, runs, roll.skins, step, soundedTo, roll.skipped);
    const second = roll.second;
    if (step === last && landedFor.current !== runs) {
      landedFor.current = runs;
      rest.current = runs.map((_, i) => ({ position: firstDice.current[i]!.position.clone(), quaternion: firstDice.current[i]!.quaternion.clone() }));
      restSkins.current = roll.skins.map((q) => q.clone());
      setLit(roll.outcome);
      if (roll.outcome === 'critFailure') playSfx('critFailure');
      if (second) {
        // A clash: the attacker's pair is down; the defender's goes next.
        firstLandedAt.current = clock.elapsedTime;
        onFirstLanded?.();
      } else onLanded();
    }
    // A clash's second pair: thrown after a moment, once the first rests.
    const runs2 = second?.runs;
    secondDice.current.forEach((g) => g && (g.visible = false));
    if (second && runs2 && firstLandedAt.current !== null) {
      const t2 = clock.elapsedTime - firstLandedAt.current - (roll.skipped ? 0 : SECOND_DIE_PAUSE);
      if (t2 >= 0 || roll.skipped) {
        const last2 = Math.max(...runs2.map((r) => r.steps)) - 1;
        const step2 = roll.skipped ? last2 : Math.min(last2, Math.floor(t2 / runs2[0].dt));
        place(secondDice.current, secondSkins.current, runs2, second.skins, step2, soundedTo2, roll.skipped);
        if (step2 === last2 && landed2For.current !== runs2) {
          landed2For.current = runs2;
          onLanded();
        }
      }
    }
  });

  const look = lit ? LOOK[lit] : null;
  // A clash's dice wear the sides' colours (while they roll and until the next roll).
  const tint = roll?.tints ? TINT[roll.tints[0]] : null;
  const tint2 = roll?.tints ? TINT[roll.tints[1]] : null;
  const ink = tint ? tint.ink : lit === 'critFailure' ? '#ffe0dc' : '#1d1b22';
  return (
    <group position={[trayCenterX(side), TABLE_TOP_Y, 0]} scale={TRAY_SCALE}>
      <Tray />
      {Array.from({ length: PER_THROW }, (_, i) => (
        <group key={`b${i}`} ref={(g) => void (secondDice.current[i] = g)} visible={false}>
          <group ref={(g) => void (secondSkins.current[i] = g)}>
            <mesh geometry={geometry} castShadow>
              <meshStandardMaterial color={tint2 ? tint2.body : '#d9d2c2'} roughness={0.35} metalness={0.05} />
            </mesh>
            <Pips ink={tint2 ? tint2.ink : '#1d1b22'} />
          </group>
        </group>
      ))}
      {Array.from({ length: PER_THROW }, (_, i) => (
        <group key={`a${i}`} ref={(g) => void (firstDice.current[i] = g)}>
          <group ref={(g) => void (firstSkins.current[i] = g)}>
            <mesh geometry={geometry} castShadow>
              <meshStandardMaterial
                color={tint ? tint.body : look ? look.body : '#d9d2c2'}
                emissive={look ? look.emissive : '#000000'}
                emissiveIntensity={look ? look.glow : 0}
                roughness={0.35}
                metalness={0.05}
              />
            </mesh>
            <Pips ink={ink} />
          </group>
          {i === 0 && look && look.glow > 0 && <pointLight color={look.emissive} intensity={5} distance={4} position={[0, 1.2, 0]} />}
        </group>
      ))}
    </group>
  );
}
