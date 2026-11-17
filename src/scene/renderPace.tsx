import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Object3D } from 'three';

/*
 * Draws the table only while something on it changes (a phone's battery goes on drawing the same
 * picture sixty times a second otherwise). The canvas runs on demand; this paces it:
 *
 * - awake (something moves, the player touches the screen, the game changes): every display frame;
 * - ambient (only endless little loops are left: a floating piece bobbing, a shield's shimmer, an
 *   aura's sparks, the title screen's tour): 30 frames a second;
 * - idle: 2 frames a second, so anything that starts on its own is noticed and wakes it.
 *
 * Moving things are found by looking: every drawn frame compares each object's place, turn and
 * size (and the camera's) with the last frame. What changes without moving (a glow, particles)
 * says so itself with keepAwake / keepAmbient from its frame loop. An object marked
 * `userData.vtcAmbient` (and all under it) only counts as ambient when it moves.
 */

const AMBIENT_FPS = 30;
const IDLE_FPS = 2;
/** After the last change seen, keep drawing a little longer (easing ends, a late bounce). */
const MOTION_GRACE_MS = 400;
/** After a touch, a click or a key. */
const INPUT_WAKE_MS = 1500;
/** Smaller changes than this (board units, quaternion parts) are no motion: springs settle forever. */
const STILL = 1e-4;

let awakeUntil = 0;
let ambientUntil = 0;

/** Draw every frame for at least `ms` more (call from a frame loop while animating, or on a change). */
export function keepAwake(ms = 250): void {
  awakeUntil = Math.max(awakeUntil, performance.now() + ms);
}
/** Draw at the ambient rate for at least `ms` more (an endless little loop). */
export function keepAmbient(ms = 250): void {
  ambientUntil = Math.max(ambientUntil, performance.now() + ms);
}

/** Inside the canvas (frameloop="demand"). `maxFps` caps the awake rate (the title screen's tour). */
export function RenderPace({ maxFps = 60 }: { maxFps?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let id = 0;
    let last = 0;
    const loop = (t: number) => {
      id = requestAnimationFrame(loop);
      const now = performance.now();
      const fps = now < awakeUntil ? maxFps : now < ambientUntil ? Math.min(AMBIENT_FPS, maxFps) : IDLE_FPS;
      // A little slack so a 60 Hz display is not cut to every other frame.
      if (t - last >= 1000 / fps - 4) {
        last = t;
        invalidate();
      }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [invalidate, maxFps]);

  // Any touch, click, wheel or key: the player is doing something (dragging, turning the view).
  useEffect(() => {
    const wake = () => keepAwake(INPUT_WAKE_MS);
    const el = gl.domElement;
    const opts = { passive: true } as const;
    window.addEventListener('pointerdown', wake, opts);
    window.addEventListener('keydown', wake, opts);
    window.addEventListener('wheel', wake, opts);
    el.addEventListener('pointermove', wake, opts);
    el.addEventListener('touchmove', wake, opts);
    // Coming back to the tab: draw it fresh.
    document.addEventListener('visibilitychange', wake);
    keepAwake(INPUT_WAKE_MS);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', wake);
      el.removeEventListener('pointermove', wake);
      el.removeEventListener('touchmove', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [gl]);

  const seen = useRef(new Float64Array(4096));
  const seenCount = useRef(-1);
  const lastFrame = useRef(performance.now());
  useFrame(({ scene, camera }) => {
    let buf = seen.current;
    let i = 0;
    let moved = false;
    let ambient = false;
    const check = (o: Object3D, amb: boolean) => {
      const { position: p, quaternion: q, scale: s } = o;
      if (i + 10 > buf.length) {
        const bigger = new Float64Array(buf.length * 2);
        bigger.set(buf);
        buf = seen.current = bigger;
      }
      const v0 = p.x, v1 = p.y, v2 = p.z, v3 = q.x, v4 = q.y, v5 = q.z, v6 = q.w, v7 = s.x, v8 = s.y, v9 = s.z;
      const d =
        Math.abs(buf[i] - v0) + Math.abs(buf[i + 1] - v1) + Math.abs(buf[i + 2] - v2) +
        Math.abs(buf[i + 3] - v3) + Math.abs(buf[i + 4] - v4) + Math.abs(buf[i + 5] - v5) + Math.abs(buf[i + 6] - v6) +
        Math.abs(buf[i + 7] - v7) + Math.abs(buf[i + 8] - v8) + Math.abs(buf[i + 9] - v9);
      if (d > STILL) {
        if (amb) ambient = true;
        else moved = true;
      }
      buf[i] = v0; buf[i + 1] = v1; buf[i + 2] = v2; buf[i + 3] = v3; buf[i + 4] = v4;
      buf[i + 5] = v5; buf[i + 6] = v6; buf[i + 7] = v7; buf[i + 8] = v8; buf[i + 9] = v9;
      i += 10;
    };
    const visit = (o: Object3D, amb: boolean) => {
      if (!o.visible) return;
      const a = amb || !!o.userData.vtcAmbient;
      check(o, a);
      for (const c of o.children) visit(c, a);
    };
    check(camera, false);
    visit(scene, false);
    // Something came or went (or turned visible): the picture changed.
    if (i !== seenCount.current) moved = true;
    seenCount.current = i;
    // On a slow device a frame can take longer than the grace: keep a few frames' worth (but a
    // one-off stall, like compiling shaders, must not keep it awake for long).
    const now = performance.now();
    const grace = Math.max(MOTION_GRACE_MS, Math.min(1500, 3 * (now - lastFrame.current)));
    lastFrame.current = now;
    if (moved) keepAwake(grace);
    if (ambient) keepAmbient(grace);
  });

  return null;
}
