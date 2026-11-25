/*
 * Playing with what lies about the table (docs/SPEC.md, "만지작거리기"): a taken piece or a chunk
 * of a shattered one picked up, carried and let go of. Not part of the game: the screens tell each
 * other as it happens so everyone sees the same, and nothing is saved.
 */

/** World position then rotation quaternion. */
export type Pose = [number, number, number, number, number, number, number];
export type Vec3 = [number, number, number];

export type ToyOp =
  /** Carried: `id` (a taken piece's id, or "chunk:" and a chunk's key) is here now. */
  | { op: 'hold'; id: string; pose: Pose }
  /**
   * Let go of from `pose` at `velocity` (spun as `seed` says): every screen plays the same throw,
   * and it comes to rest at `final` (where the screen that threw it worked out it does).
   */
  | { op: 'drop'; id: string; pose: Pose; velocity: Vec3; seed: number; final: Pose }
  /** Where a player's camera is and what it looks at (상대 시선): `id` is the side it plays. */
  | { op: 'gaze'; id: 'white' | 'black' | 'red'; from: Vec3; at: Vec3 }
  /** What a player is writing (a chat line or a special action) as it is typed; '' puts the paper away (쓰는 종이). */
  | { op: 'write'; id: 'white' | 'black' | 'red'; text: string }
  /** The player sent it: the paper is tossed to the table's left (-1) or right (1), spun as `seed` says. */
  | { op: 'toss'; id: 'white' | 'black' | 'red'; text: string; dir: 1 | -1; seed: number };

/** The most a paper shows (as much as a declaration may be). */
export const PAPER_MAX = 200;

const num = (v: unknown, limit: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const pose = (v: unknown): v is Pose => Array.isArray(v) && v.length === 7 && v.every((n, i) => num(n, i < 3 ? 40 : 1.01));
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => num(n, 40));

/** Only well-formed ops get through (what another screen sends is never trusted). */
export function parseToyOp(raw: unknown): ToyOp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const side = r.id === 'white' || r.id === 'black' || r.id === 'red';
  const text = typeof r.text === 'string' && r.text.length <= PAPER_MAX;
  if (r.op === 'write') return side && text ? { op: 'write', id: r.id as 'white', text: r.text as string } : null;
  if (r.op === 'toss') return side && text && (r.dir === 1 || r.dir === -1) && num(r.seed, 2 ** 32) ? { op: 'toss', id: r.id as 'white', text: r.text as string, dir: r.dir, seed: r.seed } : null;
  if (r.op === 'gaze') return (r.id === 'white' || r.id === 'black' || r.id === 'red') && vec(r.from) && vec(r.at) ? { op: 'gaze', id: r.id, from: r.from, at: r.at } : null;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 80 || !pose(r.pose)) return null;
  if (r.op === 'hold') return { op: 'hold', id: r.id, pose: r.pose };
  if (r.op === 'drop' && vec(r.velocity) && num(r.seed, 2 ** 32) && pose(r.final)) {
    return { op: 'drop', id: r.id, pose: r.pose, velocity: r.velocity, seed: r.seed, final: r.final };
  }
  return null;
}
