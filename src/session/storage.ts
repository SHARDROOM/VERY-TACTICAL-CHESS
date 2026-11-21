import { SQUARES, withAir, withDefaultRules, type Color, type GameState } from '../engine';
import type { GmConfig } from '../ui/GmSettings';

/** What a saved game remembers about its GM: never the API key (that is kept apart, see savedGm). */
export type SavedGm =
  | { provider: 'fake' }
  | { provider: 'claude'; model: string; effort: 'low' | 'medium' | 'high' }
  | { provider: 'openai' | 'gemini'; model: string }
  | { provider: 'compatible'; model: string; baseUrl: string };

export interface SavedGame {
  version: 1;
  /** Which game this is (a resumed game keeps it): tells another device's save of the same game from a different game. */
  id?: string;
  kind: 'hotseat' | 'host';
  /** Host only: the room code, so the same room can be reopened. */
  code?: string;
  state: GameState;
  gm: SavedGm;
  savedAt: number;
  /** Host only: who sat where (guests' reconnect ids stay on this machine), so everyone gets their seat back. */
  seats?: SavedSeats;
}

/** The host's seat and the guests' (with their private reconnect ids). */
export interface SavedSeats {
  host: Color | 'spectator';
  guests: { role: Color; id: string; name: string }[];
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
    case 'compatible':
      return { provider: 'compatible', model: config.model, baseUrl: config.baseUrl };
    default:
      return { provider: config.provider, model: config.model };
  }
}

/** A GM config from a save: same provider and model, with the key this browser remembers for it (if any). */
export function gmFromSave(gm: SavedGm, keys: ApiKeys = {}): GmConfig {
  if (gm.provider === 'fake') return gm;
  if (gm.provider === 'compatible') return { ...gm, apiKey: keys.compatible?.[gm.baseUrl] ?? '' };
  return { ...gm, apiKey: keys[gm.provider] ?? '' };
}

/** API keys typed in on this browser: one per provider, and for other services one per address. */
export type ApiKeys = Partial<Record<'claude' | 'openai' | 'gemini', string>> & { compatible?: Record<string, string> };

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
  const others = raw.keys.compatible;
  if (isObj(others)) {
    const kept: Record<string, string> = {};
    for (const [url, k] of Object.entries(others)) if (typeof k === 'string' && k) kept[url] = k;
    if (Object.keys(kept).length) keys.compatible = kept;
  }
  const c = raw.current;
  if (c.provider === 'compatible' && typeof c.model === 'string' && typeof c.baseUrl === 'string') {
    return { current: { provider: 'compatible', model: c.model, baseUrl: c.baseUrl, apiKey: keys.compatible?.[c.baseUrl] ?? '' }, keys };
  }
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
  const others: Record<string, string> = {};
  for (const [url, k] of Object.entries(keys.compatible ?? {})) if (k.trim()) others[url] = k.trim();
  if (Object.keys(others).length) kept.compatible = others;
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
  if (config.provider === 'compatible') {
    const others = { ...keys.compatible };
    if (config.apiKey) others[config.baseUrl] = config.apiKey;
    else delete others[config.baseUrl];
    keys.compatible = others;
  } else if (config.provider !== 'fake') {
    if (config.apiKey) keys[config.provider] = config.apiKey;
    else delete keys[config.provider];
  }
  try {
    s.setItem(GM_KEY, JSON.stringify({ current: gmForSave(config), keys }));
  } catch {
    // blocked storage: the key just has to be typed in again next time
  }
}

/**
 * Each AI seat's own model (docs/SPEC.md, "AI의 두뇌"): the one that writes its special actions, with
 * its own key. A seat left out uses the room's GM. Kept only on this browser (the keys never leave it).
 */
export type AiBrains = Partial<Record<'white' | 'black' | 'red', GmConfig>>;
const BRAINS_KEY = 'vtc.brains.v1';
const AI_SEATS = ['white', 'black', 'red'] as const;

/** A GM config as stored (with its key), or null if it is not one. */
function readConfig(c: unknown): GmConfig | null {
  if (!isObj(c)) return null;
  if (c.provider === 'fake') return { provider: 'fake' };
  const apiKey = typeof c.apiKey === 'string' ? c.apiKey : '';
  if (c.provider === 'claude' && typeof c.model === 'string' && (c.effort === 'low' || c.effort === 'medium' || c.effort === 'high')) {
    return { provider: 'claude', model: c.model, effort: c.effort, apiKey };
  }
  if ((c.provider === 'openai' || c.provider === 'gemini') && typeof c.model === 'string') return { provider: c.provider, model: c.model, apiKey };
  if (c.provider === 'compatible' && typeof c.model === 'string' && typeof c.baseUrl === 'string') return { provider: 'compatible', model: c.model, baseUrl: c.baseUrl, apiKey };
  return null;
}

export function rememberedBrains(storage?: Storage): AiBrains {
  let raw: unknown;
  try {
    raw = JSON.parse(store(storage)?.getItem(BRAINS_KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!isObj(raw)) return {};
  const out: AiBrains = {};
  for (const seat of AI_SEATS) {
    const c = readConfig(raw[seat]);
    if (c) out[seat] = c;
  }
  return out;
}

export function rememberBrains(brains: AiBrains, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  try {
    s.setItem(BRAINS_KEY, JSON.stringify(brains));
  } catch {
    // blocked storage: the seats use the GM next time
  }
}

/** The backup GMs (예비 GM, up to three, in order), each with its own key: kept on this browser only. */
const BACKUPS_KEY = 'vtc.gm.backups.v1';

export function rememberedBackups(storage?: Storage): GmConfig[] {
  let raw: unknown;
  try {
    raw = JSON.parse(store(storage)?.getItem(BACKUPS_KEY) ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(readConfig).filter((c): c is GmConfig => c !== null && c.provider !== 'fake').slice(0, 3);
}

export function rememberBackups(backups: readonly GmConfig[], storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  try {
    if (backups.length) s.setItem(BACKUPS_KEY, JSON.stringify(backups.slice(0, 3)));
    else s.removeItem(BACKUPS_KEY);
  } catch {
    // blocked storage: no backups next time
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
    !['white', 'black', 'red'].includes(st.turn as string) ||
    !isObj(st.status) ||
    !isObj(st.ap) ||
    !isObj(st.rules) ||
    !Array.isArray(st.precedents)
  ) {
    return bad();
  }
  if (raw.kind === 'host' && typeof raw.code !== 'string') return bad();
  const game = raw as unknown as SavedGame;
  const seats = parseSeats(raw.seats) ?? legacySeats(raw.black);
  // Saves from before a rule existed get its default; from before the air, an empty air layer.
  // From before critical successes were dropped: those count as plain successes now.
  const precedents = game.state.precedents.map((p) => ((p.outcome as string) === 'critSuccess' ? { ...p, outcome: 'success' as const } : p));
  return { ...game, seats, state: { ...game.state, precedents, rules: withDefaultRules(game.state.rules), board: withAir(game.state.board, game.state.map) } };

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

const SEATS = ['white', 'black', 'red'];

function parseSeats(raw: unknown): SavedSeats | undefined {
  if (!isObj(raw) || !Array.isArray(raw.guests)) return undefined;
  const host = raw.host === 'spectator' || SEATS.includes(raw.host as string) ? (raw.host as SavedSeats['host']) : 'white';
  const guests = raw.guests
    .filter((g): g is Record<string, unknown> => isObj(g) && SEATS.includes(g.role as string) && typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({ role: g.role as Color, id: g.id as string, name: g.name as string }));
  return { host, guests };
}

/** Saves from before seats were chosen: the host was white, the guest who played black is kept. */
function legacySeats(black: unknown): SavedSeats | undefined {
  if (!isObj(black) || typeof black.id !== 'string' || typeof black.name !== 'string') return undefined;
  return { host: 'white', guests: [{ role: 'black', id: black.id, name: black.name }] };
}
