import type { z } from 'zod';
import type { ChaosRequest, GameMaster, GmRequest } from './types';
import { GM_PLAYER_JSON_SCHEMA, GmPlayerSchema, buildPlayerSystemPrompt, buildPlayerUserMessage, type ActRequest } from './player';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_CHAOS_JSON_SCHEMA, GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmChaosReplySchema, GmRulingReplySchema } from './schema';
import { GmError, describeHttpError, describeNetworkError, fetchWithRetry } from './errors';
import { REFUSED, TRUNCATED, jsonFromLooseText, jsonFromText } from './llmReply';

/** Suggestions only: the settings field accepts any model id. */
export const OPENAI_MODEL_SUGGESTIONS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'];

export interface OpenAiGmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** The whole Chat Completions URL (another service's, see compatible.ts); `baseUrl` is then unused. */
  endpoint?: string;
  /** Whose API it is, for the GM's name and the error messages (default OpenAI). */
  label?: string;
  /**
   * Another service (기타): its models may not take a strict JSON schema. If the request is
   * refused for that, it asks for a plain JSON object with the schema in the instructions, then
   * for nothing special, and keeps whatever worked; replies may come wrapped in prose or fences.
   */
  lenient?: boolean;
  /** Wait before the one retry of a busy server (tests use 0). */
  retryDelayMs?: number;
}

/** How the reply's JSON is asked for: a strict schema, any JSON object, or only by the instructions. */
type JsonMode = 'schema' | 'object' | 'prompt';

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  error?: { message?: string };
}

/** GM backed by OpenAI Chat Completions with strict JSON-schema structured output, called from the browser (BYOK). */
export class OpenAiGameMaster implements GameMaster {
  readonly name: string;
  private readonly label: string;
  /** The way of asking for JSON that this service took last (a lenient GM may step down). */
  private mode: JsonMode = 'schema';

  constructor(private readonly options: OpenAiGmOptions) {
    this.label = options.label ?? 'OpenAI';
    this.name = `${this.label} GM (${options.model})`;
  }

  rule({ action, state, problem }: GmRequest): Promise<unknown> {
    return this.ask(buildSystemPrompt(state.rules), buildUserMessage(action, state, problem), 'gm_ruling', GM_RULING_JSON_SCHEMA, GmRulingReplySchema);
  }

  chaos({ state, inspiration, problem }: ChaosRequest): Promise<unknown> {
    return this.ask(buildChaosSystemPrompt(state.rules), buildChaosUserMessage(state, inspiration, problem), 'gm_chaos', GM_CHAOS_JSON_SCHEMA, GmChaosReplySchema);
  }

  act(request: ActRequest): Promise<unknown> {
    return this.ask(buildPlayerSystemPrompt(), buildPlayerUserMessage(request), 'ai_player', GM_PLAYER_JSON_SCHEMA, GmPlayerSchema);
  }

  private async ask<T extends z.ZodTypeAny>(system: string, user: string, name: string, jsonSchema: object, schema: T): Promise<z.infer<T>> {
    const doFetch = this.options.fetch ?? fetch;
    const url = this.options.endpoint ?? `${this.options.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // A server on this computer may need no key at all.
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const request = (mode: JsonMode) => () => ({
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: mode === 'schema' ? system : `${system}\n\n${schemaInstruction(jsonSchema)}` },
          { role: 'user', content: user },
        ],
        ...(mode === 'schema' && { response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } } }),
        ...(mode === 'object' && { response_format: { type: 'json_object' } }),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    let res: Response;
    let body: ChatCompletion;
    for (;;) {
      try {
        res = await fetchWithRetry(doFetch, url, request(this.mode), this.options.retryDelayMs ?? 1500);
      } catch (err) {
        throw new GmError(describeNetworkError(this.label, err));
      }
      body = (await res.json().catch(() => ({}))) as ChatCompletion;
      // Another service that will not take this way of asking for JSON: the next, plainer one.
      if (this.options.lenient && (res.status === 400 || res.status === 422) && this.mode !== 'prompt') {
        this.mode = this.mode === 'schema' ? 'object' : 'prompt';
        continue;
      }
      break;
    }
    if (!res.ok) throw new GmError(describeHttpError(this.label, res.status, body.error?.message ?? ''));

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new GmError(REFUSED);
    if (choice?.finish_reason === 'length') throw new GmError(TRUNCATED);
    if (choice?.finish_reason === 'content_filter') throw new GmError(REFUSED);
    const text = choice?.message?.content ?? '';
    return this.options.lenient ? jsonFromLooseText(text, schema) : jsonFromText(text, schema);
  }
}

/** The reply's shape spelled out, for a service that cannot be held to a schema. */
function schemaInstruction(jsonSchema: object): string {
  return `## 응답 형식\n다음 JSON 스키마에 맞는 JSON 객체 하나만 답하세요. 설명, 마크다운, 코드 블록 없이 JSON만 씁니다. 스키마의 모든 필드를 빠짐없이 채우세요.\n${JSON.stringify(jsonSchema)}`;
}
