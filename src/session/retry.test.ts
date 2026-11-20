import { describe, expect, it } from 'vitest';
import { GmError } from '../gm/errors';
import { withRetries } from './retry';

describe('asking a model again (retry.ts)', () => {
  it('asks again on a busy model, but starts no try past the deadline', async () => {
    let clock = 0;
    let calls = 0;
    const busy = () => {
      calls++;
      clock += 5000; // each refusal takes 5 s
      return Promise.reject(new GmError('busy', 'busy'));
    };
    // No waiting here (pace 0): tries at 0, 5 and 10 s; at 15 s the deadline is reached, so not a fourth.
    await expect(withRetries(busy, { timeoutMs: 20_000, pace: 0, stillWanted: () => true, deadline: 15_000, now: () => clock })).rejects.toThrow('busy');
    expect(calls).toBe(3);
  });

  it('a bad key or a refusal is not asked again', async () => {
    let calls = 0;
    const bad = () => (calls++, Promise.reject(new GmError('key', 'other')));
    await expect(withRetries(bad, { timeoutMs: 1000, pace: 0, stillWanted: () => true })).rejects.toThrow('key');
    expect(calls).toBe(1);
  });
});
