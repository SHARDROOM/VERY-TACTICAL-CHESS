import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import type { Outcome } from '../engine';
import { D20_FACES, d20Vertices, skinRotationFor } from './d20';
import { DIE_RADIUS, TRAY, simulateRoll, type DiceRun } from './simulate';
import { OUTCOME_LABEL } from '../ui/messages';

interface Props {
  roll: number;
  outcome: Outcome;
  onDone: () => void;
}

const LOOK: Record<Outcome, { body: string; emissive: string; glow: number; text: string }> = {
  critSuccess: { body: '#e8c35a', emissive: '#ffcc33', glow: 0.55, text: '#f5d76e' },
  success: { body: '#d9d2c2', emissive: '#000000', glow: 0, text: '#8fe0a6' },
  failure: { body: '#d9d2c2', emissive: '#000000', glow: 0, text: '#f0a39d' },
  critFailure: { body: '#7a1f1f', emissive: '#ff3b2f', glow: 0.35, text: '#ff6b5e' },
};

/** Flat-shaded icosahedron with its faces in the same order as D20_FACES. */
function useDieGeometry() {
  return useMemo(() => {
    const v = d20Vertices(DIE_RADIUS);
    const pos: number[] = [];
    for (const f of D20_FACES) for (const i of f.vertices) pos.push(v[i].x, v[i].y, v[i].z);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, []);
}

const labelCache = new Map<string, CanvasTexture>();
function numberTexture(n: number, color: string): CanvasTexture {
  const key = `${n}-${color}`;
  let t = labelCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = '700 70px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 70);
    if (n === 6 || n === 9) ctx.fillRect(40, 104, 48, 7); // tell 6 from 9
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    labelCache.set(key, t);
  }
  return t;
}

/** Number decals sitting on each face, upright toward the face's first vertex. */
function Numbers({ ink }: { ink: string }) {
  const decals = useMemo(() => {
    const verts = d20Vertices(DIE_RADIUS);
    const Z = new Vector3(0, 0, 1);
    const Y = new Vector3(0, 1, 0);
    return D20_FACES.map((f) => {
      const center = f.centroid.clone().multiplyScalar(DIE_RADIUS * 1.003);
      const up = verts[f.vertices[0]].clone().sub(center).normalize();
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
          <planeGeometry args={[DIE_RADIUS * 0.62, DIE_RADIUS * 0.62]} />
          <meshBasicMaterial map={numberTexture(d.number, ink)} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </>
  );
}

function RollingDie({ run, skin, outcome, onLanded }: { run: DiceRun; skin: Quaternion; outcome: Outcome; onLanded: () => void }) {
  const body = useRef<Group>(null);
  const started = useRef<number | null>(null);
  const landed = useRef(false);
  const geometry = useDieGeometry();
  const look = LOOK[outcome];
  const [lit, setLit] = useState(false);

  useFrame(({ clock }) => {
    const g = body.current;
    if (!g) return;
    if (started.current === null) started.current = clock.elapsedTime;
    const step = Math.min(run.steps - 1, Math.floor((clock.elapsedTime - started.current) / run.dt));
    const o = step * 7;
    g.position.set(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
    g.quaternion.set(run.frames[o + 3], run.frames[o + 4], run.frames[o + 5], run.frames[o + 6]);
    if (step === run.steps - 1 && !landed.current) {
      landed.current = true;
      setLit(true);
      onLanded();
    }
  });

  return (
    <group ref={body}>
      <group quaternion={skin}>
        <mesh geometry={geometry} castShadow>
          <meshStandardMaterial
            color={lit ? look.body : '#d9d2c2'}
            emissive={lit ? look.emissive : '#000000'}
            emissiveIntensity={lit ? look.glow : 0}
            roughness={0.35}
            metalness={0.05}
            flatShading
          />
        </mesh>
        <Numbers ink={lit && outcome === 'critFailure' ? '#ffe0dc' : '#1d1b22'} />
      </group>
      {lit && look.glow > 0 && <pointLight color={look.emissive} intensity={6} distance={4} position={[0, 1.2, 0]} />}
    </group>
  );
}

function Tray() {
  const { halfX, halfZ } = TRAY;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[halfX * 2 + 0.6, halfZ * 2 + 0.6]} />
        <meshStandardMaterial color="#1f3b2d" roughness={0.95} />
      </mesh>
      {[
        [0, 0.15, halfZ + 0.15, halfX * 2 + 0.6, 0.3, 0.3],
        [0, 0.15, -halfZ - 0.15, halfX * 2 + 0.6, 0.3, 0.3],
        [halfX + 0.15, 0.15, 0, 0.3, 0.3, halfZ * 2],
        [-halfX - 0.15, 0.15, 0, 0.3, 0.3, halfZ * 2],
      ].map(([x, y, z, w, h, d], i) => (
        <mesh key={i} position={[x, y, z]} receiveShadow castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#5a3d26" roughness={0.7} />
        </mesh>
      ))}
    </>
  );
}

/**
 * A dice tray that pops up over the board: a physically simulated d20 that lands on
 * the engine's roll (decided before the animation starts). Skippable.
 */
export default function DiceOverlay({ roll, outcome, onDone }: Props) {
  const [run, setRun] = useState<DiceRun | null>(null);
  const [failed, setFailed] = useState(false);
  const [landed, setLanded] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    let alive = true;
    simulateRoll()
      .then((r) => alive && setRun(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // Without physics (e.g. WASM blocked), just show the number.
  useEffect(() => {
    if (failed) setLanded(true);
  }, [failed]);

  // Linger on the result for a moment, then reveal it on the board.
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(finish, outcome === 'critSuccess' || outcome === 'critFailure' ? 1800 : 1200);
    return () => clearTimeout(t);
  }, [landed]);

  const skin = useMemo(() => (run ? skinRotationFor(roll, run.final) : new Quaternion()), [run, roll]);
  const look = LOOK[outcome];

  return (
    <div className="dice-overlay" onClick={finish}>
      <div className="dice-stage" onClick={(e) => e.stopPropagation()}>
        <Canvas shadows camera={{ position: [0, 6.5, 4.6], fov: 42 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
          <color attach="background" args={['#121317']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 8, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
          <Tray />
          {run && <RollingDie run={run} skin={skin} outcome={outcome} onLanded={() => setLanded(true)} />}
        </Canvas>
        {!run && !failed && <div className="dice-loading">주사위 준비 중…</div>}
        {landed && (
          <div className={`dice-result ${outcome}`} style={{ color: look.text }}>
            <span className="dice-number">{roll}</span>
            <span className="dice-label">{OUTCOME_LABEL[outcome]}</span>
          </div>
        )}
        <button className="dice-skip" onClick={finish}>
          {landed ? '확인' : '건너뛰기'}
        </button>
      </div>
    </div>
  );
}
