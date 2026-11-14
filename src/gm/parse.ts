import { parseSquare, type Effect, type Ruling } from '../engine';

export type ParseResult = { ok: true; ruling: Ruling } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Shape-checks a GM response and converts squares to engine form. Rule checks
 * (DC/cost ranges, impossible or forbidden effects) are the engine's job.
 */
export function parseGmRuling(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, error: '판정이 객체가 아님' };
  const { interpretation, feasible, dc, cost, effects, narration } = raw;
  if (typeof interpretation !== 'string') return { ok: false, error: 'interpretation이 문자열이 아님' };
  if (typeof feasible !== 'boolean') return { ok: false, error: 'feasible이 불리언이 아님' };
  if (typeof dc !== 'number' || typeof cost !== 'number') return { ok: false, error: 'dc/cost가 숫자가 아님' };
  if (!Array.isArray(effects)) return { ok: false, error: 'effects가 배열이 아님' };
  if (!isObj(narration) || typeof narration.success !== 'string' || typeof narration.failure !== 'string') {
    return { ok: false, error: 'narration 형식이 올바르지 않음' };
  }

  const out: Effect[] = [];
  for (const [i, e] of effects.entries()) {
    if (!isObj(e)) return { ok: false, error: `효과 ${i + 1}이(가) 객체가 아님` };
    const square = (v: unknown) => (typeof v === 'string' ? parseSquare(v) : null);
    if (e.type === 'move') {
      const from = square(e.from);
      const to = square(e.to);
      if (from === null || to === null) return { ok: false, error: `효과 ${i + 1}: 칸 이름이 올바르지 않음` };
      out.push({ type: 'move', from, to });
    } else if (e.type === 'remove') {
      const at = square(e.at);
      if (at === null) return { ok: false, error: `효과 ${i + 1}: 칸 이름이 올바르지 않음` };
      out.push({ type: 'remove', at });
    } else {
      return { ok: false, error: `효과 ${i + 1}: 허용되지 않은 효과 종류 "${String(e.type)}"` };
    }
  }

  return {
    ok: true,
    ruling: {
      interpretation,
      feasible,
      dc,
      cost,
      effects: out,
      narration: { success: narration.success, failure: narration.failure },
    },
  };
}
