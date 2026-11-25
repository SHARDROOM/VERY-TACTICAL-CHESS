import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Pose, Vec3 } from '../session/toy';

/*
 * 쓰는 종이 (사용자 요청): the sheet a player writes on floats in the middle of its view, on its
 * line of sight from its eye to what it looks at (PAPER_HEIGHT over the board), with the written face turned to the writer (the others see it
 * from behind, the ink showing through). The writer's screen works it out from its own camera and
 * sends it along, so every screen puts the sheet, and starts its toss, in the same place.
 */

/**
 * How high over the board the sheet floats, on the writer's line of sight: the camera sits high,
 * and halfway along its look was above the other players' screens (checked with two browsers).
 * Here it stands just over the writer's own near ranks, in the middle of its view, whatever the zoom.
 */
export const PAPER_HEIGHT = 2;
const UP = new Vector3(0, 1, 0);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The sheet's pose for a writer whose camera is at `eye` looking at `at`: its +z (written) face toward the eye. */
export function paperPose(eye: Vec3, at: Vec3): Pose {
  const e = new Vector3(...eye);
  const t = new Vector3(...at);
  // Where the look comes down to PAPER_HEIGHT; a look that never does (from low, or upward): halfway.
  const along = e.y > PAPER_HEIGHT && t.y < PAPER_HEIGHT ? (e.y - PAPER_HEIGHT) / (e.y - t.y) : 0.5;
  const p = e.clone().lerp(t, Math.min(0.9, Math.max(0.3, along)));
  // Facing the eye; a look with no length (cannot come from a camera) faces up.
  const q = p.distanceToSquared(e) < 1e-8 ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2) : new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(e, p, UP));
  return [r4(p.x), r4(p.y), r4(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)];
}
