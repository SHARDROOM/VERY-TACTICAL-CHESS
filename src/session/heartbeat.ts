import type { Channel } from './channel';

/**
 * A slow safety net for a peer that vanished without a goodbye and without the
 * WebRTC connection failing. Pings every `intervalMs` and closes the channel after
 * `timeoutMs` of total silence. The timeout is deliberately long: browsers throttle
 * timers in background tabs to as little as once a minute, and a player who just
 * switched tabs must not be kicked out. Fast detection comes from elsewhere: a
 * goodbye on page hide, and WebRTC's own ICE failure (about 30 s).
 * Call `seen()` whenever any message arrives.
 */
export function startHeartbeat(channel: Channel, intervalMs: number, timeoutMs = 180_000): { seen(): void; stop(): void } {
  if (intervalMs <= 0) return { seen() {}, stop() {} };
  let last = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - last > timeoutMs) {
      clearInterval(timer);
      channel.close();
      return;
    }
    channel.send({ t: 'ping' });
  }, intervalMs);
  return {
    seen: () => {
      last = Date.now();
    },
    stop: () => clearInterval(timer),
  };
}
