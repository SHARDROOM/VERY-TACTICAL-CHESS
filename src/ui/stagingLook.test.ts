import { describe, expect, it } from 'vitest';
import { defaultLook } from './stagingLook';

describe('staging look default', () => {
  it('phones start light, wider screens rich', () => {
    expect(defaultLook(390)).toBe('light');
    expect(defaultLook(600)).toBe('light');
    expect(defaultLook(1280)).toBe('rich');
  });
});
