import { z } from 'zod';
import { ATTACH_POINTS, PROP_MATERIALS, PROP_PRESETS, PROP_SHAPES, cleanProp, type Prop } from '../engine';

/*
 * Props (조형물) at the GM boundary: the shape a GM writes them in (flat numbers per part, so
 * every provider's structured output can take it), and the conversion to the engine's props.
 * A prop is only a look: whatever is wrong in it is dropped, never the ruling.
 */

const PRESETS = ['none', ...PROP_PRESETS] as const;

/**
 * Parts are written as text, one per line or separated by ";": "shape material x y z width
 * height depth [rotX rotY rotZ] [#colour]". A list of objects nested in every effect makes the
 * response schema too deep for some providers (Gemini turns the request down).
 */
const PARTS_HELP =
  '직접 조합할 때의 부품 (최대 20개). 한 줄에 하나 또는 ;로 구분: "도형 재질 x y z 폭 높이 깊이 [x회전 y회전 z회전] [#색]". ' +
  `도형: ${PROP_SHAPES.join(', ')}. 재질: ${PROP_MATERIALS.join(', ')}. 예: "box iron 0 0.32 0 0.05 0.5 0.012; sphere gold 0 -0.08 0 0.05 0.05 0.05". preset을 쓰면 ""`;

/** What a GM writes for a prop (every field present; "none" and "" mean nothing). */
export const GmPropSchema = z.object({
  preset: z.enum(PRESETS).describe(`미리 만든 모양 (${PROP_PRESETS.join(', ')}; cannon·chapel·forge는 건물 칸 전용, 기물에는 안 됨) 또는 none(아래 parts로 직접 조합)`),
  color: z.string().describe('미리 만든 모양의 천·유리·빛남 색 "#rrggbb" (기본은 "")'),
  scale: z.number().describe('크기 배율 0.5~2 (기본 1)'),
  attach: z.enum(ATTACH_POINTS).describe('기물에 붙는 곳: rightHand, leftHand, head, back, feet (칸 조형물은 feet)'),
  parts: z.string().describe(PARTS_HELP),
});

/** Mirrors GmPropSchema for providers that take plain JSON Schema. */
export const GM_PROP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    preset: { type: 'string', enum: [...PRESETS], description: `미리 만든 모양 (${PROP_PRESETS.join(', ')}; cannon·chapel·forge는 건물 칸 전용, 기물에는 안 됨) 또는 none(아래 parts로 직접 조합)` },
    color: { type: 'string', description: '미리 만든 모양의 천·유리·빛남 색 "#rrggbb" (기본은 "")' },
    scale: { type: 'number', description: '크기 배율 0.5~2 (기본 1)' },
    attach: { type: 'string', enum: [...ATTACH_POINTS], description: '기물에 붙는 곳: rightHand, leftHand, head, back, feet (칸 조형물은 feet)' },
    parts: { type: 'string', description: PARTS_HELP },
  },
  required: ['preset', 'color', 'scale', 'attach', 'parts'],
  additionalProperties: false,
} as const;

/** Reads the parts text into raw parts (cleanProp checks and trims them). */
export function partsFromText(text: unknown): unknown[] {
  if (typeof text !== 'string') return [];
  return text
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const words = line.split(/[\s,]+/).filter(Boolean);
      const shape = words.find((w) => (PROP_SHAPES as readonly string[]).includes(w.toLowerCase()))?.toLowerCase();
      const material = words.find((w) => (PROP_MATERIALS as readonly string[]).includes(w.toLowerCase()))?.toLowerCase();
      const color = words.find((w) => /^#[0-9a-fA-F]{6}$/.test(w));
      const n = words.map(Number).filter((x, i) => Number.isFinite(x) && !/^#/.test(words[i]));
      if (n.length < 6) return null;
      return { shape, material, position: n.slice(0, 3), size: n.slice(3, 6), rotation: n.length >= 9 ? n.slice(6, 9) : [0, 0, 0], color };
    });
}

/** A GM's prop as an engine prop (cleaned), or undefined for none. */
export function propFromGm(raw: unknown): Prop | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const parts = Array.isArray(r.parts) ? r.parts : partsFromText(r.parts);
  return cleanProp({ preset: r.preset === 'none' ? null : r.preset, parts, attach: r.attach, color: r.color || undefined, scale: r.scale || 1 }) ?? undefined;
}

/** "No prop", as a GM writes it. */
export const NO_PROP = { preset: 'none', color: '', scale: 1, attach: 'rightHand', parts: '' } as const;
