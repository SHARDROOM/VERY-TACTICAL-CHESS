import { z } from 'zod';
import {
  ACTS,
  ELEMENTS,
  ENTRANCES,
  EXITS,
  FX_SHAPES,
  MOTION_STYLES,
  SPEEDS,
  STAGING_LIMITS,
  parseSquare,
  type Act,
  type ActKind,
  type Aura,
  type Beat,
  type Entrance,
  type Exit,
  type Fx,
  type FxShape,
  type MotionStyle,
  type Outcome,
  type Speed,
  type Staging,
  type Element,
} from '../engine';

/*
 * GM staging on the wire. The JSON Schema sent to providers lists the allowed values (enums);
 * the zod schema that reads replies is lenient (plain strings and numbers), because staging is
 * only for show: a bad item is dropped by cleanStaging instead of rejecting the whole ruling.
 */

const list = (xs: readonly string[]) => xs.join(', ');

export const GmStagingSchema = z.object({
  fx: z
    .array(
      z.object({
        element: z.string().describe(`원소: ${list(ELEMENTS)}`),
        shape: z.string().describe(`모양: ${list(FX_SHAPES)}`),
        at: z.string().describe('burst의 중심 칸, beam의 출발 칸, area의 한 모서리 칸. 쓰지 않으면 ""'),
        to: z.string().describe('beam의 도착 칸, area의 반대 모서리 칸. area에서 at과 to가 모두 ""이면 보드 전체'),
        radius: z.number().describe('burst의 반경(칸), 0.5~3'),
        strength: z.number().describe('세기 1~5'),
        duration: z.number().describe('지속 초 0.5~5'),
        withEffect: z.number().describe('이 번호(1부터)의 효과와 함께 시작. trail은 그 효과로 움직이는 기물을 따라감. 0이면 연출 시작 기준'),
        delay: z.number().describe('그 시점부터 몇 초 뒤에 시작(0~5)'),
      }),
    )
    .describe(`이펙트 (최대 ${STAGING_LIMITS.fx}개)`),
  shake: z.number().describe('화면 흔들림 0~3'),
  beats: z
    .array(
      z.object({
        effect: z.number().describe('꾸밀 효과의 번호(1부터)'),
        wait: z.number().describe('이 효과를 보여 주기 전 대기 초 0~2'),
        motion: z.string().describe(`move·unboard의 움직임: ${list(MOTION_STYLES)}`),
        speed: z.string().describe(`속도: ${list(SPEEDS)}`),
        entrance: z.string().describe(`spawn의 등장: ${list(ENTRANCES)}`),
        exit: z.string().describe(`remove 또는 move로 잡힌 기물의 퇴장: ${list(EXITS)}`),
      }),
    )
    .describe('효과별 연출'),
  acts: z
    .array(
      z.object({
        at: z.string().describe('연기할 기물의 칸'),
        act: z.string().describe(`제자리 연기: ${list(ACTS)}`),
        delay: z.number().describe('연출 시작 후 몇 초 뒤(0~5)'),
      }),
    )
    .describe('보드를 바꾸지 않는 제자리 연기'),
});

export const GmRulingStagingSchema = z.object({
  success: GmStagingSchema,
  failure: GmStagingSchema,
  critSuccess: GmStagingSchema,
  critFailure: GmStagingSchema,
});

// ---- JSON Schema (OpenAI strict, Gemini) ----------------------------------------

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const en = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });
const obj = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const GM_STAGING_JSON_SCHEMA = obj({
  fx: {
    type: 'array',
    description: `이펙트 (최대 ${STAGING_LIMITS.fx}개)`,
    items: obj({
      element: en(ELEMENTS, '원소'),
      shape: en(FX_SHAPES, '모양'),
      at: str('burst의 중심 칸, beam의 출발 칸, area의 한 모서리 칸. 쓰지 않으면 ""'),
      to: str('beam의 도착 칸, area의 반대 모서리 칸. area에서 at과 to가 모두 ""이면 보드 전체'),
      radius: num('burst의 반경(칸), 0.5~3'),
      strength: num('세기 1~5'),
      duration: num('지속 초 0.5~5'),
      withEffect: num('이 번호(1부터)의 효과와 함께 시작. trail은 그 효과로 움직이는 기물을 따라감. 0이면 연출 시작 기준'),
      delay: num('그 시점부터 몇 초 뒤에 시작(0~5)'),
    }),
  },
  shake: num('화면 흔들림 0~3'),
  beats: {
    type: 'array',
    description: '효과별 연출',
    items: obj({
      effect: num('꾸밀 효과의 번호(1부터)'),
      wait: num('이 효과를 보여 주기 전 대기 초 0~2'),
      motion: en(MOTION_STYLES, 'move·unboard의 움직임'),
      speed: en(SPEEDS, '속도'),
      entrance: en(ENTRANCES, 'spawn의 등장'),
      exit: en(EXITS, 'remove 또는 move로 잡힌 기물의 퇴장'),
    }),
  },
  acts: {
    type: 'array',
    description: '보드를 바꾸지 않는 제자리 연기',
    items: obj({
      at: str('연기할 기물의 칸'),
      act: en(ACTS, '제자리 연기'),
      delay: num('연출 시작 후 몇 초 뒤(0~5)'),
    }),
  },
});

export const GM_RULING_STAGING_JSON_SCHEMA = obj({
  success: GM_STAGING_JSON_SCHEMA,
  failure: GM_STAGING_JSON_SCHEMA,
  critSuccess: GM_STAGING_JSON_SCHEMA,
  critFailure: GM_STAGING_JSON_SCHEMA,
});

// ---- cleaning -----------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const square = (v: unknown) => (typeof v === 'string' && v.trim() ? parseSquare(v.trim().toLowerCase()) : null);

/**
 * GM staging as typed, made safe: unknown elements, shapes and squares drop the item, numbers
 * are clamped, effect numbers outside the outcome's effects are dropped, and there are at most
 * STAGING_LIMITS.fx effects. Never throws; junk becomes an empty staging.
 */
export function cleanStaging(raw: unknown, effectCount: number): Staging {
  if (!isObj(raw)) return { fx: [], shake: 0, beats: [], acts: [] };
  const effectIndex = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > effectCount) return null;
    return v - 1;
  };

  const fx: Fx[] = [];
  for (const f of Array.isArray(raw.fx) ? raw.fx : []) {
    if (!isObj(f) || fx.length >= STAGING_LIMITS.fx) continue;
    if (!ELEMENTS.includes(f.element as Element) || !FX_SHAPES.includes(f.shape as FxShape)) continue;
    const shape = f.shape as FxShape;
    const at = square(f.at);
    const to = square(f.to);
    const withEffect = effectIndex(f.withEffect);
    if (shape === 'burst' && at === null) continue;
    if (shape === 'beam' && (at === null || to === null)) continue;
    // An area needs both corners, or neither (the whole board).
    if (shape === 'area' && (at === null) !== (to === null)) continue;
    if (shape === 'trail' && withEffect === null) continue;
    fx.push({
      element: f.element as Element,
      shape,
      at,
      to,
      radius: clamp(f.radius, STAGING_LIMITS.minRadius, STAGING_LIMITS.maxRadius, 1),
      strength: Math.round(clamp(f.strength, 1, 5, 3)),
      duration: clamp(f.duration, STAGING_LIMITS.minDuration, STAGING_LIMITS.maxDuration, 1.5),
      withEffect,
      delay: clamp(f.delay, 0, STAGING_LIMITS.fxDelay, 0),
    });
  }

  const beats: Beat[] = [];
  for (const b of Array.isArray(raw.beats) ? raw.beats : []) {
    if (!isObj(b)) continue;
    const effect = effectIndex(b.effect);
    if (effect === null || beats.some((x) => x.effect === effect)) continue;
    beats.push({
      effect,
      wait: clamp(b.wait, 0, STAGING_LIMITS.beatWait, 0),
      motion: pick<MotionStyle>(b.motion, MOTION_STYLES, 'default'),
      speed: pick<Speed>(b.speed, SPEEDS, 'normal'),
      entrance: pick<Entrance>(b.entrance, ENTRANCES, 'default'),
      exit: pick<Exit>(b.exit, EXITS, 'default'),
    });
  }

  const acts: Act[] = [];
  for (const a of Array.isArray(raw.acts) ? raw.acts : []) {
    if (!isObj(a) || acts.length >= 8) continue;
    const at = square(a.at);
    if (at === null || !ACTS.includes(a.act as ActKind)) continue;
    acts.push({ at, act: a.act as ActKind, delay: clamp(a.delay, 0, STAGING_LIMITS.fxDelay, 0) });
  }

  return { fx, shake: Math.round(clamp(raw.shake, 0, 3, 0)), beats, acts };
}

/** The staging of all four outcomes of a ruling, each checked against its own effects. */
export function cleanRulingStaging(raw: unknown, counts: Record<Outcome, number>): Partial<Record<Outcome, Staging>> {
  if (!isObj(raw)) return {};
  const out: Partial<Record<Outcome, Staging>> = {};
  for (const outcome of ['success', 'failure', 'critSuccess', 'critFailure'] as const) {
    if (raw[outcome] !== undefined) out[outcome] = cleanStaging(raw[outcome], counts[outcome]);
  }
  return out;
}

/** A tag effect's aura, or nothing if it is missing or not one of the elements. */
export function cleanAura(element: unknown, strength: unknown): Aura | undefined {
  if (!ELEMENTS.includes(element as Element)) return undefined;
  return { element: element as Element, strength: Math.round(clamp(strength, 1, 3, 2)) };
}
