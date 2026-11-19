import { CLASH_MAX, CLASH_MIN, MAX_MOVE_TIMES, parseSquare, type ChaosEvent, type Effect, type Means, type PieceType, type Ruling, type Square } from '../engine';
import { GmChaosReplySchema, GmRulingReplySchema } from './schema';
import { cleanAura, cleanRulingStaging, cleanStaging } from './staging';
import { propFromGm } from './props';
import type { GmEffectReplyJson } from './types';

const MOVE_KINDS: readonly PieceType[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export type ParseResult = { ok: true; ruling: Ruling } | { ok: false; error: string };

/**
 * Shape-checks a GM response and converts squares to engine form. Rule checks
 * (DC/cost ranges, impossible or forbidden effects) are the engine's job.
 */
export function parseGmRuling(raw: unknown): ParseResult {
  const checked = GmRulingReplySchema.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, error: `${issue.path.join('.') || '판정'}: ${issue.message}` };
  }
  const { effects, critFailureEffects, staging, actor: actorName, means, target: targetName, skills, mental, sacrifice: offeredNames, buildings: buildingNames, ...rest } = checked.data;
  const actorText = (actorName ?? '').trim();
  const actor = actorText ? parseSquare(actorText) : null;
  if (actorText && actor === null) return { ok: false, error: `주체 칸 이름 "${actorText}"이(가) 올바르지 않음` };
  // The target only matters for a mental action's will; a name that is not a square is no target.
  const target = parseSquare((targetName ?? '').trim());
  const skillNames = [...new Set((skills ?? []).map((n) => n.trim()).filter(Boolean))];
  const sacrifice: Square[] = [];
  for (const n of offeredNames ?? []) {
    if (!n.trim()) continue;
    const s = parseSquare(n.trim());
    if (s === null) return { ok: false, error: `제물 칸 이름 "${n}"이(가) 올바르지 않음` };
    if (!sacrifice.includes(s)) sacrifice.push(s);
  }
  const buildings: Square[] = [];
  for (const n of buildingNames ?? []) {
    if (!n.trim()) continue;
    const s = parseSquare(n.trim());
    if (s === null) return { ok: false, error: `건물 칸 이름 "${n}"이(가) 올바르지 않음` };
    if (!buildings.includes(s)) buildings.push(s);
  }
  // The GM picks a clash multiplier as without a sacrifice; the system adds what one is worth.
  const clashMax = CLASH_MAX;

  const lists: Record<string, Effect[]> = {};
  for (const [key, label, list] of [
    ['effects', '', effects],
    ['critFailureEffects', '대실패 ', critFailureEffects],
  ] as const) {
    const out: Effect[] = [];
    for (const [i, e] of list.entries()) {
      const converted = convert(e, clashMax);
      if (typeof converted === 'string') return { ok: false, error: `${label}효과 ${i + 1}: 칸 이름 "${converted}"이(가) 올바르지 않음` };
      out.push(converted);
    }
    lists[key] = out;
  }
  // Staging is only for show: whatever is wrong in it is dropped, never the ruling.
  const counts = { success: lists.effects.length, failure: 0, critFailure: lists.critFailureEffects.length };
  return {
    ok: true,
    ruling: {
      ...rest,
      actor,
      ...(means !== undefined && { means: means as Means }),
      ...(target !== null && { target }),
      ...(skillNames.length > 0 && { skills: skillNames }),
      ...(mental && { mental: true }),
      ...(sacrifice.length > 0 && { sacrifice }),
      ...(buildings.length > 0 && { buildings }),
      effects: lists.effects,
      critFailureEffects: lists.critFailureEffects,
      staging: cleanRulingStaging(staging, counts),
    },
  };
}

/** Converts one effect, or returns the first bad square name. */
function convert(e: GmEffectReplyJson, clashMax = CLASH_MAX): Effect | string {
  const squares: Record<string, Square> = {};
  const fields: Record<GmEffectReplyJson['type'], string[]> = {
    move: ['from', 'to'],
    remove: ['at'],
    tag: ['at'],
    untag: ['at'],
    board: ['rider', 'carrier'],
    unboard: ['at', 'to'],
    transform: ['at'],
    spawn: ['at'],
    convert: ['at'],
    swap: ['a', 'b'],
    fuse: ['body', 'material'],
    split: ['at', 'to'],
    revive: ['at'],
    terrain: ['at'],
    clearTerrain: ['at'],
    cover: ['at'],
    clearCover: ['at'],
  };
  for (const f of fields[e.type]) {
    const name = (e as Record<string, unknown>)[f] as string;
    const s = parseSquare(name);
    if (s === null) return name;
    squares[f] = s;
  }
  if (e.type === 'tag') {
    const { aura, auraStrength, clash, prop, moveAs, moveTimes, skill, mind, by, ...tag } = e as typeof e & { by?: unknown };
    // Who holds a hostage in a chaos event ("" or nothing: no one named).
    if (typeof by === 'string' && by.trim()) {
      const holder = parseSquare(by.trim());
      if (holder === null) return by;
      squares.by = holder;
    }
    const clean = cleanAura(aura, auraStrength);
    const look = propFromGm(prop);
    // A multiplier of 1 or less is none; past the range it is pulled in (it is a judgment, not a typo).
    const mult = typeof clash === 'number' && clash > 1 ? Math.min(clashMax, Math.max(CLASH_MIN, Math.round(clash * 10) / 10)) : undefined;
    // Likewise the move powers: unknown kinds are dropped, too many moves in a row pulled in.
    const kinds = Array.isArray(moveAs) ? [...new Set(moveAs.filter((k): k is PieceType => typeof k === 'string' && MOVE_KINDS.includes(k as PieceType)))] : [];
    const times = typeof moveTimes === 'number' && moveTimes >= 2 ? Math.min(MAX_MOVE_TIMES, Math.round(moveTimes)) : undefined;
    // A skill or a will: 0 (or nothing to be about) is none. The engine checks the size.
    const sk = skill as { about?: unknown; bonus?: unknown } | undefined;
    const skillOk = sk && typeof sk.about === 'string' && sk.about.trim() && typeof sk.bonus === 'number' && Math.round(sk.bonus) !== 0;
    const will = typeof mind === 'number' && Math.round(mind) !== 0 ? Math.round(mind) : undefined;
    return {
      ...tag,
      ...squares,
      ...(clean && { aura: clean }),
      ...(mult && { clash: mult }),
      ...(look && { prop: look }),
      ...(kinds.length > 0 && { moveAs: kinds }),
      ...(times && { moveTimes: times }),
      ...(skillOk && { skill: { about: (sk.about as string).trim().slice(0, 30), bonus: Math.round(sk.bonus as number) } }),
      ...(will && { mind: will }),
    } as unknown as Effect;
  }
  if (e.type === 'terrain' || e.type === 'cover') {
    const { prop, building, ...rest } = e as typeof e & { building?: unknown };
    const look = propFromGm(prop);
    // A building ("none" or nothing: a plain wall or pit); the engine checks the rest.
    const b = building as { kind?: unknown } | undefined;
    const isBuilding = e.type === 'terrain' && b && typeof b === 'object' && typeof b.kind === 'string' && b.kind !== 'none';
    return { ...rest, ...squares, ...(look && { prop: look }), ...(isBuilding && { building }) } as unknown as Effect;
  }
  return { ...e, ...squares } as unknown as Effect;
}

export type ChaosParseResult = { ok: true; chaos: ChaosEvent } | { ok: false; error: string };

/** Shape-checks a chaos event from the GM and converts its squares; the engine checks the rest. */
export function parseGmChaos(raw: unknown): ChaosParseResult {
  const checked = GmChaosReplySchema.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, error: `${issue.path.join('.') || '혼돈'}: ${issue.message}` };
  }
  const effects: Effect[] = [];
  for (const [i, e] of checked.data.effects.entries()) {
    const converted = convert(e);
    if (typeof converted === 'string') return { ok: false, error: `효과 ${i + 1}: 칸 이름 "${converted}"이(가) 올바르지 않음` };
    effects.push(converted);
  }
  return {
    ok: true,
    chaos: { title: checked.data.title, narration: checked.data.narration, effects, staging: cleanStaging(checked.data.staging, effects.length) },
  };
}
