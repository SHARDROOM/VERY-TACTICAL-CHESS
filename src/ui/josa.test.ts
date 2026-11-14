import { describe, expect, it } from 'vitest';
import { josa } from './josa';

describe('josa', () => {
  it.each([
    ['나이트', '을/를', '나이트를'],
    ['폰', '을/를', '폰을'],
    ['백', '이/가', '백이'],
    ['퀸', '으로/로', '퀸으로'],
    ['나이트', '으로/로', '나이트로'],
    ['e1', '으로/로', 'e1로'],
    ['e3', '으로/로', 'e3으로'],
    ['e4', '으로/로', 'e4로'],
    ['e6', '으로/로', 'e6으로'],
    ['e8', '으로/로', 'e8로'],
    ['룰', '으로/로', '룰로'],
  ] as const)('%s + %s → %s', (word, pair, expected) => {
    expect(josa(word, pair)).toBe(expected);
  });
});
