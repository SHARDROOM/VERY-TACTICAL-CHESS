import { DIE_SIDES } from './engine';

/** Uniform d6 from the platform's cryptographic RNG (rejection sampling avoids modulo bias). */
export function rollDie(): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / DIE_SIDES) * DIE_SIDES;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % DIE_SIDES) + 1;
  }
}

/**
 * Probability that an attempt succeeds: two dice must add up to the DC, and snake eyes (1 and 1)
 * never do.
 */
export function successChance(dc: number): number {
  let wins = 0;
  for (let a = 1; a <= DIE_SIDES; a++) for (let b = 1; b <= DIE_SIDES; b++) if (a + b !== 2 && a + b >= dc) wins++;
  return wins / (DIE_SIDES * DIE_SIDES);
}
