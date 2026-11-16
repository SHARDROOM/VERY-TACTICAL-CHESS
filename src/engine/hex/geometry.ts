/*
 * The three-player board (docs/SPEC.md, "3인 육각 맵"): three half-boards of 8 files by 4 ranks,
 * one per player, joined into a hexagon. Each half is an ordinary 8×4 grid in its own frame
 * (files a–h left to right as its owner sees them, ranks 1–4 from its back rank inward). Halves
 * meet along their 4th ranks: a half's files a–d continue into the next-but-one half's files h–e,
 * its files e–h into the next half's files d–a, so a file carries straight on across the seam and
 * comes down the other half (a 4th-rank square has one neighbour across, mirrored).
 *
 * All six d4/e4 squares touch at the centre point. A diagonal from a d4 (or e4) through the centre
 * splits in two (사용자 결정: 두 갈래): it goes on from both other halves' d4 (or e4), which keeps a
 * bishop on its own colour. Nothing else passes through the centre.
 */

/** A half-board, counter-clockwise from the bottom: 0 white's, 1 black's, 2 red's. */
export type Half = 0 | 1 | 2;
export const HALVES: readonly Half[] = [0, 1, 2];
/** Squares on the ground: 3 halves × 4 ranks × 8 files. */
export const HEX_SQUARES = 96;

/** A step direction in the frame of the half the square is on: files across, ranks inward. */
export interface Dir {
  df: number;
  dr: number;
}

export const hexSquare = (half: Half, file: number, rank: number): number => half * 32 + rank * 8 + file;
export const halfOf = (sq: number): Half => Math.floor(sq / 32) as Half;
export const hexFile = (sq: number): number => sq % 8;
export const hexRank = (sq: number): number => Math.floor((sq % 32) / 8);
/** Dark or light, as on a normal board (a1 dark): the colouring carries across every seam. */
export const isDark = (sq: number): boolean => (hexFile(sq) + hexRank(sq)) % 2 === 0;

const next = (h: Half, by: number): Half => ((h + by) % 3) as Half;
/** Which half a half's files a–d (left) or e–h (right) meet across its 4th rank. */
const across = (h: Half, file: number): Half => (file < 4 ? next(h, 2) : next(h, 1));

/**
 * One step from `sq` in direction `dir` (in its half's frame): where it lands and the same
 * direction in the frame of the half it lands on. Off the board: none. Diagonally through the
 * centre: two.
 */
export function step(sq: number, dir: Dir): { sq: number; dir: Dir }[] {
  const h = halfOf(sq);
  const f = hexFile(sq);
  const r = hexRank(sq);
  const nf = f + dir.df;
  const nr = r + dir.dr;
  if (nf < 0 || nf > 7 || nr < 0) return [];
  if (nr <= 3) return [{ sq: hexSquare(h, nf, nr), dir }];
  // Across the 4th rank, into another half.
  if (dir.df === 0 || nf < 4 === f < 4) {
    return [{ sq: hexSquare(across(h, f), 7 - nf, 3), dir: { df: -dir.df, dr: -dir.dr } }];
  }
  // Diagonally through the centre (from d4 toward e, or from e4 toward d): two ways on.
  const away: Dir = f === 3 ? { df: -1, dr: -1 } : { df: 1, dr: -1 };
  return [next(h, 1), next(h, 2)].map((o) => ({ sq: hexSquare(o, f, 3), dir: away }));
}

/** "w-e4" style code for a square: the half's colour letter, then the square as its owner names it. */
export function hexName(sq: number): string {
  return `${'wbr'[halfOf(sq)]}-${'abcdefgh'[hexFile(sq)]}${hexRank(sq) + 1}`;
}

export function parseHexSquare(name: string): number | null {
  const m = /^([wbr])-?([a-h])([1-4])$/.exec(name.trim().toLowerCase());
  if (!m) return null;
  return hexSquare('wbr'.indexOf(m[1]) as Half, 'abcdefgh'.indexOf(m[2]), Number(m[3]) - 1);
}

// ---- the board's plane ----------------------------------------------------------------

/** The hexagon's corner radius in board units: a back-rank square is 1 wide (like a normal square). */
export const HEX_R = 8;
type P = { x: number; y: number };
const corner = (k: number): P => {
  const a = ((-120 + 60 * k) * Math.PI) / 180;
  return { x: HEX_R * Math.cos(a), y: HEX_R * Math.sin(a) };
};
const V = [0, 1, 2, 3, 4, 5].map(corner);
const M = V.map((v, k) => ({ x: (v.x + V[(k + 1) % 6].x) / 2, y: (v.y + V[(k + 1) % 6].y) / 2 }));
const C: P = { x: 0, y: 0 };
const lerp2 = (q: P[], u: number, v: number): P => ({
  x: (1 - u) * (1 - v) * q[0].x + u * (1 - v) * q[1].x + u * v * q[2].x + (1 - u) * v * q[3].x,
  y: (1 - u) * (1 - v) * q[0].y + u * (1 - v) * q[1].y + u * v * q[2].y + (1 - u) * v * q[3].y,
});
/** The quarter of a half the file is in: its corners at (file 0, rank 0), (4, 0), (4, 4), (0, 4) of that quarter. */
function quarter(h: Half, file: number): P[] {
  const s = h * 2;
  return file < 4 ? [V[s], M[s], C, M[(s + 5) % 6]] : [M[s], V[(s + 1) % 6], M[(s + 1) % 6], C];
}
/** A point on a half by continuous file and rank (0..8, 0..4: a square's centre is +0.5). */
export function hexPoint(h: Half, file: number, rank: number): P {
  const left = file < 4;
  return lerp2(quarter(h, left ? 0 : 4), (left ? file : file - 4) / 4, rank / 4);
}
/** A square's four corners on the board's plane (y toward black and red, white at the bottom). */
export function hexCorners(sq: number): P[] {
  const h = halfOf(sq);
  const f = hexFile(sq);
  const r = hexRank(sq);
  return [hexPoint(h, f, r), hexPoint(h, f + 1, r), hexPoint(h, f + 1, r + 1), hexPoint(h, f, r + 1)];
}
export const hexCenter = (sq: number): P => hexPoint(halfOf(sq), hexFile(sq) + 0.5, hexRank(sq) + 0.5);

const inside = (p: P, poly: P[]): boolean => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
};
const CORNERS = Array.from({ length: HEX_SQUARES }, (_, sq) => hexCorners(sq));
/** The square under a point of the board's plane, or null off the board. */
export function hexSquareAt(x: number, y: number): number | null {
  for (let sq = 0; sq < HEX_SQUARES; sq++) if (inside({ x, y }, CORNERS[sq])) return sq;
  return null;
}

/** How many king steps apart two squares are (the board's own distance). */
export const hexDistance = (() => {
  const all: Dir[] = [-1, 0, 1].flatMap((df) => [-1, 0, 1].map((dr) => ({ df, dr }))).filter((d) => d.df || d.dr);
  const table = Array.from({ length: HEX_SQUARES }, (_, from) => {
    const dist = Array<number>(HEX_SQUARES).fill(Infinity);
    dist[from] = 0;
    let frontier = [from];
    for (let d = 1; frontier.length; d++) {
      const next: number[] = [];
      for (const s of frontier) for (const dir of all) for (const t of step(s, dir)) if (dist[t.sq] === Infinity) { dist[t.sq] = d; next.push(t.sq); }
      frontier = next;
    }
    return dist;
  });
  return (a: number, b: number) => table[a][b];
})();
