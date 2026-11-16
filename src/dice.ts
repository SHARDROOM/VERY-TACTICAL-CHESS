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

/** Probability that an attempt succeeds: the roll must reach the DC, and a natural 1 never does. */
export function successChance(dc: number): number {
  let wins = 0;
  for (let roll = 1; roll <= DIE_SIDES; roll++) if (roll !== 1 && roll >= dc) wins++;
  return wins / DIE_SIDES;
}
