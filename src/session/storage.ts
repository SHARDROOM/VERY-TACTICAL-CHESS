import { SQUARES, withAir, withDefaultRules, type GameState } from '../engine';
import type { GmConfig } from '../ui/GmSettings';

/** What a saved game remembers about its GM: never the API key (that is kept apart, see savedGm). */
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
  /** Host only: who sat at black (their reconnect id stays on this machine), so they get the seat back. */
  black?: { id: string; name: string };
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

/** A GM config from a save: same provider and model, with the key this browser remembers for it (if any). */
export function gmFromSave(gm: SavedGm, keys: ApiKeys = {}): GmConfig {
  return gm.provider === 'fake' ? gm : { ...gm, apiKey: keys[gm.provider] ?? '' };
}

/** API keys typed in on this browser, one per provider. */
export type ApiKeys = Partial<Record<'claude' | 'openai' | 'gemini', string>>;

/** The GM last chosen on this browser and every key typed in: kept only here, never sent to anyone. */
export interface RememberedGm {
  current: GmConfig;
  keys: ApiKeys;
}

const GM_KEY = 'vtc.gm.v1';
const PROVIDERS = ['claude', 'openai', 'gemini'] as const;

export function rememberedGm(storage?: Storage): RememberedGm {
  const none: RememberedGm = { current: { provider: 'fake' }, keys: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(store(storage)?.getItem(GM_KEY) ?? 'null');
  } catch {
    return none;
  }
  if (!isObj(raw) || !isObj(raw.current) || !isObj(raw.keys)) return none;
  const keys: ApiKeys = {};
  for (const p of PROVIDERS) if (typeof raw.keys[p] === 'string' && raw.keys[p]) keys[p] = raw.keys[p] as string;
  const c = raw.current;
  if (c.provider === 'claude' && typeof c.model === 'string' && (c.effort === 'low' || c.effort === 'medium' || c.effort === 'high')) {
    return { current: { provider: 'claude', model: c.model, effort: c.effort, apiKey: keys.claude ?? '' }, keys };
  }
  if ((c.provider === 'openai' || c.provider === 'gemini') && typeof c.model === 'string') {
    return { current: { provider: c.provider, model: c.model, apiKey: keys[c.provider] ?? '' }, keys };
  }
  return { current: { provider: 'fake' }, keys };
}

/** Remembers the keys as typed in the GM settings (an emptied one is forgotten). */
export function rememberKeys(keys: ApiKeys, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  const { current } = rememberedGm(storage);
  const kept: ApiKeys = {};
  for (const p of PROVIDERS) if (keys[p]?.trim()) kept[p] = keys[p]!.trim();
  try {
    s.setItem(GM_KEY, JSON.stringify({ current: gmForSave(current), keys: kept }));
  } catch {
    // blocked storage
  }
}

/** Remembers the chosen GM and its key. */
export function rememberGm(config: GmConfig, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  const { keys } = rememberedGm(storage);
  if (config.provider !== 'fake') {
    if (config.apiKey) keys[config.provider] = config.apiKey;
    else delete keys[config.provider];
  }
  try {
    s.setItem(GM_KEY, JSON.stringify({ current: gmForSave(config), keys }));
  } catch {
    // blocked storage: the key just has to be typed in again next time
  }
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
    (st.board.length !== 64 && st.board.length !== SQUARES) ||
    (st.turn !== 'white' && st.turn !== 'black') ||
    !isObj(st.status) ||
    !isObj(st.ap) ||
    !isObj(st.rules) ||
    !Array.isArray(st.precedents)
  ) {
    return bad();
  }
  if (raw.kind === 'host' && typeof raw.code !== 'string') return bad();
  const game = raw as unknown as SavedGame;
  const black = isObj(raw.black) && typeof raw.black.id === 'string' && typeof raw.black.name === 'string' ? { id: raw.black.id, name: raw.black.name } : undefined;
  // Saves from before a rule existed get its default; from before the air, an empty air layer.
  // From before critical successes were dropped: those count as plain successes now.
  const precedents = game.state.precedents.map((p) => ((p.outcome as string) === 'critSuccess' ? { ...p, outcome: 'success' as const } : p));
  return { ...game, black, state: { ...game.state, precedents, rules: withDefaultRules(game.state.rules), board: withAir(game.state.board) } };

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

/** The name this browser uses in rooms (empty: let the room pick one). */
export function savedName(storage?: Storage): string {
  try {
    return store(storage)?.getItem('vtc.name') ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string, storage?: Storage): void {
  try {
    store(storage)?.setItem('vtc.name', name);
  } catch {
    // ignore
  }
}
