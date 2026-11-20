import type { z } from 'zod';
import { GmRulingReplySchema } from './schema';
import { GmError } from './errors';

/** Parses and shape-checks the JSON text of a completed LLM reply against `schema`. */
export function jsonFromText<T extends z.ZodTypeAny>(text: string, schema: T): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GmError('GM의 응답을 해석하지 못했습니다. 다시 시도해 주세요.', 'format');
  }
  const checked = schema.safeParse(json);
  if (!checked.success) throw new GmError('GM의 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.', 'format');
  return checked.data;
}

/**
 * The same, for a model that may wrap its JSON: a reasoning block (<think>…</think>), a code fence
 * or a sentence around it. The outermost {…} is taken.
 */
export function jsonFromLooseText<T extends z.ZodTypeAny>(text: string, schema: T): z.infer<T> {
  const bare = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return jsonFromText(bare, schema);
  } catch (err) {
    const start = bare.indexOf('{');
    const end = bare.lastIndexOf('}');
    if (start < 0 || end <= start) throw err;
    return jsonFromText(bare.slice(start, end + 1), schema);
  }
}

export function rulingFromText(text: string): unknown {
  return jsonFromText(text, GmRulingReplySchema);
}

export const TRUNCATED = 'GM의 응답이 너무 길어 중간에 끊겼습니다. 다시 시도해 주세요.';
export const REFUSED = 'GM이 이 선언의 판정을 거절했습니다. 표현을 바꿔 다시 선언해 주세요.';
