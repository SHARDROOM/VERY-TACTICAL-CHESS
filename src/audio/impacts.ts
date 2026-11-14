/**
 * Finds the moments a recorded rigid body hit something, from its positions alone:
 * wherever its velocity changed by much more than gravity explains. Used to time
 * dice clacks and coin clinks to the physics playback.
 */
export function findImpacts(
  frames: Float32Array,
  dt: number,
  gravity: number,
  options: { stride?: number; threshold?: number; minGap?: number; fullScale?: number } = {},
): { step: number; strength: number }[] {
  const stride = options.stride ?? 7;
  const threshold = options.threshold ?? 0.9;
  const minGap = options.minGap ?? 4;
  const fullScale = options.fullScale ?? 6;
  const n = Math.floor(frames.length / stride);
  const out: { step: number; strength: number }[] = [];
  let prev: [number, number, number] | null = null;
  for (let i = 1; i < n; i++) {
    const v: [number, number, number] = [0, 1, 2].map((k) => (frames[i * stride + k] - frames[(i - 1) * stride + k]) / dt) as [number, number, number];
    if (prev) {
      const dx = v[0] - prev[0];
      const dy = v[1] - prev[1] + gravity * dt; // remove the expected fall
      const dz = v[2] - prev[2];
      const change = Math.hypot(dx, dy, dz);
      if (change > threshold) {
        const last = out[out.length - 1];
        const strength = Math.min(1, change / fullScale);
        if (last && i - last.step < minGap) last.strength = Math.max(last.strength, strength);
        else out.push({ step: i, strength });
      }
    }
    prev = v;
  }
  return out;
}
