import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import { fileOf, rankOf, type Board, type Color, type Square } from '../engine';
import { squareToWorld } from './coords';
import { PieceMesh } from './PieceMesh';

export type ViewMode = 'side' | 'top';

export interface CameraRequest {
  mode: ViewMode;
  side: Color;
  /** Bump to re-apply the same view (e.g. "reset view"). */
  nonce: number;
}

interface Props {
  board: Board;
  selected: Square | null;
  targets: Square[];
  checkedKing: Square | null;
  camera: CameraRequest;
  onSquareClick: (sq: Square) => void;
}

const LIGHT = '#d4bf98';
const DARK = '#7d5a3b';

function CameraRig({ camera }: { camera: CameraRequest }) {
  const ref = useRef<CameraControls>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const s = camera.side === 'white' ? 1 : -1;
    if (camera.mode === 'side') c.setLookAt(0, 8.5, 8 * s, 0, 0, 0.4 * s, true);
    else c.setLookAt(0, 13, 0.001 * s, 0, 0, 0, true);
  }, [camera.mode, camera.side, camera.nonce]);
  return <CameraControls ref={ref} minDistance={5} maxDistance={22} maxPolarAngle={Math.PI / 2.1} />;
}

/** Frame with file/rank labels painted into a texture (stays under the pieces, unlike DOM overlays). */
function LabeledFrame() {
  const texture = useMemo(() => {
    const px = 100; // pixels per square
    const size = 9.2 * px;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#cbb994';
    ctx.font = `600 ${px * 0.32}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const edge = 0.3 * px;
    const center = (i: number) => size / 2 + (i - 3.5) * px;
    for (let i = 0; i < 8; i++) {
      const file = 'abcdefgh'[i];
      ctx.fillText(file, center(i), size - edge);
      ctx.fillText(file, center(i), edge);
      const rank = String(i + 1);
      ctx.fillText(rank, edge, center(7 - i));
      ctx.fillText(rank, size - edge, center(7 - i));
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);

  return (
    <>
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <boxGeometry args={[9.2, 0.2, 9.2]} />
        <meshStandardMaterial color="#3a2a1e" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.019, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[9.2, 9.2]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
    </>
  );
}

export function BoardScene({ board, selected, targets, checkedKing, camera, onSquareClick }: Props) {
  const click = (sq: Square) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSquareClick(sq);
  };

  return (
    <Canvas shadows camera={{ position: [0, 8.5, 8], fov: 45 }}>
      <color attach="background" args={['#15161b']} />
      <ambientLight intensity={0.35} />
      {/* Procedural studio reflections: no downloaded HDR files. */}
      <Environment resolution={256} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 3, 3]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[6, 3, -3]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffd9a0" position={[0, 2, 8]} scale={3} />
      </Environment>
      <directionalLight position={[4, 10, 6]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.5, 30]} />
      </directionalLight>
      <CameraRig camera={camera} />

      <LabeledFrame />

      {Array.from({ length: 64 }, (_, sq) => {
        const [x, , z] = squareToWorld(sq);
        const dark = (fileOf(sq) + rankOf(sq)) % 2 === 0;
        let color = dark ? DARK : LIGHT;
        if (sq === selected) color = '#c9a227';
        else if (sq === checkedKing) color = '#b23b3b';
        return (
          <group key={sq}>
            <mesh position={[x, -0.025, z]} receiveShadow onClick={click(sq)}>
              <boxGeometry args={[1, 0.05, 1]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
            {targets.includes(sq) && (
              <mesh position={[x, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={click(sq)}>
                {board[sq] ? <ringGeometry args={[0.36, 0.46, 32]} /> : <circleGeometry args={[0.14, 24]} />}
                <meshBasicMaterial color="#4fb36b" transparent opacity={0.85} />
              </mesh>
            )}
          </group>
        );
      })}

      {board.map((piece, sq) =>
        piece ? (
          <PieceMesh
            key={piece.id}
            piece={piece}
            position={squareToWorld(sq)}
            selected={sq === selected}
            onClick={click(sq)}
          />
        ) : null,
      )}

    </Canvas>
  );
}
