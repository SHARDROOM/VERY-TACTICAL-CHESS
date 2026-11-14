import type { GameState } from '../engine';
import type { GmConfig } from '../ui/GmSettings';

/** What we remember about a GM between visits: never the API key. */
export type SavedGm =
  | { provider: 'fake' }
  | { provider: 'claude'; model: string; effort: 'low' | 'medium' | 'high' }
  | { provider: 'openai' | 'gemini'; model: string };

export interface SavedGame {
  version: 1;
  kind: 'hotseat' | 'host';
  /** Host only: the room code, so the same room can be reopened. */
  code?: string;
  state: GameState;
  gm: SavedGm;
  savedAt: number;
}

const KEY = 'vtc.save.v1';

/** Storage can be missing or throw (private mode, blocked site data): every call is guarded. */
function store(storage?: Storage): Storage | null {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function gmForSave(config: GmConfig): SavedGm {
  switch (config.provider) {
    case 'fake':
      return { provider: 'fake' };
    case 'claude':
      return { provider: 'claude', model: config.model, effort: config.effort };
    default:
      return { provider: config.provider, model: config.model };
  }
}

/** A GM config from a save: same provider and model, but the key must be typed in again. */
export function gmFromSave(gm: SavedGm): GmConfig {
  return gm.provider === 'fake' ? gm : { ...gm, apiKey: '' };
}

export function saveGame(game: Omit<SavedGame, 'version' | 'savedAt'>, storage?: Storage, now = Date.now()): void {
  const s = store(storage);
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ version: 1, savedAt: now, ...game } satisfies SavedGame));
  } catch {
    // Quota or blocked storage: saving is a convenience, the game goes on.
  }
}

export function clearSavedGame(storage?: Storage): void {
  try {
    store(storage)?.removeItem(KEY);
  } catch {
    // ignore
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Loads the saved game if it looks sane; anything else is discarded. */
export function loadSavedGame(storage?: Storage): SavedGame | null {
  const s = store(storage);
  if (!s) return null;
  let raw: unknown;
  try {
    const text = s.getItem(KEY);
    if (!text) return null;
    raw = JSON.parse(text);
  } catch {
    clearSavedGame(storage);
    return null;
  }
  if (!isObj(raw) || raw.version !== 1 || (raw.kind !== 'hotseat' && raw.kind !== 'host') || !isObj(raw.gm)) return bad();
  const st = raw.state;
  if (
    !isObj(st) ||
    !Array.isArray(st.board) ||
    st.board.length !== 64 ||
    (st.turn !== 'white' && st.turn !== 'black') ||
    !isObj(st.status) ||
    !isObj(st.ap) ||
    !isObj(st.rules) ||
    !Array.isArray(st.precedents)
  ) {
    return bad();
  }
  if (raw.kind === 'host' && typeof raw.code !== 'string') return bad();
  return raw as unknown as SavedGame;

  function bad() {
    clearSavedGame(storage);
    return null;
  }
}

/** A random id for this browser, kept so a guest who comes back is recognised by the host. */
export function browserId(storage?: Storage): string {
  const s = store(storage);
  const make = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  if (!s) return make();
  try {
    const existing = s.getItem('vtc.browserId');
    if (existing && /^[a-f0-9]{24}$/.test(existing)) return existing;
    const id = make();
    s.setItem('vtc.browserId', id);
    return id;
  } catch {
    return make();
  }
}
