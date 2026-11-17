import { BASE_CLASH } from './clash';
import { RIDE, HOSTAGE, type Fusion, type Piece, type Tag } from './types';

/*
 * 융합 (docs/SPEC.md): a piece takes in a piece next to it. It keeps its own kind, moves and side
 * and wears the other's head as a crown on top (crowns stack, oldest at the bottom; the screen
 * shows at most five, then gold rings). Fusing alone makes it a fighter (it stands its ground in
 * a clash): its multiplier before tags is its own base plus a quarter of each piece taken in (a
 * fused piece taken in counts with its own multiplier then). With tags it never goes past ×3.
 * Taken, it and everyone in it fall (each leaves remains). Split, its newest crown stands again.
 */

/** Strongest a fused piece's clash multiplier may get, tags and all. */
export const FUSED_CLASH_MAX = 3;

/** A piece's clash multiplier before tags: its fused base, or its kind's. */
export const baseOf = (p: Piece): number => p.fuse?.base ?? BASE_CLASH[p.type];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Their tags together: the same tag twice keeps the one that lasts longer (permanent the longest). */
function mergeTags(a: readonly Tag[] = [], b: readonly Tag[] = []): Tag[] {
  const out = [...a];
  for (const t of b) {
    if (t.name === RIDE || t.name === HOSTAGE) continue;
    const i = out.findIndex((x) => x.name === t.name);
    if (i < 0) out.push(t);
    else if (out[i].turnsLeft !== null && (t.turnsLeft === null || t.turnsLeft > out[i].turnsLeft!)) out[i] = t;
  }
  return out;
}

/** `body` having taken in `material`. */
export function fused(body: Piece, material: Piece): Piece {
  const fuse: Fusion = {
    base: round2(baseOf(body) + baseOf(material) / 4),
    crowns: [...(body.fuse?.crowns ?? []), { id: material.id, type: material.type, color: material.color }, ...(material.fuse?.crowns ?? [])],
  };
  const tags = mergeTags(body.tags, material.tags);
  return { ...body, fuse, ...(tags.length ? { tags } : {}) };
}

/** `body` letting its newest crown go: the body (fused no more if that was the last) and the piece that stands again. */
export function split(body: Piece): { body: Piece; freed: Piece } | null {
  const crowns = body.fuse?.crowns ?? [];
  if (!crowns.length) return null;
  const top = crowns[crowns.length - 1];
  const left = crowns.slice(0, -1);
  const { fuse: _old, ...plain } = body;
  void _old;
  // What is left counts as if each remaining crown had been taken in one by one.
  const rest: Piece = left.length ? { ...plain, fuse: { base: round2(BASE_CLASH[body.type] + left.reduce((s, c) => s + BASE_CLASH[c.type] / 4, 0)), crowns: left } } : plain;
  return { body: rest, freed: { id: top.id, color: top.color, type: top.type } };
}

/** Everyone in a fused piece, as plain pieces (they fall with it). */
export const crownPieces = (p: Piece): Piece[] => (p.fuse?.crowns ?? []).map((c) => ({ id: c.id, color: c.color, type: c.type }));
