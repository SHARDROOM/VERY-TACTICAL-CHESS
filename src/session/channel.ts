/** A message pipe to the other player. Messages are plain JSON values. */
export interface Channel {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/** Two connected in-memory channels (tests and local experiments). Delivery is async, like a network. */
export function memoryChannelPair(): [Channel, Channel] {
  type End = { listeners: ((m: unknown) => void)[]; closeListeners: (() => void)[]; closed: boolean };
  const a: End = { listeners: [], closeListeners: [], closed: false };
  const b: End = { listeners: [], closeListeners: [], closed: false };
  const make = (me: End, other: End): Channel => ({
    send(message) {
      if (me.closed) return;
      // Copy through JSON like a real wire, so nothing shares references.
      const copy = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => {
        if (!other.closed) other.listeners.forEach((l) => l(copy));
      });
    },
    onMessage: (l) => void me.listeners.push(l),
    onClose: (l) => void me.closeListeners.push(l),
    close() {
      if (me.closed) return;
      me.closed = true;
      other.closed = true;
      queueMicrotask(() => {
        me.closeListeners.forEach((l) => l());
        other.closeListeners.forEach((l) => l());
      });
    },
  });
  return [make(a, b), make(b, a)];
}
