import { useEffect, useState } from 'react';

/**
 * How much of the GM's staging to draw: "rich" (everything) or "light" (fewer particles, no
 * shake) for slow devices. Remembered in this browser; the first default depends on the screen.
 * docs/SPEC.md, "GM 연출" (성능).
 */
export type StagingLook = 'rich' | 'light';

const KEY = 'vtc.stagingLook';
const listeners = new Set<(look: StagingLook) => void>();

/** Phones and other narrow screens start light; everything else starts rich. */
export function defaultLook(width: number): StagingLook {
  return width <= 600 ? 'light' : 'rich';
}

function load(): StagingLook {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'rich' || saved === 'light') return saved;
  } catch {
    // no storage: use the default
  }
  return defaultLook(typeof window === 'undefined' ? 1200 : Math.min(window.innerWidth, window.screen?.width ?? window.innerWidth));
}

let current: StagingLook = load();

export function getStagingLook(): StagingLook {
  return current;
}

export function setStagingLook(look: StagingLook): void {
  current = look;
  try {
    localStorage.setItem(KEY, look);
  } catch {
    // a remembered preference is only a convenience
  }
  listeners.forEach((l) => l(look));
}

/** Takes the remembered look up again (it came from another device). */
export function reloadStagingLook(): void {
  const look = load();
  if (look !== current) setStagingLook(look);
}

export function useStagingLook(): StagingLook {
  const [look, setLook] = useState(current);
  useEffect(() => {
    listeners.add(setLook);
    return () => void listeners.delete(setLook);
  }, []);
  return look;
}

/** The device asks for less motion: never shake the screen. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
