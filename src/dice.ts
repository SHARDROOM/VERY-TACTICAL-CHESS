/** Uniform d20 from the platform's cryptographic RNG (rejection sampling avoids modulo bias). */
export function rollD20(): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 20) * 20;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % 20) + 1;
  }
}

/** Probability that an attempt succeeds: a natural 20 always does, a natural 1 never does. */
export function successChance(dc: number): number {
  let wins = 0;
  for (let roll = 1; roll <= 20; roll++) if (roll === 20 || (roll !== 1 && roll >= dc)) wins++;
  return wins / 20;
}
