/**
 * What went wrong, for deciding whether to ask again (an AI asks again on its own): the model is
 * busy (rate limit, overload, a server hiccup), slow (timed out), unreachable, or its reply was
 * malformed; anything else (a bad key, a refusal) stays as it is.
 */
export type GmErrorKind = 'busy' | 'slow' | 'network' | 'format' | 'other';

/** An error whose message is already written for the player. */
export class GmError extends Error {
  constructor(
    message: string,
    readonly kind: GmErrorKind = 'other',
  ) {
    super(message);
  }
}

/** Worth asking again in a moment. */
export const isTransient = (err: unknown): err is GmError => err instanceof GmError && err.kind !== 'other';

/** An HTTP failure from any LLM provider, as a GmError of the right kind. */
export function httpError(provider: string, status: number, detail: string): GmError {
  return new GmError(describeHttpError(provider, status, detail), status === 429 || status >= 500 ? 'busy' : 'other');
}

/** A fetch that never got an HTTP response, as a GmError of the right kind. */
export function networkError(provider: string, err: unknown): GmError {
  const slow = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return new GmError(describeNetworkError(provider, err), slow ? 'slow' : 'network');
}

/** Player-facing text for an HTTP failure from any LLM provider. */
export function describeHttpError(provider: string, status: number, detail: string): string {
  const d = detail ? ` (${detail})` : '';
  if (status === 401) return `${provider} API 키가 올바르지 않습니다. GM 설정에서 키를 확인해 주세요.`;
  if (status === 403) return `이 ${provider} API 키로는 선택한 모델을 쓸 수 없습니다.${d}`;
  if (status === 404) return `선택한 ${provider} 모델을 찾을 수 없습니다. GM 설정에서 모델 이름을 확인해 주세요.${d}`;
  if (status === 429) return `${provider} 요청 한도나 크레딧이 부족합니다. 잠시 후 다시 시도하거나 사용량을 확인해 주세요.${d}`;
  if (status === 503 || status === 529) return `${provider}의 이 모델에 지금 요청이 몰려 있습니다. 잠시 후 다시 시도하거나 GM 설정에서 다른 모델을 골라 보세요.`;
  if (status >= 500) return `${provider} 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.`;
  return `${provider} 요청이 거부되었습니다 (HTTP ${status})${d}.`;
}

/** Player-facing text for a fetch that never got an HTTP response. */
export function describeNetworkError(provider: string, err: unknown): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `${provider} GM 응답이 너무 오래 걸립니다. 다시 시도해 주세요.`;
  }
  return `${provider} API에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.`;
}

/** Statuses worth one more try after a short wait (busy or briefly broken servers). */
export const RETRYABLE = new Set([500, 502, 503, 504, 529]);

/** POSTs once more after `delayMs` if the server was busy; any other answer is returned as is. */
export async function fetchWithRetry(doFetch: typeof fetch, url: string, init: () => RequestInit, delayMs: number): Promise<Response> {
  const first = await doFetch(url, init());
  if (!RETRYABLE.has(first.status)) return first;
  await new Promise((r) => setTimeout(r, delayMs));
  return doFetch(url, init());
}
