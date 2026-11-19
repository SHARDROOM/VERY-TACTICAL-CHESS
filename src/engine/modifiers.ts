import { distance, squareName } from './squares';
import { stackOf } from './tags';
import { MEANS, MEANS_NAME, type Board, type Color, type Means, type PendingAction, type PieceType, type RemainsMark, type Ruling, type TerrainCell } from './types';
import { BUILDING_REACH } from './terrain';
import { targetsOf } from './actor';
import { remainsAt } from './captured';

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
 * - remains (유해): reviving a piece where it fell, while its remains are still there;
 * - distance (거리): the farther the action reaches from its actor, the harder (DISTANCE_RULE);
 * - building (건물): a building next to the actor that helps with this kind of action (the GM
 *   names it in the ruling; anyone's building, as long as it still stands).
 *
 * Each is at most ±3 (±4 with a sacrifice, -4 for distance), the sum at most ±4. Snake eyes still
 * always fails.
 */
export type ModifierKind = 'skill' | 'mind' | 'sacrifice' | 'remains' | 'distance' | 'building';
export interface RollModifier {
  kind: ModifierKind;
  /** Where it comes from: the tag's name, the sacrificed piece, ... */
  label: string;
  value: number;
  /** A sacrifice's whole worth (SACRIFICE_VALUE added up), when `value` is less: it went into a clash multiplier. */
  worth?: number;
}

/** Most one tag's skill or mind may be worth. */
export const MOD_EACH_MAX = 3;
/** Most all modifiers together may add or take away. */
export const MOD_TOTAL_MAX = 4;

/** What each kind of piece is worth given up (희생). Kings cannot be. */
export const SACRIFICE_VALUE: Record<Exclude<PieceType, 'king'>, number> = { pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4 };
/** With a sacrifice, the most one skill or will a ruling may give. */
export const SACRIFICE_MOD_MAX = 4;
/**
 * A sacrifice for a clash multiplier (사용자 요청): every point the offering is worth adds this to
 * the multiplier the ruling gives the declarer's pieces (the GM picks it as without one), up to
 * SACRIFICE_CLASH_CAP; the offering then helps the roll only a third as much.
 */
export const SACRIFICE_CLASH_PER_POINT = 0.1;
export const SACRIFICE_CLASH_CAP = 3;

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

/** The ruling gives one of `color`'s pieces a clash multiplier (a tag with one). */
export function givesClash(board: Board, ruling: Ruling, color: Color): boolean {
  return ruling.effects.some((e) => e.type === 'tag' && typeof e.clash === 'number' && e.clash > 1 && board[e.at]?.color === color);
}

/**
 * The pieces given up, as modifiers (from the board before they go). Given up for a clash
 * multiplier, they are one modifier worth a third of the offering (it went into the multiplier).
 */
export function sacrificeModifiers(board: Board, ruling: Ruling, color: Color): RollModifier[] {
  const out: RollModifier[] = [];
  for (const at of ruling.sacrifice ?? []) {
    const p = board[at];
    if (p && p.type !== 'king') out.push({ kind: 'sacrifice', label: `제물 ${KIND_NAME[p.type]} ${squareName(at)}`, value: SACRIFICE_VALUE[p.type] });
  }
  if (!out.length || !givesClash(board, ruling, color)) return out;
  const worth = out.reduce((s, m) => s + m.value, 0);
  const names = out.map((m) => m.label.replace(/^제물 /, '')).join(', ');
  return [{ kind: 'sacrifice', label: `제물 ${names} (배율에 바쳐 1/3)`, value: Math.round(worth / 3), worth }];
}

/** How much an offering raises the clash multiplier the ruling gives (0 when it was not for one). */
export function sacrificeClashBonus(offering: readonly RollModifier[]): number {
  const worth = offering.reduce((s, m) => s + (m.kind === 'sacrifice' && m.worth !== undefined ? m.worth : 0), 0);
  return Math.round(worth * SACRIFICE_CLASH_PER_POINT * 10) / 10;
}

/**
 * Distance (거리): the system takes it off the dice, by how the actor reaches (the GM's DC leaves
 * distance out). Up to `free` squares cost nothing; then -1 for every `per` squares, at most `max`.
 * Running and reaching out by hand stretch worst, shots less, spells least.
 */
export const DISTANCE_RULE: Record<Means, { free: number; per: number; max: number }> = {
  touch: { free: 1, per: 2, max: 4 },
  move: { free: 1, per: 2, max: 4 },
  ranged: { free: 2, per: 2, max: 4 },
  magic: { free: 3, per: 3, max: 3 },
};

/** The distance modifier (0 or less) for reaching `d` squares by `means`. */
export function distancePenalty(means: Means, d: number): number {
  const rule = DISTANCE_RULE[means];
  if (!rule || d <= rule.free) return 0;
  return -Math.min(rule.max, Math.ceil((d - rule.free) / rule.per));
}

/**
 * How far an action reaches from its actor: to the farthest square its effects touch, measured
 * from wherever the actor stands then; the actor's own run (move effects) counted from where it set out.
 */
export function actionReach(ruling: Ruling): number {
  if (ruling.actor == null) return 0;
  const start = ruling.actor;
  let at = start;
  let reach = 0;
  for (const e of ruling.effects ?? []) {
    if (e.type === 'move' && e.from === at) {
      at = e.to;
      reach = Math.max(reach, distance(start, at));
      continue;
    }
    for (const sq of targetsOf(e)) reach = Math.max(reach, distance(at, sq));
  }
  return reach;
}

/** Reviving a piece where its remains (유해) still are. */
export const REMAINS_BONUS = 2;

/** The modifiers this ruling's roll gets on `board`, declared by `color` (`remains`: the game's 유해, `terrain`: its buildings). */
export function rollModifiers(board: Board, ruling: Ruling, color: Color, remains?: readonly RemainsMark[], terrain?: readonly TerrainCell[]): RollModifier[] {
  const mods: RollModifier[] = [...sacrificeModifiers(board, ruling, color)];
  for (const at of new Set(ruling.buildings ?? [])) {
    const b = terrain?.find((c) => c.at === at)?.building;
    if (b && ruling.actor != null && distance(ruling.actor, at) <= BUILDING_REACH) mods.push({ kind: 'building', label: b.name, value: b.bonus });
  }
  for (const e of ruling.effects) {
    if (e.type !== 'revive') continue;
    const r = remainsAt(remains, e.at);
    if (r && r.color === e.color && r.type === e.piece) mods.push({ kind: 'remains', label: `유해 ${KIND_NAME[r.type]} ${squareName(r.at)}`, value: REMAINS_BONUS });
  }
  if (ruling.actor != null && ruling.means && MEANS.includes(ruling.means)) {
    const reach = actionReach(ruling);
    const value = distancePenalty(ruling.means, reach);
    if (value) mods.push({ kind: 'distance', label: `${reach}칸 ${MEANS_NAME[ruling.means]}`, value });
  }
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
export function pendingModifiers(board: Board, pending: PendingAction, remains?: readonly RemainsMark[], terrain?: readonly TerrainCell[]): RollModifier[] {
  if (!pending.offered) return rollModifiers(board, pending.ruling, pending.color, remains, terrain);
  return [...pending.offered, ...rollModifiers(board, { ...pending.ruling, sacrifice: [] }, pending.color, remains, terrain)];
}

/** What the modifiers add up to, held within ±MOD_TOTAL_MAX. */
export function modifierTotal(mods: readonly RollModifier[]): number {
  const sum = mods.reduce((s, m) => s + m.value, 0);
  return Math.max(-MOD_TOTAL_MAX, Math.min(MOD_TOTAL_MAX, sum));
}
