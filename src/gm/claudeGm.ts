import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { ChaosRequest, GameMaster, GmChaosJson, GmRequest, GmRulingJson } from './types';
import { GmChaosSchema, GmRulingSchema } from './schema';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';
import { GmError } from './errors';
import { REFUSED, TRUNCATED, jsonFromText } from './llmReply';

export { GmError };

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본, 가장 정확)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (더 저렴)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴하고 빠름)' },
] as const;

export type GmEffort = 'low' | 'medium' | 'high';

export interface ClaudeGmOptions {
  apiKey: string;
  model: string;
  /** How hard the model thinks. Rulings are short and players are waiting, so `low` is the default. */
  effort: GmEffort;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/**
 * GM backed by the Claude Messages API, called straight from the host's browser
 * with the host's own key (BYOK). The key only ever lives in this object.
 */
export class ClaudeGameMaster implements GameMaster {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(private readonly options: ClaudeGmOptions) {
    this.name = `Claude GM (${options.model})`;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // BYOK in a static site: there is no server to hold the key. It stays in this tab's memory.
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: 90_000,
      ...(options.fetch && { fetch: options.fetch }),
    });
  }

  rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    return this.ask(buildSystemPrompt(state.rules), buildUserMessage(action, state), GmRulingSchema);
  }

  chaos({ state, inspiration, problem }: ChaosRequest): Promise<GmChaosJson> {
    return this.ask(buildChaosSystemPrompt(state.rules), buildChaosUserMessage(state, inspiration, problem), GmChaosSchema);
  }

  private async ask<T extends z.ZodTypeAny>(system: string, user: string, schema: T): Promise<z.infer<T>> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.options.model,
        max_tokens: 16000,
        // If the model declines on policy grounds, let the API retry on its default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: this.options.effort, format: betaZodOutputFormat(schema) },
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      throw new GmError(describeApiError(err));
    }

    if (response.stop_reason === 'refusal') throw new GmError(REFUSED);
    if (response.stop_reason === 'max_tokens') throw new GmError(TRUNCATED);
    // Read content only after the stop reason says it is complete.
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return jsonFromText(text, schema);
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않습니다. GM 설정에서 키를 확인해 주세요.';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 선택한 모델을 쓸 수 없습니다.';
  if (err instanceof Anthropic.NotFoundError) return '선택한 모델을 찾을 수 없습니다. GM 설정에서 다른 모델을 골라 주세요.';
  if (err instanceof Anthropic.RateLimitError) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (err instanceof Anthropic.BadRequestError) return `GM 요청이 거부되었습니다 (${err.message}).`;
  if (err instanceof Anthropic.InternalServerError) return 'Claude 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'GM 응답이 너무 오래 걸립니다. 다시 시도해 주세요.';
  if (err instanceof Anthropic.APIConnectionError) return 'Claude API에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  if (err instanceof Anthropic.APIError) return `Claude API 오류 ${err.status ?? ''}: ${err.message}`;
  return `GM 호출 중 오류: ${err instanceof Error ? err.message : String(err)}`;
}
