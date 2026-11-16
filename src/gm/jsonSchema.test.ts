import { describe, expect, it } from 'vitest';
import { GM_CHAOS_JSON_SCHEMA, GM_RULING_JSON_SCHEMA } from './jsonSchema';

/** Every property in a JSON Schema, counted where it is written out (shared parts count each time). */
function properties(x: unknown): number {
  if (Array.isArray(x)) return x.reduce((n: number, v) => n + properties(v), 0);
  if (!x || typeof x !== 'object') return 0;
  const o = x as Record<string, unknown>;
  const own = o.properties && typeof o.properties === 'object' ? Object.keys(o.properties).length : 0;
  return own + Object.values(o).reduce((n: number, v) => n + properties(v), 0);
}

/**
 * Gemini turns a response schema away with a bare "invalid argument" (HTTP 400) once it has too
 * many properties: measured on the ruling schema, 311 passed and 317 failed. Keep under the
 * last count known to pass; to add a field, make room elsewhere first and check it live.
 */
const GEMINI_SAFE = 311;

describe('GM response schemas stay small enough for Gemini', () => {
  it('the ruling', () => {
    expect(properties(GM_RULING_JSON_SCHEMA)).toBeLessThanOrEqual(GEMINI_SAFE);
  });
  it('the chaos event', () => {
    expect(properties(GM_CHAOS_JSON_SCHEMA)).toBeLessThanOrEqual(GEMINI_SAFE);
  });
});
