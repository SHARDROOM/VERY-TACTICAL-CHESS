import { parseSquare, type Effect, type Ruling, type Square } from '../engine';
import { GmRulingSchema } from './schema';
import type { GmEffectJson } from './types';

export type ParseResult = { ok: true; ruling: Ruling } | { ok: false; error: string };

/**
 * Shape-checks a GM response and converts squares to engine form. Rule checks
 * (DC/cost ranges, impossible or forbidden effects) are the engine's job.
 */
export function parseGmRuling(raw: unknown): ParseResult {
  const checked = GmRulingSchema.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, error: `${issue.path.join('.') || '판정'}: ${issue.message}` };
  }
  const { effects, critSuccessEffects, critFailureEffects, ...rest } = checked.data;

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
  return {
    ok: true,
    ruling: {
      ...rest,
      effects: lists.effects,
      critSuccessEffects: lists.critSuccessEffects,
      critFailureEffects: lists.critFailureEffects,
    },
  };
}

/** Converts one effect, or returns the first bad square name. */
function convert(e: GmEffectJson): Effect | string {
  const squares: Record<string, Square> = {};
  const fields: Record<GmEffectJson['type'], string[]> = {
    move: ['from', 'to'],
    remove: ['at'],
    tag: ['at'],
    untag: ['at'],
    board: ['rider', 'carrier'],
    unboard: ['at', 'to'],
    transform: ['at'],
    spawn: ['at'],
  };
  for (const f of fields[e.type]) {
    const name = (e as Record<string, unknown>)[f] as string;
    const s = parseSquare(name);
    if (s === null) return name;
    squares[f] = s;
  }
  return { ...e, ...squares } as unknown as Effect;
}
