import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { CanvasTexture, SRGBColorSpace, Vector3, type Group } from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import { fileOf, isAir, rankOf, type Board, type CapturedPiece, type Color, type FallingPiece, type Square, type TerrainCell } from '../engine';
import { squareToWorld } from './coords';
import { fallStart } from './boardPhysics';
import { TableContext, type TableHands } from './tableDrag';
import { diceObstacles } from './toys';
import { clearChunks, restingChunks } from './debris';
import { PieceMesh, PiecePhysicsContext, type PiecePhysics } from './PieceMesh';
import type { Obstacle } from './piecePhysics';
import { TABLE_TOP_Y, WoodTable } from './WoodTable';
import { CoinTable } from '../coins/CoinTable';
import { DiceTray, trayCenterX, type ActiveRoll } from '../dice3d/DiceTray';
import { TourCamera, type TourInset, type TourPhase } from './TourCamera';
import { DoodleLayer, type DoodleTool } from './DoodleLayer';
import type { Doodle, DoodleOp } from '../session/doodle';
import { FxLayer, type FxShow } from './FxLayer';
import { aurasOn } from './auras';
import { TerrainLayer } from './Terrain';
import { PIECE_HEIGHT } from './pieceGeometry';
import type { PieceDirection } from './pieceMotion';

/** 'dice' looks at the dice tray beside the board while a roll plays. */
export type ViewMode = 'side' | 'top' | 'dice';

export interface CameraRequest {
  mode: ViewMode;
  side: Color;
  /** Bump to re-apply the same view (e.g. "reset view"). */
  nonce: number;
  /** Dev only: an exact camera position and target instead of the mode. */
  custom?: [number, number, number, number, number, number];
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
  /** A clash: the attacker's die has landed (the defender's is thrown next). */
  onDiceFirstLanded?: () => void;
  /** Each player's AP, shown as gold coins on the table (opposite side from the dice). */
  ap: Record<Color, number>;
  /** Pieces taken off the board, shown small beside it (on the dice side, near whoever took them). */
  captured: CapturedPiece[];
  /** Title screen: a camera tour of the table instead of the player's view. */
  tour?: { inset: TourInset; onPhase: (phase: TourPhase) => void };
  /** What each piece does in the show being played, by piece id. */
  directions?: ReadonlyMap<string, PieceDirection>;
  /** Doodles on the table; with a tool picked, pointer drags draw and the camera holds still. */
  doodle?: { doodles: Doodle[]; tool: DoodleTool | null; myKey: string; moderator: boolean; onDoodle: (op: DoodleOp) => void };
  /** The particle effects of the show being played. */
  fx?: FxShow | null;
  /** A jolt of the table: when (performance.now()) and how hard (1..3). */
  shake?: { at: number; strength: number } | null;
  /** Fewer particles (the "light" staging setting). */
  lightFx?: boolean;
  /** Walls and pits on the board. */
  terrain?: readonly TerrainCell[];
  /** While a ruling waits: the square of the piece that acts and the squares it acts on. */
  marks?: { actor: Square; targets: Square[] } | null;
  /** Targets of the selected piece whose capture would be a clash (합), with its chance of winning each. */
  clashOdds?: { at: Square; chance: number }[];
  /** Pieces in mid-fall from the air (shown where they float until the fall plays). */
  falling?: readonly FallingPiece[];
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
export function graveyardLayout(captured: CapturedPiece[], side: 1 | -1): { piece: CapturedPiece; position: [number, number, number] }[] {
  const counts = { white: 0, black: 0 };
  return captured.map((piece) => {
    const i = counts[piece.color]++;
    const col = i % 7;
    const row = Math.floor(i / 7);
    const towardWhite = piece.color === 'black' ? 1 : -1;
    // Spaced for pieces at their own size.
    return {
      piece,
      position: [side * (5.8 + col * 0.86), TABLE_TOP_Y, towardWhite * (2.5 + row * 0.95)] as [number, number, number],
    };
  });
}

const NO_TERRAIN: readonly TerrainCell[] = [];
const NO_FALLING: readonly FallingPiece[] = [];

/**
 * Squares in the air (공중부양) are not drawn: only what matters there shows, floating where
 * the square is: where the selected piece may go (these take clicks; pieces take their own, so
 * the board below stays clickable), and rings for the selected piece, a king in check and the
 * pieces a ruling names.
 */
function AirMarks({ board, selected, targets, checkedKing, marks, clashOdds, onClick }: {
  board: Board;
  selected: Square | null;
  targets: Square[];
  checkedKing: Square | null;
  marks: { actor: Square; targets: Square[] } | null;
  clashOdds: { at: Square; chance: number }[];
  onClick: (sq: Square) => (e: ThreeEvent<MouseEvent>) => void;
}) {
  const rings: { at: Square; color: string }[] = [];
  if (selected !== null && isAir(selected)) rings.push({ at: selected, color: '#c9a227' });
  if (checkedKing !== null && isAir(checkedKing)) rings.push({ at: checkedKing, color: '#b23b3b' });
  if (marks && isAir(marks.actor)) rings.push({ at: marks.actor, color: '#d9b24c' });
  for (const t of marks?.targets ?? []) if (isAir(t)) rings.push({ at: t, color: '#c98058' });
  return (
    <group>
      {rings.map((r, i) => {
        const [x, y, z] = squareToWorld(r.at);
        return (
          <mesh key={`r${i}`} position={[x, y - 0.01, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.42, 32]} />
            <meshBasicMaterial color={r.color} transparent opacity={0.85} depthWrite={false} side={2} />
          </mesh>
        );
      })}
      {targets.filter(isAir).map((sq) => {
        const [x, y, z] = squareToWorld(sq);
        return (
          <mesh key={sq} position={[x, y - 0.004, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick(sq)}>
            {board[sq] ? <ringGeometry args={[0.36, 0.46, 32]} /> : <circleGeometry args={[0.18, 24]} />}
            <meshBasicMaterial color={clashOdds.some((c) => c.at === sq) ? '#e2b45a' : '#4fb36b'} transparent opacity={0.9} depthWrite={false} side={2} />
          </mesh>
        );
      })}
    </group>
  );
}
const NO_ODDS: { at: Square; chance: number }[] = [];

/** Crossed swords and a win chance ("67%"), drawn once per chance into a texture. */
const oddsTextures = new Map<number, { texture: CanvasTexture; aspect: number }>();
function clashOddsTexture(percent: number): { texture: CanvasTexture; aspect: number } {
  let t = oddsTextures.get(percent);
  if (t) return t;
  const h = 96;
  const w = 228;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(24, 25, 32, 0.88)';
  ctx.strokeStyle = '#e2b45a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 40);
  ctx.fill();
  ctx.stroke();
  // Two crossed swords: blade, guard, grip.
  ctx.lineCap = 'round';
  for (const flip of [1, -1]) {
    ctx.save();
    ctx.translate(52, 48);
    ctx.rotate((flip * Math.PI) / 4);
    ctx.strokeStyle = '#e9e4da';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(0, 16);
    ctx.stroke();
    ctx.strokeStyle = '#e2b45a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-11, 16);
    ctx.lineTo(11, 16);
    ctx.moveTo(0, 19);
    ctx.lineTo(0, 30);
    ctx.stroke();
    ctx.restore();
  }
  // Better than even in green, worse in red.
  ctx.fillStyle = percent >= 50 ? '#8fe0a6' : '#f0a39d';
  ctx.font = '800 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percent}%`, 150, 52);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  t = { texture, aspect: w / h };
  oddsTextures.set(percent, t);
  return t;
}

/** Over a piece the selected one could attack into a clash: crossed swords and the chance of winning. */
function ClashOdds({ at, chance, height }: { at: Square; chance: number; height: number }) {
  const [x, , z] = squareToWorld(at);
  const { texture, aspect } = clashOddsTexture(Math.round(chance * 100));
  const h = 0.042;
  return (
    <sprite position={[x, height + 0.62, z]} scale={[h * aspect, h, 1]} renderOrder={22}>
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} sizeAttenuation={false} />
    </sprite>
  );
}

const LIGHT = '#d4bf98';
const DARK = '#7d5a3b';

/**
 * Development only: lets a test script find things on screen (window.__vtcProbe): the camera,
 * the chunks lying about and the taken pieces beside the board, as screen points.
 */
function DevProbe({ resting }: { resting: Map<string, Obstacle> }) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const screen = (p: Vector3) => {
      const v = p.clone().project(camera);
      return [Math.round(((v.x + 1) / 2) * size.width), Math.round(((1 - v.y) / 2) * size.height)];
    };
    (window as unknown as Record<string, unknown>).__vtcProbe = () => ({
      camera: camera.position.toArray().map((n) => Math.round(n * 100) / 100),
      chunks: restingChunks().map((c) => ({ key: c.key, at: c.p.toArray().map((n) => Math.round(n * 100) / 100), screen: screen(c.p) })),
      taken: [...resting.entries()].map(([id, o]) => ({ id, at: o.pose.position.toArray().map((n) => Math.round(n * 100) / 100), screen: screen(o.pose.position.clone().setY(o.pose.position.y + 0.25)) })),
      dice: diceObstacles().map((d) => ({ at: d.p.toArray().map((n) => Math.round(n * 100) / 100), screen: screen(d.p) })),
    });
  }, [camera, size, resting]);
  return null;
}

function CameraRig({ camera, diceSide, locked, holdNow }: { camera: CameraRequest; diceSide: 1 | -1; locked: boolean; holdNow?: MutableRefObject<(on: boolean) => void> }) {
  const ref = useRef<CameraControls>(null);
  // Something picked up: stop turning the camera at once (the same touch must not turn it).
  if (holdNow) {
    holdNow.current = (on) => {
      const c = ref.current;
      if (!c) return;
      if (on) c.cancel();
      c.enabled = !on && !locked;
    };
  }
  const aspect = useThree((st) => st.size.width / Math.max(1, st.size.height));
  // Portrait screens (phones) need the camera further back to fit the board's width.
  const zoom = aspect < 1 ? Math.min(2.4, 0.95 / aspect) : 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const s = camera.side === 'white' ? 1 : -1;
    if (camera.custom) c.setLookAt(...camera.custom, true);
    else if (camera.mode === 'side') c.setLookAt(0, 7.2 * zoom, 8.8 * s * zoom, 0, 0, 0.6 * s, true);
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
  onDiceFirstLanded,
  ap,
  captured,
  tour,
  doodle,
  directions,
  fx = null,
  shake = null,
  lightFx = false,
  terrain = NO_TERRAIN,
  marks = null,
  clashOdds = NO_ODDS,
  falling = NO_FALLING,
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
  const auras = useMemo(() => aurasOn(board), [board]);
  const click = (sq: Square) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSquareClick(sq);
  };
  // Picking things up off the table: the camera holds still meanwhile (see CameraRig).
  const [holding, setHolding] = useState(false);
  const holdNow = useRef<(on: boolean) => void>(() => {});
  const boardNow = useRef(board);
  boardNow.current = board;
  const hands = useMemo<TableHands>(
    () => ({
      hold: (on) => {
        holdNow.current(on);
        setHolding(on);
      },
      board: () => boardNow.current,
      taken: () => [...resting.current.entries()].map(([id, o]) => ({ ...o, id })),
    }),
    [],
  );
  // Leaving the table (a new game, the menu): the chunks lying about go with it.
  useEffect(() => () => clearChunks(), []);

  return (
    // No long-press menu on the table (it would open while drawing or dragging).
    <Canvas shadows camera={{ position: [0, 8.5, 8], fov: 45 }} onContextMenu={(e) => e.preventDefault()}>
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
        <CameraRig camera={camera} diceSide={diceSide} locked={!!doodle?.tool || holding} holdNow={holdNow} />
      )}
      {import.meta.env.DEV && <DevProbe resting={resting.current} />}

      <ShakeGroup shake={shake}>
      <WoodTable />
      <DiceTray side={diceSide} roll={diceRoll} onLanded={onDiceLanded} onFirstLanded={onDiceFirstLanded} />
      <CoinTable ap={ap} side={diceSide === 1 ? -1 : 1} />
      <LabeledFrame />
      {doodle && <DoodleLayer {...doodle} />}

      {Array.from({ length: 64 }, (_, sq) => {
        const [x, , z] = squareToWorld(sq);
        const dark = (fileOf(sq) + rankOf(sq)) % 2 === 0;
        let color: string = dark ? DARK : LIGHT;
        if (sq === selected) color = '#c9a227';
        else if (sq === checkedKing) color = '#b23b3b';
        else if (sq === marks?.actor) color = '#d9b24c';
        else if (marks?.targets.includes(sq)) color = dark ? '#a8573a' : '#c98058';
        return (
          <group key={sq}>
            <mesh position={[x, -0.025, z]} receiveShadow onClick={click(sq)}>
              <boxGeometry args={[1, 0.05, 1]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
            {targets.includes(sq) && (
              <mesh position={[x, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={click(sq)}>
                {board[sq] ? <ringGeometry args={[0.36, 0.46, 32]} /> : <circleGeometry args={[0.14, 24]} />}
                <meshBasicMaterial color={clashOdds.some((c) => c.at === sq) ? '#e2b45a' : '#4fb36b'} transparent opacity={0.85} />
              </mesh>
            )}
          </group>
        );
      })}

      <TerrainLayer terrain={terrain} />
      <AirMarks board={board} selected={selected} targets={targets} checkedKing={checkedKing} marks={marks} clashOdds={clashOdds} onClick={click} />
      {clashOdds.map((c) => (
        <ClashOdds key={c.at} at={c.at} chance={c.chance} height={squareToWorld(c.at)[1] + (board[c.at] ? PIECE_HEIGHT[board[c.at]!.type] : 1)} />
      ))}

      <TableContext.Provider value={hands}>
      <PiecePhysicsContext.Provider value={physics}>
      {/* One list for the board and the side, so a taken piece stays the same object and travels from its square. */}
      {[
        ...board.flatMap((piece, sq) =>
          piece ? [
            <PieceMesh
              key={piece.id}
              piece={piece}
              position={squareToWorld(sq)}
              selected={sq === selected}
              popIn={!startingIds.has(piece.id)}
              direction={directions?.get(piece.id)}
              onClick={click(sq)}
              onHover={(on) => onHoverSquare(on ? sq : null)}
            />,
          ] : [],
        ),
        // Falling: where they floated (or on top of the carrier taken from under them), until the fall plays.
        ...falling.map((f) => (
          <PieceMesh key={f.piece.id} piece={f.piece} position={fallStart(f, board)} selected={false} direction={directions?.get(f.piece.id)} />
        )),
        ...graveyard.map(({ piece, position }) => (
          <PieceMesh
            key={piece.id}
            piece={piece}
            position={position}
            selected={false}
            captured
            exit={piece.exit}
            shards={piece.exit === 'shatter' && piece.at !== undefined ? { square: piece.at, world: squareToWorld(piece.at) } : undefined}
            direction={directions?.get(piece.id)}
          />
        )),
      ]}
      </PiecePhysicsContext.Provider>
      </TableContext.Provider>
      <FxLayer show={fx} pieceAt={pieceAt} auras={auras} light={lightFx} />
      </ShakeGroup>
    </Canvas>
  );
}
