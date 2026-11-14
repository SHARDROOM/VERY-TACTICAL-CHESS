/** An error whose message is already written for the player. */
export class GmError extends Error {}

/** Player-facing text for an HTTP failure from any LLM provider. */
export function describeHttpError(provider: string, status: number, detail: string): string {
  const d = detail ? ` (${detail})` : '';
  if (status === 401) return `${provider} API 키가 올바르지 않습니다. GM 설정에서 키를 확인해 주세요.`;
  if (status === 403) return `이 ${provider} API 키로는 선택한 모델을 쓸 수 없습니다.${d}`;
  if (status === 404) return `선택한 ${provider} 모델을 찾을 수 없습니다. GM 설정에서 모델 이름을 확인해 주세요.${d}`;
  if (status === 429) return `${provider} 요청 한도나 크레딧이 부족합니다. 잠시 후 다시 시도하거나 사용량을 확인해 주세요.${d}`;
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
