import { distance, squareName } from './squares';
import { stackOf } from './tags';
import type { Board, Color, PendingAction, PieceType, Ruling } from './types';

/*
 * Roll modifiers (판정 보정, docs/SPEC.md "판정 보정"): numbers the system adds to the two dice
 * of a special action, each shown with where it came from. The GM sets the DC without them and
 * only names which of the actor's skill tags apply; the values come from the tags themselves.
 *
 * - skill (특기): a tag on the actor (or anyone riding it) that helps with this kind of action;
 * - mind (정신력): a tag on the target that resists (or invites) a mental action (회유, 매혹, ...),
 *   counted only against another side's piece;
 * - sacrifice (희생): pieces of the declarer's next to the actor, given up the moment the dice are
 *   thrown (success or not), worth more the stronger they are; with one, the GM may also hand
 *   out stronger buffs (a clash multiplier up to ×2.5, a skill or will up to ±4);
 * - remains (유해): reviving a piece where it fell, while its remains are still there.
 *
 * Each is at most ±3 (±4 with a sacrifice), the sum at most ±4. Snake eyes still always fails.
 */
export type ModifierKind = 'skill' | 'mind' | 'sacrifice' | 'remains';
export interface RollModifier {
  kind: ModifierKind;
  /** Where it comes from: the tag's name, the sacrificed piece, ... */
  label: string;
  value: number;
}

/** Most one tag's skill or mind may be worth. */
export const MOD_EACH_MAX = 3;
/** Most all modifiers together may add or take away. */
export const MOD_TOTAL_MAX = 4;

/** What each kind of piece is worth given up (희생). Kings cannot be. */
export const SACRIFICE_VALUE: Record<Exclude<PieceType, 'king'>, number> = { pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4 };
/** With a sacrifice, the most one skill or will (and the strongest clash multiplier) a ruling may give. */
export const SACRIFICE_MOD_MAX = 4;
export const SACRIFICE_CLASH_MAX = 2.5;

const KIND_NAME: Record<PieceType, string> = { king: '킹', queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰' };

/** Why the ruling's sacrifice cannot be made (null: it can). See SPEC, "희생". */
export function checkSacrifice(board: Board, ruling: Ruling, color: Color): string | null {
  const list = ruling.sacrifice ?? [];
  if (!list.length) return null;
  if (new Set(list).size !== list.length) return '같은 기물을 두 번 바칠 수 없음';
  if (ruling.actor == null) return '바치는 행동에는 주체가 있어야 함';
  for (const at of list) {
    const p = board[at];
    const name = squareName(at);
    if (!p) return `제물 칸 ${name}에 기물이 없음`;
    if (p.color !== color) return `${name}의 기물은 내 편이 아니라 바칠 수 없음`;
    if (p.type === 'king') return '킹은 바칠 수 없음';
    if (at === ruling.actor) return '행동하는 기물(주체)은 스스로를 바칠 수 없음';
    if (p.rider) return `${name}의 기물은 누군가를 태우고 있어 바칠 수 없음`;
    if (distance(ruling.actor, at) > 1) return `제물 ${name}은(는) 주체(${squareName(ruling.actor)})에서 1칸 안에 있어야 함`;
  }
  return null;
}

/** The pieces given up, as modifiers (from the board before they go). */
export function sacrificeModifiers(board: Board, ruling: Ruling): RollModifier[] {
  const out: RollModifier[] = [];
  for (const at of ruling.sacrifice ?? []) {
    const p = board[at];
    if (p && p.type !== 'king') out.push({ kind: 'sacrifice', label: `제물 ${KIND_NAME[p.type]} ${squareName(at)}`, value: SACRIFICE_VALUE[p.type] });
  }
  return out;
}

/** The modifiers this ruling's roll gets on `board`, declared by `color`. */
export function rollModifiers(board: Board, ruling: Ruling, color: Color): RollModifier[] {
  const mods: RollModifier[] = [...sacrificeModifiers(board, ruling)];
  const named = new Set(ruling.skills ?? []);
  const actor = ruling.actor != null ? board[ruling.actor] : null;
  if (actor && named.size) {
    for (const p of stackOf(actor)) for (const t of p.tags ?? []) if (t.skill && named.has(t.name)) mods.push({ kind: 'skill', label: t.name, value: t.skill.bonus });
  }
  const target = ruling.mental && ruling.target != null ? board[ruling.target] : null;
  if (target && target.color !== color) {
    // A strong will (+2) makes it harder (-2); a frightened mind (-2) easier (+2).
    for (const t of target.tags ?? []) if (t.mind) mods.push({ kind: 'mind', label: t.name, value: -t.mind });
  }
  return mods;
}

/**
 * The modifiers of a pending action's next roll. A second try after a failure keeps what was given
 * up for the first (`offered`): the pieces are gone, but the offering still counts.
 */
export function pendingModifiers(board: Board, pending: PendingAction): RollModifier[] {
  if (!pending.offered) return rollModifiers(board, pending.ruling, pending.color);
  return [...pending.offered, ...rollModifiers(board, { ...pending.ruling, sacrifice: [] }, pending.color)];
}

/** What the modifiers add up to, held within ±MOD_TOTAL_MAX. */
export function modifierTotal(mods: readonly RollModifier[]): number {
  const sum = mods.reduce((s, m) => s + m.value, 0);
  return Math.max(-MOD_TOTAL_MAX, Math.min(MOD_TOTAL_MAX, sum));
}
