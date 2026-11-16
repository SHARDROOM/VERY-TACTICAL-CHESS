import { useEffect, useMemo, useRef, useState } from 'react';
import { Quaternion } from 'three';
import { createInitialState, type Color, type Outcome } from '../engine';
import { BoardScene } from '../scene/BoardScene';
import type { TourInset, TourPhase } from '../scene/TourCamera';
import type { ActiveRoll } from '../dice3d/DiceTray';
import { simulateRoll } from '../dice3d/simulate';
import { skinRotationFor } from '../dice3d/d6';

const NO_SQUARES: never[] = [];
const noop = () => {};

/** Seconds into a phase before the action starts, so the camera has arrived. */
const CUE_DELAY = { dice: 1.6, coins: 1.8 };

/**
 * The title screen's background: the real table, board and pieces in their starting places,
 * toured by a slow camera. When the camera reaches the dice tray a d6 is thrown; at the
 * dishes the dealer throws gold coins in. Both are live physics, different every time.
 */
export function LobbyBackdrop({ inset }: { inset: TourInset }) {
  const board = useMemo(() => createInitialState().board, []);
  const [roll, setRoll] = useState<ActiveRoll | null>(null);
  const [ap, setAp] = useState<Record<Color, number>>({ white: 0, black: 0 });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (seconds: number, f: () => void) => {
    timers.current.push(window.setTimeout(f, seconds * 1000));
  };

  const throwDie = () => {
    const number = 1 + Math.floor(Math.random() * 6);
    const outcome: Outcome = number === 1 ? 'critFailure' : 'success';
    setRoll({ run: null, skin: new Quaternion(), outcome, skipped: false });
    simulateRoll()
      .then((run) => setRoll((r) => (r ? { ...r, run, skin: skinRotationFor(number, run.final) } : r)))
      .catch(() => setRoll(null));
  };

  const onPhase = (phase: TourPhase) => {
    if (phase === 'board') {
      // Full dishes are collected by the dealer while the camera is away.
      setAp((a) => ({ white: a.white >= 5 ? 0 : a.white, black: a.black >= 5 ? 0 : a.black }));
    } else if (phase === 'dice') {
      later(CUE_DELAY.dice, throwDie);
    } else {
      later(CUE_DELAY.coins, () =>
        setAp((a) => ({
          white: Math.min(5, a.white + 1 + Math.round(Math.random())),
          black: Math.min(5, a.black + 1 + Math.round(Math.random())),
        })),
      );
    }
  };

  return (
    <div className="lobby-backdrop" aria-hidden>
      <BoardScene
        board={board}
        selected={null}
        targets={NO_SQUARES}
        checkedKing={null}
        camera={{ mode: 'side', side: 'white', nonce: 0 }}
        onSquareClick={noop}
        onHoverSquare={noop}
        diceSide={-1}
        diceRoll={roll}
        onDiceLanded={noop}
        ap={ap}
        captured={NO_SQUARES}
        tour={{ inset, onPhase }}
      />
    </div>
  );
}
