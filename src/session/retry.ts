import { GmError, isTransient, type GmErrorKind } from '../gm/errors';

/*
 * An AI asking its model again (사용자 요청): when the model is busy (rate limit, overload), too
 * slow, unreachable, or answered in the wrong shape, it waits a little and asks once more, up to
 * AI_RETRIES times. A bad key or a refusal is not asked again. docs/SPEC.md, "AI 플레이어".
 */

/** Extra tries after the first. */
export const AI_RETRIES = 3;

/** How long to wait before each extra try, by what went wrong (ms; scaled by the runner's pace). */
export const RETRY_WAIT_MS: Record<Exclude<GmErrorKind, 'other'>, readonly number[]> = {
  busy: [3000, 8000, 15000],
  network: [2000, 5000, 10000],
  slow: [1000, 2000, 3000],
  format: [0, 0, 0],
};

/** What the player is told while it asks again. */
export const RETRY_REASON: Record<Exclude<GmErrorKind, 'other'>, string> = {
  busy: '모델에 요청이 몰려',
  network: '모델에 연결하지 못해',
  slow: '모델의 응답이 너무 오래 걸려',
  format: '모델의 답이 형식에 맞지 않아',
};

/** Rejects with a "slow" GmError if `promise` takes longer than `ms` (the call itself is left to finish). */
export function timeLimited<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GmError('응답이 너무 오래 걸립니다.', 'slow')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface RetryOptions {
  /** Each try's time limit (ms). */
  timeoutMs: number;
  /** Waits scale by this (0 in tests: no waiting). */
  pace: number;
  /** False once the game moved on: no more tries. */
  stillWanted: () => boolean;
  /** Told before each extra try: what went wrong and which try it is (1..AI_RETRIES). */
  onRetry?: (kind: Exclude<GmErrorKind, 'other'>, n: number) => void;
}

/** Calls `call` until it succeeds, a non-transient error comes, the tries run out, or it is no longer wanted. */
export async function withRetries<T>(call: () => Promise<T>, { timeoutMs, pace, stillWanted, onRetry }: RetryOptions): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await timeLimited(call(), timeoutMs);
    } catch (err) {
      if (!isTransient(err) || n >= AI_RETRIES || !stillWanted()) throw err;
      const kind = err.kind as Exclude<GmErrorKind, 'other'>;
      onRetry?.(kind, n + 1);
      const wait = RETRY_WAIT_MS[kind][n] * pace;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!stillWanted()) throw err;
    }
  }
}
