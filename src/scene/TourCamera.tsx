import { isHex } from '../engine';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { TABLE_TOP_Y } from './WoodTable';
import { trayCenterX } from '../dice3d/DiceTray';
import { coinLayout } from '../coins/CoinTable';

/** What the tour is looking at. Each phase starts with a callback, so the scene can act on cue. */
export type TourPhase = 'board' | 'dice' | 'coins';

const PHASES: { phase: TourPhase; seconds: number }[] = [
  { phase: 'board', seconds: 16 },
  { phase: 'dice', seconds: 10 },
  { phase: 'coins', seconds: 11 },
];

/** Screen pixels covered by UI on each side; the subject is framed in the space that is left. */
export interface TourInset {
  left: number;
  top: number;
  bottom: number;
}

/** Something on the table to frame instead of touring: a rectangle (world units) seen from its near side. */
export interface TourFocus {
  center: [number, number, number];
  width: number;
  depth: number;
  yaw: number;
  /** Room around it (1: edge to edge). */
  margin?: number;
}

interface Props {
  diceSide: 1 | -1;
  inset: TourInset;
  onPhase: (phase: TourPhase) => void;
  /** Asked every frame: while it gives a rectangle, the tour holds and the camera frames that. */
  focus?: () => TourFocus | null;
}

/** How steeply the camera looks down at a framed rectangle (from the horizontal). */
const FOCUS_TILT = (62 * Math.PI) / 180;

/**
 * A slow camera tour of the table for the title screen: circling the board, then the dice
 * tray, then the coin dishes, and round again. It glides between views instead of cutting.
 */
export function TourCamera({ diceSide, inset, onPhase, focus }: Props) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;

  const spots = useMemo(() => {
    const coins = coinLayout(diceSide === 1 ? -1 : 1);
    return {
      tray: new Vector3(trayCenterX(diceSide), TABLE_TOP_Y, 0),
      dishes: new Vector3(coins.dish.white[0], TABLE_TOP_Y, (coins.dish.white[1] + coins.dish.black[1]) / 2),
      coinSide: Math.sign(coins.dealerX.white),
    };
  }, [diceSide]);

  // Narrow or partly covered screens need the camera further back to keep the subject in view.
  const freeW = Math.max(1, size.width - inset.left);
  const freeH = Math.max(1, size.height - inset.top - inset.bottom);
  const aspect = freeW / freeH;
  const back = (aspect < 1.2 ? Math.min(2.2, 1.2 / aspect) : 1) * Math.min(1.8, Math.sqrt(size.height / freeH));

  // Shift the picture's centre into the uncovered part of the screen.
  useEffect(() => {
    const cam = camera as import('three').PerspectiveCamera;
    const dx = inset.left / 2;
    const dy = (inset.bottom - inset.top) / 2;
    if (dx || dy) cam.setViewOffset(size.width, size.height, -dx, dy, size.width, size.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    return () => {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    };
  }, [camera, size.width, size.height, inset.left, inset.top, inset.bottom]);

  const state = useRef<{ index: number; startedAt: number | null; lap: number; pos: Vector3 | null; look: Vector3 }>({
    index: 0,
    startedAt: null,
    lap: 0,
    pos: null,
    look: new Vector3(),
  });
  const want = useMemo(() => ({ pos: new Vector3(), look: new Vector3() }), []);

  useFrame(({ clock }, dt) => {
    const st = state.current;
    const now = clock.elapsedTime;
    if (st.startedAt === null) {
      st.startedAt = now;
      onPhaseRef.current(PHASES[0].phase);
    }
    // Framing something (the rule book): the tour holds where it is, the camera glides there.
    const framed = focus?.();
    if (framed && st.pos) {
      st.startedAt += dt;
      const cam = camera as import('three').PerspectiveCamera;
      const vfov = (cam.fov * Math.PI) / 360;
      const freeAspect = freeW / freeH;
      const hfov = Math.atan(Math.tan(vfov) * freeAspect);
      // A margin: the near corners loom larger in perspective.
      const dist = Math.max(framed.width / 2 / Math.tan(hfov), (framed.depth * Math.sin(FOCUS_TILT)) / 2 / Math.tan(vfov)) * (framed.margin ?? 1.22);
      const [cx, cy, cz] = framed.center;
      // From the near side of the rectangle (its +z, turned by its yaw), looking down at it.
      const back = Math.cos(FOCUS_TILT) * dist;
      want.pos.set(cx + Math.sin(framed.yaw) * back, cy + Math.sin(FOCUS_TILT) * dist, cz + Math.cos(framed.yaw) * back);
      want.look.set(cx, cy, cz);
      const k = 1 - Math.exp(-dt * 2.6);
      st.pos.lerp(want.pos, k);
      st.look.lerp(want.look, k);
      camera.position.copy(st.pos);
      camera.lookAt(st.look);
      return;
    }
    let t = now - st.startedAt;
    if (t > PHASES[st.index].seconds) {
      st.index = (st.index + 1) % PHASES.length;
      if (st.index === 0) st.lap++;
      st.startedAt = now;
      t = 0;
      onPhaseRef.current(PHASES[st.index].phase);
    }
    const phase = PHASES[st.index].phase;
    const u = t / PHASES[st.index].seconds;

    if (phase === 'board') {
      // A wide circle around the board, picking up where the last lap left off.
      const a = 0.35 + st.lap * 1.3 + u * 2.6;
      // The hexagon is about twice as wide: further out and up.
      const grow = isHex() ? 1.75 : 1;
      const r = 11.5 * back * grow;
      want.pos.set(Math.sin(a) * r, 6.4 * back * grow, Math.cos(a) * r);
      want.look.set(0, 0.2, 0);
    } else if (phase === 'dice') {
      // Close on the tray, swinging round its outer side.
      const a = -1 + u * 2;
      const r = 6 * Math.sqrt(back);
      want.pos.set(spots.tray.x + diceSide * Math.cos(a) * r, spots.tray.y + 4.4 * Math.sqrt(back), Math.sin(a) * r);
      want.look.set(spots.tray.x, spots.tray.y, 0);
    } else {
      // From the board's side, facing the dishes and the dealer beyond them.
      const a = 0.85 - u * 1.4;
      const r = 6.8 * Math.sqrt(back);
      want.pos.set(spots.dishes.x - spots.coinSide * Math.cos(a) * r, spots.dishes.y + 4 * Math.sqrt(back), spots.dishes.z + Math.sin(a) * r);
      // Aimed a little past and above the dishes, so the coins' arcs from the dealer are in view.
      want.look.set(spots.dishes.x + spots.coinSide * 0.8, spots.dishes.y + 0.5, spots.dishes.z);
    }

    if (!st.pos) {
      st.pos = want.pos.clone();
      st.look.copy(want.look);
    } else {
      // Glide: a slow follow right after a change of subject, a close one once there.
      const rate = t < 3 ? 1.4 : 4;
      const k = 1 - Math.exp(-dt * rate);
      st.pos.lerp(want.pos, k);
      st.look.lerp(want.look, k);
    }
    camera.position.copy(st.pos);
    camera.lookAt(st.look);
  });

  return null;
}
