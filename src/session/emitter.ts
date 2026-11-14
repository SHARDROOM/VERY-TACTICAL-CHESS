import type { SessionEvent } from './types';

export class Emitter {
  private listeners = new Set<(e: SessionEvent) => void>();
  /** Events emitted before anyone subscribed (e.g. a welcome that beat the screen to it). */
  private backlog: SessionEvent[] = [];

  subscribe(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    const missed = this.backlog;
    this.backlog = [];
    missed.forEach((e) => listener(e));
    return () => this.listeners.delete(listener);
  }

  emit(e: SessionEvent): void {
    if (this.listeners.size === 0) {
      if (e.kind !== 'view') this.backlog.push(e);
      return;
    }
    this.listeners.forEach((l) => l(e));
  }
}
