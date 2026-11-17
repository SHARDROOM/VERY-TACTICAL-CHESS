import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Object3D } from 'three';

/*
 * Draws the table only while something on it changes (a phone's battery goes on drawing the same
 * picture sixty times a second otherwise). Every frame loop (animations, physics) still runs at the
 * screen's own rate, so nothing starts late or jumps; only the drawing, by far the costliest part,
 * is skipped while the picture would be the same:
 *
 * - drawn: whenever anything moved since the last frame (even a floating piece's endless bob), for
 *   a moment after, and while the player touches the screen;
 * - otherwise: 2 frames a second, for changes no one reports (a texture that finished loading).
 *
 * Moving things are found by looking: every frame compares each object's place, turn and size (and
 * the camera's) with the last frame, after all the animations have run. What changes without
 * moving (a glow, particles, a colour) says so with keepAwake.
 *
 * (A first try ran the whole canvas on demand: drawing and animations alike paused while still,
 * and endless little loops were drawn at 30 a second. On phones motion looked choppy and a new
 * motion could start a moment late.)
 */

const IDLE_FPS = 2;
/** After the last change seen, keep drawing a moment (shadows and the like settle). */
const MOTION_GRACE_MS = 300;
/** After a touch, a click or a key. */
const INPUT_WAKE_MS = 1500;
/** Smaller changes than this (board units, quaternion parts) are no motion: springs settle forever. */
const STILL = 1e-4;

let awakeUntil = 0;

/** Draw every frame for at least `ms` more (call from a frame loop while animating, or on a change). */
export function keepAwake(ms = 250): void {
  awakeUntil = Math.max(awakeUntil, performance.now() + ms);
}

/** Inside the canvas: takes over drawing it (see above). */
export function RenderPace() {
  const gl = useThree((s) => s.gl);

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
  const lastDrawn = useRef(0);
  // Priority 1: after every animation has run this frame, and it does the drawing itself.
  useFrame(({ gl, scene, camera }) => {
    let buf = seen.current;
    let i = 0;
    let moved = false;
    const check = (o: Object3D) => {
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
      if (d > STILL) moved = true;
      buf[i] = v0; buf[i + 1] = v1; buf[i + 2] = v2; buf[i + 3] = v3; buf[i + 4] = v4;
      buf[i + 5] = v5; buf[i + 6] = v6; buf[i + 7] = v7; buf[i + 8] = v8; buf[i + 9] = v9;
      i += 10;
    };
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      check(o);
      for (const c of o.children) visit(c);
    };
    check(camera);
    visit(scene);
    // Something came or went (or turned visible): the picture changed.
    if (i !== seenCount.current) moved = true;
    seenCount.current = i;
    const now = performance.now();
    if (moved) keepAwake(MOTION_GRACE_MS);
    if (now < awakeUntil || now - lastDrawn.current >= 1000 / IDLE_FPS) {
      lastDrawn.current = now;
      gl.render(scene, camera);
    }
  }, 1);

  return null;
}
