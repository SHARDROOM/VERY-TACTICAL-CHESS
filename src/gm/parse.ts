import { parseSquare, type ChaosEvent, type Effect, type Ruling, type Square } from '../engine';
import { GmChaosReplySchema, GmRulingReplySchema } from './schema';
import { cleanAura, cleanRulingStaging, cleanStaging } from './staging';
import type { GmEffectReplyJson } from './types';

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
  const { effects, critSuccessEffects, critFailureEffects, staging, ...rest } = checked.data;

  const lists: Record<string, Effect[]> = {};
  for (const [key, label, list] of [
    ['effects', '', effects],
    ['critSuccessEffects', '대성공 ', critSuccessEffects],
    ['critFailureEffects', '대실패 ', critFailureEffects],
  ] as const) {
    const out: Effect[] = [];
    for (const [i, e] of list.entries()) {
      const converted = convert(e);
      if (typeof converted === 'string') return { ok: false, error: `${label}효과 ${i + 1}: 칸 이름 "${converted}"이(가) 올바르지 않음` };
      out.push(converted);
    }
    lists[key] = out;
  }
  // Staging is only for show: whatever is wrong in it is dropped, never the ruling.
  const crit = lists.critSuccessEffects.length ? lists.critSuccessEffects : lists.effects;
  const counts = { success: lists.effects.length, failure: 0, critSuccess: crit.length, critFailure: lists.critFailureEffects.length };
  return {
    ok: true,
    ruling: {
      ...rest,
      effects: lists.effects,
      critSuccessEffects: lists.critSuccessEffects,
      critFailureEffects: lists.critFailureEffects,
      staging: cleanRulingStaging(staging, counts),
    },
  };
}

/** Converts one effect, or returns the first bad square name. */
function convert(e: GmEffectReplyJson): Effect | string {
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
  };
  for (const f of fields[e.type]) {
    const name = (e as Record<string, unknown>)[f] as string;
    const s = parseSquare(name);
    if (s === null) return name;
    squares[f] = s;
  }
  if (e.type === 'tag') {
    const { aura, auraStrength, ...tag } = e;
    const clean = cleanAura(aura, auraStrength);
    return { ...tag, ...squares, ...(clean && { aura: clean }) } as unknown as Effect;
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
