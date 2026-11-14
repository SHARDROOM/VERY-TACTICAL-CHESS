import type { z } from 'zod';
import type { GameState } from '../engine';
import type { GameMaster, GmChaosJson, GmRequest, GmRulingJson } from './types';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_CHAOS_JSON_SCHEMA, GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmChaosSchema, GmRulingSchema } from './schema';
import { GmError, describeHttpError, describeNetworkError } from './errors';
import { REFUSED, TRUNCATED, jsonFromText } from './llmReply';

/** Suggestions only: the settings field accepts any model id. */
export const GEMINI_MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-argon'];

export interface GeminiGmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GenerateContentResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

/** GM backed by the Gemini API generateContent with JSON-schema structured output, called from the browser (BYOK). */
export class GeminiGameMaster implements GameMaster {
  readonly name: string;

  constructor(private readonly options: GeminiGmOptions) {
    this.name = `Gemini GM (${options.model})`;
  }

  rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    return this.ask(buildSystemPrompt(state.rules), buildUserMessage(action, state), GM_RULING_JSON_SCHEMA, GmRulingSchema);
  }

  chaos({ state }: { state: GameState }): Promise<GmChaosJson> {
    return this.ask(buildChaosSystemPrompt(state.rules), buildChaosUserMessage(state), GM_CHAOS_JSON_SCHEMA, GmChaosSchema);
  }

  private async ask<T extends z.ZodTypeAny>(system: string, user: string, jsonSchema: object, schema: T): Promise<z.infer<T>> {
    const doFetch = this.options.fetch ?? fetch;
    const base = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com';
    let res: Response;
    try {
      res = await doFetch(`${base}/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new GmError(describeNetworkError('Gemini', err));
    }

    const body = (await res.json().catch(() => ({}))) as GenerateContentResponse;
    if (!res.ok) {
      const message = body.error?.message ?? '';
      // Gemini reports a bad key as 400 INVALID_ARGUMENT rather than 401.
      const status = res.status === 400 && /api key/i.test(message) ? 401 : res.status;
      throw new GmError(describeHttpError('Gemini', status, message));
    }

    if (body.promptFeedback?.blockReason) throw new GmError(REFUSED);
    const candidate = body.candidates?.[0];
    const reason = candidate?.finishReason ?? '';
    if (reason === 'MAX_TOKENS') throw new GmError(TRUNCATED);
    if (BLOCKED.has(reason)) throw new GmError(REFUSED);
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    return jsonFromText(text, schema);
  }
}
