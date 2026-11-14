import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { normalizeRoomCode } from '../session/peerTransport';
import type { SavedGame } from '../session/storage';
import type { TourInset } from '../scene/TourCamera';
import { LobbyBackdrop } from './LobbyBackdrop';
import { SettingsMenu, useFullscreen } from './SettingsMenu';

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

interface Props {
  busy: string | null;
  error: string | null;
  saved: SavedGame | null;
  onResume: () => void;
  onDiscard: () => void;
  onHotseat: () => void;
  onHost: () => void;
  onJoin: (code: string) => void;
  /** Display name of the GM a new game would use. */
  gmName: string;
  onGmSettings: () => void;
}

/** Which parts of the screen the title and the menu card cover, for framing the 3D tour. */
function useCoveredInset(root: React.RefObject<HTMLElement | null>, title: React.RefObject<HTMLElement | null>, card: React.RefObject<HTMLElement | null>) {
  const [inset, setInset] = useState<TourInset>({ left: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const r = root.current?.getBoundingClientRect();
      const t = title.current?.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      if (!r || !t || !c) return;
      const sideBySide = c.right < r.width * 0.55;
      const next: TourInset = sideBySide
        ? { left: Math.round(c.right), top: Math.round(t.bottom * 0.6), bottom: 0 }
        : { left: 0, top: Math.round(t.bottom), bottom: Math.round(Math.min(r.height * 0.6, Math.max(0, r.height - c.top))) };
      setInset((p) => (p.left === next.left && p.top === next.top && p.bottom === next.bottom ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [root.current, title.current, card.current]) if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return inset;
}

export function Lobby({ busy, error, saved, onResume, onDiscard, onHotseat, onHost, onJoin, gmName, onGmSettings }: Props) {
  const [code, setCode] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const fullscreen = useFullscreen();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inset = useCoveredInset(rootRef, titleRef, cardRef);
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (c.length === 6) onJoin(c);
  };

  return (
    <div className="lobby" ref={rootRef}>
      <LobbyBackdrop inset={inset} />
      <div className="lobby-shade" />
      <header className="lobby-title" ref={titleRef}>
        <h1>
          <span>VERY TACTICAL</span> <span>CHESS</span>
        </h1>
        <p>아주 전략적인 체스</p>
      </header>
      <button className="menu-button lobby-menu-button" onClick={() => setShowMenu(true)} aria-haspopup="menu" title="설정">
        ⚙ <span className="label">설정</span>
      </button>

      <div className="lobby-scroll">
      <div className="lobby-card" ref={cardRef}>
        <p className="tagline">체스판 위에서 무엇이든 선언하세요. GM이 판정하고, 주사위가 결정합니다.</p>

        {saved && (
          <div className="saved-card">
            <div>
              <strong>저장된 게임</strong>
              <div className="muted-line">
                {saved.kind === 'host' ? `온라인 방 ${saved.code}` : '핫시트'} · 턴 {saved.state.turnNumber}
                {saved.state.status.kind === 'won' ? ' · 끝난 게임' : ''} · {ago(saved.savedAt)}
              </div>
            </div>
            <div className="saved-actions">
              <button className="primary" onClick={onResume} disabled={!!busy}>
                이어 하기
              </button>
              <button className="link" onClick={onDiscard} disabled={!!busy}>
                지우기
              </button>
            </div>
          </div>
        )}

        <button className="primary big" onClick={onHost} disabled={!!busy}>
          온라인 방 만들기
        </button>
        <form className="join-row" onSubmit={join}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="방 코드 6자리"
            maxLength={8}
            disabled={!!busy}
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button type="submit" disabled={!!busy || normalizeRoomCode(code).length !== 6}>
            참가
          </button>
        </form>
        <button className="big" onClick={onHotseat} disabled={!!busy}>
          한 화면에서 둘이 하기 (핫시트)
        </button>

        {busy && <p className="lobby-status">{busy}</p>}
        {error && <p className="lobby-error">{error}</p>}

        <details className="lobby-note">
          <summary>온라인 대전 안내</summary>
          온라인 대전은 서버 없이 두 브라우저를 직접 연결합니다(P2P). 방장 브라우저가 게임을 진행하고 GM을 호출합니다. 회사나 학교
          네트워크에서는 연결이 막힐 수 있으니, 그럴 때는 핫시트 모드를 이용하세요.
        </details>
      </div>
      </div>

      {showMenu && (
        <SettingsMenu
          onClose={() => setShowMenu(false)}
          gm={{ isAuthority: true, name: gmName, busy: false, onOpen: onGmSettings, note: '방을 만들거나 핫시트로 시작하면 이 GM을 씁니다. 다른 방에 참가하면 방장의 GM을 씁니다.' }}
          fullscreen={fullscreen}
        />
      )}
    </div>
  );
}
