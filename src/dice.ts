/** Uniform d20 from the platform's cryptographic RNG (rejection sampling avoids modulo bias). */
export function rollD20(): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 20) * 20;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % 20) + 1;
  }
}

/** Probability that a d20 roll meets or beats `dc`. */
export function successChance(dc: number): number {
  return Math.min(1, Math.max(0, (21 - dc) / 20));
}
