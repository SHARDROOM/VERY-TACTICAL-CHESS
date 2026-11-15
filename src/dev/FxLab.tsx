import { useMemo, useState } from 'react';
import {
  ACT_DURATION,
  applyEffects,
  createInitialState,
  ELEMENTS,
  FX_SHAPES,
  moveDuration,
  parseSquare,
  capturedAfter,
  type ActKind,
  type Board,
  type CapturedPiece,
  type Effect,
  type Exit,
  type Element,
  type Entrance,
  type Fx,
  type FxShape,
  type MotionStyle,
  type PieceType,
  type AttachPoint,
  type PropPreset,
  defaultAttach,
} from '../engine';
import type { PieceDirection } from '../scene/pieceMotion';
import { BoardScene } from '../scene/BoardScene';
import type { FxShow } from '../scene/FxLayer';

/**
 * Dev-only page (?fxlab) for looking at GM effects without playing a game.
 * `?fxlab&fx=fire:burst:e4::3:1:2,light:beam:a1:h8` — element:shape:at:to:strength:radius:duration.
 * `&top` looks from above, `&side-table` at the dice; `&cam=x,y,z,tx,ty,tz` from anywhere; `&shake=2` jolts the table.
 * Pieces: `&trip=hop:b1-c3,spin:g1-f5` `&enter=rise:e4:queen` `&act=fall:e2` `&morph=c1:knight` `&swirl=a7`
 * `&exit=ash:d7,shatter:e7` (removed, leaving that way), `&aura=fire:e2:3` (a tag with an aura).
 * Props: `&prop=sword:e2,shield:d2:leftHand,flag:c2::#3355cc,crown:e1` (preset:square:attach:colour), and
 * `&parts=e4:<url-encoded JSON array of parts>` for a prop of the GM's own parts.
 */
function staged(params: URLSearchParams, start: Board): { board: Board; captured: CapturedPiece[]; directions: Map<string, PieceDirection> } {
  const list = (name: string) => (params.get(name) ?? '').split(',').filter(Boolean).map((x) => x.split(':'));
  const effects: Effect[] = [];
  const trips: { from: number; style: MotionStyle; d: number }[] = [];
  for (const [style, path] of list('trip')) {
    const [a, b] = path.split('-').map((x) => parseSquare(x)!);
    effects.push({ type: 'move', from: a, to: b });
    trips.push({ from: a, style: style as MotionStyle, d: Math.hypot((a % 8) - (b % 8), Math.floor(a / 8) - Math.floor(b / 8)) });
  }
  const enters = list('enter').map(([style, sq, type]) => ({ style: style as Entrance, at: parseSquare(sq)! , type: (type ?? 'rook') as PieceType }));
  for (const e of enters) effects.push({ type: 'spawn', at: e.at, color: 'white', piece: e.type });
  for (const [sq, into] of list('morph')) effects.push({ type: 'transform', at: parseSquare(sq)!, into: into as PieceType });
  for (const [sq] of list('swirl')) effects.push({ type: 'convert', at: parseSquare(sq)!, color: 'white' });
  for (const [element, sq, strength] of list('aura')) {
    effects.push({ type: 'tag', at: parseSquare(sq)!, tag: `${element} 오라`, turns: 3, aura: { element: element as Element, strength: Number(strength) || 2 } });
  }
  for (const [preset, sq, attach, color] of list('prop')) {
    effects.push({ type: 'tag', at: parseSquare(sq)!, tag: `${preset} 소품`, turns: 0, prop: { preset: preset as PropPreset, parts: [], attach: (attach || defaultAttach(preset as PropPreset)) as AttachPoint, scale: 1, ...(color && { color }) } });
  }
  const custom = params.get('parts');
  if (custom) {
    const [sq, json] = [custom.slice(0, 2), custom.slice(3)];
    effects.push({ type: 'tag', at: parseSquare(sq)!, tag: '자유 조형물', turns: 0, prop: { preset: null, parts: JSON.parse(json), attach: 'rightHand', scale: 1 } });
  }
  const exits = new Map<string, Exit>();
  for (const [exit, sq] of list('exit')) {
    effects.push({ type: 'remove', at: parseSquare(sq)! });
    exits.set(start[parseSquare(sq)!]!.id, exit as Exit);
  }
  const applied = applyEffects(start, effects, { turnNumber: 1, nextSpawnId: 1 });
  if (!applied.ok) throw new Error(applied.detail);
  const directions = new Map<string, PieceDirection>();
  const get = (id: string) => directions.get(id) ?? directions.set(id, { motions: [], acts: [] }).get(id)!;
  for (const t of trips) get(start[t.from]!.id).motions.push({ style: t.style, duration: moveDuration(t.style, t.d) });
  for (const e of enters) get(applied.board[e.at]!.id).entrance = { style: e.style, duration: e.style === 'rise' ? 0.9 : 0.8 };
  for (const [sq] of list('morph')) get(applied.board[parseSquare(sq)!]!.id).morph = true;
  for (const [sq] of list('swirl')) get(applied.board[parseSquare(sq)!]!.id).swirl = true;
  const now = performance.now();
  for (const [kind, sq] of list('act')) get(applied.board[parseSquare(sq)!]!.id).acts.push({ kind: kind as ActKind, start: now, duration: ACT_DURATION[kind as ActKind] });
  return { board: applied.board, captured: capturedAfter([], applied.events, exits), directions };
}
function parseFx(spec: string): Fx[] {
  return spec
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const [element, shape, at, to, strength, radius, duration] = item.split(':');
      return {
        element: (ELEMENTS.includes(element as Element) ? element : 'fire') as Element,
        shape: (FX_SHAPES.includes(shape as FxShape) ? shape : 'burst') as FxShape,
        at: at ? parseSquare(at) : null,
        to: to ? parseSquare(to) : null,
        strength: Number(strength) || 3,
        radius: Number(radius) || 1,
        duration: Number(duration) || 1.5,
        withEffect: null,
        delay: 0,
      };
    });
}

export default function FxLab() {
  const params = new URLSearchParams(location.search);
  const [spec, setSpec] = useState(params.get('fx') ?? 'fire:burst:e4');
  const [nonce, setNonce] = useState(0);
  const start = useMemo(() => createInitialState().board, []);
  const [scene, setScene] = useState<{ board: Board; captured: CapturedPiece[]; directions?: Map<string, PieceDirection> }>({ board: start, captured: [] });
  const fx = useMemo<FxShow>(() => {
    const list = parseFx(spec);
    return { fx: list, starts: list.map(() => 0), ends: list.map((f) => f.duration), startedAt: performance.now(), followers: list.map(() => null) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, nonce]);
  const shakeStrength = Number(params.get('shake')) || 0;
  const shake = useMemo(() => (shakeStrength ? { at: performance.now(), strength: shakeStrength } : null), [nonce]);
  return (
    <div className="app">
      <BoardScene
        board={scene.board}
        directions={scene.directions}
        selected={null}
        targets={[]}
        checkedKing={null}
        camera={{
          mode: params.has('top') ? 'top' : params.has('side-table') ? 'dice' : 'side',
          side: 'white',
          nonce: 0,
          ...(params.get('cam') && { custom: params.get('cam')!.split(',').map(Number) as [number, number, number, number, number, number] }),
        }}
        onSquareClick={() => {}}
        onHoverSquare={() => {}}
        diceSide={-1}
        diceRoll={null}
        onDiceLanded={() => {}}
        ap={{ white: 0, black: 0 }}
        captured={scene.captured}
        fx={fx}
        shake={shake}
      />
      <form
        className="hud"
        style={{ left: 12, top: 12, display: 'flex', gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          setNonce((n) => n + 1);
          setScene(staged(params, start));
        }}
      >
        <input value={spec} onChange={(e) => setSpec(e.target.value)} style={{ width: 420 }} />
        <button id="fxlab-play">재생</button>
      </form>
    </div>
  );
}
