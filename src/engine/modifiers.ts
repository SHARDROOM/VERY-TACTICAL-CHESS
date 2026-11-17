import { stackOf } from './tags';
import type { Board, Color, Ruling } from './types';

/*
 * Roll modifiers (판정 보정, docs/SPEC.md "판정 보정"): numbers the system adds to the two dice
 * of a special action, each shown with where it came from. The GM sets the DC without them and
 * only names which of the actor's skill tags apply; the values come from the tags themselves.
 *
 * - skill (특기): a tag on the actor (or anyone riding it) that helps with this kind of action;
 * - mind (정신력): a tag on the target that resists (or invites) a mental action (회유, 매혹, ...),
 *   counted only against another side's piece;
 * - sacrifice (희생) and remains (유해) come later in the same list.
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

/** The modifiers this ruling's roll gets on `board`, declared by `color`. */
export function rollModifiers(board: Board, ruling: Ruling, color: Color): RollModifier[] {
  const mods: RollModifier[] = [];
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

/** What the modifiers add up to, held within ±MOD_TOTAL_MAX. */
export function modifierTotal(mods: readonly RollModifier[]): number {
  const sum = mods.reduce((s, m) => s + m.value, 0);
  return Math.max(-MOD_TOTAL_MAX, Math.min(MOD_TOTAL_MAX, sum));
}
