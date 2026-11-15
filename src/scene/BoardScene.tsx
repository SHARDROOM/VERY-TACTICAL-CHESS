import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CanvasTexture, SRGBColorSpace, Vector3, type Group } from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import { fileOf, rankOf, type Board, type Color, type Piece, type Square } from '../engine';
import { squareToWorld } from './coords';
import { PieceMesh, PiecePhysicsContext, type PiecePhysics } from './PieceMesh';
import type { Obstacle } from './piecePhysics';
import { TABLE_TOP_Y, WoodTable } from './WoodTable';
import { CoinTable } from '../coins/CoinTable';
import { DiceTray, trayCenterX, type ActiveRoll } from '../dice3d/DiceTray';
import { TourCamera, type TourInset, type TourPhase } from './TourCamera';
import { DoodleLayer, type DoodleTool } from './DoodleLayer';
import type { Doodle, DoodleOp } from '../session/doodle';
import { FxLayer, type FxShow } from './FxLayer';

/** 'dice' looks at the dice tray beside the board while a roll plays. */
export type ViewMode = 'side' | 'top' | 'dice';

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
  onHoverSquare: (sq: Square | null) => void;
  /** Which side of the board the dice tray stands on (-1 = white's left). */
  diceSide: 1 | -1;
  diceRoll: ActiveRoll | null;
  onDiceLanded: () => void;
  /** Each player's AP, shown as gold coins on the table (opposite side from the dice). */
  ap: Record<Color, number>;
  /** Pieces taken off the board, shown small beside it (on the dice side, near whoever took them). */
  captured: Piece[];
  /** Title screen: a camera tour of the table instead of the player's view. */
  tour?: { inset: TourInset; onPhase: (phase: TourPhase) => void };
  /** Pieces whose latest move was a special action or chaos: they fly with physics. */
  flung?: ReadonlySet<string>;
  /** Doodles on the table; with a tool picked, pointer drags draw and the camera holds still. */
  doodle?: { doodles: Doodle[]; tool: DoodleTool | null; myKey: string; moderator: boolean; onDoodle: (op: DoodleOp) => void };
  /** The particle effects of the show being played. */
  fx?: FxShow | null;
  /** A jolt of the table: when (performance.now()) and how hard (1..3). */
  shake?: { at: number; strength: number } | null;
}

/** Shakes everything on the table (not the camera, which the player controls) for a moment. */
function ShakeGroup({ shake, children }: { shake: Props['shake']; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = shake ? (performance.now() - shake.at) / 1000 : -1;
    const duration = shake ? 0.35 + 0.2 * shake.strength : 0;
    if (!shake || t < 0 || t > duration) {
      if (g.position.lengthSq()) g.position.set(0, 0, 0);
      return;
    }
    const amp = 0.035 * shake.strength * (1 - t / duration) ** 2;
    g.position.set(Math.sin(t * 71) * amp, Math.sin(t * 53 + 1) * amp * 0.5, Math.sin(t * 61 + 2) * amp);
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * Where captured pieces stand: on the dice side of the table, in front of and behind the
 * dice tray. Black pieces (taken by white) wait near white's edge, white pieces near black's.
 */
export function graveyardLayout(captured: Piece[], side: 1 | -1): { piece: Piece; position: [number, number, number] }[] {
  const counts = { white: 0, black: 0 };
  return captured.map((piece) => {
    const i = counts[piece.color]++;
    const col = i % 7;
    const row = Math.floor(i / 7);
    const towardWhite = piece.color === 'black' ? 1 : -1;
    return {
      piece,
      position: [side * (5.75 + col * 0.58), TABLE_TOP_Y, towardWhite * (2.45 + row * 0.72)] as [number, number, number],
    };
  });
}

const LIGHT = '#d4bf98';
const DARK = '#7d5a3b';

function CameraRig({ camera, diceSide, locked }: { camera: CameraRequest; diceSide: 1 | -1; locked: boolean }) {
  const ref = useRef<CameraControls>(null);
  const aspect = useThree((st) => st.size.width / Math.max(1, st.size.height));
  // Portrait screens (phones) need the camera further back to fit the board's width.
  const zoom = aspect < 1 ? Math.min(2.4, 0.95 / aspect) : 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const s = camera.side === 'white' ? 1 : -1;
    if (camera.mode === 'side') c.setLookAt(0, 7.2 * zoom, 8.8 * s * zoom, 0, 0, 0.6 * s, true);
    else if (camera.mode === 'top') c.setLookAt(0, 13 * zoom, 0.001 * s, 0, 0, 0, true);
    else {
      const x = trayCenterX(diceSide);
      // Closer in on the tray, still seen from this player's side, leaning toward the board.
      c.setLookAt(x * 0.85, 5.2 * zoom, 4.6 * s * zoom, x, -0.2, 0, true);
    }
  }, [camera.mode, camera.side, camera.nonce, zoom, diceSide]);
  return <CameraControls ref={ref} enabled={!locked} minDistance={4} maxDistance={30} maxPolarAngle={Math.PI / 2.2} />;
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

export function BoardScene({
  board,
  selected,
  targets,
  checkedKing,
  camera,
  onSquareClick,
  onHoverSquare,
  diceSide,
  diceRoll,
  onDiceLanded,
  ap,
  captured,
  tour,
  doodle,
  flung,
  fx = null,
  shake = null,
}: Props) {
  const resting = useRef(new Map<string, Obstacle>());
  const objects = useRef(new Map<string, Group>());
  const physics = useMemo<PiecePhysics>(() => ({ diceSide, resting: resting.current, objects: objects.current }), [diceSide]);
  const pieceAt = useMemo(() => (id: string) => objects.current.get(id)?.getWorldPosition(new Vector3()) ?? null, []);
  // Pieces that were not on the table when the scene opened (spawned by a special action or
  // chaos) drop in. Not a "mounted yet?" flag: the 3D children render after this component's
  // first effect, so such a flag would make every starting piece drop in too.
  const startingIds = useMemo(() => new Set([...board, ...captured].flatMap((p) => (p ? [p.id, ...(p.rider ? [p.rider.id] : [])] : []))), []);
  const graveyard = useMemo(() => graveyardLayout(captured, diceSide), [captured, diceSide]);
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
        {/* Covers the board and the dice tray on either side. */}
        <orthographicCamera attach="shadow-camera" args={[-11, 11, 7, -7, 0.5, 30]} />
      </directionalLight>
      {/* Warm lamp over the table. */}
      <pointLight position={[0, 9, 0]} intensity={18} distance={30} decay={1.6} color="#ffdcae" />
      {tour ? (
        <TourCamera diceSide={diceSide} inset={tour.inset} onPhase={tour.onPhase} />
      ) : (
        <CameraRig camera={camera} diceSide={diceSide} locked={!!doodle?.tool} />
      )}

      <ShakeGroup shake={shake}>
      <WoodTable />
      <DiceTray side={diceSide} roll={diceRoll} onLanded={onDiceLanded} />
      <CoinTable ap={ap} side={diceSide === 1 ? -1 : 1} />
      <LabeledFrame />
      {doodle && <DoodleLayer {...doodle} />}

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

      <PiecePhysicsContext.Provider value={physics}>
      {/* Board pieces and captured pieces share keys, so a captured piece flies from its square to the side. */}
      {board.map((piece, sq) =>
        piece ? (
          <PieceMesh
            key={piece.id}
            piece={piece}
            position={squareToWorld(sq)}
            selected={sq === selected}
            popIn={!startingIds.has(piece.id)}
            flung={flung?.has(piece.id) ?? false}
            onClick={click(sq)}
            onHover={(on) => onHoverSquare(on ? sq : null)}
          />
        ) : null,
      )}
      {graveyard.map(({ piece, position }) => (
        <PieceMesh key={piece.id} piece={piece} position={position} selected={false} captured />
      ))}
      </PiecePhysicsContext.Provider>
      <FxLayer show={fx} pieceAt={pieceAt} />
      </ShakeGroup>
    </Canvas>
  );
}
