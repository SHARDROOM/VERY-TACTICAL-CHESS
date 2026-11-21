import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CloudState, CloudSync, GameSummary } from '../cloud/sync';
import { Icon } from './Icon';

/*
 * Google 로그인과 Drive 저장, on screen (docs/SPEC.md): the account button in the lobby's corner,
 * the account section of the settings menu, and the two questions the sync may ask (the passphrase
 * for the API keys, and which game to keep). Without a Google client id in the build, none of it
 * shows.
 */

export const CloudContext = createContext<CloudSync | null>(null);

const NO_STATE: CloudState = { status: 'signedOut', email: null, error: null, passphrase: null, conflict: null, lastSynced: null };
const noop = () => () => {};

export function useCloud(): { cloud: CloudSync; state: CloudState } | null {
  const cloud = useContext(CloudContext);
  const subscribe = useCallback((l: () => void) => (cloud ? cloud.subscribe(l) : noop()), [cloud]);
  const state = useSyncExternalStore(subscribe, () => cloud?.state ?? NO_STATE);
  return cloud ? { cloud, state } : null;
}

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

type Tone = 'ok' | 'busy' | 'warn';

/** The one thing to say about the account now, most pressing first. */
function headline(state: CloudState): { short: string; long: string; tone: Tone } {
  switch (state.status) {
    case 'connecting':
      return { short: '연결 중', long: 'Google에 연결하는 중…', tone: 'busy' };
    case 'expired':
      return { short: '다시 연결', long: 'Google 연결이 끝났습니다. 다시 연결하면 바뀐 내용을 이어서 저장합니다.', tone: 'warn' };
    default:
  }
  if (state.conflict) return { short: '게임 고르기', long: '이 기기와 Drive에 서로 다른 게임이 있습니다. 어느 쪽을 남길지 골라 주세요.', tone: 'warn' };
  if (state.passphrase) {
    return state.passphrase === 'enter'
      ? { short: '암호 필요', long: 'API 키 암호를 입력하면 다른 기기의 API 키를 받아옵니다. 키를 뺀 나머지는 이미 저장하고 있습니다.', tone: 'warn' }
      : { short: '암호 필요', long: 'API 키 암호를 정하면 API 키도 Drive에 저장합니다. 키를 뺀 나머지는 이미 저장하고 있습니다.', tone: 'warn' };
  }
  if (state.status === 'error') return { short: '저장 실패', long: `${state.error ?? '저장하지 못했습니다.'} 잠시 뒤 다시 시도합니다.`, tone: 'warn' };
  if (state.status === 'saving') return { short: '올리는 중', long: '바뀐 내용을 Drive에 올리는 중…', tone: 'busy' };
  return { short: '저장됨', long: `Drive에 저장됨${state.lastSynced ? ` · ${ago(state.lastSynced)}` : ''}`, tone: 'ok' };
}

const MARK: Record<Tone, string> = { ok: '✓', busy: '⟳', warn: '⚠' };

/** Every few seconds a fresh "n분 전". */
function useMinuteClock() {
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
}

/** The account's lines and actions (the lobby's account menu and the settings menu share them). */
export function CloudSection({ onAction }: { onAction?: () => void }) {
  const c = useCloud();
  useMinuteClock();
  if (!c) return null;
  const { cloud, state } = c;
  const act = (f: () => void) => () => {
    f();
    onAction?.();
  };
  if (state.status === 'signedOut') {
    return (
      <section className="cloud-section">
        <h3>Google 계정</h3>
        <div className="menu-note">로그인하면 GM 설정과 API 키, 저장된 게임을 내 Google Drive에 보관하고 다른 기기에서 불러옵니다. 로그인하지 않아도 모든 기능을 쓸 수 있습니다.</div>
        {state.error && <div className="menu-note cloud-warn">{state.error}</div>}
        <button onClick={() => void cloud.connect()}>Google로 로그인</button>
      </section>
    );
  }
  const head = headline(state);
  const connected = state.status !== 'expired' && state.status !== 'connecting';
  const signOut = async (wipe: boolean) => {
    if (wipe && !confirm('이 기기에 저장된 GM 설정, API 키, 저장된 게임을 지우고 로그아웃할까요? Drive에 저장된 것은 남습니다.')) return;
    const result = await cloud.signOut(wipe);
    if (result === 'unsynced' && confirm('아직 Drive에 올리지 못한 내용이 있습니다(암호를 정하지 않은 API 키 등). 그래도 이 기기에서 지울까요?')) await cloud.signOut(true, true);
  };
  return (
    <section className="cloud-section">
      <h3>Google 계정</h3>
      {state.email && <div className="cloud-email">{state.email}</div>}
      <div className={`menu-note cloud-line ${head.tone}`}>
        <span aria-hidden>{MARK[head.tone]}</span> {head.long}
      </div>
      {state.status === 'expired' && <button onClick={() => void cloud.connect()}>다시 연결</button>}
      {state.status === 'error' && state.error && <div className="menu-note">{state.error}</div>}
      {state.conflict && <button onClick={act(() => window.dispatchEvent(new Event(ASK_AGAIN)))}>어느 게임을 이어 할지 고르기</button>}
      {state.passphrase && <button onClick={act(() => window.dispatchEvent(new Event(ASK_AGAIN)))}>{state.passphrase === 'enter' ? 'API 키 암호 입력' : 'API 키 암호 정하기'}</button>}
      {connected && (
        <button onClick={() => void cloud.sync()} disabled={state.status === 'saving'}>
          지금 저장
        </button>
      )}
      <button onClick={act(() => void signOut(false))}>로그아웃</button>
      <button className="danger" onClick={act(() => void signOut(true))}>
        이 기기에서 지우고 로그아웃
      </button>
      <div className="menu-note">로그아웃해도 이 기기의 설정과 게임은 그대로 남습니다.</div>
    </section>
  );
}

/** The account in the lobby's corner: "Google로 로그인", or the account's initial and how its saving goes. */
export function CloudButton() {
  const c = useCloud();
  const [open, setOpen] = useState(false);
  if (!c) return null;
  const { cloud, state } = c;
  if (state.status === 'signedOut') {
    return (
      <button className="cloud-chip signed-out" onClick={() => void cloud.connect()} title="Google로 로그인: GM 설정, API 키, 저장된 게임을 내 Drive에 보관" aria-label="Google로 로그인">
        <Icon name="cloud" />
        <span className="label">로그인</span>
      </button>
    );
  }
  const head = headline(state);
  const initial = (state.email?.[0] ?? 'G').toUpperCase();
  return (
    <>
      <button
        className={`cloud-chip ${head.tone}`}
        onClick={() => (state.status === 'expired' ? void cloud.connect() : setOpen(true))}
        aria-haspopup="menu"
        title={`${state.email ?? 'Google 계정'} · ${head.short}`}
      >
        <span className="cloud-avatar" aria-hidden>
          {initial}
          <span className={`cloud-badge ${head.tone}`}>{MARK[head.tone]}</span>
        </span>
        <span className="label">{head.short}</span>
      </button>
      {open &&
        createPortal(
          <div className="menu-backdrop" onClick={() => setOpen(false)}>
            <div className="settings-menu cloud-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <CloudSection onAction={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** "Ask me again": the passphrase or game question put off with "나중에" comes back. */
const ASK_AGAIN = 'vtc-cloud-ask';

function summaryLine(g: GameSummary): string {
  const where = g.kind === 'host' ? `온라인 방 ${g.code ?? ''}`.trim() : g.kind === 'hotseat' ? '한 화면 게임' : '게임';
  const parts = [where];
  if (g.turn !== null) parts.push(`턴 ${g.turn}`);
  if (g.savedAt !== null) parts.push(ago(g.savedAt));
  return parts.join(', ');
}

/** The questions the sync asks: the passphrase for the API keys, and which game to keep. */
export function CloudDialogs() {
  const c = useCloud();
  const [later, setLater] = useState<{ passphrase: string | null; conflict: unknown }>({ passphrase: null, conflict: null });
  useEffect(() => {
    const again = () => setLater({ passphrase: null, conflict: null });
    window.addEventListener(ASK_AGAIN, again);
    return () => window.removeEventListener(ASK_AGAIN, again);
  }, []);
  if (!c) return null;
  const { cloud, state } = c;
  if (state.conflict && later.conflict !== state.conflict) {
    return createPortal(<ConflictDialog cloud={cloud} conflict={state.conflict} onLater={() => setLater((l) => ({ ...l, conflict: state.conflict }))} />, document.body);
  }
  if (state.passphrase && later.passphrase !== state.passphrase) {
    return createPortal(<PassphraseDialog key={state.passphrase} cloud={cloud} mode={state.passphrase} onLater={() => setLater((l) => ({ ...l, passphrase: state.passphrase }))} />, document.body);
  }
  return null;
}

const MIN_PASSPHRASE = 6;

function PassphraseDialog({ cloud, mode, onLater }: { cloud: CloudSync; mode: 'set' | 'enter'; onLater: () => void }) {
  const [text, setText] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'set') {
      if (text.length < MIN_PASSPHRASE) return setError(`암호는 ${MIN_PASSPHRASE}자 이상으로 정해 주세요.`);
      if (text !== again) return setError('두 번 입력한 암호가 다릅니다.');
    }
    setWorking(true);
    setError(null);
    const ok = await cloud.setPassphrase(text);
    setWorking(false);
    if (!ok) setError('암호가 맞지 않습니다.');
  };
  const forgot = () => {
    if (confirm('Drive에 저장된 API 키를 버리고, 이 기기의 API 키를 새 암호로 잠가 올릴까요? 다른 기기에서는 새 암호를 한 번 입력해야 합니다.')) cloud.resetKeys();
  };
  return (
    <div className="overlay">
      <form className="dialog cloud-dialog" onSubmit={(e) => void submit(e)}>
        <h2>{mode === 'set' ? 'API 키 암호 정하기' : 'API 키 암호 입력'}</h2>
        {mode === 'set' ? (
          <p>API 키는 이 암호로 잠근 뒤 Drive에 올립니다. 다른 기기에서 처음 로그인할 때 한 번 입력하면 됩니다. 암호는 어디에도 저장되지 않으니 잊지 않게 적어 두세요.</p>
        ) : (
          <p>다른 기기에서 정한 암호를 입력하면 그 기기의 API 키를 받아옵니다. 이 기기에서는 다시 묻지 않습니다.</p>
        )}
        <label className="cloud-field">
          <span>암호</span>
          <input type="password" value={text} onChange={(e) => setText(e.target.value)} autoComplete={mode === 'set' ? 'new-password' : 'current-password'} autoFocus disabled={working} />
        </label>
        {mode === 'set' && (
          <label className="cloud-field">
            <span>한 번 더</span>
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" disabled={working} />
          </label>
        )}
        {error && <p className="cloud-warn">{error}</p>}
        <div className="choice-row">
          <button type="submit" className="primary" disabled={working || !text}>
            {working ? '잠그는 중…' : mode === 'set' ? '암호 정하기' : '키 받아오기'}
          </button>
          <button type="button" onClick={onLater} disabled={working}>
            나중에
          </button>
        </div>
        {mode === 'enter' && (
          <button type="button" className="link" onClick={forgot} disabled={working}>
            암호를 잊었어요 (키 초기화)
          </button>
        )}
      </form>
    </div>
  );
}

function ConflictDialog({ cloud, conflict, onLater }: { cloud: CloudSync; conflict: NonNullable<CloudState['conflict']>; onLater: () => void }) {
  return (
    <div className="overlay">
      <div className="dialog cloud-dialog" role="dialog" aria-labelledby="cloud-conflict-title">
        <h2 id="cloud-conflict-title">어느 게임을 이어 할까요?</h2>
        <p>이 기기와 Drive에 서로 다른 게임이 저장되어 있습니다. 저장 칸은 하나라서 고른 게임만 남습니다.</p>
        <div className="cloud-games">
          <button onClick={() => cloud.resolveConflict('local')}>
            <strong>이 기기의 게임</strong>
            <span>{summaryLine(conflict.local)}</span>
          </button>
          <button onClick={() => cloud.resolveConflict('cloud')}>
            <strong>Drive의 게임</strong>
            <span>{summaryLine(conflict.cloud)}</span>
          </button>
        </div>
        <button className="link" onClick={onLater}>
          나중에 고르기
        </button>
      </div>
    </div>
  );
}
