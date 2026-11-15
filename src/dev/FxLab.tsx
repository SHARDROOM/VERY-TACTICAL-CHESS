import { useMemo, useState } from 'react';
import { createInitialState, ELEMENTS, FX_SHAPES, parseSquare, type Element, type Fx, type FxShape } from '../engine';
import { BoardScene } from '../scene/BoardScene';
import type { FxShow } from '../scene/FxLayer';

/**
 * Dev-only page (?fxlab) for looking at GM effects without playing a game.
 * `?fxlab&fx=fire:burst:e4::3:1:2,light:beam:a1:h8` — element:shape:at:to:strength:radius:duration.
 * `&top` looks from above; `&shake=2` jolts the table.
 */
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
  const board = useMemo(() => createInitialState().board, []);
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
        board={board}
        selected={null}
        targets={[]}
        checkedKing={null}
        camera={{ mode: params.has('top') ? 'top' : 'side', side: 'white', nonce: 0 }}
        onSquareClick={() => {}}
        onHoverSquare={() => {}}
        diceSide={-1}
        diceRoll={null}
        onDiceLanded={() => {}}
        ap={{ white: 0, black: 0 }}
        captured={[]}
        fx={fx}
        shake={shake}
      />
      <form
        className="hud"
        style={{ left: 12, top: 12, display: 'flex', gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          setNonce((n) => n + 1);
        }}
      >
        <input value={spec} onChange={(e) => setSpec(e.target.value)} style={{ width: 420 }} />
        <button id="fxlab-play">재생</button>
      </form>
    </div>
  );
}
